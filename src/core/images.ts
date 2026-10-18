import type { CardImage, ExportFile } from './types.ts';
/** A small BC3 (DXT5) encoder for square UI icons. No external executables needed. */
export function encodeDds(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  if (width % 4 || height % 4 || rgba.length !== width * height * 4)
    throw new Error('DDS 图标尺寸必须是 4 的倍数');
  const result = new Uint8Array(128 + (width / 4) * (height / 4) * 16),
    h = new DataView(result.buffer);
  h.setUint32(0, 0x20534444, true);
  h.setUint32(4, 124, true);
  h.setUint32(8, 0x81007, true);
  h.setUint32(12, height, true);
  h.setUint32(16, width, true);
  h.setUint32(20, result.length - 128, true);
  h.setUint32(76, 32, true);
  h.setUint32(80, 4, true);
  h.setUint32(84, 0x35545844, true);
  h.setUint32(108, 0x1000, true);
  const to565 = (r: number, g: number, b: number) =>
    (Math.round((r * 31) / 255) << 11) |
    (Math.round((g * 63) / 255) << 5) |
    Math.round((b * 31) / 255);
  const from565 = (c: number) => [
    (((c >> 11) & 31) * 255) / 31,
    (((c >> 5) & 63) * 255) / 63,
    ((c & 31) * 255) / 31,
  ];
  let offset = 128;
  for (let y = 0; y < height; y += 4)
    for (let x = 0; x < width; x += 4) {
      const pixels: number[][] = [];
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++) {
          const i = ((y + dy) * width + x + dx) * 4;
          pixels.push([...rgba.subarray(i, i + 4)]);
        }
      const maxA = Math.max(...pixels.map((p) => p[3])),
        minA = Math.min(...pixels.map((p) => p[3]));
      result[offset] = maxA;
      result[offset + 1] = minA;
      const alpha = [maxA, minA];
      if (maxA > minA) {
        for (let i = 1; i <= 6; i++) alpha.push(((7 - i) * maxA + i * minA) / 7);
      } else {
        for (let i = 1; i <= 4; i++) alpha.push(((5 - i) * maxA + i * minA) / 5);
        alpha.push(0, 255);
      }
      let bits = 0n;
      pixels.forEach((p, i) => {
        let best = 0;
        for (let j = 1; j < 8; j++)
          if (Math.abs(alpha[j] - p[3]) < Math.abs(alpha[best] - p[3])) best = j;
        bits |= BigInt(best) << BigInt(i * 3);
      });
      for (let i = 0; i < 6; i++) result[offset + 2 + i] = Number((bits >> BigInt(i * 8)) & 255n);
      const luminance = (p: number[]) => p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114;
      const sorted = [...pixels].sort((a, b) => luminance(a) - luminance(b));
      let c0 = to565(...(sorted[15].slice(0, 3) as [number, number, number])),
        c1 = to565(...(sorted[0].slice(0, 3) as [number, number, number]));
      if (c0 < c1) [c0, c1] = [c1, c0];
      if (c0 === c1) {
        if (c0 < 65535) c0++;
        else c1--;
      }
      h.setUint16(offset + 8, c0, true);
      h.setUint16(offset + 10, c1, true);
      const a = from565(c0),
        b = from565(c1),
        colors = [a, b, a.map((v, i) => (2 * v + b[i]) / 3), a.map((v, i) => (v + 2 * b[i]) / 3)];
      let colorBits = 0;
      pixels.forEach((p, i) => {
        let best = 0,
          bestError = Infinity;
        for (let j = 0; j < 4; j++) {
          const error = colors[j].reduce((s, v, k) => s + (v - p[k]) ** 2, 0);
          if (error < bestError) {
            best = j;
            bestError = error;
          }
        }
        colorBits |= best << (i * 2);
      });
      h.setUint32(offset + 12, colorBits >>> 0, true);
      offset += 16;
    }
  return result;
}
export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export async function iconFiles(image: CardImage, guid: number): Promise<ExportFile[]> {
  if (image.mode !== 'custom' || !image.data) return [];
  const blob = await (await fetch(image.data)).blob();
  const bitmap = await createImageBitmap(blob);
  const files: ExportFile[] = [];
  const base = `data/graphics/cardforge/icons/icon_${guid}`;
  try {
    for (const [lod, size] of [256, 128, 64].entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('无法创建图标画布');
      ctx.drawImage(bitmap, 0, 0, size, size);
      files.push({
        path: `${base}_${lod}.dds`,
        data: bytesToBase64(encodeDds(ctx.getImageData(0, 0, size, size).data, size, size)),
      });
      if (lod === 0)
        files.push({ path: `${base}.png`, data: canvas.toDataURL('image/png').split(',')[1] });
    }
  } finally {
    bitmap.close();
  }
  return files;
}
export async function cropImage(source: string, x = 0, y = 0, zoom = 1): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(source)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建图片画布');
  const size = Math.min(bitmap.width, bitmap.height) / Math.max(1, zoom),
    sx = Math.max(
      0,
      Math.min(bitmap.width - size, (bitmap.width - size) / 2 + (x * (bitmap.width - size)) / 2),
    ),
    sy = Math.max(
      0,
      Math.min(bitmap.height - size, (bitmap.height - size) / 2 + (y * (bitmap.height - size)) / 2),
    );
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, 512, 512);
  bitmap.close();
  return canvas.toDataURL('image/png');
}
