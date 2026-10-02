import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// mathRender.loadCJKFont() は fetch(url) でフォントファイルを取得する実装になっている。
// テスト環境(vitest/jsdom)には開発サーバーが存在しないため、"/fonts/..." へのfetchを
// public/fonts 配下の実ファイルを読むかたちに差し替える。これにより、CJKパス化を含む
// composeSvg の挙動を本番相当のフォントデータで検証できる。
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  const fontPath = new URL(url, 'http://localhost/').pathname.match(/\/fonts\/(.+)$/)?.[1];
  if (fontPath) {
    const filePath = resolve(__dirname, '../../public/fonts', fontPath);
    const buf = readFileSync(filePath);
    return new Response(buf);
  }
  if (originalFetch) return originalFetch(input, init);
  throw new Error(`fetch not mocked for: ${url}`);
}) as typeof fetch;
