import { defineConfig } from 'vite';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mathjaxVersion = require('mathjax-full/package.json').version;
const appVersion = require('./package.json').version;

// Chrome/Edge拡張機能(MV3)向けビルド設定。
// public/ 配下(manifest.json / icons / fonts)はViteの標準機能によりそのままdist/ルートへ
// コピーされる。background.js は(v4.0.0以降)素の静的JSではなく、テスト可能にするため
// src/background.ts としてビルドパイプラインに含めている(下のrollupOptions.input参照)。
export default defineConfig(async () => ({
  clearScreen: false,
  // Relative asset paths work both from the extension root and GitHub Pages project paths.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  // mathjax-full の version.js は、バンドラが PACKAGE_VERSION をグローバル定数として
  // 注入する前提で書かれている (webpack DefinePlugin 想定)。未定義のままだと
  // eval('require') / eval('__dirname') にフォールバックし、Node非依存の
  // ブラウザ環境では `ReferenceError: require is not defined` で
  // モジュール読み込み自体が例外停止する。これが main.ts -> mathRender.ts の
  // import連鎖を巻き込み、JSが一切実行されず「プレビューが真っ白」になっていた直接原因。
  define: {
    PACKAGE_VERSION: JSON.stringify(mathjaxVersion),
    // アプリ自身のバージョン表示(タブタイトル・ヘルプパネル)用。上のPACKAGE_VERSIONは
    // mathjax-full内部が要求する別物の定数のため名前を衝突させない。
    APP_VERSION: JSON.stringify(appVersion),
  },
  build: {
    target: 'es2021',
    minify: 'esbuild',
    // MV3拡張機能ページはCSPで 'unsafe-eval' 等が禁止されるため、esbuildのminifyで
    // eval系ヘルパーが混入しないことを前提にしている(このプロジェクトのコードは元々
    // evalを一切使わない)。ソースマップは配布物のサイズ増加とソース露出を避けるため無効化。
    sourcemap: false,
    rollupOptions: {
      input: {
        // popup.html(グローバルホットキー用の簡易入力ポップアップ)を、メインのindex.htmlとは
        // 別のビルドエントリとして追加する。デフォルトのままだとViteはindex.htmlしかビルド
        // 対象に含めないため、popup.html/popup.tsを明示的に指定する必要がある。
        main: 'index.html',
        popup: 'popup.html',
        // background.ts(MV3 service worker)。HTMLを介さないプレーンなJSエントリとして追加。
        background: 'src/background.ts',
      },
      output: {
        // manifest.jsonの"background.service_worker"は固定のファイル名を要求するため、
        // 既定の(ハッシュ付き)命名から"background"エントリだけを除外し、常に
        // dist/background.js という名前でビルドされるようにする。main/popupのチャンクは
        // 従来通りキャッシュ用のハッシュ付き名前のままでよい。
        entryFileNames: (chunkInfo) => (chunkInfo.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
}));
