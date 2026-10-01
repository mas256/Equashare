/**
 * nativeHost.ts
 *
 * デスクトップアプリ(Tauri版Equashare)とのNative Messaging連携用の定数と、
 * 「選択中の数式をアプリへ送る」呼び出し本体。
 *
 * 通信の流れ:
 *   1. このモジュールが chrome.runtime.sendNativeMessage で NATIVE_HOST_NAME 宛に
 *      { source: "<LaTeXソース>" } を送る。
 *   2. Chromeが「com.equashare.nativehost」という名前で登録されたネイティブメッセージング
 *      ホストを起動し、標準入出力経由でこのメッセージを渡す。ホストの実体はデスクトップ版
 *      Equashareの実行ファイル自身で、デスクトップ版の設定(⚙)「ブラウザ拡張機能との連携」
 *      から「連携を設定...」を押すと、そのファイルパスを含むホストマニフェストJSONの生成と
 *      レジストリ登録が行われる(src-tauri/src/native_host.rs参照。インストーラによる
 *      自動登録ではなく、ユーザーが明示的に有効化する方式)。
 *   3. ホスト側は、デスクトップアプリ本体が起動中ならローカルのループバック専用ソケット
 *      (127.0.0.1:47823、src-tauri/src/native_host.rs参照)へ中継し、未起動ならアプリ自体を
 *      数式付きで起動する。
 *   4. ホストは { status: "ok" } または { status: "error", message: "..." } を返す。
 *
 * ネイティブメッセージングホストが未登録の環境(デスクトップ版で連携を設定していない、
 * またはデスクトップ版自体が無い)では chrome.runtime.lastError が付き、この関数は
 * falseを返す。呼び出し側は必ずフォールバック(拡張機能自身のポップアップを開く等)を
 * 用意すること。
 */

/** デスクトップ版アプリがレジストリへ登録するネイティブメッセージングホスト名。
 * デスクトップ版のnative_host.rs内のNATIVE_HOST_NAME定数と完全に一致していなければ
 * ならない。 */
export const NATIVE_HOST_NAME = 'com.equashare.nativehost';

export interface NativeHostResponse {
  status: 'ok' | 'error';
  message?: string;
}

/** 選択中の数式(LaTeXソース)をデスクトップアプリへ送る。
 * 送信に成功し、かつホストから { status: "ok" } が返れば true。
 * ホスト未登録・アプリとの中継失敗など、何かしら問題があれば false
 * (呼び出し側はfalseの場合、必ず既存の拡張機能内ポップアップへフォールバックすること)。 */
export function sendSourceToDesktopApp(source: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendNativeMessage) {
      resolve(false);
      return;
    }
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { source }, (response: NativeHostResponse | undefined) => {
        if (chrome.runtime.lastError || !response || response.status !== 'ok') {
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
