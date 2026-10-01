// opentype.js には型定義(.d.ts)が同梱されておらず、@types/opentype.js も存在しないため、
// 動的 import('opentype.js') (mathRender.ts の ensureCJKFontLoading 参照) の型解決用に
// 最小限のアンビエントモジュール宣言を用意する。実際の型は使用箇所で `any` として扱う。
declare module 'opentype.js';
