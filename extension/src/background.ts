/**
 * background.ts (MV3 service worker)
 *
 * TypeScriptで書き、latexExtraction.tsのextractLatexFromSelection()をユニットテスト済みの
 * まま利用する(以前はpublic/background.jsとして素のJSで直接書いており、DOM抽出ロジックを
 * テストできなかった。v4.0.0でsrc/配下のビルドパイプラインに移した)。
 */
import { extractLatexFromSelection } from './latexExtraction';
import { sendSourceToDesktopApp } from './nativeHost';

const QUICK_POPUP_PREFILL_KEY = 'quickPopupPrefill';
const MAIN_PAGE_PREFILL_KEY = 'mainPagePrefill';
const QUICK_MENU_ID = 'equashare-quick';
const FULL_MENU_ID = 'equashare-full';

// ---------------------------------------------------------------------------
// ツールバーアイコン: 既存の「Equashare」タブがあればそれをフォーカスし、無ければ
// 新しいタブとしてindex.htmlを開く。
// ---------------------------------------------------------------------------

async function openOrFocusMainTab(): Promise<chrome.tabs.Tab | undefined> {
  const url = chrome.runtime.getURL('index.html');
  const existing = await chrome.tabs.query({ url });
  const tab = existing[0];
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return tab;
  }
  return chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => {
  void openOrFocusMainTab();
});

// ---------------------------------------------------------------------------
// グローバルホットキー(既定Ctrl+Shift+E)→ 簡易入力ポップアップ
// ---------------------------------------------------------------------------
// default_popupを常時manifestに固定すると、ツールバークリックがポップアップを開くように
// なってしまい上のonClickedが発火しなくなる(Chromeの仕様)。そのため「ホットキーが
// 押された時だけ一時的にpopupを設定してからopenPopup()し、開いた直後に空へ戻す」。
//
// このコマンドはmanifest.json側で"global": trueにしていない(Chromeの制約上、globalスコープの
// ショートカットはCtrl+Shift+[0-9]の数字キーしか使えず、既定のCtrl+Shift+Eを維持できないため)。
// そのためこのホットキーは「ブラウザにフォーカスがある間だけ」反応する。

async function openQuickPopup(): Promise<void> {
  try {
    await chrome.action.setPopup({ popup: 'popup.html' });
    await chrome.action.openPopup();
  } catch {
    // Native Messagingの応答待ちでユーザー操作の権限が失効した場合も表示できるようにする。
    await chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 380, height: 480 });
  } finally {
    await chrome.action.setPopup({ popup: '' });
  }
}

/** アクティブタブで選択されているテキストから、可能ならLaTeXソースを読み取る。
 * chrome://等のスクリプト注入が許可されないページや、アクティブタブが取得できない
 * 場合は空文字を返す(致命的にはしない=空欄のポップアップ/タブを開く方にフォールバックする)。 */
async function readSelectionFromTab(tabId: number): Promise<string> {
  // 選択がiframe内にあるページでは、メインフレームだけを注入しても空になる。
  // MAINはMathJaxのJSオブジェクト参照用、ISOLATEDはページ側のJSによる
  // グローバル改変などでMAINの実行に失敗した場合のDOM抽出用。
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    for (const allFrames of [true, false]) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames },
          world,
          func: extractLatexFromSelection,
        });
        const selected = results.find(({ result }) => typeof result === 'string' && result.length > 0)?.result;
        if (typeof selected === 'string') return selected;
        // MAINで選択が空ならISOLATED側からもDOMを調べる。
        if (allFrames) break;
      } catch {
        // 権限のないiframe等でallFramesが失敗したら、メインフレームで再試行。
      }
    }
  }
  return '';
}

async function readSelectionFromActiveTab(): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return '';
    return await readSelectionFromTab(tab.id);
  } catch {
    return '';
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'open-quick-popup') return;
  void (async () => {
    const text = await readSelectionFromActiveTab();
    if (text) {
      // 選択中の数式があれば、まずデスクトップアプリ側へ送ることを試みる
      // (Native Messaging。Chrome/Edgeが前面にある間アプリ側がショートカットを譲るため、
      // そもそもこのブラウザ側ハンドラまでキー入力が届く=実質的な優先度切り替えになる)。
      // ホスト未登録・アプリとの中継失敗などで送れなかった場合は、これまで通り
      // 拡張機能自身の簡易入力ポップアップへフォールバックする。
      const sentToApp = await sendSourceToDesktopApp(text);
      if (sentToApp) return;
      await chrome.storage.session.set({ [QUICK_POPUP_PREFILL_KEY]: text });
    }
    await openQuickPopup();
  })();
});

// ---------------------------------------------------------------------------
// Webページ上でのLaTeX選択 → 右クリックメニュー
// ---------------------------------------------------------------------------
// info.selectionText(ブラウザが返す「見た目のテキスト」)はMathJaxの描画済みグリフを
// そのまま拾ってしまい ^2 や \sqrt 等の構文が失われるため使わない。代わりに
// chrome.scripting.executeScript でページ内のDOMから直接LaTeXソースを取り直す
// (extractLatexFromSelection、ホットキーの場合と全く同じロジック)。
// なお、MathJax自身が数式上への右クリックに独自メニューを出す設定の場合、ページの
// contextmenuイベントがpreventDefault()されてブラウザの標準メニュー(と、そこに載っている
// この拡張機能のメニュー項目)自体が表示されないことがある。これは拡張機能側では制御でき
// ない仕様上の制約であり、その場合はCtrl+Shift+Eの方を使えば同じ抽出ロジックで代替できる。

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: QUICK_MENU_ID,
    title: 'Equashareで簡易表示',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: FULL_MENU_ID,
    title: 'Equashareで表示',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    let text = '';
    if (tab?.id !== undefined) {
      text = await readSelectionFromTab(tab.id);
    }
    // DOM抽出が(未対応ページ等で)失敗した場合の最終フォールバックとして、
    // ブラウザが渡してくる「見たままのテキスト」だけは使う(空文字よりまし)。
    if (!text) text = info.selectionText ?? '';
    if (!text) return;

    if (info.menuItemId === QUICK_MENU_ID) {
      await chrome.storage.session.set({ [QUICK_POPUP_PREFILL_KEY]: text });
      await openQuickPopup();
      return;
    }

    if (info.menuItemId === FULL_MENU_ID) {
      await chrome.storage.session.set({ [MAIN_PAGE_PREFILL_KEY]: text });
      await openOrFocusMainTab();
    }
  })();
});
