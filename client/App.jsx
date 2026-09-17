import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, toast, onToast } from './api.js';
import { Panel, Ring, Spinner, useLocal, timeAgo, Bar, RealtimeActions } from './ui.jsx';
import { ProfileTab, ResumeTab } from './ProfileTab.jsx';
import { JobsTab } from './JobsTab.jsx';
import { AppsTab } from './AppsTab.jsx';
import { SettingsTab } from './SettingsTab.jsx';

const TABS = [
  { id: 'dash', label: 'Overview' },
  { id: 'profile', label: 'Profile' },
  { id: 'resume', label: 'Resume' },
  { id: 'jobs', label: 'Job matches' },
  { id: 'apps', label: 'Applications' },
  { id: 'settings', label: 'Sources & settings' },
];

export default function App() {
  const [tab, setTab] = useLocal('tab', 'dash');
  const [toasts, setToasts] = useState([]);
  const [meta, setMeta] = useState(null);
  const [profile, setProfile] = useState(null);
  const [completeness, setCompleteness] = useState(null);
  const [resume, setResume] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [apps, setApps] = useState([]);
  const [appStats, setAppStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => onToast((t) => setToasts((cur) => (t.remove ? cur.filter((x) => x.id !== t.id) : [...cur.filter((x) => x.id !== t.id), t]))), []);

  const refresh = useCallback(async (what = 'all') => {
    try {
      const need = what === 'all' ? ['jobs', 'apps', 'profile', 'settings'] : [what];
      if (need.includes('profile')) {
        const p = await api.profile();
        setProfile(p.profile);
        setCompleteness(p.completeness);
      }
      if (need.includes('jobs')) {
        const j = await api.jobs({});
        setJobs(j.jobs || []);
      }
      if (need.includes('apps')) {
        const a = await api.apps();
        setApps(a.apps || []);
        setAppStats(a.stats);
      }
      if (need.includes('settings')) {
        const s = await api.settings();
        setSettings(s.settings);
      }
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const m = await api.meta();
        setMeta(m);
        await refresh('all');
        const r = await api.resume();
        setResume(r.resume);
        /* Nothing is seeded on first run, on purpose. The old "give them something to
           look at" behaviour filled the store with hand-written postings, so a new
           user's first scores, letters and prefill payloads were fiction. The server
           pulls live data on boot instead (see FETCH_ON_BOOT in server/index.mjs). */
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh('apps');
    }, 45000);
    return () => clearInterval(t);
  }, [refresh]);

  const badges = useMemo(
    () => ({ jobs: jobs.length, apps: apps.length, resume: resume ? 1 : 0 }),
    [jobs.length, apps.length, resume]
  );

  if (!meta || !profile) {
    return (
      <div className="app">
        <div style={{ padding: 60, textAlign: 'center' }}>
          {error ? (
            <div className="note warn" style={{ maxWidth: 560, margin: '0 auto' }}>
              <h5>API not reachable</h5>
              <div className="small">{error}</div>
              <div className="small mt8">start it with <span className="mono">npm run dev</span> (or <span className="mono">npm run build &amp;&amp; npm start</span>).</div>
            </div>
          ) : (
            <Spinner text="loading ApplyFlow…" />
          )}
        </div>
      </div>
    );
  }

  const auto = settings?.autoApply || {};

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark">A</span>
          ApplyFlow <small>match · draft · pre-fill</small>
        </div>
        <span className="pill" title="profile completeness">profile {completeness?.percent ?? 0}%</span>
        <span className={`pill ${auto.enabled ? 'on' : ''}`} title="auto-apply runner policy">
          <span className="dot" /> auto-apply {auto.enabled ? `≥${auto.minScore} · cap ${auto.dailyCap}/day` : 'off'}
        </span>
        <span className="pill">{jobs.length} jobs · {apps.length} drafts</span>
        <span style={{ flex: 1 }} />
        {busy && <Spinner />}
        <button
          className="btn sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.recompute();
              await refresh('jobs');
              toast('re-scored all jobs');
            } catch (e) {
              toast(e.message, 'err');
            }
            setBusy(false);
          }}
        >
          re-score
        </button>
        <button
          className="btn sm primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.run({});
              await refresh('all');
              toast(r.queued?.length ? `auto-apply drafted ${r.queued.length} application(s)` : r.reason || 'nothing eligible today', r.queued?.length ? 'ok' : 'warn', 7000);
            } catch (e) {
              toast(e.message, 'err', 7000);
            }
            setBusy(false);
          }}
        >
          run auto-apply
        </button>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {badges[t.id] != null && badges[t.id] > 0 && <span className="badge">{badges[t.id]}</span>}
            {t.id === 'profile' && completeness && completeness.percent < 100 && <span className="badge">{completeness.percent}%</span>}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'dash' && (
          <Dashboard
            meta={meta}
            profile={profile}
            completeness={completeness}
            jobs={jobs}
            apps={apps}
            appStats={appStats}
            resume={resume}
            settings={settings}
            setTab={setTab}
            refresh={refresh}
            busy={busy}
            setBusy={setBusy}
          />
        )}
        {tab === 'profile' && <ProfileTab profile={profile} meta={meta} setProfile={setProfile} refresh={() => refresh('all')} busy={busy} />}
        {tab === 'resume' && <ResumeTab resume={resume} setResume={setResume} refresh={() => refresh('all')} busy={busy} />}
        {tab === 'jobs' && <JobsTab jobs={jobs} meta={meta} profile={profile} refresh={() => refresh('jobs')} busy={busy} setBusy={setBusy} />}
        {tab === 'apps' && (
          <AppsTab
            apps={apps}
            stats={appStats}
            pipeline={meta.pipeline}
            meta={{ autoApply: auto }}
            profile={profile}
            refresh={() => refresh('apps')}
            busy={busy}
            setBusy={setBusy}
          />
        )}
        {tab === 'settings' && <SettingsTab settings={settings} setSettings={setSettings} meta={meta} refresh={() => refresh('all')} busy={busy} setBusy={setBusy} />}
      </main>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : t.kind === 'warn' ? 'warn' : ''}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- dashboard -------------------------------- */

function Dashboard({ meta, profile, completeness, jobs, apps, appStats, resume, settings, setTab, refresh, busy, setBusy }) {
  const top = [...jobs].sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0)).slice(0, 6);
  const byField = (profile.targets?.fields || []).map((f) => meta.fields.find((x) => x.id === f)?.label || f);
  const counts = meta.counts || { total: 0 };
  const ready = apps.filter((a) => a.status === 'ready').length;
  const submitted = apps.filter((a) => ['submitted', 'interview', 'offer'].includes(a.status)).length;

  return (
    <div>
      <div className="split">
        <div>
          <h1 className="page">Your job search, automated up to the submit button</h1>
          <p className="sub">
            ApplyFlow keeps one master profile, ingests postings from the sources you enable, scores every one against your resume, then writes the letter and
            answers the screening questions. What it deliberately does <b>not</b> do is press submit on a third-party ATS with your credentials — instead it
            hands you (or the bundled browser extension, running in your own logged-in session) a pre-filled form.
          </p>

          <div className="grid cols-4">
            <Stat k="profile ready" v={`${completeness.percent}%`} n={`${completeness.items.filter((i) => i.value).length}/${completeness.items.length} checks`} />
            <Stat k="jobs in store" v={jobs.length} n={jobs.length ? `${[...new Set(jobs.map((j) => j.source))].length} source(s)` : 'nothing real yet → fetch, or harvest a page you have open'} />
            <Stat k="drafted today" v={counts.total || 0} n={`cap ${settings?.autoApply?.dailyCap ?? 10}/day`} />
            <Stat k="awaiting your send" v={ready} n={submitted ? `${submitted} already submitted` : 'nothing submitted yet'} />
          </div>

          <Panel
            title="Setup"
            sub="three steps and the loop runs daily"
            right={<Bar value={completeness.percent} label="" />}
          >
            <div className="grid cols-3">
              <Step n={1} title="profile + answers" done={completeness.percent >= 80} onClick={() => setTab('profile')}>
                {completeness.items.filter((i) => !i.value).slice(0, 4).map((i) => <div key={i.label} className="chip miss">{i.label}</div>)}
                {!completeness.items.some((i) => !i.value) && <span className="chip good">all checks pass ✓</span>}
              </Step>
              <Step n={2} title="resume in" done={Boolean(resume)} onClick={() => setTab('resume')}>
                {resume ? <span className="chip good">{resume.filename} · {resume.summary?.skills?.length || 0} skills mined</span> : <span className="chip miss">no resume yet — parsing it is the biggest quality jump you can make</span>}
              </Step>
              <Step n={3} title="sources + policy" done={Boolean(settings?.sources && Object.values(settings.sources).some(Boolean)) && Boolean(settings?.autoApply?.enabled)} onClick={() => setTab(settings?.autoApply?.enabled ? 'settings' : 'apps')}>
                <span className={`chip ${Object.values(settings?.sources || {}).some(Boolean) ? 'good' : 'miss'}`}>{Object.keys(settings?.sources || {}).filter((k) => settings?.sources?.[k]).length || 0} source(s) on</span>
                <span className={`chip ${settings?.autoApply?.enabled ? 'good' : 'flag'}`}>runner {settings?.autoApply?.enabled ? 'enabled' : 'off'}</span>
              </Step>
            </div>
            <div className="note info mt16">
              <h5>Targeting right now</h5>
              fields: {byField.join(', ') || 'none set'} · seniority: {(profile.targets?.seniority || []).join(', ') || '—'} · floor:{' '}
              {profile.targets?.minSalary ? `${(profile.targets.minSalary / 100000).toFixed(1)}L ${(profile.targets.salaryCurrency || 'INR').toUpperCase()}` : 'unset'} · exclude:{' '}
              {(profile.targets?.excludeKeywords || []).slice(0, 6).join(', ') || 'none'}
            </div>
            <div className="btn-row mt12">
              <RealtimeActions meta={meta} refresh={() => refresh('jobs')} busy={busy} setBusy={setBusy} toast={toast} variant="sm" />
              <button className="btn sm" disabled={busy} onClick={() => setTab('jobs')}>review matches →</button>
              <button
                className="btn sm primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.run({ dryRun: true });
                    toast(`would draft ${r.queued.length} today — run it from the top-right button to commit`, 'ok', 6000);
                  } catch (e) {
                    toast(e.message, 'err', 7000);
                  }
                  setBusy(false);
                }}
              >
                preview today's auto-apply
              </button>
            </div>
          </Panel>

          <Panel title="Top matches right now" right={<button className="btn sm ghost" onClick={() => setTab('jobs')}>all {jobs.length} →</button>}>
            {!top.length && (
              <div className="empty">
                <b>no jobs in the store — and there is no offline filler any more</b>
                enable a source in Settings → Sources and press <i>fetch live jobs</i>, or read a page you already have open with the extension (Harvest → import).
                A fetch that is blocked or rate-limited will tell you so here rather than showing you made-up postings.
              </div>
            )}
            {top.map((j) => (
              <div className="job" key={j.id} style={{ gridTemplateColumns: '54px 1fr auto' }}>
                <Ring score={j.match.score} size={44} />
                <div style={{ minWidth: 0 }}>
                  <div className="job-title">{j.title}</div>
                  <div className="job-meta">
                    <span>{j.company}</span>
                    <span>{j.location}</span>
                    <span className="chip src">{j.source}</span>
                    {j.app && <span className="pill on" style={{ fontSize: 11 }}>{j.app.status}</span>}
                  </div>
                  <div className="job-bits">
                    {(j.match.matchedSkills || []).slice(0, 5).map((s) => <span key={s} className="chip good">✓ {s}</span>)}
                    {(j.match.flags || []).slice(0, 2).map((f) => <span key={f} className="chip flag">⚠ {f}</span>)}
                  </div>
                </div>
                <div className="btn-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); try { await api.draft([j.id], { force: true }); await refresh('apps'); toast(`drafted ${j.company}`); } catch (e) { toast(e.message, 'err'); } setBusy(false); }}>
                    {j.app ? 'redraft' : 'draft'}
                  </button>
                  {j.url && <a className="btn sm ghost" href={j.url} target="_blank" rel="noreferrer noopener">open ↗</a>}
                </div>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel title="Pipeline">
            {!apps.length ? (
              <div className="empty small">drafted applications will show up here as a funnel</div>
            ) : (
              <table>
                <tbody>
                  {meta.pipeline.filter((s) => appStats.byStatus[s]).map((s) => (
                    <tr key={s}>
                      <td className="muted">{s}</td>
                      <td className="right mono">{appStats.byStatus[s]}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="muted">avg match</td>
                    <td className="right mono">{appStats.avgScore}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <div className="btn-row mt12">
              <button className="btn sm" onClick={() => setTab('apps')}>open applications</button>
              <a className="btn sm ghost" href={api.exportPackUrl} target="_blank" rel="noreferrer">my pack (.md)</a>
            </div>
          </Panel>

          <Panel title="The deal with 'auto apply'" sub="read this once, then you'll never have to think about it">
            <ul className="list" style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--muted)' }}>
              <li>Job boards (LinkedIn, Indeed, Workday) prohibit scripted submissions and detect them. Accounts get restricted — and you'd have to hand this app your password.</li>
              <li>So ApplyFlow automates <b>everything that is safe to automate</b>: sourcing, ranking, letter writing, answer generation, form field mapping.</li>
              <li>The last click stays yours — or yours-with-a-helper: the bundled extension fills the form in <b>your</b> browser session, and a 1.5s pause lets you read before Submit.</li>
              <li>Rate limits (default {settings?.autoApply?.dailyCap ?? 10}/day, {settings?.autoApply?.perSourcePerDay ?? 4} per source) exist because recruiters talk and because mass-applying 300 jobs at once gets your domains flagged.</li>
            </ul>
            <div className="note ok mt12 small">Net effect vs. the manual version: roughly the same "genuine application" quality, at 10-20× the volume, with zero time spent typing your address for the 400th time.</div>
          </Panel>

          <Panel title="Env status">
            <div className="kv">
              <div>LLM key</div><div>{meta.env.llmKeyConfigured ? 'present ✓' : 'none (template composer)'}</div>
              <div>Adzuna</div><div>{meta.env.adzunaKey ? 'present ✓' : 'needs keys'}</div>
              <div>Jooble</div><div>{meta.env.joobleKey ? 'present ✓' : 'needs key'}</div>
              <div>data dir</div><div className="mono small">{meta.env.dataDir}</div>
              <div>outbound net</div>
              <div className="small" title={meta.env.outboundNote || ''}>
                {meta.env.outboundNet === 'open'
                  ? 'api.github.com reachable — live fetches will work'
                  : <>blocked here <span className="dim">({meta.env.outboundNote || 'unreachable'})</span> — import listings instead</>}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, n }) {
  return (
    <div className="panel stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="n">{n}</div>
    </div>
  );
}

function Step({ n, title, done, children, onClick }) {
  return (
    <div className="panel" style={{ background: 'var(--panel-2)' }}>
      <div className="panel-body">
        <div className="flexr">
          <span className={`chip ${done ? 'good' : 'flag'}`}>{done ? '✓ done' : `step ${n}`}</span>
          <b style={{ fontSize: 13.5 }}>{title}</b>
          <span style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={onClick}>{done ? 'edit' : 'fix'}</button>
        </div>
        <div className="job-bits mt8">{children}</div>
      </div>
    </div>
  );
}
