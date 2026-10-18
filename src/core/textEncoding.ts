export function decodeXmlBytes(bytes: Uint8Array): {
  text: string;
  encoding: string;
  warning?: string;
} {
  let encoding = 'utf-8';
  const utf16 = (little: boolean) => {
    for (let i = 0; i + 1 < Math.min(bytes.length, 32); i += 2) {
      const ch = bytes[i + (little ? 0 : 1)],
        high = bytes[i + (little ? 1 : 0)];
      if (high) return false;
      if ([9, 10, 13, 32].includes(ch)) continue;
      return ch === 60;
    }
    return false;
  };
  if ((bytes[0] === 255 && bytes[1] === 254) || utf16(true)) encoding = 'utf-16le';
  else if ((bytes[0] === 254 && bytes[1] === 255) || utf16(false)) encoding = 'utf-16be';
  else if (!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)) {
    encoding =
      String.fromCharCode(...bytes.subarray(0, 256)).match(
        /^<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i,
      )?.[1] ?? encoding;
  }
  const decode = (label: string) => new TextDecoder(label, { fatal: true }).decode(bytes);
  try {
    return { text: decode(encoding), encoding };
  } catch {
    if (['utf-8', 'utf8'].includes(encoding.toLowerCase())) {
      try {
        return {
          text: new TextDecoder('gbk', { fatal: true }).decode(
            bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191
              ? bytes.subarray(3)
              : bytes,
          ),
          encoding: 'gbk',
          warning: 'UTF-8 读取失败，已自动使用 GBK 读取',
        };
      } catch {
        throw new Error('文本既不是有效 UTF-8，也无法按 GBK 完整读取，请核对文件编码');
      }
    }
    throw new Error(`无法完整读取 ${encoding} 文本，请核对文件编码`);
  }
}
