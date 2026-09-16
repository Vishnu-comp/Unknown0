/**
 * Generates data/samples/sample-resume.pdf — a real, valid PDF (text-based,
 * Helvetica, ASCII-safe) used by the resume-extraction test so the pdf.js code
 * path is actually exercised. Run: node scripts/make-sample-pdf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'samples', 'sample-resume.pdf');
const TXT = path.join(ROOT, 'data', 'samples', 'sample-resume.txt');

const lines = fs
  .readFileSync(TXT, 'utf8')
  .split('\n')
  .map((l) => l.replace(/[^\x20-\x7e]/g, (c) => ({ '—': '-', '–': '-', '·': '-', '“': '"', '”': '"', '’': "'", '→': '->' }[c] || ' ')))
  .map((l) => l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'));

const PAGE_H = 792;
const PAGE_W = 612;
const LPP = 52;
const pages = [];
for (let i = 0; i < lines.length; i += LPP) pages.push(lines.slice(i, i + LPP));

const streamFor = (pageLines) => {
  let s = 'BT\n/F1 9.6 Tf\n12 TL\n';
  s += `1 0 0 1 54 ${PAGE_H - 56} Tm\n`;
  s += pageLines.map((l) => `(${l}) Tj\nT*\n`).join('');
  s += 'ET';
  return s;
};

const objs = [];
const numPages = pages.length;
const firstPageObj = 4 + numPages * 2; // pages obj = 3, each page = 4+2i, content = 5+2i
objs.push(`<< /Type /Catalog /Pages 3 0 R >>`);
objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
objs.push(`<< /Type /Pages /Kids [ ${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')} ] /Count ${numPages} >>`);
for (let i = 0; i < numPages; i++) {
  objs.push(`<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 2 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
  const raw = streamFor(pages[i]);
  const data = zlib.deflateSync(Buffer.from(raw, 'latin1'));
  objs.push(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n` + data.toString('latin1') + '\nendstream');
}

let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
const offsets = [];
objs.forEach((body, i) => {
  offsets.push(Buffer.byteLength(out, 'latin1'));
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefStart = Buffer.byteLength(out, 'latin1');
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Title (Alex Kumar - Resume) /Producer (ApplyFlow sample generator) >> >>\nstartxref\n${xrefStart}\n%%EOF\n`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(out, 'latin1'));
console.log(`wrote ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes, ${numPages} page(s))`);
