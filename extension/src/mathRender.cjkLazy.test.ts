import { describe, expect, it } from 'vitest';
import { composeSvg, setCJKFontReadyListener } from './mathRender';

// このファイルは意図的に loadCJKFont() を事前に呼ばない(mathRender.test.ts とは別ファイル
// = vitestでは別モジュールインスタンスとして評価されるため、CJKフォントの内部状態が
// 'unloaded' から始まる)。指示書2「opentype.js動的import化」の遅延ロード挙動を検証する。

describe('CJK font lazy loading', () => {
  it('does not require the font for lines without CJK fallback <text>', () => {
    // 日本語を含まない行は、フォント未ロードでも即座に正しくレンダリングされる
    // (opentype.jsに一切触れないため)。
    const result = composeSvg(['e^{i\\pi}=-1']);
    expect(result.errorLines).toEqual([]);
    expect(result.loadingLines).toEqual([]);
    expect(result.svg).toContain('<svg');
  });

  it('shows a loading placeholder (not a syntax error) for CJK text before the font is ready, then resolves after loading completes', async () => {
    let notified = 0;
    setCJKFontReadyListener(() => {
      notified++;
    });

    const first = composeSvg(['\\text{日本語}']);
    // フォント未ロードの初回は「読み込み中」であり、構文エラー扱いにしてはいけない
    expect(first.errorLines).toEqual([]);
    expect(first.loadingLines).toEqual([0]);

    // バックグラウンドで開始された読み込み(動的import + fetch)が完了し、
    // コールバックが呼ばれるまで待つ。
    await new Promise<void>((resolve) => {
      const check = () => {
        if (notified > 0) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    const second = composeSvg(['\\text{日本語}']);
    expect(second.errorLines).toEqual([]);
    expect(second.loadingLines).toEqual([]);
    expect(second.svg).not.toMatch(/読み込み中/);

    setCJKFontReadyListener(null);
  });
});
