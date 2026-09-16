/**
 * Match-engine invariants. These are the behaviours the whole product leans on:
 * the score must be explainable, must not be inflatable, and must actually use
 * the flags the UI claims to use.
 *
 *   node scripts/match.test.mjs
 */
import { scoreJob, scoreWithInsights, candidateVector } from '../server/lib/match.mjs';

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

const job = {
  id: 'c1',
  company: 'C',
  title: 'Backend Engineer',
  description: 'You will use Java and MySQL daily. Kafka, Redis and Terraform are required too, plus Docker and CI/CD pipelines.',
  url: 'https://x/1',
  tags: [],
  postedAt: new Date().toISOString(),
  location: 'Bengaluru, India',
  salaryMin: 1400000,
  salaryCurrency: 'INR',
};

const prof = (core, over = {}) => ({
  fullName: 'T E',
  email: 't@e.c',
  phone: '+910000000000',
  location: { city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  primaryField: 'software_engineering',
  targets: { fields: ['software_engineering'], minSalary: 1200000, salaryCurrency: 'INR' },
  experience: [{ company: 'X', title: 'Backend Engineer', start: '2024-01', current: true, bullets: ['Built Java services with Redis caching'] }],
  education: [],
  skills: [
    { name: 'Java', level: 4, core },
    { name: 'Docker', level: 3, core: false },
    { name: 'Redis', level: 2, core },
  ],
  boolAnswers: {},
  freeTextAnswers: {},
  ...over,
});

console.log('\n· runtime guard agrees with what the dependencies actually declare');
{
  const { nodeTooOld, nodeVersionAdvice } = await import('../server/lib/runtime.mjs');
  ok(nodeTooOld('18.20.8') === true, 'the reported failure case (Node 18) is detected');
  ok(nodeTooOld('20.11.1') === true, 'and the engines field we used to claim (>=20) would NOT have saved anyone');
  ok(nodeTooOld('22.12.9') === true && nodeTooOld('22.13.0') === false, 'boundary is 22.13, where pdfjs-dist starts being satisfied');
  ok(nodeTooOld('24.4.1') === false && nodeTooOld('v22.16.0') === false, 'newer majors and a v-prefixed string are fine');
  const advice = nodeVersionAdvice('18.20.8');
  ok(/pdfjs-dist|PDF/.test(advice) && /jsdom/.test(advice), 'the message names the two things that break, not a vague version complaint');
  ok(/brew install node@22|nvm install/.test(advice), 'and gives copy-pasteable fixes');
  ok(/\.txt|\.docx|paste/i.test(advice), 'plus the workaround for someone who cannot upgrade right now');
}

console.log('\n· the `core` skill flag actually does something (and stays modest)');
const withCore = scoreJob(job, prof(true), null);
const noCore = scoreJob(job, prof(false), null);
ok(withCore.matchedSkills.length === noCore.matchedSkills.length, 'same skills match in both cases', withCore.matchedSkills.join(','));
ok(withCore.score > noCore.score, `core-flagged matches score higher (${noCore.score} → ${withCore.score})`);
ok(withCore.score - noCore.score <= 6, 'and the boost is small — a tick, not a re-ranking');
ok(withCore.breakdown.skills > noCore.breakdown.skills, 'the boost shows up in the skills component of the breakdown');

console.log('\n· no inflation from the flags alone');
const allCore = scoreJob(job, prof(true), null);
const sameJobTwice = scoreJob(job, prof(true), null);
ok(allCore.score === sameJobTwice.score, 'scoring is deterministic — same inputs, same number');
ok(allCore.score <= 97, `honest ceiling holds (${allCore.score} ≤ 97)`);
const nobodyCoreButEverything = prof(false);
nobodyCoreButEverything.skills = ['java', 'mysql', 'kafka', 'redis', 'terraform', 'docker', 'ci/cd', 'rabbitmq', 'grpc', 'kubernetes'].map((name) => ({ name, level: 5, core: false }));
const maxed = scoreJob(job, nobodyCoreButEverything, null);
ok(maxed.score <= 97, `a perfect skill list still cannot buy 100 (${maxed.score})`);
ok(maxed.matchedSkills.length >= 5, 'a real skill list does match this job', maxed.matchedSkills.join(','));

console.log('\n· skills that only exist in the resume still count, but cannot be "core"');
const bare = prof(false);
bare.skills = [];
const resume = { text: 'Java, Redis and Terraform in anger at scale', summary: { skills: ['java', 'redis', 'terraform'] }, wins: ['Cut Redis p99 by 40%'] };
const viaResume = scoreJob(job, bare, resume);
ok(viaResume.matchedSkills.length > 0, 'resume-only skills are matched', viaResume.matchedSkills.join(','));
ok(viaResume.score <= 97, 'and stay under the ceiling');

console.log('\n· salary comparison refuses to guess FX');
const usd = { ...job, salaryMin: 90000, salaryCurrency: 'USD' };
const usdMatch = scoreJob(usd, prof(true), null);
ok(usdMatch.flags.some((f) => /pays in USD/.test(f)), 'foreign pay is surfaced as a flag', usdMatch.flags.join(' / '));
const flagged = usdMatch.breakdown.salary;
ok(flagged > 0 && flagged <= 5, 'neutral weight rather than a fabricated conversion', `salary=${flagged}`);
const inrBelow = { ...job, salaryMin: 400000 };
ok(scoreJob(inrBelow, prof(true), null).flags.some((f) => /below your salary floor/.test(f)), 'a real under-floor INR range is still flagged hard');

console.log('\n· candidateVector reuse keeps scores identical');
const p2 = prof(true);
const cand = candidateVector(p2, null);
const viaCand = scoreJobWithCand(job, p2, cand);
function scoreJobWithCand(j, pr, c) {
  return scoreWithInsights(j, pr, c, []);
}
ok(viaCand.score === withCore.score, 'vector path equals the direct path', `${viaCand.score} vs ${withCore.score}`);
ok((scoreWithInsights(job, p2, cand, []).insights?.delta ?? 0) === 0, 'no insights = no delta (and no insights object invented)');
ok(typeof scoreWithInsights(job, p2, cand, ['nothing that matches a rule']).insights.delta === 'number', 'an unmatched insight line changes nothing but is still reported');

console.log('\n· unpaid and sponsorship blockers dominate the flattering parts');
const shiny = {
  ...job,
  title: 'Unpaid Backend Volunteer (great learning!)',
  description: job.description + ' Unpaid, equity only, no stipend: 0. We do not provide visa sponsorship.',
  salaryMin: 0,
};
const r = await import('../server/lib/companyResearch.mjs');
const research = await r.research({ job: shiny, profile: prof(true, { needSponsorship: true }) });
const adjusted = scoreWithInsights(shiny, prof(true), cand, [...research.insights.map((x) => x.value), ...research.warnings]);
const baseShiny = scoreJob(shiny, prof(true), null);
ok(adjusted.score < baseShiny.score, `insights pull it down (${baseShiny.score} → ${adjusted.score})`);
ok(adjusted.score <= 30, 'and land it in "do not spend an application here" territory', String(adjusted.score));
ok(adjusted.insights.applied.some((n) => /unpaid/.test(n)) && adjusted.insights.applied.some((n) => /sponsor/i.test(n)), 'both blockers are named', adjusted.insights.applied.join(' | '));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
