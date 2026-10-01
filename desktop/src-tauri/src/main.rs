// mathimg-app: Rustバックエンド
//
// フロントエンド(WebView)側は MathJax + opentype.js で「合成済みSVG文字列」を作るところまでを担当する。
// この Rust 側は、そのSVG文字列を受け取って実際の書き出し処理(高速なラスタライズ/
// クリップボード操作/ファイル保存)を行う。プレビュー自体はSVGをそのままWebViewに表示するだけなので
// 別途ラスタライズ不要 = リアルタイムに追従できる。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex, OnceLock};
use tauri::command;
use tauri::Manager;
use tauri::{CustomMenuItem, SystemTray, SystemTrayEvent, SystemTrayMenu};

mod native_host;

struct StartupMode {
    hide_main: bool,
}

#[command]
fn should_start_main_hidden(state: tauri::State<StartupMode>) -> bool {
    state.hide_main
}

#[command]
fn quit_application(app: tauri::AppHandle) {
    app.exit(0);
}

#[derive(serde::Serialize)]
struct ExportResult {
    bytes: Vec<u8>,
    mime: String,
    extension: String,
}

// --- 出力サイズのハード上限 -------------------------------------------------
// フロントエンド側にも「大きい書き出しを行う前の確認ダイアログ」があるが、それは
// あくまでUI上の確認であって強制力がない(直接invokeすれば素通りするし、確認ダイアログを
// 連打すれば並列に大きなラスタライズが何本も走る)。実際にプロセスをOOMさせないための
// 最終防衛線はネイティブ側(ここ)でなければならない。
//
// - 一辺 20000px は一般的なGPUテクスチャ上限にも近く、通常の利用では絶対に到達しない値。
// - 総ピクセル数 8000万px は RGBA(4byte/px)で約320MB。書き出し用途としては十分すぎる
//   上限でありながら、無制限だった場合の「数百MB〜GB級」の暴走は確実に防げる。
const MAX_EXPORT_DIMENSION: u32 = 20_000;
const MAX_EXPORT_PIXELS: u64 = 80_000_000;
const MIN_SCALE: f32 = 0.1;
const MAX_SCALE: f32 = 8.0;

// 書き出し(ラスタライズを伴うコピー・保存)は同時に1本しか走らせない。
// ボタン連打やショートカット多重起動があっても、Rust側でシリアライズすることで
// 「N並列 × 上限ピクセル数」の複合的なメモリ爆発を防ぐ。UIの排他制御(ボタン無効化)は
// 体感速度・分かりやすさのための補助であり、ここがあることで安全性はUIに依存しない。
static EXPORT_LOCK: Mutex<()> = Mutex::new(());

// システムフォントの列挙・パースは(特にフォント数の多い環境では)決して軽くない処理だが、
// 以前は書き出し(コピー・保存のたびに呼ばれる各コマンド)のたびに毎回
// load_system_fonts() をやり直していた。通常のCJK文字は起動時に既にパス化済みで
// このフォントDBは「Syntax Error」プレースホルダー等、万一のフォールバック経路でしか
// 使われないため、プロセス起動後の初回呼び出し時に一度だけ構築してキャッシュし、
// 以降は使い回す。
static FONT_DB: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();

fn shared_fontdb() -> Arc<resvg::usvg::fontdb::Database> {
    FONT_DB
        .get_or_init(|| {
            let mut fontdb = resvg::usvg::fontdb::Database::new();
            fontdb.load_system_fonts();
            Arc::new(fontdb)
        })
        .clone()
}

fn build_tree(svg: &str) -> Result<resvg::usvg::Tree, String> {
    let mut opt = resvg::usvg::Options::default();
    // システムフォントの保険用フォールバック経路(SVG内に埋め込まれなかった場合用。
    // 通常は日本語含め全てパス化済みなので使われないはずだが、念のため)。
    opt.fontdb = shared_fontdb();

    resvg::usvg::Tree::from_str(svg, &opt).map_err(|e| format!("SVG解析に失敗しました: {e}"))
}

fn rasterize(svg: &str, scale: f32) -> Result<resvg::tiny_skia::Pixmap, String> {
    if !scale.is_finite() {
        return Err("解像度倍率の値が不正です".into());
    }
    let scale = scale.clamp(MIN_SCALE, MAX_SCALE);

    let tree = build_tree(svg)?;
    let size = tree.size();
    if !size.width().is_finite()
        || !size.height().is_finite()
        || size.width() <= 0.0
        || size.height() <= 0.0
    {
        return Err("SVGのサイズが不正です".into());
    }

    let w = ((size.width() * scale).ceil() as u64).max(1);
    let h = ((size.height() * scale).ceil() as u64).max(1);

    if w > MAX_EXPORT_DIMENSION as u64 || h > MAX_EXPORT_DIMENSION as u64 {
        return Err(format!(
            "出力サイズが大きすぎます({w}x{h}px)。文字サイズまたは解像度倍率を下げてください(上限: 一辺{MAX_EXPORT_DIMENSION}px)。"
        ));
    }
    let total_pixels = w * h;
    if total_pixels > MAX_EXPORT_PIXELS {
        return Err(format!(
            "出力ピクセル数が上限を超えています(約{}メガピクセル、上限{}メガピクセル)。文字サイズまたは解像度倍率を下げてください。",
            total_pixels / 1_000_000,
            MAX_EXPORT_PIXELS / 1_000_000
        ));
    }

    let w = w as u32;
    let h = h as u32;
    let mut pixmap =
        resvg::tiny_skia::Pixmap::new(w, h).ok_or("画像バッファの確保に失敗しました")?;
    let transform = resvg::tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Ok(pixmap)
}

fn encode_png(pixmap: &resvg::tiny_skia::Pixmap) -> Result<Vec<u8>, String> {
    pixmap.encode_png().map_err(|e| e.to_string())
}

/// tiny_skia の Pixmap はアルファ事前乗算(premultiplied)RGBAである。
/// クリップボード(PNG相当のストレートアルファを期待するAPI)へ渡す用に、
/// 素のRGBAへアンプリマルチプライする(アルファチャンネルはそのまま保持する)。
///
/// 戻り値は生のRGBAバイト列(4byte/px)と幅・高さ。除算はf32ではなく整数演算で行い、
/// `image::RgbaImage::put_pixel`(呼び出しごとに境界チェックが入る)は使わず、事前確保した
/// バッファへ直接書き込む。alpha==255(不透明)の画素は乗除算をスキップしてそのまま
/// 書き込む高速パスを通す(アンチエイリアス済みの数式組版は「完全不透明」か「完全透明」の
/// 画素が大半で、部分アルファは輪郭のごく一部のみのため有効)。
///
/// 【実装メモ】整数除算(切り捨て)の丸め方向は、浮動小数点版(`.min(255.0) as u8`による
/// クランプ含む)の丸め方向(`as u8`キャストによる切り捨て)と基本的には同じ切り捨て方向だが、
/// 浮動小数点演算の丸め誤差により極めて稀に1階調ずれる可能性がある。既存のテスト画像で
/// 目視比較し、色が1階調ずれていないか確認すること。
fn to_straight_rgba(pixmap: &resvg::tiny_skia::Pixmap) -> (Vec<u8>, u32, u32) {
    let w = pixmap.width();
    let h = pixmap.height();
    let mut bytes = Vec::with_capacity(w as usize * h as usize * 4);
    for px in pixmap.pixels() {
        let a = px.alpha();
        if a == 255 {
            // 不透明画素: アンプリマルチプライ不要でそのまま書き込む高速パス。
            bytes.push(px.red());
            bytes.push(px.green());
            bytes.push(px.blue());
            bytes.push(255);
        } else if a == 0 {
            bytes.extend_from_slice(&[255, 255, 255, 0]);
        } else {
            let a32 = a as u32;
            bytes.push(((px.red() as u32 * 255) / a32).min(255) as u8);
            bytes.push(((px.green() as u32 * 255) / a32).min(255) as u8);
            bytes.push(((px.blue() as u32 * 255) / a32).min(255) as u8);
            bytes.push(a);
        }
    }
    (bytes, w, h)
}

fn encode_raster(format: &str, svg: &str, scale: f32) -> Result<ExportResult, String> {
    match format {
        "png" => {
            let pixmap = rasterize(svg, scale)?;
            let bytes = encode_png(&pixmap)?;
            Ok(ExportResult {
                bytes,
                mime: "image/png".into(),
                extension: "png".into(),
            })
        }
        "svg" => Ok(ExportResult {
            bytes: svg.as_bytes().to_vec(),
            mime: "image/svg+xml".into(),
            extension: "svg".into(),
        }),
        other => Err(format!("未知の出力フォーマットです: {other}")),
    }
}

/// PNGをRust側で直接ラスタライズしてクリップボードへ書き込む。
/// (以前はラスタライズ結果のバイト列をJS側へ返し、それを再度クリップボード書き込み用の
/// 別コマンドへ渡すという「大きなバイト列のRust→JS→Rust」往復が発生していた。ここでは
/// ラスタライズからクリップボード書き込みまでを1つのネイティブジョブとして完結させ、
/// その往復を無くす。)
#[command]
fn copy_export_to_clipboard(svg: String, format: String, scale: f32) -> Result<(), String> {
    let _guard = EXPORT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if format == "svg" {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        return clipboard.set_text(svg).map_err(|e| e.to_string());
    }
    let pixmap = rasterize(&svg, scale)?;
    let (bytes, w, h) = to_straight_rgba(&pixmap);
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(bytes),
        })
        .map_err(|e| format!("クリップボードへの書き込みに失敗しました: {e}"))?;
    Ok(())
}

/// PNG/SVGをRust側でラスタライズ・エンコードし、そのままファイルへ書き込む。
/// 大きな画像バイト列がJS側のメモリ・IPCシリアライズを経由しないため、性能・安定性の
/// 両面で改善する。
#[command]
fn save_export_to_file(
    svg: String,
    format: String,
    scale: f32,
    path: String,
) -> Result<(), String> {
    let _guard = EXPORT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    validate_export_path(&path, &format)?;
    ensure_parent_dir(std::path::Path::new(&path))?;
    let result = encode_raster(&format, &svg, scale)?;
    std::fs::write(&path, &result.bytes).map_err(|e| format!("ファイル書き込みに失敗しました: {e}"))
}

/// save_bytes は元々「任意パスへ任意バイト列を書き込める」汎用APIであり、CSP上の露出は
/// 現状小さいものの、将来のXSSや機能追加時の影響範囲を最小化するため、拡張子を
/// アプリが実際に書き出すファイル種別に限定する。
/// v4.0: テンプレートのエクスポート/内部永続化(templates.json)用に "json" を追加。
const ALLOWED_SAVE_EXTENSIONS: [&str; 4] = ["tex", "svg", "png", "json"];

fn validate_export_path(path: &str, format: &str) -> Result<(), String> {
    let expected_ext = match format {
        "png" => "png",
        "svg" => "svg",
        other => return Err(format!("未知の出力フォーマットです: {other}")),
    };
    let actual_ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if actual_ext != expected_ext {
        return Err(format!(
            "保存先の拡張子が不正です(.{expected_ext} を指定してください)"
        ));
    }
    Ok(())
}

/// 書き込み先の親ディレクトリが無い場合に備えて作成しておく。特に「Equashareホーム
/// ディレクトリ」はアプリ初回起動時点ではまだ存在しないことがあるため。
fn ensure_parent_dir(path: &std::path::Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("保存先ディレクトリの作成に失敗しました: {e}"))?;
        }
    }
    Ok(())
}

#[command]
fn save_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !ALLOWED_SAVE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "この拡張子(.{ext})への保存は許可されていません(許可: {})",
            ALLOWED_SAVE_EXTENSIONS.join(", ")
        ));
    }
    let path_buf = std::path::PathBuf::from(&path);
    ensure_parent_dir(&path_buf)?;
    std::fs::write(&path, &bytes).map_err(|e| format!("ファイル書き込みに失敗しました: {e}"))
}

/// save_bytesの読み取り版。v4.0のテンプレート機能(内部永続化ファイルの読み込み・
/// ユーザーが選んだJSONファイルのインポート)専用。save_bytesと対称的に、拡張子を
/// ".json"のみへ絞り(このアプリが読み込む必要があるのはテンプレートJSONだけのため)、
/// 加えて誤って巨大なファイルを読み込んでメモリを圧迫しないよう上限も設ける。
/// ファイルが存在しない場合(内部永続化ファイルの初回起動時など)はエラーではなく
/// Ok(None)を返す — 「まだテンプレートが1つも保存されていない」という正常な状態のため。
const MAX_READ_TEXT_FILE_BYTES: u64 = 10 * 1024 * 1024; // 10MB

#[command]
fn read_text_file(path: String) -> Result<Option<String>, String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "json" {
        return Err(format!(
            "この拡張子(.{ext})の読み込みは許可されていません(許可: json)"
        ));
    }
    let path_buf = std::path::PathBuf::from(&path);
    let metadata = match std::fs::metadata(&path_buf) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("ファイル情報の取得に失敗しました: {e}")),
    };
    if metadata.len() > MAX_READ_TEXT_FILE_BYTES {
        return Err(format!(
            "ファイルサイズが大きすぎます(上限 {} MB)",
            MAX_READ_TEXT_FILE_BYTES / 1024 / 1024
        ));
    }
    match std::fs::read_to_string(&path_buf) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("ファイル読み込みに失敗しました: {e}")),
    }
}

/// 「終了時: 自動保存する」設定時に使う。Equashareホームディレクトリ直下へ、既存ファイルと
/// 衝突しないファイル名を採番しながらソースを保存する(すべてRust側で完結させることで、
/// 「存在確認してから書き込む」間のTOCTOUをJS-Rust往復ぶんだけ減らす)。
#[command]
fn autosave_source(dir: String, text: String) -> Result<String, String> {
    let dir_path = std::path::PathBuf::from(&dir);
    std::fs::create_dir_all(&dir_path)
        .map_err(|e| format!("保存先ディレクトリの作成に失敗しました: {e}"))?;
    const BASE_NAME: &str = "Equashare tex";
    const MAX_SUFFIX: u32 = 9999;
    let mut candidate = dir_path.join(format!("{BASE_NAME}.tex"));
    let mut n = 2;
    while candidate.exists() {
        if n > MAX_SUFFIX {
            return Err(format!(
                "自動保存先に同名ファイルが多数存在するため保存できません(上限: ({MAX_SUFFIX})まで)。フォルダ内の不要なファイルを整理してください。"
            ));
        }
        candidate = dir_path.join(format!("{BASE_NAME}({n}).tex"));
        n += 1;
    }
    std::fs::write(&candidate, text.as_bytes())
        .map_err(|e| format!("ファイル書き込みに失敗しました: {e}"))?;
    Ok(candidate.to_string_lossy().into_owned())
}

#[command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Chromeのネイティブメッセージングホストとして起動された場合は、通常のGUI起動は
    // 一切せず、標準入出力を使った中継処理だけを行ってすぐ終了する。
    if native_host::is_native_host_invocation(&args) {
        native_host::run_as_native_host();
        return;
    }

    let background_start = args.iter().any(|arg| arg == "--background");
    let existing_handled = if background_start {
        native_host::is_running_app()
    } else {
        native_host::focus_running_app()
    };
    if native_host::pending_source_file_arg(&args).is_none() && existing_handled {
        return;
    }

    // Native Messaging側が「中継先(起動済みの本体)が見つからなかった」場合に、
    // このexe自身を数式入り一時ファイル付きで新規起動する(native_host.rs参照)。
    // そのファイルを読み取り、内容を消費用の一時ファイルごと削除しておく。
    let pending_source = native_host::pending_source_file_arg(&args).and_then(|path| {
        let content = std::fs::read_to_string(&path).ok();
        let _ = std::fs::remove_file(&path);
        content
    });
    let launched_for_quick_popup = pending_source.is_some();

    // 起動直後にバックグラウンドスレッドでフォントDBを事前構築しておく(prewarm)。
    // こうしないと「初回のコピー/保存操作」だけがフォント列挙のコストを丸ごと
    // 負担することになり、ユーザー体感としては変わらず遅く見えてしまう。
    std::thread::spawn(|| {
        shared_fontdb();
    });

    let tray = SystemTray::new().with_menu(
        SystemTrayMenu::new()
            .add_item(CustomMenuItem::new("open", "Equashareを開く"))
            .add_item(CustomMenuItem::new("quit", "終了")),
    );

    tauri::Builder::default()
        .manage(native_host::PendingQuickPopupSource::new(pending_source))
        .manage(StartupMode {
            hide_main: background_start || launched_for_quick_popup,
        })
        .system_tray(tray)
        .on_system_tray_event(|app, event| {
            if let SystemTrayEvent::MenuItemClick { id, .. } = event {
                if let Some(main) = app.get_window("main") {
                    if id == "open" {
                        let _ = main.show();
                        let _ = main.set_focus();
                    } else if id == "quit" {
                        let _ = main.show();
                        let _ = main.set_focus();
                        let _ = main.emit("tray-quit-request", ());
                    }
                }
            }
        })
        // ウィンドウのサイズ・位置・最大化状態を自動的に記憶し、次回起動時に復元する。
        //
        // 【重要】tauri_plugin_window_state (0.1.1) はデフォルト設定(StateFlags::all())だと
        // on_webview_ready のタイミングで自前に window.show() を呼ぶ(VISIBLEフラグの
        // 復元として)。これは tauri.conf.json の "visible": false と、フロントエンド側で
        // 初回描画完了後に明示的に appWindow.show() する体感速度改善ロジックの両方を
        // 無効化してしまう(プラグインの方が先に表示してしまうため)。そのため VISIBLE
        // フラグだけを除外し、表示タイミングの制御は完全にフロントエンド側に委ねる。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        // v4.0: 簡易入力ポップアップ(quickpopup)ウィンドウは、✕クリックやフォーカスロスで
        // プロセスごと終了させず、非表示にするだけに留める(グローバルショートカットで
        // いつでも即座に再表示できる、軽量な常駐ウィンドウとして扱うため)。
        .setup(move |app| {
            native_host::setup_installed_app_integration();
            // 他プロセス(Native Messagingホスト役のこのexeの別インスタンス)からの中継を
            // 待ち受けるローカルリスナーを起動する(v4.0.1)。
            native_host::start_local_relay_listener(app.handle());
            native_host::start_browser_focus_monitor(app.handle());

            if let Some(quick) = app.get_window("quickpopup") {
                let quick_for_close = quick.clone();
                let quick_for_focus = quick.clone();
                quick.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = quick_for_close.hide();
                    }
                    tauri::WindowEvent::Focused(false) => {
                        // 他のウィンドウ/アプリへフォーカスが移ったら自動的に隠す
                        // (ブラウザ拡張機能のポップアップが持つ「フォーカスを失うと
                        // 閉じる」という挙動を、デスクトップ版でも簡易的に再現する)。
                        let _ = quick_for_focus.hide();
                    }
                    _ => {}
                });

                // Native Messaging経由の新規起動(簡易入力ポップアップに数式を渡すのが
                // 目的)であれば、簡易入力ポップアップの方を前面に出す。quickPopup.ts側は
                // 'quick-popup-source' イベントを購読しているはずだが、起動直後で購読が
                // 間に合っていない可能性に備え、take_pending_quick_popup_source コマンドで
                // 後から取り出せるようにもしてある(main.tsの起動判定と合わせて二重の保険)。
                if launched_for_quick_popup {
                    let _ = quick.show();
                    let _ = quick.unminimize();
                    let _ = quick.set_focus();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            copy_export_to_clipboard,
            save_export_to_file,
            save_bytes,
            read_text_file,
            autosave_source,
            copy_text_to_clipboard,
            native_host::take_pending_quick_popup_source,
            native_host::was_launched_for_quick_popup,
            native_host::mark_quick_popup_ready,
            native_host::is_browser_foreground,
            native_host::register_native_messaging_host,
            native_host::unregister_native_messaging_host,
            native_host::is_native_messaging_host_registered,
            should_start_main_hidden,
            quit_application
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
