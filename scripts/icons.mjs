/** Generates the extension icons (green gradient tile + chevron) with no binary assets checked in by hand. */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      const t = (x + y) / (size * 2);
      // brand gradient: emerald -> cyan
      let r = Math.round(16 + (14 - 16) * t);
      let g = Math.round(185 + (165 - 185) * t);
      let b = Math.round(129 + (233 - 129) * t);
      // rounded-corner mask
      const rad = size * 0.22;
      const cx = Math.max(Math.abs(x - size / 2) - (size / 2 - rad), 0);
      const cy = Math.max(Math.abs(y - size / 2) - (size / 2 - rad), 0);
      let a = Math.hypot(cx, cy) <= rad ? 255 : 0;
      // "A" chevron glyph (thick up-stroke pair)
      const nx = x / size;
      const ny = y / size;
      const apex = 0.26;
      const halfW = 0.045;
      const legs =
        Math.abs(nx - (0.5 - (0.26 - ny) * 0.62)) < halfW + Math.max(0, (0.5 - ny) * 0.02) && ny > 0.3 && ny < 0.78;
      const cross = ny > 0.6 && ny < 0.66 && nx > 0.38 && nx < 0.62;
      if ((legs || cross) && a) {
        r = 6; g = 40; b = 32;
      }
      if (a) {
        raw[i] = r;
        raw[i + 1] = g;
        raw[i + 2] = b;
        raw[i + 3] = a;
      }
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c;
}

for (const s of [16, 48, 128]) {
  fs.writeFileSync(path.join(OUT, `icon${s}.png`), png(s));
  console.log(`icon${s}.png`);
}
