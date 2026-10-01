/**
 * platform.ts (Chrome/Edge 拡張機能版)
 *
 * 旧 Tauri版では「クリップボード操作・ファイル保存・PNGラスタライズ」をすべて
 * Rustネイティブ側 (src-tauri/src/main.rs) が担っていた。ブラウザ拡張機能には
 * 任意ファイルへの直接書き込みや `arboard`/`resvg` 相当のネイティブAPIが存在しないため、
 * このファイルは同じ役割を「拡張機能ページ上で完結するWeb標準API」で肩代わりする。
 *
 *   - PNGラスタライズ: resvg (Rust) → <canvas> + Image() (ブラウザ標準)
 *   - クリップボード: arboard (Rust) → navigator.clipboard (Web標準)
 *   - ファイル保存: native save dialog (Rust) → chrome.downloads.download({ saveAs: true })
 *
 * 「任意のディレクトリを選んでそこへ直接書き込む」「終了時に自動でホームディレクトリへ
 * 保存する」という、ブラウザのサンドボックスでは実現不可能な機能は意図的に持たない。
 * 保存のたびにOSのファイル保存ダイアログを出す(常に「名前を付けて保存」)という、
 * ブラウザ拡張として素直な形に置き換えている。
 */

// --- 出力サイズのハード上限 ---------------------------------------------------
// 元のRust側 (rasterize()) にあった上限をそのままフロントエンドへ移設したもの。
// ネイティブ側が無くなった以上、ここがOOM(巨大なcanvas確保)を防ぐ唯一の防衛線になる。
const MAX_EXPORT_DIMENSION = 20_000;
const MAX_EXPORT_PIXELS = 80_000_000;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8.0;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * 合成済みSVG文字列を、指定スケールでPNG(Blob)へラスタライズする。
 * SVG中の文字はopentype.jsで既にパス化済みのため、外部フォント読み込み待ちなどは発生しない
 * (=同一オリジンのBlob URLをcanvasへ描画するだけなのでcanvasは汚染されない)。
 */
export async function svgToPngBlob(svg: string, widthPx: number, heightPx: number, scale: number): Promise<Blob> {
  const s = clampScale(scale);
  if (!(widthPx > 0) || !(heightPx > 0)) {
    throw new Error('SVGのサイズが不正です');
  }
  const outW = Math.max(1, Math.ceil(widthPx * s));
  const outH = Math.max(1, Math.ceil(heightPx * s));
  if (outW > MAX_EXPORT_DIMENSION || outH > MAX_EXPORT_DIMENSION) {
    throw new Error(
      `出力サイズが大きすぎます(${outW}x${outH}px)。文字サイズまたは解像度倍率を下げてください(上限: 一辺${MAX_EXPORT_DIMENSION}px)。`,
    );
  }
  const totalPixels = outW * outH;
  if (totalPixels > MAX_EXPORT_PIXELS) {
    throw new Error(
      `出力ピクセル数が上限を超えています(約${Math.round(totalPixels / 1_000_000)}メガピクセル、上限${MAX_EXPORT_PIXELS / 1_000_000}メガピクセル)。文字サイズまたは解像度倍率を下げてください。`,
    );
  }

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVGの読み込みに失敗しました'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D contextの取得に失敗しました');
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(img, 0, 0, outW, outH);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNGへの変換に失敗しました');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function copyPngToClipboard(svg: string, widthPx: number, heightPx: number, scale: number): Promise<void> {
  const blob = await svgToPngBlob(svg, widthPx, heightPx, scale);
  // ClipboardItemはSecure Context(拡張機能ページは常にSecure Context扱い)でのみ利用可能。
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

export type SaveResult = 'saved' | 'cancelled';

function hasChromeDownloads(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.downloads && typeof chrome.downloads.download === 'function';
}

/** ダウンロードの完了/中断(キャンセル含む)を待つ。CHROME拡張のみで使用。 */
function waitForDownloadSettled(downloadId: number): Promise<SaveResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      chrome.downloads.onChanged.removeListener(listener);
      window.clearTimeout(timeoutId);
    };
    const finishOk = (result: SaveResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const finishErr = (e: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e);
    };
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        finishOk('saved');
      } else if (delta.state?.current === 'interrupted') {
        // ユーザーが保存ダイアログを閉じた/キャンセルした場合は静かに「キャンセル扱い」にする。
        // それ以外の中断理由(ディスク容量不足など)はエラーとして呼び出し元へ伝える。
        const reason = delta.error?.current ?? '';
        if (reason.includes('CANCELED') || reason.includes('USER')) {
          finishOk('cancelled');
        } else {
          finishErr(new Error(`保存に失敗しました(${reason || '不明なエラー'})`));
        }
      }
    };
    chrome.downloads.onChanged.addListener(listener);
    // 完了を確認できなければ成功とは扱わない。保存ダイアログを長く開いた場合も同様。
    const timeoutId = window.setTimeout(() => finishErr(new Error('保存の完了を確認できませんでした')), 120_000);
  });
}

/**
 * バイト列(またはテキスト)をファイルとして保存する。
 * 拡張機能内(chrome.downloads利用可)では常にOSの「名前を付けて保存」ダイアログを出す。
 * (拡張機能の外=素のブラウザプレビュー等で動かした場合は<a download>にフォールバックする。)
 */
export async function saveAsFile(data: BlobPart, filename: string, mime: string): Promise<SaveResult> {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    if (hasChromeDownloads()) {
      const downloadId = await new Promise<number>((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: true }, (id) => {
          const err = chrome.runtime.lastError;
          if (err || id === undefined) {
            reject(new Error(err?.message ?? 'ダウンロードを開始できませんでした'));
          } else {
            resolve(id);
          }
        });
      });
      return await waitForDownloadSettled(downloadId);
    }
    // 開発中のプレビュー(vite dev / vite preview)など、拡張機能コンテキスト外へのフォールバック。
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'saved';
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
