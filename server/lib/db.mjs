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

export const DEFAULT_PROFILE = {
  fullName: 'Alex Kumar',
  email: 'alex.kumar@example.com',
  phone: '+91 98100 00000',
  linkedin: 'https://linkedin.com/in/alexkumar',
  github: 'https://github.com/alexkumar',
  portfolio: 'https://alexkumar.dev',
  location: { city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  openToRelocate: true,
  remotePreference: 'hybrid',            // remote | hybrid | onsite | any
  willingToSponsor: false,
  needSponsorship: false,
  workAuth: ['India', 'Open to relocation (EU Blue Card eligible)'],
  linkedinHeadline: 'Software Engineer — Full Stack (React, Node, AWS)',
  experience: [
    {
      company: 'Nimbus Labs',
      title: 'Software Engineer II',
      location: 'Bengaluru, India',
      start: '2023-03',
      end: '',
      current: true,
      bullets: [
        'Built and shipped a self-serve billing console (React + Node + Postgres) used by 12k merchants, cutting support tickets 34%.',
        'Migrated 40+ REST endpoints to typed OpenAPI contracts; regression escapes down from 9 to 1 per quarter.',
        'Led observability rollout (OpenTelemetry + Grafana), reducing p95 error-rate alert noise by 60%.',
      ],
    },
    {
      company: 'FinEdge',
      title: 'Software Engineer Intern → SDE I',
      location: 'Gurugram, India',
      start: '2021-07',
      end: '2023-02',
      current: false,
      bullets: [
        'Shipped KYC document pipeline processing 80k/day with Node, S3 and Textract; p99 latency 1.9s.',
        'Wrote integration test harness that halved release QA time.',
      ],
    },
  ],
  education: [
    {
      school: 'Vellore Institute of Technology',
      degree: 'B.Tech, Computer Science',
      start: '2017',
      end: '2021',
      gpa: '8.4/10',
      highlights: ['ACM chapter lead', 'Minor in Statistics'],
    },
  ],
  skills: [
    { name: 'JavaScript / TypeScript', level: 5, core: true },
    { name: 'React', level: 5, core: true },
    { name: 'Node.js', level: 5, core: true },
    { name: 'PostgreSQL', level: 4, core: true },
    { name: 'AWS (ECS, Lambda, S3, RDS)', level: 4, core: false },
    { name: 'Docker', level: 4, core: false },
    { name: 'CI/CD (GitHub Actions)', level: 4, core: false },
    { name: 'GraphQL', level: 3, core: false },
    { name: 'Python', level: 3, core: false },
    { name: 'System design', level: 3, core: false },
    { name: 'Jest / Playwright', level: 4, core: false },
    { name: 'SQL', level: 4, core: true },
  ],
  targets: {
    fields: ['software_engineering', 'platform_engineering', 'full_stack'],
    titleKeywords: ['software engineer', 'full stack', 'backend engineer', 'frontend engineer'],
    excludeKeywords: ['sales', 'call center', '.net', 'magento', 'freelance', 'unpaid', 'manager'],
    minSalary: 1800000,                  // annual, INR
    salaryCurrency: 'INR',
    seniority: ['mid', 'senior'],         // intern | junior | mid | senior | staff
    jobTypes: ['full_time'],              // full_time | contract | internship
    locations: ['Bengaluru', 'Remote (India)', 'Remote (Worldwide)', 'Pune', 'Hyderabad'],
    maxCommute: 'no constraint',
    companiesTarget: ['product', 'faang-adjacent', 'startup-series-b+'],
    companiesAvoid: ['staffing', 'IT services MNC', 'BPO'],
    minYearsExperience: 2,
    maxApplicationsPerDay: 10,
  },
  boolAnswers: {
    authorizedToWork: true,
    requireSponsorship: false,
    legallyAge18: true,
    willingToRelocate: true,
    consentBackgroundCheck: true,
    consentDataProcessing: true,
    isVeteran: 'no',
    genderEthnicitySelfId: 'prefer not to say',
    maxNoticePeriodWeeks: 4,
  },
  freeTextAnswers: {
    whyCompanyTemplate:
      'I am drawn to {company} because {hook}. In my current role at {currentCompany} I {transferable}, which maps directly onto what this team is doing with {area}.',
    salaryExpectation: '₹{expected} per annum, negotiable with benefits and ESOPs.',
    noticePeriod: '4 weeks',
    howDidYouHear: 'ApplyFlow job matching',
    areYouLegallyAble: 'Yes',
    requireVisaSponsorshipNowOrFuture: 'No',
    linkedinOrPortfolio: '{portfolio} | {github} | {linkedin}',
  },
  diversity: { veteran: 'no', disability: 'prefer not to say', ethnicity: 'prefer not to say' },
  references: [],
  primaryField: 'software_engineering',
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

export function getResume() {
  return read('resume', null);
}

export function saveResume(doc) {
  return write('resume', doc);
}
