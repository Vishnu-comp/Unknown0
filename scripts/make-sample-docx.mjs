/** Minimal valid .docx from data/samples/sample-resume.txt (no dependencies beyond adm-zip). */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = fs.readFileSync(path.join(ROOT, 'data/samples/sample-resume.txt'), 'utf8').split('\n');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paras = lines
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`)
  .join('');

const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`;
const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const zip = new AdmZip();
zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
zip.addFile('_rels/.rels', Buffer.from(rels, 'utf8'));
zip.addFile('word/document.xml', Buffer.from(document, 'utf8'));
const out = path.join(ROOT, 'data', 'samples', 'sample-resume.docx');
zip.writeZip(out);
console.log('wrote data/samples/sample-resume.docx', fs.statSync(out).size, 'bytes');
