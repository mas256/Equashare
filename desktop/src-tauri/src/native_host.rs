// native_host.rs
//
// ブラウザ拡張機能(Equashare Extension)とデスクトップアプリ間の Native Messaging 連携。
// 拡張機能側の実装は equashare-extension/src/nativeHost.ts / background.ts を参照。
//
// 全体の流れ:
//   1. 拡張機能がCtrl+Shift+E(ブラウザにフォーカスがある間だけ)で選択中の数式を検出すると、
//      chrome.runtime.sendNativeMessage() で、このexeを「ネイティブメッセージングホスト」
//      として起動する(未起動なら新規プロセスとして、Chromeが自動的に起動する)。
//   2. Chromeはこのexeを `equashare.exe <manifestで指定したパス...> chrome-extension://<拡張機能ID>/`
//      という形の引数で起動し、標準入出力を掴んでメッセージをやり取りする(4バイトの
//      リトルエンディアン長さプレフィックス + UTF-8 JSON、という決まったプロトコル)。
//   3. main()の冒頭でこの起動のされ方(引数に"chrome-extension://"が含まれるか)を検知し、
//      通常のGUI起動(Tauri::Builder)ではなく run_as_native_host() 側の処理へ分岐する。
//   4. run_as_native_host()は、まず「デスクトップアプリ本体が既に起動しているか」を、
//      ループバック専用のローカルTCP(127.0.0.1:LOCAL_RELAY_PORT)で確認する。
//      - 起動済みなら、そのローカルTCP経由で数式ソースを中継するだけで終わる
//        (中継用の簡易プロトコルは改行区切りJSON。Chrome側の長さプレフィックス方式とは
//        別物なので混同しないこと)。
//      - 未起動なら、このexe自身を「数式入り一時ファイルのパス」を引数に付けて新規に
//        1つだけ起動し、新しく起動したプロセス(=GUI本体)がその一時ファイルを読んで
//        簡易入力ポップアップに反映する。
//
// セキュリティ上の注意:
//   - ローカルTCPは127.0.0.1(ループバックアドレス)のみにbindし、外部ネットワークからは
//     一切到達できないようにする。念のため接続元アドレスもループバックか確認する。
//   - Chrome側のネイティブメッセージングホストマニフェストのallowed_originsで、
//     このアプリ用に固定した拡張機能ID(manifest.jsonの"key"から一意に決まる)以外からの
//     起動をOS側(Chrome側)で弾く。

use rand::RngCore;
use std::io::{BufRead, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Mutex, OnceLock,
};
use std::time::Duration;
use tauri::Manager;

/// Native Messaging(または既存プロセスからの中継)経由で届いた「まだフロントエンドが
/// 消費していない数式ソース」。quickPopup.ts側はウィンドウがフォーカスを得るたびに
/// take_pending_quick_popup_source コマンドでこれを取りに行く(既存の「フォーカスを
/// 得たら入力欄をクリアする」処理と同じタイミングにまとめることで、「先に空欄へ
/// クリアされてから中身が届く/届いた直後に空欄へ上書きされる」というレースを避ける)。
///
/// launched_for_quick_popupは「起動直後に一度でも中身があったか」を示す固定値。
/// メイン画面(main.ts)が自分自身を自動表示すべきかどうかの判定にだけ使うため、
/// take_pending_quick_popup_source() で中身を取り出した後も変化しない。
pub struct PendingQuickPopupSource {
    source: Mutex<Option<String>>,
    launched_for_quick_popup: bool,
    ready: AtomicBool,
}

impl PendingQuickPopupSource {
    pub fn new(initial: Option<String>) -> Self {
        let launched_for_quick_popup = initial.is_some();
        Self {
            source: Mutex::new(initial),
            launched_for_quick_popup,
            ready: AtomicBool::new(false),
        }
    }

    fn set(&self, source: String) {
        *self.source.lock().unwrap_or_else(|p| p.into_inner()) = Some(source);
    }
}

#[tauri::command]
pub fn mark_quick_popup_ready(state: tauri::State<PendingQuickPopupSource>) {
    state.ready.store(true, Ordering::Release);
}

#[tauri::command]
pub fn take_pending_quick_popup_source(
    state: tauri::State<PendingQuickPopupSource>,
) -> Option<String> {
    state
        .source
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take()
}

#[tauri::command]
pub fn was_launched_for_quick_popup(state: tauri::State<PendingQuickPopupSource>) -> bool {
    state.launched_for_quick_popup
}

/// 拡張機能側(nativeHost.ts)のNATIVE_HOST_NAMEと完全に一致させること。
pub const NATIVE_HOST_NAME: &str = "com.equashare.nativehost";
pub const EXTENSION_ID: &str = "eoilgimmcccdfgckhkenbcpcepinpmnf";

/// ループバック専用のローカル中継ポート。拡張機能側のコメント(nativeHost.ts)にも
/// 同じ値を明記してあるので、変更する場合は両方直すこと。
const LOCAL_RELAY_PORT: u16 = 47823;
const MAX_RELAY_MESSAGE_BYTES: u64 = 1024 * 1024 + 1024;
const MAX_RELAY_CONNECTIONS: usize = 8;
static ACTIVE_RELAY_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);
static RELAY_TOKEN: OnceLock<Result<String, String>> = OnceLock::new();

fn relay_token() -> Result<String, String> {
    RELAY_TOKEN
        .get_or_init(|| {
            let mut dir = std::env::var_os("LOCALAPPDATA")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(std::env::temp_dir);
            dir.push("Equashare");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join("relay-token.txt");
            let mut random = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut random);
            let new_token = random
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    file.write_all(new_token.as_bytes())
                        .map_err(|e| e.to_string())?;
                    file.sync_all().map_err(|e| e.to_string())?;
                    Ok(new_token)
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    for _ in 0..20 {
                        if let Ok(token) = std::fs::read_to_string(&path) {
                            if token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()) {
                                return Ok(token);
                            }
                        }
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    Err("relay token is unreadable".into())
                }
                Err(e) => Err(e.to_string()),
            }
        })
        .clone()
}

fn local_relay_addr() -> std::net::SocketAddr {
    std::net::SocketAddr::from(([127, 0, 0, 1], LOCAL_RELAY_PORT))
}

/// 起動時の引数から、Chromeによるネイティブメッセージングホスト起動かどうかを判定する。
/// Chromeはホストプロセスの引数の1つとして呼び出し元origin(`chrome-extension://<id>/`)を
/// 渡す仕様のため、これで検知する。
pub fn is_native_host_invocation(args: &[String]) -> bool {
    args.iter().any(|a| a.starts_with("chrome-extension://"))
}

/// `--quick-popup-source-file=<path>` 引数があれば、そのファイルパスを返す。
/// (中継先が見つからず、このプロセス自身がGUI本体として起動し直された場合に付与される。)
pub fn pending_source_file_arg(args: &[String]) -> Option<String> {
    const PREFIX: &str = "--quick-popup-source-file=";
    args.iter()
        .find_map(|a| a.strip_prefix(PREFIX).map(|s| s.to_string()))
}

// --- Native Messaging プロトコル(Chrome ⇔ このホスト) -----------------------
// 仕様: https://developer.chrome.com/docs/apps/nativeMessaging/
// 各メッセージは「4バイト・リトルエンディアンの長さ」+「UTF-8 JSON本体」。

/// 不正な入力での過大メモリ確保を避けるための上限(LaTeXソース1本には十分すぎる余裕)。
const MAX_NATIVE_MESSAGE_BYTES: u32 = 1024 * 1024; // 1MB

fn read_native_message(stdin: &mut impl Read) -> std::io::Result<Option<serde_json::Value>> {
    let mut len_buf = [0u8; 4];
    if let Err(e) = stdin.read_exact(&mut len_buf) {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            return Ok(None);
        }
        return Err(e);
    }
    let len = u32::from_le_bytes(len_buf);
    if len > MAX_NATIVE_MESSAGE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "message too large",
        ));
    }
    let mut buf = vec![0u8; len as usize];
    stdin.read_exact(&mut buf)?;
    serde_json::from_slice(&buf)
        .map(Some)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

fn write_native_message(stdout: &mut impl Write, value: &serde_json::Value) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    let len = bytes.len() as u32;
    stdout.write_all(&len.to_le_bytes())?;
    stdout.write_all(&bytes)?;
    stdout.flush()
}

// --- ローカル中継プロトコル(このホスト ⇔ 起動済みのGUI本体) -------------------
// 改行区切りの1行JSON。Chrome側のプロトコルとは独立した、単純な内部専用プロトコル。

/// 既に起動しているGUI本体へ、ループバックTCP経由で数式ソースを中継する。
/// 成功(GUI側が受理してレスポンスを返した)ならtrue。
fn send_relay_command(command: &str, source: Option<&str>) -> bool {
    let Ok(token) = relay_token() else {
        return false;
    };
    let Ok(mut stream) =
        TcpStream::connect_timeout(&local_relay_addr(), Duration::from_millis(400))
    else {
        return false;
    };
    let request = match serde_json::to_string(
        &serde_json::json!({ "command": command, "source": source, "token": token }),
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };
    if stream.write_all(request.as_bytes()).is_err() || stream.write_all(b"\n").is_err() {
        return false;
    }
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut reader = std::io::BufReader::new(stream);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() || line.len() > 1024 {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
        return false;
    };
    value.get("status").and_then(|v| v.as_str()) == Some("ok")
}

pub fn focus_running_app() -> bool {
    send_relay_command("show_main", None)
}

pub fn is_running_app() -> bool {
    send_relay_command("ping", None)
}

/// GUI本体が起動していなかった場合、非表示で起動して準備完了後にソースを中継する。
fn spawn_gui_in_background() -> std::io::Result<std::process::Child> {
    let exe = std::env::current_exe()?;
    std::process::Command::new(exe).arg("--background").spawn()
}

/// Chromeにネイティブメッセージングホストとして起動された場合のエントリポイント。
/// main()の冒頭でこれを呼び、通常のTauri GUI起動は一切行わずにそのままプロセスを終える。
pub fn run_as_native_host() {
    let expected_origin = format!("chrome-extension://{EXTENSION_ID}/");
    if !std::env::args().any(|arg| arg == expected_origin) {
        return;
    }
    let mut stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    let msg = match read_native_message(&mut stdin) {
        Ok(Some(v)) => v,
        Ok(None) => return, // Chrome側が何も送らずポートを閉じた(異常系だが実害は無い)
        Err(e) => {
            let _ = write_native_message(
                &mut stdout,
                &serde_json::json!({ "status": "error", "message": format!("invalid message: {e}") }),
            );
            return;
        }
    };

    let source = msg
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if source.is_empty() {
        let _ = write_native_message(
            &mut stdout,
            &serde_json::json!({ "status": "error", "message": "empty source" }),
        );
        return;
    }

    if send_relay_command("source", Some(&source)) {
        let _ = write_native_message(&mut stdout, &serde_json::json!({ "status": "ok" }));
        return;
    }

    match spawn_gui_in_background() {
        Ok(mut child) => {
            // プロセス生成だけでは画面が利用可能とは限らない。WebViewの準備完了を待つ。
            let mut ready = false;
            for _ in 0..100 {
                if send_relay_command("ping", None) {
                    ready = true;
                    break;
                }
                if child.try_wait().ok().flatten().is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let response = if ready && send_relay_command("source", Some(&source)) {
                serde_json::json!({ "status": "ok" })
            } else {
                serde_json::json!({ "status": "error", "message": "desktop app did not accept source" })
            };
            let _ = write_native_message(&mut stdout, &response);
        }
        Err(e) => {
            let _ = write_native_message(
                &mut stdout,
                &serde_json::json!({ "status": "error", "message": format!("failed to launch app: {e}") }),
            );
        }
    }
}

// --- GUI本体側: ローカル中継リスナー ----------------------------------------

/// GUI本体の起動時に一度だけ呼ぶ。以後、他のプロセス(run_as_native_host()側)からの
/// 中継リクエストをバックグラウンドスレッドで待ち受け続ける。
/// ポートが既に使用中(=既に別のGUI本体インスタンスが起動している異常系。通常は
/// シングルインスタンス化されているため起こらないはず)の場合は、単に何もせず諦める
/// (この機能が使えなくなるだけで、アプリ自体の起動は妨げない)。
pub fn start_local_relay_listener(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Ok(token) = relay_token() else { return };
        let listener = match TcpListener::bind(local_relay_addr()) {
            Ok(l) => l,
            Err(_) => return,
        };
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            if ACTIVE_RELAY_CONNECTIONS.fetch_add(1, Ordering::AcqRel) >= MAX_RELAY_CONNECTIONS {
                ACTIVE_RELAY_CONNECTIONS.fetch_sub(1, Ordering::AcqRel);
                continue;
            }
            let app_handle = app_handle.clone();
            let token = token.clone();
            std::thread::spawn(move || {
                handle_relay_connection(stream, &app_handle, &token);
                ACTIVE_RELAY_CONNECTIONS.fetch_sub(1, Ordering::AcqRel);
            });
        }
    });
}

fn handle_relay_connection(mut stream: TcpStream, app_handle: &tauri::AppHandle, token: &str) {
    // bind自体を127.0.0.1限定にしてあるが、念のため接続元もループバックか確認する
    // (多重防御。127.0.0.1へのbindである時点で外部からは到達できないはずだが)。
    if !stream
        .peer_addr()
        .map(|a| a.ip().is_loopback())
        .unwrap_or(false)
    {
        return;
    }

    let mut reader = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    let mut bytes = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return;
        }
        let _ = reader.set_read_timeout(Some(remaining));
        let mut chunk = [0u8; 4096];
        let Ok(count) = reader.read(&mut chunk) else {
            return;
        };
        if count == 0 || bytes.len() + count > MAX_RELAY_MESSAGE_BYTES as usize {
            return;
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.contains(&b'\n') {
            break;
        }
    }
    let Ok(line) = String::from_utf8(bytes) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
        let _ = stream.write_all(b"{\"status\":\"error\"}\n");
        return;
    };
    if value.get("token").and_then(|v| v.as_str()) != Some(token) {
        let _ = stream.write_all(b"{\"status\":\"error\"}\n");
        return;
    }
    let command = value.get("command").and_then(|v| v.as_str()).unwrap_or("");
    if command == "ping" {
        let ready = app_handle
            .state::<PendingQuickPopupSource>()
            .ready
            .load(Ordering::Acquire);
        let reply: &[u8] = if ready {
            b"{\"status\":\"ok\"}\n"
        } else {
            b"{\"status\":\"error\"}\n"
        };
        let _ = stream.write_all(reply);
        return;
    }
    if command == "show_main" {
        if let Some(main) = app_handle.get_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
        let _ = stream.write_all(b"{\"status\":\"ok\"}\n");
        return;
    }
    if command != "source" {
        let _ = stream.write_all(b"{\"status\":\"error\"}\n");
        return;
    }
    let source = value.get("source").and_then(|v| v.as_str()).unwrap_or("");
    if source.is_empty() {
        let _ = stream.write_all(b"{\"status\":\"error\"}\n");
        return;
    }

    if let Some(quick) = app_handle.get_window("quickpopup") {
        app_handle
            .state::<PendingQuickPopupSource>()
            .set(source.to_string());
        let _ = quick.show();
        let _ = quick.unminimize();
        let _ = quick.set_focus();
        // 既にフォーカスが当たっている状態(=フォーカス変化イベントが発火しない)への
        // 対策として、念のためこちらからも直接通知しておく。quickPopup.ts側は
        // どちらか早く届いた方(フォーカスイベント経由の取得 or この直接イベント)を
        // 使えばよいよう、取得は必ずtake_pending_quick_popup_source経由(冪等)にする。
        let _ = quick.emit("quick-popup-source-ready", ());
    }

    let _ = stream.write_all(b"{\"status\":\"ok\"}\n");
}

// --- Windows: レジストリへのネイティブメッセージングホスト登録 ----------------
// Chrome/Edgeがこのexeをネイティブメッセージングホストとして見つけられるようにするには、
// (1) ホストマニフェストJSON(name/path/allowed_origins等)をディスク上に置き、
// (2) レジストリの HKEY_CURRENT_USER\Software\<Google\Chrome または Microsoft\Edge>\
//     NativeMessagingHosts\<host name> キーの既定値に、そのJSONファイルの絶対パスを
//     書き込む必要がある。exeのインストール先はユーザー環境ごとに異なるため、
//     ビルド時のインストーラへ静的に埋め込むのではなく、アプリの実行ファイルパスを
//     実行時に把握できるこちら側(設定画面の「拡張機能との連携を設定」ボタン)で
//     都度マニフェストを生成し、レジストリへ書き込む方式にする。
#[cfg(windows)]
mod windows_registration {
    use super::{EXTENSION_ID, NATIVE_HOST_NAME};
    use std::io::Write;

    /// manifest.jsonの"key"から一意に決まる拡張機能ID(SHA256(公開鍵DER)の先頭16バイトを
    /// 0-9a-fの代わりにa-pで表記したもの、Chrome公式のID算出アルゴリズム)。
    /// equashare-extension/public/manifest.json の "key" フィールドと対になっている値
    /// (両方を変える場合は必ずセットで変更すること)。
    fn manifest_dir() -> Result<std::path::PathBuf, String> {
        let mut dir = dirs_next_data_local_dir()?;
        dir.push("Equashare");
        dir.push("native-messaging-host");
        std::fs::create_dir_all(&dir).map_err(|e| format!("フォルダの作成に失敗しました: {e}"))?;
        Ok(dir)
    }

    /// %LOCALAPPDATA% を素朴に読む(専用クレートを増やさないための最小実装)。
    fn dirs_next_data_local_dir() -> Result<std::path::PathBuf, String> {
        std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .ok_or_else(|| "%LOCALAPPDATA% を取得できませんでした".to_string())
    }

    fn write_host_manifest(exe_path: &std::path::Path) -> Result<std::path::PathBuf, String> {
        let dir = manifest_dir()?;
        let manifest_path = dir.join("com.equashare.nativehost.json");
        let manifest = serde_json::json!({
            "name": NATIVE_HOST_NAME,
            "description": "Equashare desktop app bridge",
            "path": exe_path.to_string_lossy(),
            "type": "stdio",
            "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
        });
        let mut file = std::fs::File::create(&manifest_path)
            .map_err(|e| format!("マニフェストファイルの作成に失敗しました: {e}"))?;
        file.write_all(
            serde_json::to_string_pretty(&manifest)
                .unwrap_or_default()
                .as_bytes(),
        )
        .map_err(|e| format!("マニフェストファイルの書き込みに失敗しました: {e}"))?;
        Ok(manifest_path)
    }

    /// Chrome向け・Edge向け、両方のレジストリキーへ同じマニフェストを登録する。
    /// (winregクレートはWindows専用のため、このモジュール自体を#[cfg(windows)]の中に置く。)
    pub fn register() -> Result<(), String> {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("実行ファイルパスの取得に失敗しました: {e}"))?;
        let manifest_path = write_host_manifest(&exe_path)?;

        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        for browser_key in [
            r"Software\Google\Chrome\NativeMessagingHosts",
            r"Software\Microsoft\Edge\NativeMessagingHosts",
        ] {
            let (key, _) = hkcu
                .create_subkey(format!(r"{browser_key}\{NATIVE_HOST_NAME}"))
                .map_err(|e| format!("レジストリキーの作成に失敗しました({browser_key}): {e}"))?;
            key.set_value("", &manifest_path.to_string_lossy().to_string())
                .map_err(|e| format!("レジストリ値の書き込みに失敗しました({browser_key}): {e}"))?;
        }
        let _ = std::fs::remove_file(manifest_dir()?.join("native-messaging-disabled"));
        Ok(())
    }

    pub fn unregister() -> Result<(), String> {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for browser_key in [
            r"Software\Google\Chrome\NativeMessagingHosts",
            r"Software\Microsoft\Edge\NativeMessagingHosts",
        ] {
            // キーが元から無い場合のエラーは無視してよい(既に未登録なだけ)。
            let _ = hkcu.delete_subkey_all(format!(r"{browser_key}\{NATIVE_HOST_NAME}"));
        }
        if let Ok(dir) = manifest_dir() {
            let _ = std::fs::remove_file(dir.join("com.equashare.nativehost.json"));
            let _ = std::fs::write(dir.join("native-messaging-disabled"), b"disabled");
        }
        Ok(())
    }

    pub fn register_by_default() {
        if let Ok(dir) = manifest_dir() {
            if !dir.join("native-messaging-disabled").exists() {
                let _ = register();
            }
        }
    }

    pub fn enable_autostart() -> Result<(), String> {
        use winreg::enums::*;
        use winreg::RegKey;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (run, _) = hkcu
            .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
            .map_err(|e| e.to_string())?;
        run.set_value("Equashare", &format!("\"{}\" --background", exe.display()))
            .map_err(|e| e.to_string())
    }

    pub fn is_registered() -> bool {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(manifest_path) = manifest_dir().map(|dir| dir.join("com.equashare.nativehost.json"))
        else {
            return false;
        };
        let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
            return false;
        };
        let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return false;
        };
        let expected_origin = format!("chrome-extension://{EXTENSION_ID}/");
        if manifest["allowed_origins"][0].as_str() != Some(expected_origin.as_str()) {
            return false;
        }
        let Ok(exe) = std::env::current_exe() else {
            return false;
        };
        if manifest["path"].as_str() != exe.to_str() {
            return false;
        }
        let expected_path = manifest_path.to_string_lossy().to_string();
        [
            r"Software\Google\Chrome\NativeMessagingHosts",
            r"Software\Microsoft\Edge\NativeMessagingHosts",
        ]
        .iter()
        .all(|browser_key| {
            hkcu.open_subkey(format!(r"{browser_key}\{NATIVE_HOST_NAME}"))
                .and_then(|key| key.get_value::<String, _>(""))
                .map(|path| path == expected_path)
                .unwrap_or(false)
        })
    }
}

#[cfg(not(windows))]
mod windows_registration {
    pub fn register() -> Result<(), String> {
        Err("この機能はWindows版でのみ利用できます".to_string())
    }
    pub fn unregister() -> Result<(), String> {
        Err("この機能はWindows版でのみ利用できます".to_string())
    }
    pub fn is_registered() -> bool {
        false
    }
    pub fn register_by_default() {}
    pub fn enable_autostart() -> Result<(), String> {
        Ok(())
    }
}

pub fn setup_installed_app_integration() {
    // 開発ビルドをサインイン時の常駐先として登録しない。
    if cfg!(debug_assertions) {
        return;
    }
    windows_registration::register_by_default();
    let _ = windows_registration::enable_autostart();
}

#[cfg(windows)]
#[tauri::command]
pub fn is_browser_foreground() -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return false;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut path = [0u16; 32768];
        let mut len = path.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut len) != 0;
        CloseHandle(process);
        if !ok {
            return false;
        }
        let name = String::from_utf16_lossy(&path[..len as usize]).to_ascii_lowercase();
        name.ends_with("\\chrome.exe") || name.ends_with("\\msedge.exe")
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn is_browser_foreground() -> bool {
    false
}

pub fn start_browser_focus_monitor(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last = None;
        loop {
            let current = is_browser_foreground();
            if last != Some(current) {
                let _ = app_handle.emit_all("browser-focus-changed", current);
                last = Some(current);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

#[tauri::command]
pub fn register_native_messaging_host() -> Result<(), String> {
    windows_registration::register()
}

#[tauri::command]
pub fn unregister_native_messaging_host() -> Result<(), String> {
    windows_registration::unregister()
}

#[tauri::command]
pub fn is_native_messaging_host_registered() -> bool {
    windows_registration::is_registered()
}
