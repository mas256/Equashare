import './style.css';
import { composeMathML, composeSvg, composeUnicodeApprox, splitLinesWithNumbers, setCJKFontReadyListener, RenderOptions } from './mathRender';
import { t, applyI18nToDom, getLang, setLang, Lang } from './i18n';
import { invoke } from '@tauri-apps/api/tauri';
import { save, ask, open as openDialogPicker } from '@tauri-apps/api/dialog';
import { documentDir, appDataDir, join as pathJoin } from '@tauri-apps/api/path';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';
import { register as registerGlobalShortcut, unregister as unregisterGlobalShortcut, isRegistered as isGlobalShortcutRegistered } from '@tauri-apps/api/globalShortcut';
import { shouldRegisterDesktopShortcut } from './shortcutRouting';
import { COMMON_SETTING_KEYS, createSettingsBackupJson, parseSettingsBackupJson } from '../../shared/settingsTransfer';

type OutputFormat = 'svg' | 'png';

const DEFAULT_INPUT = [
  '\\textbf{Hello, world!}',
  "\\text{You don't need to write complex code.}",
  "\\text{Just write your equations in } \\LaTeX\\text{.}",
  'e^{i\\pi}=-1',
  "\\int f'(x)g(x)=f(x)g(x)-\\int f(x)g'(x)",
].join('\n');

const LAST_DIR_KEY = 'mathimg.lastDir';
const THEME_KEY = 'mathimg.theme';
const EDITOR_WIDTH_KEY = 'mathimg.editorWidth';
const OUTPUT_HEIGHT_KEY = 'mathimg.outputHeight';
// v4.0: テンプレートはlocalStorageではなく、専用のJSONファイル(アプリの
// データディレクトリ配下)で別管理する。他のUI設定(mathimg.*キー群)とは
// ライフサイクルが異なる(インポート/エクスポートで丸ごと出し入れされる)ため、
// あえて分離する。Equashareホームディレクトリ(画像/ソース書き出し先、
// ユーザーが変更できる)とも別物であることに注意。
const TEMPLATES_FILENAME = 'templates.json';
const HISTORY_KEY = 'mathimg.history';
const HISTORY_LIMIT_KEY = 'mathimg.historyLimit';
const HISTORY_LIMIT_MIN = 5;
const HISTORY_LIMIT_MAX = 20;
const HISTORY_LIMIT_DEFAULT = 10;
const SUGGEST_KEY = 'mathimg.suggestEnabled';
const DEFAULT_TEXT_KEY = 'mathimg.defaultTextEnabled';
const EXIT_SAVE_KEY = 'mathimg.exitSaveMode';
const HOME_DIR_KEY = 'mathimg.homeDir';
// 2.5: 起動時に出力設定へ適用する「既定値」。現在の出力設定(formatEl等)そのものの値とは
// 別に保持し、セッション中の変更が次回起動時の既定値を書き換えないようにする。
const DEFAULT_FORMAT_KEY = 'mathimg.defaultFormat';
const DEFAULT_FONT_SIZE_KEY = 'mathimg.defaultFontSizePx';
const DEFAULT_SCALE_KEY = 'mathimg.defaultScale';
const DEFAULT_PADDING_PX_KEY = 'mathimg.defaultPaddingPx';
const DEFAULT_TRANSPARENT_BG_KEY = 'mathimg.defaultTransparentBg';
// 2.3: 括弧の自動補完のうち「選択範囲を括弧で囲む」動作のみ設定でON/OFFできる
// (自動挿入・素通りスキップの2つは常時有効)。既存のSUGGEST_KEYとは別の新しい設定キー。
const BRACKET_WRAP_SELECTION_KEY = 'mathimg.bracketWrapSelectionEnabled';
// 入力欄でTabキーを押した際に挿入するスペースの数(設定可能)。
const TAB_SIZE_KEY = 'mathimg.tabSize';
// v3.0: UIサイズ調整(%, 100=等倍)。言語(mathimg.lang)自体はi18n.ts側で管理する。
const UI_SCALE_KEY = 'mathimg.uiScalePercent';
const TMPL_SCALE_KEY = 'mathimg.tmplScalePercent';
const QUICK_POPUP_HOTKEY_KEY = 'mathimg.quickPopupHotkey';
const QUICK_POPUP_HOTKEY_ENABLED_KEY = 'mathimg.quickPopupHotkeyEnabled';
const SETTINGS_TRANSFER_KEYS = [...COMMON_SETTING_KEYS, EXIT_SAVE_KEY] as const;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const inputEl = $<HTMLTextAreaElement>('input');
const inputOverlayEl = $<HTMLPreElement>('inputOverlay');
const bracketHighlightAEl = $<HTMLDivElement>('bracketHighlightA');
const bracketHighlightBEl = $<HTMLDivElement>('bracketHighlightB');
const gutterEl = $<HTMLDivElement>('gutter');
const formatEl = $<HTMLSelectElement>('format');
const fontSizeEl = $<HTMLInputElement>('fontSize');
const scaleEl = $<HTMLInputElement>('scale');
const paddingPxEl = $<HTMLInputElement>('paddingPx');
const fontColorEl = $<HTMLInputElement>('fontColor');
const backgroundColorEl = $<HTMLInputElement>('backgroundColor');
const transparentBgEl = $<HTMLInputElement>('transparentBg');
const previewWrapEl = $<HTMLDivElement>('previewWrap');
const previewEl = $<HTMLDivElement>('preview');
const statusEl = $<HTMLSpanElement>('status');
const btnCopy = $<HTMLButtonElement>('btnCopy');
const btnOtherCopy = $<HTMLButtonElement>('btnOtherCopy');
const otherCopyMenuEl = $<HTMLDivElement>('otherCopyMenu');
const btnCopyUnicode = $<HTMLButtonElement>('btnCopyUnicode');
const btnCopyMathML = $<HTMLButtonElement>('btnCopyMathML');
const btnSave = $<HTMLButtonElement>('btnSave');
const btnSaveSource = $<HTMLButtonElement>('btnSaveSource');
const btnSaveAsTemplate = $<HTMLButtonElement>('btnSaveAsTemplate');
const templateEditBarEl = $<HTMLDivElement>('templateEditBar');
const templateEditBarTextEl = $<HTMLSpanElement>('templateEditBarText');
const btnTemplateEditCancel = $<HTMLButtonElement>('btnTemplateEditCancel');
const btnTheme = $<HTMLButtonElement>('btnTheme');
const sampleSelect = $<HTMLSelectElement>('sampleSelect');
const userTemplateSelect = $<HTMLSelectElement>('userTemplateSelect');
const templateButtonsEl = $<HTMLDivElement>('templateButtons');
const zoomInEl = $<HTMLButtonElement>('zoomIn');
const zoomOutEl = $<HTMLButtonElement>('zoomOut');
const zoomResetEl = $<HTMLButtonElement>('zoomReset');
const zoomLabelEl = $<HTMLSpanElement>('zoomLabel');
const btnHelp = $<HTMLButtonElement>('btnHelp');
const btnHelpClose = $<HTMLButtonElement>('btnHelpClose');
const helpOverlayEl = $<HTMLDivElement>('helpOverlay');
const helpVersionEl = $<HTMLSpanElement>('helpVersion');
const btnHistory = $<HTMLButtonElement>('btnHistory');
const btnHistoryClose = $<HTMLButtonElement>('btnHistoryClose');
const historyOverlayEl = $<HTMLDivElement>('historyOverlay');
const historyListEl = $<HTMLDivElement>('historyList');
const historyEmptyEl = $<HTMLParagraphElement>('historyEmpty');
const btnHistoryClearAll = $<HTMLButtonElement>('btnHistoryClearAll');
const editorPaneEl = $<HTMLDivElement>('editorPane');
const outputPartEl = $<HTMLDivElement>('outputPart');
const splitterVEl = $<HTMLDivElement>('splitterV');
const splitterHEl = $<HTMLDivElement>('splitterH');
const unsavedDotEl = $<HTMLSpanElement>('unsavedDot');
const suggestPopupEl = $<HTMLDivElement>('suggestPopup');

// 設定モーダル
const btnSettings = $<HTMLButtonElement>('btnSettings');
const btnSettingsClose = $<HTMLButtonElement>('btnSettingsClose');
const settingsOverlayEl = $<HTMLDivElement>('settingsOverlay');
const settingsPanelEl = $<HTMLDivElement>('settingsPanel');
const settingsListViewEl = $<HTMLDivElement>('settingsListView');
const templateManageViewEl = $<HTMLDivElement>('templateManageView');
const settingLanguageEl = $<HTMLSelectElement>('settingLanguage');
const settingUiScaleEl = $<HTMLInputElement>('settingUiScale');
const settingUiScaleLabelEl = $<HTMLSpanElement>('settingUiScaleLabel');
const settingTmplScaleEl = $<HTMLInputElement>('settingTmplScale');
const settingTmplScaleLabelEl = $<HTMLSpanElement>('settingTmplScaleLabel');
const settingSuggestEl = $<HTMLButtonElement>('settingSuggest');const settingDefaultTextEl = $<HTMLButtonElement>('settingDefaultText');
const settingBracketWrapSelectionEl = $<HTMLButtonElement>('settingBracketWrapSelection');
const settingTabSizeEl = $<HTMLInputElement>('settingTabSize');
const settingHistoryLimitEl = $<HTMLInputElement>('settingHistoryLimit');
const settingExitSaveEl = $<HTMLSelectElement>('settingExitSave');
const settingHomeDirDisplayEl = $<HTMLInputElement>('settingHomeDirDisplay');
const btnChangeHomeDir = $<HTMLButtonElement>('btnChangeHomeDir');
const settingQuickPopupHotkeyDisplayEl = $<HTMLInputElement>('settingQuickPopupHotkeyDisplay');
const btnChangeQuickPopupHotkey = $<HTMLButtonElement>('btnChangeQuickPopupHotkey');
const settingQuickPopupHotkeyEnabledEl = $<HTMLButtonElement>('settingQuickPopupHotkeyEnabled');
const settingNativeMessagingStatusEl = $<HTMLInputElement>('settingNativeMessagingStatus');
const btnToggleNativeMessaging = $<HTMLButtonElement>('btnToggleNativeMessaging');
const settingDefaultFormatEl = $<HTMLSelectElement>('settingDefaultFormat');
const settingDefaultFontSizeEl = $<HTMLInputElement>('settingDefaultFontSize');
const settingDefaultScaleEl = $<HTMLInputElement>('settingDefaultScale');
const settingDefaultPaddingPxEl = $<HTMLInputElement>('settingDefaultPaddingPx');
const settingDefaultTransparentBgEl = $<HTMLButtonElement>('settingDefaultTransparentBg');
const btnManageTemplates = $<HTMLButtonElement>('btnManageTemplates');
const btnExportSettings = $<HTMLButtonElement>('btnExportSettings');
const btnImportSettings = $<HTMLButtonElement>('btnImportSettings');
const btnTemplateManageBack = $<HTMLButtonElement>('btnTemplateManageBack');
const templateManageListEl = $<HTMLDivElement>('templateManageList');
const templateManageEmptyEl = $<HTMLParagraphElement>('templateManageEmpty');
const btnTemplateImport = $<HTMLButtonElement>('btnTemplateImport');
const btnTemplateExport = $<HTMLButtonElement>('btnTemplateExport');

// テンプレートインポート時の名前衝突モーダル(3択)
const templateImportConflictOverlayEl = $<HTMLDivElement>('templateImportConflictOverlay');
const templateImportConflictMessageEl = $<HTMLParagraphElement>('templateImportConflictMessage');
const btnImportConflictOverwrite = $<HTMLButtonElement>('btnImportConflictOverwrite');
const btnImportConflictRename = $<HTMLButtonElement>('btnImportConflictRename');
const btnImportConflictCancel = $<HTMLButtonElement>('btnImportConflictCancel');

// 汎用確認モーダル
const confirmOverlayEl = $<HTMLDivElement>('confirmOverlay');
const confirmMessageEl = $<HTMLParagraphElement>('confirmMessage');
const btnConfirmOk = $<HTMLButtonElement>('btnConfirmOk');
const btnConfirmCancel = $<HTMLButtonElement>('btnConfirmCancel');

// テンプレート名入力モーダル
const templateNamePromptOverlayEl = $<HTMLDivElement>('templateNamePromptOverlay');
const templateNameInputEl = $<HTMLInputElement>('templateNameInput');
const btnTemplateNameConfirm = $<HTMLButtonElement>('btnTemplateNameConfirm');
const btnTemplateNameCancel = $<HTMLButtonElement>('btnTemplateNameCancel');

// 終了時の保存確認モーダル(3択)
const exitConfirmOverlayEl = $<HTMLDivElement>('exitConfirmOverlay');
const btnExitSave = $<HTMLButtonElement>('btnExitSave');
const btnExitDiscard = $<HTMLButtonElement>('btnExitDiscard');
const btnExitCancel = $<HTMLButtonElement>('btnExitCancel');

// ヘルプパネルのバージョン表記 (2.4)。静的な内容なので起動時に一度だけ設定する。
helpVersionEl.textContent = `v${APP_VERSION}`;

let lastComposed: { svg: string; widthPx: number; heightPx: number } | null = null;
let lastSavedDir: string | null = localStorage.getItem(LAST_DIR_KEY);
let homeDirCache: string | null = localStorage.getItem(HOME_DIR_KEY);

function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

// ---------------------------------------------------------------------------
// 未保存(dirty)状態の管理
// ---------------------------------------------------------------------------
// 初期状態(起動時の内容、または最後にソース/画像を保存した時点の内容)からの変化が
// あるかどうかで判別する。ウィンドウタイトル(タスクバー/Alt+Tab)にも反映するため、
// document.title ではなくTauriのネイティブAPI(appWindow.setTitle)を使う。

let isDirty = false;
/** 未保存判定の基準となる「きれいな」ソース内容。起動時・ソース保存・画像保存で更新する。 */
let cleanBaseline = '';

function setDirty(dirty: boolean): void {
  isDirty = dirty;
  unsavedDotEl.classList.toggle('hidden', !dirty);
  void appWindow.setTitle(dirty ? `● Equashare v${APP_VERSION}` : `Equashare v${APP_VERSION}`);
}

/** 現在の入力と cleanBaseline を比較して dirty 状態を更新する。 */
function updateDirtyFromContent(): void {
  setDirty(inputEl.value !== cleanBaseline);
}

/** ソースまたは画像の保存成功時に呼び、現在の内容を基準に戻す(ポチを消す)。 */
function markContentClean(): void {
  cleanBaseline = inputEl.value;
  setDirty(false);
}

// ---------------------------------------------------------------------------
// 数値入力欄のクランプ
// ---------------------------------------------------------------------------
// input[type=number] の min/max はスピンボタン(▲▼)の増減幅にのみ効き、キーボードで
// 直接範囲外の値を打ち込んだ場合は素通りしてしまう。特にfontSizeはcurrentOptions()経由で
// 毎回のプレビュー描画に直結し、書き出し時のサイズ確認ダイアログの対象外でもあるため、
// 読み取り時に必ずここで挟む。HTML側のmin/max属性値と一致させること。
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 200;
const SCALE_MIN = 1;
const SCALE_MAX = 8;
const PADDING_PX_MIN = 0;
const PADDING_PX_MAX = 200;
// HTML側のsettingTabSizeのmin/max属性値と一致させること。
const TAB_SIZE_MIN = 1;
const TAB_SIZE_MAX = 16;

function clampedNumber(value: string, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getFontSizePx(): number {
  return clampedNumber(fontSizeEl.value, 48, FONT_SIZE_MIN, FONT_SIZE_MAX);
}

function getScale(): number {
  return clampedNumber(scaleEl.value, 2, SCALE_MIN, SCALE_MAX);
}

function getPaddingPx(): number {
  return clampedNumber(paddingPxEl.value, 24, PADDING_PX_MIN, PADDING_PX_MAX);
}

// 2.5: 起動時に出力設定へ適用する既定値。保存されていなければ現行のHTML初期値
// (format=png / fontSize=48 / scale=2 / paddingPx=24 / transparentBg=off)にフォールバックする。
function getDefaultFormat(): OutputFormat {
  const v = localStorage.getItem(DEFAULT_FORMAT_KEY);
  return v === 'svg' || v === 'png' ? v : 'png';
}

function getDefaultFontSizePx(): number {
  const v = localStorage.getItem(DEFAULT_FONT_SIZE_KEY);
  return v === null ? 48 : clampedNumber(v, 48, FONT_SIZE_MIN, FONT_SIZE_MAX);
}

function getDefaultScale(): number {
  const v = localStorage.getItem(DEFAULT_SCALE_KEY);
  return v === null ? 2 : clampedNumber(v, 2, SCALE_MIN, SCALE_MAX);
}

function getDefaultPaddingPx(): number {
  const v = localStorage.getItem(DEFAULT_PADDING_PX_KEY);
  return v === null ? 24 : clampedNumber(v, 24, PADDING_PX_MIN, PADDING_PX_MAX);
}

function isDefaultTransparentBgEnabled(): boolean {
  return localStorage.getItem(DEFAULT_TRANSPARENT_BG_KEY) === 'on';
}

/** 起動時、init()内でrenderPreview()より前に呼ぶ。保存済みの既定値を実際の出力コントロールへ適用する。 */
function applyStartupOutputDefaults(): void {
  formatEl.value = getDefaultFormat();
  fontSizeEl.value = String(getDefaultFontSizePx());
  scaleEl.value = String(getDefaultScale());
  paddingPxEl.value = String(getDefaultPaddingPx());
  transparentBgEl.checked = isDefaultTransparentBgEnabled();
}

function currentOptions(): RenderOptions {
  return {
    fontSizePx: getFontSizePx(),
    lineGapPx: 16,
    paddingPx: getPaddingPx(),
    fontColor: fontColorEl.value,
    backgroundColor: backgroundColorEl.value,
    transparentBackground: transparentBgEl.checked,
  };
}

/** 透過ONの間は背景色ピッカーを操作しても意味がないため、見た目でも無効化しておく。 */
function updateTransparentBgUI(): void {
  backgroundColorEl.disabled = transparentBgEl.checked;
}

// ---------------------------------------------------------------------------
// 行番号ガター & エラー行ハイライト
// ---------------------------------------------------------------------------

/** 直近にrenderPreview()が確定したエラー行集合。MathJaxでの構文チェックは
 * デバウンス(120ms)されているため、その間もガターの行数(=高さ)だけは
 * refreshInputOverlay()経由でキー入力のたびに即時追従させる際に使う。 */
let lastGutterErrorLineNumbers: Set<number> = new Set();

function updateGutter(errorLineNumbers: Set<number> = lastGutterErrorLineNumbers): void {
  lastGutterErrorLineNumbers = errorLineNumbers;
  const totalLines = inputEl.value.split('\n').length;
  const parts: string[] = [];
  for (let i = 1; i <= totalLines; i++) {
    const cls = errorLineNumbers.has(i) ? ' class="gutter-line gutter-line-error"' : ' class="gutter-line"';
    parts.push(`<div${cls}>${i}</div>`);
  }
  gutterEl.innerHTML = parts.join('');
}

// ---------------------------------------------------------------------------
// Undo/Redo (独自履歴スタック)
// ---------------------------------------------------------------------------
// よく使う記法/サンプル/ユーザーテンプレート挿入ボタンは textarea.value を直接書き換えるため、
// ブラウザ標準のUndo履歴が引き継がれない(それ以降Ctrl+Zが効かなくなる)。そのため入力欄専用の
// Undo/Redoスタックを自前で持ち、タイピングと挿入の両方をCtrl+Z/Ctrl+Yで統一的に
// 操作できるようにする。
const HISTORY_LIMIT = 100;
const HISTORY_DEBOUNCE_MS = 400;
let undoStack: string[] = [];
let redoStack: string[] = [];
let historyBaseline = '';
let historyDebounceTimer: number | undefined;

function pushHistoryIfChanged(): void {
  if (inputEl.value === historyBaseline) return;
  undoStack.push(historyBaseline);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  historyBaseline = inputEl.value;
}

/** タイピング中の連続入力を1つのUndo単位にまとめるため、一定時間操作が止まってから
 * 履歴に積む(1文字ごとにUndo単位が分かれると使いづらいため)。 */
function scheduleHistoryCommit(): void {
  if (historyDebounceTimer) window.clearTimeout(historyDebounceTimer);
  historyDebounceTimer = window.setTimeout(pushHistoryIfChanged, HISTORY_DEBOUNCE_MS);
}

/** プログラムからvalueを直接書き換える(よく使う記法挿入など)直前・直後に呼ぶ。
 * 直前までの編集をいったん確定させてから変更するため、1回のUndoでちょうど
 * その挿入だけを取り消せるようになる。 */
function flushHistoryCommit(): void {
  if (historyDebounceTimer) {
    window.clearTimeout(historyDebounceTimer);
    historyDebounceTimer = undefined;
  }
  pushHistoryIfChanged();
}

function applyHistoryValue(value: string): void {
  const pos = value.length;
  inputEl.value = value;
  inputEl.setSelectionRange(pos, pos);
  inputEl.focus();
  historyBaseline = value;
  resetAutoClosedTracking();
  refreshInputOverlay();
  updateSourceButtonState();
  updateDirtyFromContent();
  renderPreview();
}

function undo(): void {
  flushHistoryCommit();
  const prev = undoStack.pop();
  if (prev === undefined) return;
  redoStack.push(inputEl.value);
  applyHistoryValue(prev);
}

function redo(): void {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(inputEl.value);
  applyHistoryValue(next);
}

// ---------------------------------------------------------------------------
// リアルタイムプレビュー (デバウンス付き)
// ---------------------------------------------------------------------------

let debounceTimer: number | undefined;

function scheduleRender(): void {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(renderPreview, 120);
}

function renderPreview(): void {
  const numbered = splitLinesWithNumbers(inputEl.value);
  if (numbered.length === 0) {
    previewEl.innerHTML = '';
    lastComposed = null;
    setButtonsEnabled(false);
    setStatus('');
    updateGutter(new Set());
    return;
  }
  try {
    const composed = composeSvg(
      numbered.map((n) => n.text),
      currentOptions(),
    );
    lastComposed = composed;
    previewEl.innerHTML = composed.svg;
    setButtonsEnabled(true);
    const errorLineNumbers = new Set(composed.errorLines.flatMap((idx) => numbered[idx].lineNumbers));
    updateGutter(errorLineNumbers);
    if (errorLineNumbers.size > 0) {
      // 複数行にエラーがあっても最初の1件だけを詳細表示する(ステータス欄は1行のため)。
      // 「未定義コマンド」はMathJaxの生メッセージが "Undefined control sequence \hoge"
      // という決まった形式で来るため、コマンド名部分だけ取り出して専用の文言に載せる。
      // それ以外の構文エラーは、生メッセージをそのまま添えた汎用文言にフォールバックする。
      const firstErrorIdx = composed.errorLines[0];
      const firstLineNumber = numbered[firstErrorIdx]?.lineNumbers[0];
      const rawMessage = composed.errorMessages.get(firstErrorIdx);
      const undefinedMatch = rawMessage?.match(/Undefined control sequence (\\[a-zA-Z]+)/);
      if (firstLineNumber !== undefined && undefinedMatch) {
        setStatus(t('status.undefinedCommand', { line: firstLineNumber, command: undefinedMatch[1], count: errorLineNumbers.size }), 'err');
      } else if (firstLineNumber !== undefined && rawMessage) {
        setStatus(t('status.syntaxErrorDetail', { line: firstLineNumber, message: rawMessage, count: errorLineNumbers.size }), 'err');
      } else {
        setStatus(t('status.syntaxErrors', { count: errorLineNumbers.size }), 'err');
      }
    } else if (composed.loadingLines.length > 0) {
      // CJKフォント読み込み中(構文エラーではない)。読み込み完了後は
      // setCJKFontReadyListener 経由で自動的に再レンダリングされる。
      setStatus(t('status.loadingCjkFont'));
    } else {
      setStatus('');
    }
  } catch (e) {
    setStatus(t('status.error', { message: e instanceof Error ? e.message : String(e) }), 'err');
  }
}

// ---------------------------------------------------------------------------
// 書き出しボタンの有効/無効の管理
// ---------------------------------------------------------------------------
let hasPreview = false;
let hasSourceText = false;
let exportBusy = false;

function refreshExportButtons(): void {
  const previewDisabled = exportBusy || !hasPreview;
  btnCopy.disabled = previewDisabled;
  btnSave.disabled = previewDisabled;

  const sourceDisabled = exportBusy || !hasSourceText;
  btnSaveSource.disabled = sourceDisabled;
  btnSaveAsTemplate.disabled = sourceDisabled;
}

function setButtonsEnabled(enabled: boolean): void {
  hasPreview = enabled;
  refreshExportButtons();
}

function setSourceButtonsEnabled(enabled: boolean): void {
  hasSourceText = enabled;
  refreshExportButtons();
}

function setExportBusy(busy: boolean): void {
  exportBusy = busy;
  refreshExportButtons();
}

// ---------------------------------------------------------------------------
// 書き出し (Rust側コマンドでSVG -> PNGのラスタライズ・クリップボード・保存を実行)
// ---------------------------------------------------------------------------
interface PendingExport {
  format: OutputFormat;
  svg: string;
  scale: number;
}

// ラスタライズ(PNG)はRust側でscale²倍のピクセルバッファをメモリ上に確保する。
// 文字サイズ(最大200px)×解像度倍率(最大8倍)を大きくした状態で長い行/複数行を
// 書き出すと、時間がかかったりメモリを大量消費したりし得るため、想定ピクセル数が
// 大きい場合は書き出し前に確認を挟む(UI上のソフトな警告。実際のハード上限はRust側にある)。
const MAX_EXPORT_PIXELS = 40_000_000; // 約40メガピクセル(RGBA想定で概ね160MB前後)

async function confirmLargeExport(scale: number): Promise<boolean> {
  if (!lastComposed) return true;
  const pixels = lastComposed.widthPx * scale * lastComposed.heightPx * scale;
  if (pixels <= MAX_EXPORT_PIXELS) return true;
  const mp = Math.round(pixels / 1_000_000);
  return await ask(t('export.confirmMessage', { mp }), { title: t('export.confirmTitle'), type: 'warning' });
}

/** 現在のプレビュー・設定から書き出しパラメータをまとめる。サイズが大きい場合は
 * 確認ダイアログを挟む。戻り値がnullの場合は「サイズ確認ダイアログでキャンセルされた」
 * ことを表す(エラーではない)。 */
async function preparePendingExport(): Promise<PendingExport | null> {
  if (!lastComposed) throw new Error(t('error.noPreview'));
  const format = formatEl.value as OutputFormat;
  const scale = getScale();
  if (format !== 'svg' && !(await confirmLargeExport(scale))) return null;
  return { format, svg: lastComposed.svg, scale };
}

/** 戻り値はコピーが実際に行われたか(サイズ確認でキャンセルされた場合はfalse)。 */
async function doCopy(): Promise<boolean> {
  if (exportBusy) return false;
  setExportBusy(true);
  try {
    const p = await preparePendingExport();
    if (!p) {
      setStatus(t('status.copyCancelled'));
      return false;
    }
    setStatus(t('status.copying'));
    if (p.format === 'svg') {
      await invoke('copy_text_to_clipboard', { text: p.svg });
      pushHistoryEntry('copySvgText');
    } else {
      await invoke('copy_export_to_clipboard', { svg: p.svg, format: p.format, scale: p.scale });
      pushHistoryEntry('copyImage');
    }
    setStatus(t('status.copied'), 'ok');
    return true;
  } catch (e) {
    setStatus(t('status.copyFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
    return false;
  } finally {
    setExportBusy(false);
  }
}

// ---------------------------------------------------------------------------
// 保存先ディレクトリの決定
// ---------------------------------------------------------------------------
// 「初回保存はEquashareホームディレクトリを既定値、2回目以降は直前に保存したディレクトリを
// 既定値にする」というルール。画像/ソースで別々には記憶せず共通で扱う。

/** "C:\a\b\c.png" でも "/a/b/c.png" でも、最後の区切り文字より前をディレクトリとして返す */
function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(0, idx) : '';
}

function joinPath(dir: string, filename: string): string {
  if (!dir) return filename;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? `${dir}${filename}` : `${dir}${sep}${filename}`;
}

function rememberDir(path: string): void {
  const dir = dirnameOf(path);
  if (dir) {
    lastSavedDir = dir;
    localStorage.setItem(LAST_DIR_KEY, dir);
  }
}

/** Equashareホームディレクトリを取得する(未取得ならOSのドキュメントフォルダを初期値として
 * 解決しキャッシュする)。設定でユーザーが変更した場合はそちらを優先する。 */
async function getHomeDirectory(): Promise<string> {
  if (homeDirCache) return homeDirCache;
  const dir = await documentDir();
  homeDirCache = dir;
  localStorage.setItem(HOME_DIR_KEY, dir);
  return dir;
}

async function defaultSaveDir(): Promise<string> {
  if (lastSavedDir) return lastSavedDir;
  return await getHomeDirectory();
}

async function doSave(): Promise<string | null> {
  if (exportBusy) return null;
  setExportBusy(true);
  try {
    const fmt = formatEl.value as OutputFormat;
    const dir = await defaultSaveDir();
    const defaultPath = joinPath(dir, `Equashare image.${fmt}`);
    const path = await save({
      filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }],
      defaultPath,
    });
    if (!path) return null;

    setStatus(t('status.saving'));
    const p = await preparePendingExport();
    if (!p) {
      setStatus(t('status.saveCancelled'));
      return null;
    }
    if (p.format === 'svg') {
      const bytes = Array.from(new TextEncoder().encode(p.svg));
      await invoke('save_bytes', { path, bytes });
    } else {
      await invoke('save_export_to_file', { svg: p.svg, format: p.format, scale: p.scale, path });
    }
    rememberDir(path);
    // 画像だけでは編集可能なLaTeXソースを復元できないため、未保存状態は維持する。
    setStatus(t('status.saved', { path }), 'ok');
    pushHistoryEntry('saveImage');
    return path;
  } finally {
    setExportBusy(false);
  }
}

/** 入力欄のLaTeXソースだけを .tex ファイルとして保存する。終了時フロー(確認する設定時の
 * 「ソース保存して終了」)もこの関数をそのまま呼び出す。 */
async function doSaveSource(): Promise<string | null> {
  if (exportBusy) return null;
  const text = inputEl.value;
  if (text.trim().length === 0) {
    setStatus(t('status.noSourceToSave'));
    return null;
  }
  setExportBusy(true);
  try {
    const dir = await defaultSaveDir();
    const defaultPath = joinPath(dir, 'Equashare tex.tex');
    const path = await save({
      filters: [{ name: 'TeX', extensions: ['tex'] }],
      defaultPath,
    });
    if (!path) return null;

    setStatus(t('status.savingSource'));
    const bytes = Array.from(new TextEncoder().encode(text));
    await invoke('save_bytes', { path, bytes });
    rememberDir(path);
    markContentClean(); // ソース保存で基準を更新し、未保存ポチを消す
    setStatus(t('status.sourceSaved', { path }), 'ok');
    pushHistoryEntry('saveSource');
    return path;
  } finally {
    setExportBusy(false);
  }
}

btnCopy.addEventListener('click', () => void doCopy());

// ---------------------------------------------------------------------------
// その他のコピー (Unicodeに変換 / MathML)
// ---------------------------------------------------------------------------
// btnCopyとは異なりSVGラスタライズを経由しないため、preparePendingExport()の
// サイズ確認フロー(confirmLargeExport)は不要。現在の入力欄をそのまま変換する。
function closeOtherCopyMenu(): void {
  otherCopyMenuEl.classList.add('hidden');
}

btnOtherCopy.addEventListener('click', (e) => {
  e.stopPropagation();
  otherCopyMenuEl.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!otherCopyMenuEl.classList.contains('hidden') && !otherCopyMenuEl.contains(e.target as Node) && e.target !== btnOtherCopy) {
    closeOtherCopyMenu();
  }
});

async function doCopyUnicode(): Promise<void> {
  if (exportBusy) return;
  const numbered = splitLinesWithNumbers(inputEl.value);
  if (numbered.length === 0) return;
  setExportBusy(true);
  try {
    setStatus(t('status.copying'));
    const text = composeUnicodeApprox(numbered.map((n) => n.text));
    await invoke('copy_text_to_clipboard', { text });
    setStatus(t('status.copiedUnicode'), 'ok');
    pushHistoryEntry('copyUnicode');
  } catch (e) {
    setStatus(t('status.copyFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
  } finally {
    setExportBusy(false);
  }
}

async function doCopyMathML(): Promise<void> {
  if (exportBusy) return;
  const numbered = splitLinesWithNumbers(inputEl.value);
  if (numbered.length === 0) return;
  setExportBusy(true);
  try {
    setStatus(t('status.copying'));
    const text = composeMathML(numbered.map((n) => n.text));
    await invoke('copy_text_to_clipboard', { text });
    setStatus(t('status.copiedMathML'), 'ok');
    pushHistoryEntry('copyMathML');
  } catch (e) {
    setStatus(t('status.copyFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
  } finally {
    setExportBusy(false);
  }
}

btnCopyUnicode.addEventListener('click', () => {
  closeOtherCopyMenu();
  void doCopyUnicode();
});
btnCopyMathML.addEventListener('click', () => {
  closeOtherCopyMenu();
  void doCopyMathML();
});

btnSave.addEventListener('click', () => void doSave().catch((e) => setStatus(t('status.saveFailed', { message: e instanceof Error ? e.message : String(e) }), 'err')));
btnSaveSource.addEventListener('click', () =>
  void doSaveSource().catch((e) => setStatus(t('status.sourceSaveFailed', { message: e instanceof Error ? e.message : String(e) }), 'err')),
);

function updateSourceButtonState(): void {
  setSourceButtonsEnabled(inputEl.value.trim().length > 0);
}

// ---------------------------------------------------------------------------
// よく使う記法 挿入 & サンプル/ユーザーテンプレート選択
// ---------------------------------------------------------------------------

/** テキストエリアのカーソル位置に文字列を挿入し、cursorOffsetFromEnd だけ末尾から
 * 戻した位置にカーソルを再配置する(例: "\frac{a}{b}" 挿入後、"a"を選択状態にする等)。 */
function insertAtCursor(text: string, cursorOffsetFromEnd = 0): void {
  flushHistoryCommit(); // 直前までの編集をここで一旦確定させる
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const before = inputEl.value.slice(0, start);
  const after = inputEl.value.slice(end);
  inputEl.value = `${before}${text}${after}`;
  const newPos = start + text.length - cursorOffsetFromEnd;
  inputEl.focus();
  inputEl.setSelectionRange(newPos, newPos);
  inputEl.dispatchEvent(new Event('input'));
  flushHistoryCommit(); // この挿入自体を単独のUndo単位として確定させる
}

/** カーソル位置が既存行の途中にある場合に改行を挟んでからブロックを挿入する
 * (サンプル/ユーザーテンプレートの挿入で共通して使うロジック)。 */
function insertBlockAtCursor(text: string): void {
  const caret = inputEl.selectionStart ?? inputEl.value.length;
  const beforeCaret = inputEl.value.slice(0, caret);
  const needsNewline = beforeCaret.length > 0 && !beforeCaret.endsWith('\n');
  insertAtCursor(`${needsNewline ? '\n' : ''}${text}`);
}

/** 選択中のテキストを before/after で囲む(例: \left( / \right) )。
 * 自動サイズ調整かっこボタンなど、選択範囲があるときに「その選択範囲を引数にする」
 * べきテンプレートボタン向け。カーソルは挿入結果全体の直後に置く。 */
function wrapSelectionWithTemplate(before: string, after: string): void {
  flushHistoryCommit();
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const head = inputEl.value.slice(0, start);
  const selected = inputEl.value.slice(start, end);
  const tail = inputEl.value.slice(end);
  inputEl.value = `${head}${before}${selected}${after}${tail}`;
  const newPos = start + before.length + selected.length + after.length;
  inputEl.focus();
  inputEl.setSelectionRange(newPos, newPos);
  inputEl.dispatchEvent(new Event('input'));
  flushHistoryCommit();
}

templateButtonsEl.addEventListener('click', (ev) => {
  const target = (ev.target as HTMLElement).closest('button.tmpl') as HTMLButtonElement | null;
  if (!target) return;
  const hasSelection = (inputEl.selectionStart ?? 0) !== (inputEl.selectionEnd ?? 0);
  const wrapBefore = target.dataset.wrapBefore;
  const wrapAfter = target.dataset.wrapAfter;
  if (hasSelection && wrapBefore !== undefined && wrapAfter !== undefined) {
    wrapSelectionWithTemplate(wrapBefore, wrapAfter);
  } else {
    const insert = target.dataset.insert ?? '';
    const cursor = Number(target.dataset.cursor ?? '0');
    insertAtCursor(insert, cursor);
  }
  closeEqMenu(); // ドロップダウン内の項目を選んだ場合はメニューを閉じる
});

// ---------------------------------------------------------------------------
// 比較演算子ドロップダウン(=ボタン): ホバー(CSS)に加え、キーボード操作にも対応
// ---------------------------------------------------------------------------

const eqDropdownEl = $<HTMLDivElement>('eqDropdown');
const eqTrigger = $<HTMLButtonElement>('eqTrigger');
const eqMenu = $<HTMLDivElement>('eqMenu');

function positionEqMenu(): void {
  const rect = eqTrigger.getBoundingClientRect();
  eqMenu.style.left = `${Math.round(rect.left)}px`;
  eqMenu.style.top = `${Math.round(rect.bottom + 4)}px`;
}

function openEqMenu(): void {
  positionEqMenu();
  eqMenu.classList.add('open');
  eqTrigger.setAttribute('aria-expanded', 'true');
}
function closeEqMenu(): void {
  eqMenu.classList.remove('open');
  eqTrigger.setAttribute('aria-expanded', 'false');
}

eqTrigger.addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (eqMenu.classList.contains('open')) {
    closeEqMenu();
  } else {
    openEqMenu();
  }
});
eqTrigger.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    openEqMenu();
    eqMenu.querySelector('button')?.focus();
  }
});
eqDropdownEl.addEventListener('mouseenter', openEqMenu);
eqDropdownEl.addEventListener('mouseleave', closeEqMenu);
document.addEventListener('click', (ev) => {
  if (!eqTrigger.contains(ev.target as Node) && !eqMenu.contains(ev.target as Node)) {
    closeEqMenu();
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeEqMenu();
});

sampleSelect.addEventListener('change', () => {
  const value = sampleSelect.value;
  if (!value) return;
  insertBlockAtCursor(value);
  sampleSelect.value = '';
});

userTemplateSelect.addEventListener('change', () => {
  const name = userTemplateSelect.value;
  if (!name) return;
  const templates = loadTemplates();
  const source = templates[name];
  if (source !== undefined) {
    insertBlockAtCursor(source);
  }
  userTemplateSelect.value = '';
});

// ---------------------------------------------------------------------------
// ユーザーテンプレート (保存はlocalStorage。Equashareホームディレクトリとは分離)
// ---------------------------------------------------------------------------

type StoredTemplates = Record<string, string>;

// v4.0: テンプレートはメモリ上のキャッシュを正として同期的に読み書きし(既存の
// loadTemplates()/saveTemplatesMap()呼び出し側は一切変更しない)、実ファイルへの
// 反映だけを裏で非同期に行う。キャッシュはensureTemplatesLoaded()でアプリ起動時に
// 一度だけディスクから読み込む(以降はloadTemplates()が返す参照を直接書き換えて
// saveTemplatesMap()を呼ぶ、という既存コードの流儀にそのまま乗せる)。
let templatesCache: StoredTemplates = {};
let templatesCacheReady: Promise<void> | null = null;

async function templatesFilePath(): Promise<string> {
  return pathJoin(await appDataDir(), TEMPLATES_FILENAME);
}

/** ディスク上のtemplates.jsonを読み込みtemplatesCacheへ反映する。アプリ起動時に
 * 一度だけ呼ばれる想定。ファイルが存在しない(初回起動)場合は空のテンプレート集合
 * として扱い、エラー表示はしない。JSON破損や権限エラー等、本当の異常時のみ
 * ステータス表示する。 */
async function ensureTemplatesLoaded(): Promise<void> {
  if (!templatesCacheReady) {
    templatesCacheReady = (async () => {
      try {
        const path = await templatesFilePath();
        const raw = await invoke<string | null>('read_text_file', { path });
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            templatesCache = parsed;
          }
        }
      } catch (e) {
        setStatus(t('status.templatesLoadFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
      }
    })();
  }
  return templatesCacheReady;
}

/** templatesCacheの現在の内容をtemplates.jsonへ書き込む(fire-and-forget呼び出し
 * 前提。呼び出し側はawaitしない)。失敗してもキャッシュ自体は既に更新済みなので
 * アプリの見た目上は正常に動作し続けるが、次回起動時にその変更が失われる可能性を
 * ステータス表示で知らせる。 */
async function persistTemplatesToDisk(): Promise<void> {
  try {
    const path = await templatesFilePath();
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(templatesCache, null, 2)));
    await invoke('save_bytes', { path, bytes });
  } catch (e) {
    setStatus(t('status.templatesSaveFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
  }
}

function loadTemplates(): StoredTemplates {
  return templatesCache;
}

function saveTemplatesMap(templates: StoredTemplates): void {
  templatesCache = templates;
  void persistTemplatesToDisk();
}

function refreshUserTemplateSelect(): void {
  const templates = loadTemplates();
  const names = Object.keys(templates).sort((a, b) => a.localeCompare(b, 'ja'));
  userTemplateSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = t('toolbar.userTemplateSelect.placeholder');
  userTemplateSelect.appendChild(placeholder);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    userTemplateSelect.appendChild(opt);
  }
}

function nextDefaultTemplateName(templates: StoredTemplates): string {
  let n = 1;
  while (t('templateNamePrompt.defaultName', { n }) in templates) n++;
  return t('templateNamePrompt.defaultName', { n });
}

/** 名前が衝突する場合、末尾に連番を振って一意な名前を作る
 * (デフォルト値「テンプレートN」・ユーザーが手入力した任意の名前のどちらにも同じロジックを適用する)。
 * 「現在のソースをテンプレートとして保存」は常に新規追加であり、既存テンプレートを上書きしない
 * (既存テンプレートの内容更新は設定内「テンプレートを管理」の編集機能で行う)。 */
function uniqueTemplateName(base: string, templates: StoredTemplates): string {
  if (!(base in templates)) return base;
  const m = base.match(/^(.*?)(\d+)$/);
  const prefix = m ? m[1] : base;
  let n = m ? Number(m[2]) + 1 : 2;
  let candidate = `${prefix}${n}`;
  while (candidate in templates) {
    n++;
    candidate = `${prefix}${n}`;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// サジェスト機能 (\ 入力でLaTeXコマンド候補をポップアップ表示)
// ---------------------------------------------------------------------------
// 候補の出所は「アプリが対応しているLaTeXコマンド一覧」+「入力欄内で\newcommand等により
// 定義されたマクロ名」の2つ。前者はここに静的に列挙する(mathRender.ts側のMATH_PACKAGES
// [base/ams/boldsymbol/color/mathtools/newcommand]でよく使われる代表的なコマンド)。
const KNOWN_LATEX_COMMANDS: string[] = [
  '\\frac', '\\dfrac', '\\cfrac', '\\sqrt', '\\sum', '\\prod', '\\int', '\\iint', '\\iiint', '\\oint',
  '\\lim', '\\liminf', '\\limsup', '\\infty', '\\partial', '\\nabla',
  '\\pm', '\\mp', '\\times', '\\div', '\\cdot', '\\ast', '\\star', '\\circ', '\\bullet',
  '\\leq', '\\geq', '\\neq', '\\approx', '\\equiv', '\\sim', '\\simeq', '\\propto', '\\cong',
  '\\in', '\\notin', '\\subset', '\\subseteq', '\\supset', '\\supseteq', '\\cup', '\\cap',
  '\\setminus', '\\emptyset', '\\varnothing',
  '\\forall', '\\exists', '\\nexists', '\\therefore', '\\because',
  '\\rightarrow', '\\leftarrow', '\\Rightarrow', '\\Leftarrow', '\\leftrightarrow', '\\Leftrightarrow',
  '\\mapsto', '\\to', '\\gets', '\\xrightarrow', '\\xleftarrow',
  '\\overrightarrow', '\\overleftarrow', '\\vec', '\\hat', '\\bar', '\\dot', '\\ddot', '\\tilde',
  '\\underset', '\\overset', '\\underbrace', '\\overbrace', '\\substack',
  '\\mathbb', '\\mathbf', '\\mathrm', '\\mathit', '\\mathcal', '\\mathfrak', '\\boldsymbol',
  '\\text', '\\textbf', '\\textit', '\\textrm', '\\textcolor', '\\color', '\\colorbox',
  '\\begin', '\\end', '\\left', '\\right', '\\big', '\\Big', '\\bigg', '\\Bigg',
  '\\binom', '\\choose', '\\pmod', '\\bmod',
  '\\det', '\\dim', '\\exp', '\\gcd', '\\hom', '\\ker', '\\log', '\\ln',
  '\\max', '\\min', '\\sup', '\\inf', '\\arg', '\\deg',
  '\\sin', '\\cos', '\\tan', '\\cot', '\\sec', '\\csc',
  '\\sinh', '\\cosh', '\\tanh', '\\arcsin', '\\arccos', '\\arctan',
  '\\newcommand', '\\renewcommand', '\\providecommand', '\\DeclareMathOperator',
  '\\dots', '\\ldots', '\\cdots', '\\vdots', '\\ddots',
  '\\angle', '\\perp', '\\parallel', '\\wedge', '\\vee', '\\oplus', '\\ominus', '\\otimes',
  // v3.0: サジェストの二重表示(bare + 添字/上付き付き)対象を、指示書に挙げられた
  // インテグラル/シグマ/ラージパイ以外の類似コマンドにも広げるための追加分。
  '\\bigcup', '\\bigcap', '\\bigvee', '\\bigwedge', '\\bigoplus', '\\bigotimes', '\\bigodot', '\\bigsqcup', '\\coprod',
  '\\langle', '\\rangle', '\\lceil', '\\rceil', '\\lfloor', '\\rfloor',
  '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\varepsilon', '\\zeta', '\\eta',
  '\\theta', '\\vartheta', '\\iota', '\\kappa', '\\lambda', '\\mu', '\\nu', '\\xi', '\\pi', '\\varpi',
  '\\rho', '\\varrho', '\\sigma', '\\varsigma', '\\tau', '\\upsilon', '\\phi', '\\varphi', '\\chi',
  '\\psi', '\\omega',
  '\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Xi', '\\Pi', '\\Sigma', '\\Upsilon', '\\Phi', '\\Psi', '\\Omega',
];

/** サジェスト候補1件。labelが表示文字列、insertTextが実際に挿入する文字列
 * (v3.0以降、両者は常に一致させる=「サジェストにカッコやアンダーバーを表示」)。
 * cursorOffsetFromEndは挿入完了後、挿入文字列の末尾から何文字戻った位置に
 * キャレットを置くか(0なら末尾)。 */
interface SuggestEntry {
  label: string;
  insertText: string;
  cursorOffsetFromEnd: number;
  isUserMacro: boolean;
}

let suggestItems: SuggestEntry[] = [];
let suggestActiveIndex = -1;

// サジェスト確定時、コマンドによっては空の{}(引数の数だけ)を自動的に補い、
// キャレットを最初の{}の中へ置く(例: \frac を選択 → \frac{}{}、カーソルは最初の{}内)。
// ここに掲載していないコマンド(記号・ギリシャ文字・\left/\right等の区切り文字・
// \sin/\log等の演算子名のように、そもそも{}引数を取らないもの)は従来通り
// コマンド名だけを挿入する。ユーザー定義マクロ(\newcommandで定義したもの)は
// 実際の引数の数を静的に判定できないため対象外。
const SUGGEST_BRACE_ARG_COUNTS: Record<string, number> = {
  // 2引数
  '\\frac': 2, '\\dfrac': 2, '\\cfrac': 2, '\\binom': 2,
  '\\underset': 2, '\\overset': 2, '\\textcolor': 2, '\\colorbox': 2,
  '\\newcommand': 2, '\\renewcommand': 2, '\\providecommand': 2, '\\DeclareMathOperator': 2,
  // 1引数
  '\\sqrt': 1, '\\vec': 1, '\\hat': 1, '\\bar': 1, '\\dot': 1, '\\ddot': 1, '\\tilde': 1,
  '\\overrightarrow': 1, '\\overleftarrow': 1, '\\underbrace': 1, '\\overbrace': 1, '\\substack': 1,
  '\\mathbb': 1, '\\mathbf': 1, '\\mathrm': 1, '\\mathit': 1, '\\mathcal': 1, '\\mathfrak': 1, '\\boldsymbol': 1,
  '\\text': 1, '\\textbf': 1, '\\textit': 1, '\\textrm': 1, '\\color': 1,
  '\\begin': 1, '\\end': 1, '\\pmod': 1, '\\xrightarrow': 1, '\\xleftarrow': 1,
};
// v3.0: インテグラル/シグマ/ラージパイ等、上下(または下)に極限・範囲を書く大型演算子。
// bare(\int)に加えて、添字+上付き(\int_{}^{})の2件をサジェストに表示する。
const SUGGEST_BIGOP_COMMANDS = new Set<string>([
  '\\int', '\\iint', '\\iiint', '\\oint',
  '\\sum', '\\prod', '\\coprod',
  '\\bigcup', '\\bigcap', '\\bigvee', '\\bigwedge', '\\bigoplus', '\\bigotimes', '\\bigodot', '\\bigsqcup',
]);
// v3.0: \lim系・\max/\min/\sup/\infのように、下付き(範囲・条件)だけを添えるのが一般的な
// コマンド。bare + 添字(\lim_{})の2件を表示する。
const SUGGEST_LIMIT_COMMANDS = new Set<string>(['\\lim', '\\liminf', '\\limsup', '\\max', '\\min', '\\sup', '\\inf']);
let suggestQueryStart = -1;
let suppressNextSuggest = false;

/** コマンド名(例: "\\int")から、そのコマンドに対応するSuggestEntry(1件または2件)を作る。 */
function buildSuggestEntriesForCommand(cmd: string, isUserMacro: boolean): SuggestEntry[] {
  if (isUserMacro) {
    return [{ label: cmd, insertText: cmd, cursorOffsetFromEnd: 0, isUserMacro: true }];
  }
  if (SUGGEST_BIGOP_COMMANDS.has(cmd)) {
    return [
      { label: cmd, insertText: cmd, cursorOffsetFromEnd: 0, isUserMacro: false },
      { label: `${cmd}_{}^{}`, insertText: `${cmd}_{}^{}`, cursorOffsetFromEnd: 4, isUserMacro: false },
    ];
  }
  if (SUGGEST_LIMIT_COMMANDS.has(cmd)) {
    return [
      { label: cmd, insertText: cmd, cursorOffsetFromEnd: 0, isUserMacro: false },
      { label: `${cmd}_{}`, insertText: `${cmd}_{}`, cursorOffsetFromEnd: 1, isUserMacro: false },
    ];
  }
  const argCount = SUGGEST_BRACE_ARG_COUNTS[cmd] ?? 0;
  if (argCount > 0) {
    const braces = '{}'.repeat(argCount);
    return [{ label: `${cmd}${braces}`, insertText: `${cmd}${braces}`, cursorOffsetFromEnd: braces.length - 1, isUserMacro: false }];
  }
  return [{ label: cmd, insertText: cmd, cursorOffsetFromEnd: 0, isUserMacro: false }];
}

function isSuggestEnabled(): boolean {
  return (localStorage.getItem(SUGGEST_KEY) ?? 'on') !== 'off';
}

function isDefaultTextEnabled(): boolean {
  return (localStorage.getItem(DEFAULT_TEXT_KEY) ?? 'on') !== 'off';
}

function isBracketWrapSelectionEnabled(): boolean {
  return (localStorage.getItem(BRACKET_WRAP_SELECTION_KEY) ?? 'on') !== 'off';
}

/** 入力欄でTabキーを押した際に挿入するスペースの数。未設定時は2。 */
function getTabSize(): number {
  const v = localStorage.getItem(TAB_SIZE_KEY);
  return v === null ? 2 : clampedNumber(v, 2, TAB_SIZE_MIN, TAB_SIZE_MAX);
}

/** 入力欄内で \newcommand / \renewcommand / \providecommand / \DeclareMathOperator(*)
 * により定義されたマクロ名を、セッション内の候補として動的に拾う。 */
function collectUserMacroNames(): string[] {
  const names = new Set<string>();
  const re = /\\(?:newcommand|renewcommand|providecommand)\{(\\[a-zA-Z]+)\}|\\DeclareMathOperator\*?\{(\\[a-zA-Z]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inputEl.value))) {
    const name = m[1] ?? m[2];
    if (name) names.add(name);
  }
  return Array.from(names);
}

/** カーソル直前が「\」+ 0文字以上の英字、で終わっている場合にその範囲を返す。
 * 範囲選択中(selectionStart !== selectionEnd)はサジェスト対象外。 */
function currentSuggestQuery(): { partial: string; start: number } | null {
  const start = inputEl.selectionStart;
  const end = inputEl.selectionEnd;
  if (start === null || end === null || start !== end) return null;
  const before = inputEl.value.slice(0, start);
  const m = before.match(/\\[a-zA-Z]*$/);
  if (!m) return null;
  return { partial: m[0], start: start - m[0].length };
}

// キャレット/文字セルのピクセル位置は「1文字の幅 × 桁数」という手計算ではなく、
// 非表示のミラー要素(textarea#inputと同一のフォント・余白・折り返し設定を複製したdiv)に
// 実際に文字を流し込み、ブラウザ自身のテキストレイアウト結果を測定する方式にする。
// 手計算だと半角と全角が混在する行・合字(リガチャ)を持つフォント・サブピクセル丸めなど
// 「1文字=1桁固定幅」という前提が崩れるあらゆる場面でズレるため、実測に置き換えて
// そのクラスの誤差を丸ごと無くす(v4.0.1)。
let caretMirrorEl: HTMLDivElement | null = null;
let caretMirrorMarkerEl: HTMLSpanElement | null = null;

const CARET_MIRROR_STYLE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantLigatures',
  'letterSpacing', 'wordSpacing', 'textTransform', 'lineHeight', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'boxSizing',
] as const satisfies readonly (keyof CSSStyleDeclaration)[];

function ensureCaretMirror(): { mirror: HTMLDivElement; marker: HTMLSpanElement } {
  if (caretMirrorEl && caretMirrorMarkerEl) {
    return { mirror: caretMirrorEl, marker: caretMirrorMarkerEl };
  }
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '0';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre';
  mirror.style.overflowWrap = 'normal';
  mirror.style.wordBreak = 'normal';
  mirror.style.overflow = 'hidden';
  const marker = document.createElement('span');
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  caretMirrorEl = mirror;
  caretMirrorMarkerEl = marker;
  return { mirror, marker };
}

function syncCaretMirrorStyle(mirror: HTMLDivElement): void {
  const style = window.getComputedStyle(inputEl);
  for (const prop of CARET_MIRROR_STYLE_PROPS) {
    // CSSStyleDeclarationの個々のプロパティはstring型だが、TSの型定義上は
    // string | number | null 等を許容するインデックス型になっていないため、
    // ここだけanyを介して代入する(実行時は常にstringが入る)。
    (mirror.style as unknown as Record<string, string>)[prop] = style[prop] as string;
  }
  mirror.style.width = `${inputEl.clientWidth}px`;
}

/** 文字インデックス(0始まり)の位置を、ミラー要素上へ実際にテキストを流し込んで実測する。
 * markerには対象の1文字(行末や末尾など次の文字が無い場合はゼロ幅スペースで代用)を
 * 入れるため、marker.offsetLeft/offsetTopが「index文字目の左上」、
 * marker.offsetWidth/offsetHeightが「その1文字のセルの幅・高さ」に一致する。 */
function measureCaretMirror(index: number): { left: number; top: number; width: number; height: number } {
  const { mirror, marker } = ensureCaretMirror();
  syncCaretMirrorStyle(mirror);
  const value = inputEl.value;
  const clampedIndex = Math.max(0, Math.min(index, value.length));
  const before = value.slice(0, clampedIndex);
  const rawChar = value[clampedIndex];
  // 行末(次が'\n'または存在しない)ではゼロ幅スペースを仮に置いて幅0扱いにならないよう
  // 高さだけは常に正しく測れるようにする。改行そのものをmarkerに入れるとdivの折り返し
  // 判定を乱すため避ける。
  const markerChar = rawChar === undefined || rawChar === '\n' ? '\u200b' : rawChar;
  const after = rawChar === undefined ? '' : value.slice(clampedIndex + 1);
  marker.textContent = markerChar;
  while (mirror.firstChild !== marker) mirror.removeChild(mirror.firstChild as ChildNode);
  while (mirror.lastChild !== marker) mirror.removeChild(mirror.lastChild as ChildNode);
  mirror.insertBefore(document.createTextNode(before), marker);
  mirror.appendChild(document.createTextNode(after));
  const lineHeight = parseFloat(window.getComputedStyle(inputEl).lineHeight || '0') || marker.offsetHeight;
  return {
    left: marker.offsetLeft,
    top: marker.offsetTop,
    width: markerChar === '\u200b' ? 0 : marker.offsetWidth,
    height: marker.offsetHeight || lineHeight,
  };
}

/** キャレット(index文字目の直前)のクライアント座標を返す。サジェストポップアップの
 * 表示位置決めに使うため、文字セルの「下端」(次の行の先頭相当)を返す。 */
function getCaretClientPosition(index: number): { left: number; top: number } {
  const rect = inputEl.getBoundingClientRect();
  const style = window.getComputedStyle(inputEl);
  const borderLeft = parseFloat(style.borderLeftWidth || '0');
  const borderTop = parseFloat(style.borderTopWidth || '0');
  const m = measureCaretMirror(index);
  return {
    left: rect.left + borderLeft + m.left - inputEl.scrollLeft,
    top: rect.top + borderTop + m.top + m.height - inputEl.scrollTop,
  };
}

/** 文字インデックスの位置にある「1文字分のセル」の矩形(左上座標+幅+高さ)を求める。
 * 括弧のアクティブペアハイライト(2.2)で、特定の1文字を枠線で囲むために使う。 */
function getCharCellRect(index: number): { left: number; top: number; width: number; height: number } {
  const rect = inputEl.getBoundingClientRect();
  const style = window.getComputedStyle(inputEl);
  const borderLeft = parseFloat(style.borderLeftWidth || '0');
  const borderTop = parseFloat(style.borderTopWidth || '0');
  const m = measureCaretMirror(index);
  return {
    left: rect.left + borderLeft + m.left - inputEl.scrollLeft,
    top: rect.top + borderTop + m.top - inputEl.scrollTop,
    width: m.width,
    height: m.height,
  };
}

function closeSuggestPopup(): void {
  if (suggestPopupEl.classList.contains('hidden')) return;
  suggestPopupEl.classList.add('hidden');
  suggestItems = [];
  suggestActiveIndex = -1;
}

// ---------------------------------------------------------------------------
// 括弧の対応表示(色分け+アクティブペア)・自動補完 (2.1/2.2/2.3)
// ---------------------------------------------------------------------------

const BRACKET_PAIRS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
const BRACKET_OPENERS = new Set(Object.keys(BRACKET_PAIRS));
const BRACKET_CLOSERS = new Set(Object.values(BRACKET_PAIRS));
const BRACKET_DEPTH_CLASS_COUNT = 3;

interface BracketPair {
  open: number;
  close: number;
}

interface BracketAnalysis {
  /** 括弧1文字ごとのCSSクラス名 (bracket-depth-0/1/2 または bracket-unmatched)。 */
  classAt: Map<number, string>;
  /** 対応が取れたペアのみ(未対応の括弧は含まない)。 */
  pairs: BracketPair[];
}

/** テキスト全体を1回走査し、(){}[] の対応関係を解析する。
 * 深さはカッコの種類を問わず共通の1本のスタックで数える(VSCodeのbracket pair
 * colorizationと同様、種類ごとに独立した深さは持たない)。
 * 対応しない閉じ括弧(スタック最上段と種類が違う/スタックが空)はその場で
 * unmatchedとし、スタックはpopしない。最後まで閉じられなかった開き括弧も
 * unmatchedとして扱う。 */
function analyzeBrackets(text: string): BracketAnalysis {
  const classAt = new Map<number, string>();
  const pairs: BracketPair[] = [];
  const stack: Array<{ ch: string; index: number }> = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (BRACKET_OPENERS.has(ch)) {
      stack.push({ ch, index: i });
    } else if (BRACKET_CLOSERS.has(ch)) {
      const top = stack[stack.length - 1];
      if (top && BRACKET_PAIRS[top.ch] === ch) {
        stack.pop();
        const depth = stack.length % BRACKET_DEPTH_CLASS_COUNT;
        const cls = `bracket-depth-${depth}`;
        classAt.set(top.index, cls);
        classAt.set(i, cls);
        pairs.push({ open: top.index, close: i });
      } else {
        classAt.set(i, 'bracket-unmatched');
      }
    }
  }
  for (const leftover of stack) {
    classAt.set(leftover.index, 'bracket-unmatched');
  }
  return { classAt, pairs };
}

function escapeHtmlForOverlay(ch: string): string {
  if (ch === '&') return '&amp;';
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  return ch;
}

let lastBracketAnalysis: BracketAnalysis = { classAt: new Map(), pairs: [] };

/** #inputOverlayの中身(括弧の色分け情報)を再構築する。inputイベントのたびに呼ぶ。 */
function renderInputOverlay(): void {
  const text = inputEl.value;
  lastBracketAnalysis = analyzeBrackets(text);
  const { classAt } = lastBracketAnalysis;
  let html = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const escaped = escapeHtmlForOverlay(ch);
    const cls = classAt.get(i);
    html += cls ? `<span class="${cls}">${escaped}</span>` : escaped;
  }
  inputOverlayEl.innerHTML = html;
}

/** textareaのscrollTop/scrollLeftと#inputOverlayの表示位置を1:1で同期させる。 */
function syncInputOverlayScroll(): void {
  inputOverlayEl.scrollTop = inputEl.scrollTop;
  inputOverlayEl.scrollLeft = inputEl.scrollLeft;
}

/** キャレット位置(caret)から、ハイライト対象の括弧ペアを1つ選ぶ。
 * 優先順位: キャレット直後の文字 → キャレット直前の文字 → キャレットを内包する
 * 最も内側のペア。対応が無い(unmatched)括弧が直後/直前にある場合は、単独ハイライト
 * 用に isUnmatched=true でその1文字だけを返す。 */
function findActiveBracketTarget(
  analysis: BracketAnalysis,
  caret: number,
): { open: number; close: number | null; isUnmatched: boolean } | null {
  const byIndex = (idx: number): BracketPair | undefined =>
    analysis.pairs.find((p) => p.open === idx || p.close === idx);

  for (const idx of [caret, caret - 1]) {
    const pair = byIndex(idx);
    if (pair) return { open: pair.open, close: pair.close, isUnmatched: false };
    if (analysis.classAt.get(idx) === 'bracket-unmatched') {
      return { open: idx, close: null, isUnmatched: true };
    }
  }

  // 隣接する括弧が無ければ、キャレットを内包する最も内側の(=openが最大の)ペアを探す。
  let innermost: BracketPair | null = null;
  for (const p of analysis.pairs) {
    if (p.open < caret && caret <= p.close) {
      if (!innermost || p.open > innermost.open) innermost = p;
    }
  }
  if (innermost) return { open: innermost.open, close: innermost.close, isUnmatched: false };
  return null;
}

function hideBracketHighlight(el: HTMLDivElement): void {
  el.classList.add('hidden');
}

/** ハイライト対象の矩形がtextareaの可視範囲(縦方向)に収まっているかどうか。
 * 複数行にまたがる括弧ペアの開き括弧側が画面外へスクロールアウトしている場合など、
 * textareaの外に無関係な位置でハイライト枠だけが浮いて見えるのを防ぐ。 */
function isVerticallyWithinInput(rect: { top: number; height: number }): boolean {
  const inputRect = inputEl.getBoundingClientRect();
  return rect.top >= inputRect.top && rect.top + rect.height <= inputRect.bottom;
}

/** 指定インデックスの文字にハイライト枠を配置する。可視範囲外なら表示しない。 */
function positionBracketHighlight(el: HTMLDivElement, charIndex: number, unmatched: boolean): void {
  const rect = getCharCellRect(charIndex);
  if (!isVerticallyWithinInput(rect)) {
    hideBracketHighlight(el);
    return;
  }
  el.style.left = `${Math.round(rect.left)}px`;
  el.style.top = `${Math.round(rect.top)}px`;
  el.style.width = `${Math.round(rect.width)}px`;
  el.style.height = `${Math.round(rect.height)}px`;
  el.classList.toggle('bracket-highlight-unmatched', unmatched);
  el.classList.remove('hidden');
}

/** キャレットが括弧に隣接/内包されている場合、その括弧(と対になる括弧があればその両方)を
 * 枠線で囲む。フォーカスが外れている間は表示しない。 */
function updateActiveBracketHighlight(): void {
  if (document.activeElement !== inputEl) {
    hideBracketHighlight(bracketHighlightAEl);
    hideBracketHighlight(bracketHighlightBEl);
    return;
  }
  const caret = inputEl.selectionStart;
  const selEnd = inputEl.selectionEnd;
  // 範囲選択中はどの1点をキャレットとみなすか曖昧になるため、対象なしとして隠す。
  if (caret === null || selEnd === null || caret !== selEnd) {
    hideBracketHighlight(bracketHighlightAEl);
    hideBracketHighlight(bracketHighlightBEl);
    return;
  }
  const target = findActiveBracketTarget(lastBracketAnalysis, caret);
  if (!target) {
    hideBracketHighlight(bracketHighlightAEl);
    hideBracketHighlight(bracketHighlightBEl);
    return;
  }
  positionBracketHighlight(bracketHighlightAEl, target.open, target.isUnmatched);
  if (target.close !== null) {
    positionBracketHighlight(bracketHighlightBEl, target.close, target.isUnmatched);
  } else {
    hideBracketHighlight(bracketHighlightBEl);
  }
}

/** #inputOverlayの再描画とアクティブ括弧ハイライトの更新をまとめて行う共通関数。
 * inputEl.valueを書き換える経路(inputイベント/Undo/Redo/初期化等)すべてから呼ぶ。 */
function refreshInputOverlay(): void {
  renderInputOverlay();
  // ガターの行数(=高さ)はrenderPreview()のデバウンス(120ms)を待たず、テキスト内容と
  // 同期して即座に更新する。エラー行の色付け自体は直近の判定結果を維持し、デバウンス後の
  // renderPreview()が確定させ次第updateGutter()経由で更新される。
  updateGutter();
  updateActiveBracketHighlight();
}

// --- 括弧の自動補完 (2.3) -----------------------------------------------
// 「選択範囲を括弧で囲む」動作のみ設定でON/OFFできる。自動挿入・素通りスキップの
// 2つは常時有効。

/** 直近で自動挿入され、まだユーザーが「タイプオーバー」していない閉じ括弧の
 * 文字インデックス一覧。input イベントのたびに、その回の編集で置き換わった範囲との
 * 前後関係から差分(挿入/削除された文字数)を計算してインデックスを補正する。
 * 編集範囲に重なった位置は「もう自動挿入直後の状態ではない」とみなして破棄する。 */
let autoClosedPositions: number[] = [];
let previousInputValue = '';

function adjustAutoClosedPositions(oldValue: string, newValue: string): void {
  if (oldValue === newValue || autoClosedPositions.length === 0) return;
  let prefix = 0;
  const maxPrefix = Math.min(oldValue.length, newValue.length);
  while (prefix < maxPrefix && oldValue[prefix] === newValue[prefix]) prefix++;
  let oldSuffix = oldValue.length;
  let newSuffix = newValue.length;
  while (oldSuffix > prefix && newSuffix > prefix && oldValue[oldSuffix - 1] === newValue[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }
  const delta = newSuffix - prefix - (oldSuffix - prefix);
  // pos < prefix: 編集より前で不変。pos >= oldSuffix: 編集より後でdelta分シフト。
  // その間([prefix, oldSuffix))は今回の編集で書き換わった範囲なので追跡を打ち切る。
  // (境界のpos===prefixを「不変」側に含めてしまうと、挿入位置ちょうどにあった追跡対象が
  // 補正されずズレるバグになるため、必ずpos < prefixで判定すること。)
  autoClosedPositions = autoClosedPositions
    .filter((pos) => pos < prefix || pos >= oldSuffix)
    .map((pos) => (pos < prefix ? pos : pos + delta));
}

/** テンプレート挿入・Undo/Redo・デフォルトテキスト投入など、まとまった内容の
 * 置き換えが起きたときに呼ぶ。個別のタイプオーバー追跡は意味を持たなくなるため
 * まとめて破棄する。 */
function resetAutoClosedTracking(): void {
  autoClosedPositions = [];
  previousInputValue = inputEl.value;
}

/** 選択範囲がない状態で開き括弧を入力したときの処理: 対応する閉じ括弧を自動挿入し、
 * キャレットをその間に置く。 */
function handleBracketOpenInsert(ev: KeyboardEvent, opener: string): void {
  const closer = BRACKET_PAIRS[opener];
  const start = inputEl.selectionStart ?? 0;
  const end = inputEl.selectionEnd ?? 0;
  if (start !== end) {
    if (!isBracketWrapSelectionEnabled()) return; // 素通りしてブラウザ既定の置換入力に任せる
    ev.preventDefault();
    const before = inputEl.value.slice(0, start);
    const selected = inputEl.value.slice(start, end);
    const after = inputEl.value.slice(end);
    inputEl.value = `${before}${opener}${selected}${closer}${after}`;
    inputEl.setSelectionRange(start + 1, end + 1);
    inputEl.dispatchEvent(new Event('input'));
    return;
  }
  ev.preventDefault();
  const before = inputEl.value.slice(0, start);
  const after = inputEl.value.slice(start);
  inputEl.value = `${before}${opener}${closer}${after}`;
  inputEl.setSelectionRange(start + 1, start + 1);
  // 'input'ディスパッチは同期的にリスナー(adjustAutoClosedPositions等)を実行し終えてから
  // 戻ってくるため、既存の追跡位置の補正が完了した"後"に今回分をpushする(先にpushすると
  // 今回追加した分まで誤って補正対象になってしまう)。
  inputEl.dispatchEvent(new Event('input'));
  autoClosedPositions.push(start + 1); // 自動挿入した閉じ括弧の文字インデックス(新しい座標系)
}

/** 閉じ括弧を入力したとき、直前に自動挿入された同じ閉じ括弧がキャレット位置にあれば
 * 重複挿入せず素通り(キャレットを1つ進めるだけ)にする。 */
function handleBracketCloseTypeOver(ev: KeyboardEvent, closer: string): boolean {
  const start = inputEl.selectionStart ?? 0;
  const end = inputEl.selectionEnd ?? 0;
  if (start !== end) return false;
  if (inputEl.value[start] !== closer) return false;
  if (!autoClosedPositions.includes(start)) return false;
  ev.preventDefault();
  inputEl.setSelectionRange(start + 1, start + 1);
  autoClosedPositions = autoClosedPositions.filter((pos) => pos !== start);
  // 値自体は変わらないため'input'イベントは発火しないが、キャレット移動に伴い
  // アクティブ括弧ハイライトだけは更新する。
  updateActiveBracketHighlight();
  return true;
}

inputEl.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
  const opener = Object.prototype.hasOwnProperty.call(BRACKET_PAIRS, ev.key) ? ev.key : null;
  if (opener) {
    handleBracketOpenInsert(ev, opener);
    return;
  }
  if (BRACKET_CLOSERS.has(ev.key)) {
    handleBracketCloseTypeOver(ev, ev.key);
  }
});

/** 入力欄でTabキーが押されたとき、設定されたスペース数を選択範囲(なければ
 * キャレット位置)に挿入する。複数行にまたがる選択の場合は、選択範囲全体を1つの
 * 空白ブロックに置き換えるのではなく、選択されている各行の先頭にそれぞれ同じ空白を
 * 挿入する(=選択された行それぞれで個別にTabを押したのと同じ結果になる、いわゆる
 * コードエディタの「複数行インデント」)。サジェスト候補ポップアップが開いている間は
 * Tabによる確定(下の別リスナー)を優先し、ここでは何もしない(preventDefaultしない
 * ことで後続リスナーに処理を委ねる)。Shift+Tabは対象外(ブラウザ既定のフォーカス
 * 逆移動のまま)。 */
function handleTabInsertSpaces(ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || ev.shiftKey) return;
  if (!suggestPopupEl.classList.contains('hidden') && suggestItems.length > 0) return;
  ev.preventDefault();
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const spaces = ' '.repeat(getTabSize());

  if (inputEl.value.slice(start, end).includes('\n')) {
    indentSelectedLines(start, end, spaces);
    return;
  }

  const before = inputEl.value.slice(0, start);
  const after = inputEl.value.slice(end);
  inputEl.value = `${before}${spaces}${after}`;
  const newPos = start + spaces.length;
  inputEl.setSelectionRange(newPos, newPos);
  inputEl.dispatchEvent(new Event('input'));
}

/** 複数行選択でのTab処理本体。選択範囲にかかっている各行の先頭にspacesを挿入する。
 * 選択終端がちょうど次の行の先頭(桁0)にある場合、その行は1文字も選択されていない
 * とみなし対象から除外する(一般的なコードエディタの挙動に合わせる)。処理後は、
 * 追加した空白の分だけ選択範囲を伸ばし、字下げされた同じ行範囲を選択し続けた
 * 状態にする。 */
function indentSelectedLines(start: number, end: number, spaces: string): void {
  const value = inputEl.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nextNewline = value.indexOf('\n', effectiveEnd);
  const blockEnd = nextNewline === -1 ? value.length : nextNewline;

  const block = value.slice(lineStart, blockEnd);
  const indented = block
    .split('\n')
    .map((line) => spaces + line)
    .join('\n');
  inputEl.value = value.slice(0, lineStart) + indented + value.slice(blockEnd);

  const mapPos = (pos: number): number => {
    const clamped = Math.min(Math.max(pos, lineStart), blockEnd);
    const linesBeforeOrAt = block.slice(0, clamped - lineStart).split('\n').length;
    return pos + linesBeforeOrAt * spaces.length;
  };
  inputEl.setSelectionRange(mapPos(start), mapPos(end));
  inputEl.dispatchEvent(new Event('input'));
}

inputEl.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
  handleTabInsertSpaces(ev);
});

function renderSuggestPopup(): void {
  suggestPopupEl.innerHTML = '';
  suggestItems.forEach((entry, idx) => {
    const item = document.createElement('div');
    item.className = 'suggest-item' + (idx === suggestActiveIndex ? ' active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', idx === suggestActiveIndex ? 'true' : 'false');
    item.dataset.index = String(idx);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = entry.label;
    item.appendChild(nameSpan);
    if (entry.isUserMacro) {
      const srcSpan = document.createElement('span');
      srcSpan.className = 'suggest-item-source';
      srcSpan.textContent = t('suggest.userMacro');
      item.appendChild(srcSpan);
    }
    suggestPopupEl.appendChild(item);
  });
  suggestPopupEl.classList.remove('hidden');
}

function positionSuggestPopup(): void {
  const { left, top } = getCaretClientPosition(suggestQueryStart);
  suggestPopupEl.style.left = `${Math.round(left)}px`;
  suggestPopupEl.style.top = `${Math.round(top)}px`;
}

function updateSuggestPopup(): void {
  if (suppressNextSuggest) {
    suppressNextSuggest = false;
    closeSuggestPopup();
    return;
  }
  if (!isSuggestEnabled()) {
    closeSuggestPopup();
    return;
  }
  const query = currentSuggestQuery();
  if (!query) {
    closeSuggestPopup();
    return;
  }
  const userMacros = collectUserMacroNames();
  const commandPool = KNOWN_LATEX_COMMANDS.filter((cmd) => cmd.startsWith(query.partial));
  const macroPool = userMacros.filter((cmd) => cmd.startsWith(query.partial));
  const entries: SuggestEntry[] = [
    ...commandPool.flatMap((cmd) => buildSuggestEntriesForCommand(cmd, false)),
    ...macroPool.flatMap((cmd) => buildSuggestEntriesForCommand(cmd, true)),
  ].sort((a, b) => a.label.localeCompare(b.label));
  if (entries.length === 0) {
    closeSuggestPopup();
    return;
  }
  suggestItems = entries.slice(0, 60);
  suggestQueryStart = query.start;
  suggestActiveIndex = 0;
  renderSuggestPopup();
  positionSuggestPopup();
}

/** ポップアップが開いている状態で、内容は変わらずキャレットだけが動いた場合
 * (クリックによる移動、矢印キー/Home/End等でのキーボード移動)に、表示中の候補が
 * もはや現在のキャレット位置のクエリと対応しなくなっていないかを確認する。
 * ズレていれば閉じる。
 *
 * 候補一覧内でのArrowUp/ArrowDownによる選択移動はキャレット自体を動かさない
 * (対応するkeydownリスナーでpreventDefaultされる)ため、その場合はここで
 * suggestQueryStartとcurrentSuggestQuery().startが一致し続け、何もしない
 * (=選択中のインデックスを誤ってリセットしない)。 */
function closeSuggestPopupIfCaretMoved(): void {
  if (suggestPopupEl.classList.contains('hidden')) return;
  const query = currentSuggestQuery();
  if (!query || query.start !== suggestQueryStart) {
    closeSuggestPopup();
  }
}

function confirmSuggestSelection(idx: number): void {
  if (idx < 0 || idx >= suggestItems.length) return;
  const entry = suggestItems[idx];
  const caret = inputEl.selectionStart ?? inputEl.value.length;
  flushHistoryCommit();
  const before = inputEl.value.slice(0, suggestQueryStart);
  const after = inputEl.value.slice(caret);
  inputEl.value = `${before}${entry.insertText}${after}`;
  const insertEnd = suggestQueryStart + entry.insertText.length;
  const newPos = insertEnd - entry.cursorOffsetFromEnd;
  inputEl.focus();
  inputEl.setSelectionRange(newPos, newPos);
  closeSuggestPopup();
  suppressNextSuggest = true; // 確定直後にポップアップが即再度開くのを防ぐ
  // 'input'ディスパッチは同期的にリスナー(adjustAutoClosedPositions等)を実行し終えてから
  // 戻ってくるため、座標補正が完了した"後"に今回追加した}の位置をpushする(handleBracketOpenInsert
  // と同じ理由。先にpushすると今回分まで誤って補正対象になってしまう)。
  inputEl.dispatchEvent(new Event('input'));
  // 挿入文字列中の各「空の{}」の"}"位置を自動挿入扱いにする(\frac{}{}のような連続braceだけで
  // なく、\int_{}^{}のような非連続な位置のbraceにも汎用的に対応するため、挿入文字列自体を
  // 走査して"{}"の出現位置を探す)。
  for (let i = 0; i < entry.insertText.length - 1; i++) {
    if (entry.insertText[i] === '{' && entry.insertText[i + 1] === '}') {
      autoClosedPositions.push(suggestQueryStart + i + 1);
    }
  }
  flushHistoryCommit();
}

suggestPopupEl.addEventListener('mousedown', (ev) => {
  const item = (ev.target as HTMLElement).closest('.suggest-item') as HTMLElement | null;
  if (!item) return;
  ev.preventDefault(); // inputElのフォーカスを保持したままクリックを処理する
  confirmSuggestSelection(Number(item.dataset.index ?? '-1'));
});

inputEl.addEventListener('keydown', (ev) => {
  if (suggestPopupEl.classList.contains('hidden') || suggestItems.length === 0) return;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    ev.stopPropagation();
    suggestActiveIndex = (suggestActiveIndex + 1) % suggestItems.length;
    renderSuggestPopup();
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    ev.stopPropagation();
    suggestActiveIndex = (suggestActiveIndex - 1 + suggestItems.length) % suggestItems.length;
    renderSuggestPopup();
  } else if (ev.key === 'Tab' || ev.key === 'Enter') {
    ev.preventDefault();
    ev.stopPropagation();
    confirmSuggestSelection(suggestActiveIndex);
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.stopPropagation();
    closeSuggestPopup();
  }
});

inputEl.addEventListener('blur', () => {
  closeSuggestPopup();
  updateActiveBracketHighlight();
});

// キャレット移動だけ(内容は変わらない)でもアクティブ括弧ハイライト・サジェストポップアップ
// の状態は更新する必要がある。クリックでの移動、矢印キー/Home/End等でのキーボード移動の
// 両方をカバーする(そうしないと、バックスラッシュ入力後にポップアップを開いたまま
// カーソルだけ動かした場合、閉じるべきポップアップが古い位置・古い候補のまま表示され
// 続けてしまう)。
inputEl.addEventListener('mouseup', () => {
  updateActiveBracketHighlight();
  closeSuggestPopupIfCaretMoved();
});
inputEl.addEventListener('keyup', () => {
  updateActiveBracketHighlight();
  closeSuggestPopupIfCaretMoved();
});
inputEl.addEventListener('focus', () => updateActiveBracketHighlight());

// ---------------------------------------------------------------------------
// 汎用確認モーダル (削除確認など。window.confirm()の代わり)
// ---------------------------------------------------------------------------

let confirmResolver: ((value: boolean) => void) | null = null;

function openConfirmDialog(message: string, okLabel: string): Promise<boolean> {
  confirmMessageEl.textContent = message;
  btnConfirmOk.textContent = okLabel;
  confirmOverlayEl.classList.remove('hidden');
  btnConfirmCancel.focus();
  return new Promise<boolean>((resolve) => {
    confirmResolver = resolve;
  });
}

function resolveConfirmDialog(result: boolean): void {
  if (confirmOverlayEl.classList.contains('hidden')) return;
  confirmOverlayEl.classList.add('hidden');
  const resolver = confirmResolver;
  confirmResolver = null;
  resolver?.(result);
}

btnConfirmOk.addEventListener('click', () => resolveConfirmDialog(true));
btnConfirmCancel.addEventListener('click', () => resolveConfirmDialog(false));
confirmOverlayEl.addEventListener('click', (ev) => {
  if (ev.target === confirmOverlayEl) resolveConfirmDialog(false);
});

// ---------------------------------------------------------------------------
// テンプレート管理ビュー (設定 > テンプレートを管理)
// ---------------------------------------------------------------------------

/** テンプレート管理画面のプレビュー用に、テンプレートのLaTeXソースを小さくレンダリングする。
 * fontColor/backgroundColorにCSSカスタムプロパティをそのまま指定することで、アプリの
 * ライト/ダークテーマに追従させる(このSVGは書き出しには使わず、ライブDOM内表示専用のため)。 */
function renderTemplatePreviewSvg(source: string): string {
  try {
    const lines = splitLinesWithNumbers(source).map((n) => n.text);
    if (lines.length === 0) return '';
    const composed = composeSvg(lines, {
      fontSizePx: 40,
      lineGapPx: 8,
      paddingPx: 6,
      fontColor: 'var(--text)',
      backgroundColor: 'var(--panel)',
      transparentBackground: true,
    });
    return composed.svg;
  } catch {
    return '';
  }
}

/** 現在メインの入力欄に読み込んで編集中のテンプレート名(nullなら編集中のものは無し)。
 * 設定モーダルの開閉には影響されず、明示的に別テンプレートを読み込むか、編集を終了する
 * (バッジの✕)まで保持される。 */
let editingTemplateName: string | null = null;

/** ヘッダー直下の「編集中」表示帯、「現在のソースをテンプレートとして保存」ボタン、
 * 「編集をキャンセル」ボタンの表示・挙動を editingTemplateName の状態に合わせて切り替える。 */
function updateTemplateEditUI(): void {
  if (editingTemplateName) {
    btnSaveAsTemplate.textContent = t('actions.saveAsTemplate.overwriteText', { name: editingTemplateName });
    btnSaveAsTemplate.setAttribute('aria-label', t('actions.saveAsTemplate.overwriteAriaLabel', { name: editingTemplateName }));
    templateEditBarTextEl.textContent = t('templateEditBar.editing', { name: editingTemplateName });
    templateEditBarEl.classList.remove('hidden');
    btnTemplateEditCancel.classList.remove('hidden');
  } else {
    btnSaveAsTemplate.textContent = t('actions.saveAsTemplate.text');
    btnSaveAsTemplate.setAttribute('aria-label', t('actions.saveAsTemplate.ariaLabel'));
    templateEditBarEl.classList.add('hidden');
    btnTemplateEditCancel.classList.add('hidden');
  }
}

/** 「編集」ボタン: テンプレートのソースをメインのコード入力欄にそのまま読み込み、設定モーダルを
 * 閉じてメイン画面で編集できるようにする。以降「テンプレートとして保存」ボタンは、このテンプレート
 * への上書き保存に切り替わる(バッジの✕で編集モードを終了するまで)。メインの入力欄に未保存の
 * 変更が残っている場合は、破棄してよいか確認してから読み込む。 */
async function startEditingTemplate(name: string, source: string): Promise<void> {
  if (isDirty) {
    const ok = await openConfirmDialog(t('confirm.loadTemplate', { name }), t('confirm.loadTemplate.ok'));
    if (!ok) return;
  }
  flushHistoryCommit();
  inputEl.value = source;
  inputEl.dispatchEvent(new Event('input'));
  flushHistoryCommit();
  markContentClean(); // 読み込んだ内容を基準にする(未保存ポチは出さない)
  editingTemplateName = name;
  updateTemplateEditUI();
  closeSettings();
  inputEl.focus();
  const pos = source.length;
  inputEl.setSelectionRange(pos, pos);
  setStatus(t('status.templateLoaded', { name }), 'ok');
}

/** 編集中テンプレートへ、現在の入力欄のソースをそのまま上書き保存する
 * (「テンプレートとして保存」ボタンが編集中モードの時の挙動)。 */
function overwriteEditingTemplate(): void {
  if (!editingTemplateName) return;
  const templates = loadTemplates();
  templates[editingTemplateName] = inputEl.value;
  saveTemplatesMap(templates);
  refreshUserTemplateSelect();
  markContentClean();
  setStatus(t('status.templateOverwritten', { name: editingTemplateName }), 'ok');
}

function renderTemplateManageList(): void {
  const templates = loadTemplates();
  const names = Object.keys(templates).sort((a, b) => a.localeCompare(b, 'ja'));
  templateManageListEl.innerHTML = '';
  templateManageEmptyEl.classList.toggle('hidden', names.length > 0);

  for (const name of names) {
    const source = templates[name];
    const item = document.createElement('div');
    item.className = 'template-item';

    const preview = document.createElement('div');
    preview.className = 'template-item-preview';
    preview.innerHTML = renderTemplatePreviewSvg(source);
    item.appendChild(preview);

    const info = document.createElement('div');
    info.className = 'template-item-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'template-item-name';
    nameEl.textContent = name;
    nameEl.title = name;
    info.appendChild(nameEl);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'template-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-success';
    if (editingTemplateName === name) {
      editBtn.textContent = t('templateManage.editing');
      editBtn.disabled = true;
      editBtn.title = t('templateManage.editingTitle');
    } else {
      editBtn.textContent = t('templateManage.edit');
      editBtn.addEventListener('click', () => {
        void startEditingTemplate(name, source);
      });
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-danger';
    deleteBtn.textContent = t('templateManage.delete');
    deleteBtn.addEventListener('click', () => {
      void openConfirmDialog(t('templateManage.deleteConfirm', { name }), t('templateManage.delete')).then((ok) => {
        if (!ok) return;
        const current = loadTemplates();
        delete current[name];
        saveTemplatesMap(current);
        if (editingTemplateName === name) {
          editingTemplateName = null;
          updateTemplateEditUI();
        }
        refreshUserTemplateSelect();
        renderTemplateManageList();
      });
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);

    templateManageListEl.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// テンプレートのインポート/エクスポート (v4.0)
// ---------------------------------------------------------------------------
// エクスポート: 現在のtemplatesCacheの全内容を、ユーザーが選んだ任意のJSONファイルへ
// 書き出す(内部の永続化先 <appDataDir>/templates.json とは別物。あくまでバックアップ・
// 共有用のスナップショット)。
async function doExportTemplates(): Promise<void> {
  try {
    const dir = await defaultSaveDir();
    const defaultPath = joinPath(dir, 'Equashare templates.json');
    const path = await save({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath });
    if (!path) {
      setStatus(t('status.templatesExportCancelled'));
      return;
    }
    setStatus(t('status.templatesExporting'));
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(loadTemplates(), null, 2)));
    await invoke('save_bytes', { path, bytes });
    rememberDir(path);
    setStatus(t('status.templatesExported', { path }), 'ok');
  } catch (e) {
    setStatus(t('status.templatesExportFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
  }
}

/** インポート先に同名テンプレートがある場合の3択(上書き/名前変更して追加/キャンセル)を
 * ユーザーへ尋ねるモーダル。openConfirmDialogと同じ「Promiseを保持しておき、対応する
 * ボタンのクリックで解決する」パターン。 */
let importConflictResolver: ((value: 'overwrite' | 'rename' | 'cancel') => void) | null = null;

function openTemplateImportConflictDialog(names: string[]): Promise<'overwrite' | 'rename' | 'cancel'> {
  templateImportConflictMessageEl.textContent = t('templateImportConflict.message', { count: names.length, names: names.join('\n') });
  templateImportConflictOverlayEl.classList.remove('hidden');
  btnImportConflictCancel.focus();
  return new Promise((resolve) => {
    importConflictResolver = resolve;
  });
}

function resolveTemplateImportConflictDialog(result: 'overwrite' | 'rename' | 'cancel'): void {
  if (templateImportConflictOverlayEl.classList.contains('hidden')) return;
  templateImportConflictOverlayEl.classList.add('hidden');
  const resolver = importConflictResolver;
  importConflictResolver = null;
  resolver?.(result);
}

btnImportConflictOverwrite.addEventListener('click', () => resolveTemplateImportConflictDialog('overwrite'));
btnImportConflictRename.addEventListener('click', () => resolveTemplateImportConflictDialog('rename'));
btnImportConflictCancel.addEventListener('click', () => resolveTemplateImportConflictDialog('cancel'));
templateImportConflictOverlayEl.addEventListener('click', (ev) => {
  if (ev.target === templateImportConflictOverlayEl) resolveTemplateImportConflictDialog('cancel');
});

/** 衝突がなければそのままマージして保存する。衝突がある場合はユーザーの選択(上書き/
 * 名前変更して追加/キャンセル)に従って解決してから確定する。「インポート」は常に既存の
 * テンプレート集合への追加(マージ)であり、既存分を丸ごと置き換えることはない。 */
async function applyTemplateImport(incoming: StoredTemplates): Promise<void> {
  const current = loadTemplates();
  const conflictNames = Object.keys(incoming).filter((name) => name in current);

  let resolution: 'overwrite' | 'rename' | 'cancel' = 'overwrite';
  if (conflictNames.length > 0) {
    resolution = await openTemplateImportConflictDialog(conflictNames);
    if (resolution === 'cancel') {
      setStatus(t('status.templatesImportCancelled'));
      return;
    }
  }

  const merged: StoredTemplates = { ...current };
  let importedCount = 0;
  for (const [name, source] of Object.entries(incoming)) {
    if (name in merged && resolution === 'rename') {
      // uniqueTemplateNameは「これまでにマージ済みの名前集合」に対して一意な名前を作る
      // 必要があるため、都度更新中のmergedそのものを参照する。
      merged[uniqueTemplateName(name, merged)] = source;
    } else {
      merged[name] = source;
    }
    importedCount++;
  }

  saveTemplatesMap(merged);
  refreshUserTemplateSelect();
  renderTemplateManageList();
  setStatus(t('status.templatesImported', { count: importedCount }), 'ok');
}

async function doImportTemplates(): Promise<void> {
  try {
    const dir = await defaultSaveDir();
    const picked = await openDialogPicker({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: dir, multiple: false });
    if (!picked || typeof picked !== 'string') {
      setStatus(t('status.templatesImportCancelled'));
      return;
    }
    setStatus(t('status.templatesImporting'));
    const raw = await invoke<string | null>('read_text_file', { path: picked });
    if (!raw) {
      setStatus(t('status.templatesImportInvalid'), 'err');
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setStatus(t('status.templatesImportInvalid'), 'err');
      return;
    }
    const incoming: StoredTemplates = {};
    for (const [name, source] of Object.entries(parsed as Record<string, unknown>)) {
      if (name.trim().length > 0 && typeof source === 'string') incoming[name] = source;
    }
    if (Object.keys(incoming).length === 0) {
      setStatus(t('status.templatesImportInvalid'), 'err');
      return;
    }
    await applyTemplateImport(incoming);
  } catch (e) {
    setStatus(t('status.templatesImportFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
  }
}

btnTemplateExport.addEventListener('click', () => void doExportTemplates());
btnTemplateImport.addEventListener('click', () => void doImportTemplates());

function applySettingsBackup(settings: Record<string, string>): number {
  const transferableKeys = new Set<string>(SETTINGS_TRANSFER_KEYS);
  const entries = Object.entries(settings).filter(([key]) => transferableKeys.has(key));
  if (entries.length === 0) return 0;

  const previous = new Map<string, string | null>();
  for (const key of SETTINGS_TRANSFER_KEYS) previous.set(key, localStorage.getItem(key));
  try {
    for (const key of SETTINGS_TRANSFER_KEYS) localStorage.removeItem(key);
    for (const [key, value] of entries) localStorage.setItem(key, value);
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // Keep the original write error; storage rollback is best effort.
      }
    }
    throw error;
  }

  setLang(settings['mathimg.lang'] === 'en' ? 'en' : 'ja');
  applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');
  applyUiScale(getUiScalePercent());
  applyTmplScale(getTmplScalePercent());
  applyI18nToDom();
  loadSettingsIntoUI();
  refreshUserTemplateSelect();
  updateTemplateEditUI();
  if (!isSuggestEnabled()) closeSuggestPopup();
  setHistoryLimit(getHistoryLimit());
  return entries.length;
}

async function doExportSettings(): Promise<void> {
  try {
    const defaultPath = joinPath(await defaultSaveDir(), 'Equashare settings.json');
    const path = await save({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath });
    if (!path) {
      setStatus(t('status.settingsExportCancelled'));
      return;
    }
    setStatus(t('status.settingsExporting'));
    const json = createSettingsBackupJson(localStorage, SETTINGS_TRANSFER_KEYS, getLang());
    const bytes = Array.from(new TextEncoder().encode(json));
    await invoke('save_bytes', { path, bytes });
    rememberDir(path);
    setStatus(t('status.settingsExported', { path }), 'ok');
  } catch (error) {
    setStatus(t('status.settingsExportFailed', { message: error instanceof Error ? error.message : String(error) }), 'err');
  }
}

async function doImportSettings(): Promise<void> {
  try {
    const defaultPath = await defaultSaveDir();
    const picked = await openDialogPicker({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath, multiple: false });
    if (!picked || typeof picked !== 'string') {
      setStatus(t('status.settingsImportCancelled'));
      return;
    }
    setStatus(t('status.settingsImporting'));
    const raw = await invoke<string | null>('read_text_file', { path: picked });
    const backup = raw ? parseSettingsBackupJson(raw) : null;
    const transferableKeys = new Set<string>(SETTINGS_TRANSFER_KEYS);
    if (!backup || !Object.keys(backup.settings).some((key) => transferableKeys.has(key))) {
      setStatus(t('status.settingsImportInvalid'), 'err');
      return;
    }

    const confirmed = await ask(t('settings.transfer.confirm'), {
      title: t('settings.transfer.title'),
      type: 'warning',
    });
    if (!confirmed) {
      setStatus(t('status.settingsImportCancelled'));
      return;
    }
    const count = applySettingsBackup(backup.settings);
    setStatus(t('status.settingsImported', { count }), 'ok');
  } catch (error) {
    setStatus(t('status.settingsImportFailed', { message: error instanceof Error ? error.message : String(error) }), 'err');
  }
}

btnExportSettings.addEventListener('click', () => void doExportSettings());
btnImportSettings.addEventListener('click', () => void doImportSettings());

// ---------------------------------------------------------------------------
// テンプレート名入力モーダル (「現在のソースをテンプレートとして保存」)
// ---------------------------------------------------------------------------

function closeTemplateNamePrompt(): void {
  templateNamePromptOverlayEl.classList.add('hidden');
}

function confirmSaveTemplate(): void {
  const templates = loadTemplates();
  const requestedName = templateNameInputEl.value.trim() || nextDefaultTemplateName(templates);
  const finalName = uniqueTemplateName(requestedName, templates);
  templates[finalName] = inputEl.value;
  saveTemplatesMap(templates);
  refreshUserTemplateSelect();
  closeTemplateNamePrompt();
  setStatus(t('status.templateSaved', { name: finalName }), 'ok');
}

btnSaveAsTemplate.addEventListener('click', () => {
  if (editingTemplateName) {
    overwriteEditingTemplate();
    return;
  }
  const templates = loadTemplates();
  templateNameInputEl.value = nextDefaultTemplateName(templates);
  templateNamePromptOverlayEl.classList.remove('hidden');
  templateNameInputEl.focus();
  templateNameInputEl.select();
});

btnTemplateEditCancel.addEventListener('click', () => {
  editingTemplateName = null;
  updateTemplateEditUI();
});

btnTemplateNameConfirm.addEventListener('click', confirmSaveTemplate);
btnTemplateNameCancel.addEventListener('click', closeTemplateNamePrompt);
templateNamePromptOverlayEl.addEventListener('click', (ev) => {
  if (ev.target === templateNamePromptOverlayEl) closeTemplateNamePrompt();
});
templateNameInputEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    confirmSaveTemplate();
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    closeTemplateNamePrompt();
  }
});

// ---------------------------------------------------------------------------
// モーダル共通: フォーカストラップ用ヘルパー
// ---------------------------------------------------------------------------

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.getClientRects().length > 0 || el === document.activeElement);
}

function trapFocusWithin(panel: HTMLElement, ev: KeyboardEvent): void {
  if (ev.key !== 'Tab') return;
  const focusables = focusableElements(panel);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

// ---------------------------------------------------------------------------
// ヘルプモーダル
// ---------------------------------------------------------------------------

let helpOpenerEl: HTMLElement | null = null;

function trapHelpFocus(ev: KeyboardEvent): void {
  const panel = helpOverlayEl.querySelector<HTMLElement>('.help-panel');
  if (panel) trapFocusWithin(panel, ev);
}

function openHelp(): void {
  helpOpenerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  helpOverlayEl.classList.remove('hidden');
  helpOverlayEl.addEventListener('keydown', trapHelpFocus);
  btnHelpClose.focus();
}

function closeHelp(): void {
  helpOverlayEl.classList.add('hidden');
  helpOverlayEl.removeEventListener('keydown', trapHelpFocus);
  (helpOpenerEl ?? btnHelp).focus();
  helpOpenerEl = null;
}

btnHelp.addEventListener('click', openHelp);
btnHelpClose.addEventListener('click', closeHelp);
helpOverlayEl.addEventListener('click', (ev) => {
  if (ev.target === helpOverlayEl) closeHelp();
});

// ---------------------------------------------------------------------------
// 履歴機能 (コピー・保存操作を統合1本のリストとして記録する。v4.0)
// ---------------------------------------------------------------------------
// テンプレートと異なりファイルの受け渡しをする機能ではないため、従来通り
// localStorageで保持する(別管理が必要なのはテンプレートのみ、との指示)。

interface HistoryEntry {
  id: string;
  timestamp: number;
  source: string;
  action: 'copyImage' | 'copySvgText' | 'copyUnicode' | 'copyMathML' | 'saveImage' | 'saveSource';
}

function loadHistoryFromStorage(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let historyCache: HistoryEntry[] = loadHistoryFromStorage();

/** 履歴はlocalStorage由来で同期的に読み込めるため、テンプレート(ファイルベース、
 * 非同期)のensureTemplatesLoaded()のような待ち合わせは不要。init()からの
 * 呼び出し口を対称に保つためだけに存在するno-op。 */
function ensureHistoryLoaded(): void {}

function saveHistoryToStorage(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache));
  } catch {
    // 容量超過等が起きても、履歴の保存だけを諦めてアプリ本体の動作は継続する。
  }
}

function getHistoryLimit(): number {
  const raw = Number(localStorage.getItem(HISTORY_LIMIT_KEY));
  if (!Number.isFinite(raw) || raw < HISTORY_LIMIT_MIN || raw > HISTORY_LIMIT_MAX) return HISTORY_LIMIT_DEFAULT;
  return Math.round(raw);
}

function setHistoryLimit(n: number): void {
  const clamped = Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, Math.round(n)));
  localStorage.setItem(HISTORY_LIMIT_KEY, String(clamped));
  if (historyCache.length > clamped) {
    historyCache = historyCache.slice(0, clamped);
    saveHistoryToStorage();
  }
}

/** コピー・保存操作が成功した直後に呼ぶ。入力欄が空の場合は記録しない
 * (「レンダリングする数式がありません」状態からの操作は起こり得ないが念のため)。 */
function pushHistoryEntry(action: HistoryEntry['action']): void {
  const source = inputEl.value;
  if (source.trim().length === 0) return;
  historyCache.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    source,
    action,
  });
  const limit = getHistoryLimit();
  if (historyCache.length > limit) historyCache.length = limit;
  saveHistoryToStorage();
}

function deleteHistoryEntry(id: string): void {
  historyCache = historyCache.filter((e) => e.id !== id);
  saveHistoryToStorage();
}

function clearAllHistory(): void {
  historyCache = [];
  saveHistoryToStorage();
}

function formatHistoryTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 「読み込む」ボタン: 履歴時点のソースをメインの入力欄へそのまま復元する。
 * startEditingTemplate()と同じ「未保存の変更があれば確認してから読み込む」流儀だが、
 * これはテンプレートではないためeditingTemplateNameはnullにリセットする
 * (テンプレート編集中に履歴を読み込んだ場合、編集中バッジは解除される)。 */
async function loadHistoryEntryIntoEditor(entry: HistoryEntry): Promise<void> {
  if (isDirty) {
    const ok = await openConfirmDialog(t('history.loadConfirm'), t('history.load'));
    if (!ok) return;
  }
  flushHistoryCommit();
  inputEl.value = entry.source;
  inputEl.dispatchEvent(new Event('input'));
  flushHistoryCommit();
  markContentClean();
  editingTemplateName = null;
  updateTemplateEditUI();
  closeHistory();
  inputEl.focus();
  const pos = entry.source.length;
  inputEl.setSelectionRange(pos, pos);
  setStatus(t('status.historyLoaded'), 'ok');
}

// 簡易表示から編集画面へ移る際、現在のソースを保持して取り込む。
void appWindow.listen<string>('quick-open-main', ({ payload: source }) => {
  void (async () => {
    if (source && isDirty && !(await openConfirmDialog(t('history.loadConfirm'), t('history.load')))) {
      const quick = WebviewWindow.getByLabel('quickpopup');
      await quick?.emit('quick-open-main-result', false);
      return;
    }
    if (!source) return;
    flushHistoryCommit();
    inputEl.value = source;
    inputEl.dispatchEvent(new Event('input'));
    flushHistoryCommit();
    editingTemplateName = null;
    updateTemplateEditUI();
    // 外部から取り込んだソースは、まだファイル保存されていない。
    cleanBaseline = '';
    updateDirtyFromContent();
    inputEl.focus();
    inputEl.setSelectionRange(source.length, source.length);
    const quick = WebviewWindow.getByLabel('quickpopup');
    await quick?.emit('quick-open-main-result', true);
  })();
});

/** 「再コピー」ボタン: メインの入力欄には触れず、履歴時点のソースを記録時と同じ形式で
 * 再度クリップボードへコピーする(画像/SVGコピーは現在の出力設定(フォントサイズ・
 * スケール等)で改めてレンダリングし直す。過去のプレビュー画像自体は保存していないため)。 */
async function copyHistoryEntryAgain(entry: HistoryEntry): Promise<void> {
  if (exportBusy) return;
  setExportBusy(true);
  try {
    setStatus(t('status.copying'));
    const lines = splitLinesWithNumbers(entry.source).map((n) => n.text);
    if (lines.length === 0) throw new Error(t('error.noFormulaToRender'));
    if (entry.action === 'copyUnicode') {
      await invoke('copy_text_to_clipboard', { text: composeUnicodeApprox(lines) });
      setStatus(t('status.copiedUnicode'), 'ok');
    } else if (entry.action === 'copyMathML') {
      await invoke('copy_text_to_clipboard', { text: composeMathML(lines) });
      setStatus(t('status.copiedMathML'), 'ok');
    } else {
      const composed = composeSvg(lines, currentOptions());
      if (entry.action === 'copySvgText') {
        await invoke('copy_text_to_clipboard', { text: composed.svg });
      } else {
        await invoke('copy_export_to_clipboard', { svg: composed.svg, format: 'png', scale: getScale() });
      }
      setStatus(t('status.copied'), 'ok');
    }
  } catch (e) {
    setStatus(t('status.copyFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
  } finally {
    setExportBusy(false);
  }
}

function renderHistoryList(): void {
  historyListEl.innerHTML = '';
  historyEmptyEl.classList.toggle('hidden', historyCache.length > 0);
  btnHistoryClearAll.classList.toggle('hidden', historyCache.length === 0);

  for (const entry of historyCache) {
    const item = document.createElement('div');
    item.className = 'template-item';

    const preview = document.createElement('div');
    preview.className = 'template-item-preview';
    preview.innerHTML = renderTemplatePreviewSvg(entry.source);
    item.appendChild(preview);

    const info = document.createElement('div');
    info.className = 'template-item-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'template-item-name';
    nameEl.textContent = t(`history.action.${entry.action}`);
    info.appendChild(nameEl);
    const metaEl = document.createElement('span');
    metaEl.className = 'history-item-meta';
    metaEl.textContent = formatHistoryTimestamp(entry.timestamp);
    info.appendChild(metaEl);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'template-item-actions';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn-success';
    loadBtn.textContent = t('history.load');
    loadBtn.addEventListener('click', () => void loadHistoryEntryIntoEditor(entry));
    actions.appendChild(loadBtn);

    // 保存系の履歴(画像/ソース保存)は「再コピー」の対象として意味が曖昧なため出さない
    // (コピー系の4アクションのみ再コピー可能)。
    if (entry.action === 'copyImage' || entry.action === 'copySvgText' || entry.action === 'copyUnicode' || entry.action === 'copyMathML') {
      const copyAgainBtn = document.createElement('button');
      copyAgainBtn.type = 'button';
      copyAgainBtn.textContent = t('history.copyAgain');
      copyAgainBtn.addEventListener('click', () => void copyHistoryEntryAgain(entry));
      actions.appendChild(copyAgainBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-danger';
    deleteBtn.textContent = t('history.delete');
    deleteBtn.addEventListener('click', () => {
      void openConfirmDialog(t('history.deleteConfirm'), t('history.delete')).then((ok) => {
        if (!ok) return;
        deleteHistoryEntry(entry.id);
        renderHistoryList();
      });
    });
    actions.appendChild(deleteBtn);

    item.appendChild(actions);
    historyListEl.appendChild(item);
  }
}

let historyOpenerEl: HTMLElement | null = null;

function trapHistoryFocus(ev: KeyboardEvent): void {
  const panel = historyOverlayEl.querySelector<HTMLElement>('.help-panel');
  if (panel) trapFocusWithin(panel, ev);
}

function openHistory(): void {
  historyOpenerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  renderHistoryList();
  historyOverlayEl.classList.remove('hidden');
  historyOverlayEl.addEventListener('keydown', trapHistoryFocus);
  btnHistoryClose.focus();
}

function closeHistory(): void {
  historyOverlayEl.classList.add('hidden');
  historyOverlayEl.removeEventListener('keydown', trapHistoryFocus);
  (historyOpenerEl ?? btnHistory).focus();
  historyOpenerEl = null;
}

btnHistory.addEventListener('click', openHistory);
btnHistoryClose.addEventListener('click', closeHistory);
historyOverlayEl.addEventListener('click', (ev) => {
  if (ev.target === historyOverlayEl) closeHistory();
});
btnHistoryClearAll.addEventListener('click', () => {
  void openConfirmDialog(t('history.clearAllConfirm'), t('history.clearAll')).then((ok) => {
    if (!ok) return;
    clearAllHistory();
    renderHistoryList();
  });
});

// ---------------------------------------------------------------------------
// 設定モーダル (⚙) : 設定一覧ビュー ⇄ テンプレート管理ビュー
// ---------------------------------------------------------------------------

let settingsOpenerEl: HTMLElement | null = null;

function trapSettingsFocus(ev: KeyboardEvent): void {
  const panel = settingsOverlayEl.querySelector<HTMLElement>('.help-panel');
  if (panel) trapFocusWithin(panel, ev);
}

/** ON/OFFトグルボタンの表示とaria-pressedを同期する。 */
function syncToggleBtn(btn: HTMLButtonElement, on: boolean): void {
  btn.textContent = on ? 'ON' : 'OFF';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.classList.toggle('toggle-on', on);
  btn.classList.toggle('toggle-off', !on);
}

function loadSettingsIntoUI(): void {
  settingLanguageEl.value = getLang();
  const uiScale = getUiScalePercent();
  settingUiScaleEl.value = String(uiScale);
  settingUiScaleLabelEl.textContent = `${uiScale}%`;
  const tmplScale = getTmplScalePercent();
  settingTmplScaleEl.value = String(tmplScale);
  settingTmplScaleLabelEl.textContent = `${tmplScale}%`;
  syncToggleBtn(settingSuggestEl, isSuggestEnabled());
  syncToggleBtn(settingDefaultTextEl, isDefaultTextEnabled());
  syncToggleBtn(settingBracketWrapSelectionEl, isBracketWrapSelectionEnabled());
  settingTabSizeEl.value = String(getTabSize());
  settingHistoryLimitEl.value = String(getHistoryLimit());
  settingExitSaveEl.value = getExitSaveMode();
  settingHomeDirDisplayEl.value = homeDirCache ?? t('settings.homeDir.loading');
  if (!homeDirCache) {
    void getHomeDirectory().then((dir) => {
      settingHomeDirDisplayEl.value = dir;
    });
  }
  settingDefaultFormatEl.value = getDefaultFormat();
  settingDefaultFontSizeEl.value = String(getDefaultFontSizePx());
  settingDefaultScaleEl.value = String(getDefaultScale());
  settingDefaultPaddingPxEl.value = String(getDefaultPaddingPx());
  syncToggleBtn(settingDefaultTransparentBgEl, isDefaultTransparentBgEnabled());
  updateQuickPopupHotkeyUI();
  void updateNativeMessagingUI();
}

function showSettingsListView(): void {
  templateManageViewEl.classList.add('hidden');
  settingsListViewEl.classList.remove('hidden');
  settingsPanelEl.classList.remove('template-manage-active');
  btnTemplateImport.classList.add('hidden');
  btnTemplateExport.classList.add('hidden');
}

function openSettings(): void {
  settingsOpenerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  loadSettingsIntoUI();
  showSettingsListView();
  settingsOverlayEl.classList.remove('hidden');
  settingsOverlayEl.addEventListener('keydown', trapSettingsFocus);
  btnSettingsClose.focus();
}

function closeSettings(): void {
  settingsOverlayEl.classList.add('hidden');
  settingsOverlayEl.removeEventListener('keydown', trapSettingsFocus);
  (settingsOpenerEl ?? btnSettings).focus();
  settingsOpenerEl = null;
}

btnSettings.addEventListener('click', openSettings);
btnSettingsClose.addEventListener('click', closeSettings);
// 「ポップアップなので外側をクリックしても戻れるように」との指定通り、オーバーレイの
// 背景部分(パネル自体ではない部分)をクリックしたら設定モーダル自体を閉じる。
settingsOverlayEl.addEventListener('click', (ev) => {
  if (ev.target === settingsOverlayEl) closeSettings();
});

btnManageTemplates.addEventListener('click', () => {
  renderTemplateManageList();
  settingsListViewEl.classList.add('hidden');
  templateManageViewEl.classList.remove('hidden');
  settingsPanelEl.classList.add('template-manage-active');
  btnTemplateImport.classList.remove('hidden');
  btnTemplateExport.classList.remove('hidden');
});
// 「左上の矢印は設定に戻るためのボタン」
btnTemplateManageBack.addEventListener('click', () => {
  showSettingsListView();
});

settingSuggestEl.addEventListener('click', () => {
  const next = !isSuggestEnabled();
  localStorage.setItem(SUGGEST_KEY, next ? 'on' : 'off');
  syncToggleBtn(settingSuggestEl, next);
  if (!next) closeSuggestPopup();
});
settingDefaultTextEl.addEventListener('click', () => {
  const next = !isDefaultTextEnabled();
  localStorage.setItem(DEFAULT_TEXT_KEY, next ? 'on' : 'off');
  syncToggleBtn(settingDefaultTextEl, next);
});
settingBracketWrapSelectionEl.addEventListener('click', () => {
  const next = !isBracketWrapSelectionEnabled();
  localStorage.setItem(BRACKET_WRAP_SELECTION_KEY, next ? 'on' : 'off');
  syncToggleBtn(settingBracketWrapSelectionEl, next);
});
settingTabSizeEl.addEventListener('change', () => {
  const n = clampedNumber(settingTabSizeEl.value, 2, TAB_SIZE_MIN, TAB_SIZE_MAX);
  settingTabSizeEl.value = String(n);
  localStorage.setItem(TAB_SIZE_KEY, String(n));
});
settingHistoryLimitEl.addEventListener('change', () => {
  const n = clampedNumber(settingHistoryLimitEl.value, HISTORY_LIMIT_DEFAULT, HISTORY_LIMIT_MIN, HISTORY_LIMIT_MAX);
  settingHistoryLimitEl.value = String(n);
  setHistoryLimit(n);
});
settingExitSaveEl.addEventListener('change', () => {
  localStorage.setItem(EXIT_SAVE_KEY, settingExitSaveEl.value);
});
settingDefaultFormatEl.addEventListener('change', () => {
  localStorage.setItem(DEFAULT_FORMAT_KEY, settingDefaultFormatEl.value);
});
settingDefaultFontSizeEl.addEventListener('change', () => {
  const n = clampedNumber(settingDefaultFontSizeEl.value, 48, FONT_SIZE_MIN, FONT_SIZE_MAX);
  settingDefaultFontSizeEl.value = String(n);
  localStorage.setItem(DEFAULT_FONT_SIZE_KEY, String(n));
});
settingDefaultScaleEl.addEventListener('change', () => {
  const n = clampedNumber(settingDefaultScaleEl.value, 2, SCALE_MIN, SCALE_MAX);
  settingDefaultScaleEl.value = String(n);
  localStorage.setItem(DEFAULT_SCALE_KEY, String(n));
});
settingDefaultPaddingPxEl.addEventListener('change', () => {
  const n = clampedNumber(settingDefaultPaddingPxEl.value, 24, PADDING_PX_MIN, PADDING_PX_MAX);
  settingDefaultPaddingPxEl.value = String(n);
  localStorage.setItem(DEFAULT_PADDING_PX_KEY, String(n));
});
settingDefaultTransparentBgEl.addEventListener('click', () => {
  const next = !isDefaultTransparentBgEnabled();
  localStorage.setItem(DEFAULT_TRANSPARENT_BG_KEY, next ? 'on' : 'off');
  syncToggleBtn(settingDefaultTransparentBgEl, next);
});
btnChangeHomeDir.addEventListener('click', () => {
  void (async () => {
    const current = await getHomeDirectory();
    const picked = await openDialogPicker({ directory: true, defaultPath: current });
    if (typeof picked === 'string' && picked) {
      homeDirCache = picked;
      localStorage.setItem(HOME_DIR_KEY, picked);
      settingHomeDirDisplayEl.value = picked;
    }
  })().catch((e) => setStatus(t('status.homeDirChangeFailed', { message: e instanceof Error ? e.message : String(e) }), 'err'));
});

// ---------------------------------------------------------------------------
// 言語・UIサイズ (v3.0)
// ---------------------------------------------------------------------------
// UIサイズは--ui-scale/--tmpl-scale(style.css)というCSSカスタムプロパティへ実際の
// 倍率(1 = 100%)をセットするだけで、対象のfont-size/padding等はすべてcalc()で
// 追従する。言語切替はi18n.ts側でlocalStorageへ保存され、applyI18nToDom()が
// data-i18n系属性を持つ全要素を一括で差し替える。
const UI_SCALE_MIN = 70;
const UI_SCALE_MAX = 150;

function getUiScalePercent(): number {
  const v = localStorage.getItem(UI_SCALE_KEY);
  return v === null ? 100 : clampedNumber(v, 100, UI_SCALE_MIN, UI_SCALE_MAX);
}
function getTmplScalePercent(): number {
  const v = localStorage.getItem(TMPL_SCALE_KEY);
  return v === null ? 100 : clampedNumber(v, 100, UI_SCALE_MIN, UI_SCALE_MAX);
}

/** --ui-scaleの変更は入力欄のfont-sizeにも影響する。キャレット位置はミラー要素で
 * 都度実測する方式(cachedCharWidthPxのような永続キャッシュを持たない)なので、
 * ここでの明示的なキャッシュ破棄は不要。表示の再計算のみ行う。 */
function applyUiScale(percent: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(percent / 100));
  refreshInputOverlay();
  updateActiveBracketHighlight();
  if (!suggestPopupEl.classList.contains('hidden')) positionSuggestPopup();
}
function applyTmplScale(percent: number): void {
  document.documentElement.style.setProperty('--tmpl-scale', String(percent / 100));
}

settingUiScaleEl.addEventListener('input', () => {
  const n = clampedNumber(settingUiScaleEl.value, 100, UI_SCALE_MIN, UI_SCALE_MAX);
  settingUiScaleLabelEl.textContent = `${n}%`;
  applyUiScale(n);
});
settingUiScaleEl.addEventListener('change', () => {
  localStorage.setItem(UI_SCALE_KEY, String(clampedNumber(settingUiScaleEl.value, 100, UI_SCALE_MIN, UI_SCALE_MAX)));
});
settingTmplScaleEl.addEventListener('input', () => {
  const n = clampedNumber(settingTmplScaleEl.value, 100, UI_SCALE_MIN, UI_SCALE_MAX);
  settingTmplScaleLabelEl.textContent = `${n}%`;
  applyTmplScale(n);
});
settingTmplScaleEl.addEventListener('change', () => {
  localStorage.setItem(TMPL_SCALE_KEY, String(clampedNumber(settingTmplScaleEl.value, 100, UI_SCALE_MIN, UI_SCALE_MAX)));
});

settingLanguageEl.addEventListener('change', () => {
  setLang(settingLanguageEl.value === 'en' ? 'en' : 'ja');
  applyI18nToDom();
  refreshUserTemplateSelect();
  if (!templateManageViewEl.classList.contains('hidden')) renderTemplateManageList();
  updateTemplateEditUI();
});

// ---------------------------------------------------------------------------
// テーマ切替
// ---------------------------------------------------------------------------

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.setAttribute('data-theme', theme);
  btnTheme.textContent = theme === 'dark' ? '🌙' : '☀️';
  localStorage.setItem(THEME_KEY, theme);
}

btnTheme.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ---------------------------------------------------------------------------
// プレビューのズーム & パン
// ---------------------------------------------------------------------------

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;
let zoomLevel = 1;
let panX = 0;
let panY = 0;

function applyZoom(): void {
  previewEl.style.transformOrigin = 'top left';
  previewEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  zoomLabelEl.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function setZoom(next: number): void {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  applyZoom();
}

zoomInEl.addEventListener('click', () => setZoom(zoomLevel + ZOOM_STEP));
zoomOutEl.addEventListener('click', () => setZoom(zoomLevel - ZOOM_STEP));
zoomResetEl.addEventListener('click', () => {
  zoomLevel = 1;
  panX = 0;
  panY = 0;
  applyZoom();
});

previewWrapEl.addEventListener(
  'wheel',
  (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return; // 通常のホイールは領域内スクロールのまま
    ev.preventDefault();
    setZoom(zoomLevel + (ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  },
  { passive: false },
);

let isPanning = false;
let panStartClientX = 0;
let panStartClientY = 0;
let panOriginX = 0;
let panOriginY = 0;

previewWrapEl.addEventListener('mousedown', (ev) => {
  if (ev.button !== 0) return;
  isPanning = true;
  panStartClientX = ev.clientX;
  panStartClientY = ev.clientY;
  panOriginX = panX;
  panOriginY = panY;
  previewWrapEl.classList.add('panning');
});
window.addEventListener('mousemove', (ev) => {
  if (!isPanning) return;
  panX = panOriginX + (ev.clientX - panStartClientX);
  panY = panOriginY + (ev.clientY - panStartClientY);
  applyZoom();
});
window.addEventListener('mouseup', () => {
  if (!isPanning) return;
  isPanning = false;
  previewWrapEl.classList.remove('panning');
});

// ---------------------------------------------------------------------------
// レイアウトのドラッグリサイズ (編集パネル幅 / 入力欄と設定欄の高さ境界)
// ---------------------------------------------------------------------------

const EDITOR_WIDTH_MIN = 260;
const EDITOR_WIDTH_MAX_RATIO = 0.75;
const OUTPUT_HEIGHT_MIN = 120;
const CODING_PART_MIN = 100;

function restoreLayout(): void {
  const savedWidth = localStorage.getItem(EDITOR_WIDTH_KEY);
  if (savedWidth) editorPaneEl.style.width = `${savedWidth}px`;
  const savedHeight = localStorage.getItem(OUTPUT_HEIGHT_KEY);
  if (savedHeight) outputPartEl.style.height = `${savedHeight}px`;
}

function setupDragResize(
  handle: HTMLElement,
  onDrag: (deltaPx: number) => void,
  onCommit: () => void,
  axis: 'x' | 'y',
  keyboardStep = 10,
): void {
  let dragging = false;
  let lastPos = 0;

  const onMove = (ev: MouseEvent) => {
    if (!dragging) return;
    const pos = axis === 'x' ? ev.clientX : ev.clientY;
    onDrag(pos - lastPos);
    lastPos = pos;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    onCommit();
  };

  handle.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    dragging = true;
    lastPos = axis === 'x' ? ev.clientX : ev.clientY;
    handle.classList.add('active');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('keydown', (ev) => {
    const isPositive = axis === 'x' ? ev.key === 'ArrowRight' : ev.key === 'ArrowDown';
    const isNegative = axis === 'x' ? ev.key === 'ArrowLeft' : ev.key === 'ArrowUp';
    if (!isPositive && !isNegative) return;
    ev.preventDefault();
    onDrag(isPositive ? keyboardStep : -keyboardStep);
    onCommit();
  });
}

setupDragResize(
  splitterVEl,
  (deltaPx) => {
    const current = editorPaneEl.getBoundingClientRect().width;
    const maxWidth = window.innerWidth * EDITOR_WIDTH_MAX_RATIO;
    const next = Math.min(maxWidth, Math.max(EDITOR_WIDTH_MIN, current + deltaPx));
    editorPaneEl.style.width = `${next}px`;
  },
  () => localStorage.setItem(EDITOR_WIDTH_KEY, String(Math.round(editorPaneEl.getBoundingClientRect().width))),
  'x',
);

setupDragResize(
  splitterHEl,
  (deltaPx) => {
    const current = outputPartEl.getBoundingClientRect().height;
    const paneHeight = editorPaneEl.getBoundingClientRect().height;
    const maxHeight = paneHeight - CODING_PART_MIN;
    const next = Math.min(maxHeight, Math.max(OUTPUT_HEIGHT_MIN, current - deltaPx));
    outputPartEl.style.height = `${next}px`;
  },
  () => localStorage.setItem(OUTPUT_HEIGHT_KEY, String(Math.round(outputPartEl.getBoundingClientRect().height))),
  'y',
);

// ---------------------------------------------------------------------------
// 出力設定フィールド (書式/文字サイズ/解像度/色/透過) の変更でプレビューを再描画
// ---------------------------------------------------------------------------

formatEl.addEventListener('change', () => scheduleRender());
fontSizeEl.addEventListener('input', () => scheduleRender());
scaleEl.addEventListener('input', () => scheduleRender());
paddingPxEl.addEventListener('input', () => scheduleRender());
fontColorEl.addEventListener('input', () => scheduleRender());
backgroundColorEl.addEventListener('input', () => scheduleRender());
transparentBgEl.addEventListener('change', () => {
  updateTransparentBgUI();
  scheduleRender();
});

// ---------------------------------------------------------------------------
// 入力欄: 変更時の統合処理 (プレビュー再描画/Undo履歴/dirty/サジェスト) とスクロール同期
// ---------------------------------------------------------------------------

inputEl.addEventListener('input', () => {
  adjustAutoClosedPositions(previousInputValue, inputEl.value);
  previousInputValue = inputEl.value;
  updateSourceButtonState();
  scheduleRender();
  scheduleHistoryCommit();
  updateDirtyFromContent();
  updateSuggestPopup();
  refreshInputOverlay();
});

inputEl.addEventListener('scroll', () => {
  // gutterは overflow:hidden だが、JSからscrollTopを操作すれば表示内容自体は追従する
  // (ユーザーの手動スクロール操作自体は受け付けない=行番号側にスクロールバーを出さない)。
  gutterEl.scrollTop = inputEl.scrollTop;
  syncInputOverlayScroll();
  if (!suggestPopupEl.classList.contains('hidden')) positionSuggestPopup();
  updateActiveBracketHighlight();
});

// ---------------------------------------------------------------------------
// キーボードショートカット
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (ev) => {
  const mod = ev.ctrlKey || ev.metaKey;
  if (!mod) return;
  const key = ev.key.toLowerCase();

  if (key === 'z' || key === 'y') {
    // 他のテキスト欄(テンプレート名入力・テンプレート編集欄等)ではブラウザ標準のUndo/Redoに任せる
    if (document.activeElement !== inputEl) return;
    ev.preventDefault();
    if (key === 'y' || ev.shiftKey) redo();
    else undo();
    return;
  }
  if (key === 's') {
    ev.preventDefault();
    void doSave().catch((e) => setStatus(t('status.saveFailed', { message: e instanceof Error ? e.message : String(e) }), 'err'));
    return;
  }
  if (key === 'c' && ev.shiftKey) {
    ev.preventDefault();
    void doCopy();
  }
});

// 開いているモーダルをEscapeでまとめて閉じる(優先度: 終了確認 > 削除確認等 > テンプレート名
// 入力 > 設定 > ヘルプ。同時に複数開くことは無いが、念のため上から順に1つだけ処理する)。
window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!exitConfirmOverlayEl.classList.contains('hidden')) {
    closeExitConfirm();
  } else if (!confirmOverlayEl.classList.contains('hidden')) {
    resolveConfirmDialog(false);
  } else if (!templateNamePromptOverlayEl.classList.contains('hidden')) {
    closeTemplateNamePrompt();
  } else if (!settingsOverlayEl.classList.contains('hidden')) {
    closeSettings();
  } else if (!helpOverlayEl.classList.contains('hidden')) {
    closeHelp();
  }
});

// ---------------------------------------------------------------------------
// 終了時の保存フロー
// ---------------------------------------------------------------------------
// 「未保存の変更がある場合のみ」終了時に介入する。設定「終了時の保存」の値で分岐する:
//   - 確認する(既定): 3択モーダルを表示。「ソース保存して終了」は doSaveSource() と全く同じ
//     動作(Save Asダイアログを開く)。
//   - 自動保存する: 確認なしでEquashareホームディレクトリ直下へ連番付きで保存してから終了。
//   - 保存しない: 確認なしでそのまま終了(未保存のまま)。
// appWindow.close() をこの中から呼ぶと onCloseRequested が再度発火するため、
// forceCloseNext フラグで「もう介入しない」ことを明示する(無限ループ防止)。

function getExitSaveMode(): 'confirm' | 'auto' | 'none' {
  const v = localStorage.getItem(EXIT_SAVE_KEY);
  return v === 'auto' || v === 'none' ? v : 'confirm';
}

let quitRequested = false;

async function closeWindowNow(): Promise<void> {
  if (quitRequested) {
    await invoke('quit_application');
  } else {
    await appWindow.hide();
  }
  quitRequested = false;
}

function openExitConfirm(): void {
  exitConfirmOverlayEl.classList.remove('hidden');
  btnExitSave.focus();
}
function closeExitConfirm(): void {
  exitConfirmOverlayEl.classList.add('hidden');
}

async function performAutoSaveAndClose(): Promise<void> {
  try {
    const dir = await getHomeDirectory();
    setStatus(t('status.autoSaving'));
    await invoke('autosave_source', { dir, text: inputEl.value });
    markContentClean();
    await closeWindowNow();
  } catch (e) {
    // 「保存に失敗した場合は、通常の保存確認と同様にエラーを表示し、終了せず編集画面に戻る」
    setStatus(t('status.autoSaveFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
  }
}

btnExitSave.addEventListener('click', () => {
  void (async () => {
    const path = await doSaveSource().catch((e) => {
      setStatus(t('status.sourceSaveFailed', { message: e instanceof Error ? e.message : String(e) }), 'err');
      return null;
    });
    closeExitConfirm();
    if (path) await closeWindowNow();
    else quitRequested = false;
    // pathがnull(ダイアログでキャンセル、または保存失敗)の場合は編集画面に留まる
  })();
});
btnExitDiscard.addEventListener('click', () => {
  closeExitConfirm();
  inputEl.value = cleanBaseline;
  inputEl.dispatchEvent(new Event('input'));
  markContentClean();
  void closeWindowNow();
});
btnExitCancel.addEventListener('click', () => { quitRequested = false; closeExitConfirm(); });
exitConfirmOverlayEl.addEventListener('click', (ev) => {
  if (ev.target === exitConfirmOverlayEl) { quitRequested = false; closeExitConfirm(); }
});

async function handleCloseRequest(): Promise<void> {
  if (!isDirty) { await closeWindowNow(); return; }
  const mode = getExitSaveMode();
  if (mode === 'none') {
    inputEl.value = cleanBaseline;
    inputEl.dispatchEvent(new Event('input'));
    markContentClean();
    await closeWindowNow();
  } else if (mode === 'auto') {
    await performAutoSaveAndClose();
  } else {
    openExitConfirm();
  }
}

void appWindow.onCloseRequested((event) => {
  event.preventDefault();
  void handleCloseRequest();
});
void appWindow.listen('tray-quit-request', () => {
  quitRequested = true;
  void handleCloseRequest();
});

// ---------------------------------------------------------------------------
// 簡易入力ポップアップ用グローバルショートカット (v4.0で追加、v4.0.1でON/OFF・
// キー入力による記録機能を追加)
// ---------------------------------------------------------------------------
// メインウィンドウが生きている間だけ登録すればよい(このアプリはメインウィンドウを
// 閉じるとプロセスごと終了する構成のため、ここでの登録が実質アプリの生存期間と一致する)。
// コールバックは「quickpopup」ラベルの(あらかじめtauri.conf.jsonで定義済みの)非表示
// ウィンドウを表示してフォーカスするだけ。実際の入力・レンダリング・コピー処理は
// quickpopup.html側(src/quickPopup.ts)が独立して行う。
const DEFAULT_QUICK_POPUP_SHORTCUT = 'CommandOrControl+Shift+E';

function getQuickPopupShortcut(): string {
  return localStorage.getItem(QUICK_POPUP_HOTKEY_KEY) || DEFAULT_QUICK_POPUP_SHORTCUT;
}

function isQuickPopupHotkeyEnabled(): boolean {
  return (localStorage.getItem(QUICK_POPUP_HOTKEY_ENABLED_KEY) ?? 'on') !== 'off';
}

/** accelerator文字列(例: "CommandOrControl+Shift+E")を、OSに応じた見た目の表記
 * (macOSなら"⌘+Shift+E"、それ以外なら"Ctrl+Shift+E")へ変換する。表示専用で、
 * 実際にTauriへ渡す値は常にCommandOrControlのまま保持する。 */
function formatAcceleratorForDisplay(accel: string): string {
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent || '');
  return accel
    .split('+')
    .map((part) => (part === 'CommandOrControl' ? (isMac ? '⌘' : 'Ctrl') : part))
    .join('+');
}

function openQuickPopup(): void {
  const popup = WebviewWindow.getByLabel('quickpopup');
  if (!popup) return;
  void popup.show();
  void popup.unminimize();
  void popup.setFocus();
}

let registeredQuickPopupShortcut: string | null = null;
let browserForeground = false;
let nativeMessagingEnabled = false;
let shortcutOperation: Promise<boolean> = Promise.resolve(true);

void appWindow.listen<boolean>('browser-focus-changed', ({ payload }) => {
  browserForeground = payload;
  void applyQuickPopupShortcut();
});

/** 現在の設定(有効/無効・ショートカット文字列)をOSへ反映する。既に別の文字列で
 * 登録済みの場合は、まずそれを解除してから登録し直す(Tauriのregister()は既存の
 * 登録を自動的に置き換えてはくれないため)。起動時・ON/OFF切り替え時・記録完了時の
 * いずれからも呼ばれる共通処理。戻り値はOS側への登録に成功したかどうか
 * (無効化のみの場合は常にtrue)。 */
async function applyQuickPopupShortcutNow(): Promise<boolean> {
  if (registeredQuickPopupShortcut) {
    try {
      await unregisterGlobalShortcut(registeredQuickPopupShortcut);
    } catch (e) {
      console.error('Failed to unregister previous quick popup shortcut:', e);
    }
    registeredQuickPopupShortcut = null;
  }
  // ブラウザが前面にあり連携が有効なら、同じキーを拡張機能へ渡す。
  if (!shouldRegisterDesktopShortcut(isQuickPopupHotkeyEnabled(), browserForeground, nativeMessagingEnabled)) return true;
  const shortcut = getQuickPopupShortcut();
  try {
    if (await isGlobalShortcutRegistered(shortcut)) {
      await unregisterGlobalShortcut(shortcut);
    }
    await registerGlobalShortcut(shortcut, openQuickPopup);
    registeredQuickPopupShortcut = shortcut;
    return true;
  } catch (e) {
    // OS側で既に他アプリに割り当て済み等、失敗しても致命的ではない。
    console.error('Failed to register quick popup shortcut:', e);
    return false;
  }
}

function applyQuickPopupShortcut(): Promise<boolean> {
  const next = shortcutOperation.then(() => applyQuickPopupShortcutNow());
  shortcutOperation = next.catch(() => false);
  return next;
}

async function registerQuickPopupShortcut(): Promise<void> {
  browserForeground = await invoke<boolean>('is_browser_foreground').catch(() => false);
  nativeMessagingEnabled = await invoke<boolean>('is_native_messaging_host_registered').catch(() => false);
  await applyQuickPopupShortcut();
}

function updateQuickPopupHotkeyUI(): void {
  const enabled = isQuickPopupHotkeyEnabled();
  syncToggleBtn(settingQuickPopupHotkeyEnabledEl, enabled);
  if (quickPopupHotkeyRecording) return; // 録音中の表示("キーを押してください...")は上書きしない
  settingQuickPopupHotkeyDisplayEl.classList.remove('recording');
  settingQuickPopupHotkeyDisplayEl.value = enabled
    ? formatAcceleratorForDisplay(getQuickPopupShortcut())
    : t('settings.quickPopupHotkey.unset');
}

/** キーボードイベント1回分から、Tauriのグローバルショートカット向けaccelerator文字列
 * (例: "CommandOrControl+Shift+E")を組み立てる。表記はElectronのAccelerator仕様に
 * 準拠する(Tauri v1のglobalShortcutは内部的に同じ表記を踏襲しているため)。
 * 修飾キー単体を押しただけの状態やEscape(録音キャンセル専用に予約)、IME確定前の
 * 合成キー等、まだ組み合わせが確定しない場合はnullを返す。 */
function keyEventToAccelerator(ev: KeyboardEvent): { accelerator: string; hasModifier: boolean } | null {
  const key = ev.key;
  if (key === 'Escape' || key === 'Process' || key === 'Unidentified') return null;
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'FnLock'].includes(key)) {
    return null; // 修飾キー単体では確定させず、非修飾キーが押されるまで録音を継続する
  }

  const NAMED_KEY_MAP: Record<string, string> = {
    ' ': 'Space', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  };

  let keyName: string | null = null;
  if (/^[a-zA-Z]$/.test(key)) {
    keyName = key.toUpperCase();
  } else if (/^[0-9]$/.test(key)) {
    keyName = key;
  } else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) {
    keyName = key; // F1〜F24
  } else if (key in NAMED_KEY_MAP) {
    keyName = NAMED_KEY_MAP[key];
  } else if (key.length === 1) {
    // その他の印字可能な記号( , . / ; ' [ ] \ - = ` など)はElectron形式ではそのまま
    // 文字を使う。Shiftとの組み合わせで得られる記号(例: Shift+, -> "<")もそのまま扱う。
    keyName = key;
  }
  if (keyName === null) return null; // 未対応キー

  const mods: string[] = [];
  if (ev.ctrlKey || ev.metaKey) mods.push('CommandOrControl');
  if (ev.altKey) mods.push('Alt');
  if (ev.shiftKey) mods.push('Shift');

  return { accelerator: [...mods, keyName].join('+'), hasModifier: mods.length > 0 };
}

let quickPopupHotkeyRecording = false;

/** ショートカットの記録を開始する。次に押された(修飾キーを含む)キーの組み合わせを
 * 新しいショートカットとして保存し、OSへ反映する。Escapeでキャンセルできる。
 * ブラウザ標準のショートカット(Ctrl+S等)が誤発火しないよう、キャプチャ段階で
 * preventDefault/stopPropagationする。 */
function startRecordingQuickPopupHotkey(): void {
  if (quickPopupHotkeyRecording) return;
  quickPopupHotkeyRecording = true;
  settingQuickPopupHotkeyDisplayEl.classList.add('recording');
  settingQuickPopupHotkeyDisplayEl.value = t('settings.quickPopupHotkey.recording');

  const cleanup = (): void => {
    quickPopupHotkeyRecording = false;
    window.removeEventListener('keydown', onKeyDown, true);
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      cleanup();
      updateQuickPopupHotkeyUI();
      return;
    }
    const result = keyEventToAccelerator(ev);
    if (!result) return; // 修飾キー単体などはまだ確定させず、次のキー入力を待つ
    if (!result.hasModifier) {
      setStatus(t('settings.quickPopupHotkey.invalid'), 'err');
      return; // 録音は継続する(Escで抜けるかやり直せる)
    }
    cleanup();
    void (async () => {
      localStorage.setItem(QUICK_POPUP_HOTKEY_KEY, result.accelerator);
      const ok = await applyQuickPopupShortcut();
      updateQuickPopupHotkeyUI();
      if (ok) {
        setStatus(t('settings.quickPopupHotkey.changed', { shortcut: formatAcceleratorForDisplay(result.accelerator) }), 'ok');
      } else {
        setStatus(t('settings.quickPopupHotkey.conflict'), 'err');
      }
    })();
  };

  window.addEventListener('keydown', onKeyDown, true);
}

btnChangeQuickPopupHotkey.addEventListener('click', startRecordingQuickPopupHotkey);
settingQuickPopupHotkeyEnabledEl.addEventListener('click', () => {
  const next = !isQuickPopupHotkeyEnabled();
  localStorage.setItem(QUICK_POPUP_HOTKEY_ENABLED_KEY, next ? 'on' : 'off');
  void applyQuickPopupShortcut().then((ok) => {
    updateQuickPopupHotkeyUI();
    if (next && !ok) setStatus(t('settings.quickPopupHotkey.conflict'), 'err');
  });
});

// ---------------------------------------------------------------------------
// ブラウザ拡張機能との連携(Native Messaging、v4.0.1)
// ---------------------------------------------------------------------------
// Windowsのレジストリへホストマニフェストを登録/解除するだけの薄いUI。実際の
// 登録処理・プロトコルはRust側(src-tauri/src/native_host.rs)が担う。

async function updateNativeMessagingUI(): Promise<void> {
  try {
    const registered = await invoke<boolean>('is_native_messaging_host_registered');
    nativeMessagingEnabled = registered;
    void applyQuickPopupShortcut();
    settingNativeMessagingStatusEl.value = registered
      ? t('settings.nativeMessaging.enabled')
      : t('settings.nativeMessaging.disabled');
    btnToggleNativeMessaging.textContent = registered
      ? t('settings.nativeMessaging.disable')
      : t('settings.nativeMessaging.enable');
  } catch {
    nativeMessagingEnabled = false;
    // Windows以外(register/unregister/is_registeredがUnsupportedを返す環境)。
    settingNativeMessagingStatusEl.value = t('settings.nativeMessaging.unsupported');
    btnToggleNativeMessaging.disabled = true;
  }
}

btnToggleNativeMessaging.addEventListener('click', () => {
  void (async () => {
    const registered = await invoke<boolean>('is_native_messaging_host_registered').catch(() => false);
    try {
      if (registered) {
        await invoke('unregister_native_messaging_host');
        setStatus(t('settings.nativeMessaging.disableSuccess'), 'ok');
      } else {
        await invoke('register_native_messaging_host');
        setStatus(t('settings.nativeMessaging.enableSuccess'), 'ok');
      }
    } catch (e) {
      setStatus(t('settings.nativeMessaging.error', { message: String(e) }), 'err');
    }
    await updateNativeMessagingUI();
  })();
});

// ---------------------------------------------------------------------------
// 起動時のウィンドウ表示タイミング (指示書2: 体感速度の改善)
// ---------------------------------------------------------------------------
// tauri.conf.json 側で "visible": false にしてあるため、初期化(初回プレビュー描画)が
// 完了してから明示的に表示する。requestAnimationFrameを2回連続で呼ぶのは、1回目のrAFは
// 「次の再描画の直前」に発火するだけで、その時点ではまだ実際の描画が確定していないため
// (2回目のrAFが発火した時点で、1回目のrAF後にスケジュールされた描画が確定している)。
// 万一初期化が長引いた場合(低スペック環境等)に備え、タイムアウトで強制的に表示する。
function showWindowWhenReady(): void {
  let shown = false;
  const doShow = () => {
    if (shown) return;
    shown = true;
    void appWindow.show();
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(doShow);
  });
  window.setTimeout(doShow, 500);
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------

function init(): void {
  applyI18nToDom(); // v3.0: 保存済み言語設定をヘルプ本文含む全data-i18n要素に反映
  applyUiScale(getUiScalePercent());
  applyTmplScale(getTmplScalePercent());
  const savedTheme = localStorage.getItem(THEME_KEY);
  applyTheme(savedTheme === 'light' ? 'light' : 'dark');
  applyZoom();
  restoreLayout();
  applyStartupOutputDefaults(); // 2.5: 保存済みの既定値をformat/fontSize/scale/paddingPx/transparentBgへ適用
  updateTransparentBgUI();
  setButtonsEnabled(false);

  // CJKフォント読み込み完了後、「読み込み中」だった行を正しい内容で自動的に再レンダリングする
  // (指示書2: opentype.js動的import化)。
  setCJKFontReadyListener(() => {
    renderPreview();
  });

  if (isDefaultTextEnabled() && !inputEl.value) {
    inputEl.value = DEFAULT_INPUT;
  }
  historyBaseline = inputEl.value;
  cleanBaseline = inputEl.value;
  undoStack = [];
  redoStack = [];
  resetAutoClosedTracking();
  refreshInputOverlay();

  updateSourceButtonState();
  // v4.0: テンプレートはファイル由来の非同期読み込みになったため、初回のツールバー
  // 反映だけはキャッシュ読み込み完了を待つ(以降の操作は起動直後のこの一瞬を除けば
  // 常にキャッシュ済みなので、他の呼び出し箇所は同期のままでよい)。
  void ensureTemplatesLoaded().then(() => {
    refreshUserTemplateSelect();
  });
  renderPreview();
  setDirty(false); // 起動直後(デフォルトサンプルの自動投入含む)は「未保存の変更」ではない

  void ensureHistoryLoaded();
  void registerQuickPopupShortcut();

  // Native Messaging経由(拡張機能から「選択中の数式をアプリへ送る」)で、簡易入力
  // ポップアップに数式を渡す目的だけでこのプロセスが新規起動された場合は、メイン画面
  // まで前面に出すと意図しないポップアップに見えてしまうため、自動表示をスキップする
  // (簡易入力ポップアップ自体の表示・フォーカスはRust側のsetup()で行う)。
  void invoke<boolean>('should_start_main_hidden')
    .catch(() => false)
    .then((hidden) => {
      if (!hidden) showWindowWhenReady();
    });
}

init();
