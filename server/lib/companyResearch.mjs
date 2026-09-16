/**
 * Job intelligence: what the posting itself reveals — extracted, not guessed.
 * Signals come from text we already ingested, plus one optional public call
 * (Greenhouse board content API: no key, no login, no scraping of a feed).
 */
import { normalize, extractPhrases } from './text.mjs';

const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT_MS || 9000);

const RULES = [
  {
    id: 'funding_stage',
    label: 'Stage',
    test: (t) => {
      const m = t.match(/\bseries\s+([a-f])\b/i);
      if (m) return `Series ${m[1].toUpperCase()}`;
      if (/\bpre-?seed\b/i.test(t)) return 'Pre-seed';
      if (/\bseed[\s-]stage\b|\braised \$?\d+[km]?\s*(at|in)\s*seed\b/i.test(t)) return 'Seed';
      if (/\bpublic company\b|\bnasdaq:|bse:|nse:|\bnyse:|\blisted\b/i.test(t)) return 'Public';
      if (/\bbootstrapp?ed\b|\bprofitabl(e|e) since\b|\bno outside funding\b/i.test(t)) return 'Bootstrapped';
      if (/\bacqui(hired|sition|sitioned)\b/i.test(t)) return 'Acquired / inside a larger co';
      return null;
    },
    why: 'stage predicts hiring velocity, process length and equity value',
  },
  {
    id: 'size',
    label: 'Headcount',
    test: (t) => {
      const m = t.match(/\b(\d{1,3}(,\d{3})?k?|\d+(?:,\d{3})?)\s*(?:[-+]\s*\d+k?)?\s*(?:employees|people|engineers|headcount|staff)\b/i);
      if (m) return `~${m[1]} ${/engineers/i.test(m[0]) ? 'engineers' : 'employees'}`;
      const g = t.match(/\bwe are (?:a|an)\s+(\d{1,3})[- ]person\b/i);
      if (g) return `~${g[1]} people`;
      return null;
    },
    why: 'a 40-person team means you touch everything; 4,000 means process',
  },
  {
    id: 'oncall',
    label: 'On-call / ownership',
    test: (t) => {
      if (/no\s+(24x7|on-?call|oncall)|without\s+on-?call\b/i.test(t)) return 'explicitly no on-call';
      if (/on-?call|rotations?\b|pagerduty|incident (command|response)|error budget/i.test(t)) return 'on-call / incident ownership mentioned';
      return null;
    },
    why: 'the single best predictor of day-to-day happiness in infra-ish roles',
  },
  {
    id: 'salary_transparency',
    label: 'Pay transparency',
    test: (t, job) => {
      if (job?.salaryMin) return `stated: ${job.salaryMin.toLocaleString()}${job.salaryMax ? `–${job.salaryMax.toLocaleString()} ${job.salaryCurrency || ''}` : ` ${job.salaryCurrency || ''}`}`;
      if (/competitive (salary|compensation)|doe|salary range (will be )?discussed/i.test(t)) return 'deliberately unstated';
      return null;
    },
    why: 'unpaid ranges + "competitive" is a filter you should price in',
  },
  {
    id: 'remote_reality',
    label: 'Remote, honestly read',
    test: (t, job) => {
      const hybrid = /hybrid|(\d)\s*days?\s*a?\s*(week|in.?office)|office[- ]first/i.test(t);
      const onsite = /this role is (fully )?onsite|must be (located|based)|work from office 5|relocation required/i.test(t);
      const remote = /\bremote\b|anywhere|work from anywhere|distributed (team|company)/i.test(t);
      if (onsite && !remote) return 'onsite in practice';
      if (remote && hybrid) return 'remote-leaning hybrid (expect some office days)';
      if (job?.remote && !hybrid) return 'remote, no office strings in the text';
      if (hybrid) return 'hybrid — check which days and which office';
      return null;
    },
    why: '“remote” in the tag and “3 days in office” in the body are different jobs',
  },
  {
    id: 'pay_structure',
    label: 'Pay structure',
    test: (t, job) => {
      if (/\bunpaid\b|volunteer position|equity only|no stipend|stipend: *0/i.test(t)) return '⚠ unpaid / volunteer — never apply through this';
      if (/\bstipend\b/i.test(t) && !job?.salaryMin) return 'stipend-based (internship pay)';
      if (!job?.salaryMin && /\b(competitive|market[- ]leading|doe|negotiable)\b/i.test(t)) return 'no range published — expect lowball anchoring';
      return null;
    },
    why: 'unpaid and "competitive" are the two labels that waste a whole application',
  },
  {
    id: 'recruiter_load',
    label: 'Hiring-process tell',
    test: (t) => {
      const rounds = (t.match(/\b(\d)\s*(?:technical\s*)?(?:interview|round|loop|stage)s?\b/gi) || []).length;
      const mentions = [
        /take[- ]home|assignment|paid trial|work sample/i,
        /\bleetCode\b|data structures and algorithms|\bDSA\b|whiteboard/i,
        /system design|design doc/i,
        /(\d+)\s*week[s]?\s*(?:process|hiring|to decision)/i,
        /will not reply|only shortlisted|do not call/i,
      ].filter((rx) => rx.test(t)).length;
      const bits = [];
      if (/take[- ]home|assignment|paid trial|work sample/i.test(t)) bits.push('take-home');
      if (/\bleetcode\b|data structures and algorithms|\bdsa\b|whiteboard/i.test(t)) bits.push('algo round');
      if (/system design|design doc/i.test(t)) bits.push('design round');
      if (/only shortlisted|will not reply|do not call/i.test(t)) bits.push('no-reply policy');
      if (rounds) bits.push(`${rounds} round(s) named`);
      return bits.length ? bits.join(' · ') : mentions ? 'process described vaguely' : null;
    },
    why: 'tells you how many evenings this will cost you',
  },
  {
    id: 'tech_specificity',
    label: 'How real the stack list is',
    test: (t) => {
      const stack = extractPhrases(t);
      const kitchenSink = /proficien\w+\s+(in\s+)?(any|all)\s+of|familiarity with (one|any)/i.test(t);
      if (stack.length >= 12 && kitchenSink) return `stack shotgunning (${stack.length} technologies listed)`;
      if (stack.length >= 5) return `specific stack named (${stack.length})`;
      if (stack.length <= 1) return `only ${stack.length} technology named — thin spec, likely a requisition dump`;
      return `no technology named at all — likely a staffing/requisition dump`;
    },
    why: 'a 30-technology list means nobody on the team wrote this',
  },
  {
    id: 'urgency',
    label: 'Urgency / freshness',
    test: (t, job) => {
      if (/immediate(ly)? (join|start)|urgent hiring|looking to fill this (role )?(this week|asap)/i.test(t)) return 'urgent / ASAP — can also mean someone quit';
      if (/rolling (basis|admission)|ongoing hiring|pipeline for (the )?(next|coming)/i.test(t)) return 'rolling pipeline — slower feedback';
      if (job?.postedAt) {
        const days = Math.round((Date.now() - Date.parse(job.postedAt)) / 86400000);
        if (days > 25) return `${days}d old — check it is still open before spending time`;
        if (days <= 3) return `${days}d old — early applicants get read first`;
      }
      return null;
    },
    why: 'a 6-week-old requisition is often already down to a shortlist',
  },
  {
    id: 'benefits_signal',
    label: 'Benefits worth noticing',
    test: (t) => {
      const bits = [];
      if (/esop|employee (stock|option)|equity (grant|plan)|stock options/i.test(t)) bits.push('equity offered');
      if (/fully (diluted )?vesting|4[- ]year vesting|1[- ]year cliff/i.test(t)) bits.push('vesting terms published');
      if (/learning (budget|stipend)|conference budget|\bL&D\b/i.test(t)) bits.push('learning budget');
      if (/401\(k\)|provident fund|\bPF\b|gratuity/i.test(t)) bits.push('retirement scheme');
      if (/parental leave|maternity|paternity/i.test(t)) bits.push('parental leave mentioned');
      if (/relocation (assistance|support|package)/i.test(t)) bits.push('relocation help');
      return bits.length ? bits.join(' · ') : null;
    },
    why: 'publishing vesting terms usually means the offer is negotiable at the margin',
  },
  {
    id: 'visa_sponsorship',
    label: 'Sponsorship',
    test: (t, job, profile) => {
      const no = /we (do not|don't|cannot|can not) (provide )?(visa )?sponsor|no sponsorship|not eligible for sponsorship|must (already )?(be authorized|have the right)/i.test(t);
      const yes = /we (can|are able to) sponsor|sponsorship (is )?(available|provided)|visa support/i.test(t);
      const needs = profile?.needSponsorship;
      if (no && needs) return '⚠ states no sponsorship and you need it — skip';
      if (no) return 'no sponsorship (fine for your situation)';
      if (yes) return needs ? 'sponsorship offered — matches your need' : 'sponsorship offered';
      return null;
    },
    why: 'the one filter worth being absolute about',
  },
];

/** Derive signals from a posting. `profile` lets us judge sponsorship against *you*. */
export async function research({ job, profile }) {
  const t = normalize(`${job.title}\n${job.description || ''}\n${(job.requirements || []).join('\n')}`);
  const insights = [];
  for (const r of RULES) {
    let value = null;
    try {
      value = r.test(t, job, profile);
    } catch {
      value = null;
    }
    if (value) insights.push({ id: r.id, label: r.label, value, why: r.why });
  }
  const board = await greenhouseEnrichment(job).catch(() => null);
  if (board) insights.push({ id: 'board_meta', label: 'From the ATS board', value: board, why: 'pulled live from the company’s public Greenhouse board' });

  const warnings = insights
    .filter((i) => /shotgun|staffing|skip|no-reply|old — check|unstated|vaguely|thin spec|expect lowball|stipend|unpaid/.test(i.value) && !/early applicants/.test(i.value))
    .map((i) => `${i.label}: ${i.value}`);
  const positives = insights
    .filter((i) => /early applicants|specific stack|no on-call|equity offered|learning budget|matches your need|remote, no office|vesting terms/.test(i.value))
    .map((i) => `${i.label}: ${i.value}`);
  const verdict = warnings.length && !positives.length ? 'thin' : positives.length > warnings.length ? 'good' : 'mixed';
  return {
    insights,
    warnings,
    positives,
    verdict,
    coverage: `${insights.length}/${RULES.length} signals found in this posting`,
    generatedAt: new Date().toISOString(),
  };
}

/** Optional enrichment from a public Greenhouse board (never fails the request). */
async function greenhouseEnrichment(job) {
  const m = String(job.url || '').match(/boards\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i);
  if (!m) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const bits = [];
    if (data.department?.name) bits.push(`department: ${data.department.name}`);
    if (data.offices?.length) bits.push(`offices: ${data.offices.map((o) => o.name).join(', ').slice(0, 80)}`);
    if (data.updated_at) bits.push(`last updated ${String(data.updated_at).slice(0, 10)}`);
    return bits.length ? bits.join(' · ') : null;
  } finally {
    clearTimeout(timer);
  }
}

export const SIGNAL_COUNT = RULES.length;
