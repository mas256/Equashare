import { defineConfig } from 'vite';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const require = createRequire(import.meta.url);
const mathjaxVersion = require('mathjax-full/package.json').version;
const appVersion = require('./package.json').version;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Tauri公式ドキュメント推奨の設定
// https://tauri.app/v1/guides/getting-started/setup/vite/
export default defineConfig(async () => ({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // src-tauri/target 以下はcargoがビルド中に.exe等を書き換え続けるため、
    // ここをViteの監視対象に含めているとWindowsでファイルロック(EBUSY)を起こし
    // `beforeDevCommand`(=vite)自体が例外終了する。Tauri公式テンプレート通り除外する。
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  // mathjax-full の version.js は、バンドラが PACKAGE_VERSION をグローバル定数として
  // 注入する前提で書かれている (webpack DefinePlugin 想定)。未定義のままだと
  // eval('require') / eval('__dirname') にフォールバックし、Node非依存の
  // ブラウザ/Tauri WebView環境では `ReferenceError: require is not defined` で
  // モジュール読み込み自体が例外停止する。これが main.ts -> mathRender.ts の
  // import連鎖を巻き込み、JSが一切実行されず「プレビューが真っ白」になっていた直接原因。
  define: {
    PACKAGE_VERSION: JSON.stringify(mathjaxVersion),
    // アプリ自身のバージョン表示(ウィンドウタイトル・ヘルプパネル)用。上のPACKAGE_VERSIONは
    // mathjax-full内部が要求する別物の定数のため名前を衝突させない。
    APP_VERSION: JSON.stringify(appVersion),
  },
  build: {
    target: 'es2021',
    minify: 'esbuild',
    // 本番ビルド(Tauriがdist/をそのままインストーラーへ同梱する)にソースマップを
    // 含めるとサイズが増えるだけでなく、デバッグ用の.mapファイルがそのまま配布物に
    // 入ってしまう。開発サーバー(vite dev)はこの設定と無関係に常にソースマップ相当の
    // 情報を提供するため、ここをfalseにしても開発体験は変わらない。
    sourcemap: false,
    // v4.0: 簡易入力ポップアップ(quickpopup.html)用に、マルチページビルドへ変更する。
    // メイン画面(index.html)とは完全に別のJSバンドル(src/quickPopup.ts)として出力され、
    // 起動時にメイン画面側のコード(2000行超のmain.ts)を一切読み込まずに済む。
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        quickpopup: resolve(__dirname, 'quickpopup.html'),
      },
    },
  },
}));
