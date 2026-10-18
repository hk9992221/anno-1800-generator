use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}
pub fn safe_path(path: &str) -> Result<PathBuf> {
    if path.is_empty()
        || path.contains('\\')
        || path.contains(':')
        || path.contains('\0')
        || path
            .split('/')
            .any(|p| p.is_empty() || p == ".." || p == "." || p.ends_with('.') || p.ends_with(' '))
    {
        return Err(format!("不安全的相对路径：{path}"));
    }
    let p = PathBuf::from(path);
    if p.is_absolute() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("文件路径必须位于所选目录内".into());
    }
    Ok(p)
}
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("无效保存路径")?;
    fs::create_dir_all(parent).map_err(err)?;
    let tmp = parent.join(format!(".cardforge-write-{}", stamp()));
    fs::write(&tmp, data).map_err(err)?;
    let backup = parent.join(format!(".cardforge-save-{}", stamp()));
    let existed = path.exists();
    if existed {
        fs::rename(path, &backup).map_err(err)?;
    }
    if let Err(e) = fs::rename(&tmp, path) {
        if existed {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(tmp);
        return Err(err(e));
    }
    if existed {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
pub struct FileData {
    pub path: String,
    pub data: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    pub project_id: String,
    pub mod_id: String,
    pub folder_name: String,
    pub files: Vec<FileData>,
    pub card_guids: Vec<u32>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub project_id: String,
    pub mod_id: String,
    pub files: Vec<String>,
    pub card_guids: Vec<u32>,
}
#[derive(Serialize)]
pub struct Change {
    pub path: String,
    pub kind: String,
}
#[derive(Serialize)]
pub struct Preview {
    pub path: String,
    pub token: String,
    pub changes: Vec<Change>,
}
pub fn read_tree(root: &Path, max_bytes: u64) -> Result<Vec<FileData>> {
    fn walk(
        root: &Path,
        dir: &Path,
        files: &mut Vec<FileData>,
        total: &mut u64,
        max: u64,
    ) -> Result<()> {
        for item in fs::read_dir(dir).map_err(err)? {
            let item = item.map_err(err)?;
            let meta = item.file_type().map_err(err)?;
            let p = item.path();
            if meta.is_symlink() {
                return Err(format!("不读取符号链接：{}", p.display()));
            }
            if item.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            if meta.is_dir() {
                walk(root, &p, files, total, max)?;
            } else {
                *total += item.metadata().map_err(err)?.len();
                if *total > max || files.len() > 20000 {
                    return Err("目录内容过大，请仅选择目标 Mod／资源文件夹".into());
                }
                let path = p
                    .strip_prefix(root)
                    .map_err(err)?
                    .to_string_lossy()
                    .replace('\\', "/");
                files.push(FileData {
                    path,
                    data: STANDARD.encode(fs::read(p).map_err(err)?),
                });
            }
        }
        Ok(())
    }
    let mut files = vec![];
    walk(root, root, &mut files, &mut 0, max_bytes)?;
    Ok(files)
}
fn target(parent: &Path, plan: &ExportPlan) -> Result<PathBuf> {
    let name = safe_path(&plan.folder_name)?;
    if name.components().count() != 1 {
        return Err("Mod 文件夹名必须是单个目录名".into());
    }
    if plan.project_id.is_empty()
        || !plan
            .project_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        || plan.mod_id.is_empty()
    {
        return Err("工程身份不完整或包含非法字符".into());
    }
    let mut seen = HashSet::new();
    for f in &plan.files {
        safe_path(&f.path)?;
        if !seen.insert(f.path.to_lowercase()) {
            return Err("导出存在大小写重复路径".into());
        }
        if f.path == "cardforge-manifest.json" {
            return Err("文件名与管理记录冲突".into());
        }
    }
    Ok(parent.join(name))
}
fn ownership(path: &Path, plan: &ExportPlan) -> Result<Option<Manifest>> {
    if !path.exists() {
        return Ok(None);
    }
    if path
        .symlink_metadata()
        .map_err(err)?
        .file_type()
        .is_symlink()
    {
        return Err("导出目标不能是符号链接".into());
    }
    let manifest = path.join("cardforge-manifest.json");
    if !manifest.exists() {
        return Err("目标已存在且不属于当前工程。请选择空位置，或先导入为更新工程。".into());
    }
    let m: Manifest = serde_json::from_slice(&fs::read(manifest).map_err(err)?).map_err(err)?;
    if m.project_id != plan.project_id || m.mod_id != plan.mod_id {
        return Err("目标属于另一个工程，已停止覆盖".into());
    }
    Ok(Some(m))
}
fn digest_tree(path: &Path) -> Result<String> {
    let mut h = Sha256::new();
    if path.exists() {
        let mut files = read_tree(path, 1_000_000_000)?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        for f in files {
            h.update(f.path.as_bytes());
            h.update(f.data.as_bytes());
        }
    }
    Ok(format!("{:x}", h.finalize()))
}
pub fn preview_export(parent: &Path, plan: &ExportPlan) -> Result<Preview> {
    let path = target(parent, plan)?;
    let old = ownership(&path, plan)?;
    let mut changes = vec![];
    for f in &plan.files {
        let p = path.join(safe_path(&f.path)?);
        let bytes = STANDARD.decode(&f.data).map_err(err)?;
        if !p.exists() {
            changes.push(Change {
                path: f.path.clone(),
                kind: "新增".into(),
            });
        } else if fs::read(p).map_err(err)? != bytes {
            changes.push(Change {
                path: f.path.clone(),
                kind: "修改".into(),
            });
        }
    }
    if let Some(old) = old {
        let new: HashSet<_> = plan.files.iter().map(|f| &f.path).collect();
        for p in old.files {
            if !new.contains(&p) {
                changes.push(Change {
                    path: p,
                    kind: "移除".into(),
                });
            }
        }
    }
    Ok(Preview {
        path: path.to_string_lossy().into(),
        token: digest_tree(&path)?,
        changes,
    })
}
fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target).map_err(err)?;
    for item in fs::read_dir(source).map_err(err)? {
        let e = item.map_err(err)?;
        if e.file_type().map_err(err)?.is_symlink() {
            return Err("目录中发现符号链接，已停止更新".into());
        }
        let dst = target.join(e.file_name());
        if e.file_type().map_err(err)?.is_dir() {
            copy_tree(&e.path(), &dst)?;
        } else {
            fs::copy(e.path(), dst).map_err(err)?;
        }
    }
    Ok(())
}
pub fn write_export(
    parent: &Path,
    plan: &ExportPlan,
    token: &str,
    backups: &Path,
) -> Result<String> {
    let preview = preview_export(parent, plan)?;
    if preview.token != token {
        return Err("目标文件在预览后发生变化，请重新预览".into());
    }
    let dst = target(parent, plan)?;
    let old = ownership(&dst, plan)?;
    let stage = parent.join(format!(".cardforge-stage-{}", stamp()));
    fs::create_dir(&stage).map_err(err)?;
    let result = (|| {
        if dst.exists() {
            copy_tree(&dst, &stage)?;
        }
        if let Some(old) = old {
            let new: HashSet<_> = plan.files.iter().map(|f| &f.path).collect();
            for path in old.files {
                if !new.contains(&path) {
                    let file = stage.join(safe_path(&path)?);
                    if file.is_file() {
                        fs::remove_file(file).map_err(err)?;
                    }
                }
            }
        }
        let mut total = 0usize;
        for f in &plan.files {
            let bytes = STANDARD.decode(&f.data).map_err(err)?;
            total += bytes.len();
            if total > 1_000_000_000 {
                return Err("导出内容超过 1 GB".into());
            }
            let path = stage.join(safe_path(&f.path)?);
            if let Some(p) = path.parent() {
                fs::create_dir_all(p).map_err(err)?;
            }
            fs::write(path, bytes).map_err(err)?;
        }
        let manifest = Manifest {
            project_id: plan.project_id.clone(),
            mod_id: plan.mod_id.clone(),
            files: plan.files.iter().map(|f| f.path.clone()).collect(),
            card_guids: plan.card_guids.clone(),
        };
        fs::write(
            stage.join("cardforge-manifest.json"),
            serde_json::to_vec_pretty(&manifest).map_err(err)?,
        )
        .map_err(err)?;
        let temporary_old = parent.join(format!(".cardforge-old-{}", stamp()));
        if dst.exists() {
            fs::create_dir_all(backups).map_err(err)?;
            let backup = backups.join(&plan.project_id).join(stamp());
            copy_tree(&dst, &backup)?;
            fs::rename(&dst, &temporary_old).map_err(err)?;
        }
        if let Err(e) = fs::rename(&stage, &dst) {
            if temporary_old.exists() {
                let _ = fs::rename(&temporary_old, &dst);
            }
            return Err(err(e));
        }
        if temporary_old.exists() {
            let _ = fs::remove_dir_all(temporary_old);
        }
        Ok(dst.to_string_lossy().into())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}
