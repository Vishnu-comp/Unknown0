/**
 * Load a resume into ApplyFlow: parse it, build a profile from what the parser
 * found (plus anything you pass in), seed the demo corpus, and report how the
 * whole job store re-scores against you.
 *
 *   node scripts/load-resume.mjs                          # uses data/samples/sample-resume.txt
 *   node scripts/load-resume.mjs --resume=my-resume.pdf   # PDF/DOCX/TXT, parsed the same way the app parses it
 *   node scripts/load-resume.mjs --base=http://127.0.0.1:3000 --seed
 *
 * Nothing here is magic: it calls the same endpoints the UI calls
 * (POST /api/resume, PUT /api/profile, POST /api/jobs/seed, GET /api/jobs),
 * so anything it prints you can also see and edit in the browser.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);
const BASE = args.base || process.env.APPLYFLOW_URL || 'http://127.0.0.1:3000';
const RESUME = args.resume || path.join('data', 'samples', 'sample-resume.txt');

const { parseResume, extractText, suggestProfilePatch } = await import('../server/lib/resume.mjs');

const buf = fs.readFileSync(RESUME);
const ext = path.extname(RESUME).slice(1).toLowerCase();
const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[ext] || 'text/plain';
const text = ext === 'txt' || ext === 'md' ? buf.toString('utf8') : await extractText(buf, mime, RESUME);
const parsed = parseResume(text);

if (!parsed.name) console.log('· note: no name line detected — set fullName on the Profile tab');

/* Start from what the parser can defend, then add only what it cannot know. */
const fromResume = suggestProfilePatch(parsed, {}).patch;
const profile = {
  ...fromResume,
  primaryField: args.field || 'software_engineering',
  location: parsed.locationGuess || { city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  remotePreference: args.remote || 'hybrid',
  openToRelocate: true,
  needSponsorship: false,
  willingToSponsor: false,
  workAuth: ['India'],
  yearsExperience: parsed.yearsOfExperience || null,
  noticePeriodDays: args.notice ? Number(args.notice) : 15,
  targets: {
    fields: [args.field || 'software_engineering'],
    titleKeywords: ['software engineer', 'sde', 'full stack', 'backend', 'java', 'react'],
    excludeKeywords: ['sales', 'recruiter', 'hr', 'bpo', 'call center', 'unpaid', 'content writer'],
    minSalary: args.floor ? Number(String(args.floor).replace(/[^\d]/g, '')) : null,
    salaryCurrency: 'INR',
    seniority: ['junior', 'mid'],
    jobTypes: ['full_time'],
    locations: ['Bengaluru', 'Hyderabad', 'Pune', 'Remote (India)', 'Remote (Worldwide)'],
    minYearsExperience: parsed.yearsOfExperience || 1,
    maxApplicationsPerDay: 10,
    companiesTarget: ['product', 'startup-series-b+'],
    companiesAvoid: ['staffing', 'IT services MNC', 'BPO'],
  },
  boolAnswers: {
    authorizedToWork: true,
    requireSponsorship: false,
    legallyAge18: true,
    willingToRelocate: true,
    consentBackgroundCheck: true,
    consentDataProcessing: true,
    maxNoticePeriodWeeks: Math.ceil((args.notice ? Number(args.notice) : 15) / 7),
  },
  freeTextAnswers: {
    noticePeriod: args.notice ? `${args.notice} days` : '15 days',
    howDidYouHear: 'ApplyFlow job matching',
    areYouLegallyAble: 'Yes',
    requireVisaSponsorshipNowOrFuture: 'No',
    linkedinOrPortfolio: [parsed.contact.linkedin, parsed.contact.github, parsed.contact.website].filter(Boolean).join(' | '),
    // deliberately empty until you set a number — a made-up expectation answers a
    // real form with a real lie, and the score would quietly follow it.
    salaryExpectation: args.floor ? `₹${(Number(String(args.floor).replace(/[^\d]/g, '')) / 100000).toFixed(1)}L per annum, negotiable with benefits and ESOPs.` : '',
  },
};

const post = async (url, body) => {
  const res = await fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${data.error || 'failed'}`);
  return data;
};
const put = async (url, body) => {
  const res = await fetch(BASE + url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${data.error || 'failed'}`);
  return data;
};
const get = async (url) => {
  const res = await fetch(BASE + url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${data.error || 'failed'}`);
  return data;
};

console.log(`\nresume: ${RESUME}  (${parsed.words} words, ${ext})`);
console.log(`  roles found     ${parsed.experience.length}`);
console.log(`  bullets kept    ${parsed.experience.map((e) => `${e.company}:${e.bullets.length}`).join('  ') || '—'}`);
console.log(`  education       ${parsed.education.length}`);
console.log(`  skills          ${parsed.skills.length}  · quantified wins: ${parsed.wins.length}`);
console.log(`  contact         ${[parsed.contact.email, parsed.contact.phone, parsed.contact.linkedin, parsed.contact.github].filter(Boolean).join(' · ')}`);

/* upload the document so the app can attach it to applications */
const upload = await post('/api/resume', { text, applySuggestions: false });
console.log(`\nuploaded to /api/resume → ${((upload.resume?.text || text).length) | 0} chars stored, ${upload.resume?.storedPath ? 'file kept' : 'text only'}`);

const saved = await put('/api/profile', profile);
const c = saved.completeness;
console.log(`profile saved · completeness ${c.percent}%`);
const missing = (c.items || []).filter((i) => !i.value).map((i) => i.label);
if (missing.length) console.log(`  still open: ${missing.join(', ')}`);

{
  const seed = await post('/api/jobs/seed');
  const stored = await get('/api/jobs');
  console.log(`\njob store: ${stored.count ?? (stored.jobs || []).length} postings (seed added ${seed.added ?? seed.inserted ?? '?'})`);
}

const jobs = await get('/api/jobs?sort=score');
const rows = (jobs.jobs || []).map((j) => ({
  score: j.match.score,
  grade: j.match.grade,
  company: j.company,
  title: j.title,
  skills: (j.match.matchedSkills || []).slice(0, 5).join(','),
  flags: (j.match.flags || []).join(' / '),
}));
console.log('\nranked against your actual profile:');
for (const r of rows.slice(0, 12)) {
  console.log(`  ${String(r.score).padStart(3)} ${r.grade.padEnd(2)} ${r.company.slice(0, 20).padEnd(20)} ${r.title.slice(0, 44)}`);
  if (r.skills) console.log(`        ✓ ${r.skills}`);
  if (r.flags) console.log(`        ⚠ ${r.flags}`);
}
const intel = rows.length ? await get(`/api/jobs/${(jobs.jobs || [])[0].id}/research`) : null;
if (intel) {
  console.log('\ntop posting, what it reveals:');
  for (const i of intel.research.insights) console.log(`  · ${i.label}: ${i.value}`);
  console.log(`  coverage ${intel.research.coverage} · verdict ${intel.research.verdict} · matcher ${intel.match.baseScore} → ${intel.match.score}`);
}
console.log(`\nopen the app → ${BASE.replace('127.0.0.1', 'localhost')}\n`);
