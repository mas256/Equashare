# Equashare

[English](README_en.md) | 日本語

### 数式を、つくって、画像にして、共有する。

数式を誰かに共有したいとき、数式ひとつのために大きなPDFを作る必要はありません。
このアプリは、LaTeXの数式を手軽に画像へ変換するための軽量な数式エディタです。

数式だけを入力すれば、リアルタイムにレンダリング。文書構造やPDF生成を意識することなく、数式そのものに集中できます。

LaTeX入力はツールバーでサポート。よく使う記法や構造をボタンから挿入できるため、コマンドを調べる手間を減らしながらスムーズに数式を作成できます。

完成した数式はPNGとしてクリップボードへコピーでき、PNG・JPEG・SVG形式で保存することも可能です。

Rustによる高速な処理と効率的なレンダリングにより、入力からプレビューまでを軽快に。数式を作るところから画像として使うところまで、できるだけシンプルな体験を目指しました。

大きなPDFはいらない。専用のビューアもいらない。欲しいのは、数式の画像だけ。

数式を含むスライドや資料に貼り付ける画像を作るためのツールで、オフラインで完結します。

## 主な機能

- **リアルタイムプレビュー**: LaTeX数式を入力しながらその場でプレビュー表示(タイピング中もカクつかない)
- **プレビューのズーム/パン**、**ライト/ダークテーマ**、レイアウトのドラッグ調整に対応
- **日本語対応**: Noto Serif JPで出力されます。
- **書き出し方法を選べる**: クリップボードへコピー(`Ctrl+Shift+C`)/ ファイル保存(`Ctrl+S`)の
  いずれか。ファイルは明示的な操作をしない限り保存されない
- **LaTeXソースの保存(2種類)**:
  - **ソースを保存 (.tex)**: 入力欄の内容をそのまま(`\documentclass`等を付けずに)`.tex`として保存。
    既存のLaTeX文書に貼り付けて使う用途向け
- **出力形式**: SVG(ベクター) / PNG から選択、文字サイズ・解像度倍率・余白(px)・文字色・背景色 (透過も可)
- **入力補助**: よく使う数式のサンプル挿入、分数・根号・上下付き・総和・積分などのテンプレートボタン

詳細はアプリ右上の?ボタンから機能を読んでください。

## 動作環境

- Windows 10 / 11 (64-bit)

## 開発

```
npm install
npm run dev      # 開発サーバー
npm test         # ユニットテスト
npm run build    # フロントエンドのビルド確認
```

`.tex`書き出しを検証する際は、`npm run build` に加えて実際にLaTeXエンジン(pdflatex/xelatex等)で
コンパイルして確認することを推奨します(プレビュー側のMathJaxは実際のLaTeXエンジンより記法に寛容な
ため、プレビューでエラーが出ない=実際にコンパイルできる、とは限りません)。

## 使い方

1. アプリを起動すると、左側の入力欄にサンプルの数式が表示されます
2. 入力欄にLaTeX形式で数式を書くと、右側にリアルタイムでプレビューが表示されます(1行1数式)
3. 上部の設定欄で出力形式・サイズ・色などを調整します
4. `Ctrl+S`(ファイル保存)または`Ctrl+Shift+C`(クリップボードにコピー)で書き出します
5. 詳しい使い方はタイトルバーの「？」ボタンから確認できます

## ライセンス

本体は[MITライセンス](LICENSE)です。

同梱の日本語フォント(Noto Serif JP)は[SIL Open Font License 1.1](https://openfontlicense.org/)です。
再配布・改変は自由ですが、フォント自体の名称使用等に関するOFLの条件が別途あります。詳細は
`public/fonts/LICENSE-NotoSerifJP.txt` を参照してください。

# Equashare

English | [日本語](README_jp.md)

### Write a formula. Turn it into an image. Share it.

When you just want to share a single formula with someone, you shouldn't have to build a whole PDF for it.
Equashare is a lightweight formula editor that turns LaTeX math into an image in a few keystrokes.

Type only the formula and watch it render in real time. No document structure, no PDF pipeline to think
about — just the formula itself.

The toolbar helps you write LaTeX: common notation and structures can be inserted with a click, so you
spend less time looking up commands and more time writing the formula.

Once it's ready, copy the finished formula to the clipboard as PNG, or save it as PNG, JPEG, or SVG.

Rust-powered processing and efficient rendering keep everything snappy, from typing to preview. The goal
is the simplest possible path from "writing a formula" to "having an image of it."

No large PDF. No dedicated viewer. Just the image of the formula, and nothing else.

It's a tool for producing images to paste into slides or documents that contain math, and it works
entirely offline.

## Key features

- **Real-time preview**: see the LaTeX formula rendered as you type, without stutter while typing
- **Preview zoom/pan**, **light/dark theme**, and drag-to-resize layout
- **Japanese support**: text rendered with Noto Serif JP
- **Choose how to export**: copy to clipboard (`Ctrl+Shift+C`) or save to a file (`Ctrl+S`) — no file is
  ever written unless you explicitly save
- **Two ways to save the LaTeX source**:
  - **Save source (.tex)**: saves the contents of the input box as-is (without a `\documentclass` etc.)
    as `.tex`, for pasting into an existing LaTeX document
- **Output format**: choose SVG (vector) or PNG, with font size, resolution scale, padding (px), text
  color, and background color (including transparency)
- **Input assistance**: insert common formula samples, plus template buttons for fractions, roots,
  sub/superscripts, summation, integrals, and more

See the ? button in the top right of the app for full details.

## Requirements

- Windows 10 / 11 (64-bit)

## Development

```
npm install
npm run dev      # dev server
npm test         # unit tests
npm run build    # verify the frontend build
```

When verifying `.tex` export, in addition to `npm run build`, it's recommended to actually compile the
output with a real LaTeX engine (pdflatex/xelatex, etc.). MathJax in the preview is more lenient with
syntax than a real LaTeX engine, so the preview showing no error doesn't guarantee it will actually
compile.

## Usage

1. When the app starts, a sample formula appears in the input box on the left
2. Type a formula in LaTeX in the input box, and a real-time preview appears on the right (one formula
   per line)
3. Adjust the output format, size, and colors in the settings area above
4. Export with `Ctrl+S` (save file) or `Ctrl+Shift+C` (copy to clipboard)
5. For detailed usage, check the "?" button in the title bar

## License

The app itself is [MIT licensed](LICENSE).

The bundled Japanese font (Noto Serif JP) is licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/). Redistribution and modification are free, but
the OFL has separate conditions around use of the font's name, etc. See
`public/fonts/LICENSE-NotoSerifJP.txt` for details.
