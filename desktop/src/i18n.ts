// ---------------------------------------------------------------------------
// 英語対応 (v3.0)
// ---------------------------------------------------------------------------
// キー文字列 -> 表示文字列 の単純な辞書方式。
// - 通常のテキスト/属性は data-i18n / data-i18n-title / data-i18n-aria-label /
//   data-i18n-placeholder 属性をHTML側に付け、applyI18nToDom()で一括反映する。
// - ヘルプパネルの本文のように<code>/<b>等のタグを含む長文は、1つのキーに
//   HTML文字列としてまとめ、data-i18n-html で innerHTML を丸ごと差し替える
//   (各<li>ごとにキーを分割すると翻訳の保守性が悪化するため)。
// - ステータス表示・確認ダイアログなど動的に組み立てる文字列は t()/tHtml() を
//   main.ts側から直接呼び出す。{{name}} のようなプレースホルダーを params で置換する。

export type Lang = 'ja' | 'en';

const LANG_KEY = 'mathimg.lang';

function detectDefaultLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'ja';
  return nav.toLowerCase().startsWith('ja') ? 'ja' : 'ja'; // 既定値は常に日本語(既存ユーザーの体験を変えないため)
}

let currentLang: Lang = ((): Lang => {
  if (typeof localStorage === 'undefined') return detectDefaultLang();
  const saved = localStorage.getItem(LANG_KEY);
  return saved === 'en' || saved === 'ja' ? saved : detectDefaultLang();
})();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, lang);
}

const DICT: Record<Lang, Record<string, string>> = {
  ja: {
    'app.unsavedDot.title': '未保存の変更があります',
    'layout.splitterH.title': 'ドラッグで高さ調整(または左右キーで調整)',
    'layout.splitterH.ariaLabel': '入力欄と設定欄の境界線',
    'layout.splitterV.title': 'ドラッグで幅調整(または上下キーで調整)',
    'layout.splitterV.ariaLabel': '編集パネルとプレビューの境界線',
    'header.help.title': '使い方・仕様',
    'header.help.ariaLabel': '使い方を表示',
    'header.history.title': '履歴を参照',
    'header.history.ariaLabel': '数式・出力の履歴を表示',
    'header.settings.title': '設定',
    'header.settings.ariaLabel': '設定を開く',
    'header.theme.title': 'ライト/ダーク切替',
    'header.theme.ariaLabel': 'ライトテーマとダークテーマを切り替え',
    'templateEditBar.editing': '「{{name}}」を編集中',

    'toolbar.userTemplateSelect.title': 'ユーザーテンプレートを挿入',
    'toolbar.userTemplateSelect.placeholder': 'ユーザーテンプレートを挿入...',
    'toolbar.sampleSelect.title': 'サンプルを挿入',
    'toolbar.sampleSelect.placeholder': 'サンプルを挿入...',
    'sample.recurrence': '漸化式',
    'sample.definiteIntegral': '定積分',
    'sample.sum': '総和',
    'sample.limit': '極限',
    'sample.matrix': '行列',
    'sample.euler': 'オイラーの等式',
    'sample.text': 'テキスト',
    'sample.array': '表(array)',
    'sample.vectorDot': 'ベクトル（内積）',
    'sample.fermat': 'フェルマーの小定理',

    'tmpl.frac.title': '分数',
    'tmpl.sqrt.title': '根号',
    'tmpl.sup.title': '上付き',
    'tmpl.sub.title': '下付き',
    'tmpl.sum.title': '総和',
    'tmpl.int.title': '積分',
    'tmpl.lim.title': '極限',
    'tmpl.text.title': 'テキストを挿入',
    'tmpl.mathbb.title': '黒板太字 (\\mathbb)',
    'tmpl.overrightarrow.title': 'ベクトル (\\overrightarrow, 矢印は上に)',
    'tmpl.vec.title': 'ベクトル (\\vec)',
    'tmpl.eqTrigger.title': '比較演算子(ホバーまたはEnterで選択肢を表示)',
    'tmpl.gt.title': '> (\\gt)',
    'tmpl.lt.title': '< (\\lt)',
    'tmpl.ge.title': '≥ (\\ge)',
    'tmpl.le.title': '≤ (\\le)',
    'tmpl.neq.title': '≠ (\\neq)',
    'tmpl.approx.title': '≈ (\\approx)',
    'tmpl.equiv.title': '≡ (\\equiv、合同記号)',
    'tmpl.pmod.title': '合同式のmod (\\pmod{n})',
    'tmpl.infty.title': '無限大',
    'tmpl.table.title': '表(array)',
    'tmpl.parenAuto.title': '自動サイズ調整かっこ (\\left( \\right)、選択範囲があればそれを囲む)',
    'tmpl.bracketAuto.title': '自動サイズ調整角かっこ (\\left[ \\right]、選択範囲があればそれを囲む)',
    'tmpl.braceAuto.title': '自動サイズ調整波かっこ (\\left\\{ \\right\\}、選択範囲があればそれを囲む)',
    'tmpl.quad.title': 'quad空白 (\\quad)',

    'input.ariaLabel': 'LaTeX数式入力',
    'suggestPopup.ariaLabel': 'LaTeXコマンド候補',
    'suggest.userMacro': '定義済み',

    'preview.ariaLabel': '数式プレビュー',
    'preview.label': 'プレビュー',
    'preview.zoomOut.title': '縮小 (Ctrl+ホイール)',
    'preview.zoomOut.ariaLabel': 'プレビューを縮小',
    'preview.zoomIn.title': '拡大 (Ctrl+ホイール)',
    'preview.zoomIn.ariaLabel': 'プレビューを拡大',
    'preview.zoomReset.title': 'リセット',
    'preview.zoomReset.ariaLabel': 'プレビュー倍率をリセット',

    'output.format': '出力形式',
    'output.fontSize': '文字サイズ (px)',
    'output.scale': '解像度倍率',
    'output.paddingPx': '余白 (px)',
    'output.fontColor': '文字色',
    'output.backgroundColor': '背景色',
    'output.transparentBg': '背景を透過にする(PNG/SVG)',

    'actions.copy.title': 'Ctrl+Shift+C',
    'actions.copy.ariaLabel': '選択した形式でクリップボードにコピー',
    'actions.copy.text': 'クリップボードにコピー',
    'actions.otherCopy.title': 'Unicodeに変換またはMathMLとしてコピー',
    'actions.otherCopy.text': 'その他のコピー',
    'actions.copyUnicode.text': 'Unicodeに変換してコピー',
    'actions.copyMathML.text': 'MathMLとしてコピー',
    'actions.save.title': 'Ctrl+S',
    'actions.save.ariaLabel': '選択した形式で画像ファイルを保存',
    'actions.save.text': '画像ファイルを保存...',
    'actions.saveSource.ariaLabel': '入力欄のLaTeXソースを保存',
    'actions.saveSource.text': 'ソースを保存 (.tex)...',
    'actions.saveAsTemplate.ariaLabel': '現在の入力をユーザーテンプレートとして保存',
    'actions.saveAsTemplate.text': '現在のソースをテンプレートとして保存',
    'actions.saveAsTemplate.overwriteText': '「{{name}}」を上書きして保存',
    'actions.saveAsTemplate.overwriteAriaLabel': 'テンプレート「{{name}}」を現在のソースで上書き保存',
    'actions.templateEditCancel.title': '編集モードを終了(通常の「テンプレートとして保存」に戻る)',
    'actions.templateEditCancel.ariaLabel': 'テンプレート編集モードを終了',
    'actions.templateEditCancel.text': '編集をキャンセル',

    'help.title': '使い方・仕様',
    'help.close.title': '閉じる',
    'help.close.ariaLabel': 'ヘルプを閉じる',
    'help.body': `
        <h3>基本の使い方</h3>
        <ul>
          <li>左上の入力欄に、1行につき1つの数式(LaTeX記法)を書きます。<code>$$</code>や<code>\\begin{align}</code>は不要です。入力するとリアルタイムで右側にプレビューが表示されます。</li>
          <li>複数行入力すると、左揃えで縦に並べて1枚の画像として合成されます。</li>
          <li>1つの数式をコード上では読みやすく複数行に分けて書きつつ、画像側では改行させたくない場合は、その範囲を <code>\\begin{nobreak}</code> と <code>\\end{nobreak}</code>(それぞれ単独の行)で囲みます。間の行は空白区切りで1つの数式として結合され、1行として描画されます。<code>\\begin{nobreak}</code>/<code>\\end{nobreak}</code> 自体は本来のLaTeX記法ではなくこのアプリ独自のマーカーのため、画像には出力されません。</li>
          <li>連続する複数行がそれぞれ <code>&amp;</code> を1つ以上含む場合、<code>\\begin{align}</code>環境を書かなくても、その<code>&amp;</code>の位置を行同士で縦に揃えて描画します(align環境の見た目に近い動作。<code>&amp;</code>を含まない行が来ると揃えは区切られます)。</li>
          <li>文章(日本語含む)を書きたい場合は <code>\\text{ここに文章}</code> のように <code>\\text{}</code> で囲みます。</li>
          <li>数式は常に displaystyle(<code>$$...$$</code>相当の大きな表示)でレンダリングされます。</li>
        </ul>

        <h3>出力・保存</h3>
        <ul>
          <li><b>出力形式</b>: SVG / PNG から選べます。</li>
          <li><b>クリップボードにコピー</b>: 選択中の形式に関わらず、常にPNGとしてラスタ画像をコピーします。</li>
          <li><b>画像ファイルを保存...</b>: 選択中の形式でファイルとして保存します(保存するまでファイルは作られません)。デフォルトのファイル名は「Equashare image」です。</li>
          <li><b>ソースを保存 (.tex)...</b>: 入力欄の数式だけをUTF-8の<code>.tex</code>テキストとして保存します。デフォルトのファイル名は「Equashare tex」です。</li>
          <li><b>その他のコピー</b>: PNG画像としてのコピー以外に、数式をプレーンテキストへ変換してコピーする<b>Unicodeに変換してコピー</b>(上付き・下付き文字などをUnicodeの近い文字で表現します。対応する文字が無い場合は<code>^(...)</code>/<code>_(...)</code>という表記にフォールバックします)と、<b>MathMLとしてコピー</b>(Word等、MathMLの貼り付けに対応したアプリ向け)を選べます。</li>
          <li>初めて保存するファイルはEquashareホームディレクトリ(下記参照)を初期の保存先とし、以降の保存はディレクトリを問わず直前に保存した場所を記憶します。</li>
        </ul>

        <h3>入力補助</h3>
        <ul>
          <li><b>ユーザーテンプレートを挿入</b>: 自分で保存したテンプレートをカーソル位置に挿入します。</li>
          <li><b>現在のソースをテンプレートとして保存</b>: 入力欄の内容をテンプレートとして保存します。名前を入力するポップアップが表示され、同じ名前で保存すると上書きされます。管理(名前の編集・削除)は設定(⚙)内の「テンプレートを管理」から行えます。</li>
          <li><b>サンプルを挿入</b>: よく使う数式のひな形をカーソル位置に挿入します。</li>
          <li><b>分数・√・x^y など</b>の「よく使う記法」ボタン: クリックでカーソル位置にスニペットを挿入します。</li>
          <li><b>サジェスト</b>: 入力欄で <code>\\</code> を入力すると、対応するLaTeXコマンドと入力済みの<code>\\newcommand</code>マクロの候補がポップアップします。候補には実際に挿入される<code>{}</code>や<code>_{}^{}</code>等も表示され、インテグラル(<code>\\int</code>系)・シグマ・ラージパイ・極限(<code>\\lim</code>系)などは、素のコマンドと添字付き(例: <code>\\int</code> と <code>\\int_{}^{}</code>)の両方が候補に出ます。上下キーで選択、Tab/Enterで確定、Escで閉じます。設定(⚙)からON/OFFできます。</li>
          <li><b>Tabキーでスペース挿入</b>: 入力欄にカーソルがある状態で <code>Tab</code> を押すと、カーソル位置にスペースが挿入されます(サジェスト候補の表示中はTabで確定が優先されます)。挿入するスペースの数は設定(⚙)の「Tabキーで挿入するスペース数」から変更できます。</li>
          <li>入力欄の左側に行番号を表示します。MathJaxが解釈できない行は<span class="err-sample">赤色</span>で示され、その行のプレビューにも赤字で「Syntax Error」と1行だけ表示されます(その行だけがエラー表示になり、他の行の表示は継続します)。</li>
        </ul>

        <h3>プレビュー操作</h3>
        <ul>
          <li>ズームボタン、または <code>Ctrl</code>+マウスホイールで拡大縮小できます。</li>
          <li>プレビュー領域をドラッグするとパン(視点移動)できます。</li>
        </ul>

        <h3>キーボードショートカット</h3>
        <ul>
          <li><code>Ctrl(⌘)+S</code>: 画像ファイルを保存</li>
          <li><code>Ctrl(⌘)+Shift+C</code>: クリップボードにコピー</li>
          <li><code>Ctrl(⌘)+Z</code>: 元に戻す(入力欄)</li>
          <li><code>Ctrl(⌘)+Y</code> または <code>Ctrl(⌘)+Shift+Z</code>: やり直し(入力欄)</li>
          <li><code>Ctrl+Shift+E</code>(既定値。設定(⚙)の「簡易入力ポップアップのショートカット」から変更・OFFにできます): どの画面からでも、数式入力と画像コピーだけができる簡易入力ポップアップを開く(グローバルショートカット。アプリがバックグラウンドにあっても動作します)。</li>
        </ul>

        <h3>レイアウト</h3>
        <ul>
          <li>入力欄と設定欄の間の境界線(横線)をドラッグすると、それぞれの高さを調整できます。</li>
          <li>左側の編集パネルとプレビューの間の境界線(縦線)をドラッグすると、幅を調整できます。</li>
          <li>これらのサイズやテーマ(ライト/ダーク)、最後に保存したフォルダは次回起動時も記憶されます。</li>
        </ul>

        <h3>終了時の保存・未保存表示</h3>
        <ul>
          <li>未保存の変更があるとタイトルの「Equashare」の横にポチが表示され、ウィンドウタイトルにも <code>●</code> が付きます。ソースを保存すると消えます。</li>
          <li>未保存の変更がある状態でアプリを終了しようとすると、設定(⚙)の「終了時の保存」に応じて確認・自動保存・何もしないのいずれかの動作をします。</li>
        </ul>

        <h3>設定(⚙)</h3>
        <ul>
          <li><b>言語</b>: 日本語 / English を切り替えられます。</li>
          <li><b>UIサイズ</b>: アプリ全体の文字サイズ・ボタンサイズを一括で調整できます。<b>よく使う記法・保存/コピー等ボタンのサイズ</b>はこれとは別に調整できます。</li>
          <li><b>サジェスト</b> / <b>デフォルトテキスト</b>(起動時にサンプル数式を自動投入するか) のON/OFF</li>
          <li><b>選択範囲を括弧で囲む</b>: ONの場合、入力欄でテキストを選択した状態で <code>(</code> <code>[</code> <code>{</code> などを押すと、選択範囲をその括弧で囲みます(OFFの場合は選択範囲を置き換えます)。</li>
          <li><b>Tabキーで挿入するスペース数</b> / <b>履歴の保持件数</b>(コピー・保存操作の履歴として保持する件数): 数値で指定します。</li>
          <li><b>終了時の保存</b>: 確認する(既定) / 自動保存する / 保存しない</li>
          <li><b>Equashareホームディレクトリ</b>: 画像・ソースの保存先の初期ディレクトリ。テンプレートやテーマなどのアプリ設定はここではなくアプリ内部に保存されます。</li>
          <li><b>簡易入力ポップアップのショートカット</b>: 「変更...」ボタンを押してから任意のキーを押すと、そのキーの組み合わせ(修飾キー必須)が新しいショートカットとして登録されます。Escでキャンセルできます。右側のON/OFFで機能自体を無効化することもできます(既定は<code>Ctrl(⌘)+Shift+E</code>でON)。</li>
          <li><b>ブラウザ拡張機能との連携</b>(Windows版のみ): 「連携を設定...」を押すと、Chrome/Edge向けのNative Messagingホストとしてこのアプリをレジストリへ登録します。設定すると、Equashare拡張機能側でブラウザ上の数式を選択して<code>Ctrl+Shift+E</code>を押した際に、その数式がこのアプリの簡易入力ポップアップへ直接送られます(アプリが起動していなければ自動的に起動します)。<b>Chrome/Edgeが前面にある間はアプリ側が自動的にショートカットを譲り、拡張機能が選択テキストを取得します。ブラウザ以外が前面のときはアプリ側の簡易表示が開きます。</b></li>
          <li><b>既定の出力設定(起動時)</b>: 出力形式・文字サイズ・解像度倍率・余白・背景の透過有無の初期値をここで設定できます。ここでの変更は次回起動時から適用され、起動中に上部の出力設定欄で変えた内容とは独立です。</li>
          <li><b>テンプレートを管理</b>: 保存したユーザーテンプレートの一覧・編集・削除。管理画面右上のボタンから、テンプレート一式をファイルへエクスポート/ファイルからインポートできます。インポート時に同名のテンプレートがある場合は、上書きする・名前を変更して追加する・インポートをキャンセルする、のいずれかを選べます。</li>
        </ul>

        <h3>対応しているLaTeX記法(制限事項)</h3>
        <p>
          バンドルサイズ軽量化のため、MathJaxの全パッケージではなく以下のパッケージのみを
          読み込んでいます。
        </p>
        <ul>
          <li><code>base</code>: 基本的な数式・分数・根号・添字・ギリシャ文字・行列/表環境・<code>\\left \\right</code>など</li>
          <li><code>ams</code>: AMS-LaTeXの記法(<code>\\dfrac</code>、<code>\\begin{pmatrix}</code>、<code>\\text</code>、各種矢印など)</li>
          <li><code>boldsymbol</code>: <code>\\boldsymbol{}</code>(数式太字)</li>
          <li><code>color</code>: <code>\\color{}</code>(文字色)</li>
          <li><code>mathtools</code>: <code>amsmath</code>の拡張記法</li>
          <li><code>newcommand</code>: <code>\\newcommand</code>によるマクロ定義</li>
        </ul>
        <p>
          <code>src/mathRender.ts</code>の<code>MATH_PACKAGES</code>配列に追加することで追加可能です。
        </p>

        <h3>日本語フォントについて</h3>
        <p>
          <code>\\text{}</code>内の日本語は同梱フォント(Noto Serif JP)のアウトラインを直接埋め込むため、
          実行環境に日本語フォントが無くても正しく表示されます。フォント自体は初めて日本語を含む行を
          入力したタイミングで読み込まれるため、日本語を使わない場合は読み込まれません。
        </p>
    `,

    'settings.title': '設定',
    'settings.close.title': '閉じる',
    'settings.close.ariaLabel': '設定を閉じる',
    'settings.display.title': '表示',
    'settings.language': '言語',
    'settings.uiScale': 'UIサイズ(文字・ボタン)',
    'settings.tmplScale': 'よく使う記法・保存/コピー等ボタンのサイズ',
    'settings.suggest': 'サジェスト',
    'settings.defaultText': 'デフォルトテキスト',
    'settings.bracketWrapSelection': '選択範囲を括弧で囲む',
    'settings.tabSize': 'Tabキーで挿入するスペース数',
    'settings.historyLimit': '履歴の保持件数',
    'settings.exitSave': '終了時の保存',
    'settings.exitSave.confirm': '確認する',
    'settings.exitSave.auto': '自動保存する',
    'settings.exitSave.none': '保存しない',
    'settings.homeDir': 'Equashareホームディレクトリ',
    'settings.homeDir.loading': '(取得中...)',
    'settings.homeDir.change': '変更...',
    'settings.quickPopupHotkey': '簡易入力ポップアップのショートカット',
    'settings.quickPopupHotkey.change': '変更...',
    'settings.quickPopupHotkey.recording': 'キーを押してください(Escでキャンセル)',
    'settings.quickPopupHotkey.unset': '未設定(OFF)',
    'settings.quickPopupHotkey.invalid': 'Ctrl・Alt・Shift・Cmdのいずれかを含む組み合わせを指定してください',
    'settings.quickPopupHotkey.conflict': 'このショートカットは登録できませんでした(他のアプリと競合している可能性があります)',
    'settings.quickPopupHotkey.changed': 'ショートカットを変更しました: {{shortcut}}',
    'settings.nativeMessaging': 'ブラウザ拡張機能との連携',
    'settings.nativeMessaging.enable': '連携を設定...',
    'settings.nativeMessaging.disable': '連携を解除...',
    'settings.nativeMessaging.desc': 'Equashare拡張機能をChrome/Edgeにインストール済みの場合、ここで連携を設定すると、ブラウザで数式を選択してCtrl+Shift+Eを押したときにこのアプリの簡易入力ポップアップへ直接送れるようになります(この設定はWindows版のみ)。',
    'settings.nativeMessaging.enabled': '連携済み',
    'settings.nativeMessaging.disabled': '未設定',
    'settings.nativeMessaging.unsupported': 'この環境では利用できません',
    'settings.nativeMessaging.enableSuccess': '拡張機能との連携を設定しました',
    'settings.nativeMessaging.disableSuccess': '拡張機能との連携を解除しました',
    'settings.nativeMessaging.error': '連携の設定に失敗しました: {{message}}',
    'settings.outputDefaults.title': '既定の出力設定(起動時)',
    'settings.outputDefaults.desc': '起動のたびにこの内容へ初期化されます(セッション中の変更は次回起動時にリセットされます)。',
    'settings.manageTemplates': 'テンプレートを管理 ›',

    'templateManage.back.title': '設定に戻る',
    'templateManage.back.ariaLabel': '設定一覧に戻る',
    'templateManage.heading': 'テンプレートを管理',
    'templateManage.empty': '保存されたテンプレートはありません。',
    'templateManage.editing': '変更中',
    'templateManage.editingTitle': 'このテンプレートは現在メイン画面で編集中です',
    'templateManage.edit': '変更',
    'templateManage.delete': '削除',
    'templateManage.deleteConfirm': 'テンプレート「{{name}}」を削除しますか?',
    'templateManage.import.title': 'テンプレートをインポート',
    'templateManage.import.ariaLabel': 'JSONファイルからテンプレートをインポート',
    'templateManage.export.title': 'テンプレートをエクスポート',
    'templateManage.export.ariaLabel': 'テンプレートをJSONファイルへエクスポート',

    'templateImportConflict.title': '同名のテンプレートがあります',
    'templateImportConflict.message': '以下の{{count}}件は、インポート先に同名のテンプレートが既に存在します:\n{{names}}\n\nどうしますか?',
    'templateImportConflict.overwrite': '上書きする',
    'templateImportConflict.rename': '名前を変更して追加',
    'templateImportConflict.cancel': 'インポートをキャンセル',

    'history.title': '履歴',
    'history.close.title': '閉じる',
    'history.close.ariaLabel': '履歴を閉じる',
    'history.empty': 'まだ履歴はありません(コピーまたは保存すると記録されます)。',
    'history.load': '読み込む',
    'history.copyAgain': '再コピー',
    'history.delete': '削除',
    'history.deleteConfirm': 'この履歴を削除しますか?',
    'history.clearAll': '履歴をすべて削除',
    'history.clearAllConfirm': '履歴をすべて削除しますか?この操作は取り消せません。',
    'history.loadConfirm': '現在の入力内容を破棄して、この履歴の内容を読み込みますか?',
    'history.action.copyImage': '画像コピー',
    'history.action.copySvgText': 'SVGコピー',
    'history.action.copyUnicode': 'Unicode変換コピー',
    'history.action.copyMathML': 'MathMLコピー',
    'history.action.saveImage': '画像保存',
    'history.action.saveSource': 'ソース保存',

    'confirm.title': '確認',
    'confirm.cancel': 'キャンセル',
    'confirm.loadTemplate': '現在の入力には保存されていない変更があります。破棄してテンプレート「{{name}}」を読み込みますか?',
    'confirm.loadTemplate.ok': '読み込む',

    'templateNamePrompt.title': 'テンプレート名を入力してください',
    'templateNamePrompt.ariaLabel': 'テンプレート名',
    'templateNamePrompt.save': '保存',
    'templateNamePrompt.cancel': 'キャンセル',
    'templateNamePrompt.defaultName': 'テンプレート{{n}}',

    'exitConfirm.title': 'ソースを保存して終了しますか?',
    'exitConfirm.save': 'ソース保存して終了',
    'exitConfirm.discard': 'ソースを保存せず終了',
    'exitConfirm.cancel': 'キャンセル',

    'status.syntaxErrors': '{{count}}行に構文エラーがあります',
    'status.undefinedCommand': '{{line}}行目: {{command}} は未定義のコマンドです({{count}}行に構文エラー)',
    'status.syntaxErrorDetail': '{{line}}行目: {{message}}({{count}}行に構文エラー)',
    'status.loadingCjkFont': '日本語フォントを読み込み中...',
    'status.error': 'エラー: {{message}}',
    'status.copyCancelled': 'コピーをキャンセルしました',
    'status.copying': 'コピー中...',
    'status.copied': 'クリップボードにコピーしました',
    'status.copiedUnicode': 'Unicodeに変換してコピーしました',
    'status.copiedMathML': 'MathMLとしてコピーしました',
    'status.copyFailed': 'コピー失敗: {{message}}',

    'quickPopup.placeholder': 'LaTeXを入力...',
    'quickPopup.copy': '画像をコピー',
    'quickPopup.copy.title': 'Ctrl+Enterでもコピーできます',
    'quickPopup.copying': 'コピー中...',
    'quickPopup.copied': 'コピーしました',
    'quickPopup.openMain': '編集画面へ',

    'status.saving': '保存中...',
    'status.saveCancelled': '保存をキャンセルしました',
    'status.saved': '保存しました: {{path}}',
    'status.saveFailed': '保存失敗: {{message}}',
    'status.noSourceToSave': '保存する数式がありません',
    'status.savingSource': 'ソースを保存中...',
    'status.sourceSaved': 'ソースを保存しました: {{path}}',
    'status.sourceSaveFailed': 'ソース保存失敗: {{message}}',
    'status.templateLoaded': 'テンプレート「{{name}}」を読み込みました',
    'status.historyLoaded': '履歴から読み込みました',
    'status.templateOverwritten': 'テンプレート「{{name}}」を上書きして保存しました',
    'status.templateSaved': 'テンプレート「{{name}}」として保存しました',
    'status.templatesLoadFailed': 'テンプレートの読み込みに失敗しました: {{message}}',
    'status.templatesSaveFailed': 'テンプレートの保存に失敗しました: {{message}}',
    'status.templatesExporting': 'エクスポート中...',
    'status.templatesExportCancelled': 'エクスポートをキャンセルしました',
    'status.templatesExported': 'テンプレートをエクスポートしました: {{path}}',
    'status.templatesExportFailed': 'エクスポート失敗: {{message}}',
    'status.templatesImporting': 'インポート中...',
    'status.templatesImportCancelled': 'インポートをキャンセルしました',
    'status.templatesImported': '{{count}}件のテンプレートをインポートしました',
    'status.templatesImportFailed': 'インポート失敗: {{message}}',
    'status.templatesImportInvalid': '有効なテンプレートデータが見つかりませんでした',
    'status.homeDirChangeFailed': 'ディレクトリの変更に失敗しました: {{message}}',
    'status.autoSaving': '自動保存中...',
    'status.autoSaveFailed': '自動保存に失敗しました: {{message}}',
    'export.confirmTitle': '出力サイズの確認',
    'export.confirmMessage': '出力画像が約{{mp}}メガピクセルと非常に大きく、書き出しに時間がかかったり、メモリを多く消費したりする可能性があります。続行しますか?',
    'error.noPreview': 'プレビューがありません',
    'error.noFormulaToRender': 'レンダリングする数式がありません。',
  },
  en: {
    'app.unsavedDot.title': 'You have unsaved changes',
    'layout.splitterH.title': 'Drag to resize height (or use left/right arrow keys)',
    'layout.splitterH.ariaLabel': 'Divider between the input box and settings area',
    'layout.splitterV.title': 'Drag to resize width (or use up/down arrow keys)',
    'layout.splitterV.ariaLabel': 'Divider between the editor panel and the preview',
    'header.help.title': 'Help & specs',
    'header.help.ariaLabel': 'Show help',
    'header.history.title': 'View history',
    'header.history.ariaLabel': 'Show formula/export history',
    'header.settings.title': 'Settings',
    'header.settings.ariaLabel': 'Open settings',
    'header.theme.title': 'Toggle light/dark theme',
    'header.theme.ariaLabel': 'Switch between light and dark theme',
    'templateEditBar.editing': 'Editing "{{name}}"',

    'toolbar.userTemplateSelect.title': 'Insert a user template',
    'toolbar.userTemplateSelect.placeholder': 'Insert user template...',
    'toolbar.sampleSelect.title': 'Insert a sample',
    'toolbar.sampleSelect.placeholder': 'Insert sample...',
    'sample.recurrence': 'Recurrence relation',
    'sample.definiteIntegral': 'Definite integral',
    'sample.sum': 'Summation',
    'sample.limit': 'Limit',
    'sample.matrix': 'Matrix',
    'sample.euler': "Euler's identity",
    'sample.text': 'Text',
    'sample.array': 'Table (array)',
    'sample.vectorDot': 'Vector (dot product)',
    'sample.fermat': "Fermat's little theorem",

    'tmpl.frac.title': 'Fraction',
    'tmpl.sqrt.title': 'Square root',
    'tmpl.sup.title': 'Superscript',
    'tmpl.sub.title': 'Subscript',
    'tmpl.sum.title': 'Summation',
    'tmpl.int.title': 'Integral',
    'tmpl.lim.title': 'Limit',
    'tmpl.text.title': 'Insert text',
    'tmpl.mathbb.title': 'Blackboard bold (\\mathbb)',
    'tmpl.overrightarrow.title': 'Vector (\\overrightarrow, arrow on top)',
    'tmpl.vec.title': 'Vector (\\vec)',
    'tmpl.eqTrigger.title': 'Comparison operators (hover or press Enter to show)',
    'tmpl.gt.title': '> (\\gt)',
    'tmpl.lt.title': '< (\\lt)',
    'tmpl.ge.title': '≥ (\\ge)',
    'tmpl.le.title': '≤ (\\le)',
    'tmpl.neq.title': '≠ (\\neq)',
    'tmpl.approx.title': '≈ (\\approx)',
    'tmpl.equiv.title': '≡ (\\equiv, congruence)',
    'tmpl.pmod.title': 'Congruence mod (\\pmod{n})',
    'tmpl.infty.title': 'Infinity',
    'tmpl.table.title': 'Table (array)',
    'tmpl.parenAuto.title': 'Auto-sized parentheses (\\left( \\right), wraps the selection if any)',
    'tmpl.bracketAuto.title': 'Auto-sized brackets (\\left[ \\right], wraps the selection if any)',
    'tmpl.braceAuto.title': 'Auto-sized braces (\\left\\{ \\right\\}, wraps the selection if any)',
    'tmpl.quad.title': 'Quad space (\\quad)',

    'input.ariaLabel': 'LaTeX formula input',
    'suggestPopup.ariaLabel': 'LaTeX command suggestions',
    'suggest.userMacro': 'defined',

    'preview.ariaLabel': 'Formula preview',
    'preview.label': 'Preview',
    'preview.zoomOut.title': 'Zoom out (Ctrl+wheel)',
    'preview.zoomOut.ariaLabel': 'Zoom out preview',
    'preview.zoomIn.title': 'Zoom in (Ctrl+wheel)',
    'preview.zoomIn.ariaLabel': 'Zoom in preview',
    'preview.zoomReset.title': 'Reset',
    'preview.zoomReset.ariaLabel': 'Reset preview zoom',

    'output.format': 'Output format',
    'output.fontSize': 'Font size (px)',
    'output.scale': 'Resolution scale',
    'output.paddingPx': 'Padding (px)',
    'output.fontColor': 'Text color',
    'output.backgroundColor': 'Background color',
    'output.transparentBg': 'Transparent background (PNG/SVG)',

    'actions.copy.title': 'Ctrl+Shift+C',
    'actions.copy.ariaLabel': 'Copy to clipboard in the selected format',
    'actions.copy.text': 'Copy to clipboard',
    'actions.otherCopy.title': 'Convert to Unicode or copy as MathML',
    'actions.otherCopy.text': 'Other copy formats',
    'actions.copyUnicode.text': 'Convert to Unicode and copy',
    'actions.copyMathML.text': 'Copy as MathML',
    'actions.save.title': 'Ctrl+S',
    'actions.save.ariaLabel': 'Save as an image file in the selected format',
    'actions.save.text': 'Save image file...',
    'actions.saveSource.ariaLabel': 'Save the LaTeX source in the input box',
    'actions.saveSource.text': 'Save source (.tex)...',
    'actions.saveAsTemplate.ariaLabel': 'Save the current input as a user template',
    'actions.saveAsTemplate.text': 'Save current source as template',
    'actions.saveAsTemplate.overwriteText': 'Overwrite "{{name}}"',
    'actions.saveAsTemplate.overwriteAriaLabel': 'Overwrite template "{{name}}" with the current source',
    'actions.templateEditCancel.title': 'Exit edit mode (back to normal "Save as template")',
    'actions.templateEditCancel.ariaLabel': 'Exit template edit mode',
    'actions.templateEditCancel.text': 'Cancel editing',

    'help.title': 'Help & specs',
    'help.close.title': 'Close',
    'help.close.ariaLabel': 'Close help',
    'help.body': `
        <h3>Basic usage</h3>
        <ul>
          <li>Write one formula (LaTeX) per line in the input box at the top left. No <code>$$</code> or <code>\\begin{align}</code> needed. The preview on the right updates in real time as you type.</li>
          <li>Multiple lines are stacked vertically, left-aligned, and composed into a single image.</li>
          <li>If you want to split one formula across several lines for readability in the source, but keep it as a single line in the image, wrap that range with <code>\\begin{nobreak}</code> and <code>\\end{nobreak}</code> (each on its own line). The lines in between are joined with spaces into one formula and rendered as a single line. <code>\\begin{nobreak}</code>/<code>\\end{nobreak}</code> are not real LaTeX; they are markers specific to this app and never appear in the output image.</li>
          <li>If consecutive lines each contain one or more <code>&amp;</code>, their <code>&amp;</code> positions are vertically aligned across those lines without writing a <code>\\begin{align}</code> environment (similar in appearance to the align environment; a line without <code>&amp;</code> breaks the alignment group).</li>
          <li>To write prose (including Japanese), wrap it in <code>\\text{}</code>, e.g. <code>\\text{some text here}</code>.</li>
          <li>Formulas are always rendered in displaystyle (the large presentation equivalent to <code>$$...$$</code>).</li>
        </ul>

        <h3>Output & saving</h3>
        <ul>
          <li><b>Output format</b>: choose SVG or PNG.</li>
          <li><b>Copy to clipboard</b>: always copies a rasterized PNG image regardless of the selected format.</li>
          <li><b>Save image file...</b>: saves a file in the selected format (no file is created until you save). The default file name is "Equashare image".</li>
          <li><b>Save source (.tex)...</b>: saves only the formulas in the input box as UTF-8 <code>.tex</code> text. The default file name is "Equashare tex".</li>
          <li><b>Other copy formats</b>: besides copying as a PNG image, you can also convert the formula to a plain-text approximation and copy it with <b>Convert to Unicode and copy</b> (represents things like sub/superscripts with the closest available Unicode characters; falls back to <code>^(...)</code>/<code>_(...)</code> notation when no matching character exists), or copy it as <b>MathML</b> (for apps that accept MathML paste, such as Word).</li>
          <li>The first file you save defaults to the Equashare home directory (see below); after that, saving remembers the last directory used, regardless of folder.</li>
        </ul>

        <h3>Input assistance</h3>
        <ul>
          <li><b>Insert user template</b>: inserts a template you saved yourself at the cursor position.</li>
          <li><b>Save current source as template</b>: saves the contents of the input box as a template. A popup asks for a name; saving under an existing name overwrites it. Manage templates (rename/delete) from "Manage templates" inside Settings (⚙).</li>
          <li><b>Insert sample</b>: inserts a common formula pattern at the cursor position.</li>
          <li><b>"Common notation" buttons</b> (fraction, √, x^y, etc.): click to insert a snippet at the cursor position.</li>
          <li><b>Suggestions</b>: typing <code>\\</code> in the input box pops up matching LaTeX commands and any <code>\\newcommand</code> macros you've already defined. Suggestions show the actual text that will be inserted, including <code>{}</code> or <code>_{}^{}</code>; for integrals (<code>\\int</code> family), sigma, capital pi, and limits (<code>\\lim</code> family) etc., both the bare command and the version with subscript/superscript placeholders (e.g. <code>\\int</code> and <code>\\int_{}^{}</code>) are offered. Use the arrow keys to select, Tab/Enter to confirm, Esc to close. Can be toggled from Settings (⚙).</li>
          <li><b>Insert space with Tab</b>: with the cursor in the input box, pressing <code>Tab</code> inserts spaces at the cursor position (while suggestions are shown, Tab confirms the selection instead). The number of spaces can be changed from "Number of spaces inserted by Tab" in Settings (⚙).</li>
          <li>Line numbers are shown on the left of the input box. Lines MathJax can't parse are shown in <span class="err-sample">red</span>, and the preview for that line shows a single red "Syntax Error" line (only that line is affected; other lines keep rendering).</li>
        </ul>

        <h3>Preview controls</h3>
        <ul>
          <li>Zoom in/out with the zoom buttons or <code>Ctrl</code>+mouse wheel.</li>
          <li>Drag the preview area to pan.</li>
        </ul>

        <h3>Keyboard shortcuts</h3>
        <ul>
          <li><code>Ctrl(⌘)+S</code>: save image file</li>
          <li><code>Ctrl(⌘)+Shift+C</code>: copy to clipboard</li>
          <li><code>Ctrl(⌘)+Z</code>: undo (input box)</li>
          <li><code>Ctrl(⌘)+Y</code> or <code>Ctrl(⌘)+Shift+Z</code>: redo (input box)</li>
          <li><code>Ctrl+Shift+E</code> (default; change or turn off from "Quick input popup shortcut" in Settings (⚙)): opens a quick input popup, usable from any screen, that supports just formula input and copying the image (a global shortcut that works even while the app is in the background).</li>
        </ul>

        <h3>Layout</h3>
        <ul>
          <li>Drag the horizontal divider between the input box and the settings area to resize their heights.</li>
          <li>Drag the vertical divider between the editor panel and the preview to resize their widths.</li>
          <li>These sizes, the theme (light/dark), and the last-used save folder are remembered across restarts.</li>
        </ul>

        <h3>Exit behavior & unsaved indicator</h3>
        <ul>
          <li>When there are unsaved changes, a dot appears next to "Equashare" in the title, and <code>●</code> appears in the window title as well. Saving the source clears it.</li>
          <li>If you try to quit with unsaved changes, the app will confirm, auto-save, or do nothing, depending on the "Save on exit" setting (⚙).</li>
        </ul>

        <h3>Settings (⚙)</h3>
        <ul>
          <li><b>Language</b>: switch between Japanese and English.</li>
          <li><b>UI size</b>: adjusts the app's overall text size and button size together. <b>The size of the "common notation" and save/copy buttons</b> can be adjusted separately from this.</li>
          <li><b>Suggestions</b> / <b>Default text</b> (whether a sample formula is auto-filled on startup): ON/OFF</li>
          <li><b>Wrap selection in brackets</b>: when ON, selecting text in the input box and pressing <code>(</code>, <code>[</code>, <code>{</code>, etc. wraps the selection in that bracket pair (when OFF, it replaces the selection instead).</li>
          <li><b>Number of spaces inserted by Tab</b> / <b>History size</b> (how many copy/save actions are kept in history): set as numbers.</li>
          <li><b>Save on exit</b>: confirm (default) / auto-save / don't save</li>
          <li><b>Equashare home directory</b>: the initial save location for images/sources. App settings such as templates and theme are stored internally, not here.</li>
          <li><b>Quick input popup shortcut</b>: click "Change...", then press the key combination (a modifier key is required) you want to use; it's registered immediately. Press Esc to cancel while recording. The ON/OFF switch next to it disables the feature entirely (default: <code>Ctrl(⌘)+Shift+E</code>, ON).</li>
          <li><b>Browser extension integration</b> (Windows only): clicking "Set up integration..." registers this app in the registry as a Native Messaging host for Chrome/Edge. Once set up, selecting a formula in the browser and pressing <code>Ctrl+Shift+E</code> in the Equashare extension sends that formula straight to this app's quick input popup (launching the app automatically if it isn't already running). <b>While Chrome/Edge is foreground, the desktop app releases the shortcut so the extension can capture selected text. Outside the browser, the desktop app opens its own quick popup.</b></li>
          <li><b>Default output settings (on startup)</b>: sets the initial output format, font size, resolution scale, padding, and background transparency. Changes here take effect starting next launch, independent of anything you change in the output settings area at the top while the app is running.</li>
          <li><b>Manage templates</b>: list, edit, and delete your saved user templates. Buttons in the top right of the management screen let you export all templates to a file, or import them from one. If an imported template's name already exists, you can choose to overwrite it, rename and add it, or cancel the import.</li>
        </ul>

        <h3>Supported LaTeX syntax (limitations)</h3>
        <p>
          To keep the bundle size small, only the following MathJax packages are loaded, not the full set.
        </p>
        <ul>
          <li><code>base</code>: basic formulas, fractions, roots, subscripts, Greek letters, matrix/table environments, <code>\\left \\right</code>, etc.</li>
          <li><code>ams</code>: AMS-LaTeX syntax (<code>\\dfrac</code>, <code>\\begin{pmatrix}</code>, <code>\\text</code>, various arrows, etc.)</li>
          <li><code>boldsymbol</code>: <code>\\boldsymbol{}</code> (bold math)</li>
          <li><code>color</code>: <code>\\color{}</code> (text color)</li>
          <li><code>mathtools</code>: extensions to <code>amsmath</code></li>
          <li><code>newcommand</code>: macro definitions via <code>\\newcommand</code></li>
        </ul>
        <p>
          You can add more by adding to the <code>MATH_PACKAGES</code> array in <code>src/mathRender.ts</code>.
        </p>

        <h3>About the Japanese font</h3>
        <p>
          Japanese text inside <code>\\text{}</code> is rendered by embedding outlines from a bundled font (Noto Serif JP) directly, so it displays correctly even without a Japanese font installed on the running environment. The font itself is only loaded the first time a line containing Japanese text appears, so it's never loaded if you don't use Japanese.
        </p>
    `,

    'settings.title': 'Settings',
    'settings.close.title': 'Close',
    'settings.close.ariaLabel': 'Close settings',
    'settings.display.title': 'Display',
    'settings.language': 'Language',
    'settings.uiScale': 'UI size (text & buttons)',
    'settings.tmplScale': 'Size of common-notation / save-copy buttons',
    'settings.suggest': 'Suggestions',
    'settings.defaultText': 'Default text',
    'settings.bracketWrapSelection': 'Wrap selection in brackets',
    'settings.tabSize': 'Number of spaces inserted by Tab',
    'settings.historyLimit': 'Number of history entries to keep',
    'settings.exitSave': 'Save on exit',
    'settings.exitSave.confirm': 'Confirm',
    'settings.exitSave.auto': 'Auto-save',
    'settings.exitSave.none': "Don't save",
    'settings.homeDir': 'Equashare home directory',
    'settings.homeDir.loading': '(loading...)',
    'settings.homeDir.change': 'Change...',
    'settings.quickPopupHotkey': 'Quick input popup shortcut',
    'settings.quickPopupHotkey.change': 'Change...',
    'settings.quickPopupHotkey.recording': 'Press a key combination (Esc to cancel)',
    'settings.quickPopupHotkey.unset': 'Not set (OFF)',
    'settings.quickPopupHotkey.invalid': 'Please include at least one of Ctrl, Alt, Shift, or Cmd',
    'settings.quickPopupHotkey.conflict': 'Could not register this shortcut (it may conflict with another app)',
    'settings.quickPopupHotkey.changed': 'Shortcut changed: {{shortcut}}',
    'settings.nativeMessaging': 'Browser extension integration',
    'settings.nativeMessaging.enable': 'Set up integration...',
    'settings.nativeMessaging.disable': 'Remove integration...',
    'settings.nativeMessaging.desc': 'If you have the Equashare extension installed in Chrome/Edge, setting up integration here lets you select a formula in the browser and press Ctrl+Shift+E to send it straight to this app\u2019s quick input popup (Windows only).',
    'settings.nativeMessaging.enabled': 'Integrated',
    'settings.nativeMessaging.disabled': 'Not set up',
    'settings.nativeMessaging.unsupported': 'Not available on this platform',
    'settings.nativeMessaging.enableSuccess': 'Extension integration has been set up',
    'settings.nativeMessaging.disableSuccess': 'Extension integration has been removed',
    'settings.nativeMessaging.error': 'Failed to set up integration: {{message}}',
    'settings.outputDefaults.title': 'Default output settings (on startup)',
    'settings.outputDefaults.desc': 'Reset to these values every time the app starts (changes made during a session reset on next launch).',
    'settings.manageTemplates': 'Manage templates ›',

    'templateManage.back.title': 'Back to settings',
    'templateManage.back.ariaLabel': 'Back to settings list',
    'templateManage.heading': 'Manage templates',
    'templateManage.empty': 'No saved templates.',
    'templateManage.editing': 'Editing',
    'templateManage.editingTitle': 'This template is currently being edited in the main view',
    'templateManage.edit': 'Edit',
    'templateManage.delete': 'Delete',
    'templateManage.deleteConfirm': 'Delete template "{{name}}"?',
    'templateManage.import.title': 'Import templates',
    'templateManage.import.ariaLabel': 'Import templates from a JSON file',
    'templateManage.export.title': 'Export templates',
    'templateManage.export.ariaLabel': 'Export templates to a JSON file',

    'templateImportConflict.title': 'Duplicate template names found',
    'templateImportConflict.message': 'The following {{count}} template(s) already exist at the import destination:\n{{names}}\n\nWhat would you like to do?',
    'templateImportConflict.overwrite': 'Overwrite',
    'templateImportConflict.rename': 'Rename and add',
    'templateImportConflict.cancel': 'Cancel import',

    'history.title': 'History',
    'history.close.title': 'Close',
    'history.close.ariaLabel': 'Close history',
    'history.empty': 'No history yet (recorded when you copy or save).',
    'history.load': 'Load',
    'history.copyAgain': 'Copy again',
    'history.delete': 'Delete',
    'history.deleteConfirm': 'Delete this history entry?',
    'history.clearAll': 'Clear all history',
    'history.clearAllConfirm': 'Clear all history? This cannot be undone.',
    'history.loadConfirm': 'Discard the current input and load this history entry?',
    'history.action.copyImage': 'Copied image',
    'history.action.copySvgText': 'Copied SVG',
    'history.action.copyUnicode': 'Converted to Unicode',
    'history.action.copyMathML': 'Copied MathML',
    'history.action.saveImage': 'Saved image',
    'history.action.saveSource': 'Saved source',

    'confirm.title': 'Confirm',
    'confirm.cancel': 'Cancel',
    'confirm.loadTemplate': 'The current input has unsaved changes. Discard them and load template "{{name}}"?',
    'confirm.loadTemplate.ok': 'Load',

    'templateNamePrompt.title': 'Enter a template name',
    'templateNamePrompt.ariaLabel': 'Template name',
    'templateNamePrompt.save': 'Save',
    'templateNamePrompt.cancel': 'Cancel',
    'templateNamePrompt.defaultName': 'Template {{n}}',

    'exitConfirm.title': 'Save source before exiting?',
    'exitConfirm.save': 'Save source and exit',
    'exitConfirm.discard': 'Exit without saving source',
    'exitConfirm.cancel': 'Cancel',

    'status.syntaxErrors': '{{count}} line(s) have a syntax error',
    'status.undefinedCommand': 'Line {{line}}: {{command}} is not a defined command ({{count}} line(s) with errors)',
    'status.syntaxErrorDetail': 'Line {{line}}: {{message}} ({{count}} line(s) with errors)',
    'status.loadingCjkFont': 'Loading Japanese font...',
    'status.error': 'Error: {{message}}',
    'status.copyCancelled': 'Copy cancelled',
    'status.copying': 'Copying...',
    'status.copied': 'Copied to clipboard',
    'status.copiedUnicode': 'Converted to Unicode and copied',
    'status.copiedMathML': 'Copied as MathML',
    'status.copyFailed': 'Copy failed: {{message}}',

    'quickPopup.placeholder': 'Type LaTeX...',
    'quickPopup.copy': 'Copy image',
    'quickPopup.copy.title': 'You can also press Ctrl+Enter to copy',
    'quickPopup.copying': 'Copying...',
    'quickPopup.copied': 'Copied',
    'quickPopup.openMain': 'Open editor',

    'status.saving': 'Saving...',
    'status.saveCancelled': 'Save cancelled',
    'status.saved': 'Saved: {{path}}',
    'status.saveFailed': 'Save failed: {{message}}',
    'status.noSourceToSave': 'No formula to save',
    'status.savingSource': 'Saving source...',
    'status.sourceSaved': 'Source saved: {{path}}',
    'status.sourceSaveFailed': 'Source save failed: {{message}}',
    'status.templateLoaded': 'Loaded template "{{name}}"',
    'status.historyLoaded': 'Loaded from history',
    'status.templateOverwritten': 'Overwrote and saved template "{{name}}"',
    'status.templateSaved': 'Saved as template "{{name}}"',
    'status.templatesLoadFailed': 'Failed to load templates: {{message}}',
    'status.templatesSaveFailed': 'Failed to save templates: {{message}}',
    'status.templatesExporting': 'Exporting...',
    'status.templatesExportCancelled': 'Export cancelled',
    'status.templatesExported': 'Templates exported: {{path}}',
    'status.templatesExportFailed': 'Export failed: {{message}}',
    'status.templatesImporting': 'Importing...',
    'status.templatesImportCancelled': 'Import cancelled',
    'status.templatesImported': 'Imported {{count}} template(s)',
    'status.templatesImportFailed': 'Import failed: {{message}}',
    'status.templatesImportInvalid': 'No valid template data was found',
    'status.homeDirChangeFailed': 'Failed to change directory: {{message}}',
    'status.autoSaving': 'Auto-saving...',
    'status.autoSaveFailed': 'Auto-save failed: {{message}}',
    'export.confirmTitle': 'Confirm output size',
    'export.confirmMessage': 'The output image is very large (about {{mp}} megapixels), so exporting may take time or use a lot of memory. Continue?',
    'error.noPreview': 'No preview available',
    'error.noFormulaToRender': 'No formula to render.',
  },
};

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (key in params ? String(params[key]) : `{{${key}}}`));
}

/** 指定キーの現在言語の文字列を返す(パラメータ置換つき)。キーが無ければキー自体を返す
 * (未翻訳箇所が画面上ですぐ分かるようにするための、意図的なフォールバック)。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const s = DICT[currentLang][key] ?? DICT.ja[key] ?? key;
  return interpolate(s, params);
}

/** data-i18n系属性を持つ要素をすべて現在言語の内容へ差し替える。
 * - data-i18n: textContent
 * - data-i18n-html: innerHTML (ヘルプ本文など、タグを含む長文専用)
 * - data-i18n-title / data-i18n-aria-label / data-i18n-placeholder: 対応する属性
 * document.documentElement.lang もあわせて更新する。 */
export function applyI18nToDom(root: ParentNode = document): void {
  document.documentElement.lang = currentLang;

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (key) el.innerHTML = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
    const key = el.dataset.i18nAriaLabel;
    if (key) el.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) el.placeholder = t(key);
  });
}
