/**
 * Demo corpus — realistic-shaped postings so the matcher, letter composer and
 * pipeline are testable with zero API keys. Fields deliberately include
 * requirements the default profile does/doesn't satisfy, and two postings the
 * matcher should penalise (sales, unpaid "internship") so you can see it work.
 */
const D = (o) => o;

const jobs = [
  D({
    id: 'demo_1',
    source: 'demo',
    title: 'Senior Full Stack Engineer',
    company: 'Zerodha Technologies',
    location: 'Bengaluru, India',
    remote: false,
    // demo_1 deliberately lives on a public ATS board so the direct-submit path is
    // exercisable in the demo corpus (see server/lib/atsSubmit.mjs)
    url: 'https://boards.greenhouse.io/zerodha/jobs/4182233',
    category: 'Engineering',
    contractType: 'full_time',
    postedAt: dateAgo(2),
    salaryMin: 3800000,
    salaryMax: 5600000,
    salaryCurrency: 'INR',
    tags: ['react', 'node.js', 'postgresql', 'aws'],
    description: `About the role
You will own end-to-end delivery of customer-facing features across our trading and reporting products. That means React front ends, Node services, Postgres schemas, and being on call for what you ship.

What you'll do
- Design and build features with React and TypeScript, backed by Node.js services
- Model Postgres schemas for high-throughput financial data and keep queries honest
- Ship to AWS (ECS, RDS, S3) with GitHub Actions, blue/green, and real rollback plans
- Reduce p95 latency and error rates; you will own dashboards and alerts, not just tickets
- Partner with two product designers and a data engineer on roadmap shaping

Requirements
- 4+ years of professional experience building production software
- Deep React and Node.js in production; PostgreSQL beyond CRUD
- Experience with AWS or GCP, Docker, CI/CD pipelines
- Comfortable with observability: OpenTelemetry, Grafana, Prometheus
- Bonus: GraphQL, Kafka, event-driven architectures, fintech domain experience

We do not provide visa sponsorship for this role. We read applications from anyone, but we reply within five working days only to shortlisted profiles.`,
    applyEmail: 'careers@zerodha-demo.example',
    questions: ['Why are you interested in Zerodha?', 'What is your expected CTC?', 'What is your notice period?'],
  }),
  D({
    id: 'demo_2',
    source: 'demo',
    title: 'Backend Engineer, Platform (Node/Go)',
    company: 'Razorpay',
    location: 'Remote (India)',
    remote: true,
    url: 'https://www.razorpay.com/careers/backend-platform-engineer',
    category: 'Engineering',
    contractType: 'full_time',
    postedAt: dateAgo(1),
    salaryMin: 3200000,
    salaryMax: 4800000,
    salaryCurrency: 'INR',
    tags: ['node.js', 'golang', 'kafka', 'kubernetes'],
    description: `About the team
Payments platform: the services every merchant and every internal team builds on. Reliability is the product.

Responsibilities
- Build and harden payment orchestration services in Node.js and Go
- Design idempotent, event-driven flows on Kafka with exactly-once semantics where it matters
- Own Kubernetes deployments, autoscaling, and on-call rotation for your services
- Cut payment failure rates: measure, hypothesise, ship, verify
- Write design docs that survive a review from three senior engineers

Requirements
- 3+ years experience with distributed backend systems
- Node.js or Go in production; PostgreSQL; Redis; message queues
- Kubernetes and Terraform in real infrastructure, not toy clusters
- Strong testing culture: contract tests, load tests, chaos drills
- Experience with PCI-DSS or financial systems is a plus

Why join us: we are building India's default rails for online payments and we would rather hire five great engineers than fifty average ones.`,
    questions: ['Describe a system you made more reliable.', 'Do you have experience with Kafka?'],
  }),
  D({
    id: 'demo_3',
    source: 'demo',
    title: 'Software Engineer II (Full Stack)',
    company: 'Zomato',
    location: 'Gurugram, India',
    remote: false,
    url: 'https://www.zomato.com/careers/swe-ii-fullstack',
    category: 'Engineering',
    contractType: 'full_time',
    postedAt: dateAgo(6),
    salaryMin: 2600000,
    salaryMax: 3600000,
    salaryCurrency: 'INR',
    tags: ['react', 'node.js', 'mysql', 'docker'],
    description: `Role
Join the ordering & supply team. You will ship features used by tens of millions of users per month, work closely with PMs, and be expected to write the SQL that backs your dashboards.

Requirements
- 2-4 years of experience in full stack development
- React + TypeScript, Node.js, MySQL or PostgreSQL
- Docker, CI/CD with GitHub Actions or Jenkins
- Ability to read a flame graph. Curiosity is non-negotiable.
- You are legally authorized to work in India and this role requires no sponsorship.

Nice to have: GraphQL, Redis, Kafka, load testing with k6.`,
  }),
  D({
    id: 'demo_4',
    source: 'demo',
    title: 'Senior Data Scientist — Growth Experimentation',
    company: 'Swiggy',
    location: 'Bengaluru, India (Hybrid)',
    remote: false,
    url: 'https://www.swiggy.com/careers/senior-data-scientist-growth',
    category: 'Data',
    contractType: 'full_time',
    postedAt: dateAgo(4),
    salaryMin: 3400000,
    salaryMax: 5200000,
    salaryCurrency: 'INR',
    tags: ['python', 'machine learning', 'sql', 'ab testing'],
    description: `You will design and analyse A/B tests for orders growth, build uplift models, and own the experimentation platform's statistical correctness.

Requirements
- 3+ years of experience in data science or analytics engineering roles
- Python (pandas, numpy, scikit-learn), advanced SQL, Airflow or dbt
- Causal inference: difference-in-differences, synthetic control, sequential testing
- Spark/Bigquery at scale; Snowflake or Redshift modelling
- Shipping models to production with MLflow or Sagemaker is a plus

Must have excellent written communication; you will present to a VP monthly.`,
  }),
  D({
    id: 'demo_5',
    source: 'demo',
    title: 'Analytics Engineer (dbt / Snowflake)',
    company: 'Meesho',
    location: 'Bengaluru, India',
    remote: true,
    url: 'https://www.meesho.io/careers/analytics-engineer',
    category: 'Data',
    contractType: 'full_time',
    postedAt: dateAgo(9),
    salaryMin: 2800000,
    salaryMax: 4000000,
    salaryCurrency: 'INR',
    tags: ['sql', 'dbt', 'snowflake', 'python', 'airflow'],
    description: `Own the semantic layer that 60 analysts query every day.

Requirements
- 2-4 years experience in analytics or data engineering
- Advanced SQL, dbt models with tests and documentation, Snowflake or BigQuery
- Python for transformations; Airflow DAG ownership
- Experience with Looker or Tableau for consumption
- Data contracts, SLAs, and incident management with analytics teams`,
  }),
  D({
    id: 'demo_6',
    source: 'demo',
    title: 'Site Reliability Engineer (Platform)',
    company: 'Postman',
    location: 'Bangalore, India / Remote (APAC)',
    remote: true,
    url: 'https://www.postman.com/careers/sre-platform',
    category: 'Engineering',
    contractType: 'full_time',
    postedAt: dateAgo(3),
    salaryMin: 4000000,
    salaryMax: 6000000,
    salaryCurrency: 'INR',
    tags: ['kubernetes', 'terraform', 'observability', 'golang', 'aws'],
    description: `Keep 300+ microservices boring.

Requirements
- 3+ years of experience in SRE / platform / DevOps roles
- Kubernetes at scale, Terraform, AWS EKS, Helm
- Go or Python for tooling; you write your own operators
- Prometheus, Grafana, OpenTelemetry, SLO design and error budgets
- On-call leadership, incident command, blameless postmortems
- Security mindset: IAM, secrets management, supply chain (Sigstore, SBOM)`,
  }),
  D({
    id: 'demo_7',
    source: 'demo',
    title: 'Product Designer (Fintech, Mid-Senior)',
    company: 'CRED',
    location: 'Bengaluru, India',
    remote: false,
    url: 'https://careers.cred.club/designer',
    category: 'Design',
    contractType: 'full_time',
    postedAt: dateAgo(5),
    salaryMin: 2400000,
    salaryMax: 3600000,
    salaryCurrency: 'INR',
    tags: ['figma', 'design systems', 'usability testing', 'prototyping'],
    description: `You will redesign the repayment journey for 12M users and extend our design system.

Requirements
- 3-6 years of product design experience, shipped consumer apps
- Figma, design systems, interaction prototypes, accessibility (WCAG 2.2 AA)
- Comfortable with analytics and usability testing to defend decisions
- Portfolio with 3 case studies showing before/after metrics — required
- HTML/CSS literacy to pair with engineers`,
  }),
  D({
    id: 'demo_8',
    source: 'demo',
    title: 'Associate Product Manager (Technical)',
    company: 'PhonePe',
    location: 'Bengaluru, India',
    remote: false,
    url: 'https://www.phonepe.com/careers/apm',
    category: 'Product',
    contractType: 'full_time',
    postedAt: dateAgo(8),
    salaryMin: 2200000,
    salaryMax: 3200000,
    salaryCurrency: 'INR',
    tags: ['product management', 'analytics', 'sql', 'roadmap'],
    description: `Own a payments surface end to end: discovery, spec, rollout, P&L.

Requirements
- 1-3 years in a technical role (engineering, analytics, or PM associate)
- SQL for your own analysis; you do not wait for a data team
- Written communication: your PRD is your code review
- Interest in UPI, merchant acquiring, or regulated fintech
- Bonus: previous startup experience or side projects with real users`,
  }),
  D({
    id: 'demo_9',
    source: 'demo',
    title: 'Growth Marketing Manager (Performance)',
    company: 'Zepto',
    location: 'Mumbai, India',
    remote: false,
    url: 'https://www.zepto.com/careers/growth-marketing-manager',
    category: 'Marketing',
    contractType: 'full_time',
    postedAt: dateAgo(7),
    salaryMin: 2000000,
    salaryMax: 3000000,
    salaryCurrency: 'INR',
    tags: ['seo', 'google analytics', 'a/b testing', 'sem'],
    description: `Own paid + lifecycle growth for quick-commerce in 4 cities.

Requirements
- 3-6 years in performance marketing, ideally in consumer apps
- Google Ads, Meta Ads, GA4, AppsFlyer, SQL for cohort analysis
- Landing page experimentation with a design partner
- CAC/LTV modelling in spreadsheets you actually maintain`,
  }),
  D({
    id: 'demo_10',
    source: 'demo',
    title: 'Inside Sales Representative (SDR)',
    company: 'LeadGenix Solutions',
    location: 'Noida, India',
    remote: false,
    url: 'https://leadgenix.example/careers/sdr',
    category: 'Sales',
    contractType: 'full_time',
    postedAt: dateAgo(2),
    salaryMin: 450000,
    salaryMax: 700000,
    salaryCurrency: 'INR',
    tags: ['sales development', 'lead generation', 'cold calling'],
    description: `Outbound calling to SMEs. 60 dials a day. English fluency required.

Requirements
- 1+ years of experience in inside sales or a BPO environment
- Comfortable with sales development tooling and lead generation lists
- Night shift (US hours) mandatory
- This role is based in Noida; no remote work. We do not provide sponsorship.`,
  }),
  D({
    id: 'demo_11',
    source: 'demo',
    title: 'Unpaid Frontend Developer Intern (Portfolio Build)',
    company: 'StartupFactory Collective',
    location: 'Remote',
    remote: true,
    url: 'https://startupfactory.example/intern-unpaid-frontend',
    category: 'Engineering',
    contractType: 'internship',
    postedAt: dateAgo(11),
    tags: ['react', 'html', 'css'],
    description: `Great learning opportunity! You will build React components for our founders' MVPs. This is an unpaid volunteer position with "exposure" and a letter of completion. Equity only, no stipend. Looking for freshers who are passionate.`,
  }),
  D({
    id: 'demo_12',
    source: 'demo',
    title: 'Software Engineer (New Grad), Payments Infrastructure',
    company: 'Wise',
    location: 'Remote (Worldwide)',
    remote: true,
    url: 'https://jobs.lever.co/wise/7f3a91c2-5d40-4b1e-9c6b-softwareengineer',
    category: 'Engineering',
    contractType: 'full_time',
    postedAt: dateAgo(1),
    salaryMin: 90000,
    salaryMax: 120000,
    salaryCurrency: 'USD',
    tags: ['java', 'kotlin', 'postgresql', 'aws', 'microservices'],
    description: `Join the team that moves 200 billion dollars a year between banks.

Requirements
- 0-2 years of professional experience (internships count)
- Java or Kotlin, SQL, distributed systems fundamentals
- You can reason about consistency, retries, idempotency
- Excellent written communication across timezones
- Note: Wise sponsors visas in some countries; eligibility depends on location.`,
  }),
  D({
    id: 'demo_13',
    source: 'demo',
    title: 'Junior QA Automation Engineer (Selenium)',
    company: 'QA People (Staffing)',
    location: 'Pune, India',
    remote: false,
    url: 'https://qapeople.example/junior-qa',
    category: 'QA',
    contractType: 'full_time',
    postedAt: dateAgo(14),
    salaryMin: 420000,
    salaryMax: 600000,
    salaryCurrency: 'INR',
    tags: ['selenium', 'java', 'testng'],
    description: `Client-rotation role. Manual regression with some Selenium scripting.

Requirements
- 0-2 years of experience in automation testing
- Selenium WebDriver, TestNG, Java basics
- Willingness to be deployed to a client location in Pune (onsite, 6 days)
- Staffing model: your offer letter comes from QA People, not the client.`,
  }),
  D({
    id: 'demo_14',
    source: 'demo',
    title: 'Machine Learning Engineer, LLM Platform',
    company: 'Sarvam AI',
    location: 'Bengaluru, India (Hybrid)',
    remote: false,
    url: 'https://sarvamai.example/careers/mle-llm',
    category: 'AI/ML',
    contractType: 'full_time',
    postedAt: dateAgo(3),
    salaryMin: 4200000,
    salaryMax: 7200000,
    salaryCurrency: 'INR',
    tags: ['python', 'pytorch', 'llm', 'rag', 'mlops', 'kubernetes'],
    description: `Serve Indic LLMs at 40M+ daily requests.

Requirements
- 2+ years of experience shipping ML systems, or strong backend engineering + ML side work
- Python, PyTorch, inference optimisation (vLLM, quantisation, batching)
- RAG pipelines, embeddings, vector stores (pgvector, Qdrant)
- Kubernetes, GPU scheduling, MLOps with MLflow; AWS or GCP
- Eval harnesses you trust: you will own our regression suite for quality
- Research background welcome; production judgement required`,
  }),
  D({
    id: 'demo_15',
    source: 'demo',
    title: 'Financial Analyst (FP&A)',
    company: 'Avenue Blocks',
    location: 'Chennai, India',
    remote: false,
    url: 'https://avenueblocks.example/careers/fpa-analyst',
    category: 'Finance',
    contractType: 'full_time',
    postedAt: dateAgo(10),
    salaryMin: 1200000,
    salaryMax: 1800000,
    salaryCurrency: 'INR',
    tags: ['financial modeling', 'excel', 'sap', 'forecasting'],
    description: `Own monthly close analytics and 13-week cash forecasting for a retail chain.

Requirements
- 1-4 years of experience in FP&A or audit
- Advanced Excel, financial modeling, SAP or Oracle, Power BI
- CA-inter / MBA Finance preferred
- Strong attention to detail; GAAP / Ind AS knowledge`,
  }),
  D({
    id: 'demo_16',
    source: 'demo',
    title: 'Mobile Engineer (React Native)',
    company: 'CRED',
    location: 'Bengaluru, India',
    remote: true,
    url: 'https://careers.cred.club/mobile-rn',
    category: 'Engineering',
    contractType: 'full_time',
    postedAt: dateAgo(5),
    salaryMin: 3000000,
    salaryMax: 4500000,
    salaryCurrency: 'INR',
    tags: ['react native', 'typescript', 'mobile'],
    description: `Ship the CRED app to 15M installs with a 10ms interaction budget on mid-range Android.

Requirements
- 2-5 years experience with React Native or Flutter in production
- TypeScript, performance profiling, native module bridging
- CI pipelines for TestFlight / Play internal tracks, feature flags
- Accessibility and offline-first experience valued`,
  }),
];

function dateAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export default jobs;
