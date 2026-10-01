/**
 * latexExtraction.ts
 *
 * Webページ上で選択されているテキストから、可能であれば元のLaTeXソースを取り出す。
 *
 * 【v1の設計が誤っていた点(重要)】
 * 最初の実装は、MathJaxのアクセシビリティ出力(assistive MathML)に
 * <annotation encoding="application/x-tex">元のTeX</annotation> が含まれている前提で
 * DOMだけを見ていたが、これは誤りだった。mathjax-fullの実際の描画結果を生成して確認した
 * ところ、既定のassistive MathML出力は意味的なMathMLのみで、元のTeXソースを示す
 * annotationは一切含まれていない。そのため常にDOM抽出が失敗し、見た目のテキスト
 * (unicode化された記号がバラバラに並ぶ)にフォールバックしていた。
 *
 * 【正しい情報源】
 * MathJax公式ドキュメントによれば、元のTeXソースはDOMではなく「MathJax自身のJSオブジェクト」
 * の中に保持されている。
 *   - v3/v4: `MathJax.startup.document.math` が MathItem のリストで、各要素の
 *     `.math` プロパティが元のTeXソース文字列、`.typesetRoot` が対応する
 *     実際のレンダリング結果(<mjx-container>)のDOM要素。
 *   - v2: `MathJax.Hub.getAllJax()` が element jax のリストで、各要素の
 *     `.originalText` が元のTeXソース文字列、`.SourceElement()` が元の
 *     <script type="math/tex"> 要素。
 *
 * ページの`window.MathJax`はcontent scriptの「isolated world」からは見えない
 * (ページ自身のJSとオブジェクトを共有しないため)。そのためこの関数は
 * `chrome.scripting.executeScript({ world: 'MAIN', func: ... })` で、ページ自身の
 * JS実行コンテキストに注入して実行する必要がある(background.ts側で指定)。
 *
 * 上記のJS API経由での取得を最優先とし、`window.MathJax`が見つからない場合
 * (ページが公開していない、KaTeX等別のレンダラである等)のみ、DOM上の
 * annotation要素等を探す方式にフォールバックする。
 *
 * 【重要な制約: この関数は「閉じている」必要がある】
 * chrome.scripting.executeScript({ func: extractLatexFromSelection }) は、この関数を
 * Function.prototype.toString() でシリアライズし、対象タブの実行コンテキストで
 * 再実行する。そのため、この関数はモジュールスコープの変数や他の関数を一切参照できない
 * (window/document/Node などページに元から存在するグローバルのみ使用可能)。
 */
export function extractLatexFromSelection(): string {
  // input/textarea内の選択はwindow.getSelection()へ反映されないブラウザがある。
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && ['text', 'search', 'url', 'email', 'tel'].includes(active.type))) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start !== null && end !== null && end > start) return active.value.slice(start, end);
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return '';
  }
  const range = selection.getRangeAt(0);

  function intersects(el: Element | null | undefined): boolean {
    if (!el) return false;
    try {
      return range.intersectsNode(el);
    } catch {
      return false;
    }
  }

  function sortByDocumentPosition<T extends { el: Element }>(items: T[]): T[] {
    return items.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      // eslint-disable-next-line no-bitwise
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      // eslint-disable-next-line no-bitwise
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  // ---------------------------------------------------------------------
  // 戦略1: MathJax v3/v4 の内部API (window.MathJax.startup.document.math)
  // ---------------------------------------------------------------------
  type MJ = {
    startup?: { document?: { math?: Iterable<{ math?: unknown; typesetRoot?: unknown }> } };
    Hub?: { getAllJax?: () => Array<{ originalText?: unknown; SourceElement?: () => unknown }> };
  };
  const mathJax = (window as unknown as { MathJax?: MJ }).MathJax;

  if (mathJax?.startup?.document?.math) {
    const matches: { el: Element; tex: string }[] = [];
    try {
      for (const item of mathJax.startup.document.math) {
        const tex = item?.math;
        const root = item?.typesetRoot;
        if (typeof tex === 'string' && tex.length > 0 && root instanceof Element && intersects(root)) {
          matches.push({ el: root, tex });
        }
      }
    } catch {
      // MathJaxのバージョン差異等で構造が想定と違う場合は、下の戦略へフォールバックする。
    }
    if (matches.length > 0) {
      return sortByDocumentPosition(matches)
        .map((m) => m.tex)
        .join('\n');
    }
  }

  // ---------------------------------------------------------------------
  // 戦略2: MathJax v2 の内部API (window.MathJax.Hub.getAllJax())
  // ---------------------------------------------------------------------
  if (typeof mathJax?.Hub?.getAllJax === 'function') {
    const matches: { el: Element; tex: string }[] = [];
    try {
      const allJax = mathJax.Hub.getAllJax();
      for (const jax of allJax) {
        const tex = jax?.originalText;
        if (typeof tex !== 'string' || tex.length === 0) continue;
        const scriptEl = typeof jax.SourceElement === 'function' ? jax.SourceElement() : null;
        if (!(scriptEl instanceof Element)) continue;
        // 実際に見えているレンダリング結果は、大抵は元の<script>の直前の兄弟要素として
        // 挿入される。無ければscript要素自体(またはその親)との交差で代用する。
        const renderedEl = scriptEl.previousElementSibling ?? scriptEl.parentElement ?? scriptEl;
        if (intersects(renderedEl) || intersects(scriptEl)) {
          matches.push({ el: renderedEl, tex });
        }
      }
    } catch {
      // 想定と違う構造の場合は、下の戦略へフォールバックする。
    }
    if (matches.length > 0) {
      return sortByDocumentPosition(matches)
        .map((m) => m.tex)
        .join('\n');
    }
  }

  // ---------------------------------------------------------------------
  // 戦略3: DOMだけを見るフォールバック(window.MathJaxが見つからない場合。
  // KaTeXや、MathJaxをグローバルに公開していないページ向け)。
  // KaTeXの既定出力にはannotation要素が含まれるため、これで拾える。
  // MathJax自体でここに来るのは、assistive-mml出力にannotationを追加する
  // カスタム設定がされている場合など、限定的なケースになる。
  // ---------------------------------------------------------------------
  const domCandidates = Array.from(document.querySelectorAll('mjx-container, .MathJax, .MathJax_Display, .katex, [data-tex], [data-latex]')).filter(
    (el) => intersects(el),
  );

  if (domCandidates.length > 0) {
    function findTexSource(el: Element): string | null {
      for (const attribute of ['data-tex', 'data-latex']) {
        const value = el.getAttribute(attribute)?.trim();
        if (value) return value;
      }
      const annotation = el.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="TeX"]');
      if (annotation?.textContent && annotation.textContent.trim().length > 0) {
        return annotation.textContent.trim();
      }
      if (el.id && el.id.endsWith('-Frame')) {
        const scriptId = el.id.slice(0, -'-Frame'.length);
        const script = document.getElementById(scriptId);
        if (script instanceof HTMLScriptElement && script.textContent && script.textContent.trim().length > 0) {
          return script.textContent.trim();
        }
      }
      const prev = el.previousElementSibling;
      if (prev instanceof HTMLScriptElement && /^math\/tex/.test(prev.type) && prev.textContent) {
        return prev.textContent.trim();
      }
      const next = el.nextElementSibling;
      if (next instanceof HTMLScriptElement && /^math\/tex/.test(next.type) && next.textContent) {
        return next.textContent.trim();
      }
      return null;
    }

    // MathJax v2では外側の.MathJax_Displayと内側の.MathJaxが両方候補になる。
    // 外側だけを残すと、内側の*-Frameに対応するscriptを見失う。
    const withSource = domCandidates
      .map((el) => ({ el, tex: findTexSource(el) ?? '' }))
      .filter((item) => item.tex.length > 0);
    const sources = sortByDocumentPosition(withSource.filter((item) => !withSource.some(
      (other) => other !== item && other.el.contains(item.el) && other.tex === item.tex,
    )));
    if (sources.length > 0) {
      return sources.map((s) => s.tex).join('\n');
    }
  }

  // ---------------------------------------------------------------------
  // 最終フォールバック: 数式に一切かかっていない通常のテキスト選択、または
  // 上記のいずれの方法でもソースを特定できなかった場合。
  // ---------------------------------------------------------------------
  return selection.toString();
}
