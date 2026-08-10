# Equashare

LaTeX数式をリアルタイムプレビューしながら、SVG / PNG / JPEG画像として書き出せる
Windows向けデスクトップアプリです。数式を含むスライドや資料に貼り付ける画像を作るためのツールで、
インストール不要・オフラインで完結します。

## ダウンロード

最新版は [Releases](../../releases) ページから入手できます。`.msi` または `.exe`(NSISインストーラー)
のいずれかをダウンロードして実行してください。

| ファイル | 用途 |
|---|---|
| `Equashare_x.y.z_x64_en-US.msi` | MSIインストーラー(Windows標準) |
| `Equashare_x.y.z_x64-setup.exe` | NSISインストーラー |

※ 初回起動時にWindows Defender SmartScreenの警告が出る場合がありますが、コード署名を行っていない
未署名アプリのための標準的な挙動です(「詳細情報」→「実行」で起動できます)。

## 主な機能

- **リアルタイムプレビュー**: LaTeX数式を入力しながらその場でプレビュー表示(タイピング中もカクつかない)
- **複数行対応**: 1行1数式として複数行をまとめて1枚の画像に合成
- **出力形式**: SVG(ベクター) / PNG / JPEG から選択、文字サイズ・解像度倍率・JPEG品質・文字色・背景色
  (透過も可)をGUIで調整
- **日本語対応**: `\text{}`内の日本語をフォントアウトライン化して埋め込むため、実行環境にフォントが
  無くても文字化けしない
- **書き出し方法を選べる**: クリップボードへコピー(`Ctrl+Shift+C`)/ ファイル保存(`Ctrl+S`)/
  コピー＆保存(`Ctrl+Shift+S`)/ LaTeXソースを`.tex`として保存、のいずれか。ファイルは明示的な操作を
  しない限り保存されない
- **入力補助**: よく使う数式のサンプル挿入、分数・根号・上下付き・総和・積分などのテンプレートボタン
- **構文エラーの可視化**: 該当行を行番号ガター上で赤くハイライト
- **プレビューのズーム/パン**、**ライト/ダークテーマ**、レイアウトのドラッグ調整に対応
- 直近の保存先フォルダ・テーマ・レイアウト・ウィンドウ位置は次回起動時にも記憶される

## 動作環境

- Windows 10 / 11 (64-bit)
- WebView2 Runtime(Windows 10/11のほとんどの環境には標準搭載済み。無い場合は
  [公式サイト](https://developer.microsoft.com/microsoft-edge/webview2/)から入手可能)

## 使い方

1. アプリを起動すると、左側の入力欄にサンプルの数式が表示されます
2. 入力欄にLaTeX形式で数式を書くと、右側にリアルタイムでプレビューが表示されます(1行1数式)
3. 上部の設定欄で出力形式・サイズ・色などを調整します
4. `Ctrl+S`(ファイル保存)または`Ctrl+Shift+C`(クリップボードにコピー)で書き出します
5. 詳しい使い方はタイトルバーの「？」ボタンから確認できます

## 開発者向け: ソースからビルドする

### 前提ツール

1. **Rust**: [rustup.rs](https://rustup.rs/) から `rustup-init.exe` を実行してインストール
2. **Node.js** (LTS): [nodejs.org](https://nodejs.org/)
3. **WebView2 Runtime**: 上記「動作環境」参照
4. **Visual Studio Build Tools**(「Desktop development with C++」ワークロード): Rust for Windowsに必要

### 開発モードで起動

```powershell
npm install
npm run tauri dev
```

### 配布用インストーラーをビルド

```powershell
npm run tauri build
```

`src-tauri/target/release/bundle/` 配下に `.msi` と `.exe`(NSIS)インストーラーが生成されます。
このファイルをGitHub Releasesにアップロードして配布します。

## 技術スタック

- **フロントエンド**: TypeScript + Vite。数式のTeX→SVG変換に[MathJax](https://www.mathjax.org/)、
  日本語のフォントアウトライン化に[opentype.js](https://opentype.js.org/)を使用
- **バックエンド**: [Tauri](https://tauri.app/)(Rust)。SVGのラスタライズに
  [resvg](https://github.com/RazrFalcon/resvg)、クリップボード操作に
  [arboard](https://github.com/1Password/arboard)を使用

## 同梱フォントのライセンス

日本語表示には [Noto Serif JP](https://fonts.google.com/noto/specimen/Noto+Serif+JP)
(SIL Open Font License 1.1)を静的インスタンス化(Regularウェイト)・WOFF圧縮した上で同梱しています。
ライセンス全文は `public/fonts/LICENSE-NotoSerifJP.txt` を参照してください。商用・個人利用ともに
無料で、アプリへの組み込み・再配布が許可されています。

## ライセンス

本プロジェクト自体のライセンスは未定です。公開・配布にあたって適切なライセンスを選定し、
`LICENSE` ファイルを追加してください。
