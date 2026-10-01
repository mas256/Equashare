/**
 * quickPopup.ts (Tauri デスクトップ版・簡易入力ポップアップ)
 *
 * グローバルショートカット(既定 Ctrl+Shift+E。登録自体はsrc/main.ts側で行い、押されたら
 * このウィンドウ(tauri.conf.jsonで"quickpopup"ラベル定義済み)を表示するだけ)から開かれる、
 * 最小限のポップアップ。指示書の通り「コードの打ち込みと画像コピー機能のみ」に絞り、
 * 出力設定(文字サイズ・余白・色・倍率)は変更させず、メイン画面の「既定の出力設定」
 * (設定 > 既定の出力設定。起動時に使われるものと同じlocalStorageキー)をそのまま読み取って使う。
 *
 * main.tsとは意図的にロジックを共有しない(独立した小さなエントリポイント)。
 * 理由: main.tsは2000行超の大きなファイルであり、そこから汎用モジュールを切り出す
 * リファクタリングは、メインアプリ側の動作を壊すリスクを伴う。ここで必要なのは
 * 「設定を読む」「レンダリングする」「コピーする」「履歴に積む」という4つの小さな処理
 * だけなので、mathRender.tsという既存の共有基盤の上に、最小限のコードを独立して書く方が安全。
 * localStorageのキー名(下記)はmain.tsと完全に一致させてあるので、データそのものは
 * メイン画面と共有される(Tauriの各ウィンドウは同一オリジンのため、localStorageも共有される)。
 */
import './style.css';
import { composeSvg, splitLinesWithNumbers, RenderOptions } from './mathRender';
import { applyI18nToDom, t } from './i18n';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const inputEl = $<HTMLTextAreaElement>('quickInput');
const previewEl = $<HTMLDivElement>('quickPreview');
const statusEl = $<HTMLSpanElement>('quickStatus');
const copyBtn = $<HTMLButtonElement>('quickCopyBtn');
const openMainBtn = $<HTMLButtonElement>('quickOpenMainBtn');

// --- main.tsと共通のlocalStorageキー(値は読み取り専用で使う) -----------------
const THEME_KEY = 'mathimg.theme';
const DEFAULT_FONT_SIZE_KEY = 'mathimg.defaultFontSizePx';
const DEFAULT_SCALE_KEY = 'mathimg.defaultScale';
const DEFAULT_PADDING_PX_KEY = 'mathimg.defaultPaddingPx';
const DEFAULT_TRANSPARENT_BG_KEY = 'mathimg.defaultTransparentBg';
const HISTORY_KEY = 'mathimg.history';
const HISTORY_LIMIT_KEY = 'mathimg.historyLimit';

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 200;
const SCALE_MIN = 1;
const SCALE_MAX = 8;
const PADDING_PX_MIN = 0;
const PADDING_PX_MAX = 200;
const HISTORY_LIMIT_MIN = 5;
const HISTORY_LIMIT_MAX = 20;
const HISTORY_LIMIT_DEFAULT = 10;

function clampedNumber(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (value === null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** メイン画面の「既定の出力設定」(設定 > 既定の出力設定)をそのまま使う。
 * 色(文字色/背景色)はメイン画面でも永続化されていない値のため、HTML側の既定値
 * (#000000 / #ffffff)と同じ値を固定で使う。 */
function readOutputOptions(): RenderOptions {
  return {
    fontSizePx: clampedNumber(localStorage.getItem(DEFAULT_FONT_SIZE_KEY), 48, FONT_SIZE_MIN, FONT_SIZE_MAX),
    lineGapPx: 16,
    paddingPx: clampedNumber(localStorage.getItem(DEFAULT_PADDING_PX_KEY), 24, PADDING_PX_MIN, PADDING_PX_MAX),
    fontColor: '#000000',
    backgroundColor: '#ffffff',
    transparentBackground: localStorage.getItem(DEFAULT_TRANSPARENT_BG_KEY) === 'on',
  };
}
function readScale(): number {
  return clampedNumber(localStorage.getItem(DEFAULT_SCALE_KEY), 2, SCALE_MIN, SCALE_MAX);
}

// --- 履歴への記録(メイン画面のhistory機能と同じデータ形式・同じキーを共有しているため、
//     メイン画面の履歴パネルにもここでコピーした内容がそのまま並ぶ) -----------------
type HistoryAction = 'copyImage' | 'copySvgText' | 'copyUnicode' | 'copyMathML' | 'saveImage' | 'saveSource';
interface HistoryEntry {
  id: string;
  timestamp: number;
  action: HistoryAction;
  source: string;
}
function pushHistoryEntry(action: HistoryAction, source: string): void {
  if (source.trim().length === 0) return;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries: HistoryEntry[] = Array.isArray(parsed) ? parsed : [];
    entries.unshift({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      action,
      source,
    });
    const limitRaw = Number(localStorage.getItem(HISTORY_LIMIT_KEY));
    const limit = Number.isFinite(limitRaw) && limitRaw >= HISTORY_LIMIT_MIN && limitRaw <= HISTORY_LIMIT_MAX ? limitRaw : HISTORY_LIMIT_DEFAULT;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, limit)));
  } catch {
    // 履歴保存の失敗はコピー自体の成否に影響させない(黙って諦める)。
  }
}

// --- テーマ(メイン画面と見た目を揃える) -----------------
const savedTheme = localStorage.getItem(THEME_KEY);
document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : 'dark');
applyI18nToDom();

// --- プレビュー ---------------------------------------------------------
let lastValidSvg: string | null = null;
let renderTimer: number | null = null;
let preserveNextFocus = false;

function render(): void {
  const numbered = splitLinesWithNumbers(inputEl.value);
  if (numbered.length === 0) {
    previewEl.innerHTML = '';
    lastValidSvg = null;
    copyBtn.disabled = true;
    return;
  }
  try {
    const composed = composeSvg(
      numbered.map((n) => n.text),
      readOutputOptions(),
    );
    previewEl.innerHTML = composed.svg;
    lastValidSvg = composed.svg;
    copyBtn.disabled = false;
  } catch (e) {
    previewEl.replaceChildren();
    const errorEl = document.createElement('div');
    errorEl.className = 'quick-popup-preview-error';
    errorEl.textContent = e instanceof Error ? e.message : String(e);
    previewEl.appendChild(errorEl);
    lastValidSvg = null;
    copyBtn.disabled = true;
  }
}

function scheduleRender(): void {
  if (renderTimer !== null) window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}

function setStatus(message: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('ok', kind === 'ok');
  statusEl.classList.toggle('err', kind === 'err');
}

async function doCopy(): Promise<void> {
  if (!lastValidSvg) return;
  copyBtn.disabled = true;
  setStatus(t('quickPopup.copying'));
  try {
    await invoke('copy_export_to_clipboard', { svg: lastValidSvg, format: 'png', scale: readScale() });
    pushHistoryEntry('copyImage', inputEl.value);
    setStatus(t('quickPopup.copied'), 'ok');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  } finally {
    copyBtn.disabled = false;
  }
}

inputEl.addEventListener('input', scheduleRender);
inputEl.addEventListener('keydown', (ev) => {
  // Ctrl/Cmd+Enterで即コピー(素のEnterは複数行入力のための改行として使うため奪わない)。
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    ev.preventDefault();
    void doCopy();
  }
  // Escapeでウィンドウを閉じる(実際にはRust側でclose-requestedをhide()に読み替えて
  // いるため、次回ホットキーで再度開いた際は入力欄がクリアされた状態で再表示される)。
  if (ev.key === 'Escape') {
    void appWindow.hide();
  }
});
copyBtn.addEventListener('click', () => {
  void doCopy();
});
openMainBtn.addEventListener('click', () => {
  void (async () => {
    const main = WebviewWindow.getByLabel('main');
    if (!main) return;
    await main.show();
    await main.setFocus();
    await main.emit('quick-open-main', inputEl.value);
  })().catch((e) => setStatus(String(e), 'err'));
});

copyBtn.disabled = true;
inputEl.focus();

/** Native Messaging(ブラウザ拡張機能からの「選択中の数式をアプリへ送る」)経由で
 * 届いた数式があれば、それを入力欄へ反映してレンダリングする。無ければ何もしない
 * (呼び出し側が、無かった場合の従来動作=空欄化を続けて行う)。
 * 戻り値: 反映した場合true。 */
async function applyPendingSourceIfAny(): Promise<boolean> {
  try {
    const source = await invoke<string | null>('take_pending_quick_popup_source');
    if (!source) return false;
    inputEl.value = source;
    scheduleRender();
    return true;
  } catch {
    return false;
  }
}

// このウィンドウはRust側でCloseRequested(✕クリック)・フォーカスロス(他アプリへの
// 切り替え)の両方をhide()に読み替えている(quickpopup.htmlはtauri.conf.jsonで
// 常駐ウィンドウとして定義済み)。ここで表示のたびに入力欄をクリアしておくことで、
// 「次に開いたときは前回の内容が残っている」という驚きを避ける。
// ただし、Native Messaging経由で数式が届いている場合はそちらを優先する
// (「フォーカスが当たった瞬間に空欄へクリア→直後に中身が届いて上書き」という
// 見た目のちらつき/取りこぼしを避けるため、クリアするかどうかの判定自体を
// pending sourceの有無で分岐させ、1箇所に集約する)。
void appWindow.onFocusChanged(({ payload: focused }) => {
  if (!focused) return;
  void (async () => {
    const applied = await applyPendingSourceIfAny();
    if (applied) {
      copyBtn.disabled = false;
      setStatus('');
      inputEl.focus();
      return;
    }
    if (preserveNextFocus) {
      preserveNextFocus = false;
      inputEl.focus();
      return;
    }
    inputEl.value = '';
    previewEl.innerHTML = '';
    lastValidSvg = null;
    copyBtn.disabled = true;
    setStatus('');
    inputEl.focus();
  })();
});

void appWindow.listen<boolean>('quick-open-main-result', ({ payload: accepted }) => {
  if (accepted) return;
  preserveNextFocus = true;
  void appWindow.show().then(() => appWindow.setFocus());
});

// ウィンドウが既にフォーカスされている状態(=上のonFocusChangedが発火しない)で
// 中継が届いた場合の保険。取得自体はtake_pending_quick_popup_source経由で冪等なため、
// 二重に呼ばれても実害はない(2回目は素通り=false)。
void appWindow.listen('quick-popup-source-ready', () => {
  void applyPendingSourceIfAny().then((applied) => {
    if (applied) {
      copyBtn.disabled = false;
      setStatus('');
      inputEl.focus();
    }
  });
});

// 起動直後(Native Messaging経由でこのプロセス自体が数式付きで新規起動された場合)にも、
// 上記のフォーカスイベントより先に反映を試みておく。
void applyPendingSourceIfAny().then((applied) => {
  if (applied) copyBtn.disabled = false;
}).finally(() => { void invoke('mark_quick_popup_ready'); });
