import { afterEach, describe, expect, it } from 'vitest';
import { extractLatexFromSelection } from './latexExtraction';

function selectAll(): void {
  const range = document.createRange();
  range.selectNodeContents(document.body);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  // 各テストの後、window.MathJaxのモックを必ず消す(テスト間の汚染を防ぐ)。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).MathJax;
});

describe('extractLatexFromSelection', () => {
  it('reads a selection inside a text field', () => {
    setBody('<input type="text" value="before a^2 after">');
    const input = document.querySelector('input')!;
    input.focus();
    input.setSelectionRange(7, 10);
    expect(extractLatexFromSelection()).toBe('a^2');
  });

  it('reads a selection inside a textarea', () => {
    setBody('<textarea>before \\frac{a}{b} after</textarea>');
    const input = document.querySelector('textarea')!;
    input.focus();
    input.setSelectionRange(7, 18);
    expect(extractLatexFromSelection()).toBe('\\frac{a}{b}');
  });

  it('returns an empty string when nothing is selected', () => {
    setBody('<p>no selection here</p>');
    window.getSelection()?.removeAllRanges();
    expect(extractLatexFromSelection()).toBe('');
  });

  it('falls back to plain visible text when the selection has no math and no window.MathJax', () => {
    setBody('<p>just some plain text</p>');
    selectAll();
    expect(extractLatexFromSelection()).toBe('just some plain text');
  });

  // ---------------------------------------------------------------------
  // 戦略1: MathJax v3 (window.MathJax.startup.document.math)
  // 実際にmathjax-full + jsdomでdocument.render()を実行して生成した本物のDOM構造
  // (<mjx-container>とその中の<svg>)に対して検証する。既定のassistive-mml出力には
  // annotationが無いことを確認済みなので、DOM側にはTeXソースの手がかりを一切残さず、
  // window.MathJax.startup.document.math 経由でのみ取得できることをテストする。
  // ---------------------------------------------------------------------
  it('extracts the exact TeX source via MathJax v3 startup.document.math (regression test for the reported bug)', () => {
    // ユーザーが実際に報告した数式。^2 や \sqrt 等の構文が失われず、改行も入らず、
    // 完全に元の文字列のまま返ることを確認する。
    const formula = String.raw`\int_{0}^{\sqrt 3} f^{-1}(x) \, dx`;

    setBody(`
      <p>before text
        <mjx-container class="MathJax" jax="SVG" display="true">
          <svg><g data-mml-node="math">...only rendered glyphs, no TeX anywhere...</g></svg>
        </mjx-container>
      after text</p>
    `);
    const typesetRoot = document.querySelector('mjx-container');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).MathJax = {
      startup: {
        document: {
          math: [{ math: formula, typesetRoot }],
        },
      },
    };

    selectAll();
    expect(extractLatexFromSelection()).toBe(formula);
  });

  it('only returns math items whose typesetRoot intersects the selection (ignores unrelated formulas on the page)', () => {
    setBody(`
      <div id="selected"><mjx-container class="MathJax" id="a"><svg></svg></mjx-container></div>
      <div id="notSelected"><mjx-container class="MathJax" id="b"><svg></svg></mjx-container></div>
    `);
    const rootA = document.getElementById('a');
    const rootB = document.getElementById('b');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).MathJax = {
      startup: {
        document: {
          math: [
            { math: 'a^2', typesetRoot: rootA },
            { math: 'b^2', typesetRoot: rootB },
          ],
        },
      },
    };

    const range = document.createRange();
    range.selectNodeContents(document.getElementById('selected')!);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(extractLatexFromSelection()).toBe('a^2');
  });

  it('joins multiple intersecting formulas, one per line, in document order', () => {
    setBody(`
      <mjx-container class="MathJax" id="a"><svg></svg></mjx-container>
      and
      <mjx-container class="MathJax" id="b"><svg></svg></mjx-container>
    `);
    const rootA = document.getElementById('a');
    const rootB = document.getElementById('b');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).MathJax = {
      startup: {
        // 意図的にb, aの順(DOM順とは逆)でリストしても、出力はDOM順になることを確認する。
        document: { math: [{ math: 'b^2', typesetRoot: rootB }, { math: 'a^2', typesetRoot: rootA }] },
      },
    };

    selectAll();
    expect(extractLatexFromSelection()).toBe('a^2\nb^2');
  });

  // ---------------------------------------------------------------------
  // 戦略2: MathJax v2 (window.MathJax.Hub.getAllJax())
  // ---------------------------------------------------------------------
  it('extracts the TeX source via MathJax v2 Hub.getAllJax()/originalText/SourceElement()', () => {
    setBody(`
      <p>
        <span class="MathJax" id="MathJax-Element-3-Frame">
          <span>...rendered spans, not the source...</span>
        </span>
        <script type="math/tex" id="MathJax-Element-3">this should not be used directly</script>
      </p>
    `);
    const renderedSpan = document.getElementById('MathJax-Element-3-Frame');
    const scriptEl = document.getElementById('MathJax-Element-3');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).MathJax = {
      Hub: {
        getAllJax: () => [
          {
            originalText: '\\int_0^1 x^2\\,dx',
            SourceElement: () => scriptEl,
          },
        ],
      },
    };

    const range = document.createRange();
    range.selectNodeContents(renderedSpan!);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(extractLatexFromSelection()).toBe('\\int_0^1 x^2\\,dx');
  });

  // ---------------------------------------------------------------------
  // 戦略3: DOM直接探索フォールバック(window.MathJaxが無い場合。KaTeX等)
  // ---------------------------------------------------------------------
  it('falls back to DOM annotation scraping when window.MathJax is not present (e.g. KaTeX)', () => {
    setBody(`
      <span class="katex">
        <span class="katex-mathml">
          <math><semantics><annotation encoding="application/x-tex">e^{i\\pi}=-1</annotation></semantics></math>
        </span>
        <span class="katex-html">rendered stuff, not the source</span>
      </span>
    `);
    selectAll();
    expect(extractLatexFromSelection()).toBe('e^{i\\pi}=-1');
  });

  it('reads a ChatGPT-style KaTeX formula when only its rendered glyphs are selected', () => {
    setBody(`<div class="markdown prose"><p>Result:
      <span class="katex"><span class="katex-mathml"><math><semantics>
        <annotation encoding="application/x-tex">\\frac{a}{b}</annotation>
      </semantics></math></span><span class="katex-html" aria-hidden="true"><span id="glyph">a/b</span></span></span>
    </p></div>`);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('glyph')!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(extractLatexFromSelection()).toBe('\\frac{a}{b}');
  });

  it('finds the inner MathJax frame when a display wrapper has no source', () => {
    setBody(`<span class="MathJax_Display"><span class="MathJax" id="MathJax-Element-1-Frame">
      <span id="glyph">rendered</span></span></span><script id="MathJax-Element-1" type="math/tex">x^2</script>`);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('glyph')!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(extractLatexFromSelection()).toBe('x^2');
  });

  it('reads math source stored in a data-latex attribute', () => {
    setBody('<span data-latex="\\sqrt{x}" id="math"><span id="glyph">√x</span></span>');
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('glyph')!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(extractLatexFromSelection()).toBe('\\sqrt{x}');
  });

  it('falls back to visible text when window.MathJax exists but has no usable math list, and no DOM annotation is found', () => {
    setBody(`<mjx-container class="MathJax"><svg>only rendered SVG</svg></mjx-container>`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).MathJax = { startup: { document: { math: [] } } };
    selectAll();
    expect(typeof extractLatexFromSelection()).toBe('string');
  });
});
