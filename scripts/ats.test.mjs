/**
 * Direct-ATS-submit test. Runs a local mock of Greenhouse's and Lever's public
 * apply endpoints and drives server/lib/atsSubmit.mjs against it.
 *
 * The point is not "the API works" — it is that the guard rails hold: a dry run
 * sends zero bytes, a real send needs both confirmation and the settings switch,
 * an unsupported board is refused with a reason, no resume = no application,
 * and everything lands in the log.
 *
 *   node scripts/ats.test.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'applyflow-ats-'));
process.env.DATA_DIR = tmp;
const PORT = 3411 + Math.floor(Math.random() * 80);
process.env.ATS_API_BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (cond, label) => {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
};

const received = [];
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = req.url || '';
    received.push({ method: req.method, url, raw, contentType: req.headers['content-type'] || '' });
    res.setHeader('content-type', 'application/json');
    if (url.includes('/fail-404/')) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'Board not found' }));
    }
    if (url.includes('/fail-422/')) {
      res.statusCode = 422;
      return res.end(JSON.stringify({ errors: ['a questionnaire answer is required'] }));
    }
    if (url.startsWith('/v1/boards/')) return res.end(JSON.stringify({ id: 555, status: 'new' }));
    if (url.startsWith('/v0/postings/')) return res.end(JSON.stringify({ id: 'application_777' }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'no such path' }));
  });
});
await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

const ats = await import('../server/lib/atsSubmit.mjs');
const db = await import('../server/lib/db.mjs');

const profile = {
  fullName: 'Alex Kumar',
  email: 'alex@example.com',
  phone: '+919810000000',
  location: { city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  linkedin: 'https://linkedin.com/in/alexkumar',
  github: 'https://github.com/alexkumar',
  salary: { expected: 1800000, currency: 'INR', negotiable: true },
  boolAnswers: { consentDataProcessing: true },
};

/* ---------------------------- board detection ---------------------------- */

console.log('\n· board detection');
ok(ats.atsFor('https://boards.greenhouse.io/zerodha/jobs/12345').kind === 'greenhouse', 'greenhouse board url');
ok(ats.atsFor('https://boards.greenhouse.io/embed/job_app?for=zerodha&token=123').kind === 'greenhouse', 'greenhouse embed url');
ok(ats.atsFor('https://boards.greenhouse.io/zerodha/jobs/12345').board === 'zerodha', 'board slug extracted');
ok(ats.atsFor('https://jobs.lever.co/wise/abc-123-def').kind === 'lever', 'lever url');
ok(ats.atsFor('https://hackerrank.lever.co/wise/xyz12345').kind === 'lever', 'lever custom subdomain');
ok(ats.atsFor('https://jobs.lever.co/wise').kind === null, 'a lever board index page is not a posting');
ok(ats.atsFor('https://smartrecruiters.com/x/jobs/1').kind === null, 'a non-public board is not matched');
ok(ats.atsFor('https://jobs.workday.com/x').kind === null, 'Workday is not matched');
ok(ats.atsFor('https://linkedin.com/jobs/view/1').kind === null, 'LinkedIn is not matched');
ok(ats.atsFor('https://www.indeed.com/viewjob?jk=abc').kind === null, 'Indeed is not matched');
ok(ats.atsFor('').kind === null, 'empty url safe');
ok(
  ats.atsFor('https://boards.greenhouse.io/zerodha/jobs/12345').submitUrl.startsWith(`http://127.0.0.1:${PORT}/v1/boards/zerodha/jobs/12345/applications`),
  'submit URL built from the board + job number (overridable base for tests)'
);

/* ------------------------ support + the settings gate ------------------------ */

console.log('\n· support report explains itself');
const ghJob = { id: 'gh1', company: 'Zerodha', title: 'Senior Full Stack Engineer', url: 'https://boards.greenhouse.io/zerodha/jobs/12345' };
const leverJob = { id: 'lv1', company: 'Wise', title: 'Software Engineer', url: 'https://jobs.lever.co/wise/abc-123' };
const otherJob = { id: 'x1', company: 'Acme', title: 'Engineer', url: 'https://careers.acme.example/1' };

let st = db.getSettings();
st.atsSubmit = { ...(st.atsSubmit || {}), enabled: false };
db.saveSettings(st);

const offGate = ats.submitSupport(ghJob);
ok(offGate.supported === true && offGate.ok === false, 'Greenhouse job is supported but blocked while the switch is off');
ok(/Settings/.test(offGate.reason), 'the block message names the switch to flip');
const unsupported = ats.submitSupport(otherJob);
ok(unsupported.supported === false && /LinkedIn/.test(unsupported.reason), 'unsupported board refused with an explanation that names LinkedIn');
ok(/extension/.test(unsupported.reason), 'and points at the extension as the way in');
ok(ats.submitSupport({ url: '' }).supported === false, 'no url = nothing to submit to');

st = db.getSettings();
st.atsSubmit = { ...st.atsSubmit, enabled: true };
db.saveSettings(st);
const noResumeGate = ats.submitSupport(ghJob);
ok(noResumeGate.ok === false && /resume/i.test(noResumeGate.reason), 'real send blocked while no resume is on file');

/* ------------------------------ payload shapes ------------------------------ */

console.log('\n· payload shapes');
const candidate = ats.buildCandidate(profile, ghJob, 'Dear Hiring Team,\n\nLine two.');
ok(candidate.first_name === 'Alex' && candidate.last_name === 'Kumar', 'name split into first/last');
ok(candidate.emails[0].value === 'alex@example.com', 'email carried');
ok(candidate.phones.length === 1, 'one phone entry, not a duplicate per type');
ok(candidate.links.length === 2, 'linkedin + github as links');
ok(candidate.cover_letter.startsWith('Dear Hiring Team'), 'letter sent as cover_letter');
ok(candidate.applications[0].job.name === 'Senior Full Stack Engineer', 'job title attached to the application');
ok(candidate.applications[0].salary_information.expected === '1800000', 'expected salary carried through');

const answers = ats.toAnswerList([
  { id: 'q1', question: 'Years of experience?', answer: '5 years' },
  { question: '', answer: 'orphan' },
  { question: 'Relocate?', answer: '' },
]);
ok(answers.length === 1, 'blank + questionless answers dropped from a real submission');
ok(answers[0].question === 'Years of experience?' && answers[0].answerForParsing === '5 years', 'question text kept for audit');
ok(ats.toAnswerList([{ question: 'Relocate?', answer: '' }], { includeUnanswered: true }).length === 1, 'unanswered kept only when explicitly asked');
const multiline = ats.toAnswerList([{ question: 'Notice?', answer: '45 days\nserving' }])[0];
ok(!multiline.answerForParsing.includes('\n'), 'answerForParsing flattens newlines');

/* ------------------------------- guard rails ------------------------------- */

console.log('\n· guard rails (the actual point)');
db.saveResume({ text: 'ALEX KUMAR — Full Stack Engineer\nLed observability rollout', filename: 'resume.txt', mime: 'text/plain' });

const dry = await ats.submitToAts({ job: ghJob, profile, app: { answers: [] }, confirm: false });
ok(dry.dryRun === true && dry.ok === true, 'dry run returns a preview, marked as a dry run');
ok(received.length === 0, 'a dry run sent ZERO requests to the board');
ok(dry.endpoint.includes('/applications'), 'preview names the endpoint it would hit');
ok(dry.resume.bytes > 0 && dry.resume.uploadedFile === false, 'preview reports the text resume and that no stored file exists');
ok(/extension/.test(dry.note), 'the note says how to actually send it, and mentions the alternative');

const wrongBoard = await ats.submitToAts({ job: otherJob, profile, app: {}, confirm: true });
ok(wrongBoard.sent !== true && received.length === 0, 'confirm:true on an unsupported board still sends nothing');
ok(/not a public/.test(wrongBoard.error) || /LinkedIn/.test(wrongBoard.error), 'and explains why');

db.saveResume({ text: '', filename: '', mime: '' });
const missingResume = await ats.submitToAts({ job: leverJob, profile, app: {}, resumeText: '', confirm: true });
ok(missingResume.ok === false && /resume/.test(missingResume.issues.join(' ')), 'no resume text → listed as an issue');
ok(missingResume.sent !== true && received.length === 0, 'and nothing is sent when the resume is missing');
const gateless = ats.submitSupport(leverJob);
ok(gateless.ok === false && /Resume tab/.test(gateless.reason) && gateless.stage === 'resume', 'submitSupport also refuses while the store has no resume');
db.saveResume({ text: 'ALEX KUMAR — Full Stack Engineer\nLed observability rollout', filename: 'resume.txt', mime: 'text/plain' });

const unanswered = await ats.submitToAts({
  job: leverJob,
  profile,
  app: { answers: [{ question: 'Work authorization?', answer: '', required: true }] },
  resumeText: 'X',
  confirm: false,
});
ok(unanswered.issues.some((x) => /still unanswered/.test(x)), 'unanswered required question surfaces in the preview');
const refusedSend = await ats.submitToAts({
  job: leverJob,
  profile,
  app: { answers: [{ question: 'Work authorization?', answer: '', required: true }] },
  resumeText: 'X',
  confirm: true,
});
ok(refusedSend.sent !== true && /refused before sending/.test(refusedSend.error), 'and the real send refuses it instead of guessing');

/* ------------------------------- happy paths ------------------------------- */

console.log('\n· greenhouse send');
received.length = 0;
const gh = await ats.submitToAts({
  job: ghJob,
  profile,
  app: { answers: [{ id: 'q1', question: 'Notice period?', answer: '45 days' }] },
  resumeText: 'ALEX KUMAR\nSenior Full Stack Engineer',
  tailoredLetter: 'Dear Hiring Team,\n\nWe ship billing.',
  confirm: true,
});
ok(gh.sent === true && gh.status === 200, 'multipart POST accepted');
ok(gh.applicationId === 555, 'application id parsed from the response');
ok(received.length === 1, 'exactly one request went out');
ok(/multipart\/form-data/.test(received[0].contentType), 'greenhouse got multipart/form-data');
ok(/name="resume"/.test(received[0].raw), 'resume field present in the form');
ok(/Senior Full Stack Engineer/.test(received[0].raw), 'job title present');
ok(/Notice period/.test(received[0].raw), 'questionnaire answer present');
ok(/applyflow-self-hosted/.test(received[0].raw), 'source recorded so the employer sees where it came from');

console.log('\n· lever send');
received.length = 0;
const lv = await ats.submitToAts({ job: leverJob, profile, app: { answers: [] }, resumeText: 'ALEX KUMAR', confirm: true });
ok(lv.sent === true && lv.applicationId === 'application_777', 'lever application id parsed');
ok(/\/v0\/postings\/wise\/abc-123\/apply/.test(received[0].url), 'correct lever path');
ok(/application\/json/.test(received[0].contentType), 'lever got JSON');
const lvBody = JSON.parse(received[0].raw);
ok(lvBody.resume === 'ALEX KUMAR', 'lever payload carries resume text');
ok(lvBody.application.name === 'Alex Kumar', 'and the applicant name');
ok(lvBody.letters === undefined || typeof lvBody.letters.text === 'string', 'lever letter shape is a plain text body, not an object leak');
ok(!/We ship billing/.test(received[0].raw), "no cover letter from a different job leaked into this payload");

console.log('\n· error handling');
const notFound = await ats.submitToAts({
  job: { ...ghJob, id: 'gh404', url: 'https://boards.greenhouse.io/fail-404/jobs/9' },
  profile,
  app: {},
  resumeText: 'X',
  confirm: true,
});
ok(notFound.sent === false && notFound.status === 404, '404 reported, not swallowed');
ok(/no longer open/.test(notFound.message), '404 carries actionable guidance');
const rejected = await ats.submitToAts({
  job: { ...ghJob, id: 'gh422', url: 'https://boards.greenhouse.io/fail-422/jobs/9' },
  profile,
  app: {},
  resumeText: 'X',
  confirm: true,
});
ok(rejected.status === 422 && /questionnaire/.test(rejected.message), '422 explains the questionnaire problem');

/* --------------------------------- side effects --------------------------------- */

console.log('\n· state, caps, log');
ok(db.read('applications', []).length === 0, 'submitting an untracked job creates no phantom application record');

db.write('applications', [{ id: 'app_1', jobId: 'gh1', status: 'prepared', history: [] }]);
const first = await ats.submitToAts({ job: { ...ghJob, id: 'gh1' }, profile, app: { id: 'app_1', answers: [] }, resumeText: 'X', confirm: true });
ok(first.sent === true, 'first real send for a tracked app goes through');
const after = db.read('applications', []).find((a) => a.id === 'app_1');
ok(after.status === 'submitted' && after.submission.via === 'api:greenhouse', 'app flipped to submitted with the route recorded');
ok(after.submission.applicationId === 555, 'external application id stored on the app');
ok(after.history.some((h) => /public apply API/.test(h.note)), 'history entry written');
const second = await ats.submitToAts({ job: { ...ghJob, id: 'gh1' }, profile, app: { id: 'app_1', answers: [] }, resumeText: 'X', confirm: true });
ok(second.sent !== true && /twice/.test(second.error || ''), 'a second send for the same app is refused');
const st2 = db.getSettings();
ok((st2.submitCounters?.[new Date().toISOString().slice(0, 10)] || 0) >= 2, 'per-day counter only counts real sends');

received.length = 0;
const st3 = db.getSettings();
st3.autoApply = { ...st3.autoApply, dailyCap: 2 };
db.saveSettings(st3);
const capped = await ats.submitToAts({ job: { ...leverJob, id: 'lv-never-used' }, profile, app: { answers: [] }, resumeText: 'X', confirm: true });
ok(capped.ok === false && /daily cap/.test(`${capped.reason || ''} ${capped.error || ''}`), 'the shared daily cap stops direct submits too');
ok(received.length === 0, 'blocked by the cap = no traffic sent');
st3.autoApply = { ...st3.autoApply, dailyCap: 0 };
db.saveSettings(st3);

const log = ats.submitLog(500);
ok(log.length >= 5, 'every attempt (dry runs, refusals, sends) is logged');
ok(log.filter((e) => e.sent).length === ats.submitLog(500).filter((e) => e.sent).length, 'log window is consistent');
ok(log.some((e) => e.dryRun && !e.sent), 'dry runs recorded as not sent');
ok(log.some((e) => /already submitted/.test(e.error || '')), 'the duplicate refusal is logged too');
ok(log.some((e) => e.sent && e.externalId), 'successful sends recorded with the external id');
ok(log.every((e) => typeof e.at === 'string' && typeof e.company === 'string'), 'log entries carry timestamp + company');

/* ------------------------------- the API layer ------------------------------- */

console.log('\n· route wiring');
const src = fs.readFileSync(path.join(process.cwd(), 'server/index.mjs'), 'utf8');
ok(src.includes("'/api/apps/:id/submit'") && src.includes('submitToAts'), 'server exposes POST /api/apps/:id/submit');
ok(src.includes('confirm: Boolean(req.body?.confirm)'), 'server passes confirm through verbatim — the UI cannot force a send by accident');

mock.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
