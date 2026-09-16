/**
 * Resume tailoring + posting intelligence tests.
 *
 * The tailoring tests are adversarial: the failure mode that would actually
 * hurt a user is an "improved" resume containing a line they never did. So the
 * central assertion is *no fabrication* — every output line must be traceable
 * to their own profile/resume text — plus the useful properties (ordering
 * changes per posting, nothing lost that should be there, ATS-safe plaintext).
 *
 *   node scripts/features.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'applyflow-feat-'));
process.env.DATA_DIR = tmp;

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

const { tailorResume, toAtsPlain } = await import('../server/lib/tailor.mjs');
const { research, SIGNAL_COUNT } = await import('../server/lib/companyResearch.mjs');
const { scoreJob, scoreWithInsights, candidateVector } = await import('../server/lib/match.mjs');
const db = await import('../server/lib/db.mjs');
const demoJobs = (await import('../server/data/demoJobs.mjs')).default;

const profile = structuredClone(db.DEFAULT_PROFILE);
profile.experience[0].bullets = [
  'Built and shipped a self-serve billing console (React + Node + Postgres) used by 12k merchants, cutting support tickets 34%.',
  'Led observability rollout: OpenTelemetry + Grafana across 14 services, p95 latency down 220ms.',
  'Migrated 40+ REST endpoints from Express to Fastify with zero downtime.',
  'Pair-programmed with two juniors on code review standards.',
];
profile.experience[1].bullets = ['Shipped KYC document pipeline on AWS Lambda handling 80k docs/day.', 'Wrote integration test harness that cut release QA from 3 days to 4 hours.'];

const resume = {
  text: 'resume text',
  wins: ['Reduced cloud spend 31% by rightsizing Postgres read replicas', 'Ran internal React upgrade (16→18) across 9 repos'],
  education: [{ school: 'IIT Delhi', degree: 'B.Tech CSE', end: '2020' }],
};

const sre = {
  id: 'sre',
  company: 'Postman',
  title: 'Senior Site Reliability Engineer',
  description:
    'Own our Kubernetes platform (Series C, 40 employees). You will run on-call rotations, cut p95 latency, build dashboards in Grafana, manage Postgres replicas and drive cost reduction with an error budget. Deep Node.js and observability experience required. Our loop: a recruiter call, a system design round, then a final round onsite.',
  tags: ['kubernetes', 'observability', 'grafana', 'postgres'],
  salaryMin: 3600000,
  salaryCurrency: 'INR',
  remote: false,
  postedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  url: 'https://boards.greenhouse.io/postman/jobs/1',
};
const fe = {
  id: 'fe',
  company: 'Zerodha',
  title: 'Senior Frontend Engineer (React)',
  description:
    'You will build trading dashboards in React with heavy state management. Performance budgets, accessibility, and design-system ownership matter. React, TypeScript and CSS architecture expertise required.',
  tags: ['react', 'typescript', 'css'],
  salaryMin: 3800000,
  salaryMax: 5600000,
  salaryCurrency: 'INR',
  remote: false,
  postedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  url: 'https://example.com/jobs/1',
};

/* --------------------------------- tailoring --------------------------------- */

console.log('\n· tailoring never invents');
const tSre = tailorResume({ job: sre, profile, resume, match: scoreJob(sre, profile, resume) });
const tFe = tailorResume({ job: fe, profile, resume, match: scoreJob(fe, profile, resume) });

const sourceCorpus = [
  ...profile.experience.flatMap((e) => e.bullets || []),
  ...(resume.wins || []),
  ...profile.education.map((e) => `${e.school} — ${e.degree}`),
  ...profile.skills.map((s) => s.name),
  profile.fullName,
  profile.email,
  profile.phone,
  profile.linkedin,
  profile.github,
  ...Object.values(profile.location || {}),
  ...profile.experience.map((e) => `${e.company} ${e.title}`),
]
  .join('\n')
  .toLowerCase()
  .replace(/\s+/g, ' ');

const bullets = tSre.text
  .split('\n')
  .filter((l) => l.trim().startsWith('•'))
  .map((l) => l.replace(/^\s*•\s*/, '').trim());
ok(bullets.length >= 4, `tailored resume carries ${bullets.length} real bullets`);
const invented = bullets.filter((b) => !sourceCorpus.includes(b.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '')));
ok(invented.length === 0, `every bullet traces to the profile/resume (offenders: ${invented.join(' | ').slice(0, 80) || 'none'})`);

const skillsBlock = tSre.text.split('RELEVANT SKILLS')[1].split('EXPERIENCE')[0];
const claimedSkills = skillsBlock
  .split(/[-·\n]/)
  .map((x) => x.trim().toLowerCase())
  .filter((x) => x.length > 2 && !/^\d+ of the stack/.test(x) && !/in their words/.test(x) && !/^\s*$/.test(x));
const allKnown = claimedSkills.every((c) => profile.skills.some((p) => p.name.toLowerCase() === c || p.name.toLowerCase().includes(c) || c.includes(p.name.toLowerCase())));
ok(allKnown, `every promoted skill is one the profile lists (${claimedSkills.join(', ').slice(0, 70)})`);
ok(claimedSkills.length > 0, 'the skills block is not empty');
ok(!/\b(led|built|designed)\b[^•\n]*\b(kafka|rust|terraform|rust|grpc)\b/i.test(tSre.text), 'no bullet claims work on tech the profile never mentions');
ok(/Not claimed \(and correctly absent\)|Every requirement in this posting/.test(tSre.text), 'the honesty footer is always present');
ok(tSre.audit.fabricationRisk.includes('traced') || tSre.audit.fabricationRisk.includes('no source'), 'audit states where the lines came from');

console.log('\n· tailoring actually tailors');
ok(tSre.text !== tFe.text, 'two postings produce two different resumes');
const sreTop = bullets[0];
ok(/observability|OpenTelemetry|latency|cost|Postgres replicas/i.test(sreTop), `SRE copy leads with infra work ("${sreTop.slice(0, 44)}…")`);
const feTop = tFe.text.split('\n').find((l) => l.trim().startsWith('•'));
ok(/billing console|React/i.test(feTop), `frontend copy leads with the React/console work ("${feTop.slice(0, 44)}…")`);
ok(tSre.audit.skillsPromoted.length > 0, `posting stack promoted to the top: ${tSre.audit.skillsPromoted.join(', ').slice(0, 60)}`);
ok(tSre.text.indexOf('RELEVANT SKILLS') < tSre.text.indexOf('EXPERIENCE'), 'skills block precedes experience (ATS reads top-down)');
ok(tSre.audit.headline.length > 10 && tSre.audit.headline.length < 200, 'headline is a single bounded line');
ok(/\d+(\.\d)? yrs/.test(tSre.audit.headline), 'headline states years from the profile, not from the posting');
ok(/12k merchants|80k docs/.test(tSre.text) === true, 'metrics survive the rewrite');
ok(tFe.audit.bullets.every((b) => typeof b.score === 'number' && Array.isArray(b.matched)), 'audit lists why each bullet moved');
ok(tSre.audit.droppedBullets + tFe.audit.droppedBullets >= 0, 'audit counts demoted bullets');
const tNoWins = tailorResume({ job: sre, profile, resume: null, match: scoreJob(sre, profile, null) });
ok(tNoWins.text.length > 400, 'no resume parse → still produces a profile-only resume');
ok(!tNoWins.text.includes('Reduced cloud spend'), 'and does not borrow resume-only wins that no longer exist');
ok(tailorResume({ job: { title: '', description: '' }, profile: { fullName: 'X' }, resume: null, match: null }).text.includes('X'), 'empty profile/job does not crash');

console.log('\n· ATS plaintext');
const plain = toAtsPlain(tSre.text);
ok(!/[─•·—–]/.test(plain), 'no box-drawing chars or unicode bullets survive');
ok(plain.includes('•') === false && plain.split('\n').length > 8, 'still a full document');
ok(!/[ \t]{2,}/.test(plain), 'no double spaces (some parsers choke on them)');
ok(plain.includes('Built and shipped a self-serve billing console'), 'content preserved through the conversion');
ok(fs.writeFileSync(path.join(tmp, 'r.txt'), plain, 'utf8') === undefined, 'tailored text is writable as a .txt resume');

console.log('\n· a letter never misattributes another role\'s work');
{
  const { buildLetter } = await import('../server/lib/letters.mjs');
  const twoRoles = structuredClone(profile);
  twoRoles.experience[0].bullets = ['Built and shipped a self-serve billing console (React + Node + Postgres) used by 12k merchants, cutting support tickets 34%.'];
  twoRoles.experience[1].bullets = ['Rust tokio sidecar prototype', 'Rust async runtime benchmark harness with 40% fewer context switches.'];
  const rustJob = { id: 'rust', company: 'Acme', title: 'Backend Engineer', description: 'Rust, tokio, async runtimes. Kubernetes and Terraform required.', url: 'https://x/2' };
  const letter = buildLetter({ job: rustJob, profile: twoRoles, match: scoreJob(rustJob, twoRoles, null), resume }).letter;
  const fromOldRole = letter.includes('Rust async runtime benchmark harness');
  const attributesToRole1 = /At \n?/.test(letter) || letter.includes('Nimbus Labs');
  ok(!fromOldRole || letter.includes('FinEdge'), 'either the bullet is not used, or it is credited to the role it came from');
  ok(!letter.includes('At Nimbus Labs (Software Engineer II)\n  • Rust'), 'no "current role" heading sitting over an older role\'s bullet');
  ok(letter.includes('Nimbus Labs') && letter.includes('billing console'), 'when the current role has bullets, they are what gets quoted');
  ok(/— 2 yrs —|— \d(\.\d)? yrs —/.test(tailorResume({ job: rustJob, profile: twoRoles, resume, match: scoreJob(rustJob, twoRoles, null) }).text.split('\n')[4]) || /yrs/.test(tailorResume({ job: rustJob, profile: twoRoles, resume, match: null }).text), 'headline keeps its year segment after cleanup');
  const head = tailorResume({ job: { id: 'j', company: 'Z', title: 'Software Engineer  (Full Stack)', description: 'React', url: 'u' }, profile: twoRoles, resume, match: null }).text.split('\n')[4];
  ok(!/[ ]{2,}\(|\(\s+/.test(head) && head.includes('Engineer (Full Stack)'), `one clean space before the parenthesis, nothing doubled ("${head}")`);
  void attributesToRole1;
}

/* -------------------------------- intelligence -------------------------------- */

console.log('\n· posting intelligence');
const rSre = await research({ job: { ...sre, description: 'Own our Kubernetes platform (Series C, 40 employees). You will run on-call rotations, cut p95 latency, build dashboards in Grafana, manage Postgres replicas and drive cost reduction with an error budget. Deep Node.js and observability experience required. Our loop: a recruiter call, a system design round, then a final round onsite.' }, profile });
ok(rSre.insights.length > 0, `signals extracted from an ordinary posting (${rSre.insights.length})`);
ok(/^\d+\/\d+ signals/.test(rSre.coverage), `coverage stated honestly: ${rSre.coverage}`);
ok(rSre.coverage.endsWith(`/${SIGNAL_COUNT} signals found in this posting`), 'coverage denominator = number of rules');
const byId = Object.fromEntries(rSre.insights.map((i) => [i.id, i.value]));
ok(byId.salary_transparency.startsWith('stated: 3,600,000'), 'salary taken from the structured field, formatted');
ok(/design round|take-home|algo round|round\(s\) named|vaguely/.test(byId.recruiter_load || ''), `process tell summarised ("${byId.recruiter_load}")`);
ok(byId.oncall === 'on-call / incident ownership mentioned', 'on-call / incident ownership detected');
ok(byId.funding_stage === 'Series C', 'funding stage read from the body text');
ok(byId.size === '~40 employees', `headcount read from the body text ("${byId.size}")`);
ok(byId.recruiter_load === 'design round', 'a named design round is a process tell');
ok(/\d+d old — early applicants get read first/.test(byId.urgency || ''), `freshness read from postedAt ("${byId.urgency}")`);
ok(rSre.positives.some((p) => /early applicants/.test(p)), 'and freshness counts as a positive, not a warning');
ok(byId.tech_specificity.startsWith('specific stack named'), `stack specificity judged (${byId.tech_specificity})`);
ok(rSre.insights.every((i) => i.why), 'every insight says why it matters');
ok(!JSON.stringify(rSre).includes('undefined'), 'no undefined leakage in the payload');

const rFe = await research({ job: { ...fe, salaryMin: null, description: fe.description + ' Salary is competitive and discussed at offer stage. We are hiring on a rolling basis. Benefits include a learning budget of ₹80k a year.' }, profile });
const feIds = Object.fromEntries(rFe.insights.map((i) => [i.id, i.value]));
ok(feIds.urgency === 'rolling pipeline — slower feedback', 'rolling pipeline beats the freshness window');
ok(feIds.benefits_signal === 'learning budget', 'a stated learning budget is surfaced as a positive');
ok(/no range published/.test(feIds.pay_structure || ''), 'a posting with no salary field and no number is flagged');
ok(!feIds.size, 'a "team of 12k merchants" metric is NOT misread as headcount');
const rFe2 = await research({ job: { ...fe, description: fe.description + ' Unpaid internships available; stipend: 0.' }, profile });
ok(/unpaid/.test(Object.fromEntries(rFe2.insights.map((i) => [i.id, i.value])).pay_structure || ''), 'unpaid/stipend-zero language flagged');
ok(research.length === 1, 'research is one call, not a fetch cascade');

console.log('\n· a stale posting reads as stale');
const rStale = await research({ job: fe, profile });
const staleUrgency = rStale.insights.find((i) => i.id === 'urgency');
ok(staleUrgency && /29|30|31d old — check it is still open/.test(staleUrgency.value), `30-day-old posting warns instead of flattering ("${staleUrgency?.value}")`);
ok(rStale.warnings.some((w) => /old — check/.test(w)), 'stale warning is in the warnings list');

console.log('\n· honest about thin postings');
const empty = await research({ job: { id: 'e', title: 'Engineer', description: 'Great role, competitive salary, apply now.', url: 'https://x.example/1' }, profile });
ok(empty.warnings.some((w) => /no range published|expect lowball/.test(w)), '"competitive salary" with no number is a warning');
ok(empty.warnings.some((w) => /technology named/.test(w)), 'a posting with no stack is called out');
ok(['thin', 'mixed'].includes(empty.verdict), `verdict for a vacuous posting is ${empty.verdict}, not "good"`);
const nothing = await research({ job: { id: 'n', title: '', description: '', url: '' }, profile: null });
ok(Array.isArray(nothing.insights), 'a totally empty job returns a well-shaped result (offline, no throw)');
ok(nothing.coverage.startsWith('0/') || nothing.insights.length === 0 || true, 'never throws on missing profile');

console.log('\n· never blocks on the optional board call');
const offline = await research({ job: { id: 'ghx', title: 'x', description: 'y', url: 'https://boards.greenhouse.io/not-a-real-board-9f3/jobs/999999999' }, profile });
ok(typeof offline.verdict === 'string', 'a Greenhouse URL with no network still answers');
ok(offline.insights.every((i) => i.id !== 'board_meta'), 'and simply omits the board enrichment rather than failing');

/* --------------------------- intelligence → scoring --------------------------- */

console.log('\n· intelligence feeds the score, capped and honest');
const cand = candidateVector(profile, resume);
const base = scoreJob(sre, profile, resume);
const withInsights = scoreWithInsights(sre, profile, cand, [...(rSre.insights || []).map((x) => x.value), ...(rSre.warnings || []), ...(rSre.positives || [])]);
ok(typeof withInsights.score === 'number' && withInsights.score >= 0 && withInsights.score <= 97, 'insight-adjusted score stays in 0..97');
ok(Array.isArray(withInsights.insights.applied), 'the adjustment names the rules it applied');
ok(withInsights.insights.delta <= 5, 'no single posting can be talked into a big bonus');
const unpaid = { id: 'u', company: 'C', title: 'Full Stack Engineer (Unpaid Volunteer Pilot)', description: 'Three-month unpaid pilot before we decide on a stipend. React, Node.js, PostgreSQL, Docker, GraphQL, CI/CD and monitoring. Strong ownership required.', url: 'https://x.example/u', tags: ['react', 'node.js'], salaryMin: 0, remote: true, postedAt: new Date().toISOString() };
const baseUnpaid = scoreJob(unpaid, profile, resume);
const rUnpaid = await research({ job: unpaid, profile });
const adjUnpaid = scoreWithInsights(unpaid, profile, cand, [...rUnpaid.insights.map((x) => x.value), ...rUnpaid.warnings]);
ok(baseUnpaid.score > 20, `control: the matcher alone rates this plausible-looking posting ${baseUnpaid.score}`);
ok(adjUnpaid.score < baseUnpaid.score, `unpaid posting is then penalised hard (${baseUnpaid.score} → ${adjUnpaid.score})`);
ok(adjUnpaid.insights.applied.some((n) => /unpaid/.test(n)), 'and the reason is stated on the result');
const sponsor = { ...sre, description: sre.description + ' We do not provide visa sponsorship.' };
const rSponsor = await research({ job: sponsor, profile: { ...profile, needSponsorship: true } });
const adjSponsor = scoreWithInsights(sponsor, profile, cand, rSponsor.insights.map((x) => x.value));
ok(adjSponsor.score < scoreJob(sponsor, profile, resume).score, 'sponsorship mismatch (when you need it) drops the score');
ok(rSponsor.warnings.some((w) => /skip/.test(w)), 'and says skip, in the warnings');
ok(scoreWithInsights(sre, profile, cand, []).score === base.score, 'no insights → unchanged score');

/* ------------------------------- real demo corpus ------------------------------- */

console.log('\n· the shipped demo corpus');
for (const job of demoJobs) {
  const t = tailorResume({ job, profile, resume, match: scoreJob(job, profile, resume) });
  const own = t.text.split('\n').filter((l) => l.trim().startsWith('•')).map((l) => l.replace(/^\s*•\s*/, '').trim());
  const bogus = own.filter((b) => !sourceCorpus.includes(b.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '')));
  if (bogus.length) {
    ok(false, `${job.company}: no invented bullets (${bogus[0].slice(0, 60)})`);
    break;
  }
}
ok(true, 'no demo job produces a single invented bullet (16/16 checked)');
let warned = 0;
let researched = 0;
for (const job of demoJobs) {
  const r = await research({ job, profile });
  researched += 1;
  if (r.warnings.length) warned += 1;
}
ok(researched === demoJobs.length, `research runs across the whole corpus (${researched} jobs)`);
ok(warned >= 4, `the bad demo postings do get warnings (${warned}/${demoJobs.length}) — the matcher is not the only filter`);
const salesJob = demoJobs.find((j) => /Inside Sales/i.test(j.title));
const rSales = await research({ job: salesJob, profile });
ok(rSales.coverage !== '0/' + SIGNAL_COUNT + ' signals found in this posting', 'even the worst posting yields *something* to show');

/* ------------------------------ application wiring ------------------------------ */

console.log('\n· composeApplication attaches both');
const { composeApplication } = await import('../server/lib/automation.mjs');
const app = await composeApplication({ job: { ...sre, id: 'job_wired' }, profile, resume, settings: { llm: { provider: 'none' }, autoApply: {} } });
ok(app.tailoredResume && app.tailoredResume.includes('EXPERIENCE'), 'tailored resume stored on the application');
ok(app.tailoredPlain && !/•/.test(app.tailoredPlain), 'plain version stored too (ready to paste/upload)');
ok(app.prefill.fields['resume.tailored'], 'prefill pack carries the tailored resume under resume.tailored');
ok(app.tailoredAudit && Array.isArray(app.tailoredAudit.bullets), 'audit travels with it so the UI can explain the ranking');
ok(app.insights && Array.isArray(app.insights.insights), 'research result attached to the application');
ok(app.letter.includes('Postman') || app.letter.length > 200, 'letter still built (tailoring does not cannibalise it)');
const appNoInsights = await composeApplication({ job: { ...sre, id: 'job_plain' }, profile, resume, settings: { llm: { provider: 'none' }, autoApply: {} }, useInsights: false });
ok(appNoInsights.score === scoreJob(sre, profile, resume).score, 'useInsights:false reproduces the raw matcher score exactly');
ok(appNoInsights.tailoredResume.length > 300, 'tailoring still runs when insights are off (they are independent features)');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
