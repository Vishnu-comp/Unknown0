/**
 * Auto-apply runner.
 *
 * Deliberate design constraint: this never POSTs into a third-party ATS on
 * your behalf from the server. LinkedIn/Indeed/Workday treat that as bot
 * traffic (account bans, and you'd have to hand over your password), and it
 * breaks the moment a captcha shows up. Instead the runner does everything
 * that *is* automatable — find, rank, decide, compose, prefill, queue — and
 * hands a ready-to-send pack to you (copy) or to the browser extension
 * (fills the form in your own logged-in session, you press Submit).
 */
import { getSettings, read, write, uid } from './db.mjs';
import { scoreJob, candidateVector, scoreWithInsights } from './match.mjs';
import { buildLetter, polishLetter, answerQuestions, buildPrefill, mailtoFor } from './letters.mjs';
import { tailorResume, toAtsPlain } from './tailor.mjs';
import { research } from './companyResearch.mjs';
import { normalize, truncate } from './text.mjs';

export const PIPELINE = ['queued', 'drafted', 'ready', 'extension_opened', 'submitted', 'interview', 'offer', 'rejected', 'withdrawn'];

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function getRuns() {
  return read('runs', { byDay: {}, log: [] });
}

function record(run, source) {
  const day = todayKey();
  run.byDay[day] = run.byDay[day] || {};
  run.byDay[day][source || 'all'] = (run.byDay[day][source || 'all'] || 0) + 1;
  run.log.unshift({ at: new Date().toISOString(), day, source, action: 'autoqueued' });
  run.log = run.log.slice(0, 200);
  write('runs', run);
}

export function countsToday() {
  const run = getRuns();
  const day = run.byDay[todayKey()] || {};
  return { total: Object.values(day).reduce((a, b) => a + b, 0), bySource: day };
}

/** Extract screening questions an ATS is likely to ask, from the posting text. */
export function inferQuestions(job) {
  const text = normalize(job.description || '');
  const qs = [...text.matchAll(/([A-Z][^.?\n]{10,180}\?)/g)].map((m) => m[1].trim());
  const wanted = /why|experience|salary|notice|authorized|sponsor|relocat|referral|portfolio|linkedin|start|availab|years|biggest|challenge|failure|team|project|weakness|reason/i;
  const picked = [...new Set(qs.filter((q) => wanted.test(q)))].slice(0, 8);
  const defaults = [
    'Why are you interested in this role?',
    'What are your salary expectations?',
    'Are you legally authorized to work in the country of this role?',
    'Will you now or in the future require sponsorship for an employment visa?',
    'What is your notice period / earliest start date?',
    'Are you willing to relocate for this position?',
    'Do you consent to a background check?',
    `How many years of experience do you have with ${(job.title || '').toLowerCase()}?`,
  ].filter((d) => !picked.some((p) => p.toLowerCase().includes(d.toLowerCase().slice(0, 18))));
  return [...picked, ...defaults].slice(0, 10);
}

/**
 * Compose a complete application pack for one job: score, cover letter,
 * answers, prefill payload, mailto (if the posting has an apply address).
 */
export async function composeApplication({ job, profile, resume, settings, forceMode, useInsights = true }) {
  const st = settings || getSettings();
  let insights = null;
  try {
    insights = await research({ job, profile });
  } catch {
    insights = null;
  }
  const cand = candidateVector(profile, resume);
  const match =
    useInsights && insights?.insights?.length
      ? scoreWithInsights(
          job,
          profile,
          cand,
          [...(insights.insights || []).map((x) => x.value), ...(insights.warnings || []), ...(insights.positives || [])]
        )
      : scoreJob(job, profile, resume);
  const tone = forceMode === 'template' ? 'plain' : st.llm?.tone || 'confident';
  let built = buildLetter({ job, profile, match, resume, tone });
  if (st.llm?.provider !== 'none' && st.llm?.apiKey) {
    const polished = await polishLetter({ job, profile, match, resume, settings: st });
    if (polished?.mode === 'llm') built = polished;
  }
  const questions = [...(job.questions || []), ...inferQuestions(job)];
  const answers = answerQuestions(questions.slice(0, 10), { job, profile, match, resume });
  const app = {
    id: uid('app_'),
    jobId: job.id,
    title: job.title,
    company: job.company,
    source: job.source,
    url: job.url,
    applyEmail: job.applyEmail || null,
    score: match.score,
    grade: match.grade,
    breakdown: match.breakdown,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    flags: match.flags,
    letter: built.letter,
    letterMode: built.mode,
    letterWords: built.wordCount,
    answers,
    resumeFilename: resume?.filename || null,
    resumeText: resume ? truncate(resume.text, 2400) : null,
    status: 'ready',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), status: 'ready', note: built.mode === 'llm' ? 'LLM-polished letter' : 'Template letter' }],
  };
  const tailored = tailorResume({ job, profile, resume, match });
  app.tailoredResume = tailored.text;
  app.tailoredAudit = tailored.audit;
  app.tailoredPlain = toAtsPlain(tailored.text);
  app.insights = insights;
  app.prefill = buildPrefill({ job, profile, resume, match, app });
  app.prefill.fields['resume.tailored'] = app.tailoredPlain;
  app.applyUrl = job.url;
  app.mailto = mailtoFor(job, profile, app);
  app.checklist = makeChecklist(app, job, profile, resume);
  return app;
}

function makeChecklist(app, job, profile, resume) {
  const missing = [];
  if (!resume) missing.push('No resume on file — uploads will fall back to your profile text');
  if (!profile.email) missing.push('Missing email');
  if (!profile.phone) missing.push('Missing phone');
  if (!profile.experience?.length) missing.push('No work history in profile');
  if (!profile.education?.length) missing.push('No education in profile');
  if (app.score < 60) missing.push('Match under 60 — worth reading the posting before sending');
  if (app.letterMode !== 'llm') missing.push('Letter built from template (no LLM key) — skim for awkward phrasing');
  return {
    ok: !missing.length,
    warnings: missing,
    lowConfidenceAnswers: app.answers.filter((a) => a.confidence < 0.6).map((a) => a.question),
    needsManual: [
      'Any "select one" dropdowns the extension cannot map (ethnicity, disability, work-authorization phrasing varies per ATS).',
      'Referral / requisition ID fields, if present.',
      'File pickers: the extension uploads the copy of your resume it saved — verify it is the right version.',
    ],
  };
}

/**
 * Decide which jobs should be auto-queued today.
 */
export async function runAutoApply({ jobs, profile, resume, settings, dryRun = false, onlyIds = null }) {
  const st = settings || getSettings();
  const aa = st.autoApply || {};
  if (!aa.enabled && !onlyIds) return { queued: [], skipped: [], reason: 'auto-apply disabled', counts: countsToday() };

  const existing = read('applications', []);
  const seen = new Set(existing.map((a) => a.jobId));
  const cap = aa.dailyCap ?? 10;
  const openedAt = new Map(existing.map((a) => [a.jobId, Date.parse(a.updatedAt || a.createdAt || 0)]));
  const counts = countsToday();
  const perSource = counts.bySource || {};

  const eligible = (jobs || [])
    .filter((j) => (onlyIds ? onlyIds.includes(j.id) : true))
    .filter((j) => !seen.has(j.id))
    .map((j) => ({ job: j, match: scoreJob(j, profile, resume) }))
    .filter(({ job, match }) => {
      if (match.score < (aa.minScore ?? 70)) return false;
      if (job.excluded) return false;
      if (match.excludedBy && !onlyIds) return false;
      const last = openedAt.get(job.id);
      if (last && Date.now() - last < (aa.cooldownHours ?? 24) * 3600 * 1000) return false;
      return true;
    })
    .sort((a, b) => b.match.score - a.match.score);

  /* caps are applied here, in score order, against a running tally — so a
     single run can never blow past the daily or per-source limits. */
  const withinCaps = [];
  let cutByCap = 0;
  const tallyTotal = counts.total;
  const tally = { ...perSource };
  for (const item of eligible) {
    const b = bucket(item.job.source);
    if (!onlyIds && tallyTotal + withinCaps.length + 1 > cap) {
      cutByCap++;
      continue;
    }
    if (!onlyIds && (tally[b] || 0) + 1 > (aa.perSourcePerDay ?? 4)) {
      cutByCap++;
      continue;
    }
    tally[b] = (tally[b] || 0) + 1;
    withinCaps.push(item);
  }

  const queued = [];
  const skipped = [];
  for (const { job, match } of withinCaps) {
    if (dryRun) {
      queued.push({ jobId: job.id, title: job.title, company: job.company, source: job.source, score: match.score, grade: match.grade, flags: match.flags, missing: match.missingSkills.slice(0, 4), url: job.url, wouldCompose: true });
      continue;
    }
    try {
      const app = await composeApplication({ job, profile, resume, settings: st });
      existing.unshift(app);
      queued.push(app);
      counts.total += 1;
      perSource[bucket(job.source)] = (perSource[bucket(job.source)] || 0) + 1;
      record(getRuns(), bucket(job.source));
    } catch (e) {
      skipped.push({ jobId: job.id, title: job.title, error: e.message });
    }
  }
  if (!dryRun) cutByCap = Math.max(0, eligible.length - queued.length - skipped.length);
  if (!dryRun) write('applications', existing.slice(0, 400));
  return {
    queued,
    skipped,
    reason: null,
    counts: countsToday(),
    policy: { ...aa, remainingToday: Math.max(0, cap - counts.total) },
    cap,
    cutByCap,
    considered: (jobs || []).length,
    draftedAt: new Date().toISOString(),
  };
}

function bucket(source = '') {
  return String(source).split(/[:_]/).slice(0, 2).join('_');
}

/** Status transitions + audit trail for the pipeline board. */
export function transition(app, to, note) {
  if (!PIPELINE.includes(to)) throw new Error(`bad status ${to}`);
  const from = app.status;
  const next = { ...app, status: to, updatedAt: new Date().toISOString(), history: [...(app.history || []), { at: new Date().toISOString(), from, to, note: note || '' }] };
  if (to === 'submitted') next.submittedAt = new Date().toISOString();
  return next;
}
