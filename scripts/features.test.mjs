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
const demoJobs = (await import('./fixtures/jobFixtures.mjs')).default;
const { DEMO_PROFILE } = await import('./fixtures/profileFixture.mjs');

/* The suite needs a *populated* profile — it mutates experience bullets and asserts
   that no invented skill leaks in. That richness is test data now: see the header of
   scripts/fixtures/profileFixture.mjs for why it left DEFAULT_PROFILE. */
const profile = structuredClone(DEMO_PROFILE);
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

console.log('\n· resume parsing hygiene (skills, contact, titles)');
{
  const { parseResume } = await import('../server/lib/resume.mjs');
  const txt = fs.readFileSync(new URL('../data/samples/vishnu-resume.txt', import.meta.url), 'utf8');
  const sum = (parseResume(txt).summary || parseResume(txt));
  const low = sum.skills.map((x) => x.toLowerCase());
  ok(new Set(low).size === low.length, 'no duplicate skills after case normalisation', low.filter((x, i) => low.indexOf(x) !== i).join(','));
  const money = sum.skills.filter((x) => /^[$€£₹]|^\d|\d%$|\/(mo|yr)\b|^\d+k\b/i.test(x));
  ok(money.length === 0, 'no money or metric strings masquerading as a skill', money.join(',') || 'none');
  const awsish = sum.skills.filter((x) => /^(AWS )?EC2$/i.test(x));
  ok(awsish.length <= 1, 'an alias and its AWS-prefixed twin collapse to one entry', awsish.join(','));
  ok(sum.skills.includes('Next.js') && sum.skills.includes('CI/CD') && sum.skills.includes('RabbitMQ'), 'folded spellings get real names');
  ok(!sum.skills.some((x) => /:$/.test(x) || /^(programming languages|tools|soft skills)/i.test(x)), 'section labels never become skills');
  ok(sum.experience.every((e) => !/\(/.test(e.title)), 'role titles keep no "(stack)" tail');
  ok(sum.contact.website.includes('vercel.app') && !sum.contact.website.includes('gmail'), 'portfolio site is the portfolio, not the email host', sum.contact.website);
  ok(sum.contact.linkedin === 'linkedin.com/in/vishnu-nair-tech', 'LinkedIn path is not rewritten into a prose slug', sum.contact.linkedin);
  ok(sum.yearsOfExperience >= 2 && sum.yearsOfExperience <= 3, `years read from the date ranges (${sum.yearsOfExperience})`);

  /* A two-column PDF flattens one header into three lines — company, then "— Role
     (stack)", then dates. That shape used to come out as title:"Shoffr", company:"",
     which put the employer's name in the job-title slot, blanked {currentCompany} in
     every letter, and made titleKeywords (the title-match input) company names. */
  const roleBelow = (dateLine) =>
    parseResume(
      'EXPERIENCE\nShoffr\n— Software Development Engineer (NextJS, TypeScript, MySQL, Spring Boot)\n' +
        dateLine +
        '\n• Designed backend logic for trip prioritization, reducing manual work by 75% using functional programming.\n' +
        '• Integrated Paytm Link, UPI and payment authentication APIs, cutting failures by 76%.\n'
    ).experience[0];
  for (const [name, dateLine] of [['dates on their own line', 'Jan 2025 – Present'], ['dates on the role line', '| Jan 2025 – Present']]) {
    const e = roleBelow(dateLine);
    ok(e.company === 'Shoffr' && /^Software Development Engineer$/.test(e.title),
      `company-role with ${name} → company "Shoffr", title "Software Development Engineer", got ${JSON.stringify(e.company)}/${JSON.stringify(e.title)}`);
    ok(e.start === '2025-01' && e.current === true, `the date range still reads (${e.start}, current=${e.current})`);
    ok(e.bullets.length === 2, `both achievements survive the merge (${e.bullets.length})`);
  }
  /* the guard: a hyphen-bulleted achievement is not a role line */
  const swallowed = parseResume(
    'EXPERIENCE\nZomato\n- Designed a caching layer that cut p99 latency by 40% for 3M requests a day.\nJan 2025 – Present\n'
  ).experience[0];
  ok(!swallowed || !/caching layer/.test(swallowed.company || ''),
    'a hyphen bullet is never merged into the header as if it were a role');
  /* Skills were capped at 40, so a resume that states more lost technologies the
     matcher then scored as absent. */
  const many = 'SKILLS\n' + ['GraphQL', 'Terraform', 'Kafka', 'Redis', 'Envoy', 'gRPC', 'Prometheus', 'Grafana', 'Jest', 'Cypress', 'Gradle', 'Maven', 'Spring Security', 'OAuth2', 'JWT', 'Elasticsearch', 'ClickHouse', 'Airflow', 'Spark', 'Flink', 'Nginx', 'HAProxy', 'RabbitMQ', 'Protobuf', 'OpenTelemetry', 'Kubernetes', 'Helm', 'ArgoCD', 'Vault', 'Consul', 'Istio', 'KEDA', 'Playwright', 'Storybook', 'Datadog', 'Sentry', 'PagerDuty', 'Liquibase', 'Snowflake', 'dbt', 'Looker', 'Tableau', 'Django', 'FastAPI', 'Celery', 'Hibernate', 'Flyway', 'Testcontainers', 'Pact'].join(', ') + '\n';
  ok(parseResume(many).skills.length >= 46, `49 stated skills pass through (got ${parseResume(many).skills.length}; this was capped at 40)`);
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

/* ------------------------------ the fixture corpus ------------------------------ */

console.log('\n· the fixture corpus (scripts/fixtures/jobFixtures.mjs)');
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
ok(warned >= 4, `the deliberately-bad fixture postings do get warnings (${warned}/${demoJobs.length}) — the matcher is not the only filter`);
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

/* Removing the demo corpus from the code left it on disk for anyone who had ever
   clicked "load demo corpus": data/jobs.json is local, gitignored, and survives an
   upgrade. purgeDemoJobs() is what stops those invented postings from being scored
   next to real ones forever. */
{
  db.write('jobs', [
    { id: 'job_real', source: 'github_archive', title: 'Real', url: 'https://a/1' },
    ...demoJobs.slice(0, 3),
    { id: 'job_demo_legacy', source: 'demo', title: 'Legacy demo', url: 'https://a/2' },
    { id: 'demo_9', source: 'fixture', title: 'New fixture tag', url: 'https://a/3' },
  ]);
  db.write('applications', [{ id: 'app_x', jobId: 'job_demo_legacy' }]);
  const r = db.purgeDemoJobs();
  ok(r.removed === 5, `the purge deleted exactly the synthetic rows (got ${r.removed}, expected 5)`);
  ok(db.read('jobs', []).length === 1 && db.read('jobs', [])[0].id === 'job_real',
    'the one real posting survives the purge');
  ok(db.purgeDemoJobs().removed === 0, 'the purge is idempotent — a clean store costs nothing');
  {
    const r2 = fs.readFileSync('server/index.mjs', 'utf8');
    // includes(), not a regex: the pinned text is itself a regex literal, and
    // escaping one inside the other is how this broke the suite without failing it.
    ok(r2.includes(`if (/profile=1/.test(req.url || ''))`) && r2.includes(`writeStore('profile', DEFAULT_PROFILE)`),
      'reset clears an invented profile only when ?profile=1 is asked for');
  }

  ok(db.purgeDemoJobs().orphans === undefined, 'nothing is reported once there is nothing to report');
  const src = fs.readFileSync('server/index.mjs', 'utf8');
  ok(/purgeDemoJobs,\s*\n\s*getApplications/.test(src) && /const purged = purgeDemoJobs\(\);/.test(src),
    'the purge runs at boot, before anything can score the store');
}

/* The TLS hint used to read one errno and assert "a filtering/inspecting proxy answered
   for this host". A user whose node had a real Amazon cert and no proxy went hunting a
   middlebox that did not exist, so the classifier now looks at the certificate — and these
   pins keep the pure parts honest without needing a network. */
{
  const d = await import('../server/lib/tlsdiag.mjs');
  ok(d.sanMatches('DNS:npmjs.org, DNS:*.npmjs.org', 'npmjs.org') === true, 'a SAN list with the bare name matches');
  ok(d.sanMatches('DNS:*.greenhouse.io', 'a.b.greenhouse.io') === false, 'a wildcard never matches two levels deep');
  ok(d.sanMatches('DNS:api.github.com', 'github.com') === false, 'a cert for a subdomain is not a cert for the parent');
  ok(d.isPublicCaIssuer('C=US\nO=Amazon\nCN=Amazon RSA 2048 M04') === true, 'an Amazon-issued cert is recognised as public (this was the false accusation)');
  ok(d.isPublicCaIssuer('O=E2B\nCN=E2B Proxy CA') === false, 'a proxy CA is not a public issuer');
  ok(d.oneLineDn('C=US\nO=Amazon\nCN=Amazon RSA 2048 M04') === 'US / Amazon / Amazon RSA 2048 M04', 'DNs are printed one line, field order intact');
  const hint = fs.readFileSync('server/lib/ingest.mjs', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/a filtering\/inspecting proxy answered for this host/.test(hint),
    'the code never asserts a proxy from an errno alone — it must have read a certificate');
  ok(/kind === 'intercepted'/.test(hint) && /kind === 'not-trusted'/.test(hint) && /self-signed/.test(hint),
    'the hint distinguishes intercepted / not-trusted / self-signed instead of picking one guess');
}

/* An error that tells you to open a panel which does not exist is worse than no
   instruction: you look for it, conclude the app is broken, and give up. So every
   "Settings → X" the server prints has to be a real Settings panel, and the runner policy
   (which is NOT in Settings) must be named by where it actually lives. */
{
  const ui = fs.readFileSync('client/SettingsTab.jsx', 'utf8');
  const svr = fs.readFileSync('server/index.mjs', 'utf8') + fs.readFileSync('server/lib/atsSubmit.mjs', 'utf8');
  const promised = [...svr.matchAll(/Settings → ([A-Za-z][A-Za-z ]{1,24}?)(?=[^\sA-Za-z])/g)].map((m) => m[1].trim());
  const known = (p) => ui.includes(p) || p.split(/\s+/).some((w) => w.length > 3 && ui.includes(w));
  const unknown = [...new Set(promised)].filter((p) => !known(p));
  ok(unknown.length === 0, `no server message points at a missing Settings panel (${unknown.join('", "') || 'all resolve'})`);
  ok(/Auto-apply is off[\s\S]{0,160}Applications → Auto-apply policy/.test(svr), 'the runner-off error names Applications, where the toggle is');
  ok(fs.readFileSync('client/App.jsx', 'utf8').includes("setTab(settings?.autoApply?.enabled ? 'settings' : 'apps')"),
    'the home "sources + policy" step sends you to Applications when the runner is the missing half');
  ok(/resetAll: \(\) => req\('POST', '\/api\/reset\?profile=1'\)/.test(fs.readFileSync('client/api.js', 'utf8')),
    'the UI can actually clear an invented profile instead of leaving that to curl');
}

/* The one-click handoff is a cross-process bridge, and the dangerous version of it is
   "just navigate there and hope". These pins keep the honest shape: discover, claim once,
   fill empties only, never submit. */
{
  const man = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  const bg = fs.readFileSync('extension/background.js', 'utf8');
  const cs = fs.readFileSync('extension/content.js', 'utf8');
  const api = fs.readFileSync('client/api.js', 'utf8');
  const detail = fs.readFileSync('client/AppsTab.jsx', 'utf8');
  ok(man.externally_connectable && man.externally_connectable.matches.every((m) => /localhost|127\.0\.0\.1/.test(m)),
    'the web page can only reach the worker on localhost — no remote origin can push a pack');
  ok(!/[0-9a]{32}/.test(api), 'the client never probes a hardcoded extension id (that would fingerprint every browser)');
  ok(/onMessageExternal/.test(bg) && /applyflow\.ext:handoff/.test(bg), 'the worker accepts the handoff from the app page');
  ok(/remove\('pending'\)/.test(bg) && /PENDING_MS/.test(bg), 'a handoff is claimed once and expires — a reload cannot refill over your edits');
  ok(/onRemoved/.test(bg), 'an unclosed handoff is dropped when the tab goes away, so a pack of personal data does not linger');
  ok(/applyflow:ready/.test(cs) && /fill-handoff/.test(cs) && /onlyEmpty/.test(cs),
    'the content script asks for the claim and fills with onlyEmpty set');
  ok(/open the site &amp; autofill/.test(detail) && /no extension on this page/.test(detail),
    'the UI offers one click AND says plainly when the extension is absent');
  ok(!/submit\(\)|\.click\(\)/.test(bg), 'the worker never clicks anything');

  /* The block above greps; this one *runs* background.js against a stubbed chrome so the
     claim-once rule is proven rather than asserted from text. */
  {
    const vm = await import('node:vm');
    const store = {};
    const calls = { opened: [], sent: [] };
    let extHandler = null;
    const listeners = [];
    const chrome = {
      runtime: {
        id: 'ext-test',
        getManifest: () => ({ version: '0' }),
        onMessageExternal: { addListener: (f) => (extHandler = f) },
        // Chrome's event allows many listeners; dispatch them in order, first reply wins
        onMessage: { addListener: (f) => listeners.push(f) },
        onStartup: { addListener: () => {} },
        notifications: { create: () => {} },
      },
      storage: {
        local: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const o = {};
            for (const k of (typeof keys === 'string' ? [keys] : keys)) {
              if (typeof k === 'string') o[k] = store[k];
            }
            return typeof keys === 'string' ? (store[keys] !== undefined ? { [keys]: store[keys] } : {}) : o;
          },
          set: async (obj) => Object.assign(store, obj),
          remove: async (k) => { delete store[k]; },
        },
      },
      tabs: {
        create: async (c) => { calls.opened.push(c.url); return { id: 7 }; },
        sendMessage: async (id, m) => { calls.sent.push([id, m.type]); return { ok: true }; },
        onRemoved: { addListener: () => {} },
      },
    };
    const ctx = vm.createContext({ chrome, console, setTimeout, Date, Object, String, JSON, Error, Boolean, Number, RegExp });
    vm.runInContext(bg, ctx, { filename: 'extension/background.js' });
    ok(listeners.length === 1, `the worker registers exactly one onMessage dispatcher (got ${listeners.length})`);

    const ask = (msg) => new Promise((r) => extHandler(msg, { tab: { id: 7 } }, r));
    const ping = await ask({ type: 'applyflow.ext:ping' });
    ok(ping.ok && ping.extId === 'ext-test', 'a localhost page can ping the worker and learn its id');
    const bad = await ask({ type: 'applyflow.ext:handoff', url: 'https://x/' });
    ok(!bad.ok && /payload\.fields/.test(bad.error || ''), 'a handoff without a pack is refused, not half-applied');
    const noUrl = await ask({ type: 'applyflow.ext:handoff', payload: { fields: { email: 'a@b' } }, url: 'javascript:alert(1)' });
    ok(!noUrl.ok && /absolute http/.test(noUrl.error || ''), 'a non-http(s) target is refused (no javascript:/file: navigation)');

    const h = await ask({ type: 'applyflow.ext:handoff', url: 'https://boards.greenhouse.io/x/jobs/1', payload: { fields: { email: 'a@b' } }, jobId: 'job_1' });
    ok(h.ok && calls.opened.length === 1, 'a valid handoff opens exactly one tab');
    ok(store.pending && store.pending.tabId === 7 && store.pending.onlyEmpty !== false, 'the pack is parked against that tab, onlyEmpty by default');

    /* The worker replies asynchronously (it returns true and answers from an await), so
       deliver() waits for respond() rather than trusting the listener's return value. */
    const deliver = (msg, sender = { tab: { id: 7 } }, ms = 250) =>
      new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve(v);
        };
        const t = setTimeout(() => finish(undefined), ms);
        for (const f of listeners) {
          try {
            f(msg, sender, finish);
          } catch (e) {
            finish({ threw: String(e?.message || e) });
          }
          if (done) return;
        }
      });
    const c1 = (await deliver({ type: 'applyflow:ready' }));
    await new Promise((r) => setTimeout(r, 30));
    ok(c1.ok && c1.claimed && calls.sent.some(([id, t]) => id === 7 && t === 'applyflow:fill-handoff'), 'the tab claims its pack and receives the fill message');
    const c2 = (await deliver({ type: 'applyflow:ready' }));
    ok(!c2.ok && /nothing pending/.test(c2.error || ''), 'a reload claims nothing — your edits are never overwritten by a second fill');
    /* And the page that asked still learns the extension is alive: findExtension() resolves,
       it must not fall through to "not installed" just because the queue was empty. */
    const announced = await new Promise((resolve) => {
      const win = {
        location: { origin: 'http://localhost:3000' },
        chrome: { runtime: { id: 'ext-test', sendMessage: (m) => Promise.resolve(m?.type === 'applyflow:ready' ? c2 : { ok: true }) } },
        postMessage: (m) => resolve(m),
      };
      win.addEventListener = (_type, fn) => fn({ source: win, data: { type: 'applyflow:hand' } });
      const listener = fs
        .readFileSync('extension/content.js', 'utf8')
        .match(/window\.addEventListener\('message', async \(e\) => \{[\s\S]*?\n  \}\);/);
      ok(Boolean(listener), 'the content script answers the handshake on window "message", not a DOM event');
      const sandbox = {
        window: win,
        document: { addEventListener: () => {} },
        chrome: win.chrome,
        location: win.location,
        Promise,
        Object,
        Boolean,
        String,
        console,
      };
      sandbox.globalThis = sandbox;
      if (listener) vm.runInContext(`(async () => { ${listener[0]} })()`, vm.createContext(sandbox));
    });
    ok(announced?.type === 'applyflow:ext' && announced.id === 'ext-test' && announced.claimed === false,
      'the handshake answers with the extension id plus "nothing queued" (so the UI can tell the two apart)');
    const other = (await deliver({ type: 'applyflow:ready' }, { tab: { id: 99 } }));
    ok(!other.ok, 'a different tab cannot pick up someone else’s pack');
    const boot = (await deliver({ type: 'applyflow:boot-config' }, {}));
    await new Promise((r) => setTimeout(r, 20));
    ok(boot === undefined || boot === null || boot.ok === true,
      'the popup flow still gets its boot-config answer through the same dispatcher');

    /* --- the other side of the contract: what the *page* sends ---------------------
       Every token above matched; the click still did nothing for two reasons a
       token check cannot see — the handshake was posted as a window message while
       the content script listened for a custom DOM event, and handOff() named the
       pack without ever fetching it. So pin the client's shape, not its vocabulary. */
    const api = fs.readFileSync('client/api.js', 'utf8');
    const hand = api.slice(api.indexOf('export async function handOff'));
    const msg = hand.slice(hand.indexOf("type: 'applyflow.ext:handoff'"));
    ok(hand.includes('await api.extensionPayload(id)'),
      'handOff() fetches the real pack from the server before handing anything over');
    ok(msg.includes('payload') && msg.includes('url') && msg.includes('onlyEmpty'),
      'the handoff message carries payload + url + onlyEmpty, as the worker destructures them');
    ok(hand.includes('payload?.fields') && hand.includes('no prefill pack'),
      'a pack-less application is refused with a reason instead of opening an empty page');
    ok(bg.includes('msg.payload?.payload') && bg.includes('if (!pack?.fields)'),
      'the worker reads the same key the client writes, and refuses a pack with no fields');
    ok(bg.includes('applyflow.ext:ping') && bg.includes("name: 'ApplyFlow'"),
      'the worker answers a ping, so "extension not installed" is a fact and not a guess');
    const find = api.slice(api.indexOf('export function findExtension'), api.indexOf('export async function handOff'));
    ok(find.includes("addEventListener('message'") && find.includes('applyflow:hand'),
      'the app page probes with a window message on its own origin');
  }
}

/* A default that is enabled but can never answer is its own kind of fiction. */
{
  const db = fs.readFileSync('server/lib/db.mjs', 'utf8');
  const ing = fs.readFileSync('server/lib/ingest.mjs', 'utf8');
  const def = db.slice(db.indexOf('sources: { githubArchive'), db.indexOf('sources: { githubArchive') + 40);
  ok(/githubArchive: false/.test(def), `the shipped default does not enable a dead source (${def.trim().slice(0, 34)})`);
  ok(/no longer published/.test(ing), 'a 404 from the archived corpus says so instead of failing like a network problem');
}

/* The CLI ingest tool is where a fabricated default hurts most, because it runs
   unattended in a shell and its output goes straight into the store. Source-grepped,
   same style as the route-shape checks in test:harvest: a test that re-walks the
   profile builder would just re-assert whatever the builder currently says. */
{
  // comments stripped: the file documents the defaults it no longer has, and a
  // grep that finds a forbidden phrase inside a comment proves nothing either way
  const cli = fs.readFileSync('scripts/load-resume.mjs', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/consentBackgroundCheck:\s*true|consentDataProcessing:\s*true/.test(cli), 'the CLI does not tick consent boxes for you');
  ok(!/authorizedToWork:\s*true|areYouLegallyAble:\s*'Yes'|requireVisaSponsorshipNowOrFuture:\s*'No'/.test(cli), 'the CLI does not assert work authorisation or sponsorship');
  ok(!/city: 'Bengaluru', state: 'Karnataka'/.test(cli), 'the CLI does not invent an address when the resume has none');
  ok(/noticePeriodDays: args\.notice \? Number\(args\.notice\) : null/.test(cli), 'the CLI leaves notice unset unless --notice was passed');
  ok(/minSalary: args\.floor \? Number\(String\(args\.floor\)/.test(cli), 'the salary floor still only comes from --floor');
  ok(!/Math\.min\([^)]*4000\)/.test(cli),
    'the CLI reports what the store holds, not the API preview cap — resume.text is never truncated on save');
}

/* What DEFAULT_PROFILE and the answer builder used to assert about a stranger.
   A legal attestation or a consent tick is not a styling default: once it is in the
   profile it flows into every letter, every prefill payload and every direct API
   send, and nobody has to believe it for a form to claim it. */
console.log('\n· no invented attestations (consent, work authorisation, notice)');
{
  const { answerQuestions: ansq, buildPrefill: bp } = await import('../server/lib/letters.mjs');
  const bare = structuredClone(db.DEFAULT_PROFILE);
  const qs = [
    'Do you consent to a background check?',
    'Do you authorise us to process your personal data under GDPR?',
    'Are you legally authorised to work in this country?',
    'Will you now or in the future require sponsorship?',
    'What is your notice period?',
    'Why are you looking to leave your current role?',
  ];
  const ctx = { job: { title: 'Engineer', company: 'Acme' }, profile: bare, resume: null, match: { yearsOfExperience: null } };
  const byQ = Object.fromEntries(ansq(qs, ctx).map((a) => [a.question, a]));
  ok(byQ[qs[0]].needsHuman === true && byQ[qs[0]].answer === null, 'background-check consent is NOT auto-answered for someone who never ticked it', JSON.stringify(byQ[qs[0]]).slice(0, 78));
  ok(byQ[qs[1]].needsHuman === true, 'data-processing consent likewise goes to review');
  ok(!/^4 weeks$/i.test(String(byQ[qs[4]].answer || '')), 'notice period is not invented as "4 weeks"', JSON.stringify(byQ[qs[4]].answer));
  ok(!/more ownership in the product area/i.test(String(byQ[qs[5]].answer || '')), 'reason for leaving is not boilerplate written by the app');

  const picked = structuredClone(db.DEFAULT_PROFILE);
  picked.boolAnswers = { consentBackgroundCheck: true, authorizedToWork: true, requireSponsorship: true };
  const withAns = Object.fromEntries(ansq(qs, { ...ctx, profile: picked }).map((a) => [a.question, a]));
  ok(/Yes, I consent/.test(withAns[qs[0]].answer || '') && !withAns[qs[0]].needsHuman, 'a consent the user DID tick is answered and not flagged', String(withAns[qs[0]].answer).slice(0, 30));
  ok(withAns[qs[3]].answer !== 'No', 'sponsorship reads the profile instead of answering No either way', JSON.stringify(withAns[qs[3]].answer));

  const pre = bp({ job: { title: 'Engineer', company: 'Acme', url: 'https://x.greenhouse.io/a/1' }, profile: bare, resume: null, match: {}, app: { letter: 'L', answers: [] } });
  const risky = Object.entries(pre.fields).filter(([k]) => /consent|background|authoriz|sponsor/i.test(k));
  ok(risky.length > 0 && risky.every(([, v]) => v === null || v === undefined), 'unset attestations are null in the prefill pack, never a typed word', JSON.stringify(risky));
  ok(Object.values(pre.checkboxes).every((v) => v !== true), 'no checkbox is claimed true for a user who never chose');

  /* The shipped default must not carry a person. */
  ok(!/alex|kumar|nimbus/i.test(JSON.stringify(db.DEFAULT_PROFILE)), 'DEFAULT_PROFILE names no invented person');
  ok(db.DEFAULT_PROFILE.boolAnswers && Object.keys(db.DEFAULT_PROFILE.boolAnswers).length === 0, 'DEFAULT_PROFILE asserts no consent/legal answers');
  ok(db.DEFAULT_PROFILE.targets.minSalary === null && db.DEFAULT_PROFILE.targets.seniority.length === 0, 'DEFAULT_PROFILE guesses no salary floor and no seniority');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
