/**
 * Job sources. Each adapter returns the SAME normalized shape:
 *   { extId, source, title, company, location, remote, url, description,
 *     salaryMin, salaryMax, salaryCurrency, postedAt, tags[], category }
 *
 * Adapters that need credentials are inert until you add them in Settings ->
 * Sources. `githubArchive` is credential-free so the app has live data
 * out of the box.
 */
import { normalize, parseDateLoose, extractSalary, truncate } from './text.mjs';

const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT_MS || 9000);

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'ApplyFlow/0.1 (+self-hosted job matcher)', accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url.split('/')[2]} → HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function base(job) {
  return {
    extId: job.id,
    source: job.source,
    title: normalize(job.title),
    company: normalize(job.company),
    location: normalize(job.location),
    remote: Boolean(job.remote),
    url: job.url,
    description: truncate(normalize(job.description || ''), 4200),
    requirements: Array.isArray(job.requirements) ? job.requirements : [],
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    salaryCurrency: job.salaryCurrency || null,
    postedAt: job.postedAt || null,
    tags: job.tags || [],
    category: job.category || null,
    contractType: job.contractType || null,
  };
}

/* ------------------------------ GitHub archive ----------------------------- */
/* The archived public GitHub Jobs dataset (~19k postings) is a free,
   key-less corpus. Great for demo + for testing the matcher honestly. */
async function githubArchive() {
  const raw = await getJson('https://api.github.com/repos/odmo/github-jobs/contents/jobs.json');
    const json = JSON.parse(Buffer.from(raw.content, raw.encoding || 'base64').toString('utf8'));
  const list = Array.isArray(json) ? json : json.jobs || [];
  return list
    .map((j) => {
      return base({
        id: `gh-${j.id ?? j.index ?? Math.random().toString(36).slice(2)}`,
        source: 'github_archive',
        title: j.title || j.name || 'Untitled role',
        company: j.company || j.org || 'Company withheld',
        location: j.location || 'Remote',
        remote: /remote|anywhere/i.test(j.location || ''),
        url: j.url || `https://github.com/about/careers`,
        description: [j.description, j.benefits, `Type: ${j.type || 'n/a'}. Role: ${j.role || 'n/a'}. Seniority: ${j.seniority || 'n/a'}. To apply: ${j.apply || 'n/a'}`].filter(Boolean).join('\n'),
        tags: [j.type, j.role, j.seniority, 'tech'].filter(Boolean),
        category: 'Engineering',
        postedAt: j.postdate ? parseDateLoose(j.postdate) : null,
      });
    })
    .filter((j) => j.url);
}

/* ---------------------------------- Adzuna -------------------------------- */
/* Free API key: https://developer.adzuna.com  (also covers indeed/careerbuilder/
   monster/ziprecruiter/rookieme/naukri syndication). */
async function adzuna(cfg) {
  const country = cfg.country || 'us';
  const q = encodeURIComponent(cfg.what || 'software engineer');
  const where = cfg.where ? `&where=${encodeURIComponent(cfg.where)}` : '';
  const results = Number(cfg.resultsPerPage || 50);
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${cfg.appId}&app_key=${cfg.appKey}&what=${q}${where}&results_per_page=${results}&content-type=application/json&max_days_old=${cfg.maxDaysOld || 21}`;
  const data = await getJson(url);
  return (data.results || []).map((r) => {
    const sal = r.salary_min ? Number(r.salary_min) : extractSalary(r.description)?.min ?? null;
    return base({
      id: `adz-${r.id}`,
      source: `adzuna_${country}`,
      title: r.title,
      company: r.company?.display_name,
      location: [r.location?.display_name].filter(Boolean).join(', '),
      remote: /remote/i.test(r.description || '') || Boolean(r.location?.is_remote),
      url: r.redirect_url,
      description: r.description,
      salaryMin: sal,
      salaryMax: r.salary_max ? Number(r.salary_max) : extractSalary(r.description)?.max ?? null,
      salaryCurrency: r.salary_currency || 'USD',
      postedAt: parseDateLoose(r.created),
      tags: [r.category?.tag].filter(Boolean),
      category: r.category?.label,
      contractType: r.contract_time,
    });
  });
}

/* ---------------------------------- Jooble -------------------------------- */
/* Free key: https://jooble.org/api/about  (aggregates company career pages). */
async function jooble(cfg) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`https://jooble.org/api/${cfg.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keywords: cfg.what || 'software engineer', location: cfg.where || '', radius: cfg.radius || 50 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`jooble → HTTP ${res.status}`);
    const data = await res.json();
    return (data.jobs || []).map((r) => {
      const sal = extractSalary(r.snippet || r.title);
      return base({
        id: `jb-${r.id}`,
        source: 'jooble',
        title: r.title,
        company: r.company,
        location: r.location,
        remote: /remote/i.test(`${r.title} ${r.location} ${r.snippet || ''}`),
        url: r.link,
        description: r.snippet,
        salaryMin: sal?.min ?? null,
        salaryMax: sal?.max ?? null,
        salaryCurrency: sal?.currency ?? null,
        postedAt: parseDateLoose(r.updated),
        category: r.source_updated_by ? 'Aggregated' : 'Aggregated',
        tags: ['jooble'],
      });
    });
  } finally {
    clearTimeout(t);
  }
}

/* ---------------------------- Greenhouse boards ---------------------------- */
/* Company career pages expose /boards/{slug}/jobs.json — free, real, current.
   Add board slugs in Settings (e.g. "airbnb", "stripe", "datadog"). */
async function greenhouse(cfg) {
  const boards = cfg.boards || [];
  const out = [];
  for (const slug of boards.slice(0, 12)) {
    try {
      const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
      for (const j of data.jobs || []) {
        const sal = (j.offices || [])[0]?.name || '';
        out.push(
          base({
            id: `gh_${slug}_${j.id}`,
            source: `greenhouse:${slug}`,
            title: j.title,
            company: j.company_name || slug,
            location: (j.location?.name || sal || '—').replace(/,.*$/, ''),
            remote: /remote|anywhere/i.test(j.location?.name || ''),
            url: j.absolute_url,
            description: (j.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
            postedAt: parseDateLoose(j.updated_at || j.first_published),
            tags: ['greenhouse', slug],
            category: 'Company ATS',
          })
        );
      }
    } catch {
      /* board not found → skip, keep other boards */
    }
  }
  return out;
}

/* ------------------------------- Lever postings ----------------------------- */
async function lever(cfg) {
  const out = [];
  for (const org of (cfg.companies || []).slice(0, 12)) {
    try {
      const data = await getJson(`https://api.lever.co/v0/postings/${org}?mode=json`);
      for (const j of data || []) {
        out.push(
          base({
            id: `lv_${org}_${j.id}`,
            source: `lever:${org}`,
            title: j.text,
            company: org,
            location: j.categories?.location || '—',
            remote: /remote|anywhere/i.test(j.categories?.location || ''),
            url: j.hostedUrl,
            description: (j.descriptionPlain || '').slice(0, 4000),
            requirements: (j.categories?.allContents || []).map((c) => c.text).filter(Boolean),
            postedAt: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : null,
            tags: [j.categories?.team, j.categories?.commitment].filter(Boolean),
            category: 'Company ATS',
            contractType: j.categories?.commitment,
          })
        );
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

/* ----------------------------------- demo ---------------------------------- */
async function demo() {
  const mod = await import('../data/demoJobs.mjs');
  return mod.default.map((j) => base({ ...j, source: 'demo' }));
}

export const SOURCES = {
  github_archive: { label: 'GitHub Jobs archive (no key)', needsKey: false, run: githubArchive },
  demo: { label: 'Bundled demo corpus', needsKey: false, run: demo },
  adzuna: { label: 'Adzuna (Indeed/CareerBuilder/ZipRecruiter syndication)', needsKey: true, run: adzuna },
  jooble: { label: 'Jooble (career-page aggregation)', needsKey: true, run: jooble },
  greenhouse: { label: 'Greenhouse ATS boards', needsKey: false, run: greenhouse },
  lever: { label: 'Lever ATS postings', needsKey: false, run: lever },
};

/**
 * Fan out across enabled sources, upsert into the job store, and report
 * per-source status so the UI can show what actually succeeded.
 */
export async function fetchAll(enabledSources, profile) {
  const results = [];
  const errors = [];
  for (const s of enabledSources) {
    const def = SOURCES[s.key];
    if (!def) {
      errors.push(`${s.key}: unknown source`);
      continue;
    }
    try {
      const jobs = await def.run({ ...s, profile });
      results.push(...jobs);
    } catch (e) {
      errors.push(`${s.key}: ${e.message}`);
    }
  }
  const map = new Map();
  for (const j of results) {
    const key = j.extId || `${j.source}|${j.title}|${j.company}`;
    map.set(key, { ...j, extId: key });
  }
  return { jobs: [...map.values()], errors, fetchedAt: new Date().toISOString() };
}
