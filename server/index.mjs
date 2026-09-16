import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getProfile,
  saveProfile,
  getSettings,
  saveSettings,
  getJobs,
  saveJobs,
  getApplications,
  saveApplications,
  getResume,
  saveResume,
  write as writeStore,
  uid,
  FIELDS,
} from './lib/db.mjs';
import { scoreJob } from './lib/match.mjs';
import { extractText, parseResume, suggestProfilePatch } from './lib/resume.mjs';
import { SOURCES, fetchAll } from './lib/ingest.mjs';
import { composeApplication, runAutoApply, transition, PIPELINE, countsToday, inferQuestions } from './lib/automation.mjs';
import demoJobs from './data/demoJobs.mjs';
import { tailorResume, toAtsPlain } from './lib/tailor.mjs';
import { research } from './lib/companyResearch.mjs';
import { scoreWithInsights, candidateVector } from './lib/match.mjs';
import { submitToAts, submitSupport, submitLog } from './lib/atsSubmit.mjs';
import { guardNodeVersion, nodeTooOld, nodeVersionAdvice, MIN_NODE } from './lib/runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

const app = express();
app.use(express.json({ limit: '4mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

/** async-aware handler wrapper: never crash the process, always return JSON errors */
const handle = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((e) => {
      if (!res.headersSent) res.status(e?.status || 500).json({ error: e?.message || String(e) });
      if (!e?.status) console.error('[applyflow]', req.method, req.path, e);
    });
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const json = (res, x) => res.json(x);

const ROUTES = `ApplyFlow API
  GET  /api/meta                      sources, field taxonomy, pipeline, env status
  GET  /api/profile                   master profile + completeness
  PUT  /api/profile                   save profile (re-scores the whole job store)
  POST /api/profile/skills            add skills   |  DELETE /api/profile/skills/:name
  POST /api/resume                    multipart file (field "resume") or {text}; applySuggestions=true
  GET  /api/resume                    parsed resume + suggested profile patch
  POST /api/resume/apply-suggestions  apply everything the parser proposed
  GET  /api/jobs?min&max&source&q&status&sort   ranked matches with breakdowns
  GET  /api/jobs/:id                  posting + match + inferred questions + submit support
  GET  /api/jobs/:id/research         posting intelligence + insight-adjusted score
  GET  /api/jobs/:id/tailored         resume re-ordered for this posting (?format=txt = download)
  POST /api/jobs/fetch {sources:[]}   pull from enabled adapters
  POST /api/jobs/seed | /api/jobs/clear | /api/jobs/recompute
  POST /api/apps/draft {jobIds:[]}    compose letter + answers + prefill pack
  GET  /api/apps | PATCH /api/apps/:id | POST /api/apps/:id/status | DELETE /api/apps/:id
  GET  /api/apps/:id/prefill | /api/apps/:id/extension-payload | /api/apps/:id/tailored.txt
  POST /api/apps/:id/submit {confirm}  Greenhouse/Lever public API (dry run unless confirm)
  GET  /api/apps/:id/submit-support | /api/submissions
  GET  /api/export/prefill.json | /api/export/pack.md[?id=]
  GET  /api/runner                    top candidates + policy + today's counters
  POST /api/runner/run {dryRun?,jobIds?}   apply the policy
  POST /api/runner/tick               cron entry point (inert unless auto-apply is on)
  GET  /api/settings | PUT /api/settings | POST /api/reset
`;
app.get('/api', (req, res) => res.type('text/plain').send(ROUTES));
app.get('/', (req, res, next) => (req.query.api === undefined ? next() : res.type('text/plain').send(ROUTES)));

/* ---------------------------------- meta ---------------------------------- */

app.get(
  '/api/meta',
  handle((req, res) =>
    json(res, {
      fields: FIELDS,
      sources: Object.entries(SOURCES).map(([key, v]) => ({ key, label: v.label, needsKey: v.needsKey })),
      runtime: { node: process.versions.node, nodeOk: !nodeTooOld(), advice: nodeTooOld() ? nodeVersionAdvice() : null },
      pipeline: PIPELINE,
      env: {
        llmKeyConfigured: Boolean(process.env.LLM_API_KEY || getSettings()?.llm?.apiKey),
        adzunaKey: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
        joobleKey: Boolean(process.env.JOOBLE_API_KEY),
        dataDir: path.relative(ROOT, DATA_DIR) || 'data',
        outboundNet: 'sandbox-limited',
      },
      counts: countsToday(),
      version: '0.1.0',
    })
  )
);

/* --------------------------------- profile --------------------------------- */

app.get(
  '/api/profile',
  handle((req, res) => {
    const profile = getProfile();
    json(res, { profile, completeness: profileCompleteness(profile) });
  })
);

app.put(
  '/api/profile',
  handle((req, res) => {
    const profile = saveProfile(req.body || {});
    const jobs = recomputeAll(profile);
    json(res, { profile, completeness: profileCompleteness(profile), jobsUpdated: jobs.length });
  })
);

app.post(
  '/api/profile/skills',
  handle((req, res) => {
    const p = getProfile();
    const items = Array.isArray(req.body?.skills) ? req.body.skills : [req.body];
    const map = new Map((p.skills || []).map((s) => [s.name.toLowerCase(), s]));
    for (const it of items) {
      if (!it?.name) continue;
      const prev = map.get(String(it.name).toLowerCase());
      map.set(String(it.name).toLowerCase(), {
        name: String(it.name).trim(),
        level: Number(it.level ?? prev?.level) || 3,
        core: Boolean(it.core ?? prev?.core),
      });
    }
    p.skills = [...map.values()];
    saveProfile(p);
    recomputeAll(p);
    json(res, { skills: p.skills });
  })
);

app.delete(
  '/api/profile/skills/:name',
  handle((req, res) => {
    const p = getProfile();
    const target = decodeURIComponent(req.params.name).toLowerCase();
    p.skills = (p.skills || []).filter((s) => s.name.toLowerCase() !== target);
    saveProfile(p);
    recomputeAll(p);
    json(res, { skills: p.skills });
  })
);

/* --------------------------------- resume --------------------------------- */

app.post(
  '/api/resume',
  upload.single('resume'),
  handle(async (req, res) => {
    const profile = getProfile();
    let text = '';
    let filename = req.file?.originalname || 'pasted-text.txt';
    if (req.file?.buffer) {
      text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    } else if (typeof req.body?.text === 'string' && req.body.text.trim().length > 80) {
      text = req.body.text;
      filename = req.body.filename || 'pasted-resume.txt';
    } else {
      throw bad('Attach a file in field "resume", or POST JSON { "text": "…your resume…" }.');
    }
    const parsed = parseResume(text);
    const doc = {
      filename,
      uploadedAt: new Date().toISOString(),
      bytes: req.file?.size ?? Buffer.byteLength(text),
      text: parsed.text,
      summary: { ...parsed, text: undefined },
      suggestedPatch: suggestProfilePatch(parsed, profile),
    };
    saveResume(doc);
    let applied = [];
    if (req.body?.applySuggestions === true || req.body?.applySuggestions === 'true') {
      applied = doc.suggestedPatch.changed;
      saveProfile({ ...profile, ...doc.suggestedPatch.patch });
      recomputeAll(getProfile());
    }
    json(res, { resume: { ...doc, text: doc.text.slice(0, 4000) }, appliedSuggestions: applied });
  })
);

app.get(
  '/api/resume',
  handle((req, res) => {
    const r = getResume();
    json(res, { resume: r ? { ...r, text: r.text.slice(0, 6000) } : null });
  })
);

app.post(
  '/api/resume/apply-suggestions',
  handle((req, res) => {
    const r = getResume();
    if (!r?.suggestedPatch) throw bad('Upload a resume first.');
    const profile = saveProfile({ ...getProfile(), ...r.suggestedPatch.patch });
    const jobs = recomputeAll(profile);
    json(res, { changed: r.suggestedPatch.changed, profile, jobsUpdated: jobs.length });
  })
);

/* ---------------------------------- jobs ---------------------------------- */

app.get(
  '/api/jobs',
  handle((req, res) => {
    const { min = 0, max = 100, source, q, status = 'all', sort = 'score' } = req.query;
    const apps = getApplications();
    const byJob = new Map(apps.map((a) => [a.jobId, a]));
    const profile = getProfile();
    const resume = getResume();
    let list = getJobs().map((j) => ({ ...j, match: scoreJob(j, profile, resume), app: byJob.get(j.id) || null }));
    list = list.filter((j) => j.match.score >= Number(min) && j.match.score <= Number(max));
    if (source) list = list.filter((j) => j.source === source);
    if (q) {
      const needle = String(q).toLowerCase();
      list = list.filter((j) => `${j.title} ${j.company} ${j.location} ${(j.tags || []).join(' ')}`.toLowerCase().includes(needle));
    }
    if (status === 'new') list = list.filter((j) => !byJob.has(j.id));
    if (status === 'applied') list = list.filter((j) => ['submitted', 'interview', 'offer'].includes(byJob.get(j.id)?.status));
    if (sort === 'date') list.sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
    else if (sort === 'company') list.sort((a, b) => String(a.company).localeCompare(String(b.company)));
    else list.sort((a, b) => b.match.score - a.match.score);
    json(res, { count: list.length, jobs: list, sources: [...new Set(getJobs().map((j) => j.source))].sort() });
  })
);

app.get(
  '/api/jobs/:id',
  handle((req, res) => {
    const job = getJobs().find((j) => j.id === req.params.id);
    if (!job) throw bad('job not found', 404);
    const profile = getProfile();
    const resume = getResume();
    json(res, {
      job,
      match: scoreJob(job, profile, resume),
      questions: inferQuestions(job),
      hasResume: Boolean(resume),
      profileCompleteness: profileCompleteness(profile),
      submit: submitSupport(job, { settings: getSettings() }),
    });
  })
);

app.post(
  '/api/jobs/recompute',
  handle((req, res) => json(res, { jobs: recomputeAll(getProfile()).length }))
);

app.post(
  '/api/jobs/clear',
  handle((req, res) => {
    saveJobs([]);
    json(res, { cleared: true });
  })
);

app.post(
  '/api/jobs/seed',
  handle((req, res) => {
    const profile = getProfile();
    const jobs = mergeJobs(demoJobs.map((j) => ({ ...j, source: 'demo' })), getJobs());
    saveJobs(jobs.map((j) => ({ ...j, matchedAt: new Date().toISOString() })));
    json(res, {
      seeded: jobs.length,
      message: `Loaded ${jobs.length} demo postings. Enable real sources in Settings → Sources for live data.`,
    });
  })
);

app.post(
  '/api/jobs/fetch',
  handle(async (req, res) => {
    const st = getSettings();
    const profile = getProfile();
    const wanted = Array.isArray(req.body?.sources) && req.body.sources.length ? req.body.sources : Object.keys(st.sources || {}).filter((k) => st.sources[k]);
    const enabled = wanted.map((key) => {
      const cfg = st.sources?.[key];
      const obj = cfg && typeof cfg === 'object' ? cfg : {};
      const env = key.startsWith('adzuna')
        ? { appId: process.env.ADZUNA_APP_ID, appKey: process.env.ADZUNA_APP_KEY, country: process.env.ADZUNA_COUNTRY || 'in' }
        : key.startsWith('jooble')
        ? { apiKey: process.env.JOOBLE_API_KEY }
        : {};
      const defaults = key.startsWith('adzuna') ? { what: (profile.targets?.titleKeywords || [])[0] || 'software engineer', where: profile.location?.city || '' } : {};
      return { key, ...defaults, ...env, ...obj };
    });
    if (!enabled.length) throw bad('No sources enabled. Turn one on in Settings → Sources, or seed the demo corpus.');
    const { jobs, errors, fetchedAt } = await fetchAll(enabled, profile);
    if (!jobs.length) {
      throw bad(
        `Nothing came back from: ${enabled.map((e) => e.key).join(', ')}.` +
          (errors.length ? ` Errors → ${errors.join(' | ')}` : '') +
          ' — note: this preview sandbox only allows outbound npm + api.github.com traffic. On your own machine these fetch real jobs.'
      );
    }
    const merged = mergeJobs(jobs, getJobs());
    saveJobs(merged.map((j) => ({ ...j, matchedAt: new Date().toISOString() })));
    json(res, { fetched: jobs.length, total: merged.length, errors, fetchedAt });
  })
);

/* ------------------------------ applications ------------------------------ */

app.get(
  '/api/apps',
  handle((req, res) => {
    const apps = getApplications();
    json(res, {
      apps,
      pipeline: PIPELINE,
      stats: {
        total: apps.length,
        byStatus: PIPELINE.reduce((acc, s) => ({ ...acc, [s]: apps.filter((a) => a.status === s).length }), {}),
        avgScore: apps.length ? Math.round(apps.reduce((a, b) => a + (b.score || 0), 0) / apps.length) : 0,
        today: countsToday().total,
        sources: [...new Set(apps.map((a) => a.source))],
      },
    });
  })
);

app.post(
  '/api/apps/draft',
  handle(async (req, res) => {
    const jobs = getJobs();
    const ids = Array.isArray(req.body?.jobIds) ? req.body.jobIds : req.body?.jobId ? [req.body.jobId] : [];
    if (!ids.length) throw bad('Pass jobId or jobIds[]');
    const profile = getProfile();
    const resume = getResume();
    const st = getSettings();
    const apps = getApplications();
    const out = [];
    for (const id of ids) {
      const job = jobs.find((j) => j.id === id);
      if (!job) continue;
      const existing = apps.find((a) => a.jobId === id);
      if (existing && !req.body?.force) {
        out.push(existing);
        continue;
      }
      const fresh = await composeApplication({ job, profile, resume, settings: st, forceMode: req.body?.mode });
      if (existing) Object.assign(existing, fresh, { id: existing.id, updatedAt: new Date().toISOString() });
      else apps.unshift(fresh);
      out.push(existing || fresh);
    }
    saveApplications(apps.slice(0, 500));
    json(res, { drafted: out.length, apps: out });
  })
);

app.patch(
  '/api/apps/:id',
  handle((req, res) => {
    const apps = getApplications();
    const i = apps.findIndex((a) => a.id === req.params.id);
    if (i === -1) throw bad('not found', 404);
    const cur = apps[i];
    const body = req.body || {};
    if (body.status && !PIPELINE.includes(body.status)) throw bad(`unknown status "${body.status}"`);
    let next = { ...cur, ...body, updatedAt: new Date().toISOString() };
    if (body.status && body.status !== cur.status) next = transition(cur, body.status, body.note);
    apps[i] = next;
    saveApplications(apps);
    json(res, { app: next });
  })
);

app.post(
  '/api/apps/:id/status',
  handle((req, res) => {
    const apps = getApplications();
    const i = apps.findIndex((a) => a.id === req.params.id);
    if (i === -1) throw bad('not found', 404);
    if (!PIPELINE.includes(req.body?.status)) throw bad(`unknown status "${req.body?.status}" — use one of: ${PIPELINE.join(', ')}`);
    apps[i] = transition(apps[i], req.body.status, req.body?.note);
    saveApplications(apps);
    json(res, { app: apps[i] });
  })
);

app.delete(
  '/api/apps/:id',
  handle((req, res) => {
    const apps = getApplications().filter((a) => a.id !== req.params.id);
    saveApplications(apps);
    json(res, { removed: true, count: apps.length });
  })
);

app.get(
  '/api/apps/:id/prefill',
  handle((req, res) => {
    const a = getApplications().find((x) => x.id === req.params.id);
    if (!a) throw bad('not found', 404);
    res.setHeader('content-disposition', `attachment; filename="applyflow-${slug(a.company)}-${slug(a.title)}.json"`);
    res.json({ kind: 'applyflow.prefill', payload: a.prefill, letter: a.letter, answers: a.answers, checklist: a.checklist });
  })
);

/** The exact JSON the browser extension reads for a single job (also copyable). */
app.get(
  '/api/apps/:id/extension-payload',
  handle((req, res) => {
    const a = getApplications().find((x) => x.id === req.params.id);
    if (!a) throw bad('not found', 404);
    res.json({ kind: 'applyflow.prefill', payload: a.prefill, letter: a.letter, answers: a.answers, checklist: a.checklist, extensionHint: 'Load this in the ApplyFlow extension → "Import pack", open the apply URL, press Fill.' });
  })
);

app.get(
  '/api/export/prefill.json',
  handle((req, res) => {
    const apps = getApplications().filter((a) => a.prefill);
    res.setHeader('content-disposition', 'attachment; filename="applyflow-prefill.json"');
    res.json({
      kind: 'applyflow.prefill-batch',
      version: 2,
      exportedAt: new Date().toISOString(),
      profile: getProfile(),
      resumeText: getResume()?.text?.slice(0, 9000) || null,
      resumeFilename: getResume()?.filename || null,
      packs: apps.map((a) => ({ appId: a.id, score: a.score, status: a.status, ...a.prefill })),
    });
  })
);

app.get(
  '/api/export/pack.md',
  handle((req, res) => {
    const apps = getApplications();
    const only = req.query.id ? apps.filter((a) => a.id === req.query.id) : apps;
    const md = only
      .map(
        (a) => `# ${a.title} — ${a.company}

- Match: ${a.score}/100 (${a.grade}) · Source: ${a.source} · Status: ${a.status}
- Apply: ${a.url}${a.applyEmail ? `\n- Email: ${a.applyEmail}` : ''}
- Resume: ${a.resumeFilename || 'none uploaded'} · Letter: ${a.letterMode}, ${a.letterWords} words

## Cover letter

${a.letter}

## Tailored resume (plain text — paste it or save as .txt)

${(a.tailoredResume || '(not generated — redraft this application to build it)').split('\n').map((l) => '    ' + l).join('\n')}

## What this posting reveals

${(a.insights?.insights || []).map((x) => `- **${x.label}** — ${x.value}`).join('\n') || '- no extra signals found in this posting'}
${(a.insights?.warnings || []).length ? '\\nWatch out: ' + a.insights.warnings.join(' | ') : ''}
${(a.tailoredAudit?.bullets || []).length ? `\nTailoring audit: ${a.tailoredAudit.bullets.length} bullets ranked, ${a.tailoredAudit.droppedBullets} demoted, promoted skills: ${a.tailoredAudit.skillsPromoted.join(', ') || 'none'} — no line was invented, every bullet comes from your profile.` : ''}

## Screening answers

${(a.answers || []).map((x) => `**Q — ${x.question}**  \nA — ${x.answer}`).join('\n\n')}

## Before you send

${(a.checklist?.warnings || []).map((w) => `- ⚠ ${w}`).join('\n') || '- no warnings'}
${(a.checklist?.needsManual || []).map((w) => `- ✋ ${w}`).join('\n')}
`
      )
      .join('\n---\n\n');
    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="applyflow-pack.md"');
    res.send(md || '# no applications drafted yet\n');
  })
);

/* ------------------------- job intelligence, tailoring, direct submit ------------------------- */

app.get(
  '/api/jobs/:id/research',
  handle(async (req, res) => {
    const job = getJobs().find((j) => j.id === req.params.id);
    if (!job) throw bad('job not found', 404);
    const profile = getProfile();
    const r = await research({ job, profile });
    const resume = getResume();
    const base = scoreJob(job, profile, resume);
    const match = scoreWithInsights(job, profile, candidateVector(profile, resume), [
      ...(r.insights || []).map((x) => x.value),
      ...(r.warnings || []),
      ...(r.positives || []),
    ]);
    json(res, {
      research: r,
      // baseScore is the raw matcher; score is what the posting's own signals justify.
      // Showing both keeps the nudge honest — you can see exactly how much the
      // intelligence moved it and which rule did it.
      match: {
        score: match.score,
        grade: match.grade,
        baseScore: base.score,
        delta: match.score - base.score,
        applied: match.insights?.applied || [],
        signals: match.insights?.lines || [],
      },
    });
  })
);

app.get(
  '/api/jobs/:id/tailored',
  handle((req, res) => {
    const job = getJobs().find((j) => j.id === req.params.id);
    if (!job) throw bad('job not found', 404);
    const profile = getProfile();
    const resume = getResume();
    const match = scoreJob(job, profile, resume);
    const { text, audit } = tailorResume({ job, profile, resume, match });
    if (req.query.format === 'txt') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="resume-${slug(job.company)}-${slug(job.title)}.txt"`);
      return res.send(toAtsPlain(text));
    }
    json(res, { tailored: text, plain: toAtsPlain(text), audit, match: { score: match.score } });
  })
);

/**
 * Direct submit through a public ATS API. Dry run unless {confirm:true}; a real
 * send additionally needs Settings → Direct ATS submit. The library holds the
 * other rails (resume required, one send per app, shared daily cap) — see
 * server/lib/atsSubmit.mjs for why this only works for Greenhouse/Lever.
 */
app.post(
  '/api/apps/:id/submit',
  handle(async (req, res) => {
    const a = getApplications().find((x) => x.id === req.params.id);
    if (!a) throw bad('not found', 404);
    const job = getJobs().find((j) => j.id === a.jobId) || a;
    const out = await submitToAts({
      job,
      profile: getProfile(),
      app: a,
      resumeText: a.tailoredPlain || getResume()?.text || '',
      tailoredLetter: a.letter,
      letterText: a.tailoredResume || a.letter,
      confirm: Boolean(req.body?.confirm),
    });
    const after = getApplications().find((x) => x.id === a.id);
    json(res, { ...out, app: { id: a.id, status: after?.status }, log: submitLog(5) });
  })
);

/** The tailored resume that was frozen onto this application (paste-ready). */
app.get(
  '/api/apps/:id/tailored.txt',
  handle((req, res) => {
    const a = getApplications().find((x) => x.id === req.params.id);
    if (!a) throw bad('not found', 404);
    if (!a.tailoredResume) throw bad('this application predates tailoring — hit redraft to generate one', 409);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="resume-${slug(a.company)}-${slug(a.title)}.txt"`);
    res.send(a.tailoredPlain || toAtsPlain(a.tailoredResume));
  })
);

app.get(
  '/api/apps/:id/submit-support',
  handle((req, res) => {
    const a = getApplications().find((x) => x.id === req.params.id);
    if (!a) throw bad('not found', 404);
    const job = getJobs().find((j) => j.id === a.jobId) || a;
    json(res, {
      support: submitSupport(job, { settings: getSettings() }),
      enabled: Boolean(getSettings().atsSubmit?.enabled),
      log: submitLog(10),
    });
  })
);

app.get(
  '/api/submissions',
  handle((req, res) => json(res, { submissions: submitLog(50), enabled: Boolean(getSettings().atsSubmit?.enabled) }))
);

/* ------------------------------- auto-apply runner ------------------------- */

app.get(
  '/api/runner',
  handle((req, res) => {
    const jobs = getJobs();
    const profile = getProfile();
    const resume = getResume();
    const drafted = new Set(getApplications().map((a) => a.jobId));
    const st = getSettings();
    const top = jobs
      .map((job) => ({ job, match: scoreJob(job, profile, resume) }))
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 14)
      .map(({ job, match }) => ({
        jobId: job.id,
        title: job.title,
        company: job.company,
        source: job.source,
        url: job.url,
        score: match.score,
        grade: match.grade,
        already: drafted.has(job.id),
        flags: match.flags,
        missing: match.missingSkills.slice(0, 4),
      }));
    const min = st.autoApply.minScore ?? 70;
    json(res, {
      top,
      policy: st.autoApply,
      counts: countsToday(),
      eligible: top.filter((p) => !p.already && p.score >= min && !p.flags.some((f) => /below your salary floor|exclude term|internship/.test(f))).length,
      totalJobs: jobs.length,
      drafted: drafted.size,
    });
  })
);

app.post(
  '/api/runner/run',
  handle(async (req, res) => {
    const st = getSettings();
    const overrides = {};
    for (const k of ['minScore', 'dailyCap', 'perSourcePerDay', 'cooldownHours', 'enabled', 'mode']) {
      if (req.body?.[k] !== undefined) overrides[k] = req.body[k];
    }
    if (Object.keys(overrides).length) st.autoApply = { ...st.autoApply, ...overrides };
    if (Object.keys(overrides).length && req.body?.persist !== false) saveSettings({ autoApply: st.autoApply });
    if (!st.autoApply.enabled && !Array.isArray(req.body?.jobIds)) {
      throw bad('Auto-apply is off. Enable it in Settings → policy (or pass jobIds to draft specific jobs once).');
    }
    const out = await runAutoApply({
      jobs: getJobs(),
      profile: getProfile(),
      resume: getResume(),
      settings: st,
      dryRun: Boolean(req.body?.dryRun),
      onlyIds: Array.isArray(req.body?.jobIds) && req.body.jobIds.length ? req.body.jobIds : null,
    });
    json(res, out);
  })
);

/** Cron seam: `17 8 * * * curl -sX POST localhost:3000/api/runner/tick`.
 * Same guards as the manual run (enabled flag, min score, daily + per-source caps). */
app.post(
  '/api/runner/tick',
  handle(async (req, res) => {
    const st = getSettings();
    if (!st.autoApply?.enabled) return json(res, { ran: false, reason: 'auto-apply disabled', policy: st.autoApply });
    const out = await runAutoApply({ jobs: getJobs(), profile: getProfile(), resume: getResume(), settings: st });
    json(res, { ran: true, drafted: out.queued.length, cutByCap: out.cutByCap, counts: out.counts, at: new Date().toISOString() });
  })
);

/* --------------------------------- settings -------------------------------- */

app.get(
  '/api/settings',
  handle((req, res) => {
    const s = getSettings();
    json(res, { settings: { ...s, llm: { ...s.llm, apiKey: s.llm.apiKey ? `••••${String(s.llm.apiKey).slice(-4)}` : '' } } });
  })
);

app.put(
  '/api/settings',
  handle((req, res) => {
    const body = req.body || {};
    if (body.llm && String(body.llm.apiKey || '').startsWith('••••')) delete body.llm.apiKey;
    json(res, { settings: saveSettings(body) });
  })
);

app.post(
  '/api/reset',
  handle((req, res) => {
    writeStore('applications', []);
    writeStore('jobs', []);
    writeStore('runs', { byDay: {}, log: [] });
    json(res, { reset: true });
  })
);

/* ---------------------------------- utils --------------------------------- */

function mergeJobs(next, prev) {
  const byKey = new Map();
  for (const j of prev || []) byKey.set(j.extId || j.id, j);
  for (const j of next) {
    const key = j.extId || j.id;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...j,
      id: existing?.id || j.id || `job_${uid()}`,
      firstSeenAt: existing?.firstSeenAt || new Date().toISOString(),
      seenCount: (existing?.seenCount || 0) + 1,
    });
  }
  return [...byKey.values()].slice(0, 2500);
}

function recomputeAll(profile) {
  const resume = getResume();
  const jobs = getJobs().map((j) => ({ ...j, matchedAt: new Date().toISOString(), _scored: scoreJob(j, profile, resume).score }));
  saveJobs(jobs);
  return jobs;
}

function profileCompleteness(p) {
  const checks = [
    ['Name', Boolean(p.fullName)],
    ['Email', Boolean(p.email)],
    ['Phone', Boolean(p.phone)],
    ['Location', Boolean(p.location?.city)],
    ['Headline / positioning', Boolean(p.linkedinHeadline)],
    ['Work history', (p.experience || []).length > 0],
    ['Education', (p.education || []).length > 0],
    ['At least 5 skills', (p.skills || []).length >= 5],
    ['Target fields chosen', (p.targets?.fields || []).length > 0],
    ['Salary floor set', Boolean(p.targets?.minSalary)],
    ['Notice period set', Boolean(p.freeTextAnswers?.noticePeriod)],
    ['Resume on file', Boolean(getResume())],
  ];
  const passed = checks.filter(([, v]) => v).length;
  return { percent: Math.round((passed / checks.length) * 100), items: checks.map(([label, value]) => ({ label, value })) };
}

function slug(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job';
}

/* ----------------------------------- ui ----------------------------------- */

app.get('/healthz', (req, res) => res.json({ ok: true, uptime: os.uptime(), dataDir: DATA_DIR }));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: `no route: ${req.method} ${req.path}` });
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

const PORT = Number(process.env.PORT || 3000);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  guardNodeVersion({ hard: true });
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ApplyFlow → http://localhost:${PORT}  (data: ${DATA_DIR})`);
    if (nodeTooOld()) console.log(`  ⚠ ${nodeVersionAdvice()}`);
  });
}

/** Reported so /api/meta can show it instead of letting a user guess why PDFs fail. */
export const runtimeInfo = {
  node: process.versions.node,
  nodeOk: !nodeTooOld(),
  nodeMin: `${MIN_NODE.major}.${MIN_NODE.minor}`,
  advice: nodeTooOld() ? nodeVersionAdvice() : null,
};

export default app;
