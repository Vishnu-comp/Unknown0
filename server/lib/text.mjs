/**
 * Lightweight, dependency-free text utilities used by the matcher,
 * resume parser and cover-letter generator.
 */

export const STOPWORDS = new Set(
  `a an and are as at be been being but by can could did do does for from had has have he her his how i if in into is it its me my not of on only or our ours she should so than that the their them then there these they this to up us use used using very was we were what when where which who will with would you your yours job jobs role roles team teams work working looking seeking joining help become`
    .split(/\s+/)
    .filter(Boolean)
);

export function normalize(text = '') {
  return String(text)
    .replace(/\r/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function tokens(text = '') {
  return normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9+#./\-\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function sentences(text = '') {
  return normalize(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
}

/** Multi-word technical phrases that must survive tokenisation. */
const PHRASES = [
  'node.js', 'react', 'react native', 'next.js', 'vue.js', 'angular', 'svelte', 'typescript', 'javascript',
  'python', 'java', 'c++', 'c#', 'golang', 'rust', 'ruby on rails', 'php', 'kotlin', 'swift', 'scala',
  'spring boot', 'express.js', 'django', 'fastapi', 'flask',
  'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'github actions', 'gitlab ci',
  'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'snowflake', 'bigquery',
  'redshift', 'kafka', 'spark', 'databricks', 'airflow', 'dbt', 'hadoop', 'clickhouse',
  'graphql', 'grpc', 'rest api', 'openapi', 'microservices', 'serverless', 'event-driven',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'pytorch', 'tensorflow', 'scikit-learn',
  'pandas', 'numpy', 'llm', 'langchain', 'rag', 'mlops',
  'tableau', 'power bi', 'looker', 'excel', 'sql', 'nosql',
  'ci/cd', 'unit testing', 'playwright', 'cypress', 'jest', 'selenium', 'junit',
  'figma', 'adobe xd', 'sketch', 'design systems', 'usability testing', 'wireframing', 'prototyping',
  'product management', 'roadmap', 'a/b testing', 'agile', 'scrum', 'kanban', 'jira', 'confluence',
  'google analytics', 'ga4', 'seo', 'sem', 'hubspot', 'salesforce', 'sales development', 'lead generation',
  'financial modeling', 'fp&a', 'valuation', 'gaap', 'tally', 'sap', 'power bi', 'forecasting',
  'penetration testing', 'siem', 'splunk', 'owasp', 'iam', 'soc2', 'iso 27001',
  'linux', 'bash', 'shell scripting', 'nginx', 'rabbitmq', 's3', 'lambda', 'ecs', 'eks', 'rds', 'ec2', 'cloudfront',
  'observability', 'grafana', 'prometheus', 'opentelemetry', 'datadog',
  'system design', 'distributed systems', 'data structures', 'algorithms', 'oop', 'solid',
  'product', 'saas', 'b2b', 'b2c', 'fintech', 'healthtech', 'e-commerce', 'marketplace', 'enterprise',
];

const PHRASE_SET = new Set(PHRASES);

export function extractPhrases(text = '') {
  const hay = ` ${normalize(text).toLowerCase()} `;
  const found = new Set();
  for (const p of PHRASES) {
    const safe = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[\\s,;()/.\\-])${safe}([\\s,;.()\\-]|$)`, 'i').test(hay)) found.add(p);
  }
  return [...found];
}

export function jaccard(a = new Set(), b = new Set()) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function cosineFromCounts(countsA, countsB) {
  let dot = 0;
  for (const [k, v] of countsA) dot += v * (countsB.get(k) || 0);
  let na = 0;
  for (const v of countsA.values()) na += v * v;
  let nb = 0;
  for (const v of countsB.values()) nb += v * v;
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function termCounts(text) {
  const map = new Map();
  for (const t of tokens(text)) map.set(t, (map.get(t) || 0) + 1);
  return map;
}

export function titleCase(text = '') {
  return normalize(text).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** "8/12/2024", "2024-08-12", "12 Aug 2024", "3 days ago" -> ISO date string or null */
export function parseDateLoose(input) {
  if (!input) return null;
  const s = normalize(input);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ago = s.match(/(\d+)\s*(day|week|month|hour)s?\s*ago/i);
  if (ago) {
    const d = new Date();
    const n = Number(ago[1]);
    if (/hour/i.test(ago[2])) d.setHours(d.getHours() - n);
    else if (/day/i.test(ago[2])) d.setDate(d.getDate() - n);
    else if (/week/i.test(ago[2])) d.setDate(d.getDate() - n * 7);
    else d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 10);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

/** Detect seniority bucket from free text. */
export function detectSeniority(text = '') {
  const t = normalize(text).toLowerCase();
  if (/\b(intern(ship)?|trainee|fresher)\b/.test(t)) return 'intern';
  if (/\bnew[- ]grad\b|\bgrad(uate)? hire\b|entry[- ]level\b|\b0[-–]2 years\b/.test(t)) return 'junior';
  if (/\b(staff|principal|lead|architect|head of|director|vp)\b/.test(t)) return 'staff';
  if (/\bsenior\b|\bsr\.?\b|level [45]|(3|4|5)\+ years|[5-9]\+?\s*years|\b10\+?\s*years/.test(t)) return 'senior';
  if (/\bjunior\b|\bassociate\b|\bentry[- ]level\b|\b0-2 years\b|\b1-3 years\b|\bgrad\b|\bii?\b$/.test(t)) return 'junior';
  if (/\b2-4 years\b|\bmid[- ]level\b|\bsoftware engineer (ii|2)\b/.test(t)) return 'mid';
  return 'mid';
}

/** Pull explicit years-of-experience asks. */
export function requiredYears(text = '') {
  const t = normalize(text).toLowerCase();
  const m = t.match(/(\d{1,2})\s*(?:\+)?\s*(?:\+)?\s*(?:years?|yrs?)\s*(?:of)?\s*(?:experience|exp)/) ||
    t.match(/experience\s*(?:of|:)?\s*(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)/);
  if (m) return Number(m[1]);
  const r = t.match(/(\d)\s*[-–]\s*(\d)\s*years?/);
  if (r) return Number(r[1]);
  return null;
}

export function extractSalary(text = '') {
  const t = normalize(text);
  const out = { currency: null, min: null, max: null, period: null };
  const m = t.match(/(₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP|S?\$|SGD|AUD|CAD)\s?([\d,]+(?:\.\d+)?)\s*(k|K|lakh|lac|L|lpa|LPA|cr|Crore)?\s*[-–to]{1,3}\s*(₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP|S?\$|SGD|AUD|CAD)?\s?([\d,]+(?:\.\d+)?)\s*(k|K|lakh|lac|L|lpa|LPA|cr|Crore)?/);
  if (m) {
    const cur = m[1].toUpperCase();
    out.currency = /₹|INR|RS/.test(cur) ? 'INR' : /€|EUR/.test(cur) ? 'EUR' : /£|GBP/.test(cur) ? 'GBP' : /SGD/.test(cur) ? 'SGD' : /AUD/.test(cur) ? 'AUD' : /CAD/.test(cur) ? 'CAD' : 'USD';
    const scale = (suf) => {
      if (!suf) return 1;
      const x = suf.toLowerCase();
      if (x === 'k') return 1000;
      if (x === 'l' || x.includes('lakh') || x.includes('lac')) return 100000;
      if (x.includes('lpa')) return 100000;
      if (x.includes('cr')) return 10000000;
      return 1;
    };
    const num = (s) => Number(String(s).replace(/,/g, ''));
    out.min = num(m[2]) * scale(m[3]);
    out.max = num(m[5]) * (scale(m[6]) || scale(m[3]));
    if (out.min && !out.max) out.max = out.min;
    // INR "LPA" often written as "18-24 LPA"
    if (out.currency === 'INR' && out.max < 2000) {
      out.min *= 100000;
      out.max *= 100000;
    }
    out.period = /year|annum|pa|lpa/i.test(t) ? 'year' : /month/i.test(t) ? 'month' : /hour/i.test(t) ? 'hour' : 'year';
  }
  return out.min ? out : null;
}

export function highlight(text = '', terms = [], mark = '**') {
  let out = normalize(text);
  const seen = new Set();
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    if (!term || term.length < 3 || seen.has(term)) continue;
    seen.add(term);
    const rx = new RegExp(`(^|[^A-Za-z0-9+#.])(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![A-Za-z0-9])`, 'ig');
    out = out.replace(rx, `$1${mark}$2${mark}`);
  }
  return out;
}

export function truncate(text = '', max = 320) {
  const t = normalize(text);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
