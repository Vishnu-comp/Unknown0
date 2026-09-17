/**
 * "Alex Kumar" — the profile that used to be `DEFAULT_PROFILE`.
 *
 * It is a complete invented person: contact details, two employers, twelve
 * self-rated skills, a ₹18 LPA salary floor and consent boxes ticked. Tests need
 * that richness (a profile with nothing in it exercises nothing), but shipping it
 * as the default meant a fresh install scored every job against someone else's
 * career, wrote that career into cover letters, and asserted background-check
 * consent the user never gave.
 *
 * The shipped default is now a scaffold: structure and neutral settings, no facts
 * about a person. See DEFAULT_PROFILE in server/lib/db.mjs.
 */
export const DEMO_PROFILE = {
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
}
