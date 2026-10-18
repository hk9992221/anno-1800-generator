use crate::{
    resources::{self, Resource, Resources},
    storage::{err, Result},
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
pub fn resolve_root(selected: &Path) -> Result<PathBuf> {
    let p = selected.canonicalize().map_err(err)?;
    let mut choices = vec![p.clone(), p.join("Anno 1800")];
    if p.file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("maindata"))
    {
        if let Some(parent) = p.parent() {
            choices.insert(0, parent.to_path_buf());
        }
    }
    for root in choices {
        if root.join("maindata").is_dir()
            || root.join("Bin/Win64/Anno1800.exe").is_file()
            || root
                .join("data/config/export/main/asset/assets.xml")
                .is_file()
            || root.join("assets.xml").is_file()
        {
            return root.canonicalize().map_err(err);
        }
    }
    Err("未识别为 Anno 1800 游戏目录。请选择含 maindata 和 Bin 文件夹的游戏根目录。".into())
}
pub fn mod_roots(root: &Path, documents: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = vec![root.join("mods")];
    if let Some(p) = documents {
        candidates.push(p.join("Anno 1800/mods"));
        candidates.push(p.join("My Games/Anno 1800/mods"));
    }
    for name in ["USERPROFILE", "OneDrive", "OneDriveConsumer"] {
        if let Some(p) = std::env::var_os(name) {
            let p = PathBuf::from(p);
            for rel in [
                "Documents/Anno 1800/mods",
                "Documents/My Games/Anno 1800/mods",
                "Anno 1800/mods",
            ] {
                candidates.push(p.join(rel));
            }
        }
    }
    let mut out = vec![];
    for p in candidates {
        if let Ok(p) = p.canonicalize() {
            if p.is_dir() && !out.contains(&p) {
                out.push(p);
            }
        }
    }
    out
}
pub fn scan_installed(
    root: &Path,
    documents: Option<&Path>,
    cancel: &AtomicBool,
    progress: &impl Fn(&str),
) -> Result<Value> {
    let roots = mod_roots(root, documents);
    let mut assets = vec![];
    let mut guids = std::collections::BTreeSet::new();
    let mut warnings = vec![];
    let mut count = 0;
    for p in &roots {
        match resources::scan_mods(p, cancel, progress) {
            Ok(v) => {
                assets.extend(v["assets"].as_array().into_iter().flatten().cloned());
                guids.extend(
                    v["guids"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|g| g.as_u64()),
                );
                warnings.extend(v["warnings"].as_array().into_iter().flatten().cloned());
                count += v["modCount"].as_u64().unwrap_or(0);
            }
            Err(e) => return Err(e),
        }
    }
    Ok(json!({"assets":assets,"guids":guids,"warnings":warnings,"modRoots":roots,"modCount":count}))
}
pub fn add_mod_images(root: &Path, documents: Option<&Path>, map: &mut Resources) -> Result<()> {
    fn walk(p: &Path, map: &mut Resources, depth: usize) -> Result<()> {
        if depth > 24 {
            return Ok(());
        }
        for e in fs::read_dir(p).map_err(err)? {
            let e = e.map_err(err)?;
            let t = e.file_type().map_err(err)?;
            let p = e.path();
            if t.is_symlink() {
                continue;
            }
            if t.is_dir() {
                walk(&p, map, depth + 1)?;
            } else if p
                .extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("dds") || x.eq_ignore_ascii_case("png"))
            {
                let full = p.to_string_lossy().replace('\\', "/");
                if let Some(i) = full.to_lowercase().rfind("/data/") {
                    map.insert(full[i + 1..].to_lowercase(), Resource::Disk(p));
                }
            }
        }
        Ok(())
    }
    for p in mod_roots(root, documents) {
        walk(&p, map, 0)?;
    }
    Ok(())
}
