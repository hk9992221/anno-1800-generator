use crate::{
    rda,
    storage::{err, stamp, Result},
    xml_encoding,
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
pub struct Discovery {
    pub resources: Resources,
    pub archives: Vec<Value>,
    pub warnings: Vec<String>,
}

/// Index concrete mod assets; arbitrary XPath patches remain outside this catalog.
pub fn scan_mods(root: &Path, cancel: &AtomicBool, progress: &impl Fn(&str)) -> Result<Value> {
    let mut files = vec![];
    fn walk(dir: &Path, files: &mut Vec<PathBuf>, depth: usize) -> Result<()> {
        if depth > 24 {
            return Ok(());
        }
        for e in fs::read_dir(dir).map_err(err)? {
            let e = e.map_err(err)?;
            let ty = e.file_type().map_err(err)?;
            let p = e.path();
            if ty.is_symlink() || e.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            if ty.is_dir() {
                walk(&p, files, depth + 1)?;
            } else if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("xml")) {
                files.push(p);
            }
        }
        Ok(())
    }
    walk(root, &mut files, 0)?;
    files.sort();
    let mut texts = BTreeMap::new();
    let mut guids = std::collections::BTreeSet::<u32>::new();
    let mut warnings = vec![];
    for p in files.iter().filter(|p| {
        p.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .eq_ignore_ascii_case("texts_chinese.xml")
    }) {
        let result = asset_fragments(
            BufReader::new(fs::File::open(p).map_err(err)?),
            b"Text",
            |xml| {
                let d = roxmltree::Document::parse(xml).map_err(err)?;
                let n = d.root_element();
                if let Ok(g) = text_at(n, "GUID").parse::<u32>() {
                    guids.insert(g);
                    texts.insert(g, text_at(n, "Text"));
                }
                Ok(())
            },
        );
        match result {
            Ok(notes) => warnings.extend(
                notes
                    .into_iter()
                    .map(|note| format!("{}：{note}", p.display())),
            ),
            Err(e) => warnings.push(format!("{}：{e}", p.display())),
        }
    }
    let mut assets = vec![];
    let mut mods = std::collections::BTreeSet::new();
    for p in files.iter().filter(|p| {
        !p.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .starts_with("texts_")
    }) {
        if cancel.load(Ordering::Relaxed) {
            return Err("扫描已取消".into());
        }
        progress(&format!(
            "扫描已安装 Mod：{}",
            p.file_name().unwrap_or_default().to_string_lossy()
        ));
        let mut project_id = String::new();
        let mut mod_dir = None;
        for ancestor in p.ancestors().skip(1).take_while(|a| a.starts_with(root)) {
            if ancestor.join("modinfo.json").is_file() || ancestor.join("data").is_dir() {
                mod_dir = Some(ancestor.to_path_buf());
            }
            if let Ok(bytes) = fs::read(ancestor.join("cardforge-manifest.json")) {
                if let Ok(m) = serde_json::from_slice::<Value>(&bytes) {
                    project_id = m["projectId"].as_str().unwrap_or("").into();
                }
            }
        }
        if let Some(dir) = mod_dir {
            mods.insert(dir);
        }
        let result = asset_fragments(
            BufReader::new(fs::File::open(p).map_err(err)?),
            b"Asset",
            |xml| {
                let doc = roxmltree::Document::parse(xml).map_err(err)?;
                let n = doc.root_element();
                let mut a = asset_metadata(n, &texts, &p.to_string_lossy());
                let g = a["guid"].as_u64().unwrap_or(0);
                if g == 0 {
                    return Ok(());
                }
                guids.insert(g as u32);
                a["projectId"] = json!(project_id);
                assets.push(a);
                Ok(())
            },
        );
        match result {
            Ok(notes) => warnings.extend(
                notes
                    .into_iter()
                    .map(|note| format!("{}：{note}", p.display())),
            ),
            Err(e) => warnings.push(format!("{}：{e}", p.display())),
        }
    }
    Ok(
        json!({"assets":assets,"guids":guids.into_iter().collect::<Vec<_>>(),"warnings":warnings,"modCount":mods.len()}),
    )
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
    Ok(discover_detailed(root, cancel, progress)?.resources)
}
pub fn discover_detailed(
    root: &Path,
    cancel: &AtomicBool,
    progress: &impl Fn(&str),
) -> Result<Discovery> {
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
            if name.starts_with('.') || name == "node_modules" || name.eq_ignore_ascii_case("mods")
            {
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
    archives.sort_by_key(|p| {
        (
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
                .contains("patch"),
            natural_number(p),
            p.to_string_lossy().to_lowercase(),
        )
    });
    let mut map = Resources::new();
    let mut archive_report = vec![];
    let mut warnings = vec![];
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
        match rda::list(a) {
            Ok(entries) => {
                archive_report.push(json!({"path":a,"status":"read","entries":entries.len()}));
                for e in entries {
                    map.insert(e.path.to_lowercase(), Resource::Archive(e));
                }
            }
            Err(message) => {
                warnings.push(format!("读取归档 {} 失败：{message}", a.display()));
                archive_report
                    .push(json!({"path":a,"status":"failed","entries":0,"message":message}));
            }
        }
    }
    for (path, disk) in disks {
        let parts: Vec<_> = path.split('/').collect();
        let rel = parts
            .iter()
            .position(|p| p.eq_ignore_ascii_case("data"))
            .map(|i| parts[i..].join("/"))
            .unwrap_or(path);
        map.insert(rel.to_lowercase(), Resource::Disk(disk));
    }
    Ok(Discovery {
        resources: map,
        archives: archive_report,
        warnings,
    })
}
pub fn scenario_path(path: &str) -> bool {
    path.to_lowercase().replace('\\', "/").split('/').any(|p| {
        p == "scenario"
            || p.strip_prefix("scenario").is_some_and(|suffix| {
                !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit())
            })
    })
}
fn source_label(resource: &Resource) -> String {
    match resource {
        Resource::Disk(path) => path.to_string_lossy().to_string(),
        Resource::Archive(e) => e.archive.to_string_lossy().to_string(),
    }
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
) -> Result<Vec<String>> {
    let mut data = Vec::new();
    let mut reader = reader;
    reader.read_to_end(&mut data).map_err(err)?;
    let (xml, warning) = xml_encoding::decode_xml(&data)?;
    let mut reader = Reader::from_reader(Cursor::new(xml.as_bytes()));
    let mut buf = vec![];
    let mut capture: Option<(usize, Writer<Vec<u8>>)> = None;
    let mut document_depth = 0usize;
    loop {
        match reader.read_event_into(&mut buf).map_err(err)? {
            Event::Eof => {
                if document_depth != 0 {
                    return Err("资源 XML 存在未闭合节点".into());
                }
                break;
            }
            Event::DocType(_) => return Err("资源 XML 不允许 DTD 或外部实体".into()),
            event => {
                match &event {
                    Event::Start(_) => document_depth += 1,
                    Event::End(_) => {
                        document_depth = document_depth
                            .checked_sub(1)
                            .ok_or("资源 XML 结束节点异常")?
                    }
                    _ => {}
                }
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
    Ok(warning.into_iter().collect())
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
fn asset_metadata(
    n: roxmltree::Node<'_, '_>,
    texts: &BTreeMap<u32, String>,
    source: &str,
) -> Value {
    let g = text_at(n, "Values/Standard/GUID")
        .parse::<u32>()
        .unwrap_or(0);
    let english = text_at(n, "Values/Text/LocaText/English/Text");
    let english = if english.is_empty() {
        text_at(n, "Values/Standard/Name")
    } else {
        english
    };
    let text_guid = text_at(n, "Values/Standard/TextGUID")
        .parse::<u32>()
        .unwrap_or(g);
    let line_id = text_at(n, "Values/Text/LineID").parse::<u32>().unwrap_or(g);
    let name = texts
        .get(&g)
        .or_else(|| texts.get(&text_guid))
        .or_else(|| texts.get(&line_id))
        .cloned()
        .unwrap_or(english.clone());
    let mut a = json!({"guid":g,"nameGuid":text_guid,"lineId":line_id,"localizedName":texts.contains_key(&g)||texts.contains_key(&text_guid)||texts.contains_key(&line_id),"name":name,"english":english,"internal":text_at(n,"Values/Standard/Name"),"template":text_at(n,"Template"),"kind":"other","source":source});
    for (key, path) in [
        ("icon", "Values/Standard/IconFilename"),
        ("region", "Values/Building/AssociatedRegions"),
        ("slotRegion", "Values/ExpeditionSlot/SlotRegion"),
        ("expeditionRegion", "Values/Expedition/ExpeditionRegion"),
    ] {
        let v = text_at(n, path);
        if !v.is_empty() {
            a[key] = json!(v);
        }
    }
    if a["region"].is_null() {
        for path in [
            "Values/PopulationLevel7/AssociatedRegion",
            "Values/ThirdParty/AllowedRegions",
        ] {
            let region = text_at(n, path);
            if !region.is_empty() {
                a["region"] = json!(region);
                break;
            }
        }
    }
    for (key, path) in [
        ("baseGuid", "BaseAssetGUID"),
        ("populationLevel", "Values/Residence7/PopulationLevel7"),
        (
            "defaultResidence",
            "Values/PopulationLevel7/DefaultResidence",
        ),
    ] {
        if let Ok(v) = text_at(n, path).parse::<u32>() {
            a[key] = json!(v);
        }
    }
    let values = n.children().find(|n| n.has_tag_name("Values"));
    a["capabilities"] = json!(values
        .into_iter()
        .flat_map(|v| v.children())
        .filter(|v| v.is_element())
        .map(|v| v.tag_name().name())
        .collect::<Vec<_>>());
    for (key, container, tag) in [
        ("inputs", "FactoryInputs", "Product"),
        ("outputs", "FactoryOutputs", "Product"),
        ("needs", "PopulationInputs", "Product"),
    ] {
        if let Some(list) = values
            .into_iter()
            .flat_map(|v| v.descendants())
            .find(|v| v.has_tag_name(container))
        {
            a[key] = json!(list
                .children()
                .filter(|v| v.is_element())
                .filter_map(|v| text_at(v, tag).parse::<u32>().ok())
                .collect::<Vec<_>>());
        }
    }
    for (property, path) in [
        ("RewardPool", "RewardPool/ItemsPool"),
        ("AssetPool", "AssetPool/AssetList"),
        ("ItemEffectTargetPool", ""),
    ] {
        if let Some(pool) = values
            .into_iter()
            .flat_map(|v| v.children())
            .find(|v| v.has_tag_name(property))
        {
            a["members"] = json!(pool
                .descendants()
                .filter(|v| v.has_tag_name("GUID")
                    || v.has_tag_name("ItemLink")
                    || v.has_tag_name("Asset"))
                .filter_map(|v| v.text()?.trim().parse::<u32>().ok())
                .collect::<Vec<_>>());
            if !path.is_empty() {
                a["poolPath"] = json!(path);
            }
        }
    }
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
        let g = text_at(
            n,
            &format!("Values/Trader/Progression/{stage}/OfferingItems"),
        )
        .parse::<u32>()
        .ok()
        .filter(|guid| *guid > 0)
        .or_else(|| {
            text_at(
                n,
                &format!("Values/ConstructionAI/ItemTradeConfig/ItemPools/{stage}/Pool"),
            )
            .parse::<u32>()
            .ok()
            .filter(|guid| *guid > 0)
        })?;
        Some(json!({"stage":stage,"poolGuid":g}))
    })
    .collect();
    if !stages.is_empty() {
        a["traderStages"] = json!(stages);
    }
    a
}
fn normalized_regions(region: &str) -> Vec<String> {
    let mut regions = std::collections::BTreeSet::new();
    for token in region.split(|c: char| c.is_whitespace() || ";,，、|".contains(c)) {
        let value = match token.to_lowercase().as_str() {
            "" | "meta" | "none" | "0" => continue,
            "moderate" | "oldworld" | "capetrelawney" | "5000000" => "Moderate",
            "colony01" | "newworld" | "southamerica" | "5000001" => "Colony01",
            "arctic" | "160001" => "Arctic",
            "africa" | "enbesa" | "114327" => "Africa",
            _ => token,
        };
        regions.insert(value.to_string());
    }
    regions.into_iter().collect()
}
fn reference_assets() -> &'static BTreeMap<u64, Value> {
    static REFERENCES: std::sync::OnceLock<BTreeMap<u64, Value>> = std::sync::OnceLock::new();
    REFERENCES.get_or_init(|| {
        let assets: Vec<Value> =
            serde_json::from_str(include_str!("../../src/data/starter-assets.json"))
                .expect("内置资源参考无效");
        assets
            .into_iter()
            .filter_map(|a| Some((a["guid"].as_u64()?, a)))
            .collect()
    })
}
fn has_chinese(text: &str) -> bool {
    text.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c))
}
fn add_reference_metadata(asset: &mut Value) {
    if let Some(reference) = asset["guid"]
        .as_u64()
        .and_then(|g| reference_assets().get(&g))
    {
        if !has_chinese(asset["name"].as_str().unwrap_or(""))
            && has_chinese(reference["name"].as_str().unwrap_or(""))
        {
            asset["name"] = reference["name"].clone();
        }
        for key in [
            "region",
            "inputs",
            "outputs",
            "populationLevel",
            "needs",
            "trader",
        ] {
            if asset[key].is_null() && !reference[key].is_null() {
                asset[key] = reference[key].clone();
            }
        }
        if !reference["traderLabel"].is_null() {
            asset["traderLabel"] = reference["traderLabel"].clone();
        }
    }
    if let Some(region) = asset["region"].as_str() {
        asset["region"] = json!(normalized_regions(region).join(";"));
    }
}
pub fn complete_catalog(catalog: &mut Value) {
    let raw: BTreeMap<u64, Value> = catalog["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| Some((a["guid"].as_u64()?, a.clone())))
        .collect();
    fn resolve(
        g: u64,
        raw: &BTreeMap<u64, Value>,
        done: &mut BTreeMap<u64, Value>,
        visiting: &mut std::collections::BTreeSet<u64>,
    ) -> Option<Value> {
        if let Some(a) = done.get(&g) {
            return Some(a.clone());
        }
        let own = raw.get(&g)?;
        if !visiting.insert(g) {
            return Some(own.clone());
        }
        let parent = own["baseGuid"]
            .as_u64()
            .and_then(|b| resolve(b, raw, done, visiting));
        let mut a = parent.clone().unwrap_or(json!({}));
        for (k, v) in own.as_object()? {
            if !v.is_null() && v != "" {
                a[k] = v.clone();
            }
        }
        if own["localizedName"] == false
            && own["nameGuid"].as_u64() == Some(g)
            && own["lineId"].as_u64() == Some(g)
        {
            if let Some(parent) = parent
                .as_ref()
                .filter(|p| has_chinese(p["name"].as_str().unwrap_or("")))
            {
                a["name"] = parent["name"].clone();
            }
        }
        let caps: std::collections::BTreeSet<_> = parent
            .as_ref()
            .into_iter()
            .chain(std::iter::once(own))
            .flat_map(|v| v["capabilities"].as_array().into_iter().flatten())
            .filter_map(|v| v.as_str())
            .collect();
        a["capabilities"] = json!(caps);
        let stages: BTreeMap<_, _> = parent
            .as_ref()
            .into_iter()
            .chain(std::iter::once(own))
            .flat_map(|v| v["traderStages"].as_array().into_iter().flatten())
            .filter_map(|v| {
                (v["poolGuid"].as_u64()? > 0)
                    .then(|| (v["stage"].as_str().unwrap_or(""), v.clone()))
            })
            .collect();
        a["traderStages"] = json!(stages.into_values().collect::<Vec<_>>());
        add_reference_metadata(&mut a);
        let t = a["template"].as_str().unwrap_or("");
        let has = |v: &str| caps.contains(v);
        let kind = if has("Item") || t == "Portrait" {
            "portrait"
        } else if t == "Product" || t == "Product_Ammunition" || has("Product") {
            if format!(
                "{} {}",
                a["internal"].as_str().unwrap_or(""),
                a["english"].as_str().unwrap_or("")
            )
            .to_lowercase()
            .contains("workforce")
            {
                "workforce"
            } else {
                "product"
            }
        } else if has("PopulationLevel7") || t == "PopulationLevel7" {
            "population"
        } else if has("Residence7") || t.contains("Residence") {
            "residence"
        } else if has("Factory")
            || has("Factory7")
            || has("FactoryBase")
            || [
                "Factory",
                "Farm",
                "Mine",
                "Fishery",
                "Multifactory",
                "ProductionBuilding",
            ]
            .iter()
            .any(|v| t.contains(v))
        {
            "building"
        } else if t.contains("Ship") || t.contains("Airship") {
            "ship"
        } else if ["RewardPool", "AssetPool", "ItemEffectTargetPool"]
            .iter()
            .any(|v| has(v) || t.contains(v))
        {
            "pool"
        } else if t == "Expedition" || has("Expedition") {
            "expedition"
        } else if t == "ExpeditionEvent" {
            "event"
        } else if t.starts_with("A7_Quest") {
            "quest"
        } else if has("Profile")
            || has("Trader")
            || has("ConstructionAI")
            || t.starts_with("Profile")
        {
            "profile"
        } else {
            "other"
        };
        a["kind"] = json!(kind);
        visiting.remove(&g);
        done.insert(g, a.clone());
        Some(a)
    }
    let mut done = BTreeMap::new();
    for g in raw.keys() {
        resolve(*g, &raw, &mut done, &mut Default::default());
    }
    let mut origins = BTreeMap::<u64, std::collections::BTreeSet<String>>::new();
    for asset in done.values().filter(|a| a["kind"] == "building") {
        let regions = normalized_regions(asset["region"].as_str().unwrap_or(""));
        for guid in asset["outputs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|g| g.as_u64())
        {
            origins
                .entry(guid)
                .or_default()
                .extend(regions.iter().cloned());
        }
    }
    for asset in done.values_mut().filter(|a| a["kind"] == "product") {
        if let Some(regions) = asset["guid"]
            .as_u64()
            .and_then(|g| origins.get(&g))
            .filter(|r| !r.is_empty())
        {
            asset["region"] = json!(regions.iter().cloned().collect::<Vec<_>>().join(";"));
        }
    }
    let populations:Vec<_>=done.values().filter(|a|a["kind"]=="population").map(|a| {
        let guid=a["guid"].as_u64().unwrap();let mut homes:std::collections::BTreeSet<u64>=done.values().filter(|r|r["kind"]=="residence"&&r["populationLevel"].as_u64()==Some(guid)).filter_map(|r|r["guid"].as_u64()).collect();if let Some(r)=a["defaultResidence"].as_u64(){homes.insert(r);}
        let region=a["region"].as_str().filter(|r|!r.is_empty()).or_else(||homes.iter().find_map(|g|done.get(g)?["region"].as_str())).unwrap_or("");
        json!({"guid":guid,"name":a["name"],"region":region,"residences":homes,"needs":a["needs"].as_array().cloned().unwrap_or_default()})
    }).collect();
    for a in done.values_mut() {
        a["needFor"] = json!(populations
            .iter()
            .filter(|p| p["needs"]
                .as_array()
                .is_some_and(|ns| ns.contains(&a["guid"])))
            .map(|p| p["guid"].clone())
            .collect::<Vec<_>>());
    }
    catalog["traders"] = json!(done
        .values()
        .filter(|a| a["traderStages"].as_array().is_some_and(|s| !s.is_empty()) || a["trader"] == true)
        .map(|a| json!({"guid":a["guid"],"name":a.get("traderLabel").unwrap_or(&a["name"]),"stages":a["traderStages"], "regions":normalized_regions(a["region"].as_str().unwrap_or(""))}))
        .collect::<Vec<_>>());
    catalog["populations"] = json!(populations);
    catalog["assets"] = json!(done.into_values().collect::<Vec<_>>());
    catalog["indexVersion"] = json!(4);
}
pub fn index(
    map: &Resources,
    root: &Path,
    cancel: &AtomicBool,
    progress: &impl Fn(&str),
) -> Result<Value> {
    let mut texts = BTreeMap::new();
    let mut warnings = vec![];
    let mut files = vec![];
    for (path, resource) in map
        .iter()
        .filter(|(p, _)| p.ends_with("texts_chinese.xml") && !scenario_path(p))
    {
        progress(&format!("读取中文文本：{path}"));
        let mut parsed = BTreeMap::new();
        let result = bytes(resource).and_then(|raw| {
            asset_fragments(Cursor::new(raw), b"Text", |text| {
                if cancel.load(Ordering::Relaxed) {
                    return Err("资源读取已取消".into());
                }
                let doc = roxmltree::Document::parse(text).map_err(err)?;
                let node = doc.root_element();
                if let Ok(guid) = text_at(node, "GUID").parse::<u32>() {
                    parsed.insert(guid, text_at(node, "Text"));
                }
                Ok(())
            })
        });
        if cancel.load(Ordering::Relaxed) {
            return Err("资源读取已取消".into());
        }
        match result {
            Ok(notes) => {
                warnings.extend(
                    notes
                        .into_iter()
                        .map(|note| format!("{} / {path}：{note}", source_label(resource))),
                );
                files.push(json!({"path":path,"source":source_label(resource),"kind":"chinese","status":"read","count":parsed.len()}));
                texts.extend(parsed);
            }
            Err(message) => {
                warnings.push(format!(
                    "读取中文资源 {} / {path} 失败：{message}",
                    source_label(resource)
                ));
                files.push(json!({"path":path,"source":source_label(resource),"kind":"chinese","status":"failed","count":0,"message":message}));
            }
        }
    }
    if texts.is_empty() {
        warnings.push("没有读取到中文文本表：已使用内置中文参考，未收录资源保留原始名称。请确认游戏已安装简体中文语言资源。".into());
    }
    let mut assets = vec![];
    for (path, resource) in map.iter().filter(|(p, _)| p.ends_with("assets.xml")) {
        if scenario_path(path) {
            files.push(json!({"path":path,"source":source_label(resource),"kind":"assets","status":"skipped","count":0,"message":"独立场景配置，未合并到主游戏，避免覆盖同 GUID 资产"}));
            continue;
        }
        progress(&format!("建立主游戏资源索引：{path}"));
        let mut parsed = vec![];
        let result = bytes(resource).and_then(|raw| {
            asset_fragments(Cursor::new(raw), b"Asset", |xml| {
                if cancel.load(Ordering::Relaxed) {
                    return Err("资源读取已取消".into());
                }
                let doc = roxmltree::Document::parse(xml).map_err(err)?;
                let asset = asset_metadata(
                    doc.root_element(),
                    &texts,
                    &format!("本机游戏资源 / {path}"),
                );
                if asset["guid"].as_u64().unwrap_or(0) > 0 {
                    parsed.push(asset);
                }
                Ok(())
            })
        });
        if cancel.load(Ordering::Relaxed) {
            return Err("资源读取已取消".into());
        }
        match result {
            Ok(notes) => {
                warnings.extend(
                    notes
                        .into_iter()
                        .map(|note| format!("{} / {path}：{note}", source_label(resource))),
                );
                files.push(json!({"path":path,"source":source_label(resource),"kind":"assets","status":"read","count":parsed.len()}));
                assets.extend(parsed);
            }
            Err(message) => {
                warnings.push(format!(
                    "读取资源 {} / {path} 失败：{message}",
                    source_label(resource)
                ));
                files.push(json!({"path":path,"source":source_label(resource),"kind":"assets","status":"failed","count":0,"message":message}));
            }
        }
    }
    if assets.is_empty() {
        return Err(format!(
            "没有读取到主游戏资产，未替换原有缓存。{}",
            if warnings.is_empty() {
                "请确认选择的是 Anno 1800 游戏根目录。".into()
            } else {
                warnings.join("；")
            }
        ));
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
    let partial = texts.is_empty() || files.iter().any(|f| f["status"] == "failed");
    let mut c = json!({"version":"Anno 1800 / Local assets","source":root.to_string_lossy(),"fingerprint":format!("{:x}",h.finalize()),"assets":assets,"warnings":warnings,"indexedAt":stamp(),"scanReport":{"status":if partial {"partial"} else {"complete"},"archiveCount":0,"archivesRead":0,"archives":[],"files":files,"chineseTexts":texts.len()}});
    complete_catalog(&mut c);
    Ok(c)
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
    let image = image::DynamicImage::ImageRgba8(rgba);
    let image = if image.width() > 256 || image.height() > 256 {
        image.thumbnail(256, 256)
    } else {
        image
    };
    image
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(err)?;
    Ok(out.into_inner())
}
