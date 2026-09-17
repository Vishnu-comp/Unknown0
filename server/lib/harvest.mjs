/**
 * Job harvesting — shared between the browser extension and the tests.
 *
 * Why this exists: Naukri and LinkedIn expose no public jobs API (Naukri's own
 * "API" integrations are negotiated employer-side deals; LinkedIn's Jobs API is
 * partner OAuth only). So the two honest ways to get their live postings into a
 * self-hosted matcher are: (a) read the public search page/endpoint from the
 * server, which is undocumented and can be challenged at any time, or (b) read
 * the page you are already looking at, in your own logged-in session. (b) is
 * what this module does, and it is strictly more reliable — it never has to
 * defeat anything, because you are the visitor.
 *
 * Rules this module will not break:
 *   - read-only: nothing here clicks Apply, follows a link, or submits anything
 *   - no credentials, cookies, tokens or private messages are ever read
 *   - output shape matches server/lib/ingest.mjs's normalized job, so scoring,
 *     letters, tailoring and prefill work on imported jobs unchanged
 */

/* ------------------------------- normalising ------------------------------- */

export const clean = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[-–—|·]\s*|\s*[-–—|·]\s*$/g, '')
    .trim();

/**
 * "12-18 LPA", "₹10 Lakhs - ₹15 Lakhs Yr", "$90k - $120k", "1,200,000 - 1,800,000".
 *
 * Two hard-won details:
 *  - Named groups, not positional destructuring. The positional version read index 4
 *    of a 5-element match array, so the "high" number silently became the *unit*
 *    string and every salary parsed to null — with no error, anywhere.
 *  - A unit written once at the end ("6-12 LPA") governs BOTH ends, otherwise
 *    "₹9 - ₹18 Lakhs p.a." came out as 9 to 1,800,000. A scale error is the worst
 *    possible outcome here because it still looks like a number and it feeds a
 *    salary field on a real application form.
 */
export function parseSalaryRange(text) {
  const t = clean(text);
  if (!t) return {};
  const SAL_RE = /(?:(?:₹|Rs\.?|\$|USD|INR|€|£)\s*)?(?<d1>\d[\d,.]*)\s*(?<u1>k|lakh|lakhs|lpa|crore|cr)?\s*(?:-|–|—|to|\/)\s*(?:(?:₹|Rs\.?|\$|USD|INR|€|£)\s*)?(?<d2>\d[\d,.]*)\s*(?<u2>k|lakh|lakhs|lpa|crore|cr)?/gi;
  const nums = [...t.matchAll(SAL_RE)];
  if (!nums.length) return {};
  const g = nums[0].groups || {};
  const a = g.d1;
  const b = g.d2;
  const ua = g.u1 || '';
  const ub = g.u2 || '';
  if (typeof a !== 'string' || typeof b !== 'string') return {};
  const mult = (u) => {
    const x = String(u || '').toLowerCase();
    if (x === 'k') return 1000;
    if (x.startsWith('lakh') || x === 'lpa') return 100000;
    if (x.startsWith('crore') || x === 'cr') return 10000000;
    return 1;
  };
  const cur = /₹|rs\.?|inr/i.test(t) ? 'INR' : /\$|usd/i.test(t) ? 'USD' : /€/.test(t) ? 'EUR' : /£/.test(t) ? 'GBP' : null;
  const annualish = /lpa|lakhs?|crore|cr|\/\s*(yr|year|annum|p\.a\.)/i.test(t);
  /* A bare "12-18" with no unit and no currency is NOT assumed to be lakhs:
     inventing a salary is worse than reporting none. Comma-grouping is the one
     exception — nobody writes "6-12 LPA" with thousands separators, so
     "1,200,000 - 1,800,000" can only be full rupees/dollars, never lakhs. */
  const grouped = /\d[.,]\d{3}(?:[.,]\d{3})*\b/.test(t);
  if (!ub && !ua && !cur && !annualish && !grouped) return {};
  const trailing = ub || ua || (annualish && !cur ? 'lakh' : '');
  const lo = Number(a.replace(/[,.]/g, '')) * (ua ? mult(ua) : mult(trailing));
  const hi = Number(b.replace(/[,.]/g, '')) * mult(ub || trailing);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) return {};
  return { salaryMin: Math.round(lo), salaryMax: Math.round(hi), salaryCurrency: cur, salaryText: t };
}

export function parsePosted(text) {
  const t = clean(text).toLowerCase();
  /* ISO first. A <time> element gives us either its datetime attribute or its
     visible text, and Naukri's JSON sends "2026-09-15" as-is; the d/m/y pattern
     below reads only day-first dates, so an ISO value used to fall through and
     return null — the job still imported, just silently undated. */
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const iso = new Date(t.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }
  const m = t.match(/(\d+)\s*(minute|hour|hr|day|week|month)s?\s*ago/) || t.match(/(\d+)\s*(d|h|m)\b/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2][0];
    const ms = unit === 'm' && /minute/.test(t) ? 60e3 : unit === 'h' ? 3600e3 : unit === 'd' ? 864e5 : unit === 'w' ? 6048e5 : unit === 'm' ? 2592e6 : 864e5;
    return new Date(Date.now() - n * ms).toISOString();
  }
  if (/today|just posted|now\b/.test(t)) return new Date().toISOString();
  const abs = t.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (abs) return new Date(`${abs[3].length === 2 ? '20' + abs[3] : abs[3]}-${abs[1]}-${abs[2]}`).toISOString();
  return null;
}

export function experienceRange(text) {
  const t = clean(text);
  const m = t.match(/(\d+)\s*(?:-|to|—|–)\s*(\d+)?\s*(?:\+)?\s*(?:yr|years?)/i) || t.match(/(\d+)\s*\+?\s*(?:yr|years?)/i);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] ? Number(m[2]) : null;
  return { min, max, text: t };
}

/**
 * Absolute-or-not, decided without a regex: a URL is absolute iff it contains
 * "://". Cheaper to read than `/^https?:\/\//i`, it cannot be broken by the
 * double-escaping that bites when a pattern is assembled as a string, and it
 * leaves protocol-relative and root-relative hrefs for the caller to prefix.
 */
function isAbsoluteUrl(u) {
  return typeof u === 'string' && u.includes('://');
}

/** The one shape every ingest path returns. Unknown fields stay null, not guessed. */
export function normalizeJob(raw, source = 'imported') {
  const rawUrl = clean(raw.url || raw.jobUrl || raw.link || raw.redirectUrl || raw.applyUrl);
  /* Strip the query + fragment. Naukri appends ?src=SearchResult&segmentId=… and
     LinkedIn ?refId=…; keeping them makes the same posting look like a new job on
     every refresh, which shows up as duplicates in the list, not as an error.
     Relative links are left alone — normalizeJob has no base url to resolve them. */
  const url = (() => {
    if (!isAbsoluteUrl(rawUrl)) return rawUrl;
    /* Drop the query, the fragment and ONE trailing slash. The slash matters:
       LinkedIn's cards yield "/jobs/view/4123456789/" while its own share link is
       "/jobs/view/4123456789", and a paste from the address bar keeps whichever the
       user copied — so the same job would import twice under two ids. */
    const bare = rawUrl.split('#')[0].split('?')[0];
    return bare.replace(/\/$/, '') || bare;
  })();
  /* Job ids live at the END of the last path segment ("…/job-listings-java-jobs-
     in-bengaluru-2-to-5-years-44120998", "…/jobs/view/3882211004-view/").
     A regex with a lazy prefix and a greedy `(\d{6,})` cannot express that: the
     lazy part stops early and the digits group eats the id itself, so the whole
     match fails outright — every scraped job silently lost its dedupe id and came
     back as a fresh duplicate on every refresh. Taking the path segment apart has
     no backtracking to get wrong, and `\\d*` after the digits enforces the anchor. */
  const lastSegment = url.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
  const idFromUrl = (/(\d{6,})\d*$/.exec(lastSegment) || [])[1] || null;
  const sal = parseSalaryRange(raw.salary || raw.salaryText || raw.ctc || raw.compensation || raw.payRange);
  const exp = experienceRange(raw.experience || raw.experienceText || raw.yoe || raw.minExperience);
  const skills = Array.isArray(raw.skills)
    ? raw.skills.map(clean).filter(Boolean)
    : clean(raw.keywords || raw.skillTags || '')
        .split(/[,;|]/)
        .map(clean)
        .filter(Boolean);
  const loc = Array.isArray(raw.locations) ? raw.locations.map(clean).filter(Boolean).join(', ') : clean(raw.location || raw.city || raw.locationsText);
  const description = clean(raw.description || raw.jobDescription || raw.summary || raw.snippet || '');
  return {
    extId: `${source}:${raw.jobId || raw.id || idFromUrl || (url ? url.replace(/^https?:\/\//, '').slice(0, 120) : Math.random().toString(36).slice(2))}`,
    source,
    title: clean(raw.title || raw.jobTitle || raw.name) || 'Untitled role',
    company: clean(raw.companyName || raw.company || raw.org) || 'Company withheld',
    location: loc || '—',
    remote: /remote|anywhere|work from home/i.test(`${loc} ${raw.workMode || ''} ${raw.type || ''}`),
    url: url || null,
    description: description.slice(0, 4200),
    requirements: Array.isArray(raw.requirements) ? raw.requirements.map(clean).filter(Boolean) : [],
    salaryMin: sal.salaryMin ?? null,
    salaryMax: sal.salaryMax ?? null,
    salaryCurrency: sal.salaryCurrency ?? null,
    salaryText: sal.salaryText || null,
    postedAt: raw.postedAt || parsePosted(raw.postedDate || raw.timePosted || raw.aged || raw.posted),
    tags: [...new Set([...skills, ...String(raw.roleCategory || raw.functionalArea || '').split(/[,;|]/).map(clean).filter(Boolean)])].slice(0, 30),
    category: clean(raw.roleCategory || raw.industry || raw.functionalArea) || null,
    contractType: clean(raw.employmentType || raw.jobType || raw.type) || null,
    experienceText: exp?.text || clean(raw.experienceText) || null,
    minExperience: exp?.min ?? null,
    maxExperience: exp?.max ?? null,
    workMode: clean(raw.workMode) || null,
    applyCount: Number.isFinite(Number(raw.applyCount)) ? Number(raw.applyCount) : null,
    viewCount: Number.isFinite(Number(raw.viewCount)) ? Number(raw.viewCount) : null,
  };
}

/* --------------------------------- Naukri ---------------------------------- */

/**
 * Naukri's public search answers with JSON from one endpoint and HTML from the
 * other. Both are undocumented: no compatibility promise, and it sits behind an
 * anti-bot challenge that will occasionally answer a curl with a login redirect.
 * We accept either shape and say so loudly on failure — a fetcher that returns
 * [] on a 403 is how a matcher ends up "finding no jobs in Bengaluru" for weeks.
 */
export function normalizeNaukriPayload(payload) {
  const rows =
    payload?.data?.jobDetails || payload?.jobDetails || payload?.data?.searchResult?.data || payload?.data?.data || payload?.searchResult?.data || payload?.Data?.result || (Array.isArray(payload) ? payload : []);
  return (rows || []).map((j) =>
    normalizeJob(
      {
        ...j,
        jobId: j.jobId || j.groupId,
        url: j.serpActionUrl || j.applyUrl ? absolutise(j.serpActionUrl || j.applyUrl) : j.directapply ? 'https://www.naukri.com/job-application-details' : jobUrlFromNaukri(j),
      },
      'naukri'
    )
  );
}

const absolutise = (u) => {
  if (!u) return null;
  /* Drop the query string: tracking params (segmentId, src, tqid) differ per
     request, so keeping them turns one posting into N jobs on every refresh. */
  const bare = String(u).split('#')[0].split('?')[0];
  if (/^https?:/i.test(bare)) return bare;
  return `https://www.naukri.com${bare.startsWith('/') ? '' : '/'}${bare}`;
};

function jobUrlFromNaukri(j) {
  const slug = [j.title, j.companyName, j.location]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .join('-')
    .slice(0, 90);
  return j.jobId ? `https://www.naukri.com/job-listings-${slug}-${j.jobId}` : null;
}

/**
 * Server-side-rendered fallback. Two shapes, in order of trust:
 *  1. the result JSON Naukri hydrates its own page from (a global assignment)
 *  2. a structural scan of the markup — NOT a regex over nested spans. An earlier
 *     version grabbed the <a> and used its whole innerText as the title, which
 *     produced "Senior Java Engineer Acme Tech 2-5 Yrs ₹12-18 LPA …". A parser
 *     that emits that is worse than one that emits nothing, because the garbage
 *     flows straight into a scored job, a letter and a prefill payload.
 */

/* Brace-match the JSON object literal whose opening brace precedes `from`.
   Skips braces inside strings, so nested objects survive. null = unbalanced. */
function objectAt(src, from) {
  const open = src.lastIndexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/* Only these keys are lifted out of an untrusted blob, and each is lifted
   independently — so a truncated object degrades into "this row is missing its
   company", not "the whole page parsed to zero jobs". */
const NAUKRI_KEYS = ['jobId', 'groupId', 'title', 'jobTitle', 'companyName', 'company', 'location', 'experience', 'salary', 'ctc', 'skills', 'keySkills', 'description', 'jobDescription', 'snippet', 'serpActionUrl', 'applyUrl', 'directapply', 'postedOn', 'timePosted', 'age', 'jobType', 'workMode', 'roleCategory', 'functionalArea', 'numberOfOpens', 'interviews'];
const STR = '"((?:[^"\\\\]|\\\\.)*)"';
function scalarFields(chunk) {
  const out = {};
  for (const k of NAUKRI_KEYS) {
    const re = new RegExp('"\\s*' + k + '\\s*"\\s*:\\s*(' + STR + '|\\[[^\\]]*\\]|-?\\d+(?:\\.\\d+)?|true|false|null)');
    const m = re.exec(chunk);
    if (!m) continue;
    const v = m[1];
    if (v[0] === '"') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v.slice(1, -1);
      }
    } else if (v[0] === '[') {
      out[k] = [...v.matchAll(new RegExp(STR, 'g'))].map((x) => x[1]);
    } else {
      out[k] = v === 'null' || v === 'false' ? null : v === 'true' ? true : Number(v);
    }
  }
  return out;
}

const decodeEntities = (t) =>
  String(t)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, ' ');

/**
 * City is read from the slug against a fixed list of Indian tech hubs, because the
 * slug's word order is not stable ("-acme-tech-bengaluru-2-to-5-years-44120998"
 * puts the city mid-string). Fixed list, not "any token before the digits", which
 * returned "acme tech" as a location on the first try. Unknown → empty, which the
 * matcher treats as neutral rather than as a mismatch.
 */
const IN_CITIES = ['bengaluru', 'bangalore', 'mumbai', 'navi mumbai', 'delhi', 'new delhi', 'pune', 'hyderabad', 'chennai', 'gurgaon', 'gurugram', 'noida', 'greater noida', 'kolkata', 'ahmedabad', 'jaipur', 'kochi', 'coimbatore', 'indore', 'thiruvananthapuram', 'chandigarh', 'remote'];
export function cityFromSlug(url) {
  const slug = String(url || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\.html?$/i, '').replace(/-/g, ' ');
  const hit = IN_CITIES.find((c) => new RegExp(`(^| )${c.replace(/\s+/g, '[ ]')}($| )`, 'i').test(slug));
  return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

/**
 * Naukri embeds its own search results in the page. That is not a public
 * contract, so this is defensive by construction: find every object that
 * mentions jobId, try strict JSON first, fall back to per-field extraction, and
 * never throw. Anything left over goes to the markup scan below.
 */
export function parseNaukriHtml(html, { limit = 60 } = {}) {
  const src = String(html || '');
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    let row = null;
    try {
      row = normalizeNaukriPayload({ jobDetails: [raw] })[0] || null;
    } catch {
      row = null;
    }
    if (!row || !row.title || row.title === 'Untitled role') return;
    if (seen.has(row.extId)) return;
    seen.add(row.extId);
    out.push(row);
  };

  for (const m of src.matchAll(/"\s*jobId\s*"\s*:/g)) {
    if (out.length >= limit) break;
    const chunk = objectAt(src, m.index);
    if (!chunk) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') push(parsed);
    else push(scalarFields(chunk));
  }
  if (out.length >= 3) return out.slice(0, limit);

  /* 2. structural scan, deliberately conservative. On Naukri's SERP the anchor
        IS the job title, so its own text is safe; the meta row lives in a
        sibling, so the container's concatenated textContent is never read. */
  const aRe = /<a\b[^>]*href=["']([^"']*(?:job-listings|job-listing)[^"']*)["'][^>]*>([\s\S]{1,600}?)<\/a>/gi;
  let a;
  while ((a = aRe.exec(src)) && out.length < limit) {
    const url = absolutise(decodeEntities(a[1]));
    const id = (url.match(/-(\d{6,})/) || [])[1] || url;
    if (seen.has(id)) continue;
    const raw = decodeEntities(a[2].replace(/<[^>]+>/g, '\n'));
    const segs = raw
      .split('\n')
      .map((x) => clean(x))
      .filter(Boolean);
    if (!segs.length) continue;
    const META = /^\d{1,2}\s*(?:-|to|—|–)\s*\d{0,2}\s*\+?\s*(?:yrs?|years?)$|^(?:₹|Rs\.?)?\s?\d+(?:\.\d+)?\s*(?:-|to|—)\s*\d+(?:\.\d+)?\s*(?:LPA|lakhs?|PA)$/i;
    const title = segs.find((x) => !META.test(x) && x.length >= 6 && x.length <= 90) || segs[0];
    const join = segs.join(' ');
    seen.add(id);
    out.push(
      normalizeJob(
        {
          jobId: id,
          title: title.slice(0, 90),
          /* No company from the slug. "…-java-engineer-acme-tech-bengaluru-…" would
             have yielded "Java Engineer Acme Tech" — a wrong-but-plausible employer
             name is the worst possible output here, because it lands in a real form.
             The embedded-JSON path supplies it properly; here we say "withheld" so
             the user can see which rows still need a click. */
          companyName: 'Company withheld',
          url,
          experienceText: (join.match(/\b\d{1,2}\s*(?:-|to|—|–)\s*\d{0,2}\s*\+?\s*(?:yrs?|years?)\b/i) || [])[0],
          salaryText: (join.match(/(?:₹|Rs\.?)?\s?\d{1,3}(?:[.,]\d{1,3})?\s*(?:-|to|—|–)\s*\d{1,3}(?:[.,]\d{1,3})?\s*(?:LPA|lakhs?|PA)?/i) || [])[0],
          location: cityFromSlug(url),
          postedAt: parsePosted((join.match(/\b\d+\s*(?:minute|hour|day|week)s?\s*ago\b|\btoday\b/i) || [])[0] || ''),
          keywords: (join.match(/(?:key\s*)?skills\s*[:\-]\s*(.+$)/i) || [])[1],
        },
        'naukri'
      )
    );
  }
  return out;
}

export function naukriSearchUrl({ keyword = 'software engineer', location = '', page = 1, experience, salary, freshness, workMode } = {}) {
  const slugWords = String(keyword)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9+#.]/g, ''))
    .filter(Boolean);
  const slug = `${slugWords.join('-')}-jobs${location ? `-in-${String(location).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}${page > 1 ? `-${page}` : ''}`;
  const q = new URLSearchParams();
  q.set('k', slugWords.join(','));
  if (location) q.set('location', location);
  if (experience != null && experience !== '') q.set('exp', String(experience));
  if (salary) q.set('salary', String(salary));
  if (freshness) q.set('f', String(freshness));
  if (workMode) q.set('workMode', String(workMode));
  return { url: `https://www.naukri.com/${slug}?${q.toString()}`, jsonUrl: `https://www.naukri.com/api/search-jobs?${q.toString()}&page=${page}&sortBy=relevance` };
}

/* --------------------------------- LinkedIn -------------------------------- */

const LINKEDIN_TITLE_SELECTORS = ['.job-search-card__list-title', '.job-card-list__title', '.base-search-card__title', 'a.job-card-list__title', '.job-card3__title', '.entity-result__title-text a span'];
const LINKEDIN_COMPANY_SELECTORS = ['.job-search-card__subtitle a', '.job-card-container__primary-description', '.hidden-nested-link', 'a.job-card-container__link', '.entity-result__primary-subtitle'];
const LINKEDIN_CARD_SELECTORS = ['li.job-search-card', 'li[data-occludable-job-id]', '.job-card-container', '.base-card', '.entity-result'];

const text = (root, selectors) => {
  for (const s of selectors) {
    const el = root.querySelector?.(s);
    const v = clean(el?.textContent ?? el?.innerText);
    if (v) return v;
  }
  return '';
};

/* LinkedIn and Naukri both wrap their metadata line in one container whose
   textContent also includes the posting age ("Bengaluru, Karnataka, India3 days
   ago"), so the fields are read from their own <span>s, then re-joined. */
const spanTexts = (root, selector) => [...(root?.querySelectorAll?.(selector) || [])].map((el) => clean(el.textContent ?? el.innerText)).filter(Boolean);

const attr = (root, name, selectors) => {
  for (const s of selectors) {
    const el = root.querySelector?.(s);
    const v = el?.getAttribute?.(name);
    if (v) return v;
  }
  return '';
};

/**
 * Scrape the jobs you are looking at. Runs in your session, on a page you opened,
 * and only reads. LinkedIn's cards deliberately hide their text behind a
 * `data-entity-urn` attribute, so the real ids live there — without it every
 * card imports with a different id and dedupe fails on every refresh.
 */
export function scrapeLinkedIn(document, { limit = 25 } = {}) {
  const out = [];
  const seen = new Set();
  const cards = [];
  for (const s of LINKEDIN_CARD_SELECTORS) {
    const found = [...(document?.querySelectorAll?.(s) || [])];
    if (found.length) {
      cards.push(...found);
      break;
    }
  }
  for (const card of cards.slice(0, limit * 2)) {
    const urn = card.getAttribute?.('data-occludable-job-id') || attr(card, 'data-entity-urn', LINKEDIN_CARD_SELECTORS) || '';
    const id = (String(urn).match(/urn:li:jobPosting:(\d+)/) || String(urn).match(/(\d{8,})/) || [])[1] || null;
    const hrefAttr = card.querySelector?.('a[href*="/jobs/view/"]')?.getAttribute?.('href') || '';
    const link = hrefAttr || attr(card, 'href', ['.job-trending-info a, a.job-card-container__link, a.base-card__full-link', 'a[href*="/jobs/view/"]', 'a']) || (id ? `https://www.linkedin.com/jobs/view/${id}/` : '');
    /* Absent a base URI the .href property resolves to "about:blank/…", so the
       attribute comes first and the prefix decision uses isAbsoluteUrl rather than
       a startsWith('http') sniff (which would also be true for "httpfoo"). */
    const url = link ? (isAbsoluteUrl(link) ? link.split('#')[0].split('?')[0] : `https://www.linkedin.com${String(link).split('#')[0].split('?')[0]}`) : '';
    const metaSpans = [...spanTexts(card, '.job-search-card__list-metadata span'), ...spanTexts(card, '.job-card-container__metadata-item'), text(card, ['.job-search-card__list-subtitle', '.job-card-container__metadata-wrapper', '.job-card-container__metadata-item'])].flat().filter(Boolean);
    const postedEl = card.querySelector?.('time[datetime]') || card.querySelector?.('time');
    const posted = postedEl?.getAttribute?.('datetime') || text(card, ['.job-search-card__list-metadata time', 'time[datetime]']) || '';
    const metaLine = metaSpans.join(' · ');
    const key = id || url || `${text(card, LINKEDIN_TITLE_SELECTORS)}|${text(card, LINKEDIN_COMPANY_SELECTORS)}`;
    if (!key || seen.has(key)) continue;
    if (!text(card, LINKEDIN_TITLE_SELECTORS)) continue;
    seen.add(key);
    out.push(
      normalizeJob(
        {
          jobId: id || undefined,
          title: text(card, LINKEDIN_TITLE_SELECTORS),
          companyName: text(card, LINKEDIN_COMPANY_SELECTORS),
          /* LinkedIn's card puts the location first and the posting age after it,
             usually separated by "·". Read the leading field only, so the location
             can never come out as "Bengaluru, India3 days ago". */
          location: (metaSpans.find((x) => !/^\d+\s*(minute|hour|day|week|month)s?\s*ago/i.test(x) && !/\b\d{4}-\d{2}-\d{2}\b/.test(x)) || '').split('·')[0].trim() || text(card, ['.job-search-card__list-metadata']),
          url,
          /* An ISO-looking value is truncated to its date; anything else is relative
             text and goes to parsePosted. The length guard stops a bare "2026" (or a
             pure-digit year) from being read as an ISO date. */
          postedAt: !/\d/.test(posted) ? null : /^[\dTZ:.\-]+$/.test(posted) && posted.length >= 8 ? parsePosted(posted.slice(0, 10)) : parsePosted(posted),
          experienceText: (posted.match(/\d+\s*years? of experience/i) || [])[0],
        },
        'linkedin'
      )
    );
    if (out.length >= limit) break;
  }
  return out;
}

/** LinkedIn's detail page, so a single interesting posting can be scored properly. */
export function scrapeLinkedInDetail(document, location = {}) {
  const q = (s) => document?.querySelector?.(s);
  const t = (s) => clean(q(s)?.textContent);
  const title = t('h1.topcard__title, .top-card-layout__title, h1.t-24');
  if (!title) return null;
  const description = t('.show-more-less-html__markup, .description__text, div[data-testid="job-description"]');
  const seniority = t('.description__job-criteria-item:nth-child(2) h3');
  return normalizeJob(
    {
      jobId: (String(location?.pathname || '').match(/\/jobs\/view\/(\d+)/) || [])[1],
      title,
      companyName: t('h3.topcard__org-name-link, .topcard__flavor--bullet, a.appunifiedlink'),
      location: t('.topcard__flavor.topcard__flavor--bullet, .job-location-map__bullet-item'),
      url: location?.href?.split('?')[0] || null,
      description,
      experienceText: seniority,
      employmentType: t('.description__job-criteria-item:nth-child(3) h3'),
      salaryText: t('.compensation__salary, .salary compensation__salary'),
      skills: [...(document?.querySelectorAll?.('.job-skill-classification-entry__name, .skills-entity-list__list-item span') || [])].map((x) => clean(x.textContent)).filter(Boolean),
    },
    'linkedin'
  );
}


/* --------------------------- in-browser DOM variants -------------------------- */
/* Same idea as the HTML scanner, but the browser has already parsed the document,
   so there is no markup regex at all — and no chance of the failure mode that
   made us delete one. */

const NAUKRI_ROW_SELECTORS = ['div[data-job-id]', 'article.jobTuple', 'div.cust-job-tuple', 'div.srp-jobtuple-wrapper', 'li[data-job-id]'];
const NAUKRI_TITLE_SELECTORS = ['.title', 'h2', '.job-title', 'a[data-testid="jobTitle"]'];
const NAUKRI_COMPANY_SELECTORS = ['.company-name', '[data-testid="company-name"]', '.comp-name', '.sub-title', '.or-w'];
const NAUKRI_META_SELECTORS = ['.jobtuple-sec-footer-wrapper', '.footer', '.type'];
const NAUKRI_SKILL_SELECTORS = ['.job-keyword-list li', '.job-tuple-skills li', '.key-skills li', '.job-keyword-list span'];
const NAUKRI_EXP_SELECTORS = ['.experience', '[class*="exp"] .type', '.jobtuple-sec-experience'];
const NAUKRI_SAL_SELECTORS = ['.salary', '[class*="salary"]', '.ctc'];
/* Each field is read from ITS OWN element. Pulling them out of the row's
   concatenated textContent made "6-12 LPA" and "2-5 Yrs" collide as
   "6-12 LPA2-5 Yrs", and both regexes silently returned null — a job that lost
   its salary and its experience bar is worse than a parse that failed loudly. */

const textList = (root, selectors) => {
  for (const s of selectors) {
    const el = root.querySelector?.(s);
    const v = clean(el?.textContent);
    if (v) return v;
  }
  return '';
};

export function scrapeNaukri(document, location = {}, { limit = 40 } = {}) {
  const out = [];
  const seen = new Set();
  let rows = [];
  for (const s of NAUKRI_ROW_SELECTORS) {
    const found = [...(document?.querySelectorAll?.(s) || [])];
    if (found.length) {
      rows = found;
      break;
    }
  }
  if (!rows.length) {
    rows = [...(document?.querySelectorAll?.('a[href*="job-listings"]') || [])].map((a) => a.closest('div,li,article') || a);
  }
  for (const row of rows.slice(0, limit * 2)) {
    const anchor = row.querySelector?.('a[href*="job-listings"]') || (String(row.href || '').includes('job-listings') ? row : null);
    /* href ATTRIBUTE, not the .href property: a page parsed without a base URI
       (jsdom, or a document fragment) resolves relative links to "about:blank/…",
       which would give every job a useless url AND a useless dedupe id. Reading the
       attribute and absolutising it ourselves works in a browser and in a test. */
    const hrefRaw = anchor?.getAttribute?.('href') || anchor?.href || '';
    const url = hrefRaw ? absolutise(String(hrefRaw).split('?')[0].split('#')[0]) : '';
    const id = (url.match(/-(\d{6,})/) || [])[1] || (row.getAttribute?.('data-job-id') || '');
    if (!url || !id || seen.has(id)) continue;
    const title = textList(row, NAUKRI_TITLE_SELECTORS) || clean(anchor?.textContent).split(/\s{2,}|\s+\|\s+/)[0];
    /* Skill list, location and footer meta, each read once and reused. */
    const skillsFromCard = spanTexts(row, NAUKRI_SKILL_SELECTORS.join(', '));
    const locSpans = spanTexts(row, ['.job-location', '.location', '.comp-location']).filter((x) => x && !/^\d+$/.test(x));
    const foot = textList(row, NAUKRI_META_SELECTORS);
    const stripRating = (v) => clean(String(v).replace(/\s*\d(?:\.\d)?\s*$/, ''));
    if (!title || title.length < 4) continue;
    seen.add(id);
    out.push(
      normalizeJob(
        {
          jobId: id,
          title,
          /* A Naukri .sub-title is "Dynpro Technologies4.1" — the rating is inside the
             same element, so it is cut rather than imported into the company field. */
          companyName: stripRating(textList(row, NAUKRI_COMPANY_SELECTORS)),
          location: locSpans[0]?.split(',')[0] || cityFromSlug(url),
          url,
          experienceText: textList(row, NAUKRI_EXP_SELECTORS) || (clean(row.textContent).match(/\b\d{1,2}\s*(?:-|to|—|–)\s*\d{0,2}\s*\+?\s*(?:yrs?|years?)\b/i) || [])[0],
          salaryText: textList(row, NAUKRI_SAL_SELECTORS),
          postedAt: parsePosted((`${foot} ${clean(row.textContent)}`.match(/\b\d+\s*(?:minute|hour|day|week|month)s?\s*ago\b|\bjust now\b|\btoday\b/i) || [])[0] || ''),
          skills: skillsFromCard.length ? skillsFromCard : (foot.match(/(?:key\s*)?skills\s*[:\-]\s*(.+$)/i) || [])[1]?.split(/[;|]/),
        },
        'naukri'
      )
    );
    if (out.length >= limit) break;
  }
  return out;
}

/** Detail-page variant, used when you are already reading one posting. */
export function scrapeNaukriDetail(document, location = {}) {
  const t = (s) => clean(document?.querySelector?.(s)?.textContent);
  const title = t('h1, .job-title, [data-testid="jobTitle"]');
  if (!title) return null;
  const id = (String(location.pathname || '').match(/(\d{6,})/) || [])[1] || '';
  return normalizeJob(
    {
      jobId: id,
      title,
      companyName: t('.company-name, .org-name, a[data-testid="companyName"]'),
      location: t('.job-location, .location') || cityFromSlug(location.href || ''),
      url: location.href?.split('?')[0] || null,
      description: t('.job-description, .description, [data-testid="jobDescription"]'),
      experienceText: t('.experience, .exp-sec'),
      salaryText: t('.salary, .ctc'),
      keywords: t('.skills, .key-skills'),
    },
    'naukri'
  );
}

/* LinkedIn detail scraping takes the page URL from the caller instead of reading a
   bare `location` global, so this module stays usable from Node and from tests. */

/** Anything a source returned, cleaned up for POST /api/jobs/import. */
export function pack(jobs, { appId = null, note = '' } = {}) {
  const list = (jobs || []).filter((j) => j && j.title && j.title !== 'Untitled role');
  return { count: list.length, appId, note, jobs: list, harvestedAt: new Date().toISOString() };
}
