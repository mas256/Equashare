import { beforeAll, describe, expect, it } from 'vitest';
import { composeMathML, composeSvg, composeUnicodeApprox, loadCJKFont, splitLines, splitLinesWithNumbers } from './mathRender';

describe('splitLines', () => {
  it('splits on newlines and drops empty lines', () => {
    expect(splitLines('a\n\nb\n')).toEqual(['a', 'b']);
  });

  it('handles CRLF', () => {
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
  });
});

describe('splitLinesWithNumbers', () => {
  it('keeps 1-based original line numbers even when blank lines are skipped', () => {
    const result = splitLinesWithNumbers('a\n\nb');
    expect(result).toEqual([
      { text: 'a', lineNumbers: [1] },
      { text: 'b', lineNumbers: [3] },
    ]);
  });

  it('joins lines between \\begin{nobreak} and \\end{nobreak} into one logical line', () => {
    const result = splitLinesWithNumbers('a\n\\begin{nobreak}\nx+y\n=z\n\\end{nobreak}\nb');
    expect(result).toEqual([
      { text: 'a', lineNumbers: [1] },
      { text: 'x+y =z', lineNumbers: [2, 3, 4, 5] },
      { text: 'b', lineNumbers: [6] },
    ]);
  });

  it('keeps \\begin{nobreak} in the output when \\end{nobreak} is missing, so it surfaces as a syntax error', () => {
    const result = splitLinesWithNumbers('\\begin{nobreak}\nx\ny');
    expect(result).toEqual([{ text: '\\begin{nobreak} x y', lineNumbers: [1, 2, 3] }]);
  });

  it('does the same when the closing tag is typoed without its leading backslash', () => {
    // \end{nobreak} のバックスラッシュを打ち忘れた場合、end{nobreak}は通常の行として
    // バッファに取り込まれてしまう(=閉じタグとして認識されない)。この場合も
    // \begin{nobreak}が残ったまま1つの論理行になるべき。
    const result = splitLinesWithNumbers('\\begin{nobreak}\naa\nbb\ncc\ndd\nend{nobreak}');
    expect(result).toEqual([
      { text: '\\begin{nobreak} aa bb cc dd end{nobreak}', lineNumbers: [1, 2, 3, 4, 5, 6] },
    ]);
  });

  it('drops an empty \\begin{nobreak}...\\end{nobreak} block with no content', () => {
    const result = splitLinesWithNumbers('a\n\\begin{nobreak}\n\\end{nobreak}\nb');
    expect(result).toEqual([
      { text: 'a', lineNumbers: [1] },
      { text: 'b', lineNumbers: [4] },
    ]);
  });
});

describe('composeSvg', () => {
  beforeAll(async () => {
    await loadCJKFont('/fonts/NotoSerifJP-Regular.woff');
  });

  it('renders valid TeX without flagging an error', () => {
    const result = composeSvg(['e^{i\\pi}=-1']);
    expect(result.errorLines).toEqual([]);
    expect(result.svg).toContain('<svg');
  });

  it('flags a line with invalid TeX as an error without affecting other lines', () => {
    const result = composeSvg(['e^{i\\pi}=-1', '\\notarealcommand{x}']);
    expect(result.errorLines).toEqual([1]);
  });

  // 未定義コマンドの検出は「行が赤くなる」だけでなく、MathJaxが返す具体的な
  // エラーメッセージ(どのコマンドが未定義か)もerrorMessagesとして拾えること。
  it('captures the specific "Undefined control sequence" message for an unknown command', () => {
    const result = composeSvg(['e^{i\\pi}=-1', '\\notarealcommand{x}']);
    expect(result.errorMessages.get(1)).toMatch(/Undefined control sequence \\notarealcommand/);
    expect(result.errorMessages.has(0)).toBe(false);
  });

  // align("&")グループ内の1行だけが未定義コマンドを含む場合も、そのグループ内の
  // 該当行についてerrorMessagesが取れること(グループ処理は非グループ処理と別コードパス)。
  it('captures the error message for an undefined command inside an "&"-aligned group', () => {
    const result = composeSvg(['a &= b', '\\notarealcommand &= d']);
    expect(result.errorMessages.get(1)).toMatch(/Undefined control sequence \\notarealcommand/);
  });

  // 指示書のバグ報告の再現: \end{nobreak} のバックスラッシュ抜けタイポにより閉じタグが
  // 認識されず、以前は "aabbccddendnobreak" のようにただの文字列として描画されてしまって
  // いた。splitLinesWithNumbersが\begin{nobreak}を出力に残すようになったことで、
  // "nobreak"がMathJaxにとって未知の環境名であるため、ここで構文エラーとして
  // 検出されるべき。
  it('flags an unclosed \\begin{nobreak} block (e.g. a typoed \\end{nobreak}) as a syntax error', () => {
    const numbered = splitLinesWithNumbers('\\begin{nobreak}\naa\nbb\ncc\ndd\nend{nobreak}');
    const result = composeSvg(numbered.map((n) => n.text));
    expect(result.errorLines).toEqual([0]);
  });

  // 回帰テスト: Japanese \text{} content must render as real glyph paths, not literal '?'.
  // (公開されたレビューでは "3文字とも `?` に変換される" と主張されていたが、実際には
  // 再現しない。将来の変更でこれが壊れていないことを確認する。)
  it('renders Japanese \\text{} content as paths, not literal "?"', () => {
    const result = composeSvg(['\\text{日本語}']);
    expect(result.errorLines).toEqual([]);
    expect(result.svg).not.toMatch(/<text[^>]*>[^<]*\?[^<]*<\/text>/);
    expect(result.svg.replace(/<\?xml[^>]*\?>/, '')).not.toContain('?');
  });

  // \left( \right) / \left\{ \right\} は追加パッケージなしのbaseパッケージで動作する
  // (よく使う記法ボタンとして新規追加。レンダラ側の変更は不要だが、ボタンが挿入する
  // 文字列が実際にエラーにならないことをここで担保しておく)。
  it('renders \\left( \\right) and \\left\\{ \\right\\} without flagging an error', () => {
    const result = composeSvg(['\\left(a\\right)', '\\left\\{a\\right\\}']);
    expect(result.errorLines).toEqual([]);
  });

  // 回帰テスト(P0): \newcommand は共有TeXコンテキストのマクロテーブルを書き換える副作用を
  // 持つ。定義行を除いた入力を再度渡したときは、そのマクロはもう使えない(=エラーになる)
  // べきである。これが効いていないと、「定義行を消してもアプリを再起動するまでは
  // 動き続けてしまう」という静かな不整合になる。
  it('invalidates a macro once its defining line is no longer present in the input', () => {
    const withDefinition = composeSvg(['\\newcommand{\\R}{\\mathbb{R}}', '\\R']);
    expect(withDefinition.errorLines).toEqual([]);

    const withoutDefinition = composeSvg(['\\R']);
    expect(withoutDefinition.errorLines).toEqual([0]);

    const redefined = composeSvg(['\\newcommand{\\R}{\\mathbb{R}}', '\\R', '\\R']);
    expect(redefined.errorLines).toEqual([]);
  });
});

// 「&」による位置揃え(align型、v3.0で追加)
describe('composeSvg with "&" alignment', () => {
  beforeAll(async () => {
    await loadCJKFont('/fonts/NotoSerifJP-Regular.woff');
  });

  it('renders a single line containing "&" without a syntax error', () => {
    const result = composeSvg(['a &= b']);
    expect(result.errorLines).toEqual([]);
    expect(result.svg).toContain('<svg');
  });

  it('produces the same overall block width for every row in an aligned group', () => {
    // 2行目は左辺が長いため、素の(整列なしの)幅は行ごとに異なるはずだが、
    // 整列グループ内では列幅で揃えられるため、生成される<svg>ブロックの幅は同じになる。
    const short = composeSvg(['x &= 1']);
    const long = composeSvg(['x_{n+1} &= 1']);
    const shortWidth = /width="([\d.]+)"/.exec(short.svg)?.[1];
    const longWidth = /width="([\d.]+)"/.exec(long.svg)?.[1];

    const grouped = composeSvg(['x &= 1', 'x_{n+1} &= 1']);
    expect(grouped.errorLines).toEqual([]);
    // グループ化された2行が、単独レンダリング時の最大値と概ね同じ全体幅になっている
    // (=短い行が長い行の列幅に合わせて広がっている)ことを、外側の<svg width=...>から確認する。
    const groupedWidth = Number(/width="([\d.]+)"/.exec(grouped.svg)?.[1]);
    expect(groupedWidth).toBeGreaterThanOrEqual(Number(longWidth));
    expect(groupedWidth).toBeGreaterThan(Number(shortWidth));
  });

  it('does not treat an escaped "\\&" as an alignment marker', () => {
    const result = composeSvg(['a \\& b']);
    expect(result.errorLines).toEqual([]);
  });

  it('does not treat "&" inside \\text{} (braces) as an alignment marker', () => {
    const result = composeSvg(['\\text{A \\& B}']);
    expect(result.errorLines).toEqual([]);
  });

  it('breaks the alignment group at a line without "&"', () => {
    // 3行目は&を含まないため、1,2行目のグループとは独立して扱われる。
    const result = composeSvg(['a &= b', 'c &= d', 'e=f']);
    expect(result.errorLines).toEqual([]);
  });

  it('flags only the offending row as an error inside an aligned group, leaving other rows intact', () => {
    const result = composeSvg(['a &= b', '\\notarealcommand &= d']);
    expect(result.errorLines).toEqual([1]);
  });

  it('supports more than one "&" per line (multi-column alignment)', () => {
    const result = composeSvg(['a &= b &= c', 'd &= e &= f']);
    expect(result.errorLines).toEqual([]);
  });

  // v3.0.1で修正: \begin{array}/\begin{pmatrix}等、MathJaxネイティブに「&」を列区切りと
  // して使う環境の内側まで、独自の位置揃え機能が誤って分割してしまいSyntax Errorになる不具合。
  it('does not treat "&" inside \\begin{pmatrix}...\\end{pmatrix} as an alignment marker', () => {
    const result = composeSvg(['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}']);
    expect(result.errorLines).toEqual([]);
  });

  it('does not treat "&" inside \\begin{array}...\\end{array} as an alignment marker', () => {
    const result = composeSvg(['\\begin{array}{cc} a & b \\\\ c & d \\end{array}']);
    expect(result.errorLines).toEqual([]);
  });

  it('does not treat "&" inside \\begin{cases}...\\end{cases} as an alignment marker', () => {
    const result = composeSvg(['f(x)=\\begin{cases} 1 & x>0 \\\\ -1 & x<0 \\end{cases}']);
    expect(result.errorLines).toEqual([]);
  });

  it('still aligns a top-level "&" that appears before a \\begin{...}...\\end{...} block', () => {
    // 先頭の&は整列マーカーとして分割対象、cases内部の&は分割対象外、という混在ケース。
    const result = composeSvg(['x &= \\begin{cases} 1 & a>0 \\\\ -1 & a<0 \\end{cases}']);
    expect(result.errorLines).toEqual([]);
  });

  it('works when \\begin{nobreak}...\\end{nobreak} joins multiple physical lines into one matrix', () => {
    const result = composeSvg([
      // splitLinesWithNumbersが行う結合を、composeSvgへ渡す直前の形(1つの結合済み行)で模擬する。
      '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    ]);
    expect(result.errorLines).toEqual([]);
  });

  it('still splits alignment groups spanning multiple lines even when one row contains a matrix', () => {
    const result = composeSvg(['x &= \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'y &= 1']);
    expect(result.errorLines).toEqual([]);
  });
});

describe('composeMathML', () => {
  it('produces a <math> block for a simple expression', () => {
    const result = composeMathML(['\\frac{a}{b} + \\alpha^2']);
    expect(result).toContain('<math');
    expect(result).toContain('<mfrac>');
    // \alphaはMathJax内部でUnicodeのαへ解決されているが、SerializedMmlVisitorは
    // 非ASCII文字をXMLの数値文字参照(&#x3B1;)として出力する(仕様通りの正しい挙動)。
    expect(result).toContain('&#x3B1;');
  });

  it('wraps "&"-aligned lines in an aligned environment instead of erroring', () => {
    // 生の「&」はMathJaxへそのまま渡すと "Misplaced &" エラーになるため、composeMathMLは
    // composeSvgと同じグループ化ロジックで\begin{aligned}...\end{aligned}へ包んでから渡す。
    const result = composeMathML(['x &= 1', 'y &= 2']);
    expect(result).not.toContain('Misplaced');
    expect(result).toContain('<mtable');
  });

  it('represents an undefined command as <merror>, matching the SVG path behavior', () => {
    const result = composeMathML(['\\notarealcommand{x}']);
    expect(result).toContain('<merror');
  });

  it('produces one <math> block per input line, newline-separated', () => {
    const result = composeMathML(['a+b', 'c+d']);
    expect((result.match(/<math /g) ?? []).length).toBe(2);
  });
});

describe('composeUnicodeApprox', () => {
  it('renders greek letters and superscripts using real Unicode characters', () => {
    expect(composeUnicodeApprox(['\\alpha^2 + \\beta_i'])).toBe('α² + βᵢ');
  });

  it('renders \\frac as a parenthesized-when-needed division', () => {
    expect(composeUnicodeApprox(['\\frac{a}{b}'])).toBe('a/b');
    // MathJaxは二項マイナスをASCIIの'-'ではなくU+2212(−, MINUS SIGN)へ正規化する。
    expect(composeUnicodeApprox(['\\frac{x+1}{y-2}'])).toBe('(x + 1)/(y − 2)');
  });

  it('renders \\sqrt using the √ symbol', () => {
    expect(composeUnicodeApprox(['\\sqrt{x+1}'])).toBe('√(x + 1)');
  });

  it('falls back to ^() / _() notation when no Unicode sub/superscript glyph exists', () => {
    // 'q' には上付き文字のUnicode表現が存在しないため、"^(...)" 記法にフォールバックする。
    expect(composeUnicodeApprox(['x^q'])).toBe('x^(q)');
  });

  it('renders uppercase Latin superscripts where a Unicode glyph exists (v4.0.1)', () => {
    expect(composeUnicodeApprox(['x^A'])).toBe('xᴬ');
    expect(composeUnicodeApprox(['x^V'])).toBe('xⱽ');
    expect(composeUnicodeApprox(['x^W'])).toBe('xᵂ');
  });

  it('still falls back for uppercase letters with no Unicode superscript form (v4.0.1)', () => {
    // C, F, Q, S, X, Y, Z は対応する上付き文字がUnicodeに存在しない。
    expect(composeUnicodeApprox(['x^C'])).toBe('x^(C)');
    expect(composeUnicodeApprox(['x^Q'])).toBe('x^(Q)');
  });

  it('renders Greek super/subscripts where a Unicode glyph exists (v4.0.1)', () => {
    expect(composeUnicodeApprox(['g^{\\beta}'])).toBe('gᵝ');
    expect(composeUnicodeApprox(['a_{\\rho}'])).toBe('aᵨ');
    // Unicodeの上付きギリシャ文字は\phiと\varphiを区別しないため、両方とも同じ文字になる。
    expect(composeUnicodeApprox(['x^{\\phi}'])).toBe('xᵠ');
    expect(composeUnicodeApprox(['x^{\\varphi}'])).toBe('xᵠ');
  });

  it('still falls back for Greek letters with no Unicode super/subscript form (v4.0.1)', () => {
    // μ(mu), ν(nu)には上付き・下付きどちらのUnicode表現も存在しない。
    expect(composeUnicodeApprox(['x^{\\mu}'])).toBe('x^(μ)');
    expect(composeUnicodeApprox(['x_{\\nu}'])).toBe('x_(ν)');
  });

  it('renders common relation/operator symbols', () => {
    expect(composeUnicodeApprox(['\\leq \\geq \\neq \\pm \\infty'])).toBe('≤≥≠ ± ∞');
  });

  it('wraps "&"-aligned lines the same way composeMathML does, without throwing', () => {
    const result = composeUnicodeApprox(['x &= 1', 'y &= 2']);
    expect(result).toContain('x');
    expect(result).toContain('y');
  });

  it('renders an undefined command as a bracketed error marker instead of throwing', () => {
    expect(composeUnicodeApprox(['\\notarealcommand{x}'])).toBe('[エラー]');
  });
});
