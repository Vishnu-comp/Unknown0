/**
 * Tiny file-backed JSON store with atomic writes.
 * Zero deps, easy to swap for Postgres/SQLite in production.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export function uid(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

export function read(name, fallback) {
  const file = path.join(DATA_DIR, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function write(name, value) {
  const file = path.join(DATA_DIR, `${name}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
  return value;
}

export function dataDir() {
  return DATA_DIR;
}

/* ----------------------------- default profile ---------------------------- */

/**
 * The profile a brand-new install gets. Deliberately a scaffold, not a person:
 * every field the app cannot know is empty, and the two legal attestations
 * (work authorisation, data-processing consent) are *absent* rather than false —
 * `null` means "ask me", `false` would itself be an assertion, and `true` was
 * the bug this file used to ship.
 *
 * What is set here is preference and plumbing, not biography: the search
 * parameters, a sane daily cap, and the letter template with its {placeholders}
 * intact (the composer refuses to write a sentence that starts from a blank).
 */
export const DEFAULT_PROFILE = {
  fullName: '',
  email: '',
  phone: '',
  linkedin: '',
  github: '',
  portfolio: '',
  location: { city: '', state: '', country: '' },
  openToRelocate: null,
  remotePreference: 'any', // remote | hybrid | onsite | any
  willingToSponsor: null,
  needSponsorship: null,
  workAuth: [],
  linkedinHeadline: '',
  experience: [],
  education: [],
  skills: [],
  targets: {
    fields: [],
    titleKeywords: [],
    excludeKeywords: [],
    minSalary: null, // never a guessed number: it feeds the salary answer and the score
    salaryCurrency: 'INR',
    seniority: [],
    jobTypes: ['full_time'],
    locations: [],
    maxCommute: 'no constraint',
    companiesTarget: [],
    companiesAvoid: [],
    minYearsExperience: null,
    maxApplicationsPerDay: 10,
  },
  boolAnswers: {},
  freeTextAnswers: {
    whyCompanyTemplate:
      'I am drawn to {company} because {hook}. In my current role at {currentCompany} I {transferable}, which maps directly onto what this team is doing with {area}.',
  },
  diversity: { veteran: 'prefer not to say', disability: 'prefer not to say', ethnicity: 'prefer not to say' },
  references: [],
  primaryField: null,
};

export const FIELDS = [
  { id: 'software_engineering', label: 'Software Engineering', tags: ['software engineer', 'sde', 'developer', 'backend', 'frontend', 'full stack'] },
  { id: 'platform_engineering', label: 'Platform / DevOps / SRE', tags: ['devops', 'sre', 'platform', 'infrastructure', 'cloud engineer'] },
  { id: 'data_science', label: 'Data Science / AI', tags: ['data scientist', 'machine learning', 'ai engineer', 'ml', 'llm'] },
  { id: 'data_engineering', label: 'Data Engineering / Analytics', tags: ['data engineer', 'analytics engineer', 'etl', 'dbt', 'spark'] },
  { id: 'product_management', label: 'Product Management', tags: ['product manager', 'associate product manager', 'technical pm'] },
  { id: 'product_design', label: 'Product / UX Design', tags: ['product designer', 'ux', 'ui designer', 'figma'] },
  { id: 'marketing_growth', label: 'Marketing / Growth', tags: ['growth', 'seo', 'performance marketing', 'content'] },
  { id: 'sales', label: 'Sales / GTM', tags: ['account executive', 'sdr', 'sales', 'go-to-market'] },
  { id: 'finance_analytics', label: 'Finance / FP&A', tags: ['financial analyst', 'fp&a', 'accounting', 'audit'] },
  { id: 'qa_testing', label: 'QA / Testing', tags: ['qa', 'test engineer', 'sDET', 'automation testing'] },
  { id: 'mobile_engineering', label: 'Mobile Engineering', tags: ['android', 'ios', 'react native', 'flutter'] },
  { id: 'cybersecurity', label: 'Security', tags: ['security engineer', 'appsec', 'soc', 'pentest'] },
];

/* --------------------------------- helpers -------------------------------- */

export function getProfile() {
  const stored = read('profile', null);
  if (stored) return stored;
  write('profile', DEFAULT_PROFILE);
  return DEFAULT_PROFILE;
}

/**
 * A profile PUT/PATCH may carry only part of an object (e.g. just `targets`).
 * Shallow-merging would wipe its siblings — the letter composer then dies on a
 * missing `freeTextAnswers.salaryExpectation`. So nested groups are merged
 * individually; arrays are still replaced wholesale (that is what "set my
 * skills" means).
 */
const DEEP_KEYS = ['targets', 'freeTextAnswers', 'boolAnswers', 'location', 'diversity', 'ats'];
export function saveProfile(patch) {
  const cur = getProfile();
  const merged = { ...cur, ...patch };
  for (const k of DEEP_KEYS) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) merged[k] = { ...(cur[k] || {}), ...patch[k] };
  }
  return write('profile', merged);
}

export function getSettings() {
  return read(
    'settings',
    {
      autoApply: { enabled: false, minScore: 70, dailyCap: 10, perSourcePerDay: 4, cooldownHours: 24, mode: 'assist' },
      llm: { provider: 'none', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      sources: { githubArchive: true, adzuna: false, jooble: false, greenhouseBoards: [], leverCompanies: [] },
      notificationEmail: '',
      atsSubmit: { enabled: false, requireResumeFile: true, note: 'Only public Greenhouse/Lever apply APIs. LinkedIn/Indeed/Workday are excluded by design.' },
    }
  );
}

export function saveSettings(patch) {
  const s = getSettings();
  const merged = { ...s, ...patch, autoApply: { ...s.autoApply, ...(patch.autoApply || {}) }, llm: { ...s.llm, ...(patch.llm || {}) }, sources: { ...s.sources, ...(patch.sources || {}) } };
  return write('settings', merged);
}

export function getApplications() {
  return read('applications', []);
}

export function saveApplications(list) {
  return write('applications', list);
}

export function getJobs() {
  return read('jobs', []);
}

export function saveJobs(list) {
  return write('jobs', list);
}

/* Removing the bundled demo corpus from the code does not remove it from a disk that
   was written while the code still had it: data/jobs.json is a local store, so jobs
   with `source:'demo'` (and the ids the old seed route gave them) survive the upgrade
   and keep scoring next to real postings — looking like data, invented. The runtime
   ingest path can never produce that source, so anything tagged this way is synthetic
   and is deleted once at boot rather than left to rot into the rankings. */
export function purgeDemoJobs() {
  const jobs = read('jobs', []);
  if (!Array.isArray(jobs) || !jobs.length) return { removed: 0, total: 0 };
  const isDemo = (j) =>
    j?.source === 'demo' || j?.source === 'fixture' ||
    /^job_demo_/.test(String(j?.id || '')) || /^demo_\d+$/.test(String(j?.id || ''));
  const kept = jobs.filter((j) => !isDemo(j));
  const removed = jobs.length - kept.length;
  if (removed) {
    write('jobs', kept);
    const apps = read('applications', []);
    const orphans = kept.length && Array.isArray(apps)
      ? apps.filter((a) => !kept.some((j) => j.extId === a.jobExtId || j.id === a.jobId)).length
      : apps.length;
    return { removed, total: kept.length, orphans };
  }
  return { removed: 0, total: jobs.length };
}

export function getResume() {
  return read('resume', null);
}

export function saveResume(doc) {
  return write('resume', doc);
}
