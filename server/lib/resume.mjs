/**
 * Resume parser: PDF / DOCX / TXT / MD → plain text + structured profile patch.
 * Everything it extracts is offered as a *suggestion*; the user's saved profile
 * always wins (we never silently overwrite answers like salary or work auth).
 */
import AdmZip from 'adm-zip';
import { normalize, extractPhrases, sentences } from './text.mjs';
import { createRequire } from 'node:module';
import { nodeVersionAdvice } from './runtime.mjs';

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

/**
 * pdfjs-dist moved its entry points around between majors: ≥4 ships an ESM
 * build (legacy/build/pdf.mjs), 3.x — the last line that supports Node 18 — is
 * CommonJS only (legacy/build/pdf.js). Try ESM, fall back to require, and never
 * pretend a packaging difference is a problem with the user's document.
 */
/* pdfjs 3.x prints "Cannot polyfill `DOMMatrix`/`Path2D`, rendering may be
   broken" at module-evaluation time when `canvas` (an optional dep used only for
   *drawing*) is absent. We extract text; that warning is noise, and noise in a
   CLI becomes "is my resume broken?" in a UI. Swallow only those lines, replay
   everything else. */
const PDFJS_HARMLESS = /Cannot polyfill|rendering may be broken|Cannot find module 'canvas'/;
function quiet(fn) {
  const kept = [];
  const originals = {};
  for (const k of ['warn', 'error', 'log']) {
    originals[k] = console[k];
    console[k] = (...a) => {
      const line = a.map((x) => (typeof x === 'string' ? x : String(x))).join(' ');
      if (PDFJS_HARMLESS.test(line)) return;
      kept.push([k, a]);
    };
  }
  const restore = () => Object.assign(console, originals);
  return Promise.resolve()
    .then(fn)
    .then(
      (v) => {
        restore();
        for (const [k, a] of kept) console[k](...a);
        return v;
      },
      (e) => {
        restore();
        for (const [k, a] of kept) console[k](...a);
        throw e;
      }
    );
}

async function loadPdfJs() {
  const errs = [];
  for (const spec of ['pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/build/pdf.mjs']) {
    try {
      const mod = await quiet(() => import(spec));
      if (typeof mod.getDocument === 'function') return mod;
      errs.push(`${spec}: loaded but no getDocument export`);
    } catch (e) {
      errs.push(`${spec}: ${e?.code || e?.name || 'error'} ${e?.message || ''}`.trim());
    }
  }
  try {
    const req = createRequire(import.meta.url);
    const mod = await quiet(() => req('pdfjs-dist/legacy/build/pdf.js'));
    if (typeof mod?.getDocument === 'function') return mod;
    errs.push('legacy/build/pdf.js (CJS): no getDocument export');
  } catch (e) {
    errs.push(`legacy CJS entry: ${e?.code || e?.name || 'error'} ${e?.message || ''}`.trim());
  }
  const ver = pdfjsVersion();
  throw Object.assign(
    new Error(
      `no usable pdfjs-dist entry point (installed version: ${ver || 'not installed'}). ` +
      `Tried: ${errs.join(' | ')}`
    ),
    { status: 500, pdfjsVersion: ver }
  );
}

function pdfjsVersion() {
  try {
    return createRequire(import.meta.url)('../pdfjs-dist/package.json').version;
  } catch {
    return '';
  }
}

async function fromPdf(buffer) {
  let getDocument;
  try {
    ({ getDocument } = await loadPdfJs());
  } catch (e) {
    /* A library that will not even load is a runtime-version problem, not a
       document problem. Saying "Could not read this PDF (malformed)" here would
       send someone re-exporting a perfectly good file. */
    throw Object.assign(
      new Error(`The PDF reader could not load inside this Node process (${e?.message || e}). ${nodeVersionAdvice()}`),
      { status: 500 }
    );
  }
  if (typeof getDocument !== 'function') {
    throw Object.assign(new Error(`The PDF reader loaded but exposes no getDocument — unsupported Node runtime. ${nodeVersionAdvice()}`), { status: 500 });
  }
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
  const emailHost = (email || '@').split('@')[1] || '';
  const siteHits = clean.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9\-]+\.(?:dev|com|io|ai|me|co|design|app|vercel\.app|netlify\.app|github\.io)(?:\/[A-Za-z0-9\-_.\/]*)?/gi) || [];
  const website =
    siteHits.find(
      (u) =>
        !u.toLowerCase().endsWith(emailHost) && !email.toLowerCase().includes(u.toLowerCase()) &&
        !/^(?:gmail|yahoo|outlook|hotmail|proton(?:mail)?)\./i.test(u) &&
        !/^(?:www\.)?(?:linkedin|github|gitlab)\.com/i.test(u) &&
        (u.includes('/') || /\.(dev|design|app|ai|vercel\.app|netlify\.app|github\.io)$/i.test(u))
    ) || null;
  const name = lines[0] && lines[0].length <= 48 && !/@|http/.test(lines[0]) ? titleGuess(lines[0]) : null;

  /* A headline is a title line, not the summary paragraph. Prefer a short
     matching line; if the only match is a sentence from the summary, keep its
     first clause instead of pasting 400 characters into profile.linkedinHeadline
     (which letters and the prefill pack both reuse). */
  const ROLE_RX = /engineer|scientist|designer|analyst|manager|developer|architect|marketer|account|consultant|intern/i;
  const dated = (l) => /\b(?:19|20)\d{2}\b\s*[—–-]|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(?:19|20)?\d{2}\s*[—–-]/i.test(l);
  let headline =
    lines
      .slice(0, 6)
      .map((l) => l.replace(/\s*\([^)]*\)\s*$/, '').trim())
      .find((l) => ROLE_RX.test(l) && !dated(l) && l.length <= 110 && !/[.!?]$/.test(l)) ||
    lines.slice(0, 6).find((l) => ROLE_RX.test(l) && !dated(l) && !l.includes('(') && l.length <= 160) ||
    null;
  if (!headline) {
    const long = lines.slice(0, 8).find((l) => ROLE_RX.test(l) && l.length > 160);
    if (long) {
      const first = long.split(/(?<=[.!?])\s+/)[0].replace(/\bwith\b.*$/i, '').replace(/[,;:]\s*$/, '').trim();
      headline = first.length > 6 && first.length <= 110 ? first : null;
    }
  }

  /* --- display case for skills ---------------------------------------------
     Everything below is lowercased for matching, which is right for the matcher
     and wrong for a resume: "nextjs", "reactjs", "ci" (because "CI/CD" was split
     on the slash) and "css" all read as a list dump. This table only fixes
     spelling — it never adds a skill the document did not state. */
  const SKILL_DISPLAY = {
    nextjs: 'Next.js', 'next js': 'Next.js', reactjs: 'React.js', nodejs: 'Node.js',
    expressjs: 'Express.js', 'react js': 'React.js', 'node js': 'Node.js',
    'ci/cd': 'CI/CD', cicd: 'CI/CD', ci: 'CI/CD', cd: 'CI/CD',
    'aws ec2': 'AWS EC2', jdbc: 'JDBC', jenkins: 'Jenkins', github: 'GitHub',
    gitlab: 'GitLab', tailwindcss: 'Tailwind CSS', 'tailwind css': 'Tailwind CSS',
    thymeleaf: 'Thymeleaf', mockito: 'Mockito', junit: 'JUnit', maven: 'Maven',
    postman: 'Postman', websockets: 'WebSockets', 'rest apis': 'REST APIs', rest: 'REST APIs',
    'api integrations': 'API integrations', 'payment integration': 'Payment integration',
    'system design': 'System design', 'data structures': 'Data structures',
    'distributed systems': 'Distributed systems', 'functional programming': 'Functional programming',
    'unit testing': 'Unit testing', 'problem solving': 'Problem solving',
    'soft skills': 'Soft skills', communication: 'Communication',
    'vs code': 'VS Code', unix: 'Unix', linux: 'Linux', 'core java': 'Core Java',
    springboot: 'Spring Boot', 'spring boot': 'Spring Boot', hibernate: 'Hibernate',
    microservices: 'Microservices', authentication: 'Authentication', upi: 'UPI',
    b2b: 'B2B', tdd: 'TDD', dsa: 'DSA', oop: 'OOP', ddd: 'DDD',
    css: 'CSS', html: 'HTML', xml: 'XML', json: 'JSON', sql: 'SQL', nosql: 'NoSQL',
    js: 'JavaScript', ts: 'TypeScript', java: 'Java', python: 'Python', go: 'Go',
    docker: 'Docker', kubernetes: 'Kubernetes', aws: 'AWS', postgresql: 'PostgreSQL',
    mysql: 'MySQL', mongodb: 'MongoDB', redis: 'Redis', kafka: 'Kafka',
    typescript: 'TypeScript', javascript: 'JavaScript', react: 'React.js',
    redux: 'Redux', git: 'Git', rabbitmq: 'RabbitMQ', ec2: 'Amazon EC2', ecs: 'Amazon ECS',
    rds: 'Amazon RDS', s3: 'S3', grafana: 'Grafana', terraform: 'Terraform', airflow: 'Airflow',
    dbt: 'dbt', opentelemetry: 'OpenTelemetry', cloudfront: 'Amazon CloudFront',
    'github actions': 'GitHub Actions', 'a/b testing': 'A/B testing', grpc: 'gRPC',
    storybook: 'Storybook', fastify: 'Fastify', express: 'Express.js', tailwind: 'Tailwind CSS',
    'trunk-based development': 'Trunk-based development', algorithms: 'Algorithms',
  };
  const displaySkill = (raw) => {
    const k = String(raw).trim().toLowerCase();
    if (SKILL_DISPLAY[k]) return SKILL_DISPLAY[k];
    if (/[A-Z]/.test(String(raw))) return String(raw).trim();
    return String(raw).trim().replace(/\b(react|node|express|vue|angular|spring|hibernate|bootstrap)\b/gi, (w) => w[0].toUpperCase() + w.slice(1));
  };

  /* skills */
  const skillBlob = [sections.skills?.join(' '), sections.summary?.join(' '), clean].filter(Boolean).join(' · ');
  const phrases = extractPhrases(skillBlob);
  /* skills lines are usually "Label: a, b, c" — the label is not a technology */
  const explicitLine = (sections.skills || [])
    .join(', ')
    .replace(/\b([A-Z][A-Za-z &+#.\-/]{2,28}:)\s*/g, ' ');
  const chunkSkills = explicitLine
    .split(/[,•|;\/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 34 && !/:/.test(s) && !/^(?:and|other|etc\.?)$/i.test(s))
    .slice(0, 40);
  const stackSkills = (sections.experience || [])
    .flatMap((l) => (l.match(/\(([^)]{4,})\)/g) || []).map((x) => x.slice(1, -1)))
    .flatMap((x) => x.split(/,/))
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && t.length < 26 && !/^(?:and|with|etc)\b/.test(t));
  const skills = dedupeSkills([...phrases, ...stackSkills, ...chunkSkills].map(displaySkill)).slice(0, 60);

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
    /* Bullets are captured either way. The old code skipped them when the date
       range sat on the header line itself — which is exactly the shape most
       one-line "Company — Role (stack) | Jan 2025 – Present" headers use, so
       those resumes came back with roles and no achievements at all. */
    experience.push({
      title,
      company,
      location,
      start: range.start_ym,
      end: range.present ? '' : range.end_ym,
      current: range.present,
      bullets: bullets.slice(0, 8),
    });
  }

  /* education */
  const education = [];
  /* Degree phrases. Two shapes cover nearly everything in the wild; first match
     wins. Neither may cross a comma or a year, so dates never land in `degree`. */
  const DEG_RXS = [
    /\b(?:B|M)\.?(?:Tech|E|Sc|Com|CA|Arts|MBA)\b\s*(?:of|in|[,-])\s*[A-Z][A-Za-z0-9#.&/() +\-]{2,60}?\b(?=\s*(?:[,;]\s*\d{4}|\s*[—–-]\s*\d{4}|\s*\d{4}\s*[—–-]|\s*[|·•]|\s*[—–-]\s*[A-Z]|$))/,
    /\b(?:Bachelor|Master|Post\s*Graduate|Ph\.?D)(?:\s+(?:of|in)\s+[A-Za-z0-9#.&/() +\-]{2,60})?/,
    // abbreviated forms at the start of the line: "MCA — Christ University", "B.E. Information Science — RVCE"
    /\b(?:[BM]\.(?:A|E|Sc|Tech|Com|CA)|MBA|PGP|PhD|BSc|MSc)(?:\s+(?:of|in|,|-)?\s*[A-Z][A-Za-z0-9#.&/() +\-]{1,40}\b)?/,
  ];
  const EDU_TAIL = /[|,·•]|\s[—–-]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*)?(?:19|20)\d{2}|\s\d{4}\s*$|\s\d{1,3}(?:\.\d+)?\s*%/;
  for (const line of sections.education || []) {
    let dm = null;
    for (const rx of DEG_RXS) {
      const hit = line.match(rx);
      if (hit) {
        dm = hit;
        break;
      }
    }
    if (!dm) continue;
    const degree = normalize(dm[0]).replace(/[|,·;]\s*$/, '').slice(0, 90);
    /* school = everything before the degree phrase, minus the delimiter that
       separated them; the tail after the degree is dates/marks, not the school */
    let head = line.slice(0, dm.index).replace(/\s*[|,·:—–-]\s*$/, '').trim();
    if (!head) {
      const t = line.slice((dm.index || 0) + dm[0].length);
      const cut = t.search(EDU_TAIL);
      head = (cut > 0 ? t.slice(0, cut) : t)
        .replace(/^\s*[,;:]\s*(?:[A-Za-z ]{2,40}?)(?=\s*[|,·•—–-]|\s*\d)/, (m) => m)
        .replace(/^\s*[|,·:]\s*/, '')
        .replace(/\s*[—–-]\s*$/, '')
        .trim();
      // if the fragment before the degree was empty, a "School — Degree" layout is
      // already handled above; here we may have "Degree, School, dates" instead
      if (head.length > 40) head = '';
    }
    const field = (line.slice((dm.index || 0) + dm[0].length).match(/^\s*[—–|,-]\s*([A-Z][A-Za-z0-9 .']{2,48})/) || [])[1] || '';
    const years = line.match(/(?:19|20)\d{2}/g) || [];
    const marks = (line.match(/\b\d{1,3}(?:\.\d+)?\s*%|(?:CGPA|GPA)\s*[:\s]?\s*\d(?:\.\d)?\s*(?:\/\s*10)?/i) || [])[0] || '';
    education.push({
      school: (head || field || '—').slice(0, 70),
      degree,
      start: years[0] || '',
      end: years.length > 1 ? years[years.length - 1] : '',
      gpa: (line.match(/(?:GPA|CGPA)\s*[:\s]\s*([\d.]+)\s*(?:\/\s*[\d.]+)?/i) || [])[1] || '',
      marks: marks.replace(/\s+/g, ' ').trim(),
      highlights: [],
    });
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

/**
 * A skill list is the one place a resume is read token by token, so it must not
 * contain "C++" and "c++" twice, a salary figure, or someone's self-rating.
 * Names are display-cased; identity is compared on a normalised key.
 */
function dedupeSkills(list) {
  const keyOf = (n) =>
    String(n)
      .toLowerCase()
      .replace(/\s*\((?:learning|basics?|light|exposure|familiar|beginner|intermediate|advanced|work in progress)[^)]*\)/i, '')
      .replace(/[.\-_\s]+/g, '')
      // "AWS EC2" and "Amazon EC2" and "EC2" are one skill, not three
      .replace(/^(aws|amazon|google|gcp|azure)(?=[a-z0-9]{2,})/,'')
      .trim();
  const seen = new Map();
  for (const raw of list) {
    const name = String(raw).trim();
    if (!name || name.length < 2 || name.length > 34) continue;
    if (/^[$€£₹]\s?\d|\b\d+(\.\d+)?\s*(k|K|lakh|crore|cr|%)\/(mo|yr|month|year)s?\b|^\$?\d+k\b/.test(name)) continue; // money, not a skill
    if (/^(aws|amazon|gcp|azure)$/.test(name.toLowerCase())) { /* bare cloud name is a real skill, keep it */ }
    if (/^(product|team|ownership|fast learner|self[- ]starter|detail[- ]oriented)$/i.test(name)) continue;
    if (/\b(learning|basics?|light|exposure|familiar)\b/.test(name) && !/\((?:[^)]*)\)/.test(name)) {
      // a bare self-rating with no technology attached is not a skill
      continue;
    }
    const key = keyOf(name);
    if (!key) continue;
    const prev = seen.get(key);
    // prefer the spelling that is not an all-lowercase duplicate of a titled one
    const better = !prev
      || (/[a-z]/.test(prev) && /^[A-Z]/.test(name) && prev.toLowerCase() === name.toLowerCase())
      || (/^(AWS|Amazon|GCP|Azure) /.test(name) && !/^(AWS|Amazon|GCP|Azure) /.test(prev));
    if (better) {
      seen.set(key, name);
    }
  }
  return [...seen.values()];
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
  company = company.replace(/\s*\([^)]*\)\s*$/, '').replace(/[“”\"].*$/, '').trim();
  title = title.replace(/^[,\s—–-]+|[,—–-\s]+$/g, '').trim();
  /* A "(stack)" suffix on a role header belongs in skills, not in the title: the title is
     reused verbatim in the resume header, the headline and ATS `title:` fields, where
     "Software Development Engineer (NextJS, TypeScript, MySQL, Spring Boot, Tailwind" is
     both ugly and truncated. Anything inside parentheses goes back onto the stack list. */
  let stack = [];
  const parenIn = (v, keepIfCity) => {
    const m = String(v).match(/\(([^)]{4,})\)/);
    if (!m) return v;
    const inner = m[1].split(/[,/]/).map((t) => t.trim()).filter((t) => t.length > 1 && t.length < 26);
    // a single short word inside parens on the company is a city, not a stack
    if (keepIfCity && inner.length === 1) return v;
    stack.push(...inner);
    return v.replace(m[0], '').replace(/\s*\|?\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*)?(?:19|20)\d{2}\s*[—–-]\s*(?:Present|current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*)?(?:19|20)?\d{0,4}/i, ' ').replace(/[,;|–—-]\s*$/, '').trim();
  };
  title = parenIn(title, false);
  company = parenIn(company, true);
  title = title.replace(/^[,\s—–-]+|[,—–-\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  stack = [...new Set(stack)];
  return { title: title.slice(0, 80), company: company.slice(0, 60), location: location.slice(0, 60), stack };
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
  put(
    'linkedin',
    parsed.contact.linkedin
      ? /^https?:\/\//.test(parsed.contact.linkedin)
        ? parsed.contact.linkedin
        : `https://${parsed.contact.linkedin.replace(/^www\./, '')}`.replace(/\/+$/, '')
      : null,
    'LinkedIn'
  );
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
