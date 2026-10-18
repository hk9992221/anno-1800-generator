use crate::{
    game, resources,
    storage::{self, err, ExportPlan, FileData, Preview, Result},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
#[derive(Default)]
struct AppState {
    roots: Mutex<BTreeMap<PathBuf, bool>>,
    project: Mutex<Option<PathBuf>>,
    resources: Mutex<resources::Resources>,
    cancel: AtomicBool,
    export_lock: Mutex<()>,
    registry_lock: Mutex<()>,
}
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let exe = std::env::current_exe().map_err(err)?;
    let portable = exe.parent().filter(|p| p.join("portable.flag").is_file());
    let p = if let Some(parent) = portable {
        parent.join("CardForgeData")
    } else {
        app.path().app_data_dir().map_err(err)?
    };
    fs::create_dir_all(&p).map_err(err)?;
    Ok(p)
}
fn require_root(state: &AppState, path: &str, write: bool) -> Result<PathBuf> {
    let p = PathBuf::from(path).canonicalize().map_err(err)?;
    let roots = state.roots.lock().map_err(err)?;
    if roots.get(&p).is_some_and(|w| !write || *w) {
        Ok(p)
    } else {
        Err("请先通过目录选择器授权此目录".into())
    }
}
#[tauri::command]
async fn choose_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    write: bool,
    purpose: Option<String>,
) -> Result<Option<String>> {
    let a = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title(if write {
                "选择 Mod 导出目录"
            } else if purpose.as_deref() == Some("game") {
                "选择 Anno 1800 游戏根目录（含 maindata 和 Bin）"
            } else {
                "选择文件夹"
            })
            .blocking_pick_folder()
    })
    .await
    .map_err(err)?;
    if let Some(f) = file {
        let p = f.into_path().map_err(err)?.canonicalize().map_err(err)?;
        let mut roots = state.roots.lock().map_err(err)?;
        let old = roots.get(&p).copied().unwrap_or(false);
        roots.insert(p.clone(), write || old);
        Ok(Some(p.to_string_lossy().into()))
    } else {
        Ok(None)
    }
}
#[tauri::command]
async fn load_project(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<Value>> {
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title("打开卡牌工程")
            .add_filter("卡牌工程", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(err)?;
    if let Some(f) = picked {
        let p = f.into_path().map_err(err)?;
        let text = fs::read_to_string(&p).map_err(err)?;
        let value: Value = serde_json::from_str(&text).map_err(err)?;
        if value["schemaVersion"] != 1 {
            return Err("不支持此工程版本".into());
        }
        *state.project.lock().map_err(err)? = Some(p.clone());
        Ok(Some(json!({"path":p.to_string_lossy(),"text":text})))
    } else {
        Ok(None)
    }
}
#[tauri::command]
async fn save_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: String,
    save_as: bool,
) -> Result<Option<String>> {
    let value: Value = serde_json::from_str(&text).map_err(err)?;
    if value["schemaVersion"] != 1 {
        return Err("工程格式无效".into());
    }
    let existing = if save_as {
        None
    } else {
        state.project.lock().map_err(err)?.clone()
    };
    let path = if let Some(p) = existing {
        Some(p)
    } else {
        let a = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            a.dialog()
                .file()
                .set_title("保存卡牌工程")
                .set_file_name("project.anno1800.json")
                .add_filter("卡牌工程", &["json"])
                .blocking_save_file()
        })
        .await
        .map_err(err)?
        .map(|f| f.into_path().map_err(err))
        .transpose()?
    };
    if let Some(path) = path {
        if path.exists() {
            let backup = path.with_extension("json.bak");
            fs::copy(&path, backup).map_err(err)?;
        }
        storage::atomic_write(&path, text.as_bytes())?;
        *state.project.lock().map_err(err)? = Some(path.clone());
        Ok(Some(path.to_string_lossy().into()))
    } else {
        Ok(None)
    }
}
#[tauri::command]
fn clear_project_path(state: State<'_, AppState>) -> Result<()> {
    *state.project.lock().map_err(err)? = None;
    Ok(())
}
#[tauri::command]
fn save_draft(app: tauri::AppHandle, text: String) -> Result<()> {
    let state = app.state::<AppState>();
    let _lock = state.registry_lock.lock().map_err(err)?;
    let value: Value = serde_json::from_str(&text).map_err(err)?;
    let dir = data_dir(&app)?;
    let path = dir.join("guid-registry.json");
    let mut ids: std::collections::BTreeSet<u32> = if path.exists() {
        serde_json::from_slice(&fs::read(&path).map_err(err)?).map_err(err)?
    } else {
        Default::default()
    };
    if let Some(guids) = value["reservedGuids"].as_array() {
        for id in guids {
            if let Some(g) = id.as_u64() {
                if g <= 2147483647 {
                    ids.insert(g as u32);
                }
            }
        }
    }
    storage::atomic_write(&path, &serde_json::to_vec(&ids).map_err(err)?)?;
    storage::atomic_write(&dir.join("draft.json"), text.as_bytes())
}
#[tauri::command]
fn load_registry(app: tauri::AppHandle) -> Result<Vec<u32>> {
    let p = data_dir(&app)?.join("guid-registry.json");
    if !p.exists() {
        return Ok(vec![]);
    }
    serde_json::from_slice(&fs::read(p).map_err(err)?).map_err(err)
}
#[tauri::command]
fn load_draft(app: tauri::AppHandle) -> Result<Option<String>> {
    let p = data_dir(&app)?.join("draft.json");
    for candidate in [p.clone(), p.with_extension("cardforge-backup")] {
        if let Ok(text) = fs::read_to_string(&candidate) {
            if serde_json::from_str::<Value>(&text).is_ok() {
                return Ok(Some(text));
            }
        }
    }
    Ok(None)
}
#[tauri::command]
async fn read_mod_folder(app: tauri::AppHandle, path: String) -> Result<Vec<FileData>> {
    let root = require_root(&app.state::<AppState>(), &path, false)?;
    tauri::async_runtime::spawn_blocking(move || storage::read_tree(&root, 500_000_000))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn preview_export(
    app: tauri::AppHandle,
    parent: String,
    plan: ExportPlan,
) -> Result<Preview> {
    let root = require_root(&app.state::<AppState>(), &parent, true)?;
    tauri::async_runtime::spawn_blocking(move || storage::preview_export(&root, &plan))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn write_export(
    app: tauri::AppHandle,
    parent: String,
    plan: ExportPlan,
    token: String,
) -> Result<String> {
    let root = require_root(&app.state::<AppState>(), &parent, true)?;
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = a.state::<AppState>();
        let _lock = state.export_lock.lock().map_err(err)?;
        storage::write_export(&root, &plan, &token, &data_dir(&a)?.join("backups"))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn save_zip(app: tauri::AppHandle, name: String, data: String) -> Result<Option<String>> {
    if name.contains(['/', '\\']) {
        return Err("ZIP 文件名无效".into());
    }
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title("导出 Mod ZIP")
            .set_file_name(&name)
            .add_filter("ZIP", &["zip"])
            .blocking_save_file()
    })
    .await
    .map_err(err)?;
    if let Some(file) = picked {
        let p = file.into_path().map_err(err)?;
        let bytes = STANDARD.decode(data).map_err(err)?;
        storage::atomic_write(&p, &bytes)?;
        Ok(Some(p.to_string_lossy().into()))
    } else {
        Ok(None)
    }
}
#[tauri::command]
async fn restore_export(
    app: tauri::AppHandle,
    parent: String,
    project_id: String,
    folder_name: String,
) -> Result<String> {
    let root = require_root(&app.state::<AppState>(), &parent, true)?;
    if storage::safe_path(&project_id)?.components().count() != 1 {
        return Err("工程 ID 无效".into());
    }
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = a.state::<AppState>();
        let _lock = state.export_lock.lock().map_err(err)?;
        let base = data_dir(&a)?.join("backups").join(&project_id);
        let mut dirs: Vec<_> = fs::read_dir(base)
            .map_err(err)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .collect();
        dirs.sort_by_key(|e| e.file_name());
        let latest = dirs.last().ok_or("没有可恢复的导出备份")?.path();
        let m: storage::Manifest =
            serde_json::from_slice(&fs::read(latest.join("cardforge-manifest.json")).map_err(err)?)
                .map_err(err)?;
        let files = storage::read_tree(&latest, 1_000_000_000)?
            .into_iter()
            .filter(|f| f.path != "cardforge-manifest.json")
            .collect();
        let plan = ExportPlan {
            project_id,
            mod_id: m.mod_id,
            folder_name,
            files,
            card_guids: m.card_guids,
        };
        let p = storage::preview_export(&root, &plan)?;
        storage::write_export(&root, &plan, &p.token, &data_dir(&a)?.join("backups"))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn index_resources(app: tauri::AppHandle, path: String) -> Result<Value> {
    let root = require_root(&app.state::<AppState>(), &path, false)?;
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = a.state::<AppState>();
        state.cancel.store(false, Ordering::Relaxed);
        let progress = |message: &str| {
            let _ = a.emit("resource-progress", message);
        };
        let root = game::resolve_root(&root)?;
        let mut map = resources::discover(&root, &state.cancel, &progress)?;
        let mut catalog = resources::index(&map, &root, &state.cancel, &progress)?;
        let documents = a.path().document_dir().ok();
        let scanned = game::scan_installed(&root, documents.as_deref(), &state.cancel, &progress)?;
        catalog["assets"]
            .as_array_mut()
            .unwrap()
            .extend(scanned["assets"].as_array().into_iter().flatten().cloned());
        catalog["scannedModGuids"] = scanned["guids"].clone();
        for key in ["warnings", "modCount", "modRoots"] {
            catalog[key] = scanned[key].clone();
        }
        catalog["gameRoot"] = json!(root.to_string_lossy());
        resources::complete_catalog(&mut catalog);
        game::add_mod_images(&root, documents.as_deref(), &mut map)?;
        if state.cancel.load(Ordering::Relaxed) {
            return Err("资源读取已取消".into());
        }
        catalog["portraits"] = json!(map
            .keys()
            .filter(|p| p.starts_with("data/")
                && (p.ends_with(".dds") || p.ends_with(".png"))
                && !p.ends_with("_1.dds")
                && !p.ends_with("_2.dds")
                && (p.contains("/ui/") || p.contains("portrait") || p.contains("icon")))
            .map(|p| if let Some(stem) = p.strip_suffix("_0.dds") {
                format!("{stem}.png")
            } else if let Some(stem) = p.strip_suffix(".dds") {
                format!("{stem}.png")
            } else {
                p.clone()
            })
            .collect::<std::collections::BTreeSet<_>>());
        state
            .roots
            .lock()
            .map_err(err)?
            .entry(root)
            .or_insert(false);
        storage::atomic_write(
            &data_dir(&a)?.join("resource-map.json"),
            &serde_json::to_vec(&map).map_err(err)?,
        )?;
        storage::atomic_write(
            &data_dir(&a)?.join("catalog.json"),
            serde_json::to_string(&catalog).map_err(err)?.as_bytes(),
        )?;
        *state.resources.lock().map_err(err)? = map;
        Ok(catalog)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn cancel_index(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}
#[tauri::command]
fn load_catalog(app: tauri::AppHandle) -> Result<Option<Value>> {
    let map_path = data_dir(&app)?.join("resource-map.json");
    if let Ok(bytes) = fs::read(map_path) {
        if let Ok(map) = serde_json::from_slice::<resources::Resources>(&bytes) {
            *app.state::<AppState>().resources.lock().map_err(err)? = map;
        }
    }
    let p = data_dir(&app)?.join("catalog.json");
    if !p.exists() {
        return Ok(None);
    }
    let catalog: Value = serde_json::from_slice(&fs::read(p).map_err(err)?).map_err(err)?;
    if let Some(root) = catalog["gameRoot"].as_str() {
        if let Ok(root) = PathBuf::from(root).canonicalize() {
            app.state::<AppState>()
                .roots
                .lock()
                .map_err(err)?
                .entry(root)
                .or_insert(false);
        }
    }
    Ok(Some(catalog))
}
#[tauri::command]
async fn load_portrait(app: tauri::AppHandle, path: String) -> Result<String> {
    storage::safe_path(&path)?;
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = a.state::<AppState>();
        let resources = state.resources.lock().map_err(err)?;
        let path = path.to_lowercase();
        let stem = path.strip_suffix(".png").unwrap_or(&path);
        let candidates = [path.clone(), format!("{stem}_0.dds"), format!("{stem}.dds")];
        let resource = candidates
            .iter()
            .find_map(|p| resources.get(p))
            .cloned()
            .ok_or("原版头像缓存尚未读取，请重新选择本机资源目录")?;
        drop(resources);
        let bytes = resources::bytes(&resource)?;
        let png = resources::portrait_png(&bytes)?;
        Ok(format!("data:image/png;base64,{}", STANDARD.encode(png)))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn scan_mods(app: tauri::AppHandle, path: String) -> Result<Value> {
    index_resources(app, path).await
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(monitor) = window.current_monitor()? {
                    let scale = monitor.scale_factor();
                    let width = (f64::from(monitor.size().width) / scale * 0.9).min(1060.0);
                    let height = (f64::from(monitor.size().height) / scale * 0.84).min(700.0);
                    window.set_min_size(Some(tauri::LogicalSize::new(
                        width.min(760.0),
                        height.min(480.0),
                    )))?;
                    window.set_size(tauri::LogicalSize::new(width, height))?;
                    window.center()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_folder,
            load_project,
            save_project,
            clear_project_path,
            save_draft,
            load_draft,
            load_registry,
            scan_mods,
            read_mod_folder,
            preview_export,
            write_export,
            save_zip,
            restore_export,
            index_resources,
            cancel_index,
            load_catalog,
            load_portrait
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 Anno 1800 卡牌工坊");
}
