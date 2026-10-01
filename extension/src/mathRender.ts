/**
 * mathRender.ts (browser / Tauri WebView 版)
 *
 * VSCode拡張版 (mathRenderer.ts) と同じアルゴリズムを、Node依存 (fs/path/sharp) なしで
 * ブラウザ環境(WebView)だけで完結するように移植したもの。
 *
 *   - MathJax (mathjax-full, liteAdaptor) は DOM 不要でそのまま動く
 *   - opentype.js はブラウザ純正動作 (ArrayBuffer を渡すだけ)
 *   - ラスタライズ(PNG)やPDF化は行わない。ここで作るのは「1枚に合成したSVG文字列」まで。
 *     実際のラスタライズ/PDF変換は Rust 側 (resvg / svg2pdf) に SVG 文字列を渡して行う設計。
 *     -> リアルタイムプレビューは、このSVGをそのまま <div innerHTML> に差し込むだけで良いので高速。
 */

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor, LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
// MathMLコピー機能用。composeSvgとは別に、TeXの内部表現(MmlNodeツリー)をそのまま
// MathMLタグへシリアライズするための部品。OutputJaxをSVGにしたまま
// `end: STATE.CONVERT` を指定して convert() を呼べば、レンダリング(SVG化)の手前で
// 処理を止めてMmlNodeツリーだけを受け取れる。既存のSVGレンダリング用コンテキストを
// そのまま使い回せるため、\newcommand マクロの状態もSVGプレビューと一致する。
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';
import { STATE } from 'mathjax-full/js/core/MathItem.js';
// opentype.js (実測516KB) は静的importせず、CJK(日本語など)フォールバックが実際に
// 必要になった行が現れた時点で初めて動的importする。詳細は「CJK フォールバック」節を参照。

// 各パッケージの「登録」は、対応する Configuration.js を import した副作用で行われる
// (MathJax本体の AllPackages.js も内部的に同じ方式)。下の MATH_PACKAGES 配列に
// 名前を書くだけでは何も登録されず、対応パッケージのマクロ(\dfrac, \cfrac, \boldsymbol,
// \textcolor, \newcommand 等)が軒並み "Undefined control sequence" になっていたのが
// 過去のバグの原因だった。新しくパッケージを増やす場合は、名前をMATH_PACKAGESに足す
// だけでなく、必ず対応するConfiguration.jsのimportも追加すること。
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js';
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
// 'noundefined' パッケージは意図的に含めていない: このパッケージは未定義コマンドを
// エラーにせず、"\hoge" のような生のマクロ名をそのまま文字として描画してしまうため、
// アプリの「構文エラー行を検出して赤くハイライトする」機能(data-mjx-error検出)が
// 効かなくなってしまう。noundefinedを外しても致命的なJS例外にはならない
// (MathJaxは既定でも merror としてグレースフルに描画するため)。

// バンドルサイズ削減のため、AllPackages(29種)ではなく実際によく使う数式で動作検証済みの
// 最小セットに絞り込んでいる。対象外: bbox(枠囲み), cancel(取り消し線), mhchem(化学式),
// braket, bussproofs, physics記法など。これらが必要になった場合は下記配列に追加すること
// (MathJaxのAllPackagesが提供する全パッケージ名から選べる)。
const MATH_PACKAGES = ['base', 'ams', 'boldsymbol', 'color', 'mathtools', 'newcommand'];

export interface RenderOptions {
  fontSizePx: number;
  lineGapPx: number;
  paddingPx: number;
  fontColor: string;
  backgroundColor: string;
  /** trueの場合、背景矩形を描画しない(PNG/SVGとも透過をサポートする)。 */
  transparentBackground?: boolean;
}

export const DEFAULT_OPTIONS: RenderOptions = {
  fontSizePx: 48,
  lineGapPx: 16,
  paddingPx: 24,
  fontColor: '#000000',
  backgroundColor: '#ffffff',
  transparentBackground: false,
};

// ---------------------------------------------------------------------------
// 入力行の分割 (GUI版はフォーマット指定行を使わないため、空行を除去するだけ)
// ---------------------------------------------------------------------------
export function splitLines(raw: string): string[] {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface NumberedLine {
  /** テキストエリア上の行番号(1始まり)。通常は1要素だが、`\begin{nobreak}`〜
   * `\end{nobreak}`で結合された行は、結合元となった全ての行番号を保持する
   * (構文エラー時にgutterで該当行すべてをハイライトするため)。 */
  lineNumbers: number[];
  text: string;
}

const NOBREAK_BEGIN_RE = /^\\begin\{nobreak\}$/;
const NOBREAK_END_RE = /^\\end\{nobreak\}$/;

/** splitLinesと同じ非空行抽出を行うが、元のテキストエリア上の行番号を保持する。
 * composeSvgのerrorLinesはこの配列の添字を指すため、gutter表示等で実際の行番号に
 * 変換する際はこの関数の出力とセットで使うこと。
 *
 * 加えて、`\begin{nobreak}`(単独行)から`\end{nobreak}`(単独行)までの間の行は、
 * 画像側で改行させたくない1つの論理行としてまとめて扱う。間の各行を空白区切りで
 * 連結し、`\begin{nobreak}`/`\end{nobreak}`自身(MathJaxが理解しないこのアプリ独自の
 * マーカー)は出力に含めない。
 *
 * `\end{nobreak}`が見つからないまま入力が終わった場合(例: 閉じタグを書き忘れた、
 * または`\`を落として`end{nobreak}`のようにタイポした)は、対応するcloseが無い
 * 不正な入力として扱う。この場合は中身を黙って結合するのではなく、`\begin{nobreak}`
 * 自身を出力テキストに残したまま1つの論理行にする。`nobreak`はMathJaxにとって
 * 未知の環境名なので、この行はcomposeSvg側でMathJaxが自然に構文エラーとして
 * 検出してくれる(=このアプリが独自にエラー判定ロジックを持つ必要がない)。 */
export function splitLinesWithNumbers(raw: string): NumberedLine[] {
  const physical = raw.replace(/\r\n/g, '\n').split('\n');
  const result: NumberedLine[] = [];
  let i = 0;
  while (i < physical.length) {
    const lineNumber = i + 1;
    const trimmed = physical[i].trim();
    if (NOBREAK_BEGIN_RE.test(trimmed)) {
      const buffer: string[] = [];
      const lineNumbers: number[] = [lineNumber];
      let closed = false;
      let j = i + 1;
      while (j < physical.length) {
        const innerTrimmed = physical[j].trim();
        lineNumbers.push(j + 1);
        if (NOBREAK_END_RE.test(innerTrimmed)) {
          closed = true;
          j++;
          break;
        }
        if (innerTrimmed) buffer.push(innerTrimmed);
        j++;
      }
      if (closed) {
        if (buffer.length > 0) {
          result.push({ lineNumbers, text: buffer.join(' ') });
        }
      } else {
        // \end{nobreak}で閉じられなかった: \begin{nobreak}自身を残し、MathJaxに
        // 構文エラーとして検出させる。
        result.push({ lineNumbers, text: ['\\begin{nobreak}', ...buffer].join(' ') });
      }
      i = j;
      continue;
    }
    if (trimmed) result.push({ lineNumbers: [lineNumber], text: trimmed });
    i++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// MathJax: TeX -> SVG
// ---------------------------------------------------------------------------

interface MathJaxContext {
  adaptor: LiteAdaptor;
  html: ReturnType<typeof mathjax.document>;
}

function createMathJaxContext(): MathJaxContext {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: MATH_PACKAGES });
  const svg = new SVG({ fontCache: 'local', unknownFamily: 'sans-serif' });
  const html = mathjax.document('', { InputJax: tex, OutputJax: svg });
  return { adaptor, html };
}

interface LineSvg {
  raw: string;
  viewBox: [number, number, number, number];
}

function renderLineToSvg(ctx: MathJaxContext, texLine: string): LineSvg & { hasError: boolean; errorMessage?: string } {
  const node = ctx.html.convert(normalizeVectorCommands(texLine), { display: true });
  const raw = ctx.adaptor.innerHTML(node as any);
  const m = raw.match(/viewBox="([^"]*)"/);
  if (!m) {
    throw new Error(`MathJaxのSVG出力からviewBoxを取得できませんでした: ${texLine}`);
  }
  const [minX, minY, w, h] = m[1].split(/\s+/).map(Number) as [number, number, number, number];
  // MathJaxはparse失敗時にJS例外を投げるのではなく、多くの場合(特にnoundefinedパッケージ
  // 有効時)は該当箇所を data-mjx-error 属性付きの <g data-mml-node="merror"> として
  // インライン描画し、処理自体は正常終了する。そのためtry/catchだけでは実際にはほぼ
  // エラーを検知できない。この属性の有無を見て初めて「この行は構文エラーを含む」と判定できる。
  const hasError = raw.includes('data-mjx-error');
  // data-mjx-error属性の値には「Undefined control sequence \hoge」のような具体的な
  // メッセージが入っている(MathJax自身が生成するもの)。これを拾えれば、単に
  // 「構文エラーです」ではなく「どのコマンドが未定義か」まで利用者に提示できる。
  // 属性値の取得に失敗しても致命的ではないため、そのままerrorMessageをundefinedにする。
  let errorMessage: string | undefined;
  if (hasError) {
    const em = raw.match(/data-mjx-error="([^"]*)"/);
    if (em) errorMessage = em[1];
  }
  return { raw, viewBox: [minX, minY, w, h], hasError, errorMessage };
}

/**
 * MathJaxの矢印付きベクトルは、引数の字形によってベースラインと高さが
 * 変わることがある。各引数に不可視の mathstrut を加えて、隣接する
 * `\\overrightarrow{a}\\overrightarrow{b}` や `\\vec{a}\\vec{b}` の高さを揃える。
 * 単純な正規表現では入れ子のTeX引数を壊すため、ここだけ小さな括弧パーサーを使う。
 */
function normalizeVectorCommands(tex: string): string {
  const commands = ['\\overrightarrow', '\\vec'];
  let out = '';
  let i = 0;
  while (i < tex.length) {
    const command = commands.find((name) => tex.startsWith(name, i) && tex[i + name.length] !== undefined);
    if (!command) {
      out += tex[i++];
      continue;
    }
    const braceStart = i + command.length;
    if (tex[braceStart] !== '{') {
      out += tex[i++];
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let j = braceStart; j < tex.length; j++) {
      if (tex[j] === '{' && (j === 0 || tex[j - 1] !== '\\')) depth++;
      if (tex[j] === '}' && (j === 0 || tex[j - 1] !== '\\')) {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) {
      out += tex[i++];
      continue;
    }
    const inner = tex.slice(braceStart + 1, end);
    const normalizedInner = /^\s*\\mathstrut\b/.test(inner) ? inner : `\\mathstrut ${inner}`;
    out += `${command}{${normalizedInner}}`;
    i = end + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CJK フォールバック <text> -> フォントアウトライン <path>
// ---------------------------------------------------------------------------

const CJK_FONT_URL = '/fonts/NotoSerifJP-Regular.woff';

type CjkFontState = 'unloaded' | 'loading' | 'ready';
let cjkFontState: CjkFontState = 'unloaded';
let cachedFont: any | null = null;
let cjkLoadPromise: Promise<void> | null = null;
let onCjkFontReady: (() => void) | null = null;

/** CJKフォントが読み込み完了した瞬間に1回だけ呼ばれるコールバックを登録する。
 * 「読み込み中」プレースホルダーになっていた行を自動で再レンダリングする用途
 * (呼び出し側で再度 composeSvg を呼び直すことを想定)。 */
export function setCJKFontReadyListener(callback: (() => void) | null): void {
  onCjkFontReady = callback;
}

/** CJKフォントの読み込み(動的import + fetch + parse)を開始する。
 * 日本語入力中に短時間で複数回レンダリングが走った場合でも、動的importやfetchが
 * 並行して何度も発火しないよう、ロード中は同じPromiseを使い回す(多重トリガー防止)。 */
function ensureCJKFontLoading(): Promise<void> {
  if (cjkFontState === 'ready') return Promise.resolve();
  if (cjkLoadPromise) return cjkLoadPromise;

  cjkFontState = 'loading';
  cjkLoadPromise = (async () => {
    const opentype: any = await import('opentype.js');
    const res = await fetch(CJK_FONT_URL);
    const buf = await res.arrayBuffer();
    cachedFont = opentype.parse(buf);
    cjkFontState = 'ready';
    onCjkFontReady?.();
  })();
  return cjkLoadPromise;
}

/** 明示的にCJKフォントの読み込み完了を待ちたい場合に呼ぶ(テスト等)。
 * 通常のアプリ実行フローではこれを呼ぶ必要はない。日本語などフォントに字形が無い
 * 文字を含む行が初めて現れた時点で、replaceCJKTextWithPaths内から自動的に
 * 遅延ロードされる。 */
export async function loadCJKFont(fontUrl: string = CJK_FONT_URL): Promise<void> {
  void fontUrl; // 読み込み対象は常にCJK_FONT_URL固定(引数は後方互換のために残している)
  await ensureCJKFontLoading();
}

/**
 * 通常の数式記号はMathJaxのSVG出力上<path>(組み込みフォントの字形定義への参照)として
 * 出力され、フォントに字形が無い文字(日本語・その他Unicode文字)だけが<text>要素として
 * 出力される。つまり「<text>要素が1つでも含まれるか」がそのままCJKパス化処理の要否と
 * 一致する。
 *
 * 戻り値がnullの場合は「CJKフォントがまだ読み込まれておらず、かつ今まさに読み込みを
 * 開始した(または既に読み込み中)」ことを表す。呼び出し側(renderLineCached)はこれを
 * 構文エラーではなく「読み込み中」として扱う必要がある。
 */
function replaceCJKTextWithPaths(svgString: string): string | null {
  if (!svgString.includes('<text')) {
    // 日本語等を含まない行では opentype.js に一切触れない(動的importもfetchも発生しない)。
    return svgString;
  }

  if (cjkFontState !== 'ready') {
    void ensureCJKFontLoading();
    return null;
  }
  const font = cachedFont;

  // 以前は正規表現で <text data-variant=... transform=... font-size=... font-family=...> を
  // この属性順序に厳密依存する形でマッチしていた。MathJaxの出力仕様(属性の並び順や
  // 追加属性の有無)が将来変わった場合、この正規表現はエラーを出さずに「単に一致しない」
  // 形で静かに壊れ、該当のCJK文字だけがフォントパス化されずシステムフォント任せの表示に
  // 劣化する恐れがあった。DOMParserでSVGとしてパースしタグ名で走査する方式に変更する
  // ことで、属性の並び順に依存しなくなる(HTMLエンティティのデコードもパーサーが
  // 正しく行うため、その面でも堅牢)。
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    // パースに失敗した場合はCJKフォールバックを諦めて元のSVGをそのまま返す(致命的エラーには
    // しない。表示は多少崩れうるが、アプリ全体を落とすよりはましという判断)。
    return svgString;
  }

  const textNodes = Array.from(doc.getElementsByTagNameNS(SVG_NS, 'text'));
  for (const textEl of textNodes) {
    const transform = textEl.getAttribute('transform') ?? '';
    const fontSize = parseFloat(textEl.getAttribute('font-size') ?? '0');
    const char = textEl.textContent ?? '';

    let d = '';
    try {
      const glyphPath = font.getPath(char, 0, 0, fontSize);
      d = glyphPath.toPathData(2);
    } catch {
      d = '';
    }

    if (!d) {
      textEl.remove();
      continue;
    }

    const pathEl = doc.createElementNS(SVG_NS, 'path');
    // MathJaxはSVG全体を <g transform="scale(1,-1)"> で反転して描画しているため、
    // 各 <text> 要素にはそれを打ち消す scale(1,-1) が個別に付与されている
    // (これが無いと文字が上下反転してしまう)。<text> と全く同じtransformを
    // そのまま引き継ぐことで正しく描画される。
    pathEl.setAttribute('transform', transform);
    pathEl.setAttribute('d', d);
    textEl.replaceWith(pathEl);
  }

  return new XMLSerializer().serializeToString(doc.documentElement);
}

// ---------------------------------------------------------------------------
// 表(array/matrix)の罫線 <line>/<rect> の可視化
// ---------------------------------------------------------------------------

/** \hline や array の "|" 列区切りは <line data-line> / <rect data-frame> として
 * 出力されるが、本来は MathJax付属のCSS(.mjx-solid { stroke-width:70px; fill:none } 等、
 * output/svg/Wrappers/mtable.js の SVGmtable.styles 参照)を前提にしている。
 * このアプリはCSSを含まない生SVGだけを抜き出しているため、そのままだと祖先の
 * <g stroke-width="0"> が効いて線が完全に不可視になってしまう(表の罫線が
 * 何も表示されないバグ)。該当要素に直接スタイルを埋め込んで解決する。 */
function fixTableRuleStyles(svgString: string): string {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return svgString;
  for (const el of Array.from(doc.querySelectorAll('line[data-line], rect[data-frame="true"]'))) {
    const cls = el.getAttribute('class') ?? '';
    el.setAttribute('stroke-width', '70');
    el.setAttribute('fill', 'none');
    if (/\\bmjx-dashed\\b/.test(cls)) el.setAttribute('stroke-dasharray', '140');
    if (/\\bmjx-dotted\\b/.test(cls)) {
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-dasharray', '0,140');
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

// ---------------------------------------------------------------------------
// 複数行の合成 (左揃え・縦積み)
// ---------------------------------------------------------------------------

export interface ComposedSvg {
  svg: string;
  widthPx: number;
  heightPx: number;
  /** 構文エラーでプレースホルダー表示になった行の添字(0始まり、引数linesに対応) */
  errorLines: number[];
  /** errorLinesの各添字に対応する、MathJaxが返した具体的なエラーメッセージ
   * (例: "Undefined control sequence \hoge")。取得できなかった行は欠番になる。 */
  errorMessages: Map<number, string>;
  /** CJKフォント読み込み中で一時的にプレースホルダー表示になった行の添字(0始まり)。
   * 構文エラーではないため errorLines とは別に扱う。読み込み完了後、
   * setCJKFontReadyListener で登録したコールバックが呼ばれるので、そこで再レンダリング
   * すればこの一覧は空になる想定。 */
  loadingLines: number[];
}

/** MathJaxコンテキストはページ内で使い回す (呼び出しごとに作り直すとIDカウンタがリセットされ、
 * 同一ページ内で複数回レンダリングした際にDOM上でid衝突する可能性があるため)。
 *
 * ただし \newcommand 等はTeXコンテキストの共有マクロテーブルを書き換える副作用を持つため、
 * 「定義行を削除・変更してもコンテキストには古い定義が残る」問題がある(定義行を消しても
 * その場では成功して見えるのに、アプリを再起動すると同じ入力が失敗する、という静かな不整合)。
 * これを防ぐため、マクロを定義しうる行(newcommand/renewcommand/providecommand/
 * DeclareMathOperator)の集合を「世代」として管理し、その内容が変わったタイミングでだけ
 * コンテキストを丸ごと作り直す(=マクロテーブルを空の状態からやり直す)。世代が変わって
 * いなければ従来通りコンテキストを使い回すため、通常の入力ではコストは増えない。 */
const MACRO_DEFINING_LINE = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator)\b/;

let sharedCtx: MathJaxContext | null = null;
let macroGeneration = '';

function computeMacroGeneration(lines: string[]): string {
  return lines.filter((line) => MACRO_DEFINING_LINE.test(line)).join('\n');
}

function getSharedCtx(lines: string[]): MathJaxContext {
  const generation = computeMacroGeneration(lines);
  if (!sharedCtx || generation !== macroGeneration) {
    sharedCtx = createMathJaxContext();
    macroGeneration = generation;
    // 古いコンテキストのマクロ状態を前提にキャッシュされた結果は、新しいコンテキストでは
    // 意味が変わりうる(マクロが再定義・削除された等)ため、世代が変わったら全て破棄する。
    lineCache.clear();
  }
  return sharedCtx;
}

/** 構文エラー時の共通プレースホルダー。1行の "Syntax Error" というプレーンテキストのみを表示する
 * (以前は赤い破線枠付きだったが、複数行入力時に枠が積み重なって見づらいとの指摘のため、
 * 枠なし・単一行のシンプルな表示に変更した)。
 * MathJaxはparse失敗時、多くの場合JS例外を投げず data-mjx-error 付きの <g data-mml-node="merror">
 * を正常描画としてインライン返却する。そのSVGは本来ブラウザ側の追加スタイルシート
 * (背景ハイライト色など)を前提にしており、そのスタイルシートを持たずraw SVGだけを
 * 抜き出すこのアプリの方式では、data-background付き<rect>がfill未指定→SVG既定の黒で
 * 塗りつぶされ、他の行と重なる真っ黒な矩形として表示されてしまう(過去のバグ)。
 * hasError/例外どちらの場合も、このプレースホルダーに統一することで解消する。 */
function errorPlaceholder(): { inner: string; viewBox: [number, number, number, number] } {
  const viewBox: [number, number, number, number] = [0, -700, 4300, 850];
  const inner = `<text x="0" y="0" font-size="700" fill="#e04040" font-family="sans-serif">Syntax Error</text>`;
  return { inner, viewBox };
}

/** CJKフォント読み込み中(初回の日本語入力時など)に一時的に表示するプレースホルダー。
 * これは構文エラーではないため errorPlaceholder とは別に用意し、赤色を使わない
 * (呼び出し側 composeSvg でも errorLines ではなく loadingLines に分類する)。
 * このプレースホルダー自体は生の<text>要素だが、ブラウザ上のライブプレビュー
 * (previewEl.innerHTML)はネイティブのSVGテキストレンダリングを使うため、CJKパス化
 * 無しでも正しく表示される(パス化が必要なのはPNG書き出し等、フォントに依存しない
 * 携帯可能なSVGとして扱う場面のみ)。 */
function loadingPlaceholder(): { inner: string; viewBox: [number, number, number, number] } {
  const viewBox: [number, number, number, number] = [0, -700, 4300, 850];
  const inner = `<text x="0" y="0" font-size="700" fill="#888888" font-family="sans-serif">読み込み中…</text>`;
  return { inner, viewBox };
}

// ---------------------------------------------------------------------------
// 行単位レンダリング結果のキャッシュ
// ---------------------------------------------------------------------------
// composeSvgは今まで、入力欄で1文字打つたびに「変更していない行も含めた全行」を
// 毎回MathJaxに通していた(行数が増えるほど1打鍵ごとの遅延が線形に悪化する)。
// MathJaxのconvert()結果(viewBox・SVG内部マークアップ)はTeXソース文字列だけで
// 決まり、fontSizePx/色/paddingなどのRenderOptionsには依存しない(それらは後段の
// px換算・<g>ラップでのみ使われる)。そのため「行テキスト」をキーにキャッシュ可能。
// サイズはFIFOで上限を設け、無制限に増え続けないようにする。
type LineRenderResult =
  | { inner: string; viewBox: [number, number, number, number] }
  | { error: true; message?: string }
  | { loading: true };

const lineCache = new Map<string, LineRenderResult>();
const LINE_CACHE_LIMIT = 300;

function renderLineCached(ctx: MathJaxContext, line: string): LineRenderResult {
  const cached = lineCache.get(line);
  if (cached) return cached;

  let result: LineRenderResult;
  try {
    const { raw, viewBox, hasError, errorMessage } = renderLineToSvg(ctx, line);
    if (hasError) {
      result = { error: true, message: errorMessage };
    } else {
      const cjkProcessed = replaceCJKTextWithPaths(raw);
      if (cjkProcessed === null) {
        // CJKフォントが読み込み中。構文エラーではないため、キャッシュせず
        // (ロード完了後の再レンダリングで正しい結果に置き換わるようにする)結果を返す。
        return { loading: true };
      }
      const converted = fixTableRuleStyles(cjkProcessed);
      const inner = converted.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
      result = { inner, viewBox };
    }
  } catch {
    // MathJaxが致命的な例外を投げた場合(通常はdata-mjx-error属性付きでインライン描画される
    // ため稀だが、万一に備えた保険)のフォールバック表示。
    result = { error: true };
  }

  lineCache.set(line, result);
  if (lineCache.size > LINE_CACHE_LIMIT) {
    const oldestKey = lineCache.keys().next().value;
    if (oldestKey !== undefined) lineCache.delete(oldestKey);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 「&」による位置揃え(align型、v3.0) -----------------------------------------
// ---------------------------------------------------------------------------
// \begin{align}等の環境そのものは使わず(1行=1つのgutter行/1つの構文エラー判定という
// 既存の行モデルを崩さないため)、代わりにアプリ側で「&」をアプリ独自のマーカーとして
// 解釈する: 行内の(エスケープされていない・波括弧の外側にある)「&」でTeX文字列を
// 複数セグメントに分割し、それぞれ個別にMathJaxでレンダリングしたうえで、
// 連続する複数行(すべて「&」を含む行)を1つの「整列グループ」とみなして
// 列幅・ベースラインをJS側で計算し、align環境と同じ見た目(奇数番目のセグメントは
// 列の右端に、偶数番目のセグメントは列の左端に揃える)に再構成する。
// 「&」を含まない行は一切変更せず、既存の1行1レンダリングのパスをそのまま通る。

/** 波括弧の外側(depth===0)にあり、かつ`\begin{...}`〜`\end{...}`環境の外側
 * (envDepth===0)にあり、かつ直前の連続するバックスラッシュの数が偶数
 * (=エスケープされていない)である「&」の位置で分割する。分割点が1つも無ければ
 * nullを返す(=通常の1行レンダリングのパスに委ねる)。
 *
 * envDepthのチェックが無いと、`\begin{array}`/`\begin{pmatrix}`等、MathJaxネイティブに
 * 「&」を列区切りとして使う環境の内側まで誤って分割してしまう(波括弧の深さだけでは、
 * `\begin{pmatrix}`の`{`と`}`がその場で閉じてしまうため区別できない。v3.0で発生していた
 * 「array/pmatrix等がSyntax Errorになる」不具合の原因)。 */
function splitAlignmentSegments(line: string): string[] | null {
  let depth = 0;
  let envDepth = 0;
  const splitIndices: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      // \begin{ / \end{ は環境の開始・終了を示す複数文字の制御綴りのため、他の
      // (\{ \} \& \\ のような)1文字エスケープより先に判定する。
      if (line.startsWith('begin{', i + 1)) {
        envDepth++;
      } else if (line.startsWith('end{', i + 1)) {
        envDepth = Math.max(0, envDepth - 1);
      }
      // このバックスラッシュ自体が「直前のバックスラッシュ」を消費されていなければ、
      // 次の1文字を無条件にエスケープ対象として読み飛ばす(\{ \} \& \\ など。
      // \begin/\endの場合はここでは'b'/'e'の1文字だけを読み飛ばし、残りの
      // "egin{"/"nd{"は特別扱いせず通常の文字として読み進める(depthの整合性は
      // そこに現れる{/}が通常通りカウントされることで保たれる)。
      i++;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
    } else if (ch === '&' && depth === 0 && envDepth === 0) {
      splitIndices.push(i);
    }
  }
  if (splitIndices.length === 0) return null;
  const segments: string[] = [];
  let start = 0;
  for (const idx of splitIndices) {
    segments.push(line.slice(start, idx).trim());
    start = idx + 1;
  }
  segments.push(line.slice(start).trim());
  return segments;
}

/** セグメント1つ分のレンダリング結果(px換算済み)。 */
interface RenderedSegment {
  inner: string;
  widthPx: number;
  heightPx: number;
  ascentPx: number;
  viewBox: [number, number, number, number];
}

function toRenderedSegment(inner: string, viewBox: [number, number, number, number], EM: number): RenderedSegment {
  const [, minY, w, h] = viewBox;
  const widthPx = (w / 1000) * EM;
  const heightPx = (h / 1000) * EM;
  const ascentPx = (-minY / 1000) * EM;
  return { inner, widthPx, heightPx, ascentPx, viewBox };
}

/** 列と列の間の一定の空きスペース(フォントサイズに対する比率)。 */
const ALIGN_COLUMN_GAP_EM = 0.4;

/** 「&」区切りの1行分(=グループ内の1行)を、指定の列幅・列開始X座標を使って
 * 1つの合成ブロックへまとめる。奇数列(0始まりで偶数インデックス)は列の右端に、
 * 偶数列(奇数インデックス)は列の左端に揃える(align環境の交互配置と同じ規則)。
 * セグメントが無い(未使用の)列は幅0として無視する。 */
function composeAlignedRow(
  segmentsPx: (RenderedSegment | null)[],
  colWidthsPx: number[],
  colStartXPx: number[],
): { inner: string; widthPx: number; heightPx: number } {
  const rowAscentPx = Math.max(0, ...segmentsPx.filter((s): s is RenderedSegment => s !== null).map((s) => s.ascentPx));
  const rowDescentPx = Math.max(
    0,
    ...segmentsPx.filter((s): s is RenderedSegment => s !== null).map((s) => s.heightPx - s.ascentPx),
  );
  const rowHeightPx = rowAscentPx + rowDescentPx;
  const lastCol = colWidthsPx.length - 1;
  const rowWidthPx = lastCol >= 0 ? colStartXPx[lastCol] + colWidthsPx[lastCol] : 0;

  const parts: string[] = [];
  segmentsPx.forEach((seg, c) => {
    if (!seg) return;
    const isRightAligned = c % 2 === 0;
    const x = isRightAligned ? colStartXPx[c] + (colWidthsPx[c] - seg.widthPx) : colStartXPx[c];
    const y = rowAscentPx - seg.ascentPx;
    const [minX, minY, w, h] = seg.viewBox;
    parts.push(
      `<svg x="${x}" y="${y}" width="${seg.widthPx}" height="${seg.heightPx}" viewBox="${minX} ${minY} ${w} ${h}" overflow="visible">${seg.inner}</svg>`,
    );
  });

  return { inner: parts.join('\n'), widthPx: rowWidthPx, heightPx: rowHeightPx };
}

export function composeSvg(lines: string[], opts: RenderOptions = DEFAULT_OPTIONS): ComposedSvg {
  if (lines.length === 0) {
    throw new Error('レンダリングする数式がありません。');
  }

  const ctx = getSharedCtx(lines);
  const errorLines: number[] = [];
  const errorMessages = new Map<number, string>();
  const loadingLines: number[] = [];
  const EM = opts.fontSizePx;

  // 各行を「&」の有無で分類する。分割できた行の添字集合を、連続する範囲ごとに
  // グループ化する(1行でも「&」を含まない行を挟むとグループが切れる)。
  const segmentsByLine: (string[] | null)[] = lines.map((line) => splitAlignmentSegments(line));
  const groups: number[][] = [];
  let currentGroup: number[] = [];
  segmentsByLine.forEach((segs, idx) => {
    if (segs) {
      currentGroup.push(idx);
    } else if (currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  });
  if (currentGroup.length > 0) groups.push(currentGroup);

  const groupOfLine = new Map<number, number[]>();
  for (const group of groups) {
    for (const idx of group) groupOfLine.set(idx, group);
  }

  // 行ごとに、レンダリング結果(または通常のerror/loadingプレースホルダー)を1つの
  // ブロック({inner, viewBox, widthPx, heightPx})へ正規化する。整列グループの行は
  // 列幅・X座標をグループ単位で先に計算してから、行ごとの合成へ渡す。
  type Block = { inner: string; viewBox: [number, number, number, number]; widthPx: number; heightPx: number };
  const blocks: Block[] = new Array(lines.length);

  const handledGroups = new Set<number[]>();

  lines.forEach((line, idx) => {
    const group = groupOfLine.get(idx);
    if (!group) {
      // 通常の1行(「&」なし)。既存の単一セグメントのパス。
      const result = renderLineCached(ctx, line);
      if ('error' in result) {
        errorLines.push(idx);
        if (result.message) errorMessages.set(idx, result.message);
        const { inner, viewBox } = errorPlaceholder();
        const [, , w, h] = viewBox;
        blocks[idx] = { inner, viewBox, widthPx: (w / 1000) * EM, heightPx: (h / 1000) * EM };
        return;
      }
      if ('loading' in result) {
        loadingLines.push(idx);
        const { inner, viewBox } = loadingPlaceholder();
        const [, , w, h] = viewBox;
        blocks[idx] = { inner, viewBox, widthPx: (w / 1000) * EM, heightPx: (h / 1000) * EM };
        return;
      }
      const [, , w, h] = result.viewBox;
      blocks[idx] = { inner: result.inner, viewBox: result.viewBox, widthPx: (w / 1000) * EM, heightPx: (h / 1000) * EM };
      return;
    }

    if (handledGroups.has(group)) return; // このグループは別の行のイテレーションで既に処理済み
    handledGroups.add(group);

    const maxSegs = Math.max(...group.map((i) => (segmentsByLine[i] as string[]).length));

    // グループ内の各行・各セグメントをレンダリングする(エラー/読み込み中は行単位で扱う)。
    const rowSegments: (RenderedSegment | null)[][] = group.map(() => new Array(maxSegs).fill(null));
    const rowHasError = new Set<number>();
    const rowHasLoading = new Set<number>();
    const rowErrorMessage = new Map<number, string>();
    group.forEach((lineIdx, rowPos) => {
      const segs = segmentsByLine[lineIdx] as string[];
      segs.forEach((segText, c) => {
        // 空セグメント(例: "a &" のように右側が空)はレンダリングせず幅0として扱う。
        if (segText.length === 0) return;
        const result = renderLineCached(ctx, segText);
        if ('error' in result) {
          rowHasError.add(rowPos);
          if (result.message && !rowErrorMessage.has(rowPos)) rowErrorMessage.set(rowPos, result.message);
          return;
        }
        if ('loading' in result) {
          rowHasLoading.add(rowPos);
          return;
        }
        rowSegments[rowPos][c] = toRenderedSegment(result.inner, result.viewBox, EM);
      });
    });

    // 列幅はグループ内の全行(エラー/読み込み中の行を除く)から計算する。
    const colWidthsPx: number[] = new Array(maxSegs).fill(0);
    group.forEach((_lineIdx, rowPos) => {
      if (rowHasError.has(rowPos) || rowHasLoading.has(rowPos)) return;
      rowSegments[rowPos].forEach((seg, c) => {
        if (seg) colWidthsPx[c] = Math.max(colWidthsPx[c], seg.widthPx);
      });
    });
    const gapPx = ALIGN_COLUMN_GAP_EM * EM;
    const colStartXPx: number[] = new Array(maxSegs).fill(0);
    for (let c = 1; c < maxSegs; c++) {
      colStartXPx[c] = colStartXPx[c - 1] + colWidthsPx[c - 1] + gapPx;
    }

    group.forEach((lineIdx, rowPos) => {
      if (rowHasError.has(rowPos)) {
        errorLines.push(lineIdx);
        const msg = rowErrorMessage.get(rowPos);
        if (msg) errorMessages.set(lineIdx, msg);
        const { inner, viewBox } = errorPlaceholder();
        const [, , w, h] = viewBox;
        blocks[lineIdx] = { inner, viewBox, widthPx: (w / 1000) * EM, heightPx: (h / 1000) * EM };
        return;
      }
      if (rowHasLoading.has(rowPos)) {
        loadingLines.push(lineIdx);
        const { inner, viewBox } = loadingPlaceholder();
        const [, , w, h] = viewBox;
        blocks[lineIdx] = { inner, viewBox, widthPx: (w / 1000) * EM, heightPx: (h / 1000) * EM };
        return;
      }
      const { inner, widthPx, heightPx } = composeAlignedRow(rowSegments[rowPos], colWidthsPx, colStartXPx);
      // 合成済みの行はすでにpx単位で正しく配置されているため、viewBoxは1px=1単位の
      // そのままのボックスとして扱う(以降の共通スケーリング処理を素通りさせるため)。
      blocks[lineIdx] = { inner, viewBox: [0, 0, widthPx, heightPx], widthPx, heightPx };
    });
  });

  const contentWidth = Math.max(...blocks.map((b) => b.widthPx));
  const contentHeight =
    blocks.reduce((sum, b) => sum + b.heightPx, 0) + opts.lineGapPx * Math.max(0, blocks.length - 1);

  const totalWidth = Math.ceil(contentWidth + opts.paddingPx * 2);
  const totalHeight = Math.ceil(contentHeight + opts.paddingPx * 2);

  let cursorY = opts.paddingPx;
  const nestedSvgs = blocks
    .map((b) => {
      const [minX, minY, w, h] = b.viewBox;
      const x = opts.paddingPx;
      const y = cursorY;
      cursorY += b.heightPx + opts.lineGapPx;
      return `<svg x="${x}" y="${y}" width="${b.widthPx}" height="${b.heightPx}" viewBox="${minX} ${minY} ${w} ${h}" overflow="visible">${b.inner}</svg>`;
    })
    .join('\n');

  const backgroundRect = opts.transparentBackground
    ? ''
    : `<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="${opts.backgroundColor}"/>\n`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" overflow="visible">
${backgroundRect}<g color="${opts.fontColor}" fill="${opts.fontColor}">
${nestedSvgs}
</g>
</svg>`;

  return { svg, widthPx: totalWidth, heightPx: totalHeight, errorLines, errorMessages, loadingLines };
}

// ---------------------------------------------------------------------------
// MathMLコピー機能
// ---------------------------------------------------------------------------
const mmlVisitor = new SerializedMmlVisitor();

/** 1行分のLaTeXソースをPresentation MathML文字列に変換する。 */
function renderLineToMathML(ctx: MathJaxContext, texLine: string): string {
  const node = ctx.html.convert(normalizeVectorCommands(texLine), { display: true, end: STATE.CONVERT });
  return mmlVisitor.visitTree(node);
}

/** 複数行のLaTeXソースをMathMLへ変換する。
 *
 * composeSvg(画像出力)は「&」を含む行をピクセル単位で列ごとに位置合わせして合成するが、
 * MathMLはそもそも他アプリ(Word等)側でレンダリングされる意味的なマークアップなので、
 * ピクセル計算ではなく「amsmathのalignedとして意味的に表現する」方針にする。
 * (生の「&」はそのままMathJaxに渡すと「Misplaced &」エラーになるため、\begin{aligned}
 * ...\end{aligned} で包んでから渡す必要がある。composeSvgと同じ
 * splitAlignmentSegments/グループ化ロジックを再利用し、「&」を含む連続行だけを
 * 1つのalignedブロックにまとめる。)
 * \begin{nobreak}...\end{nobreak} はsplitLinesWithNumbers側で既に1行に結合された
 * 状態で渡ってくるため、ここで特別扱いする必要はない。
 */
export function composeMathML(lines: string[]): string {
  const ctx = getSharedCtx(lines);
  const segmentsByLine: (string[] | null)[] = lines.map((line) => splitAlignmentSegments(line));
  const groups: number[][] = [];
  let currentGroup: number[] = [];
  segmentsByLine.forEach((segs, idx) => {
    if (segs) {
      currentGroup.push(idx);
    } else if (currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  });
  if (currentGroup.length > 0) groups.push(currentGroup);

  const groupOfLine = new Map<number, number[]>();
  for (const group of groups) {
    for (const idx of group) groupOfLine.set(idx, group);
  }

  const handledGroups = new Set<number[]>();
  const blocks: string[] = [];

  lines.forEach((line, idx) => {
    const group = groupOfLine.get(idx);
    if (!group) {
      blocks.push(renderLineToMathML(ctx, line));
      return;
    }
    if (handledGroups.has(group)) return; // このグループは別の行のイテレーションで既に処理済み
    handledGroups.add(group);
    const alignedSource = `\\begin{aligned}${group.map((i) => lines[i]).join('\\\\')}\\end{aligned}`;
    blocks.push(renderLineToMathML(ctx, alignedSource));
  });

  return blocks.join('\n');
}

// ---------------------------------------------------------------------------
// Unicode近似コピー
// ---------------------------------------------------------------------------
// MathMLと同じMmlNode(TeXをMathJaxが解析した内部ツリー)を再利用し、ツリーを歩いて
// プレーンテキストのUnicode近似(例: "α² + β_i" 相当)を組み立てる。LaTeXソース文字列を
// 自前の正規表現でパースし直すのではなく、MathJaxが既に確定させた「\alphaはα」
// 「\leqは≤」等の解決結果をそのまま使えるため、自前パーサより堅牢。
// あくまで「近似」であり、上付き/下付きに使えるUnicode文字が存在しない場合は
// "^(...)" "_(...)" というテキスト表記にフォールバックする(例えば下付きの b, c, d, f, g, q,
// w, y, z はUnicodeに専用文字が存在しない)。

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ',
  m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
  // 大文字ラテン(Unicode Phonetic Extensions "Modifier Letter Capital X"シリーズ + Latin
  // Extended-CのV)。C, F, Q, S, X, Y, Zは2020年代に追加が提案されたばかりでフォント対応が
  // 乏しいため、意図的に含めない(未対応の文字は下のtoSuperscriptが"^(...)"へ自動的に
  // フォールバックする)。
  A: 'ᴬ', B: 'ᴮ', D: 'ᴰ', E: 'ᴱ', G: 'ᴳ', H: 'ᴴ', I: 'ᴵ', J: 'ᴶ', K: 'ᴷ', L: 'ᴸ', M: 'ᴹ', N: 'ᴺ',
  O: 'ᴼ', P: 'ᴾ', R: 'ᴿ', T: 'ᵀ', U: 'ᵁ', V: 'ⱽ', W: 'ᵂ',
  // ギリシャ文字(Phonetic Extensionsの"Greek superscript modifier letters")。テンソル添字
  // (x^\mu等)や物理でよく使われるものはmiNodeToUnicode側で既にα等へ解決されているため、
  // ここではUnicode側に専用の上付き文字が存在するものだけ対応する。
  // '\phi'と'\varphi'はMathJaxの解決結果がU+03D5とU+03C6で異なるが、Unicode側の上付き
  // 文字はどちらも同じ ᵠ(U+1D60)しか存在しないため、両方をこの1文字にマップする。
  β: 'ᵝ', γ: 'ᵞ', δ: 'ᵟ', φ: 'ᵠ', ϕ: 'ᵠ', χ: 'ᵡ',
};
const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ',
  r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
  // ギリシャ文字の下付き(Unicodeに存在するのはβ γ ρ φ χの5種のみ)。テンソル添字
  // g_{\mu\nu}のように上付きは効いても下付きは対応文字が無いケースもあるが、それは
  // Unicode側の制約であり\varphi/\phiの扱いは上のSUPERSCRIPT_MAPと同じ理由で共通化する。
  β: 'ᵦ', γ: 'ᵧ', ρ: 'ᵨ', φ: 'ᵩ', ϕ: 'ᵩ', χ: 'ᵪ',
};

function toScript(s: string, map: Record<string, string>): string {
  let out = '';
  for (const ch of s) {
    const mapped = map[ch];
    if (!mapped) return `^(${s})`; // mapがsuperscript/subscript共通の呼び出し規約のため、
    // 実際の記号("^"か"_")は呼び出し側で使い分ける(下のtoSuperscript/toSubscript参照)。
    out += mapped;
  }
  return out;
}
function toSuperscript(s: string): string {
  const out = toScript(s, SUPERSCRIPT_MAP);
  return out.startsWith('^(') ? `^(${s})` : out;
}
function toSubscript(s: string): string {
  let out = '';
  for (const ch of s) {
    const mapped = SUBSCRIPT_MAP[ch];
    if (!mapped) return `_(${s})`;
    out += mapped;
  }
  return out;
}

/** 二項演算子・関係演算子として前後にスペースを入れると読みやすくなる記号の集合。
 * MathJaxは可視化(SVG/CHTML)では独自のCSS間隔で表現している情報なので、プレーンテキストの
 * 近似では自前で再現する必要がある。単項マイナス(例: "-x")との衝突は、
 * composeUnicodeApprox側で行全体をtrim + 連続スペース圧縮することである程度緩和する。 */
const SPACED_OPERATORS = new Set([
  '+', '-', '−', '=', '≤', '≥', '≠', '≈', '±', '×', '÷', '·', '⋅', '→', '⇒', '⇔', '↔',
  '∈', '∉', '⊂', '⊆', '⊃', '⊇', '∪', '∩', '∝', '∼', '≡', '∘', '<', '>',
  '∧', '∨', '⊕', '⊗', '⊙', '↦', '⟶', '⟹', '⟺', '≅', '≃', '≪', '≫', '∣', '∤', '⊢', '⊨', '≺', '≻',
]);

/** MathJaxが解析したMmlNodeツリーを歩いて、Unicodeのプレーンテキスト近似を組み立てる。
 * MmlNodeの型はmathjax-full内部の複雑なクラス階層に依存しており、構造的に
 * kind/childNodes/getText()/attributesだけを見るダックタイピングで十分なため、
 * (liteAdaptor.innerHTML(node as any)と同様の理由で)ここでは意図的にanyを使う。 */
function mmlNodeToUnicode(node: any): string {
  if (!node) return '';
  const kind: string = node.kind;

  if (kind === 'mo' && typeof node.getText === 'function') {
    const text = node.getText();
    return SPACED_OPERATORS.has(text) ? ` ${text} ` : text;
  }

  if (typeof node.getText === 'function') {
    // mi/mn/mtext等のトークンノード。子のtextノードの中身をそのまま連結する
    // (MathJaxが既に \alpha -> "α" 等を解決済みなので、そのまま使える)。
    return node.getText();
  }

  const children = (node.childNodes ?? []) as any[];
  const childText = (i: number) => mmlNodeToUnicode(children[i]);
  const isMultiToken = (n: any) => {
    if (!n) return false;
    if (typeof n.getText === 'function') return false;
    const cs = (n.childNodes ?? []) as any[];
    return cs.length > 1;
  };
  const wrapIfComplex = (n: any) => (isMultiToken(n) ? `(${mmlNodeToUnicode(n)})` : mmlNodeToUnicode(n));

  switch (kind) {
    case 'math':
    case 'mrow':
    case 'inferredMrow':
    case 'TeXAtom':
    case 'mstyle':
    case 'mpadded':
      return children.map((c) => mmlNodeToUnicode(c)).join('');

    case 'mfrac':
      return `${wrapIfComplex(children[0])}/${wrapIfComplex(children[1])}`;

    case 'msqrt':
      return `√(${children.map((c) => mmlNodeToUnicode(c)).join('')})`;

    case 'mroot': {
      const base = mmlNodeToUnicode(children[0]);
      const index = mmlNodeToUnicode(children[1]);
      const supIndex = toSuperscript(index);
      return supIndex.startsWith('^(') ? `root(${index})(${base})` : `${supIndex}√(${base})`;
    }

    case 'msup':
      return `${childText(0)}${toSuperscript(mmlNodeToUnicode(children[1]))}`;

    case 'msub':
      return `${childText(0)}${toSubscript(mmlNodeToUnicode(children[1]))}`;

    case 'msubsup':
      return `${childText(0)}${toSubscript(mmlNodeToUnicode(children[1]))}${toSuperscript(mmlNodeToUnicode(children[2]))}`;

    case 'munder':
    case 'mover':
    case 'munderover': {
      // \vec{x}や\hat{x}のような「結合文字を重ねるアクセント」は、上下付き文字としてではなく
      // ベースへそのまま連結する(見た目上、結合文字が重なって表示されることを期待する)。
      const isAccent = node.attributes?.get?.('accent') || node.attributes?.get?.('accentunder');
      if (isAccent) {
        return children.map((c) => mmlNodeToUnicode(c)).join('');
      }
      // \sum_{i=1}^{n} のような、大型演算子の上下限。プレーンテキストでは縦に積めないため、
      // 上付き/下付き文字(可能な範囲で)を使って1行に押し込む近似にする。
      const base = mmlNodeToUnicode(children[0]);
      if (kind === 'munder') return `${base}${toSubscript(mmlNodeToUnicode(children[1]))}`;
      if (kind === 'mover') return `${base}${toSuperscript(mmlNodeToUnicode(children[1]))}`;
      return `${base}${toSubscript(mmlNodeToUnicode(children[1]))}${toSuperscript(mmlNodeToUnicode(children[2]))}`;
    }

    case 'mtable':
      return `(${children.map((row) => mmlNodeToUnicode(row)).join('; ')})`;
    case 'mtr':
    case 'mlabeledtr':
      return children.map((cell) => mmlNodeToUnicode(cell)).join(' ');
    case 'mtd':
      return children.map((c) => mmlNodeToUnicode(c)).join('');

    case 'merror':
      return '[エラー]';

    case 'mspace':
      return ' ';

    default:
      // 未対応のノード種別(mphantom, menclose等)は、子要素をそのまま連結する
      // フォールバックにする(情報を落とすより、多少不格好でも中身を残す方を優先する)。
      return children.map((c) => mmlNodeToUnicode(c)).join('');
  }
}

/** 複数行のLaTeXソースをUnicode近似のプレーンテキストへ変換する。「&」を含む行は
 * composeMathMLと同じ理由でalignedブロックとしてまとめてから変換する。 */
export function composeUnicodeApprox(lines: string[]): string {
  const ctx = getSharedCtx(lines);
  const segmentsByLine: (string[] | null)[] = lines.map((line) => splitAlignmentSegments(line));
  const groups: number[][] = [];
  let currentGroup: number[] = [];
  segmentsByLine.forEach((segs, idx) => {
    if (segs) {
      currentGroup.push(idx);
    } else if (currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  });
  if (currentGroup.length > 0) groups.push(currentGroup);

  const groupOfLine = new Map<number, number[]>();
  for (const group of groups) {
    for (const idx of group) groupOfLine.set(idx, group);
  }

  const handledGroups = new Set<number[]>();
  const out: string[] = [];

  lines.forEach((line, idx) => {
    const group = groupOfLine.get(idx);
    if (!group) {
      const node = ctx.html.convert(normalizeVectorCommands(line), { display: true, end: STATE.CONVERT });
      out.push(mmlNodeToUnicode(node).replace(/ {2,}/g, ' ').trim());
      return;
    }
    if (handledGroups.has(group)) return;
    handledGroups.add(group);
    const alignedSource = `\\begin{aligned}${group.map((i) => lines[i]).join('\\\\')}\\end{aligned}`;
    const node = ctx.html.convert(normalizeVectorCommands(alignedSource), { display: true, end: STATE.CONVERT });
    out.push(mmlNodeToUnicode(node).replace(/ {2,}/g, ' ').trim());
  });

  return out.join('\n');
}
