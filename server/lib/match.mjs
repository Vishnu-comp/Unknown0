/**
 * Match engine: explains itself. Every job gets a 0-100 score plus a
 * component breakdown, matched/missing skills and hard-requirement flags,
 * because "why did it apply to this?" is the first thing a user asks.
 */
import { tokens, extractPhrases, cosineFromCounts, termCounts, detectSeniority, requiredYears, daysSince, normalize } from './text.mjs';
import { FIELDS } from './db.mjs';

const FIELD_INDEX = new Map(FIELDS.map((f) => [f.id, f]));

export function candidateVector(profile, resume) {
  const skillNames = (profile.skills || []).map((s) => s.name).join(' ');
  const resumeText = resume?.text || '';
  const bullets = (profile.experience || []).map((e) => `${e.title} ${e.bullets?.join(' ')}`).join(' ');
  const corpus = `${skillNames} ${resumeText} ${bullets} ${profile.linkedinHeadline || ''}`;
  return {
    skillPhrases: new Set(extractPhrases(corpus)),
    counts: termCounts(corpus),
    years: yearsOfExperience(profile, resumeText),
    corpus,
  };
}

export function yearsOfExperience(profile, resumeText = '') {
  const explicit = resumeText.match(/(\d{1,2}(?:\.\d)?)\+?\s*years?[^.]{0,30}(experience|exp)/i);
  if (explicit) return Number(explicit[1]);
  let years = 0;
  const now = new Date();
  for (const e of profile.experience || []) {
    const start = Date.parse(e.start || '');
    if (Number.isNaN(start)) continue;
    const end = e.current ? now : new Date(e.end || e.start || 0);
    years += Math.max(0, (end - start) / (365.25 * 24 * 3600 * 1000));
  }
  return Math.round(years * 10) / 10;
}

function fieldSignal(job, targetFields) {
  const blob = normalize(`${job.title} ${job.category || ''} ${(job.tags || []).join(' ')}`).toLowerCase();
  let best = 0;
  let bestField = null;
  for (const id of targetFields) {
    const f = FIELD_INDEX.get(id);
    if (!f) continue;
    let hit = 0;
    for (const tag of f.tags) if (blob.includes(tag)) hit += 1;
    if ((job.category || '').toLowerCase().includes(f.label.toLowerCase().split(' ')[0])) hit += 1.5;
    const score = Math.min(1, hit / 2.2);
    if (score > best) {
      best = score;
      bestField = f;
    }
  }
  return { score: best, field: bestField };
}

export function scoreJob(job, profile, resume) {
  const cand = candidateVector(profile, resume);
  return scoreJobWithCandidate(job, profile, cand);
}

/** Score from a precomputed candidate vector + optional extra insight adjustments. */
export function scoreWithInsights(job, profile, cand, insights) {
  const base = scoreJobWithCandidate(job, profile, cand);
  if (!insights?.length) return base;
  const lines = [...new Set(insights.map((x) => (typeof x === 'string' ? x : x.value || '')).filter(Boolean))];
  let delta = 0;
  const notes = new Set();
  const rule = (rx, d, note) => {
    if (lines.some((l) => rx.test(l))) {
      delta += d;
      notes.add(note);
    }
  };
  rule(/\bunpaid\b|volunteer|equity only|stipend/i, -30, 'unpaid/volunteer — do not spend an application on this');
  rule(/thin spec|requisition dump|no technology named/i, -4, 'under-specified posting');
  rule(/and you need it — skip|hard block/i, -25, 'sponsorship mismatch (you need it, they will not provide it)');
  rule(/shotgun|no technology named|staffing|requisition dump|no-reply policy|vaguely/i, -5, 'thin or vague posting');
  rule(/explicitly no on-call/i, 3, 'no on-call promised');
  rule(/early applicants/i, 2, 'posted <4 days ago');
  rule(/vesting terms published|equity offered|relocation help|learning budget|parental leave/i, 2, 'publishes benefits detail');
  rule(/algo round|take-home/i, -1, 'expect take-home/algo screening');
  rule(/d old — check it is still open/i, -3, 'posting may be stale');
  const score = Math.max(0, Math.min(97, base.score + delta));
  return { ...base, score, grade: grade(score), insights: { applied: [...notes], delta, lines } };
}

export function scoreJobWithCandidate(job, profile, cand) {
  const targets = profile.targets || {};
  const fields = targets.fields?.length ? targets.fields : [profile.primaryField || 'software_engineering'];
  const jobText = normalize(`${job.title} ${job.description || ''} ${(job.requirements || []).join(' ')}`);
  const jobPhrases = new Set(extractPhrases(jobText));
  const jobCounts = termCounts(jobText);

  /* --- skills (35) --- */
  const required = [...jobPhrases];
  const matched = required.filter((p) => cand.skillPhrases.has(p));
  const missing = required.filter((p) => !cand.skillPhrases.has(p)).slice(0, 8);
  const skillSet = new Set((profile.skills || []).map((s) => s.name.toLowerCase()));
  const coreBoost = matched.filter((m) => skillSet.has(m)).length * 0.12;
  const skillScore = required.length
    ? Math.min(1, (matched.length / Math.max(4, required.length * 0.6)) + coreBoost)
    : jaccardish(cand.skillPhrases, jobPhrases);
  function jaccardish(a, b) {
    if (!a.size || !b.size) return 0;
    let i = 0;
    for (const x of a) if (b.has(x)) i++;
    return i / Math.max(1, Math.min(a.size, b.size) * 0.6);
  }

  /* --- semantic-ish text sim (10) --- */
  const sim = clamp(cosineFromCounts(cand.counts, jobCounts) * 4.2);

  /* --- field (20) --- */
  const field = fieldSignal(job, fields);

  /* --- title intent (15) --- */
  const titleLc = (job.title || '').toLowerCase();
  const kws = (targets.titleKeywords || []).map((k) => k.toLowerCase());
  let titleScore = 0;
  if (kws.some((k) => titleLc.includes(k))) titleScore = 1;
  else if (field.score > 0.5) titleScore = 0.6;
  else titleScore = clamp(jaccardTokens(tokens(job.title), tokens(kws.join(' '))));
  const excluded = (targets.excludeKeywords || []).filter((k) => titleLc.includes(String(k).toLowerCase()) || normalize(jobText).toLowerCase().includes(String(k).toLowerCase()) && String(k).length > 4);

  /* --- seniority (8) --- */
  const want = targets.seniority || ['mid'];
  const got = detectSeniority(`${job.title} ${job.description || ''}`);
  const rank = { intern: 0, junior: 1, mid: 2, senior: 3, staff: 4 };
  const wantRank = Math.max(...want.map((w) => rank[w] ?? 2));
  let seniorityScore = 1;
  if (got === 'intern' && wantRank >= 2) seniorityScore = 0.25;
  else if (rank[got] - wantRank >= 2) seniorityScore = 0.5;
  else if (wantRank - rank[got] >= 2) seniorityScore = 0.55;

  /* --- experience gap (6) --- */
  const needYears = requiredYears(jobText);
  const haveYears = cand.years;
  let yearsScore = 1;
  let underQualified = false;
  if (needYears != null) {
    const gap = needYears - haveYears;
    if (gap <= 0) yearsScore = 1;
    else if (gap <= 1) yearsScore = 0.75;
    else if (gap <= 2) {
      yearsScore = 0.45;
      underQualified = true;
    } else {
      yearsScore = 0.2;
      underQualified = true;
    }
  }

  /* --- location / remote (6) --- */
  const pref = profile.remotePreference || 'any';
  const locLc = normalize(`${job.location || ''} ${job.city || ''}`).toLowerCase();
  const isRemote = Boolean(job.remote) || locLc.includes('remote') || locLc.includes('anywhere');
  let locationScore = 0.6;
  if (isRemote && (pref === 'remote' || pref === 'hybrid' || pref === 'any')) locationScore = 1;
  if (!isRemote) {
    const home = (profile.location?.city || '').toLowerCase();
    locationScore = home && locLc.includes(home) ? 1 : 0.55;
    if (pref === 'remote') locationScore = 0.3;
  }
  const sponsorIssue = needsSponsorship(job) && profile.needSponsorship === false ? 0 : 1;

  /* --- salary (5) — only comparable inside the same currency --- */
  let salaryScore = 0.7;
  let belowFloor = false;
  let currencyMismatch = false;
  const salMin = job.salaryMin ?? job.salary?.min ?? null;
  const floor = targets.minSalary || 0;
  const jobCur = (job.salaryCurrency || job.salary?.currency || '').toUpperCase();
  const myCur = (targets.salaryCurrency || 'INR').toUpperCase();
  if (salMin && floor && jobCur === myCur) {
    if (salMin >= floor) salaryScore = 1;
    else if (salMin >= floor * 0.85) salaryScore = 0.6;
    else {
      salaryScore = 0.25;
      belowFloor = true;
    }
  } else if (salMin && floor && jobCur && myCur && jobCur !== myCur) {
    // never guess FX: keep the score neutral, surface the number for a human
    salaryScore = 0.7;
    currencyMismatch = true;
  }

  /* --- recency (5) --- */
  const age = daysSince(job.postedAt ?? job.posted_at);
  let recencyScore = 0.5;
  if (age != null) recencyScore = age <= 3 ? 1 : age <= 7 ? 0.9 : age <= 14 ? 0.7 : age <= 30 ? 0.45 : 0.2;

  const weights = { skills: 35, sim: 10, field: 20, title: 15, seniority: 8, years: 6, location: 6, salary: 5, recency: 5 };
  let score =
    weights.skills * skillScore +
    weights.sim * sim +
    weights.field * field.score +
    weights.title * titleScore +
    weights.seniority * seniorityScore +
    weights.years * yearsScore +
    weights.location * (locationScore * sponsorIssue) +
    weights.salary * salaryScore +
    weights.recency * recencyScore;

  /* --- hard penalties --- */
  let excludedBy = null;
  if (excluded.length) {
    score -= 22;
    excludedBy = excluded.slice(0, 3);
  }
  if (isUnpaid(job)) {
    score -= 30;
    excludedBy = excludedBy || 'unpaid / volunteer';
  }

  const flags = [];
  if (underQualified) flags.push(`asks ${needYears}+ yrs (you have ~${haveYears})`);
  if (belowFloor) flags.push('below your salary floor');
  if (currencyMismatch) flags.push(`pays in ${jobCur} (${salMin.toLocaleString()} ${jobCur}) — convert against your ${myCur} floor yourself`);
  if (got === 'intern') flags.push('internship posting');
  if (excluded.length) flags.push(`matched exclude term: ${excluded.slice(0, 2).join(', ')}`);
  if (needsSponsorship(job) && !profile.needSponsorship) flags.push('states sponsorship not provided (ok for you)');

  // honest ceiling: a perfect score claims nothing is missing, which is almost
  // never true of a real posting — cap at 97 and reserve 100 for nothing.
  const capped = Math.min(97, Math.round(clamp(score / 100) * 100));
  return {
    jobId: job.id,
    score: capped,
    grade: grade(score),
    breakdown: {
      skills: pct(weights.skills, skillScore),
      field: pct(weights.field, field.score),
      title: pct(weights.title, titleScore),
      semantic: pct(weights.sim, sim),
      seniority: pct(weights.seniority, seniorityScore),
      experience: pct(weights.years, yearsScore),
      location: pct(weights.location, locationScore * sponsorIssue),
      salary: pct(weights.salary, salaryScore),
      recency: pct(weights.recency, recencyScore),
    },
    matchedSkills: matched,
    missingSkills: missing,
    detectedField: field.field?.id || null,
    detectedSeniority: got,
    excludedBy,
    flags: [...new Set(flags)],
    yearsOfExperience: haveYears,
    generatedAt: new Date().toISOString(),
  };
}

function pct(weight, s) {
  return Math.round(weight * clamp(s) * 10) / 10;
}
function clamp(n) {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}
function jaccardTokens(a, b) {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const i = new Set(a.filter((t) => B.has(t))).size;
  return i / new Set([...a, ...b]).size;
}
export function grade(score) {
  if (score >= 85) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}
function needsSponsorship(job) {
  return /will not sponsor|no sponsorship|not eligible for sponsorship|must be legally authorized/.test(normalize(job.description || '').toLowerCase());
}
function isUnpaid(job) {
  return /unpaid|volunteer|stipend:\s*0|equity only/.test(normalize(`${job.title} ${job.description}`).toLowerCase());
}
