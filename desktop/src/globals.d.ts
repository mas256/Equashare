// vite.config.ts の define で注入されるグローバル定数の型宣言。
// APP_VERSION は package.json の version フィールド (アプリ自身のバージョン) の文字列。
// ウィンドウタイトル・ヘルプパネルのバージョン表示で使う (指示書3 2.4)。
declare const APP_VERSION: string;
