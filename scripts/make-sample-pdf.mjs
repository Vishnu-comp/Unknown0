/**
 * Generates data/samples/sample-resume.pdf — a real, valid, text-based PDF
 * (Helvetica / WinAnsi) so the pdf.js code path is actually exercised by the
 * tests instead of being proxied by a text file. Run: node scripts/make-sample-pdf.mjs
 *
 * Typography note, because it bit us once: the first version of this generator
 * ASCII-fied " — " to "-" and dropped the leading "•". That made the PDF fixture a
 * *different layout* from the .txt it was generated from, so header and bullet
 * parsing were tested against a shape no real resume has. WinAnsi has real bytes
 * for em dash (0x97), en dash (0x96) and bullet (0x95), so we map to the BYTES
 * and escape nothing — bytes in the stream, bytes back out of pdf.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'samples', 'sample-resume.pdf');
const TXT = path.join(ROOT, 'data', 'samples', 'sample-resume.txt');

/* Unicode → WinAnsi byte. Anything unmapped falls back to its NFKD ASCII form. */
const WINANSI_BYTE = {
  '\u2014': 0x97, // — em dash
  '\u2013': 0x96, // – en dash
  '\u2022': 0x95, // • bullet
  '\u00b7': 0xb7, // · middot
  '\u2018': 0x91,
  '\u2019': 0x92,
  '\u201c': 0x93,
  '\u201d': 0x94,
  '\u2026': 0x85,
  /* deliberately no U+2192 entry: 0xAE in WinAnsi is ®, not →. Mapping the arrow
     to that byte made the PDF fixture disagree with its own .txt source — and a
     fixture that lies about the input is how a header-parsing bug survives.
     Arrows fall through to the ASCII "->" below. */
  '\u20ac': 0x80,
  '\u00a3': 0xa3,
  '\u00d7': 0xd7,
  '\u00b1': 0xb1,
  '\u00b0': 0xb0,
};

function toBytes(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c, code); // ( ) \ must be escaped in a PDF string
    else if (code >= 0x20 && code <= 0x7e) bytes.push(code);
    else if (WINANSI_BYTE[ch] != null) bytes.push(WINANSI_BYTE[ch]);
    else {
      const flat = ASCII_FALLBACK[ch] ?? ch.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
      for (const c of flat) bytes.push(c.charCodeAt(0));
    }
  }
  return Buffer.from(bytes);
}

const ASCII_FALLBACK = { '\u2192': '->', '\u2190': '<-', '\u21d2': '=>', '\u00a0': ' ', '\u2011': '-', '\u2060': '' };

const PAGE_H = 792;
const PAGE_W = 612;
const LPP = 52;

const srcLines = fs.readFileSync(TXT, 'utf8').split('\n');
const pages = [];
for (let i = 0; i < srcLines.length; i += LPP) pages.push(srcLines.slice(i, LPP));

function streamFor(pageLines) {
  const chunks = [Buffer.from('BT\n/F1 9.6 Tf\n12 TL\n1 0 0 1 54 ' + (PAGE_H - 56) + ' Tm\n', 'latin1')];
  for (const l of pageLines) {
    chunks.push(Buffer.from('(', 'latin1'), toBytes(l), Buffer.from(') Tj\nT*\n', 'latin1'));
  }
  chunks.push(Buffer.from('ET', 'latin1'));
  return Buffer.concat(chunks);
}

const objs = [];
const numPages = pages.length;
objs.push(`<< /Type /Catalog /Pages 3 0 R >>`);
objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
objs.push(`<< /Type /Pages /Kids [ ${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')} ] /Count ${numPages} >>`);
for (let i = 0; i < numPages; i++) {
  objs.push(`<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 2 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
  const data = zlib.deflateSync(streamFor(pages[i]));
  objs.push({ dict: `<< /Length ${data.length} /Filter /FlateDecode >>`, stream: data });
}

let out = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
const offsets = [];
objs.forEach((body, i) => {
  offsets.push(out.length);
  const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
  if (typeof body === 'string') {
    out = Buffer.concat([out, head, Buffer.from(`${body}\nendobj\n`, 'latin1')]);
  } else {
    out = Buffer.concat([
      out,
      head,
      Buffer.from(`${body.dict}\nstream\n`, 'latin1'),
      body.stream,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ]);
  }
});
const xrefStart = out.length;
let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Title (Alex Kumar - Resume) /Producer (ApplyFlow sample generator) >> >>\nstartxref\n${xrefStart}\n%%EOF\n`;
out = Buffer.concat([out, Buffer.from(xref, 'latin1')]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`wrote ${path.relative(ROOT, OUT)} (${out.length} bytes, ${numPages} page(s))`);
