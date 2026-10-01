/**
 * popup.ts (Chrome/Edge拡張機能版・簡易入力ポップアップ)
 *
 * グローバルホットキー(既定Ctrl+Shift+E、拡張機能の制約でブラウザにフォーカスがある間のみ
 * 動作する。詳細はbackground.js参照)から開かれる、最小限のポップアップ。
 * 指示書の通り「コードの打ち込みと画像コピー機能のみ」に絞り、出力設定(文字サイズ・
 * 余白・色・倍率)は変更させず、メイン画面の「既定の出力設定」(起動時に使われるものと
 * 同じlocalStorageキー)をそのまま読み取って使う。
 *
 * main.tsとは意図的にロジックを共有しない(popup.tsは独立した小さなエントリポイント)。
 * 理由: main.tsは2000行超の大きなファイルであり、そこから汎用モジュールを切り出す
 * リファクタリングは、メインアプリ側の動作を壊すリスクを伴う。ここで必要なのは
 * 「設定を読む」「レンダリングする」「コピーする」「履歴に積む」という4つの小さな処理
 * だけなので、mathRender.ts/platform.tsという既存の共有基盤の上に、最小限のコードを
 * 独立して書く方が安全。localStorageのキー名(下記)はmain.tsと完全に一致させてあるので、
 * データそのものはメイン画面と共有される。
 */
import './style.css';
import { composeSvg, splitLinesWithNumbers, RenderOptions } from './mathRender';
import { applyI18nToDom, t } from './i18n';
import * as platform from './platform';

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

// --- 履歴への記録(メイン画面のhistory.tsと同じデータ形式。HISTORY_KEYを共有しているため
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
let lastComposedSize: { widthPx: number; heightPx: number } | null = null;
let renderTimer: number | null = null;

function render(): void {
  const numbered = splitLinesWithNumbers(inputEl.value);
  if (numbered.length === 0) {
    previewEl.innerHTML = '';
    lastValidSvg = null;
    lastComposedSize = null;
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
    lastComposedSize = { widthPx: composed.widthPx, heightPx: composed.heightPx };
    copyBtn.disabled = false;
  } catch (e) {
    previewEl.replaceChildren();
    const errorEl = document.createElement('div');
    errorEl.className = 'quick-popup-preview-error';
    errorEl.textContent = e instanceof Error ? e.message : String(e);
    previewEl.appendChild(errorEl);
    lastValidSvg = null;
    lastComposedSize = null;
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
  if (!lastValidSvg || !lastComposedSize) return;
  copyBtn.disabled = true;
  setStatus(t('quickPopup.copying'));
  try {
    await platform.copyPngToClipboard(lastValidSvg, lastComposedSize.widthPx, lastComposedSize.heightPx, readScale());
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
});
copyBtn.addEventListener('click', () => {
  void doCopy();
});
openMainBtn.addEventListener('click', () => {
  const url = chrome.runtime.getURL('index.html');
  const prefill = inputEl.value;
  void (async () => {
    const token = crypto.randomUUID();
    await chrome.storage.session.set({ [`quickEditorPrefill:${token}`]: prefill });
    await chrome.tabs.create({ url: `${url}?prefillToken=${encodeURIComponent(token)}` });
    window.close();
  })().catch((e) => setStatus(String(e), 'err'));
});

copyBtn.disabled = true;

// 右クリックメニュー(Equashareで簡易表示)から開かれた場合、選択テキストが
// chrome.storage.sessionに置かれている。ここで一度だけ読んで消費する。
void (async () => {
  try {
    const result = await chrome.storage.session.get('quickPopupPrefill');
    const text = result.quickPopupPrefill;
    if (typeof text === 'string' && text) {
      await chrome.storage.session.remove('quickPopupPrefill');
      inputEl.value = text;
      render();
    }
  } catch {
    // storage.session未対応/取得失敗時は空欄のまま開くだけにする(致命的ではない)。
  } finally {
    inputEl.focus();
  }
})();
