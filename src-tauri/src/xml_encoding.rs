use crate::storage::Result;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use std::borrow::Cow;

/// Convert XML bytes before tokenization. Declaration/BOM detection also works for
/// files copied directly from the game, not just XML already rewritten as UTF-8.
pub fn decode_xml(data: &[u8]) -> Result<(Cow<'_, str>, Option<String>)> {
    if [
        b"\xff\xfe\0\0".as_slice(),
        b"\0\0\xfe\xff",
        b"<\0\0\0",
        b"\0\0\0<",
    ]
    .iter()
    .any(|prefix| data.starts_with(prefix))
    {
        return Err("暂不支持 UTF-32 XML，请将该文件转换为 UTF-8 或 UTF-16".into());
    }
    let looks_utf16 = |little_endian: bool| {
        for pair in data.chunks_exact(2).take(16) {
            let (ch, high) = if little_endian {
                (pair[0], pair[1])
            } else {
                (pair[1], pair[0])
            };
            if high != 0 {
                return false;
            }
            if ch.is_ascii_whitespace() {
                continue;
            }
            return ch == b'<';
        }
        false
    };
    let (encoding, skip) = if let Some((encoding, skip)) = Encoding::for_bom(data) {
        (encoding, skip)
    } else if looks_utf16(true) {
        (UTF_16LE, 0)
    } else if looks_utf16(false) {
        (UTF_16BE, 0)
    } else {
        let prefix = &data[..data.len().min(256)];
        let declaration = prefix
            .strip_prefix(b"<?xml")
            .map(|p| &p[..p.windows(2).position(|s| s == b"?>").unwrap_or(p.len())]);
        let declared = declaration
            .and_then(|prefix| {
                prefix
                    .windows(8)
                    .position(|s| s.eq_ignore_ascii_case(b"encoding"))
                    .map(|i| &prefix[i + 8..])
            })
            .and_then(|tail| {
                let equal = tail.iter().position(|b| *b == b'=')?;
                let tail = &tail[equal + 1..];
                let quote = tail.iter().position(|b| *b == b'\'' || *b == b'"')?;
                let mark = tail[quote];
                let tail = &tail[quote + 1..];
                let end = tail.iter().position(|b| *b == mark)?;
                Some(&tail[..end])
            });
        match declared {
            Some(label) => (
                Encoding::for_label(label).ok_or_else(|| {
                    format!("不支持的 XML 编码：{}", String::from_utf8_lossy(label))
                })?,
                0,
            ),
            None => (UTF_8, 0),
        }
    };
    let (text, malformed) = encoding.decode_without_bom_handling(&data[skip..]);
    if malformed && (encoding == UTF_16LE || encoding == UTF_16BE) {
        return Err(format!(
            "{} 文本存在截断字符或无效代理对，请核对该资源文件",
            encoding.name()
        ));
    }
    let warning = malformed.then(|| {
        format!(
            "{} 文本含无效字节；已保留可读内容，无法解码的字符显示为 �",
            encoding.name()
        )
    });
    Ok((text, warning))
}
