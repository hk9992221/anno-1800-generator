//! Read-only RDA 2.2 support. The byte layout follows public format documentation.
//! Original archives are never modified; unsupported encryption is reported explicitly.
use crate::storage::{err, safe_path, Result};
use flate2::read::ZlibDecoder;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize)]
pub struct Entry {
    pub archive: PathBuf,
    pub path: String,
    pub offset: u64,
    pub compressed: u64,
    pub size: u64,
    pub flags: u32,
    pub memory_offset: u64,
    pub memory_compressed: u64,
    pub memory_size: u64,
}
fn u64_at(data: &[u8], offset: usize) -> Result<u64> {
    Ok(u64::from_le_bytes(
        data.get(offset..offset + 8)
            .ok_or("RDA 数值字段截断")?
            .try_into()
            .map_err(err)?,
    ))
}
fn read_at(file: &mut File, offset: u64, size: u64) -> Result<Vec<u8>> {
    if size > 600_000_000
        || offset.checked_add(size).ok_or("RDA 偏移溢出")? > file.metadata().map_err(err)?.len()
    {
        return Err("RDA 数据块大小或偏移无效".into());
    }
    file.seek(SeekFrom::Start(offset)).map_err(err)?;
    let mut data = vec![0; size as usize];
    file.read_exact(&mut data).map_err(err)?;
    Ok(data)
}
fn unpack(data: Vec<u8>, compressed: bool, expected: u64) -> Result<Vec<u8>> {
    if expected > 600_000_000 {
        return Err("RDA 解压块超过 600 MB".into());
    }
    if !compressed {
        if data.len() as u64 != expected {
            return Err("RDA 未压缩块长度不匹配".into());
        }
        return Ok(data);
    }
    let mut out = vec![];
    ZlibDecoder::new(&data[..])
        .take(expected + 1)
        .read_to_end(&mut out)
        .map_err(err)?;
    if out.len() as u64 != expected {
        return Err("RDA 解压长度与头部不一致".into());
    }
    Ok(out)
}
pub fn list(path: &Path) -> Result<Vec<Entry>> {
    let mut file = File::open(path).map_err(err)?;
    let header = read_at(&mut file, 0, 792)?;
    if &header[..18] != b"Resource File V2.2" {
        return Err(format!("不支持此 RDA 版本：{}", path.display()));
    }
    let mut block = u64_at(&header, 784)?;
    let length = file.metadata().map_err(err)?.len();
    let mut visited = HashSet::new();
    let mut entries = vec![];
    while block > 0 && block < length {
        if !visited.insert(block) || visited.len() > 100000 {
            return Err("RDA 块链循环或过长".into());
        }
        let h = read_at(&mut file, block, 32)?;
        let flags = u32::from_le_bytes(h[..4].try_into().map_err(err)?);
        let count = u32::from_le_bytes(h[4..8].try_into().map_err(err)?);
        let packed = u64_at(&h, 8)?;
        let unpacked = u64_at(&h, 16)?;
        let next = u64_at(&h, 24)?;
        if flags & 8 != 0 || count == 0 {
            block = next;
            continue;
        }
        if flags & 2 != 0 {
            return Err(format!(
                "{} 使用尚不支持的 RDA 加密。请使用 RDAExplorer 解包后选择资源目录。",
                path.display()
            ));
        }
        if count > 1_000_000 || unpacked != u64::from(count) * 560 {
            return Err("RDA 文件表长度异常".into());
        }
        let mut mem_comp = 0;
        let mut mem_size = 0;
        let extra = if flags & 4 != 0 { 16 } else { 0 };
        let table_start = block
            .checked_sub(packed + extra)
            .ok_or("RDA 文件表偏移异常")?;
        if extra > 0 {
            let info = read_at(&mut file, block - 16, 16)?;
            mem_comp = u64_at(&info, 0)?;
            mem_size = u64_at(&info, 8)?;
        }
        let table = unpack(
            read_at(&mut file, table_start, packed)?,
            flags & 1 != 0,
            unpacked,
        )?;
        for data in table.chunks_exact(560) {
            let utf16: Vec<u16> = data[..520]
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .take_while(|n| *n != 0)
                .collect();
            let name = String::from_utf16(&utf16).map_err(err)?.replace('\\', "/");
            if name.is_empty() {
                continue;
            }
            safe_path(&name)?;
            let lower = name.to_lowercase();
            if !(lower.ends_with("assets.xml")
                || lower.ends_with("texts_chinese.xml")
                || lower.ends_with("texts_english.xml")
                || (lower.contains("icon") && (lower.ends_with(".dds") || lower.ends_with(".png"))))
            {
                continue;
            }
            entries.push(Entry {
                archive: path.into(),
                path: name,
                offset: u64_at(data, 520)?,
                compressed: u64_at(data, 528)?,
                size: u64_at(data, 536)?,
                flags,
                memory_offset: table_start
                    .checked_sub(mem_comp)
                    .ok_or("RDA 内存块偏移异常")?,
                memory_compressed: mem_comp,
                memory_size: mem_size,
            });
        }
        block = next;
    }
    Ok(entries)
}
pub fn extract(entry: &Entry) -> Result<Vec<u8>> {
    let mut file = File::open(&entry.archive).map_err(err)?;
    if entry.flags & 4 != 0 {
        let memory = unpack(
            read_at(&mut file, entry.memory_offset, entry.memory_compressed)?,
            entry.flags & 1 != 0,
            entry.memory_size,
        )?;
        let end = entry
            .offset
            .checked_add(entry.size)
            .ok_or("RDA 文件长度溢出")?;
        Ok(memory
            .get(entry.offset as usize..end as usize)
            .ok_or("RDA 内存文件偏移异常")?
            .to_vec())
    } else {
        unpack(
            read_at(&mut file, entry.offset, entry.compressed)?,
            entry.flags & 1 != 0,
            entry.size,
        )
    }
}
