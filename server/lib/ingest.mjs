/**
 * Job sources. Each adapter returns the SAME normalized shape:
 *   { extId, source, title, company, location, remote, url, description,
 *     salaryMin, salaryMax, salaryCurrency, postedAt, tags[], category }
 *
 * Adapters that need credentials are inert until you add them in Settings ->
 * Sources. `github_archive` is credential-free, so it is the default source on
 * a fresh install — and the only one that survives a network that blocks
 * everything but api.github.com.
 *
 * Settings keys and adapter keys do not arrive in the same shape: the default
 * settings file predates SOURCES and uses camelCase booleans plus two list
 * keys. resolveSourceConfigs() is the one place that reconciles them, so an
 * old install still fetches instead of erroring "unknown source" forever.
 */
import { normalize, parseDateLoose, extractSalary, truncate } from './text.mjs';
import { diagnoseTls } from './tlsdiag.mjs';

const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT_MS || 9000);

/**
 * A transport failure and an empty board look identical upstream ("no jobs"), so
 * every fetch here runs its error through this. Without it the user reads
 * "fetch failed" and assumes the source is quiet; with it they read ECONNRESET
 * and know their network (or a sandbox egress list) is the wall — and the way round it.
 */
export async function networkHint(url, e) {
  const host = (() => {
    try { return new URL(url).hostname; } catch { return String(url).split('/')[2] || String(url); }
  })();
  /* Node reports transport failures as `TypeError: fetch failed` with the real reason on
     e.cause.code, so the cause has to be consulted first — the message alone says nothing. */
  const code = String(e?.cause?.code || e?.code || e?.message || '');
  const tlsish = /CERT|SSL|TLS|UNABLE_TO_|SELF_SIGNED|UNKNOWN_CA|DEPTH_ZERO|ALTNAME|EXPIRED/i.test(code);
  if (!tlsish) {
    const transport =
      /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENETDOWN|ECONNRESET|ECONNABORTED|EPERM|EHOSTDOWN|network|getaddrinfo|ENOTFOUND/i.test(code)
        ? 'unreachable from this machine'
        : e?.name === 'AbortError' || /abort|timed out/i.test(code)
          ? `no answer within ${FETCH_TIMEOUT / 1000}s`
          : /fetch failed/i.test(code)
            ? 'request failed at the network layer'
            : null;
    // a real HTTP/parse error already carries its own explanation
    return transport ? new Error(`${host} → ${transport} (${code}).`) : e;
  }
  /* TLS. A code alone cannot tell a filtering proxy from a stale CA bundle, and the two
     need opposite fixes, so ask the peer for its certificate rather than guessing from
     the errno. An earlier version of this function asserted "a filtering/inspecting proxy
     answered for this host" on UNABLE_TO_VERIFY_LEAF_SIGNATURE alone — and a user whose
     node had a real Amazon-issued cert and no proxy went looking for a middlebox that did
     not exist. Never let the diagnostic become the failure: if the probe throws, say only
     what the code says. */
  let d = null;
  try {
    d = await diagnoseTls(host, e);
  } catch {
    d = null;
  }
  if (!d || d.kind === 'unknown') return new Error(`${host} → TLS verification failed (${code}). Run \`npm run doctor\` for the reason.`);
  if (d.kind === 'intercepted') {
    return new Error(`${host} → TLS intercepted: the certificate is issued by "${d.issuer}", not a public CA for this hostname.`);
  }
  if (d.kind === 'wrong-host') {
    return new Error(`${host} → TLS: certificate is for ${d.subject}, presented by this network for ${host}.`);
  }
  if (d.kind === 'self-signed') {
    return new Error(`${host} → TLS: the certificate is self-signed (${d.issuer}).`);
  }
  if (d.kind === 'not-trusted') {
    return new Error(`${host} → TLS: valid public certificate (issued by "${d.issuer}") that this Node does not trust (${d.error}) — a local trust problem, not a proxy. \`npm run doctor\` exports the system CA bundle.`);
  }
  return new Error(`${host} → TLS handshake never completed (${d.error || code}).`);
}

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'ApplyFlow/0.1 (+self-hosted job matcher)', accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url.split('/')[2]} → HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw await networkHint(url, e);
  } finally {
    clearTimeout(t);
  }
}

/** Text fetch for sites that answer HTML to a JSON-shaped client. */
async function getDoc(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: {
        /* A custom UA is what gets you a challenge page; a plain browser one with a
           sec-fetch set gets you the real markup. This is a read of a public search
           page on the user's behalf, so we identify honestly in Accept-Language and
           never send cookies, tokens or credentials of any kind. */
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-IN,en;q=0.9',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'none',
        ...headers,
      },
      signal: ctrl.signal,
    });
    const body = await res.text();
    if (res.status === 403 || res.status === 429 || /captcha|are you a human|access denied|request blocked/i.test(body.slice(0, 4000))) {
      throw new Error(`${url.split('/')[2]} → HTTP ${res.status} anti-bot challenge. The site refused an unattended request (this is normal and will change without notice). Use "Import jobs JSON" in Settings instead: open the search page in your browser, paste the page source or the network response into the box — 30 seconds, no scraping, and it goes through the same normalizer.`);
    }
    if (!res.ok) throw new Error(`${url.split('/')[2]} → HTTP ${res.status}`);
    return body;
  } catch (e) {
    /* The anti-bot branch above raised its own useful Error; networkHint only
       rewrites transport failures, so that message passes through untouched. */
    throw await networkHint(url, e);
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
/* The archived public GitHub Jobs dataset (~19k postings): a real corpus, free and
   key-less, though historical (the feed stopped in 2021) so treat it as backfill,
   not as today's market. It is the one source reachable from most restricted
   networks, because it only needs api.github.com. */
async function githubArchive() {
  let raw = null;
  try {
    raw = await getJson('https://api.github.com/repos/odmo/github-jobs/contents/jobs.json');
  } catch (e) {
    if (/HTTP 404/.test(String(e?.message || ''))) {
      throw new Error(
        'github_archive: the corpus this reads (github.com/odmo/github-jobs) is no longer published — 404 from a working network. ' +
        'It is off by default for that reason; re-point this URL at a live dump, or use a key-less board instead ' +
        '(Settings → Job sources → Greenhouse, add slugs like gitlab, datadog, postman).'
      );
    }
    throw e;
  }
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
  if (!boards.length) throw new Error('greenhouse: no board slugs configured — add a few in Settings → Job sources (stripe, datadog, ramp, coinbase, postman…). Nothing was fetched.');
  const out = [];
  const unreachable = [];
  const skipped = [];
  for (const slug of boards.slice(0, 12)) {
    try {
      /* content=true: without it the board list returns stub content ("A description of
         the job is not available"), and the posting intelligence — salary text, years of
         experience, sponsorship lines — has nothing to read. The descriptions arrive as
         HTML and are stripped one line down, so this costs parsing, not accuracy. */
      const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
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
    } catch (e) {
      /* One 404 is a typo or a shut board — skip it and keep the others. A transport
         failure is not: silently returning [] there is how a blocked network gets
         reported to the user as "this source had no jobs". */
      /* A 4xx is a typo or a shut board: note it and keep the others. A transport
         failure is not — reporting that as an empty list is how a blocked network
         gets read as "this source has no jobs". */
      if (/HTTP 4\d\d/i.test(e.message)) skipped.push(`${slug} → HTTP ${e.message.match(/\d{3}/)?.[0] || '?'}`);
      else unreachable.push(`${slug}: ${e.message}`);
    }
  }
  if (!out.length && unreachable.length) throw new Error(`greenhouse: ${unreachable.length} of ${Math.min(boards.length, 12)} board(s) unreachable → ${unreachable.join(' | ').slice(0, 400)}`);
  if (skipped.length) console.log(`  greenhouse: skipped ${skipped.join(', ')}`);
  return out;
}

/* ------------------------------- Lever postings ----------------------------- */
async function lever(cfg) {
  const orgs = cfg.companies || [];
  if (!orgs.length) throw new Error('lever: no org slugs configured — add a few in Settings → Job sources (netflix, palantir, plaid…). Nothing was fetched.');
  const out = [];
  const unreachable = [];
  const skipped = [];
  for (const org of orgs.slice(0, 12)) {
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
    } catch (e) {
      if (/HTTP 4\d\d/i.test(e.message)) skipped.push(`${org} → HTTP ${e.message.match(/\d{3}/)?.[0] || '?'}`);
      else unreachable.push(`${org}: ${e.message}`);
    }
  }
  if (!out.length && unreachable.length) throw new Error(`lever: ${unreachable.length} of ${Math.min(orgs.length, 12)} org(s) unreachable → ${unreachable.join(' | ').slice(0, 400)}`);
  if (skipped.length) console.log(`  lever: skipped ${skipped.join(', ')}`);
  return out;
}

/* ---------------------------------- Naukri ---------------------------------- */
/* No public API exists for this — see https://parse.bot / vendor docs: what people
   call the "Naukri API" is their own internal search endpoint, undocumented and
   under active anti-bot work. We try their JSON endpoint first and the rendered
   page second, and we fail LOUDLY with the import fallback named, because a source
   that silently returns [] turns a matcher into "no jobs in Bengaluru" for a week. */
async function naukri(cfg) {
  const { normalizeNaukriPayload, parseNaukriHtml, naukriSearchUrl } = await import('./harvest.mjs');
  const pages = Number(cfg.pages || 1);
  const out = [];
  const problems = [];
  for (let page = 1; page <= Math.min(Math.max(1, pages), 5); page++) {
    const { url, jsonUrl } = naukriSearchUrl({
      keyword: cfg.what || (cfg.profile?.targets?.titleKeywords || [])[0] || 'software engineer',
      location: cfg.where || cfg.profile?.location?.city || '',
      page,
      experience: cfg.experience ?? cfg.profile?.targets?.experienceYears,
      salary: cfg.salary,
      freshness: cfg.freshness ?? cfg.jobAge,
      workMode: cfg.workMode,
    });
    let rows = [];
    try {
      rows = normalizeNaukriPayload(JSON.parse(await getDoc(jsonUrl, { accept: 'application/json' })));
    } catch (e) {
      problems.push(`json: ${e.message.split('\n')[0]}`);
      try {
        rows = parseNaukriHtml(await getDoc(url));
      } catch (e2) {
        problems.push(`html: ${e2.message.split('\n')[0]}`);
      }
    }
    if (!rows.length) problems.push(`page ${page}: 0 jobs`);
    out.push(...rows);
  }
  if (!out.length) throw new Error(`naukri: nothing parsed. ${problems.join(' | ')}`);
  return out.slice(0, Number(cfg.maxJobs || 120));
}

/**
 * Import for anything we cannot fetch programmatically — above all LinkedIn, whose
 * official Jobs API is partner OAuth only, so a self-hosted app can only ever read
 * the page the user is already viewing (see extension/lib/harvest.mjs).
 * Accepts a bare array or a { jobs } envelope, in LinkedIn/Naukri/vendor shapes or
 * our own normalized shape; every field is optional except a title and a url.
 */
export async function normalizeImport(input, sourceHint = 'imported') {
  const { normalizeJob, normalizeNaukriPayload } = await import('./harvest.mjs');
  const rows = Array.isArray(input) ? input : Array.isArray(input?.jobs) ? input.jobs : Array.isArray(input?.data?.jobDetails) ? null : [];
  if (!rows) return normalizeNaukriPayload(input); // a raw Naukri search response
  return rows
    .map((r) => normalizeJob(r, sourceHint || r?.source || 'imported'))
    .filter((j) => j.title && j.title !== 'Untitled role' && j.url);
}

/* There is deliberately no bundled/"demo" source here. A source that always
   succeeds offline is how a matcher looks healthy while showing you 16
   hand-written postings: the count is wrong, the salaries are fiction, and the
   letters cite employers that never existed. Every entry below hits a real
   endpoint or fails with a message that says so. Fixture data lives in
   scripts/fixtures/ and reaches the store only through the test-only seed route. */
export const SOURCES = {
  github_archive: { label: 'GitHub Jobs archive (no key)', needsKey: false, run: githubArchive },
  adzuna: { label: 'Adzuna (Indeed/CareerBuilder/ZipRecruiter syndication)', needsKey: true, run: adzuna },
  jooble: { label: 'Jooble (career-page aggregation)', needsKey: true, run: jooble },
  greenhouse: { label: 'Greenhouse ATS boards', needsKey: false, run: greenhouse },
  lever: { label: 'Lever ATS postings', needsKey: false, run: lever },
  naukri: {
    label: 'Naukri (unofficial — no public API, may be blocked; see Settings → Import jobs)',
    needsKey: false,
    run: naukri,
    volatile: true,
  },
};

/**
 * Fan out across enabled sources, upsert into the job store, and report
 * per-source status so the UI can show what actually succeeded.
 */
/* ------------------------ settings → adapter configs ------------------------ */

/* Credentials may live in the environment instead of the settings file. */
const ENV_DEFAULTS = {
  adzuna: () => ({ appId: process.env.ADZUNA_APP_ID, appKey: process.env.ADZUNA_APP_KEY, country: process.env.ADZUNA_COUNTRY || 'in' }),
  jooble: () => ({ apiKey: process.env.JOOBLE_API_KEY }),
};

/* The default settings file predates SOURCES: camelCase booleans, and board lists
   stored outside their adapter. Fold those into adapter keys before use, or a
   fresh install "succeeds" at enabling sources and then errors on every fetch. */
const RENAMED = { githubArchive: 'github_archive', github_archive_legacy: 'github_archive' };
const LISTS = { greenhouseBoards: ['greenhouse', 'boards'], leverCompanies: ['lever', 'companies'] };

/**
 * Turn `settings.sources` into the array fetchAll expects.
 * `dropped` exists so callers can say "this toggle points at no adapter"
 * instead of letting a typo surface as 'unknown source' forever.
 */
export function resolveSourceConfigs(settings = {}, profile = null) {
  const raw = settings.sources || {};
  const out = new Map();
  const dropped = [];
  const put = (key, cfg) => {
    if (!SOURCES[key]) return false;
    out.set(key, { ...(out.get(key) || {}), ...(cfg || {}) });
    return true;
  };

  for (const [k, v] of Object.entries(raw)) {
    if (!v) continue;
    if (LISTS[k]) {
      const [key, field] = LISTS[k];
      if (Array.isArray(v) && v.length) put(key, { [field]: v });
      continue;
    }
    const key = RENAMED[k] || k;
    if (!SOURCES[key]) {
      if (typeof v !== 'object' || v.enabled !== false) dropped.push(k);
      continue;
    }
    put(key, typeof v === 'object' ? v : {});
  }
  /* an adapter configured as {enabled:false} must not fetch */
  for (const [key, cfg] of [...out]) if (cfg.enabled === false) out.delete(key);

  const defaults = {
    adzuna: () => ({
      what: (profile?.targets?.titleKeywords || [])[0] || 'software engineer',
      where: profile?.locations?.[0] || 'India',
      resultsPerPage: 50,
    }),
  };
  const enabled = [...out].map(([key, cfg]) => ({
    key,
    source: key,
    ...(defaults[key]?.() || {}),
    ...(ENV_DEFAULTS[key]?.() || {}),
    ...cfg,
  }));
  return { enabled, dropped };
}


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
      /* Adapters already name themselves in their own errors; don't print
         "naukri: naukri: …" at the user. */
      errors.push(e.message.startsWith(`${s.key}:`) ? e.message : `${s.key}: ${e.message}`);
    }
  }
  const map = new Map();
  for (const j of results) {
    const key = j.extId || `${j.source}|${j.title}|${j.company}`;
    map.set(key, { ...j, extId: key });
  }
  return { jobs: [...map.values()], errors, fetchedAt: new Date().toISOString() };
}
