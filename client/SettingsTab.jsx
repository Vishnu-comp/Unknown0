import { useEffect, useState } from 'react';
import { api, toast } from './api.js';
import { Panel, Field, Toggle, Spinner } from './ui.jsx';

const SOURCE_GUIDE = {
  github_archive: {
    help: 'The archived public GitHub Jobs corpus (~19k real postings). No key, no signup — and it only needs api.github.com, which most networks allow even when they block everything else (a sandbox with npm-only egress will not even allow that). Historical (the feed stopped in 2021): good for backfill and for checking the matcher, not for today’s market.',
    fields: [],
  },
  adzuna: {
    help: 'One free key pulls Indeed, CareerBuilder, ZipRecruiter, Monster, Naukri and RookiemandRoo feeds. Get keys at developer.adzuna.com (instant, no approval for personal use).',
    fields: [
      { k: 'appId', label: 'app_id', env: 'ADZUNA_APP_ID' },
      { k: 'appKey', label: 'app_key', env: 'ADZUNA_APP_KEY', secret: true },
      { k: 'country', label: 'country code', placeholder: 'in | us | gb | de | au', env: 'ADZUNA_COUNTRY' },
      { k: 'what', label: 'what (query)', placeholder: 'software engineer' },
      { k: 'where', label: 'where', placeholder: 'Bengaluru' },
      { k: 'resultsPerPage', label: 'results per page', type: 'number', placeholder: '50' },
    ],
  },
  jooble: {
    help: 'Aggregates company career pages and niche boards. Free key from jooble.org/api/about; rate-limited to a few thousand calls/day.',
    fields: [
      { k: 'apiKey', label: 'API key', env: 'JOOBLE_API_KEY', secret: true },
      { k: 'what', label: 'keywords', placeholder: 'backend engineer' },
      { k: 'where', label: 'location', placeholder: 'Bengaluru, India' },
    ],
  },
  greenhouse: {
    help: 'Huge number of companies (Stripe, Datadog, Ramp, GitLab…) publish their whole board as open JSON. Add board slugs, one per line — this is the highest-quality free source.',
    fields: [{ k: 'boards', label: 'board slugs (one per line)', type: 'list', placeholder: 'stripe\ndatadog\nramp\ncoinbase\npostman' }],
  },
  lever: {
    help: 'Same idea for Lever customers: api.lever.co/v0/postings/{org}?mode=json. Add org slugs.',
    fields: [{ k: 'companies', label: 'org slugs (one per line)', type: 'list', placeholder: 'netflix\npalantir\nplaid' }],
  },
  naukri: {
    help:
      'No public API exists — this calls Naukri’s own undocumented search endpoint, then falls back to reading their server-rendered HTML. It works until they change it or challenge the request, so treat it as best-effort and use the extension (or Import below) as the reliable path. Expect "blocked by anti-bot" if your network is datacenter-IP’d.',
    fields: [
      { k: 'keyword', label: 'keyword', placeholder: 'java backend engineer' },
      { k: 'location', label: 'location', placeholder: 'Bengaluru' },
      { k: 'pages', label: 'pages (1-5)', type: 'number', placeholder: '2' },
      { k: 'experience', label: 'experience (yrs)', type: 'number', placeholder: '3' },
      { k: 'freshness', label: 'last N days', type: 'number', placeholder: '7' },
      { k: 'workMode', label: 'work mode', placeholder: 'WFO | WFH | Hybrid' },
    ],
  },
};

/* Shown inside the Import box so a first attempt is a copy-paste, not a guess at
   the schema. Kept parseable on purpose — it is also the fixture for the note in
   server/lib/harvest.mjs about what a row needs. */
const IMPORT_SAMPLE = `[
  {
    "title": "Senior Backend Engineer",
    "companyName": "Zerodha",
    "location": "Bengaluru",
    "url": "https://www.linkedin.com/jobs/view/4123456789/",
    "salary": "₹30 - ₹45 Lakhs p.a.",
    "experience": "3-6 Yrs",
    "skills": ["Java", "Spring Boot", "Kafka"]
  }
]`;

export function SettingsTab({ settings, setSettings, meta, refresh, busy, setBusy }) {
  const [draft, setDraft] = useState(settings || { sources: {}, autoApply: {}, llm: {} });
  const [testing, setTesting] = useState(null);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState(null);

  useEffect(() => setDraft(settings || { sources: {}, autoApply: {}, llm: {} }), [JSON.stringify(settings)]);

  const enabledKeys = Object.keys(draft.sources || {}).filter((k) => draft.sources[k]);

  async function save() {
    setBusy(true);
    try {
      const cleaned = {
        ...draft,
        sources: Object.fromEntries(
          Object.entries(draft.sources || {}).map(([k, v]) => [
            k,
            typeof v === 'object' && v
              ? Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, typeof vv === 'string' && vv.includes('\n') ? vv.split('\n').map((s) => s.trim()).filter(Boolean) : vv]))
              : v,
          ])
        ),
      };
      const r = await api.saveSettings(cleaned);
      setSettings({ ...r.settings, llm: r.settings.llm });
      toast('settings saved');
    } catch (e) {
      toast(e.message, 'err');
    }
    setBusy(false);
  }

  function setSrc(key, patch) {
    setDraft((d) => ({ ...d, sources: { ...d.sources, [key]: { ...(typeof d.sources[key] === 'object' && d.sources[key] ? d.sources[key] : {}), ...patch } } }));
  }

  async function test(key) {
    setTesting(key);
    try {
      const r = await api.fetchJobs([key]);
      await refresh();
      toast(`${key}: ${r.fetched} jobs · ${r.total} total${r.errors?.length ? ` · errors: ${r.errors.join('; ')}` : ''}`, r.errors?.length ? 'warn' : 'ok', 8000);
    } catch (e) {
      toast(e.message, 'err', 10000);
    }
    setTesting(null);
  }

  /* Import never touches the network: the paste already happened. The server does
     the normalising (see server/lib/harvest.mjs) so scores, letters, tailoring and
     the prefill pack work on imported rows exactly as they do on fetched ones. */
  async function runImport() {
    let parsed;
    try {
      parsed = JSON.parse(importText);
    } catch (e) {
      setImportStatus({ kind: 'bad', text: `not valid JSON: ${e.message}` });
      return;
    }
    setBusy(true);
    setImportStatus({ kind: 'busy', text: 'normalising…' });
    try {
      const r = await api.importJobs(parsed);
      setImportStatus({
        kind: 'good',
        text: `${r.imported} imported${r.skipped ? `, ${r.skipped} skipped (rows need a title and a url)` : ''} · corpus now ${r.total}${r.bySource ? ` · ${Object.entries(r.bySource).map(([k, v]) => `${k}:${v}`).join(' ')}` : ''}`,
      });
      setImportText('');
      refresh();
    } catch (e) {
      setImportStatus({ kind: 'bad', text: e.message || 'import failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page">Sources, model &amp; policy</h1>
      <p className="sub">
        Two things decide how good this gets: <b>how much of the market you ingest</b> (sources) and <b>how honest your profile is</b> (matching). Keys are
        stored in <span className="mono">{meta?.env?.dataDir || 'data'}/settings.json</span> on your machine — never sent anywhere except that source.
      </p>

      <Panel title="Job sources" sub="enabled sources are used by “fetch” and by the daily runner">
        {(meta?.sources || []).map((s) => {
          const guide = SOURCE_GUIDE[s.key] || { help: '', fields: [] };
          const on = Boolean(draft.sources?.[s.key]);
          const cfg = typeof draft.sources?.[s.key] === 'object' && draft.sources[s.key] ? draft.sources[s.key] : {};
          const envFromEnv = s.key === 'adzuna' ? meta?.env?.adzunaKey : s.key === 'jooble' ? meta?.env?.joobleKey : false;
          return (
            <div key={s.key} className="panel" style={{ background: 'var(--panel-2)', marginBottom: 10 }}>
              <div className="panel-body">
                <div className="flexr" style={{ gap: 12 }}>
                  <Toggle
                    checked={on}
                    onChange={(v) =>
                      setDraft((d) => {
                        const base = on ? true : typeof d.sources[s.key] === 'object' && d.sources[s.key] ? d.sources[s.key] : {};
                        return { ...d, sources: { ...d.sources, [s.key]: v ? { ...base } : false } };
                      })
                    }
                    label={s.label}
                    hint={on ? 'enabled' : 'disabled'}
                  />
                  <span style={{ flex: 1 }} />
                  {on && <button className="btn sm" disabled={testing === s.key} onClick={() => test(s.key)}>{testing === s.key ? <Spinner text="fetching…" /> : 'test fetch'}</button>}
                </div>
                <div className="dim small mt8">{guide.help}</div>
                {envFromEnv && <div className="chip good mt8">credentials are already in env vars — fields below can stay blank</div>}
                {on && guide.fields.length > 0 && (
                  <div className="grid cols-3 mt12">
                    {guide.fields.map((f) => (
                      <Field key={f.k} label={f.label} hint={f.env ? `or env ${f.env}` : undefined}>
                        {f.type === 'list' ? (
                          <textarea rows={3} value={Array.isArray(cfg[f.k]) ? cfg[f.k].join('\n') : cfg[f.k] || ''} placeholder={f.placeholder} onChange={(e) => setSrc(s.key, { [f.k]: e.target.value })} />
                        ) : (
                          <input
                            type={f.secret ? 'password' : f.type === 'number' ? 'number' : 'text'}
                            value={cfg[f.k] ?? ''}
                            placeholder={f.placeholder}
                            onChange={(e) => setSrc(s.key, { [f.k]: e.target.value })}
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div className="note info">
          <h5>Why not “just log into LinkedIn and apply for me”?</h5>
          Because their ToS forbid automated access, they run captcha + device fingerprinting, and a server holding your session cookie is the single worst
          trade-off in this whole space — one leak and your LinkedIn (your actual professional identity) is gone. ApplyFlow keeps the submit click on your
          side, in your own browser, and automates everything up to that point. If you later want to accept that risk for yourself, the seam to add it is
          <span className="mono"> server/lib/automation.mjs → composeApplication()</span>, plus a Playwright worker — not a server-side password vault.
        </div>
      </Panel>

      <Panel title="Import jobs (paste JSON, or push from the extension)" sub="one normaliser for every path — pasted JSON, the extension's push and the source fetchers all land on the same shape">
        <div className="panel-body">
          <div className="dim small">
            Neither LinkedIn nor Naukri has a public jobs API: LinkedIn's Jobs API is partner-OAuth only, and Naukri's is an internal endpoint behind an
            active anti-bot challenge. So the reliable route is to read the page <b>you already have open</b> — the Chrome extension harvests the cards in
            your own session and pushes them here. Nothing is clicked, no cookies are read, and the last click stays yours.
          </div>
          <div className="mt12">
            <textarea rows={8} className="mono" style={{ width: '100%', fontSize: 12 }} placeholder={IMPORT_SAMPLE} value={importText} onChange={(e) => setImportText(e.target.value)} />
          </div>
          <div className="flexr mt8" style={{ gap: 8 }}>
            <button className="btn sm" disabled={busy || !importText.trim()} onClick={runImport}>
              {busy ? 'importing…' : 'import'}
            </button>
            <button className="btn sm" disabled={!importText.trim()} onClick={() => setImportText(IMPORT_SAMPLE)}>
              use sample
            </button>
            <span style={{ flex: 1 }} />
            {importStatus && <span className={`chip ${importStatus.kind === 'good' ? 'good' : importStatus.kind === 'bad' ? 'bad' : ''}`}>{importStatus.text}</span>}
          </div>
          <div className="note info mt12">
            <h5>What a row may look like</h5>
            A bare array, an object with <span className="mono">jobs: […]</span>, or a raw Naukri search response are all accepted — field names are mapped for you
            (<span className="mono">jobTitle / title / name</span>, <span className="mono">companyName / company</span>, <span className="mono">salary / ctc / salaryText</span>,
            <span className="mono"> experience / yoe</span>, <span className="mono">skills / keySkills</span>, <span className="mono">serpActionUrl / jobUrl / link</span>).
            A row only needs a <b>title</b> and a <b>url</b>; anything else is counted as skipped rather than guessed, and unknown values stay null instead of
            being invented — because a salary that looks real but isn't ends up typed into an actual form.
          </div>
        </div>
      </Panel>

      <Panel title="Direct ATS submit (Greenhouse / Lever only)" sub="opt-in. Some boards publish a public apply API; for exactly those, ApplyFlow can POST an application without a browser. Everything else stays manual-on-purpose.">
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div>
            <Toggle
              checked={Boolean(draft.atsSubmit?.enabled)}
              onChange={(v) => setDraft((d) => ({ ...d, atsSubmit: { ...d.atsSubmit, enabled: v } }))}
              label="allow real sends (dry run preview still always available)"
              hint="off = the payload can be previewed but never sent. this is the switch the runner and the app detail button both respect."
            />
            <div className="note warn mt12 small">
              A direct submit is a real application on a real record. There is no undo, so each one needs an explicit confirm, and the daily cap you set for the
              runner is shared with these sends. Everything is written to <span className="mono">data/submissions.json</span>.
            </div>
          </div>
          <div>
            <h4 className="sec" style={{ marginTop: 0 }}>what it will never do</h4>
            <ul className="list small" style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)' }}>
              <li>log into LinkedIn / Indeed / Workday / iCIMS, or replay a signed token from your session</li>
              <li>send an application with no resume, or the same application twice</li>
              <li>submit while a required questionnaire answer is blank — it refuses instead of guessing</li>
              <li>run without the opt-in above, so an accidental click cannot fire</li>
            </ul>
            <div className="dim small mt12">
              Greenhouse and Lever job pages are public and their apply endpoint is the same one their own “Apply” button posts to — using it is normal use of
              their product. For those two, “auto apply” genuinely means auto.
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Writing model (optional)" sub="leave provider = none and the deterministic template composer is used. It is genuinely good; the model only adds variety.">
        <div className="grid cols-3">
          <Field label="provider">
            <select value={draft.llm?.provider || 'none'} onChange={(e) => setDraft((d) => ({ ...d, llm: { ...d.llm, provider: e.target.value } }))}>
              {['none', 'openai', 'openai-compatible', 'anthropic-via-proxy'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="model"><input value={draft.llm?.model || ''} placeholder="gpt-4o-mini" onChange={(e) => setDraft((d) => ({ ...d, llm: { ...d.llm, model: e.target.value } }))} /></Field>
          <Field label="base URL"><input value={draft.llm?.baseUrl || ''} placeholder="https://api.openai.com/v1" onChange={(e) => setDraft((d) => ({ ...d, llm: { ...d.llm, baseUrl: e.target.value } }))} /></Field>
          <Field label="API key" hint="leave the •••• value to keep the saved one">
            <input value={draft.llm?.apiKey || ''} onChange={(e) => setDraft((d) => ({ ...d, llm: { ...d.llm, apiKey: e.target.value } }))} />
          </Field>
          <Field label="tone">
            <select value={draft.llm?.tone || 'confident'} onChange={(e) => setDraft((d) => ({ ...d, llm: { ...d.llm, tone: e.target.value } }))}>
              {['confident', 'direct', 'warm', 'technical'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="timeout ms"><input type="number" value={draft.llm?.timeoutMs || 25000} onChange={(e) => setDraft((d) => ({ ...d, llm: { ...d.llm, timeoutMs: Number(e.target.value) } }))} /></Field>
        </div>
      </Panel>

      <Panel title="Data & operations">
        <div className="grid cols-3">
          <div>
            <h4 className="sec" style={{ marginTop: 0 }}>storage</h4>
            <div className="kv">
              <div>data dir</div><div className="mono small">{meta?.env?.dataDir || 'data'}</div>
              <div>files</div><div className="mono small">profile · resume · jobs · applications · settings · runs</div>
              <div>llm key in env</div><div>{meta?.env?.llmKeyConfigured ? 'yes' : 'no'}</div>
            </div>
            <div className="dim small mt8">Everything is plain JSON you can inspect, back up, or move to Postgres later. The job store holds only what you fetched or imported — there is no bundled corpus.</div>
          </div>
          <div>
            <h4 className="sec" style={{ marginTop: 0 }}>rebuild</h4>
            <div className="list">
              <button className="btn sm" disabled={busy} onClick={() => api.recompute().then((r) => { refresh(); toast(`re-scored ${r.jobs} jobs`); })}>re-score every job against current profile</button>
              <button
                className="btn sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.fetchJobs(null);
                    await refresh();
                    toast(`${r.fetched} live jobs pulled${r.errors?.length ? ` · ${r.errors.length} source(s) errored` : ''}`, r.errors?.length ? 'warn' : 'ok', 8000);
                  } catch (e) {
                    /* The honest path: no fetch, no fake data, and a message that says
                       which of the two it was. */
                    toast(e.message, 'err', 12000);
                  }
                  setBusy(false);
                }}
              >
                fetch live jobs now
              </button>
              <div className="dim small">the server also pulls from enabled sources on boot (disable with <span className="mono">FETCH_ON_BOOT=0</span>); there is no bundled corpus to “re-add” any more.</div>
              <button className="btn sm" disabled={busy} onClick={() => api.clearJobs().then(() => { refresh(); toast('job store cleared (applications kept)'); })}>clear job store</button>
            </div>
          </div>
          <div>
            <h4 className="sec" style={{ marginTop: 0 }}>danger</h4>
            <div className="list">
              <button
                className="btn sm danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm('Delete all drafted applications, the job store and run counters? Your profile and resume stay.')) return;
                  await api.reset();
                  await refresh();
                  toast('cleared applications + jobs');
                }}
              >
                wipe applications + jobs
              </button>
              <button
                className="btn sm danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm('Also reset the PROFILE to the blank scaffold? Applications, jobs, counters, your resume parse and every answer you typed are deleted. There is no undo.')) return;
                  await api.resetAll();
                  await refresh();
                  toast('everything cleared, profile included');
                }}
              >
                wipe everything, profile too
              </button>
              <div className="dim small">an install that predates the scaffold profile may hold attestations and a salary floor the app set for you — that is what this second button is for</div>
              <a className="btn sm danger" href={api.exportPackUrl} target="_blank" rel="noreferrer">dump my applications (.md) before wiping</a>
            </div>
          </div>
        </div>
        <div className="flexr mt16">
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner text="saving…" /> : 'save settings'}</button>
          <span className="dim small">{enabledKeys.length} source(s) enabled</span>
        </div>
      </Panel>
    </div>
  );
}
