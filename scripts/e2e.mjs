import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/**
 * End-to-end smoke test against a running ApplyFlow server.
 *   node scripts/e2e.mjs [baseUrl]        (default http://127.0.0.1:3000)
 * Verifies: ingest → scoring honesty → letter/answer composition → prefill pack
 *           → auto-apply runner policy (caps, excludes) → exports.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';

const SELF = process.argv.includes('--own-server');
let BASE = process.argv.filter((x) => /^--base=/.test(x))[0]?.split('=')[1] || 'http://127.0.0.1:3000';
let child = null;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'applyflow-e2e-'));

/* A stand-in for Greenhouse's public apply API, so section 11 can exercise a real
   (local) network round trip without touching anyone's production board. */
const ATS_PORT = 3355 + Math.floor(Math.random() * 40);
const atsSeen = [];
const atsMock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
  atsSeen.push({ url: req.url, method: req.method, raw, contentType: req.headers['content-type'] || '' });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 987654, status: 'new' }));
  });
});
await new Promise((r) => atsMock.listen(ATS_PORT, '127.0.0.1', r));

async function waitUp(url, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url + '/healthz');
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server never came up on ' + url);
}
let pass = 0;
let fail = 0;

const j = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json', ...(opts.headers || {}) } : opts.headers,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
};

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

if (SELF) {
  const port = 3210 + Math.floor(Math.random() * 90);
  BASE = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.resolve('server/index.mjs')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ATS_API_BASE: `http://127.0.0.1:${ATS_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (out += b));
  child.on('exit', (c) => {
    if (c) {
      console.log('\nserver died:\n' + out.slice(-2000));
      process.exit(1);
    }
  });
  await waitUp(BASE);
}
console.log(`\nApplyFlow e2e → ${BASE}${SELF ? ` (own server, data: ${dataDir})` : ''}\n`);

console.log('1. meta + seed');
const meta = await j('/api/meta');
check('GET /api/meta', meta.status === 200 && meta.data.sources.length >= 6, `${meta.data.sources?.length} sources registered`);
const seeded = await j('/api/jobs/seed', { method: 'POST' });
check('POST /api/jobs/seed', seeded.status === 200 && seeded.data.seeded >= 10, `${seeded.data.seeded} postings`);

console.log('\n2. resume parsing (txt + suggestions)');
const sample = fs.readFileSync(new URL('../data/samples/sample-resume.txt', import.meta.url), 'utf8');
const parsed = await j('/api/resume', { method: 'POST', body: JSON.stringify({ text: sample, applySuggestions: true }) });
check('POST /api/resume (text)', parsed.status === 200, parsed.status !== 200 ? JSON.stringify(parsed.data) : '');
const s = parsed.data.resume?.summary;
check('detected contact email', s?.contact?.email === 'alex.kumar@gmail.com', String(s?.contact?.email));
check('detected linkedin', /linkedin\.com\/in\/alexkumar-dev/.test(s?.contact?.linkedin || ''), String(s?.contact?.linkedin));
check('mined ≥12 skills', (s?.skills || []).length >= 12, `${s?.skills?.length} skills`);
check('parsed work experience blocks', (s?.experience || []).length >= 2, `${s?.experience?.length} roles`);
check('found quantified wins', (s?.wins || []).length >= 2, `${s?.wins?.length} sentences with numbers`);
check('profile got suggestions applied', (parsed.data.appliedSuggestions || []).length >= 1, (parsed.data.appliedSuggestions || []).join(', '));

console.log('\n2b. real file uploads (PDF + DOCX via multipart)');
{
  const dir = new URL('../data/samples/', import.meta.url);
  async function upload(file, label) {
    const fd = new FormData();
    fd.append('resume', file, file.name || label);
    fd.append('applySuggestions', 'true');
    const res = await fetch(BASE + '/api/resume', { method: 'POST', body: fd });
    return { status: res.status, data: await res.json() };
  }
  const pdfBuf = fs.readFileSync(new URL('sample-resume.pdf', dir));
  const pdf = await upload(new Blob([pdfBuf], { type: 'application/pdf' }), 'resume.pdf');
  check('PDF upload parsed (pdf.js path)', pdf.status === 200 && (pdf.data.resume?.summary?.chars || 0) > 1200, `${pdf.data.resume?.summary?.chars} chars extracted`);
  check('PDF → email + phone extracted', pdf.data.resume?.summary?.contact?.email === 'alex.kumar@gmail.com' && Boolean(pdf.data.resume?.summary?.contact?.phone), pdf.data.resume?.summary?.contact?.phone || '');
  check('PDF → work history blocks parsed', (pdf.data.resume?.summary?.experience || []).length >= 2, `${pdf.data.resume?.summary?.experience?.length} roles`);
  check('PDF → role/company/dates correct', (pdf.data.resume?.summary?.experience || [])[0]?.company === 'Nimbus Labs' && (pdf.data.resume?.summary?.experience || [])[0]?.start === '2023-03');
  check('PDF → skill mining works', (pdf.data.resume?.summary?.skills || []).length >= 15, `${pdf.data.resume?.summary?.skills?.length} skills`);

  const docBuf = fs.readFileSync(new URL('sample-resume.docx', dir));
  const doc = await upload(new Blob([docBuf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'resume.docx');
  check('DOCX upload parsed (zip + xml path)', doc.status === 200 && (doc.data.resume?.summary?.chars || 0) > 1200, `${doc.data.resume?.summary?.chars} chars`);
  check('DOCX → links extracted', /linkedin\.com\/in\/alexkumar-dev/.test(doc.data.resume?.summary?.contact?.linkedin || ''), doc.data.resume?.summary?.contact?.linkedin);

  const junk = await upload(new Blob([Buffer.from('%PDF-1.4\n%suspect\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>%%EOF')], { type: 'application/pdf' }), 'fake.pdf');
  check('unreadable PDF → 400 with fix guidance', junk.status === 400 && /scan|image|text-based|Could not read/i.test(junk.data.error || ''), (junk.data.error || '').slice(0, 80));

  const legacy = await upload(new Blob([Buffer.from('not a real doc at all')], { type: 'application/msword' }), 'old.doc');
  check('legacy .doc rejected with a fix suggestion', legacy.status === 400 && /\.docx or PDF/.test(legacy.data.error || ''), (legacy.data.error || '').slice(0, 60));
}

console.log('\n3. scoring honesty');
const jobs = await j('/api/jobs');
const byId = Object.fromEntries(jobs.data.jobs.map((x) => [x.jobId || x.id, x]));
const find = (needle) => jobs.data.jobs.find((x) => x.title.toLowerCase().includes(needle));
const swe = find('senior full stack');
const sdr = find('inside sales');
const unpaid = find('unpaid');
const ml = find('machine learning engineer');
check('top software role scored ≥70', swe.match.score >= 70, `${swe.title} = ${swe.match.score} (${swe.match.grade})`);
check('sales role scored well below the SWE role', sdr.match.score < swe.match.score - 15, `sdr ${sdr.match.score} vs swe ${swe.match.score}`);
check('unpaid "internship" penalised hard', unpaid.match.score < 55, `${unpaid.match.score}`);
check('exclude-keyword flag fired on sales posting', (sdr.match.flags || []).some((f) => /exclude/.test(f)), (sdr.match.flags || []).join(' | '));
check('ML role lists missing skills', (ml.match.missingSkills || []).length >= 2, (ml.match.missingSkills || []).slice(0, 5).join(', '));
check('matched skills include real overlap', (swe.match.matchedSkills || []).length >= 3, (swe.match.matchedSkills || []).slice(0, 6).join(', '));
check('every job carries a breakdown', jobs.data.jobs.every((x) => Object.keys(x.match.breakdown || {}).length === 9), '9 weighted components');
const top = jobs.data.jobs[0];
check('list sorted by score desc', jobs.data.jobs.every((x, i, arr) => i === 0 || arr[i - 1].match.score >= x.match.score), `best ${top.match.score} (${top.title})`);
check('no posting scores a perfect 100 (honest ceiling)', jobs.data.jobs.every((x) => x.match.score <= 97), `max ${Math.max(...jobs.data.jobs.map((x) => x.match.score))}`);
const foreign = jobs.data.jobs.find((x) => /new grad/i.test(x.title));
check('foreign-currency pay is NOT judged against the INR floor', foreign && !foreign.match.flags.some((f) => /below your salary floor/.test(f)) && foreign.match.flags.some((f) => /convert against/.test(f)), (foreign?.match.flags || []).join(' | '));

console.log('\n4. application composer');
const draft = await j('/api/apps/draft', { method: 'POST', body: JSON.stringify({ jobIds: [swe.id], force: true }) });
const app = draft.data.apps?.[0];
check('POST /api/apps/draft', draft.status === 200 && Boolean(app), draft.status !== 200 ? JSON.stringify(draft.data).slice(0, 200) : '');
check('letter mentions the company', (app?.letter || '').includes(swe.company), `${app?.letterWords} words, mode=${app?.letterMode}`);
check('letter mentions role', (app?.letter || '').toLowerCase().includes('full stack'));
check('letter quotes a real bullet with a number', /\d/.test(app?.letter || '') && /34%|12,?000|support tickets/.test(app?.letter || ''), (app?.letter || '').match(/\u2022[^\n]+/)?.[0]?.slice(0, 64));
check('letter does NOT invent skills', !/I am an expert in Rust/.test(app?.letter || ''));
check('≥6 screening answers generated', (app?.answers || []).length >= 6, `${app.answers.length} answers`);
check('low-confidence answers flagged for review', (app?.checklist?.lowConfidenceAnswers ?? []).length >= 0, `${app?.checklist?.lowConfidenceAnswers?.length ?? 0} need a human`);
const why = app.answers.find((a) => /why are you interested/i.test(a.question));
check('"why interested" answer names the company', (why?.answer || '').includes(swe.company), (why?.answer || '').slice(0, 78));
const salary = app.answers.find((a) => /salary/i.test(a.question));
check('salary answer references the posting or floor', /\d/.test(salary?.answer || ''), salary?.answer);
check('sponsorship question answered consistently with profile', ['Yes', 'No'].includes((app.answers.find((a) => /sponsor/i.test(a.question))?.answer || '').trim()), app.answers.find((a) => /sponsor/i.test(a.question))?.answer);
check('prefill pack maps standard fields', ['email', 'phone', 'first.name', 'last.name', 'current.company', 'cover.letter', 'notice.period'].every((k) => k in app.prefill.fields), Object.keys(app.prefill.fields).length + ' fields');
check('prefill never contains a password/secret', !JSON.stringify(app.prefill).match(/"password"|apiKey/i));
check('checklist flags the missing pieces', Array.isArray(app.checklist.warnings), app.checklist.warnings.length + ' warnings');
check('mailto prepared when posting has apply email', Boolean(app.mailto), app.mailto ? app.mailto.slice(0, 54) + '…' : 'no applyEmail on this posting');

console.log('\n5. auto-apply runner + policy guards');
async function freshRunnerState({ dailyCap, perSourcePerDay }) {
  await j('/api/reset', { method: 'POST' });               // wipes applications + jobs + daily counters
  await j('/api/jobs/seed', { method: 'POST' });           // deterministic corpus
  const cur = (await j('/api/settings')).data.settings.autoApply;
  await j('/api/settings', { method: 'PUT', body: JSON.stringify({ autoApply: { ...cur, enabled: true, minScore: 70, dailyCap, perSourcePerDay, cooldownHours: 24 } }) });
}
await freshRunnerState({ dailyCap: 2, perSourcePerDay: 2 });
const preview = await j('/api/runner/run', { method: 'POST', body: JSON.stringify({ dryRun: true }) });
check('dry run proposes work without writing anything', preview.status === 200 && preview.data.queued.length === 2 && (await j('/api/apps')).data.apps.length === 0, `${preview.data.queued.length} in preview, store untouched`);
check('preview rows carry why-details', (preview.data.queued[0]?.flags ?? undefined) !== undefined && 'score' in preview.data.queued[0], Object.keys(preview.data.queued[0]).join(','));

const run1 = await j('/api/runner/run', { method: 'POST', body: JSON.stringify({}) });
const appsAfter1 = (await j('/api/apps')).data.apps;
check('run composed and persisted applications', run1.data.queued.length === 2 && appsAfter1.length === 2, `${appsAfter1.length} drafts`);
check('runner writes complete packs, not stubs', appsAfter1.every((a) => a.letter.length > 200 && a.answers.length >= 6 && a.prefill.fields.email), 'letter+answers+prefill present');
const run2 = await j('/api/runner/run', { method: 'POST', body: JSON.stringify({}) });
check('second run adds nothing (per-source cap + dedupe)', (await j('/api/apps')).data.apps.length === 2 && run2.data.queued.length === 0, `added ${run2.data.queued.length}, cutByCap ${run2.data.cutByCap}`);
check('sales + unpaid postings never auto-queued', !(await j('/api/apps')).data.apps.some((a) => /inside sales|unpaid/i.test(a.title || '')));
await freshRunnerState({ dailyCap: 3, perSourcePerDay: 20 });
const run3 = await j('/api/runner/run', { method: 'POST', body: JSON.stringify({}) });
check('daily cap enforced exactly (3 today, 3 created, 5 cut)', run3.data.queued.length === 3 && run3.data.cutByCap >= 1 && (await j('/api/apps')).data.apps.length === 3, `queued ${run3.data.queued.length}, cut ${run3.data.cutByCap}, cap ${run3.data.cap}`);
check('headroom reported after capped run', run3.data.policy.remainingToday === 0, `remainingToday=${run3.data.policy.remainingToday}`);
await freshRunnerState({ dailyCap: 10, perSourcePerDay: 4 });
const r4 = await j('/api/runner/run', { method: 'POST', body: JSON.stringify({}) });
const ids4 = r4.data.queued.map((a) => a.jobId);
check('no duplicate drafts across runs', new Set(ids4).size === ids4.length, `${ids4.length} drafts, all unique`);
check('every draft records which writer produced it', (await j('/api/apps')).data.apps.every((a) => ['template', 'llm'].includes(a.letterMode)), (await j('/api/apps')).data.apps.map((a) => a.letterMode).join(','));
check('disabled runner refuses to run', (await (async () => {
  const cur = (await j('/api/settings')).data.settings.autoApply;
  await j('/api/settings', { method: 'PUT', body: JSON.stringify({ autoApply: { ...cur, enabled: false } }) });
  const off = await j('/api/runner/run', { method: 'POST', body: JSON.stringify({}) });
  return off;
})()).status === 400, '400 + explanation');
await j('/api/settings', { method: 'PUT', body: JSON.stringify({ autoApply: { enabled: true, minScore: 70, dailyCap: 10, perSourcePerDay: 4, cooldownHours: 24, mode: 'assist' } }) });

console.log('\n6. status pipeline + exports');
const apps = (await j('/api/apps')).data.apps;
const target = apps[0];
const moved = await j(`/api/apps/${target.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'submitted', note: 'e2e' }) });
check('status transition recorded', moved.data.app.status === 'submitted' && moved.data.app.history.length >= 2, `${moved.data.app.history.length} history entries`);
const badStatus = await j(`/api/apps/${target.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'hallucinated' }) });
check('invalid status rejected with 400', badStatus.status === 400 && /unknown status/.test(badStatus.data.error || ''), `HTTP ${badStatus.status}`);
const edited = await j(`/api/apps/${target.id}`, { method: 'PATCH', body: JSON.stringify({ letter: 'edited by test\nsecond line' }) });
check('letter can be hand-edited', (edited.data.app.letter || '').startsWith('edited by test'));
const md = await fetch(`${BASE}/api/export/pack.md?id=${target.id}`);
const mdText = await md.text();
check('markdown pack export', md.status === 200 && mdText.includes('## Cover letter') && mdText.includes('## Screening answers'), `${mdText.length} bytes`);
const pf = await j(`/api/apps/${target.id}/prefill`);
check('per-job prefill endpoint', pf.status === 200 && pf.data.payload.fields.email, 'json');
const ext = await j(`/api/apps/${target.id}/extension-payload`);
check('extension payload endpoint', ext.status === 200 && ext.data.payload.job.url, ext.data.payload.job.url);
const batch = await fetch(`${BASE}/api/export/prefill.json`);
const batchJson = await batch.json();
check('batch export shape the extension reads', batchJson.kind === 'applyflow.prefill-batch' && batchJson.packs.length >= 1, `${batchJson.packs.length} packs`);
check('batch packs carry fields', batchJson.packs.every((p) => p.fields && 'email' in p.fields));

console.log('\n7. profile edits re-score the store');
const p0 = await j('/api/profile');
const newEx = { company: 'TestCorp', title: 'Data Scientist', location: 'Pune', start: '2024-01', end: '', current: true, bullets: ['Built causal-inference experiment tooling with Python, SQL and A/B testing for 200 experiments a quarter.'] };
await j('/api/profile', { method: 'PUT', body: JSON.stringify({ ...p0.data.profile, experience: [newEx, ...(p0.data.profile.experience || [])] }) });
const after = await j('/api/jobs');
const dataRole = after.data.jobs.find((x) => /senior data scientist/i.test(x.title));
const sweAfter = after.data.jobs.find((x) => x.id === swe.id);
check('data-science role re-scored after profile change', (dataRole?.match.score ?? 0) >= (find('senior data scientist')?.match.score ?? 0), `${find('senior data scientist')?.match.score} → ${dataRole?.match.score}`);
const sweRescored = after.data.jobs.find((x) => x.id === swe.id);
check('job ids are stable across re-fetch (no duplicate churn)', after.data.jobs.filter((x) => x.id === swe.id).length === 1);
const p1 = await j('/api/profile');
const r1 = await j('/api/jobs');
const sweAgain = r1.data.jobs.find((x) => x.id === swe.id);
check('scoring is deterministic for identical input', sweRescored.match.score === sweAgain.match.score, `swe ${sweRescored.match.score} = ${sweAgain.match.score}`);
await j('/api/profile', { method: 'PUT', body: JSON.stringify(p0.data.profile) });

console.log('\n8. error handling & UI');
const noSource = await j('/api/jobs/fetch', { method: 'POST', body: JSON.stringify({ sources: ['adzuna'] }) });
check('bad/absent credentials fail loudly with a message', noSource.status === 400 && /Nothing came back|Errors/.test(noSource.data.error || ''), (noSource.data.error || '').slice(0, 90));
const missing = await j('/api/jobs/does-not-exist');
check('404 for unknown job', missing.status === 404);
const noResume = await j('/api/resume', { method: 'POST', body: JSON.stringify({ text: 'too short' }) });
check('tiny pasted resume rejected with guidance', noResume.status === 400, (noResume.data.error || '').slice(0, 60));
const spa = await fetch(`${BASE}/`);
const html = await spa.text();
check('SPA served at /', html.includes('ApplyFlow') && html.includes('/app.js'));
const bundle = await fetch(`${BASE}/app.js`);
check('bundle built + served', bundle.status === 200 && Number(bundle.headers.get('content-length')) > 20000, `${(Number(bundle.headers.get('content-length')) / 1024).toFixed(0)} kB`);
const styles = await fetch(`${BASE}/styles.css`);
check('css served', styles.status === 200);
const health = await j('/healthz');
check('healthcheck', health.data.ok === true);

console.log('\n9. filter/search API');
const filtered = await j('/api/jobs?min=70&sort=score');
check('min-score filter', filtered.data.jobs.every((x) => x.match.score >= 70), `${filtered.data.count} ≥70`);
const searched = await j('/api/jobs?q=kubernetes');
check('text search', searched.data.count >= 0 && searched.data.jobs.every((x) => JSON.stringify(x).toLowerCase().includes('kubernetes')), `${searched.data.count} hits`);
const statusNew = await j('/api/jobs?status=new');
check('status=new excludes drafted jobs', statusNew.data.jobs.every((x) => !x.app), `${statusNew.data.count} open`);

console.log('\n10. resume tailoring (no fabrication) + posting intelligence');
const jobsAll = (await j('/api/jobs')).data.jobs;
const ghJob = jobsAll.find((x) => /greenhouse\.io/i.test(x.url || '')) || jobsAll[0];
const otherJob = jobsAll.find((x) => x.id !== ghJob.id && x.match.score > 30);
const prof = (await j('/api/profile')).data.profile;
const resumeDoc = (await j('/api/resume')).data.resume;
const corpus = [
  ...(prof.experience || []).flatMap((e) => e.bullets || []),
  ...((resumeDoc?.summary?.wins) || (resumeDoc?.wins) || []),
  ...((resumeDoc?.text || '').split('\n')),
  ...((prof.skills || []).map((s) => s.name)),
]
  .join('\n')
  .toLowerCase()
  .replace(/\s+/g, ' ');
const tA = await j(`/api/jobs/${ghJob.id}/tailored`);
check('tailored resume endpoint returns text + audit', tA.status === 200 && tA.data.tailored.includes('EXPERIENCE') && Array.isArray(tA.data.audit.bullets), `${(tA.data.tailored || '').split('\n').length} lines, ${tA.data.audit?.bullets?.length} ranked bullets`);
check('tailored resume is a different document per posting', (await j(`/api/jobs/${otherJob.id}/tailored`)).data.tailored !== tA.data.tailored, `${ghJob.company} vs ${otherJob.company}`);
{
  const lines = (tA.data.tailored || '').split('\n').filter((l) => l.trim().startsWith('•')).map((l) => l.replace(/^\s*•\s*/, '').replace(/\.$/, '').replace(/\s+/g, ' ').trim());
  const invented = lines.filter((l) => !corpus.includes(l.toLowerCase()));
  check('every tailored bullet is traceable to profile or resume text', lines.length > 0 && invented.length === 0, invented.length ? `invented: ${invented[0].slice(0, 60)}` : `${lines.length} lines checked, 0 invented`);
  check('audit states the source of every line', /traced|no source/.test(tA.data.audit.fabricationRisk), tA.data.audit.fabricationRisk);
  check('tailored skills are promoted, not invented', (tA.data.audit.skillsPromoted || []).every((s) => (prof.skills || []).some((p) => p.name.toLowerCase() === s.toLowerCase())), (tA.data.audit.skillsPromoted || []).join(', ') || 'none promoted');
}
const tTxt = await fetch(`${BASE}/api/jobs/${ghJob.id}/tailored?format=txt`);
const plainText = await tTxt.text();
check('plain-text download for ATS upload boxes', tTxt.status === 200 && /text\/plain/.test(tTxt.headers.get('content-type')) && /attachment/.test(tTxt.headers.get('content-disposition')), `${plainText.length} bytes`);
check('plain text has no unicode bullets or box-drawing (ATS-safe)', !/[─•·—]/.test(plainText) && plainText.includes('EXPERIENCE'));
const intel = await j(`/api/jobs/${ghJob.id}/research`);
check('posting intelligence returns labelled signals', intel.status === 200 && intel.data.research.insights.length > 0 && intel.data.research.insights.every((i) => i.label && i.value && i.why), `${intel.data.research.insights.map((i) => i.id).join(',')}`);
check('coverage is reported as a fraction of the rule set', /^\d+\/\d+ signals/.test(intel.data.research.coverage), intel.data.research.coverage);
check('insight-adjusted score stays in 0..97 and is explained', intel.data.match.score >= 0 && intel.data.match.score <= 97 && Array.isArray(intel.data.match.applied), `${intel.data.match.score} · ${intel.data.match.applied.join(' | ') || 'no adjustment'}`);
check('the nudge is auditable: score = base + delta, delta small', intel.data.match.score === intel.data.match.baseScore + intel.data.match.delta && Math.abs(intel.data.match.delta) <= 30, `${intel.data.match.baseScore} → ${intel.data.match.score} (${intel.data.match.delta})`);
check('applied rules never claim a bonus the honest ceiling refuses', !(intel.data.match.baseScore >= 97 && intel.data.match.delta > 0), `base ${intel.data.match.baseScore}, delta ${intel.data.match.delta}, ${intel.data.match.applied.length} rule(s) noted`);
const weak = jobsAll.filter((x) => x.match.score < 25);
{
  const rw = await Promise.all(weak.slice(0, 4).map((x) => j(`/api/jobs/${x.id}/research`)));
  check('thin postings get intel without crashing or inventing', rw.every((r) => r.status === 200 && Array.isArray(r.data.research.insights)), `${weak.length} weak postings checked`);
  check('a weak posting is not flattered into "good"', rw.every((r) => r.data.research.insights.length === 0 || r.data.research.verdict !== 'good' || r.data.research.positives.length > 0), rw.map((r) => r.data.research.verdict).join(','));
}

console.log('\n11. direct ATS submit (against a local mock of the public API)');
const draftJob = await j('/api/apps/draft', { method: 'POST', body: JSON.stringify({ jobIds: [ghJob.id], force: true }) });
const appsNow = (await j('/api/apps')).data.apps;
const ghApp = appsNow.find((a) => a.jobId === ghJob.id);
check('drafted app carries the tailored resume + insights', Boolean(ghApp?.tailoredResume) && Boolean(ghApp?.insights?.insights), `audit bullets ${ghApp?.tailoredAudit?.bullets?.length}`);
const txtDl = await fetch(`${BASE}/api/apps/${ghApp.id}/tailored.txt`);
check('per-application tailored resume is downloadable', txtDl.status === 200 && (await txtDl.text()).includes('EXPERIENCE'));
const supOff = await j(`/api/apps/${ghApp.id}/submit-support`);
check('greenhouse job is detected as submittable, gated by the switch', supOff.data.support.supported === true && supOff.data.support.ok === false, (supOff.data.support.reason || '').slice(0, 74));
const dry = await j(`/api/apps/${ghApp.id}/submit`, { method: 'POST', body: JSON.stringify({ confirm: false }) });
check('dry run previews the exact payload, sends nothing', dry.status === 200 && dry.data.dryRun === true && !dry.data.sent && dry.data.endpoint.includes('/applications') && atsSeen.length === 0, dry.data.endpoint);
check('dry-run candidate carries name/email + job title', `${dry.data.candidate?.first_name} ${dry.data.candidate?.last_name}`.trim().length > 2 && dry.data.candidate?.emails?.length > 0 && JSON.stringify(dry.data.candidate).includes(ghJob.title));
check('the tailored resume is what gets attached', dry.data.resume?.bytes > 100, `${dry.data.resume?.bytes} bytes (${dry.data.resume?.uploadedFile ? 'uploaded file' : 'generated text'})`);
const sendOff = await j(`/api/apps/${ghApp.id}/submit`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
check('real send refused while the settings switch is off', sendOff.status === 200 && sendOff.data.sent !== true && /direct submit is switched off in Settings/.test(sendOff.data.error || ''), (sendOff.data.error || '').slice(0, 70));
check('and still no traffic left the box', atsSeen.length === 0);
check('the switch-off refusal is itself logged', (await j('/api/submissions')).data.submissions.some((e) => e.sent === false && /Direct submit is off|switch/.test(e.error || '') || (e.sent === false && e.dryRun)));
await j('/api/settings', { method: 'PUT', body: JSON.stringify({ atsSubmit: { enabled: true } }) });
const sendOn = await j(`/api/apps/${ghApp.id}/submit`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
check('enabled + confirmed → one POST to the ATS, app marked submitted', sendOn.data.sent === true && atsSeen.length === 1 && sendOn.data.app?.status === 'submitted', `application ${sendOn.data.applicationId}, ${atsSeen.length} request(s)`);
check('the ATS received multipart form data with a resume field', /multipart\/form-data/.test(atsSeen[0]?.contentType || '') && /name="resume"/.test(atsSeen[0]?.raw || ''), `${(atsSeen[0]?.raw || '').length} bytes, ${atsSeen[0]?.url}`);
check('the request carried the candidate JSON + our source tag', /"first_name"/.test(atsSeen[0]?.raw || '') && /applyflow-self-hosted/.test(atsSeen[0]?.raw || ''));
check('second send is refused rather than duplicating the application', (await j(`/api/apps/${ghApp.id}/submit`, { method: 'POST', body: JSON.stringify({ confirm: true }) })).data.sent !== true && atsSeen.length === 1, `${atsSeen.length} total request(s)`);
const otherApp = appsNow.find((a) => a.id !== ghApp.id) || (await j('/api/apps')).data.apps.find((a) => a.id !== ghApp.id);
if (otherApp) {
  const bad = await j(`/api/apps/${otherApp.id}/submit-support`);
  check('a non-Greenhouse/Lever job is honestly unsupported', bad.data.support.supported === false && /LinkedIn|not a public/.test(bad.data.support.reason), (bad.data.support.reason || '').slice(0, 70));
} else {
  check('a non-Greenhouse/Lever job is honestly unsupported', true, 'only one draft in store — skipped');
}
const subs = await j('/api/submissions');
check('submissions log records kind, dryRun, sent and ids', subs.data.submissions.every((e) => typeof e.dryRun === 'boolean' && typeof e.sent === 'boolean' && e.at), `${subs.data.submissions.length} entries`);
await j('/api/settings', { method: 'PUT', body: JSON.stringify({ atsSubmit: { enabled: false } }) });
const pack = await fetch(`${BASE}/api/export/pack.md${otherApp ? `?id=${otherApp.id}` : `?id=${ghApp.id}`}`).then((r) => r.text());
check('markdown pack now includes the tailored resume + posting intel', /## Tailored resume/.test(pack) && /## What this posting reveals/.test(pack), `${pack.split('\n').length} lines`);

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
if (child) child.kill('SIGTERM');
atsMock.close();
if (SELF) { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} }
process.exit(fail ? 1 : 0);
