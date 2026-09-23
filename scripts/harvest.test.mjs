/**
 * Harvester tests — the read-only job collectors in server/lib/harvest.mjs.
 *
 * These exist because every bug this file guards against was silent: a salary
 * that parsed to null, a location that came out as "years", a company name
 * invented from a URL slug. In a matcher that feeds cover letters and form
 * prefill, silent garbage is much worse than a parse that fails loudly, because
 * it reaches a hiring manager. Each assertion below is a real failure I hit.
 *
 *   node scripts/harvest.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  clean,
  normalizeJob,
  parsePosted,
  naukriSearchUrl,
  normalizeNaukriPayload,
  parseNaukriHtml,
  cityFromSlug,
  scrapeLinkedIn,
  scrapeLinkedInDetail,
  scrapeNaukri,
  pack,
} from '../server/lib/harvest.mjs';

let passed = 0;
let failed = 0;
const ok = (cond, name, detail = '') => {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ''}`);
  }
};
const sal = (text) => {
  const j = normalizeJob({ salaryText: text, title: 'x', url: 'u' });
  return [j.salaryMin, j.salaryMax, j.salaryCurrency];
};
const doc = (html) => new JSDOM(html).window.document;

/* ---------------------------------- salaries --------------------------------- */
/* The scale cases matter more than the parse cases: 9 to 1,800,000 still looks
   like a number, and it goes into a salary box on a real application form. */
console.log('\n· salary shapes');
ok(JSON.stringify(sal('6-12 LPA')) === '[600000,1200000,null]', 'trailing LPA scales BOTH ends', JSON.stringify(sal('6-12 LPA')));
ok(JSON.stringify(sal('₹9 - ₹18 Lakhs p.a.')) === '[900000,1800000,"INR"]', '₹ … Lakhs p.a. with the unit stated once', JSON.stringify(sal('₹9 - ₹18 Lakhs p.a.')));
ok(JSON.stringify(sal('12-18 LPA')) === '[1200000,1800000,null]', '12-18 LPA', JSON.stringify(sal('12-18 LPA')));
ok(JSON.stringify(sal('$90k - $120k')) === '[90000,120000,"USD"]', '$90k - $120k', JSON.stringify(sal('$90k - $120k')));
ok(JSON.stringify(sal('1,200,000 - 1,800,000')) === '[1200000,1800000,null]', 'comma-grouped full amounts are not lakhs', JSON.stringify(sal('1,200,000 - 1,800,000')));
ok(sal('12 - 18')[0] === null, 'a bare range with no unit and no currency is REFUSED');
ok(sal('Not disclosed')[0] === null, 'no salary is null, not 0');
ok(sal('')[0] === null, 'empty text is null');
ok(normalizeJob({ salaryText: '6-12 LPA', title: 'x', url: 'u' }).salaryText === '6-12 LPA', 'the raw text is kept for display');
ok(normalizeJob({ salary: '₹18,00,000', title: 'x', url: 'u' }) !== null, 'lakh-style Indian grouping does not crash the parser');

/* ------------------------------- dates and meta ------------------------------ */
console.log('\n· posting age, experience, cleaning');
const ago = parsePosted('2 Days Ago');
ok(ago && Math.abs(Date.parse(ago) - (Date.now() - 2 * 864e5)) < 5 * 60e3, 'relative "2 Days Ago" resolves to a timestamp');
ok(parsePosted('Today') && new Date(parsePosted('Today')).getUTCDate() === new Date().getUTCDate(), '"Today" resolves to today');
ok(parsePosted('3 weeks ago') && Math.abs(Date.parse(parsePosted('3 weeks ago')) - (Date.now() - 21 * 864e5)) < 6e5, '"3 weeks ago" ≈ 21 days');
ok(parsePosted('2026-09-15') === '2026-09-15T00:00:00.000Z', 'ISO date read from <time> text, not only the attribute', String(parsePosted('2026-09-15')));
ok(parsePosted('no idea') === null, 'unparseable age is null');
const jn = normalizeJob({ title: '  Backend  Engineer ', url: ' https://x.com/jobs/1 ', experience: '2-5 Yrs', skills: ['Java', '', ' Spring Boot '], title2: null });
ok(jn.title === 'Backend Engineer', 'whitespace collapsed in the title');
ok(jn.tags.join(',') === 'Java,Spring Boot', 'skills trimmed, empties dropped', jn.tags.join(','));
ok(jn.minExperience === 2 && jn.maxExperience === 5, 'experience range parsed', `${jn.minExperience}-${jn.maxExperience}`);
ok(jn.experienceText === '2-5 Yrs', 'experience text preserved verbatim');
ok(clean(' | foo - ') === 'foo', 'leading/trailing separators trimmed');

/* --------------------------------- normalise -------------------------------- */
console.log('\n· normalizeJob contract');
ok(jn.extId === 'imported:x.com/jobs/1', 'missing id falls back to the protocol-stripped url', jn.extId);
ok(normalizeJob({ title: 'A', url: 'https://naukri.com/job-listings-x-44120998' }, 'naukri').extId === 'naukri:44120998', 'long numeric id pulled out of a Naukri-style url');
/* Documented limits of the url-derived id, so nobody "fixes" them by loosening the
   matcher: a slug with no TRAILING digit run gets the whole url as its key, and a
   number in the middle of a slug is never treated as an id. Both are deliberate —
   a wrong-but-plausible id silently merges or splits jobs, a long url does neither.
   Real scrapers never hit these paths: they pass the job id they read from the DOM. */
ok(normalizeJob({ title: 'A', url: 'https://x.com/jobs/view/3882211004-view/' }, 'linkedin').extId === 'linkedin:x.com/jobs/view/3882211004-view', 'trailing "-view" slug → url is the key (scrapers pass the real id)', normalizeJob({ title: 'A', url: 'https://x.com/jobs/view/3882211004-view/' }, 'linkedin').extId);
ok(normalizeJob({ title: 'A', url: 'https://x.com/jobs/view/1234567890-senior-backend-engineer/' }, 'linkedin').extId === 'linkedin:x.com/jobs/view/1234567890-senior-backend-engineer', 'a mid-slug number is NOT treated as an id', normalizeJob({ title: 'A', url: 'https://x.com/jobs/view/1234567890-senior-backend-engineer/' }, 'linkedin').extId);
ok(normalizeJob({ title: 'A', url: 'https://www.linkedin.com/jobs/view/4123456789/' }).url === normalizeJob({ title: 'A', url: 'https://www.linkedin.com/jobs/view/4123456789' }).url, 'trailing slash does not create a second copy of the same job');
ok(normalizeJob({ title: 'A', url: 'https://x.com/jobs/view/1234567890?trk=recent&seg=abc#detail' }, 'linkedin').url === 'https://x.com/jobs/view/1234567890', 'query AND fragment dropped');
ok(normalizeJob({ url: 'x' }).company === 'Company withheld', 'no company never means a blank or a guess', normalizeJob({ url: 'x' }).company);
ok(normalizeJob({ url: 'x' }).title === 'Untitled role', 'no title is marked, not dropped silently');
ok(normalizeJob({ title: 'x', url: 'u', location: 'Bengaluru', workMode: 'Remote' }).remote === true, 'workMode=Remote sets remote even when the city is set');
ok(normalizeJob({ title: 'x', url: 'u', description: 'd'.repeat(9000) }).description.length === 4200, 'description capped so one bad scrape cannot bloat the db');

/* ------------------------------ naukri url shape ----------------------------- */
console.log('\n· naukri search urls');
const u = naukriSearchUrl({ keyword: 'java spring', location: 'Bangalore', page: 2, experience: 2, freshness: 7 });
ok(/naukri\.com\/java-spring-jobs-in-bangalore-2\?/.test(u.url), 'slug encodes keyword, city and page', u.url);
/* Assert on the parsed params, not the raw string: URLSearchParams percent-encodes
   the comma in k=java,spring, so a test that hand-encodes is a test that fails for
   the wrong reason. */
const qs = new URLSearchParams(u.url.split('?')[1]);
ok(qs.get('k') === 'java,spring' && qs.get('location') === 'Bangalore', 'query carries k + location', qs.toString());
ok(/[?&]exp=2/.test(u.url) && /[?&]f=7/.test(u.url), 'experience and freshness passed through');
ok(u.jsonUrl.startsWith('https://www.naukri.com/api/search-jobs?') && /page=2/.test(u.jsonUrl), 'json endpoint + page param', u.jsonUrl.slice(0, 60));
ok(naukriSearchUrl().url.includes('software-engineer-jobs'), 'defaults to a software search, not an empty slug');

/* ------------------------------ naukri json shape ---------------------------- */
console.log('\n· naukri embedded payload');
const payload = {
  data: {
    jobDetails: [
      {
        jobId: 100626018934,
        title: 'Backend Developer',
        companyName: 'Dynpro Technology',
        location: 'Bengaluru',
        experience: '2-5 Yrs',
        salary: '6-12 LPA',
        skills: ['Java', 'Spring Boot'],
        description: 'Build APIs.',
        serpActionUrl: '/job-listings-java-jobs-in-bengaluru-100626018934?segmentId=abc',
      },
      { jobId: 100626018935, title: 'SRE', companyName: 'Zeta', location: 'Pune', salary: '₹30 - ₹45 Lakhs p.a.' },
    ],
  },
};
const fromJson = normalizeNaukriPayload(payload);
ok(fromJson.length === 2, 'both rows normalised', String(fromJson.length));
ok(fromJson[0].extId === 'naukri:100626018934', 'numeric jobId kept as the dedupe key', fromJson[0].extId);
ok(fromJson[0].url === 'https://www.naukri.com/job-listings-java-jobs-in-bengaluru-100626018934', 'relative serpActionUrl absolutised and query-stripped', fromJson[0].url);
ok(fromJson[0].salaryMin === 600000 && fromJson[0].salaryMax === 1200000, 'salary from the JSON field', `${fromJson[0].salaryMin}-${fromJson[0].salaryMax}`);
ok(fromJson[1].salaryMin === 3000000 && fromJson[1].salaryMax === 4500000, '₹30 - ₹45 Lakhs scaled to 30-45L', `${fromJson[1].salaryMin}-${fromJson[1].salaryMax}`);
ok(JSON.stringify(normalizeNaukriPayload(null)) === '[]' && normalizeNaukriPayload({}).length === 0, 'junk payload → empty array, no throw');

/* ------------------------------- naukri html -------------------------------- */
console.log('\n· naukri server-rendered html');
const embedded = `<!doctype html><html><body><script>window.__NUK__={"data":{"jobDetails":[{"jobId":44120998,"title":"Senior Java Engineer","companyName":"Acme Tech","location":"Bengaluru","salary":"12-18 LPA","skills":["Java","Spring"]}]}};</script></body></html>`;
const emb = parseNaukriHtml(embedded);
ok(emb.length === 1 && emb[0].company === 'Acme Tech', 'embedded result JSON is the primary path', `${emb.length} job(s), company=${emb[0].company}`);
ok(emb[0].salaryMin === 1200000, 'salary survives the embedded path');

/* The markup path must NOT invent fields. This fixture is Naukri's real nesting:
   the anchor contains the title AND the meta row, and the meta row concatenates
   salary and experience with no separator ("6-12 LPA2-5 Yrs"). */
const markup = `<!doctype html><html><body>
<div class="srp-jobtuple-wrapper" data-job-id="44120998">
  <a class="title" href="/job-listings-java-backend-engineer-dynpro-technologies-bengaluru-2-to-5-years-44120998?src=SearchResult">Java Backend Engineer</a>
  <div class="sub-title"><span class="company-name">Dynpro Technologies</span><span class="rating">4.1</span></div>
  <div class="footer">
    <span class="experience">2-5 Yrs</span>
    <span class="salary">6-12 LPA</span>
    <span class="location">Bengaluru</span>
  </div>
  <ul class="job-keyword-list"><li>Java</li><li>Spring Boot</li><li>MySQL</li><li>Redis</li></ul>
  <span class="footer-hr3">Posted 2 days ago</span>
</div>
</body></html>`;
const mr = doc(markup);
const viaDom = scrapeNaukri(mr, { href: 'https://www.naukri.com/java-backend-engineer-jobs-in-bengaluru' });
ok(viaDom.length === 1, 'one job from one card', String(viaDom.length));
ok(viaDom[0].title === 'Java Backend Engineer', 'title is the title element only — not the concatenated card', viaDom[0].title);
ok(!/LPA|Yrs/.test(viaDom[0].title), 'no salary/experience leakage into the title');
ok(viaDom[0].company === 'Dynpro Technologies', 'company read from its own element', viaDom[0].company);
ok(viaDom[0].salaryMin === 600000 && viaDom[0].salaryMax === 1200000, 'salary read from its own element, not the row', `${viaDom[0].salaryMin}-${viaDom[0].salaryMax}`);
ok(viaDom[0].experienceText === '2-5 Yrs', 'and experience read from its own element', viaDom[0].experienceText);
ok(viaDom[0].location === 'Bengaluru', 'location kept clean — never "years"', viaDom[0].location);
ok(viaDom[0].tags.length === 4 && viaDom[0].tags[0] === 'Java', 'skill list read from the card', viaDom[0].tags.join(','));
ok(viaDom[0].postedAt && new Date(viaDom[0].postedAt).getUTCFullYear() === new Date().getUTCFullYear(), 'posted 2 days ago resolved relative to now');
ok(viaDom[0].url === 'https://www.naukri.com/job-listings-java-backend-engineer-dynpro-technologies-bengaluru-2-to-5-years-44120998', 'query string stripped from the job url', viaDom[0].url);
ok(normalizeJob({ title: 'x', url: 'https://naukri.com/job-listings-a-b-44120998?src=SearchResult' }).url === 'https://naukri.com/job-listings-a-b-44120998', 'tracking params dropped for any importer, not just the scraper');
ok(parseNaukriHtml(markup).every((j) => j.url.includes('44120998')), 'markup-only scan still finds the job by id');
const hyd = 'https://www.naukri.com/job-listings-x-acme-tech-hyderabad-2-to-5-years-9';
ok(cityFromSlug(hyd) === 'Hyderabad', 'city read from the slug against the fixed list', cityFromSlug(hyd));
ok(cityFromSlug('https://www.naukri.com/job-listings-x-acme-tech-somecity-9') === '', 'unknown city → empty, never a token guess', JSON.stringify(cityFromSlug('https://www.naukri.com/job-listings-x-acme-tech-somecity-9')));
ok(parseNaukriHtml(markup).length >= 1 && parseNaukriHtml(markup)[0].company === 'Company withheld', 'markup path never guesses a company from the slug', parseNaukriHtml(markup)[0].company);
ok(cityFromSlug('https://www.naukri.com/job-listings-x-acme-tech-somecity-9') === '', 'unknown city → empty, never a token guess', JSON.stringify(cityFromSlug('https://www.naukri.com/job-listings-x-acme-tech-somecity-9')));

/* ------------------------------- linkedin cards ------------------------------ */
console.log('\n· linkedin cards (read-only, user session)');
const liCards = `<!doctype html><html><body><ul>
<li class="job-search-card" data-occludable-job-id="4123456789">
  <h3 class="base-search-card__title">Senior Backend Engineer</h3>
  <h4 class="base-search-card__subtitle"><a class="hidden-nested-link" href="/company/1">Zerodha</a></h4>
  <div class="job-search-card__list-metadata"><span>Bengaluru, Karnataka, India</span><time datetime="2026-09-15">3 days ago</time></div>
  <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/4123456789-some-java-role/?refId=x&trk=search">view</a>
</li>
<li class="job-search-card" data-occludable-job-id="4987654321">
  <h3 class="base-search-card__title">Full Stack Developer</h3>
  <h4 class="base-search-card__subtitle"><a class="hidden-nested-link" href="/company/2">Razorpay</a></h4>
  <div class="job-search-card__list-metadata"><span>Remote</span></div>
  <a class="base-card__full-link" href="/jobs/view/4987654321/?position=2">view</a>
</li>
<li class="job-search-card" data-occludable-job-id="4123456789">
  <h3 class="base-search-card__title">Senior Backend Engineer</h3>
  <h4 class="base-search-card__subtitle"><a href="/company/1">Zerodha</a></h4>
</li>
</ul></body></html>`;
const li = scrapeLinkedIn(doc(liCards));
ok(li.length === 2, 'duplicate card for the same posting deduped by job id', String(li.length));
ok(li[0].title === 'Senior Backend Engineer' && li[0].company === 'Zerodha', 'title and company from the card', `${li[0].title} @ ${li[0].company}`);
ok(li[0].extId === 'linkedin:4123456789', 'id comes from data-occludable-job-id', li[0].extId);
ok(li[0].location === 'Bengaluru, Karnataka, India', 'location from the metadata line', li[0].location);
ok(li[0].remote === false && li[1].remote === true, '"Remote" sets remote, a city does not', `${li[0].remote}/${li[1].remote}`);
ok(li[0].postedAt === '2026-09-15T00:00:00.000Z', 'time[datetime] used when present', String(li[0].postedAt));
ok(li[1].url === 'https://www.linkedin.com/jobs/view/4987654321', 'relative link absolutised, query + trailing slash stripped', li[1].url);
ok(scrapeLinkedIn(doc('<html></html>')).length === 0, 'an empty page yields zero jobs, not an error');
/* Parsed without a base URI, the .href property is "about:blank/…". Both scrapers
   must fall back to the href ATTRIBUTE, or every imported job points at nothing. */
const relLi = scrapeLinkedIn(doc(`<html><body><ul>
  <li class="job-search-card" data-occludable-job-id="4123456789">
    <h3 class="base-search-card__title">Backend Engineer</h3>
    <a class="base-card__full-link" href="/jobs/view/4123456789/?trk=x">view</a>
  </li></ul></body></html>`));
ok(relLi[0]?.url === 'https://www.linkedin.com/jobs/view/4123456789', 'relative href absolutised from the attribute, not about:blank', relLi[0]?.url);
ok(!/about:blank/.test(JSON.stringify(scrapeNaukri(doc(markup), {}))), 'naukri rows never carry about:blank', scrapeNaukri(doc(markup), {})[0]?.url);
ok(scrapeLinkedIn(null).length === 0, 'a missing document yields zero jobs');
const detail = scrapeLinkedInDetail(
  doc(`<html><body>
    <div class="topcard"><h1 class="topcard__title">Staff Backend Engineer</h1>
      <span class="topcard__flavor topcard__flavor--bullet"><a href="/company/1">Razorpay</a> · Bengaluru, India</span></div>
    <div class="show-more-less-html__markup">Own services end to end. Java, Spring Boot, Kafka. 8+ years.</div>
    <div class="description__job-criteria"><div class="description__job-criteria-item"><h3>Seniority level</h3></div><div class="description__job-criteria-item"><h3>Mid-Senior level</h3></div></div>
    <ul class="job-skill-classification-entry"><li><span class="job-skill-classification-entry__name">Kafka</span></li></ul>
  </body></html>`,),
  { pathname: '/jobs/view/3882211004-view/1', href: 'https://www.linkedin.com/jobs/view/3882211004/' }
);
ok(detail && detail.title === 'Staff Backend Engineer', 'detail page title parsed', detail && detail.title);
ok(detail.description.includes('Kafka'), 'detail page description captured for scoring', `${(detail.description || '').length} chars`);
ok(scrapeLinkedInDetail(doc('<html></html>'), { pathname: '/' }) === null, 'detail page without a title returns null instead of an empty job');

/* ---------------------------------- the pack --------------------------------- */
console.log('\n· import packing');
const p = pack([...li, { title: 'Untitled role', url: 'x' }, null]);
ok(p.count === 2, 'placeholder and null rows dropped from the pack', String(p.count));
ok(typeof p.harvestedAt === 'string' && p.jobs.every((j) => j.title && j.url), 'pack is shaped for POST /api/jobs/import');

/* ------------------------------- wiring checks ------------------------------ */
console.log('\n· wiring');
const root = process.cwd();
const contentJs = fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8');
ok(/harvest/.test(contentJs) && /harvestPush|jobs\/import/.test(contentJs), 'content script answers harvest and pushes to the import route');
const buildMjs = fs.readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8');
ok(/harvest\.mjs/.test(buildMjs), 'build copies harvest.mjs into the extension');
ok(fs.existsSync(path.join(root, 'extension/lib/harvest.mjs')), 'built extension bundle contains lib/harvest.mjs');
const ingestMjs = fs.readFileSync(path.join(root, 'server/lib/ingest.mjs'), 'utf8');
ok(/naukri/.test(ingestMjs) && /normalizeImport/.test(ingestMjs), 'ingest exposes the naukri source and the shared normaliser');
ok(/Settings → Import|Settings → Import/i.test(ingestMjs) || /Settings → Import/.test(ingestMjs), 'a failed naukri fetch names the fallback path in its error');
const indexMjs = fs.readFileSync(path.join(root, 'server/index.mjs'), 'utf8');
ok(indexMjs.includes("'/api/jobs/import'"), 'server exposes POST /api/jobs/import');
/* The risk is not /api/jobs/:id — a GET route cannot swallow a POST. It is the
   other POST routes on the same prefix, where registration order decides. */
const atImport = indexMjs.indexOf("'/api/jobs/import'");
const atClear = indexMjs.indexOf("'/api/jobs/clear'");
/* Two error-reporting rules, both learned the hard way today:
   1. Node hides the real reason for a failed fetch on e.cause.code ("fetch failed"
      is the whole message). A TLS-intercepting egress proxy answers with
      UNABLE_TO_VERIFY_LEAF_SIGNATURE, which matches none of the ECONN/ENOTFOUND family, so the
      first version of networkHint() still printed a useless "fetch failed".
   2. A bare `catch {}` around a per-board fetch turns "the network is blocked" into
      an empty list, which the app then reports as "this source had no jobs".
   Both are silent-failure classes, which is what this product can least afford. */
ok(/CERT\|SSL\|TLS\|UNABLE_TO_/.test(ingestMjs), 'networkHint recognises TLS-interception codes, not just ECONN*');
{
  const hintCode = ingestMjs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const idxCode = indexMjs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/await diagnoseTls\(host, e\)/.test(hintCode), 'networkHint asks the peer for its certificate before naming a cause');
  ok(!/sandbox or behind an egress allowlist/.test(hintCode),
    'networkHint states only host+reason: three boards used to print the same forty-word advice three times and bury what differed');
  const advice = (idxCode.match(/A blocked or filtered network looks exactly like a quiet board/g) || []).length;
  const pointer = (idxCode.match(/Settings → Import jobs/g) || []).length;
  ok(advice === 1 && pointer >= 1,
    `the advice survives exactly once, in the run summary built by index.mjs (advice=${advice}, pointer=${pointer})`);
  ok(/A blocked or filtered network looks exactly like a quiet board/.test(idxCode),
    'it is stated once instead, on the run summary');
}
ok(!/greenhouse: \$\{failed\.length\}/.test(ingestMjs), 'greenhouse distinguishes unreachable boards from empty ones');
ok(/no board slugs configured/.test(ingestMjs) && /no org slugs configured/.test(ingestMjs), 'ATS adapters say "not configured" instead of returning nothing');

ok(/boards\/\$\{slug\}\/jobs\?content=true/.test(ingestMjs),
  'the Greenhouse list call asks for content=true, so salary/experience/sponsorship text exists to parse');{
  const { SOURCES } = await import(path.join(root, 'server/lib/ingest.mjs'));
  const thrown = await SOURCES.greenhouse.run({}).then(() => null, (e) => e.message);
  ok(/no board slugs configured/.test(thrown || ''), 'unconfigured greenhouse throws rather than reporting 0 jobs', String(thrown).slice(0, 60));
  const unreachable = await SOURCES.lever.run({ companies: ['this-org-does-not-exist-applyflow-test'] }).then(() => null, (e) => e.message);
  ok(/unreachable|not published|HTTP/.test(unreachable || ''), 'a lever org that cannot be reached is an error, never an empty list', String(unreachable).slice(0, 70));
}

/* No demo corpus anywhere in the shipped product: the fixture file lives under
   scripts/, the seed route needs an env flag, and no view can call seed at all.
   These are cheap to assert and expensive to lose — a reintroduced "load demo"
   button is exactly the kind of regression that looks like a working install while
   showing invented employers, fake salaries and scores nothing should trust. */
ok(!fs.existsSync(path.join(root, 'server/data/demoJobs.mjs')), 'the bundled demo corpus is gone from server/');
ok(fs.existsSync(path.join(root, 'scripts/fixtures/jobFixtures.mjs')), 'fixture jobs now live under scripts/fixtures (test data, not product data)');
ok(indexMjs.includes("ALLOW_FIXTURE_SEED !== '1'"), 'seed route refuses to run outside tests');
ok(!/seed:\s*\(\)\s*=>/.test(fs.readFileSync(path.join(root, 'client/api.js'), 'utf8')), 'the client API no longer exposes a seed call');
for (const f of ['App.jsx', 'JobsTab.jsx', 'SettingsTab.jsx', 'ui.jsx']) {
  ok(!/api\.seed\(|demo corpus|demoJobs/i.test(fs.readFileSync(path.join(root, 'client', f), 'utf8')), `client/${f} has no demo-corpus affordance`);
}
ok(/RealtimeActions/.test(fs.readFileSync(path.join(root, 'client/ui.jsx'), 'utf8')), 'ui.jsx owns the single fetch-live control');
ok(indexMjs.includes('fetch-status'), 'the app can report when it last fetched and what failed');
ok(indexMjs.includes('FETCH_ON_BOOT'), 'boot-time fetching is wired and can be turned off');

/* resolveSourceConfigs: settings.sources is written by three different eras of
   this app — camelCase booleans in the shipped defaults, board lists parked in
   their own keys, and per-adapter objects from the Settings UI. Before this
   resolver existed, a FRESH install fetched the literal keys `githubArchive`,
   `greenhouseBoards` and `leverCompanies`, none of which is an adapter, so every
   fetch died with "unknown source" and the empty store looked like the user's
   fault. These cases are what keep that from coming back. */
{
  const { resolveSourceConfigs } = await import(path.join(root, 'server/lib/ingest.mjs'));
  const fresh = resolveSourceConfigs({ sources: { githubArchive: true, adzuna: false, jooble: false, greenhouseBoards: [], leverCompanies: [] } }, null);
  ok(JSON.stringify(fresh.enabled.map((e) => e.key)) === '["github_archive"]', 'shipped defaults resolve to a real adapter', JSON.stringify(fresh.enabled.map((e) => e.key)));
  ok(fresh.dropped.length === 0, 'a disabled toggle is not reported as a broken one');

  const lists = resolveSourceConfigs({ sources: { githubArchive: false, greenhouseBoards: ['stripe'], leverCompanies: ['netflix'] } }, null);
  ok(JSON.stringify(lists.enabled.map((e) => [e.key, e.boards || e.companies])) === '[["greenhouse",["stripe"]],["lever",["netflix"]]]', 'board lists fold into their adapter', JSON.stringify(lists.enabled));

  const profile = { targets: { titleKeywords: ['staff engineer'] }, locations: ['Bengaluru'] };
  const ui = resolveSourceConfigs({ sources: { greenhouse: { boards: ['ramp'] }, naukri: true, jooble: { apiKey: 'k' }, adzuna: {} } }, profile);
  const byKey = Object.fromEntries(ui.enabled.map((e) => [e.key, e]));
  ok(byKey.greenhouse.boards.join() === 'ramp' && byKey.jooble.apiKey === 'k' && byKey.naukri, 'ui-shaped config survives resolution', Object.keys(byKey).join(','));
  ok(byKey.adzuna.what === 'staff engineer' && byKey.adzuna.where === 'Bengaluru', 'profile fills an adzuna query the user never typed');

  ok(resolveSourceConfigs({ sources: { naukri: { enabled: false, query: 'x' } } }, null).enabled.length === 0, 'enabled:false inside a config object still means off');
  const typo = resolveSourceConfigs({ sources: { linkedin: true, greenhouse: true } }, null);
  ok(typo.enabled.map((e) => e.key).join() === 'greenhouse' && typo.dropped.join() === 'linkedin', 'an unknown toggle is named in `dropped` instead of erroring later');
  ok(resolveSourceConfigs({ sources: {} }, null).enabled.length === 0, 'no sources is an empty answer, not an error');
}

/* Three invariants bought with three real bugs today:
     - GET /api/jobs/fetch-status sat *after* GET /api/jobs/:id, so Express matched
       "fetch-status" as a job id and the UI's "when did we last fetch?" read a 404
       labelled 'job not found'.
     - /api/meta listed enabledSources straight from the settings file, which still
       uses camelCase keys; the UI offered to fetch `githubArchive` and the server
       answered 'unknown source'.
     - /api/meta hardcoded outboundNet: 'sandbox-limited' — a preview-sandbox fact
       served to every self-hosted user. A claim about the machine has to be measured. */
{
  // registration order, decided on the *trimmed* line — matching an indented
  // template against an already-trimmed string can only ever miss.
  const atRoute = (r) => indexMjs.split('\n').findIndex((l) => l.trim() === `'${r}',`);
  ok(atRoute('/api/jobs/fetch-status') < atRoute('/api/jobs/:id'), 'literal /api/jobs/* routes are registered before /api/jobs/:id', `fetch-status@${atRoute('/api/jobs/fetch-status')} vs :id@${atRoute('/api/jobs/:id')}`);
  const metaBlock = indexMjs.slice(indexMjs.indexOf("  '/api/meta',"), indexMjs.indexOf("  '/api/profile',"));
  ok(/enabledSources: resolved\.enabled\.map/.test(metaBlock), 'meta.enabledSources comes from the resolver, not raw settings keys');
  ok(/outboundNet: net\.out \? 'open' : 'blocked'/.test(metaBlock), 'the network claim is probed, not hardcoded');
  ok(/outboundNote: net\.note/.test(metaBlock), 'and the reason is shown, so "blocked" is actionable');
  // code, not comments: the comment above this field *explains* the old hardcoding,
  // and an assertion that greps for a phrase will happily find the explanation.
  const codeOnly = indexMjs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/sandbox-limited/.test(codeOnly), 'no sandbox-shaped assumption is baked into the API');
  const ing = fs.readFileSync(path.join(root, 'server/lib/ingest.mjs'), 'utf8');
  ok(/e\.message\.startsWith\(`\$\{s\.key\}:\`\)/.test(ing), 'adapter errors are not prefixed twice');
}

/* Import-time normalisation, asserted at the boundary rather than inside the scraper.
   `postedAt` is the field every caller writes, and normalizeJob used to trust it
   verbatim: an extension card saying "3 days ago" reached the store as prose, which
   `sort=posted` and the recency component read as "no date". A parse that returns null
   is honest; a stored string nothing can date-parse is the silent kind. */
{
  const card = (extra) => normalizeJob({ title: 'Staff Engineer', url: 'https://www.naukri.com/job-listings-x-44120998', ...extra }, 'naukri');
  ok(/^\d{4}-\d{2}-\d{2}T/.test(card({ postedAt: '3 days ago' }).postedAt || ''), 'a relative postedAt is normalised, not stored as prose', card({ postedAt: '3 days ago' }).postedAt);
  ok(card({ postedAt: 'yesterday-ish' }).postedAt === null, 'unparseable postedAt becomes null, never the raw string');
  ok(card({ postedAt: '2026-09-15' }).postedAt === '2026-09-15T00:00:00.000Z', 'a date-only postedAt is widened the same way the aliases are');
  const viaAlias = card({ postedDate: '3 days ago' }).postedAt;
  const viaField = card({ postedAt: '3 days ago' }).postedAt;
  ok(viaAlias.slice(0, 10) === viaField.slice(0, 10) && viaAlias.length > 10, 'the alias and the field agree on the day', `${viaAlias.slice(0, 10)} vs ${viaField.slice(0, 10)}`);
  const exp = card({ experience: '7-11 Years' });
  ok(exp.minExperience === 7 && exp.maxExperience === 11 && exp.experienceText === '7-11 Years', 'experience lands on the names the store and UI read', `${exp.minExperience}-${exp.maxExperience}`);
  const one = normalizeJob({ title: 'No Pay', url: 'https://boards.greenhouse.io/acme/jobs/1234567' }, 'greenhouse');
  ok(one.salaryMin === null && one.salaryCurrency === null && one.postedAt === null, 'a sparse card yields nulls, not invented zeros', JSON.stringify([one.salaryMin, one.salaryCurrency, one.postedAt]));
  const imported = await import('../server/lib/ingest.mjs').then((m) => m.normalizeImport);
  const rows = await imported([{ title: 'SRE', url: 'https://www.naukri.com/job-listings-sre-in-pune-44120999', experience: '5-8 Years', salary: '₹30 - ₹45 Lakhs p.a.', postedAt: '1 day ago' }], 'naukri');
  ok(rows.length === 1 && rows[0].salaryMin === 3000000 && /^\d{4}-\d{2}-\d{2}T/.test(rows[0].postedAt), 'normalizeImport runs the same normaliser as the scrapers', JSON.stringify({ pay: rows[0].salaryMin, posted: rows[0].postedAt, exp: rows[0].minExperience }));
}

/* Drafting used to answer 200 {drafted:0} when an id matched nothing — the exact
   response shape that looks like "nothing to do" while actually meaning "you asked
   for a job that isn't here". With ids now derived from the source url (job_1f2e…),
   hand-written ids from the docs are a realistic way to hit it. */
ok(/const unknown = \[\];/.test(indexMjs) && /No job matched the id\(s\) you passed/.test(indexMjs), 'draft refuses loudly when no id matches, and names them');
ok(/unknown\.length \? \{ unknown \}/.test(indexMjs), 'partial misses are reported in the response, not swallowed');

const atSeed = indexMjs.indexOf("'/api/jobs/seed'");
ok(atImport > 0 && atImport < atClear && atImport < atSeed, 'import route registered before the other POST /api/jobs/* routes', `import@${atImport} clear@${atClear} seed@${atSeed}`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
