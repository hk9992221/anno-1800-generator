use crate::{
    rda,
    storage::{err, stamp, Result},
};
use quick_xml::{events::Event, Reader, Writer};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Cursor},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
#[derive(Clone, Serialize, Deserialize)]
pub enum Resource {
    Disk(PathBuf),
    Archive(rda::Entry),
}
pub type Resources = BTreeMap<String, Resource>;

/// Enumerate concrete definitions in installed mods without applying arbitrary patches.
pub fn scan_mods(root: &Path, cancel: &AtomicBool, progress: &impl Fn(&str)) -> Result<Value> {
    let mut assets = vec![];
    let mut guids = std::collections::BTreeSet::<u32>::new();
    fn walk(
        root: &Path,
        dir: &Path,
        cancel: &AtomicBool,
        progress: &impl Fn(&str),
        assets: &mut Vec<Value>,
        guids: &mut std::collections::BTreeSet<u32>,
    ) -> Result<()> {
        if cancel.load(Ordering::Relaxed) {
            return Err("扫描已取消".into());
        }
        for e in fs::read_dir(dir).map_err(err)? {
            let e = e.map_err(err)?;
            let ty = e.file_type().map_err(err)?;
            let path = e.path();
            if ty.is_symlink() || e.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            if ty.is_dir() {
                walk(root, &path, cancel, progress, assets, guids)?;
                continue;
            }
            if path.extension().and_then(|v| v.to_str()) != Some("xml") {
                continue;
            }
            progress(&format!(
                "扫描 Mod GUID：{}",
                path.file_name().unwrap_or_default().to_string_lossy()
            ));
            let mut project_id = String::new();
            for ancestor in path.ancestors().skip(1) {
                if !ancestor.starts_with(root) {
                    break;
                }
                let manifest = ancestor.join("cardforge-manifest.json");
                if manifest.is_file() {
                    if let Ok(bytes) = fs::read(manifest) {
                        if let Ok(m) = serde_json::from_slice::<Value>(&bytes) {
                            project_id = m["projectId"].as_str().unwrap_or("").into();
                        }
                    }
                    break;
                }
            }
            let file = fs::File::open(&path).map_err(err)?;
            asset_fragments(BufReader::new(file), b"Asset", |text| {
                let doc = roxmltree::Document::parse(text).map_err(err)?;
                let n = doc.root_element();
                let guid = text_at(n, "Values/Standard/GUID")
                    .parse::<u32>()
                    .unwrap_or(0);
                if guid == 0 {
                    return Ok(());
                }
                guids.insert(guid);
                let template = text_at(n, "Template");
                let kind = if template == "Product" {
                    if text_at(n, "Values/Standard/Name")
                        .to_lowercase()
                        .contains("workforce")
                    {
                        "workforce"
                    } else {
                        "product"
                    }
                } else if template.contains("Residence") {
                    "residence"
                } else if template.contains("Factory")
                    || template.contains("Farm")
                    || template.contains("Mine")
                {
                    "building"
                } else if template.contains("Item") {
                    "portrait"
                } else if template.contains("Ship") {
                    "ship"
                } else {
                    "other"
                };
                assets.push(json!({"guid":guid,"name":text_at(n,"Values/Standard/Name"),"english":text_at(n,"Values/Text/LocaText/English/Text"),"template":template,"kind":kind,"icon":text_at(n,"Values/Standard/IconFilename"),"source":path.to_string_lossy(),"projectId":project_id}));
                Ok(())
            })?;
            if path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with("texts_")
            {
                asset_fragments(
                    BufReader::new(fs::File::open(&path).map_err(err)?),
                    b"Text",
                    |text| {
                        let d = roxmltree::Document::parse(text).map_err(err)?;
                        if let Ok(g) = text_at(d.root_element(), "GUID").parse::<u32>() {
                            guids.insert(g);
                        }
                        Ok(())
                    },
                )?;
            }
        }
        Ok(())
    }
    walk(root, root, cancel, progress, &mut assets, &mut guids)?;
    Ok(json!({"assets":assets,"guids":guids.into_iter().collect::<Vec<_>>()}))
}
fn natural_number(path: &Path) -> u64 {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap_or(0)
}
pub fn discover(root: &Path, cancel: &AtomicBool, progress: &impl Fn(&str)) -> Result<Resources> {
    let mut archives = vec![];
    let mut disks = vec![];
    fn walk(
        root: &Path,
        dir: &Path,
        archives: &mut Vec<PathBuf>,
        disks: &mut Vec<(String, PathBuf)>,
        depth: usize,
    ) -> Result<()> {
        if depth > 15 {
            return Ok(());
        }
        for e in fs::read_dir(dir).map_err(err)? {
            let e = e.map_err(err)?;
            let ty = e.file_type().map_err(err)?;
            if ty.is_symlink() {
                continue;
            }
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "mods" {
                continue;
            }
            if ty.is_dir() {
                walk(root, &p, archives, disks, depth + 1)?;
            } else {
                let lower = name.to_lowercase();
                if lower.ends_with(".rda") {
                    archives.push(p);
                } else if lower.ends_with(".xml")
                    || lower.ends_with(".png")
                    || lower.ends_with(".dds")
                {
                    let rel = p
                        .strip_prefix(root)
                        .map_err(err)?
                        .to_string_lossy()
                        .replace('\\', "/");
                    disks.push((rel, p));
                }
            }
        }
        Ok(())
    }
    walk(root, root, &mut archives, &mut disks, 0)?;
    archives.sort_by_key(|p| natural_number(p));
    let mut map = Resources::new();
    for (i, a) in archives.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("资源读取已取消".into());
        }
        progress(&format!(
            "读取归档 {}/{}：{}",
            i + 1,
            archives.len(),
            a.file_name().unwrap_or_default().to_string_lossy()
        ));
        for e in rda::list(a)? {
            map.insert(e.path.to_lowercase(), Resource::Archive(e));
        }
    }
    for (path, disk) in disks {
        let rel = if let Some(i) = path.find("data/") {
            path[i..].to_string()
        } else {
            path
        };
        map.insert(rel.to_lowercase(), Resource::Disk(disk));
    }
    Ok(map)
}
pub fn bytes(resource: &Resource) -> Result<Vec<u8>> {
    match resource {
        Resource::Disk(path) => fs::read(path).map_err(err),
        Resource::Archive(e) => rda::extract(e),
    }
}
fn asset_fragments(
    reader: impl BufRead,
    tag: &[u8],
    mut process: impl FnMut(&str) -> Result<()>,
) -> Result<()> {
    let mut reader = Reader::from_reader(reader);
    let mut buf = vec![];
    let mut capture: Option<(usize, Writer<Vec<u8>>)> = None;
    loop {
        match reader.read_event_into(&mut buf).map_err(err)? {
            Event::Eof => break,
            Event::DocType(_) => return Err("资源 XML 不允许 DTD 或外部实体".into()),
            event => {
                if capture.is_none() && matches!(&event,Event::Start(e)if e.name().as_ref()==tag) {
                    capture = Some((0, Writer::new(vec![])));
                }
                if let Some((depth, writer)) = &mut capture {
                    match &event {
                        Event::Start(_) => *depth += 1,
                        Event::End(_) => *depth -= 1,
                        _ => {}
                    }
                    writer.write_event(event.into_owned()).map_err(err)?;
                    if *depth == 0 {
                        let (_, writer) = capture.take().unwrap();
                        let text = String::from_utf8(writer.into_inner()).map_err(err)?;
                        process(&text)?;
                    }
                }
            }
        }
        buf.clear();
    }
    Ok(())
}
fn text_at<'a>(node: roxmltree::Node<'a, 'a>, path: &str) -> String {
    let mut n = Some(node);
    for p in path.split('/').filter(|p| !p.is_empty()) {
        n = n.and_then(|v| {
            v.children()
                .find(|c| c.is_element() && c.tag_name().name() == p)
        });
    }
    n.and_then(|n| n.text()).unwrap_or("").trim().to_string()
}
pub fn index(
    map: &Resources,
    root: &Path,
    cancel: &AtomicBool,
    progress: &impl Fn(&str),
) -> Result<Value> {
    let mut translations = BTreeMap::new();
    for (path, resource) in map.iter().filter(|(p, _)| p.ends_with("texts_chinese.xml")) {
        progress(&format!("读取中文文本：{path}"));
        let data = bytes(resource)?;
        asset_fragments(BufReader::new(Cursor::new(data)), b"Text", |text| {
            let d = roxmltree::Document::parse(text).map_err(err)?;
            let n = d.root_element();
            if let Ok(g) = text_at(n, "GUID").parse::<u32>() {
                translations.insert(g, text_at(n, "Text"));
            }
            Ok(())
        })?;
    }
    let mut assets = BTreeMap::new();
    let mut traders = BTreeMap::new();
    let candidates: Vec<_> = map
        .iter()
        .filter(|(p, _)| p.ends_with("assets.xml"))
        .collect();
    if candidates.is_empty() {
        return Err(
            "没有找到 assets.xml。请选择游戏安装根目录、maindata，或已解包资源根目录。".into(),
        );
    }
    for (path, res) in candidates {
        progress(&format!("建立资源索引：{path}"));
        let data = bytes(res)?;
        asset_fragments(BufReader::new(Cursor::new(data)), b"Asset", |text| {
            if cancel.load(Ordering::Relaxed) {
                return Err("资源读取已取消".into());
            }
            let doc = roxmltree::Document::parse(text).map_err(err)?;
            let n = doc.root_element();
            let g = text_at(n, "Values/Standard/GUID")
                .parse::<u32>()
                .unwrap_or(0);
            if g == 0 {
                return Ok(());
            }
            let template = text_at(n, "Template");
            let internal = text_at(n, "Values/Standard/Name");
            let english = text_at(n, "Values/Text/LocaText/English/Text");
            let english = if english.is_empty() {
                internal.clone()
            } else {
                english
            };
            let name = translations.get(&g).cloned().unwrap_or(english.clone());
            let stages: Vec<_> = [
                "EarlyGame",
                "EarlyMidGame",
                "MidGame",
                "LateMidGame",
                "LateGame",
                "EndGame",
            ]
            .into_iter()
            .filter_map(|stage| {
                let path = format!("Values/Trader/Progression/{stage}/OfferingItems");
                let ai_path =
                    format!("Values/ConstructionAI/ItemTradeConfig/ItemPools/{stage}/Pool");
                text_at(n, &path)
                    .parse::<u32>()
                    .ok()
                    .or_else(|| text_at(n, &ai_path).parse().ok())
                    .filter(|guid| *guid > 0)
                    .map(|pool| json!({"stage":stage,"poolGuid":pool}))
            })
            .collect();
            if !stages.is_empty() {
                traders.insert(g, json!({"guid":g,"name":name,"stages":stages}));
            }
            let values = n.children().find(|c| c.has_tag_name("Values"));
            let has = |tag: &str| values.is_some_and(|v| v.children().any(|c| c.has_tag_name(tag)));
            let kind = if template == "Product" {
                if internal.to_lowercase().contains("workforce") {
                    "workforce"
                } else {
                    "product"
                }
            } else if template.contains("Residence") {
                "residence"
            } else if has("Factory") || template.contains("Farm") || template.contains("Mine") {
                "building"
            } else if has("Item") || template == "Portrait" {
                "portrait"
            } else if template.contains("Ship") || template.contains("Airship") {
                "ship"
            } else if has("RewardPool") || has("AssetPool") || has("ItemEffectTargetPool") {
                "pool"
            } else {
                "other"
            };
            let caps: Vec<_> = [
                "Factory",
                "Building",
                "Residence",
                "ModuleOwner",
                "Industrializable",
                "IncidentInfectable",
                "Vehicle",
                "Attacker",
                "Attackable",
                "TradeShip",
            ]
            .into_iter()
            .filter(|tag| has(tag))
            .collect();
            let inputs: Vec<u32> = values
                .into_iter()
                .flat_map(|v| v.descendants())
                .filter(|c| c.has_tag_name("FactoryInputs"))
                .flat_map(|c| c.children())
                .filter_map(|i| text_at(i, "Product").parse().ok())
                .collect();
            let pool_path = if has("RewardPool") {
                Some("RewardPool/ItemsPool")
            } else if has("AssetPool") {
                Some("AssetPool/AssetList")
            } else {
                None
            };
            let members: Vec<u32> = values
                .into_iter()
                .flat_map(|v| v.children())
                .filter(|c| {
                    c.has_tag_name("ItemEffectTargetPool")
                        || c.has_tag_name("RewardPool")
                        || c.has_tag_name("AssetPool")
                })
                .flat_map(|c| c.descendants())
                .filter(|c| {
                    c.has_tag_name("GUID") || c.has_tag_name("ItemLink") || c.has_tag_name("Asset")
                })
                .filter_map(|c| c.text()?.trim().parse().ok())
                .collect();
            let mut a = json!({"guid":g,"name":name,"english":english,"template":template,"kind":kind,"icon":text_at(n,"Values/Standard/IconFilename"),"region":text_at(n,"Values/Building/AssociatedRegions"),"capabilities":caps,"source":"本机游戏资源"});
            if has("Factory") {
                a["inputs"] = json!(inputs);
            }
            if !members.is_empty() {
                a["members"] = json!(members);
            }
            if let Some(path) = pool_path {
                a["poolPath"] = json!(path);
            }
            assets.insert(g, a);
            Ok(())
        })?;
    }
    let mut h = Sha256::new();
    for (p, r) in map {
        h.update(p.as_bytes());
        match r {
            Resource::Disk(p) => {
                if let Ok(m) = fs::metadata(p) {
                    h.update(m.len().to_le_bytes());
                }
            }
            Resource::Archive(e) => {
                h.update(e.archive.to_string_lossy().as_bytes());
                h.update(e.offset.to_le_bytes());
                h.update(e.size.to_le_bytes());
            }
        }
    }
    if assets.is_empty() {
        return Err("assets.xml 中未找到可识别的资产定义".into());
    }
    Ok(
        json!({"version":"Anno 1800 / Local assets","source":root.to_string_lossy(),"fingerprint":format!("{:x}",h.finalize()),"assets":assets.into_values().collect::<Vec<_>>(),"traders":traders.into_values().collect::<Vec<_>>(),"indexedAt":stamp()}),
    )
}

/// Decode native game icons, including BC7, to a webview-readable PNG.
pub fn portrait_png(bytes: &[u8]) -> Result<Vec<u8>> {
    let rgba = if bytes.starts_with(b"DDS ") {
        let dds = ddsfile::Dds::read(&mut Cursor::new(bytes)).map_err(err)?;
        if dds.get_width() > 8192 || dds.get_height() > 8192 {
            return Err("图标尺寸超过预览限制".into());
        }
        image_dds::image_from_dds(&dds, 0).map_err(err)?
    } else {
        image::load_from_memory(bytes).map_err(err)?.into_rgba8()
    };
    let mut out = Cursor::new(vec![]);
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(err)?;
    Ok(out.into_inner())
}
