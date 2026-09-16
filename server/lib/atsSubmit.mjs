/**
 * Direct submission — only for ATSs that publish a public, unauthenticated
 * "apply" endpoint. Today: Greenhouse boards and Lever postings.
 *
 * Why the restriction is real and not shyness:
 *   - Greenhouse/Lever job pages are public data and their POST /applications
 *     endpoint is the same one their own "Apply for this job" button hits.
 *     Submitting through it is normal use of the product, and it reaches the
 *     employer's ATS, not a third-party feed.
 *   - LinkedIn, Indeed, Workday, iCIMS, SmartRecruiters etc. require a login,
 *     a signed one-time token, or captcha, and their ToS forbids automated
 *     submission. We do not touch those. The extension fills them and you press
 *     Submit yourself.
 *
 * Safety rails, all enforced here (not in the UI, so nothing can skip them):
 *   1. dry run unless `confirm: true`
 *   2. the opt-in switch `settings.atsSubmit.enabled` must be on for real sends
 *   3. a resume must exist — we never submit an application with an empty resume
 *   4. one submit per application (refuses if already `submitted`)
 *   5. the same per-day cap the runner uses (real sends only)
 *   6. every attempt — including refusals — goes to data/submissions.json
 */
import fs from 'node:fs';
import { getResume, getSettings, saveSettings, read, write, uid } from './db.mjs';

const TIMEOUT = Number(process.env.ATS_TIMEOUT_MS || 20000);
/* tests inject a local mock server here; production leaves it empty */
const BASE = process.env.ATS_API_BASE || '';

const GH = /boards\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i;
const GH_EMBED = /greenhouse\.io\/embed\/job_app\?for=([a-z0-9_-]+).*?token=(\d+)/i;
const GH_ALT = /greenhouse\.io\/(?:job|job_preview)\/(\d+)/i;
/* lever ids are hyphenated UUID-ish slugs — grab the whole path segment */
const LEVER = /lever\.co\/([a-z0-9_-]+)\/([a-z0-9-]{6,}?)(?:[/?#]|$)/i;

/** Classify a posting's apply URL → {kind, board, jobNumber, submitUrl}. */
export function atsFor(url = '') {
  let m = url.match(GH) || url.match(GH_EMBED);
  if (m) {
    return {
      kind: 'greenhouse',
      board: m[1],
      jobNumber: m[2],
      submitUrl: `${BASE || 'https://boards-api.greenhouse.io'}/v1/boards/${m[1]}/jobs/${m[2]}/applications`,
      tokenUrl: `${BASE || 'https://boards.greenhouse.io'}/v1/job_applications?for=${m[1]}`,
    };
  }
  m = url.match(GH_ALT);
  if (m) {
    return {
      kind: 'greenhouse',
      board: null,
      jobNumber: m[1],
      submitUrl: `${BASE || 'https://boards-api.greenhouse.io'}/v1/boards/${m[1]}/applications`,
      tokenUrl: null,
    };
  }
  m = url.match(LEVER);
  if (m) {
    return {
      kind: 'lever',
      board: m[1],
      jobNumber: m[2],
      submitUrl: `${BASE || 'https://api.lever.co'}/v0/postings/${m[1]}/${m[2]}/apply`,
      tokenUrl: null,
    };
  }
  return { kind: null, board: null, jobNumber: null, submitUrl: null, tokenUrl: null };
}

/**
 * Can we submit this job ourselves, right now, honestly?
 * Returns a reason the UI can show verbatim when the answer is no.
 */
export function submitSupport(job, { settings, appId } = {}) {
  const a = atsFor(job?.url || job?.applyUrl || '');
  if (!a.kind) {
    return {
      supported: false,
      ok: false,
      reason:
        'This apply URL is not a Greenhouse/Lever public API endpoint. LinkedIn, Indeed, Workday and iCIMS need a login or a captcha and forbid automated submission — the extension fills those forms and you press Submit.',
      alternatives: ['extension'],
    };
  }
  const st = settings || getSettings();
  if (!st.atsSubmit?.enabled) {
    return {
      supported: true,
      ok: false,
      stage: 'gate',
      kind: a.kind,
      board: a.board,
      jobNumber: a.jobNumber,
      reason: `This posting is on ${a.kind}, which has a public apply API — but direct submit is switched off in Settings → Direct ATS submit.`,
      enablePath: 'settings.atsSubmit.enabled',
    };
  }
  const resume = getResume();
  if (!resume?.text) {
    return {
      supported: true,
      ok: false,
      stage: 'resume',
      kind: a.kind,
      reason:
        'No resume document on file. A tailored text version exists on the application, but a real application should carry your actual uploaded resume — drop one on the Resume tab and this unlocks by itself.',
      fix: 'POST /api/resume (pdf/docx/txt) or the Resume tab',
    };
  }
  if (job?.submission?.via || job?.status === 'submitted' || job?.externalApplicationId) {
    return { supported: true, ok: false, kind: a.kind, reason: 'already submitted — refusing to send it twice' };
  }
  const tracked = read('applications', []).find((x) => (appId ? x.id === appId : x.jobId === (job?.id || '')));
  if (tracked?.status === 'submitted' || tracked?.submission?.via) {
    return {
      supported: true,
      ok: false,
      kind: a.kind,
      reason: 'already submitted through ApplyFlow — refusing to send it twice',
      applicationId: tracked?.submission?.applicationId || null,
    };
  }
  const cap = st.autoApply?.dailyCap || 0;
  if (cap) {
    const today = (st.submitCounters || {})[new Date().toISOString().slice(0, 10)] || 0;
    if (today >= cap) {
      return { supported: true, ok: false, kind: a.kind, reason: `daily cap reached (${today}/${cap}) — direct submits share it with the runner`, cap };
    }
  }
  return { supported: true, ok: true, kind: a.kind, board: a.board, jobNumber: a.jobNumber, submitUrl: a.submitUrl };
}

/** Candidate payload in the shape Greenhouse's application API expects. */
export function buildCandidate(profile, job, tailoredLetter) {
  const full = (profile.fullName || '').trim();
  const parts = full.split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || first;
  const phones = [profile.phone, profile.phoneAlt].filter(Boolean);
  const links = [
    profile.linkedin && { type: 'LinkedIn', value: profile.linkedin },
    profile.github && { type: 'Github', value: profile.github },
    profile.portfolio && { type: 'website', value: profile.portfolio },
  ].filter(Boolean);
  const expected = profile.salary?.expected;
  const c = {
    first_name: first,
    last_name: last,
    emails: profile.email ? [{ value: profile.email, type: 'personal' }] : [],
    phones: phones.map((value) => ({ value, value_for_parsing: value, type: 'mobile' })),
    links,
    addresses: profile.location?.city
      ? [{ type: 'current', address: [profile.location.city, profile.location.state, profile.location.country].filter(Boolean).join(', ') }]
      : [],
    applications: [{ offsite: false, job: { id: null, name: job?.title || '' }, status: 'new' }],
    answers: [],
    consent_for_data_processing: profile.boolAnswers?.consentDataProcessing !== false,
  };
  if (expected) c.applications[0].salary_information = { expected: String(expected), currency: profile.salary?.currency || 'INR' };
  if (tailoredLetter) c.cover_letter = tailoredLetter;
  return c;
}

/** Flatten our answer list into the {question, answer} list these APIs take. */
export function toAnswerList(answers = [], { includeUnanswered = false } = {}) {
  const out = [];
  for (const a of answers || []) {
    if (!a?.question) continue;
    if ((a.answer === undefined || a.answer === null || a.answer === '') && !includeUnanswered) continue;
    const answer = String(a.answer ?? '');
    out.push({ question: a.question, answer, answerForParsing: answer.replace(/\s*\n\s*/g, ' ') });
  }
  return out;
}

/** Body + content-type for a real send. Greenhouse takes multipart (it carries the
 *  file), Lever takes JSON with resume text — matching what their own buttons send. */
function buildBody({ kind, candidate, answers, resumeText, resumeBuffer, resumeFilename, resumeMime, tailoredLetter, letterText, source }) {
  if (kind === 'lever') {
    const json = {
      application: {
        name: `${candidate.first_name} ${candidate.last_name}`.trim(),
        email: candidate.emails[0]?.value || '',
        phone: candidate.phones[0]?.value || '',
        priority: 0,
        location: candidate.addresses[0]?.address || '',
        answers,
      },
      resume: resumeText,
      params: {},
    };
    if (candidate.urls?.linkedin) json.application.linkedin = candidate.urls.linkedin;
    if (tailoredLetter) json.letters = { text: tailoredLetter };
    if (resumeBuffer) json.params.fileName = resumeFilename;
    return { body: JSON.stringify(json), headers: { 'content-type': 'application/json' } };
  }
  const fd = new FormData();
  if (resumeBuffer) fd.append('resume', new Blob([resumeBuffer], { type: resumeMime }), resumeFilename);
  else fd.append('resume', new Blob([resumeText || ''], { type: 'text/plain' }), 'resume.txt');
  if (letterText) fd.append('cover_letter', letterText);
  fd.append('candidate', JSON.stringify({ ...candidate, cover_letter: undefined }));
  fd.append('answers_to_all_questions', JSON.stringify(answers));
  fd.append('security_code', '');
  fd.append('api_user', 'applyflow');
  fd.append('sendEmail', 'true');
  fd.append('source', source || 'applyflow-self-hosted');
  return { body: fd, headers: {} }; // let fetch set the multipart boundary
}

/**
 * The one entry point. Dry run unless `confirm: true`.
 * `resumeText` / `app` are injectable so this is testable without a database.
 */
export async function submitToAts({ job, profile, app, resumeText, tailoredLetter, confirm = false, source = 'applyflow-self-hosted', letterText }) {
  const support = submitSupport(job, { appId: app?.id });
  const a = atsFor(job?.url || job?.applyUrl || '');
  const issues = [];

  const resolvedResumeText = resumeText || getResume()?.text || '';
  if (!resolvedResumeText) issues.push('no resume text — refusing to submit an application without a resume');

  const allAnswers = app?.answers || [];
  const unansweredRequired = allAnswers.filter((q) => q.required && (q.answer === undefined || q.answer === null || String(q.answer).trim() === ''));
  if (unansweredRequired.length) issues.push(`${unansweredRequired.length} required question(s) still unanswered: ${unansweredRequired.map((q) => q.question).join(' | ').slice(0, 140)}`);

  const candidate = buildCandidate(profile, job, tailoredLetter || app?.letter);
  const answers = toAnswerList(allAnswers);

  let resumeBuffer = null;
  let resumeFilename = 'resume.txt';
  let resumeMime = 'text/plain';
  const stored = getResume()?.storedPath;
  if (stored) {
    try {
      resumeBuffer = fs.readFileSync(stored);
      resumeFilename = getResume().filename || 'resume.pdf';
      resumeMime = getResume().mime || 'application/pdf';
    } catch {
      resumeBuffer = null;
    }
  }

  const { body, headers } = buildBody({
    kind: a.kind,
    candidate,
    answers,
    resumeText: resolvedResumeText,
    letterText: letterText || app?.tailoredResume || tailoredLetter || app?.letter,
    resumeBuffer,
    resumeFilename,
    resumeMime,
    tailoredLetter: tailoredLetter || app?.letter,
    source,
  });

  const preview = {
    ok: issues.length === 0,
    kind: a.kind,
    board: a.board,
    jobNumber: a.jobNumber,
    endpoint: a.submitUrl,
    method: 'POST',
    issues,
    resume: { filename: resumeBuffer ? resumeFilename : 'resume.txt', bytes: resumeBuffer ? resumeBuffer.length : (resolvedResumeText || '').length, uploadedFile: Boolean(resumeBuffer) },
    candidate,
    answers,
    bodyText: typeof body === 'string' ? body : null,
  };

  if (!support.supported || !support.ok) {
    recordSubmission({ job, appId: app?.id, kind: a.kind, dryRun: true, sent: false, error: support.reason });
    return {
      ...preview,
      ok: false,
      dryRun: true,
      error: support.reason,
      reason: support.reason,
      fix: support.enablePath ? `PUT /api/settings {"atsSubmit":{"enabled":true}} or flip it in Settings → Direct ATS submit` : null,
      note: 'Blocked before anything was assembled for sending — nothing left this machine.',
    };
  }
  if (!confirm) {
    recordSubmission({ job, appId: app?.id, kind: a.kind, dryRun: true, sent: false, error: null, note: 'dry run — payload reviewed, nothing sent' });
    return { ...preview, dryRun: true, note: 'Dry run — nothing was sent. Send {"confirm":true} to POST this exact payload, or use the extension.' };
  }
  if (issues.length) {
    const why = `refused before sending: ${issues.join('; ')}`;
    recordSubmission({ job, appId: app?.id, kind: a.kind, dryRun: false, sent: false, error: why });
    return { ...preview, ok: false, dryRun: false, sent: false, error: why };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(a.submitUrl, { method: 'POST', body, headers, signal: ctrl.signal });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 600) };
    }
    const externalId = data?.id || data?.applicationId || data?.data?.id || null;
    if (!res.ok) {
      const entry = recordSubmission({ job, appId: app?.id, kind: a.kind, dryRun: false, sent: false, status: res.status, error: describeError(res.status, data) });
      return { ...preview, ok: false, dryRun: false, sent: false, status: res.status, message: entry.error, data };
    }
    markSubmitted({ job, appId: app?.id, kind: a.kind, externalId });
    recordSubmission({ job, appId: app?.id, kind: a.kind, dryRun: false, sent: true, status: res.status, externalId });
    return { ...preview, ok: true, dryRun: false, sent: true, status: res.status, applicationId: externalId, data };
  } catch (e) {
    const msg = `request failed: ${e.name === 'AbortError' ? `timed out after ${TIMEOUT}ms` : e.message}`;
    recordSubmission({ job, appId: app?.id, kind: a.kind, dryRun: false, sent: false, error: msg });
    return { ...preview, ok: false, dryRun: false, sent: false, error: msg, hint: 'Outbound traffic to boards-api.greenhouse.io / api.lever.co may be blocked on this host — run ApplyFlow on your own machine, or use the extension.' };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(status, data) {
  if (status === 422 || status === 400) {
    const errs = data?.errors || data?.error || data?.validation_errors || data;
    return `the ATS rejected the payload (${status}) — usually a required questionnaire field or a missing one-time token: ${JSON.stringify(errs).slice(0, 300)}`;
  }
  if (status === 401 || status === 403) return 'this board requires a signed one-time token from its own job page; we do not spoof it — fill with the extension and press Submit yourself';
  if (status === 404) return 'job no longer open or the board slug is wrong — re-fetch the job list and re-prepare the application';
  if (status === 429) return 'rate limited by the ATS — space submissions out (Settings → daily cap)';
  return `HTTP ${status}${data?.raw ? ' — ' + String(data.raw).slice(0, 160) : ''}`;
}

/** Flip the app to `submitted` and bump the shared per-day counter. */
function markSubmitted({ job, appId, kind, externalId }) {
  const now = new Date().toISOString();
  const apps = read('applications', []);
  const i = apps.findIndex((x) => (appId ? x.id === appId : job?.id ? x.jobId === job.id : false));
  if (i >= 0) {
    apps[i] = {
      ...apps[i],
      status: 'submitted',
      updatedAt: now,
      submittedAt: now,
      submission: { via: `api:${kind}`, applicationId: externalId, at: now },
      history: [...(apps[i].history || []), { at: now, from: apps[i].status, to: 'submitted', note: `sent via ${kind} public apply API` }],
    };
    write('applications', apps);
  }
  const st = getSettings();
  const day = now.slice(0, 10);
  st.submitCounters = { ...(st.submitCounters || {}), [day]: (st.submitCounters?.[day] || 0) + 1 };
  saveSettings(st);
}

export function submitLog(limit = 50) {
  return read('submissions', []).slice(0, limit);
}

export function recordSubmission({ job, appId, kind, dryRun, sent, status = null, error = null, externalId = null, note = null }) {
  const list = read('submissions', []);
  const entry = {
    id: uid('sub_'),
    at: new Date().toISOString(),
    jobId: job?.id || null,
    appId: appId || null,
    company: job?.company || null,
    title: job?.title || null,
    kind: kind || null,
    dryRun: Boolean(dryRun),
    sent: Boolean(sent),
    status,
    externalId,
    error,
    note,
  };
  list.unshift(entry);
  write('submissions', list.slice(0, 200));
  return entry;
}
