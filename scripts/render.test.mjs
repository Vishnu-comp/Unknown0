/**
 * Render probe: mounts every tab (populated + empty states) through
 * react-dom/server. Catches the class of bug that build-time checks miss —
 * e.g. an export named `Number` shadowing the global inside the shared UI
 * module, which only blew up at runtime.
 *   node scripts/render.test.mjs
 */
import { renderToString } from 'react-dom/server';
import { ProfileTab, ResumeTab } from '../client/ProfileTab.jsx';
import { JobsTab, JobModal } from '../client/JobsTab.jsx';
import { AppsTab } from '../client/AppsTab.jsx';
import { SettingsTab } from '../client/SettingsTab.jsx';
/* Render probes need a populated profile — an empty one exercises the empty
       states, which is a different (and separately asserted) case. */
import { DEMO_PROFILE as DEFAULT_PROFILE } from './fixtures/profileFixture.mjs';
import { DEFAULT_PROFILE as SCAFFOLD } from '../server/lib/db.mjs';
import demoJobs from './fixtures/jobFixtures.mjs';
import { scoreJob } from '../server/lib/match.mjs';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{}' });

const profile = DEFAULT_PROFILE;
const jobs = demoJobs.slice(0, 6).map((j, i) => ({
  ...j,
  id: `job_${i}`,
  url: i === 0 ? 'https://boards.greenhouse.io/zerodha/jobs/123' : j.url,
  match: scoreJob(j, profile, null),
  app: i === 0 ? { status: 'ready' } : null,
}));
const apps = [
  {
    id: 'app_1',
    jobId: 'job_0',
    title: 'Senior Full Stack Engineer',
    company: 'Zerodha',
    source: 'fixture',
    url: 'https://example.test/apply',
    status: 'ready',
    score: 91,
    grade: 'A+',
    letter: 'Hi team,\n\nbuilt a billing console used by 12,000 merchants.\n\nAlex',
    letterMode: 'template',
    letterWords: 12,
    answers: [{ question: 'Why are you interested?', answer: 'Because.', confidence: 0.86 }],
    matchedSkills: ['react'],
    missingSkills: ['rust'],
    flags: ['below your salary floor'],
    checklist: { warnings: ['no LLM key'], needsManual: ['dropdowns'], lowConfidenceAnswers: [] },
    prefill: { fields: { 'full.name': 'Alex Kumar' } },
    history: [{ at: new Date().toISOString(), status: 'ready' }],
    updatedAt: new Date().toISOString(),
  },
];
const appsDetailed = apps.map((a) => ({
  ...a,
  url: 'https://boards.greenhouse.io/zerodha/jobs/123',
  tailoredResume: 'Alex Kumar\nalex.kumar@example.com · +91 98100 00000\n---\nFull Stack Engineer — 5.1 yrs\nEXPERIENCE\n  • Built and shipped a self-serve billing console\n',
  tailoredPlain: 'Alex Kumar\nalex.kumar@example.com\n',
  tailoredAudit: { bullets: [{ text: 'Built', score: 13.4, matched: ['react'] }], droppedBullets: 1, skillsPromoted: ['React', 'Node.js'], untouchedRequirements: ['rust'], fabricationRisk: 'all lines traced to profile/resume' },
  insights: { insights: [{ id: 'oncall', label: 'On-call / ownership', value: 'on-call mentioned', why: 'predicts happiness' }], warnings: ['stale — check'], positives: ['early applicants'], verdict: 'good', coverage: '3/11 signals found in this posting' },
}));
const intelJob = {
  ...jobs[0],
  url: 'https://boards.greenhouse.io/zerodha/jobs/123',
  app: { status: 'ready', letter: 'Dear team…', letterMode: 'template', letterWords: 178 },
  match: { ...jobs[0].match, score: 91 },
};
const resume = {
  filename: 'resume.pdf',
  bytes: 2000,
  text: 'x'.repeat(400),
  uploadedAt: new Date().toISOString(),
  summary: { words: 300, skills: ['react', 'node.js'], experience: [{ title: 'a' }], wins: ['cut ticket volume 34%'], sections: { summary: 's' }, contact: {} },
  suggestedPatch: { changed: ['Email'], patch: { email: 'a@b.c' } },
};
const meta = {
  fields: [{ id: 'software_engineering', label: 'Software Engineering' }],
  sources: [{ key: 'adzuna', label: 'Adzuna', needsKey: true }],
  pipeline: ['queued', 'drafted', 'ready', 'submitted'],
  autoApply: { enabled: true, minScore: 70, dailyCap: 10, perSourcePerDay: 4, cooldownHours: 24, mode: 'assist' },
  counts: { total: 3, bySource: { fixture: 3 } },
  env: { dataDir: 'data' },
};
const settings = { autoApply: meta.autoApply, llm: { provider: 'none' }, sources: { adzuna: false } };
const noop = async () => {};

const cases = {
  ProfileTab: <ProfileTab profile={profile} meta={meta} setProfile={noop} refresh={noop} busy={false} />,
  ProfileTabSparse: <ProfileTab profile={{ fullName: '', skills: [], targets: {} }} meta={meta} setProfile={noop} refresh={noop} busy={false} />,
  /* A brand-new install is exactly this: the scaffold profile, so every attestation
     and answer is unset. This is the state the invented DEFAULT_PROFILE used to hide
     — the app has never rendered with a genuinely blank profile before. */
  ProfileTabFresh: <ProfileTab profile={SCAFFOLD} meta={meta} setProfile={noop} refresh={noop} busy={false} />,
  JobsTabFreshProfile: <JobsTab jobs={jobs} meta={meta} profile={SCAFFOLD} refresh={noop} busy={false} setBusy={noop} />,
  AppsTabFreshProfile: <AppsTab apps={apps} stats={{ total: 1, byStatus: { ready: 1 }, avgScore: 40, today: 0 }} pipeline={meta.pipeline} meta={meta} profile={SCAFFOLD} refresh={noop} busy={false} setBusy={noop} />,
  ResumeTab: <ResumeTab resume={resume} setResume={noop} refresh={noop} busy={false} />,
  ResumeTabEmpty: <ResumeTab resume={null} setResume={noop} refresh={noop} busy={false} />,
  JobsTab: <JobsTab jobs={jobs} meta={meta} refresh={noop} busy={false} setBusy={noop} />,
  JobsTabHarvested: (
    <JobsTab
      jobs={[
        /* exactly the shape the browser harvester produces: full-ISO postedAt (not a
           date-only string), a withheld company, pay stated but unparseable, and only
           the top of a range. Each one used to render wrong. */
        { ...jobs[0], id: 'job_h1', company: 'Company withheld', salaryMin: null, salaryMax: null, salaryText: '₹18 LPA', postedAt: new Date(Date.now() - 2 * 864e5).toISOString(), source: 'naukri', app: null },
        { ...jobs[1], id: 'job_h2', company: 'Zerodha', salaryMin: null, salaryMax: 4500000, salaryText: null, postedAt: '2026-09-15', source: 'linkedin', app: null },
      ]}
      meta={meta}
      refresh={noop}
      busy={false}
      setBusy={noop}
    />
  ),
  JobsTabEmpty: <JobsTab jobs={[]} meta={meta} refresh={noop} busy={false} setBusy={noop} />,
  AppsTab: <AppsTab apps={apps} stats={{ total: 1, byStatus: { ready: 1 }, avgScore: 91, today: 3 }} pipeline={meta.pipeline} meta={meta} refresh={noop} busy={false} setBusy={noop} />,
  AppsTabEmpty: <AppsTab apps={[]} stats={{ total: 0, byStatus: {}, avgScore: 0, today: 0 }} pipeline={meta.pipeline} meta={meta} refresh={noop} busy={false} setBusy={noop} />,
  SettingsTab: <SettingsTab settings={settings} setSettings={noop} meta={meta} refresh={noop} busy={false} setBusy={noop} />,
  SettingsTabFirstRun: <SettingsTab settings={null} setSettings={noop} meta={meta} refresh={noop} busy={false} setBusy={noop} />,
  SettingsTabSubmitOn: <SettingsTab settings={{ ...settings, atsSubmit: { enabled: true } }} setSettings={noop} meta={meta} refresh={noop} busy={false} setBusy={noop} />,
  AppsTabDetail: <AppsTab openId="app_1" submitSupport={{ support: { ok: true, kind: 'greenhouse', board: 'zerodha', jobNumber: '123' }, enabled: true, log: [{ id: 's1', at: new Date().toISOString(), company: 'Zerodha', title: 'Senior Full Stack Engineer', kind: 'greenhouse', dryRun: true, sent: false, error: null, note: 'dry run — payload reviewed, nothing sent' }] }} apps={appsDetailed} stats={{ total: 1, byStatus: { ready: 1 }, avgScore: 91, today: 3 }} pipeline={meta.pipeline} meta={meta} refresh={noop} busy={false} setBusy={noop} />,
  JobModalIntelTrim: <JobModal job={intelJob} onClose={noop} onDraft={noop} busy={false} />,
  JobModalIntel: (
    <JobModal
      initialTab="intel"
      job={intelJob}
      onClose={noop}
      onDraft={noop}
      busy={false}
      initialFull={{ job: intelJob, questions: ['Why this company?'], hasResume: true, submit: { ok: true, kind: 'greenhouse', board: 'zerodha', jobNumber: '123' } }}
      initialIntel={{
        research: { insights: [{ id: 'oncall', label: 'On-call / ownership', value: 'on-call mentioned', why: 'best predictor of daily happiness' }], warnings: ['no range published'], positives: ['early applicants get read first'], verdict: 'good', coverage: '4/11 signals found in this posting' },
        match: { score: 93, grade: 'A+', delta: 2, applied: ['posted <4 days ago', 'publishes benefits detail'] },
      }}
      initialTailored={{
        tailored: 'Alex Kumar\n\nEXPERIENCE\n  • Built a billing console\n',
        plain: 'Alex Kumar\nEXPERIENCE\n  - Built a billing console\n',
        audit: { skillsPromoted: ['React', 'Grafana'], bullets: [{ text: 'Built', score: 13.4 }, { text: 'Led', score: 10 }], droppedBullets: 2, untouchedRequirements: ['kubernetes'], fabricationRisk: 'all lines traced to profile/resume' },
      }}
    />
  ),
};

let bad = 0;
let bytes = 0;
for (const [name, el] of Object.entries(cases)) {
  try {
    const html = renderToString(el);
    bytes += html.length;
    if (html.length < 400) throw new Error('suspiciously tiny render');
    const markers = {
      AppsTabDetail: ['tailored resume', 'direct ATS submit', 'what this posting reveals', 'preview payload'],
      JobModalIntel: ['job intel', 'On-call / ownership', 'tailored resume for this posting', 'bullets ranked', '4/11 signals', '93', 'Grafana', 'direct submit'],
      JobModalIntelTrim: ['job intel'],
      JobsTab: ['api-apply'],
      /* '2d ago' rather than a date: the marker that proves a full-ISO postedAt
         rendered as a real age. "🗓 —" was the bug this case exists to catch —
         it came from `postedAt + 'T00:00:00Z'` producing an unparseable string. */
      JobsTabHarvested: ['needs a click', '₹18 LPA', 'naukri', 'linkedin', '2d ago'],
      SettingsTabSubmitOn: ['Direct ATS submit', 'what it will never do'],
      SettingsTab: ['Import jobs', 'has a public jobs API', 'partner-OAuth', 'use sample'],
    }[name];
    for (const m of markers || []) if (!html.includes(m)) throw new Error(`missing "${m}" in render`);
    if (name === 'JobModalIntel' && !/read the posting|loading/.test(html)) {
      /* empty state is legitimate: intel loads on demand */
    }
    console.log(`  \x1b[32m✓\x1b[0m ${name.padEnd(18)} ${html.length} bytes`);
  } catch (e) {
    bad++;
    console.log(`  \u001b[31m✗\x1b[0m ${name.padEnd(18)} ${String(e.message).split('\n')[0]}`);
  }
}
console.log(`\n\x1b[1m${Object.keys(cases).length - bad} tab states render (${bytes} bytes total), ${bad} failed\x1b[0m\n`);
process.exit(bad ? 1 : 0);
