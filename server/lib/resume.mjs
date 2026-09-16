/**
 * Resume parser: PDF / DOCX / TXT / MD → plain text + structured profile patch.
 * Everything it extracts is offered as a *suggestion*; the user's saved profile
 * always wins (we never silently overwrite answers like salary or work auth).
 */
import AdmZip from 'adm-zip';
import { normalize, extractPhrases, sentences } from './text.mjs';

const SECTION_MAP = [
  { key: 'summary', rx: /^(professional\s+)?(summary|profile|about\s*me|objective|highlight)/i },
  { key: 'experience', rx: /^(work\s+)?(experience|employment|professional\s+experience|history)/i },
  { key: 'projects', rx: /^(selected\s+)?(projects?|portfolio)/i },
  { key: 'education', rx: /^(education|academics?|qualifications?)/i },
  { key: 'skills', rx: /^(technical\s+)?(skills?|technologies|tech\s+stack|competencies)/i },
  { key: 'certifications', rx: /^(certifications?|licenses?|courses?)/i },
  { key: 'awards', rx: /^(awards?|honors?|achievements?|publications?)/i },
  { key: 'links', rx: /^(links?|online|profiles?)/i },
];

export async function extractText(buffer, mimetype, filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (mimetype === 'application/pdf' || ext === 'pdf') return await fromPdf(buffer);
  if (ext === 'docx' || mimetype?.includes('wordprocessingml')) return fromDocx(buffer);
  if (['txt', 'md', 'markdown', 'rtf', 'html', 'htm'].includes(ext)) return fromPlain(buffer.toString('utf8'), ext);
  if (ext === 'doc') throw Object.assign(new Error('Legacy .doc (Word 97-2003) is not supported — open it in Word/Docs and export as .docx or PDF, or paste the text.'), { status: 400 });
  return fromPlain(buffer.toString('utf8'), 'txt');
}

async function fromPdf(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  } catch (e) {
    throw Object.assign(
      new Error(`Could not read this PDF (${e?.message || 'malformed'}). If it was produced by a scanner/phone camera or a "print to image", re-export it as a text-based PDF, or paste the text instead.`),
      { status: 400 }
    );
  }
  let out = '';
  for (let p = 1; p <= Math.min(doc.numPages, 12); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let last = null;
    const lines = [];
    let line = '';
    for (const item of content.items) {
      const str = item.str ?? '';
      if (last != null && Math.abs(item.transform[5] - last) > 2.5) {
        lines.push(line.trim());
        line = '';
      }
      line += (line && !/\s$/.test(line) ? ' ' : '') + str;
      last = item.transform[5];
    }
    if (line.trim()) lines.push(line.trim());
    out += lines.join('\n') + '\n';
  }
  if (normalize(out).replace(/\s/g, '').length < 200) {
    throw Object.assign(
      new Error('This PDF has no selectable text — it looks like a scan or an image of your resume. Export a text-based PDF (most "save as PDF" dialogs keep text), or paste the text on the Resume tab.'),
      { status: 400 }
    );
  }
  return out;
}

function fromDocx(buffer) {
  const zip = new AdmZip(Buffer.from(buffer));
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('Not a valid .docx (word/document.xml missing).');
  const xml = zip.readAsText(entry);
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ');
}

function fromPlain(str, ext) {
  if (ext === 'html' || ext === 'htm') return str.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n');
  if (ext === 'rtf') return str.replace(/\\'[0-9a-f]{2}/gi, ' ').replace(/\\[a-z]+-?\d*\s?/gi, '').replace(/[{}]/g, '');
  return str;
}

/* --------------------------- structure extraction --------------------------- */

export function parseResume(text) {
  const clean = normalize(text);
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);

  /* sections */
  const sections = {};
  let current = 'header';
  sections.header = [];
  for (const line of lines) {
    const asHeading = line.length <= 46 && SECTION_MAP.some((s) => s.rx.test(line.replace(/[:•\-–—\s]+$/g, '')));
    if (asHeading) {
      const hit = SECTION_MAP.find((s) => s.rx.test(line.replace(/[:•\-–—\s]+$/g, '')));
      current = hit.key;
      sections[current] = sections[current] || [];
      continue;
    }
    sections[current] = sections[current] || [];
    sections[current].push(line);
  }

  /* contact */
  const email = (clean.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/) || [])[0] || null;
  const phone = (clean.match(/(\+?\d[\d\s().\-]{7,}\d)/) || [])[0] || null;
  const linkedin = (clean.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i) || [])[0] || null;
  const github = (clean.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9\-_]+/i) || [])[0] || null;
  const website = (clean.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9\-]+\.(?:dev|com|io|ai|me|co|design|app)(?:\/[A-Za-z0-9\-_./]*)?/i) || [])[0] || null;
  const name = lines[0] && lines[0].length <= 48 && !/@|http/.test(lines[0]) ? titleGuess(lines[0]) : null;

  const headline = lines.slice(0, 6).find((l) => /engineer|scientist|designer|analyst|manager|developer|architect|marketer|account/i.test(l)) || null;

  /* skills */
  const skillBlob = [sections.skills?.join(' '), sections.summary?.join(' '), clean].filter(Boolean).join(' · ');
  const phrases = extractPhrases(skillBlob);
  const explicitLine = (sections.skills || []).join(', ');
  const chunkSkills = explicitLine
    .split(/[,•|;\/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 34)
    .slice(0, 40);
  const skills = [...new Set([...phrases, ...chunkSkills.map((s) => s.toLowerCase())])].slice(0, 60);

  /* experience blocks: resume headers come in two shapes —
     (a) "Title, Company — Mar 2023 – Present"  on one line, or
     (b) a "Company — Title, City" line followed by a "Mar 2023 – Present" line. */
  const expLines = sections.experience || [];
  const experience = [];
  for (let i = 0; i < expLines.length; i++) {
    const range = findDateRange(expLines[i]);
    if (!range) continue;
    const residual = (expLines[i].slice(0, range.start) + ' ' + expLines[i].slice(range.end)).replace(/^\s*[-–—|,·:]+\s*/, '').replace(/\s*[-–—|,·:]+\s*$/, '').trim();
    let headLine = expLines[i];
    if (residual.length < 6 && i > 0 && !/^[•\-*]/.test(expLines[i - 1])) headLine = expLines[i - 1];
    const head = findDateRange(headLine) ? residual : headLine.replace(range.re || RANGE_RE, '');
    const { title, company, location } = splitHead(head);
    const bullets = [];
    for (let j = i + 1; j < expLines.length; j++) {
      if (findDateRange(expLines[j])) break;
      const bl = expLines[j].replace(/^[•\-*·]\s*/, '').trim();
      // a new "Company — Role, City" header ends this block even when its dates sit on the next line
      if (/^[A-Z][\w.&'\- ]{2,30}\s[—–-]\s(?:Senior |Junior |Lead |Staff |Principal )?[A-Z][a-zA-Z]+(er|or|ist|ant|ent)\b/.test(bl)) break;
      const looksLikeHeader =
        bl.length < 74 && !/[.;]$/.test(bl) && !/\d\s*(%|x\b|k\b|days?|hours?|users?)/.test(bl) &&
        /^[A-Z][\w.&'\-() ]{1,46}\s+[-–—|·]\s+[^\n]{2,50}(,\s*[^\n]{2,40})?$/.test(bl) &&
        /engineer|developer|scientist|designer|analyst|manager|intern|architect|lead|consultant|specialist|associate|administrator|recruiter|accountant|marketer|pm\b/i.test(bl);
      if (looksLikeHeader) break;
      if (bl.length > 24) bullets.push(bl);
    }
    const hasOwnDates = residual.length >= 6;
    experience.push({
      title,
      company,
      location,
      start: range.start_ym,
      end: range.present ? '' : range.end_ym,
      current: range.present,
      bullets: (hasOwnDates ? [] : bullets).slice(0, 7),
    });
  }

  /* education */
  const education = [];
  for (const line of sections.education || []) {
    const m = line.match(/(B\.?Tech|B\.?E\.?|B\.?Sc|M\.?Tech|M\.?Sc|MBA|B\.?Com|Ph\.?D|Bachelor|Master)[^\n]{0,80}/i);
    if (!m) continue;
    education.push({ school: normalize(line.replace(m[0], '')).replace(/[|,·]\s*$/, '') || '—', degree: normalize(m[0]).slice(0, 90), start: (line.match(/(19|20)\d{2}/) || [])[0] || '', end: (line.match(new RegExp(`((19|20)\\d{2})(?!.*\\1)`, 'g')) || []).pop() || '', gpa: (line.match(/(?:GPA|CGPA)[:\s]*([\d.]+)\s*(?:\/\s*[\d.]+)?/i) || [])[1] || '', highlights: [] });
  }

  /* quantified wins (used to make cover letters less generic) */
  const wins = sentences(clean).filter((s) => /\d+(\.\d+)?\s*(%|x|k|K|M|percent|million|hrs?|hours?|days?|users?|customers?|requests?|qps|tps)/.test(s) && s.length < 240).slice(0, 12);
  const leadership = sentences(clean).filter((s) => /(led|mentored|owned|launched|migrated|architected|scaled|reduced|improved|automated)/i.test(s)).slice(0, 12);
  const yearsMatch = clean.match(/(\d{1,2}(?:\.\d)?)\+?\s*years?[^.\n]{0,40}(experience|exp)/i);

  return {
    text: clean,
    chars: clean.length,
    words: clean.split(/\s+/).filter(Boolean).length,
    name,
    headline,
    contact: { email, phone, linkedin, github, website },
    sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.join('\n')])),
    skills,
    experience,
    education,
    wins,
    leadership,
    yearsOfExperience: yearsMatch ? Number(yearsMatch[1]) : null,
    parsedAt: new Date().toISOString(),
  };
}

function titleGuess(s) {
  return normalize(s)
    .replace(/\s*[|•·].*$/, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 48);
}


/* ----------------------------- date-range helpers --------------------------- */

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const PRESENT_RE = /present|current|now|ongoing|till\s*date|\btill\b|\bnow\b/i;
const DATE_TOKEN = String.raw`(?:(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*)?'?(?:20)?\d{2}|(?:20)?\d{2}[-/]\d{1,2}|(?:20)\d{2})`;
const RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:to|through|\\-|–|—|until)\\s*(${DATE_TOKEN}|${PRESENT_RE.source})`, 'i');

function ymOf(text) {
  const t = String(text).toLowerCase().replace(/[^a-z0-9/\-]/g, ' ').trim();
  let m = t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*'?(\d{2,4})/);
  if (m) return `${normYear(m[2])}-${String(MONTHS[m[1]]).padStart(2, '0')}`;
  m = t.match(/(\d{4})[-/](\d{1,2})/);
  if (m) return `${normYear(m[1])}-${String(Number(m[2])).padStart(2, '0')}`;
  m = t.match(/(\d{1,2})[-/](\d{4})/);
  if (m) return `${normYear(m[2])}-${String(Number(m[1])).padStart(2, '0')}`;
  m = t.match(/(\d{4})/);
  if (m) return `${normYear(m[1])}-01`;
  m = t.match(/(\d{2})\b/);
  if (m) return `20${m[1]}-01`;
  return '';
}
function normYear(y) {
  const n = String(y).replace(/[^0-9]/g, '');
  if (n.length === 2) return Number(n) > 30 ? `19${n}` : `20${n}`;
  return n.length === 4 ? n : `20${n.slice(-2)}`;
}
function findDateRange(line) {
  const m = line.match(RANGE_RE);
  if (!m) return null;
  const present = PRESENT_RE.test(m[2]);
  return { start: m.index, end: m.index + m[0].length, re: RANGE_RE, start_ym: ymOf(m[1]), end_ym: present ? '' : ymOf(m[2]), present };
}
function splitHead(head) {
  const cleaned = normalize(head)
    .replace(/\u2192/g, ' → ')
    .replace(/\s*[|]\s*/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return { title: '', company: '', location: '' };
  // split on the strongest delimiter: em dash / " at " / double hyphen
  let left = cleaned;
  let right = '';
  const em = cleaned.split(/\s[—–]\s|\s-\s|\s+at\s+/i);
  if (em.length >= 2) {
    left = em[0].trim();
    right = em.slice(1).join(' — ').trim();
  }
  // trailing ", City, Country" chunk = location
  let location = '';
  const loc = right.match(/,\s*([A-Z][A-Za-z .'-]{2,24})(?:,\s*([A-Z][A-Za-z .'-]{2,24}))?$/);
  if (loc) {
    location = loc[0].replace(/^,\s*/, '');
    right = right.slice(0, right.length - loc[0].length).trim();
  }
  // which side is the company? the one that is shorter / lacks a role noun
  const roleWord = /engineer|developer|scientist|designer|analyst|manager|architect|intern|consultant|lead|administrator|specialist|recruiter|accountant|marketer|writer/i;
  const isRole = (x) => roleWord.test(x);
  let title = left;
  let company = right;
  if (right && isRole(right) && !isRole(left)) {
    title = right;
    company = left;
  } else if (!right) {
    const m = left.match(/^(.*?)[,\s]+((?:Senior\s+|Junior\s+|Lead\s+|Staff\s+)?[A-Z][A-Za-z]*(?:\s+(?:Engineer|Developer|Scientist|Designer|Analyst|Manager|Architect|Lead|Intern))+.*)$/);
    if (m) {
      company = m[1].replace(/[,\s]+$/, '');
      title = m[2];
    }
  }
  // "Company (City)" leftovers
  company = company.replace(/\s*\([^)]*\)\s*$/, '').replace(/[“”"].*$/, '').trim();
  title = title.replace(/^[,\s—–-]+|[,\s—–-]+$/g, '').trim();
  return { title: title.slice(0, 80), company: company.slice(0, 60), location: location.slice(0, 60) };
}

/**
 * Suggested profile patch from a parsed resume, plus a list of what changed,
 * so the UI can show "these 6 fields were filled from your resume — review".
 */
export function suggestProfilePatch(parsed, existing) {
  const patch = {};
  const changed = [];
  const put = (key, value, label) => {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (JSON.stringify(existing?.[key]) === JSON.stringify(value)) return;
    patch[key] = value;
    changed.push(label);
  };

  put('fullName', parsed.name, 'Name');
  if (parsed.contact.email && parsed.contact.email !== existing?.email) {
    patch.email = parsed.contact.email;
    changed.push('Email');
  }
  if (parsed.contact.phone && parsed.contact.phone !== existing?.phone) {
    patch.phone = parsed.contact.phone.replace(/\s{2,}/g, ' ');
    changed.push('Phone');
  }
  put('linkedin', parsed.contact.linkedin ? `https://linkedin.com${parsed.contact.linkedin.split('/in')[1] || ''}`.replace(/\/+$/, '') : null, 'LinkedIn');
  put('github', parsed.contact.github ? (parsed.contact.github.startsWith('http') ? parsed.contact.github : `https://${parsed.contact.github}`) : null, 'GitHub');
  put('portfolio', parsed.contact.website ? (parsed.contact.website.startsWith('http') ? parsed.contact.website : `https://${parsed.contact.website}`) : null, 'Portfolio');
  put('linkedinHeadline', parsed.headline, 'Headline');
  if (parsed.experience?.length && !(existing?.experience || []).length) {
    patch.experience = parsed.experience;
    changed.push(`Work history (${parsed.experience.length} roles)`);
  }
  if (parsed.education?.length && !(existing?.education || []).length) {
    patch.education = parsed.education;
    changed.push('Education');
  }
  if (parsed.skills?.length) {
    const known = new Set((existing?.skills || []).map((s) => s.name.toLowerCase()));
    const additions = parsed.skills.filter((s) => !known.has(s.toLowerCase())).slice(0, 25).map((name) => ({ name, level: 3, core: false }));
    if (additions.length) {
      patch.skills = [...(existing?.skills || []), ...additions];
      changed.push(`Skills (+${additions.length})`);
    }
  }
  return { patch, changed };
}
