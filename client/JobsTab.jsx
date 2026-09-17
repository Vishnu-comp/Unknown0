import { useMemo, useState } from 'react';
import { api, toast, copy } from './api.js';
import { Panel, Ring, Chips, Spinner, Modal, fmtMoney, timeAgo, postedAgo, Bar, Tabs } from './ui.jsx';

/**
 * One pay line for the card and the modal, from whichever fields exist.
 * Cases it has to survive: a normal range, only one end published, min === max
 * (never render "₹12L–₹12L"), pay stated in words the parser refused, and
 * nothing at all.
 */
function payLine(job, { withCaveat = false } = {}) {
  const lo = fmtMoney(job.salaryMin ?? job.salaryMax, job.salaryCurrency);
  const hi = fmtMoney(job.salaryMax, job.salaryCurrency);
  if (lo && hi && job.salaryMin && job.salaryMax && job.salaryMax !== job.salaryMin) return `${lo}–${hi}`;
  if (lo) return lo;
  if (job.salaryText) return withCaveat ? `${job.salaryText} (as written — not parsed into a number)` : job.salaryText;
  return null;
}

export function JobsTab({ jobs, meta, refresh, busy, setBusy, profile }) {
  const [q, setQ] = useState('');
  const [min, setMin] = useState(0);
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('score');
  const [sel, setSel] = useState(() => new Set());
  const [open, setOpen] = useState(null);
  const [mode, setMode] = useState('all');

  const list = useMemo(() => {
    let out = jobs;
    if (mode === 'new') out = out.filter((j) => !j.app);
    if (mode === 'applied') out = out.filter((j) => j.app);
    return out;
  }, [jobs, mode]);

  const eligibleSel = useMemo(() => [...sel].filter((id) => (jobs.find((j) => j.id === id)?.match.score ?? 0) >= 60), [sel, jobs]);

  const sources = [...new Set(jobs.map((j) => j.source))].sort();

  async function fetchLive(keys) {
    setBusy(true);
    try {
      const r = await api.fetchJobs(keys);
      await refresh();
      toast(`fetched ${r.fetched} live jobs${r.errors?.length ? ` · ${r.errors.length} source error(s)` : ''}`, r.errors?.length ? 'warn' : 'ok', 6000);
    } catch (e) {
      toast(e.message, 'err', 9000);
    }
    setBusy(false);
  }

  async function draft(ids, opts = {}) {
    setBusy(true);
    try {
      const r = await api.draft(ids, opts);
      await refresh();
      setSel(new Set());
      toast(`drafted ${r.drafted} application${r.drafted === 1 ? '' : 's'} — see Applications`);
    } catch (e) {
      toast(e.message, 'err', 7000);
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="flexr" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page">Job matches</h1>
          <p className="sub mb0">
            Score = skills 35 · field 20 · title intent 15 · semantic sim 10 · seniority 8 · experience 6 · location 6 · salary 5 · recency 5. Exclude terms
            block auto-apply.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn sm" disabled={busy} onClick={() => api.seed().then(async (r) => { await refresh(); toast(r.message); })}>+ demo corpus</button>
          {sources.length === 0 && <span className="pill warn"><span className="dot" />no jobs loaded</span>}
          <button className="btn sm primary" disabled={busy} onClick={() => fetchLive((meta?.sources || []).filter((s) => !s.needsKey).map((s) => s.key))}>
            {busy ? <Spinner text="fetching…" /> : 'fetch from key-less sources'}
          </button>
        </div>
      </div>

      <Panel>
        <div className="grid cols-4" style={{ gap: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>search</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="react, platform, fintech…" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>min score <span className="mono">{min}</span></label>
            <input type="range" min="0" max="95" step="5" value={min} onChange={(e) => setMin(Number(e.target.value))} className="slider" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">all ({sources.length})</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>sort</label>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="score">match score</option>
              <option value="date">newest</option>
              <option value="company">company</option>
            </select>
          </div>
        </div>

        <div className="flexr mt12" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <Tabs
            tabs={[{ id: 'all', label: 'all', count: jobs.length }, { id: 'new', label: 'not applied', count: jobs.filter((j) => !j.app).length }, { id: 'applied', label: 'with draft', count: jobs.filter((j) => j.app).length }]}
            active={mode}
            onChange={setMode}
          />
          <div className="btn-row">
            <span className="dim small">{list.length} shown</span>
            <button className="btn sm ghost" onClick={() => setSel(new Set(list.map((j) => j.id)))}>select all</button>
            <button className="btn sm ghost" onClick={() => setSel(new Set())}>clear</button>
            <button className="btn sm" disabled={!eligibleSel.length || busy} onClick={() => draft(eligibleSel)}>
              draft selected ≥60 ({eligibleSel.length})
            </button>
            <button className="btn sm primary" disabled={!sel.size || busy} onClick={() => draft([...sel], { force: true })}>
              draft all selected
            </button>
          </div>
        </div>
      </Panel>

      <Panel>
        {list.length === 0 && (
          <div className="empty">
            <b>{jobs.length ? 'nothing matches those filters' : 'no jobs in the store yet'}</b>
            {jobs.length ? 'lower the min score or clear the search.' : 'click “+ demo corpus” to load 16 realistic postings, fetch a real source, or use the extension’s Harvest tab to read the LinkedIn/Naukri results page you already have open — Settings → Import takes pasted JSON from anything else.'}
          </div>
        )}
        {list.map((j) => (
          <article className="job" key={j.id}>
            <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
              <Ring score={j.match.score} />
              <input type="checkbox" checked={sel.has(j.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(j.id) ? n.delete(j.id) : n.add(j.id); return n; })} style={{ width: 15, height: 15, accentColor: 'var(--brand)' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="flexr" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="job-title">{j.title}</span>
                {j.app && <span className="pill on" style={{ fontSize: 11 }}>{j.app.status}</span>}
                {j.match.grade && <span className="chip">{j.match.grade}</span>}
                {/greenhouse\.io|lever\.co/i.test(j.url || '') && (
                  <span className="chip src" title="this posting sits on a board with a public apply API — it can be submitted without touching the browser">
                    api-apply
                  </span>
                )}
                {j.company === 'Company withheld' && j.url && (
                  <span className="chip flag" title="this row came from the markup path, where a company name could only be guessed from the URL slug — so it was left out rather than invented. open the posting to fill it in">
                    needs a click
                  </span>
                )}
                {(j.match.flags || []).some((f) => /unpaid|volunteer/i.test(f)) && <span className="chip miss">unpaid</span>}
              </div>
              <div className="job-meta">
                <b style={{ color: 'var(--text)' }}>{j.company}</b>
                <span>📍 {j.location || '—'}{j.remote ? ' · remote' : ''}</span>
                {/* shown when a number OR just words exist: a card claiming nothing
                    about pay while the posting says "₹18 LPA" teaches you to distrust
                    every other number on it */}
                {payLine(j) && <span title={j.salaryMin || j.salaryMax ? undefined : 'stated on the posting, but not in a shape the parser trusts'}>💰 {payLine(j)}</span>}
                <span>🗓 {postedAgo(j.postedAt)}</span>
                <span className="chip src">{j.source}</span>
              </div>
              <div className="job-bits">
                {(j.match.matchedSkills || []).slice(0, 7).map((s) => <span key={s} className="chip good">✓ {s}</span>)}
                {(j.match.missingSkills || []).slice(0, 4).map((s) => <span key={s} className="chip miss">✗ {s}</span>)}
                {(j.match.flags || []).map((f) => <span key={f} className="chip flag">⚠ {f}</span>)}
              </div>
            </div>
            <div className="btn-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button className="btn sm" onClick={() => setOpen(j)}>why / details</button>
              <button className="btn sm primary" disabled={busy} onClick={() => draft([j.id], { force: true })}>{j.app ? 'redraft' : 'draft app'}</button>
              {j.url && <a className="btn sm ghost" href={j.url} target="_blank" rel="noreferrer noopener">open ↗</a>}
            </div>
          </article>
        ))}
      </Panel>

      {open && <JobModal job={open} profile={profile} onClose={() => setOpen(null)} onDraft={async () => { await draft([open.id], { force: true }); setOpen(null); }} busy={busy} />}
    </div>
  );
}

export function JobModal({ job, onClose, onDraft, busy, initialTab, initialIntel, initialTailored, initialFull }) {
  const [tab, setTab] = useState(initialTab || 'why');
  const [full, setFull] = useState(initialFull || null);
  const [intel, setIntel] = useState(initialIntel || null);
  const [tailored, setTailored] = useState(initialTailored || null);
  const [showTailored, setShowTailored] = useState(false);
  const [loading, setLoading] = useState(false);
  const b = job.match.breakdown || {};
  const total = Object.values(b).reduce((a, x) => a + x, 0) || 100;

  async function loadFull() {
    if (full && intel && tailored) return;
    setLoading(true);
    try {
      const [f, r, t] = await Promise.all([full ? Promise.resolve(full) : api.job(job.id), intel ? Promise.resolve(intel) : api.jobResearch(job.id), tailored ? Promise.resolve(tailored) : api.jobTailored(job.id)]);
      setFull(f);
      setIntel(r);
      setTailored(t);
    } catch (e) {
      toast(e.message, 'err');
    }
    setLoading(false);
  }

  async function loadIntel() {
    if (intel && tailored) return;
    setLoading(true);
    try {
      const [r, t] = await Promise.all([intel ? Promise.resolve(intel) : api.jobResearch(job.id), tailored ? Promise.resolve(tailored) : api.jobTailored(job.id)]);
      setIntel(r);
      setTailored(t);
    } catch (e) {
      toast(e.message, 'err');
    }
    setLoading(false);
  }

  return (
    <Modal wide title={`${job.title} — ${job.company}`} onClose={onClose}>
      <div className="split">
        <div>
          <Tabs
            tabs={[
              { id: 'why', label: 'why this score' },
              { id: 'intel', label: 'job intel' },
              { id: 'post', label: 'posting' },
              { id: 'draft', label: 'drafted app' },
            ]}
            active={tab}
            onChange={(t) => {
              setTab(t);
              if (t === 'post') loadFull();
              if (t === 'intel') loadIntel();
            }}
          />
          {tab === 'why' && (
            <div className="mt12">
              <div className="grid cols-2" style={{ gap: '10px 22px' }}>
                {Object.entries(b).map(([k, v]) => (
                  <Bar key={k} label={k} value={v} max={Math.max(v, k === 'skills' ? 35 : k === 'field' ? 20 : k === 'title' ? 15 : 10)} />
                ))}
              </div>
              <div className="note mt16">
                <h5>How to read this</h5>
                Score {job.match.score}/100 ({job.match.grade}) built from {total > 0 ? 'weighted' : 'unweighted'} components. Skills weight dominates on
                purpose: a 90 means “they will read the resume”, a 55 means “you'd be screened out”. This is the pure match — <b>job intel</b> shows the
                adjusted score once what the posting itself says is taken into account.
              </div>
              <h4 className="sec">matched ({job.match.matchedSkills.length})</h4>
              <Chips items={job.match.matchedSkills} tone="good" />
              <h4 className="sec">asked for but not in your profile ({job.match.missingSkills.length})</h4>
              <Chips items={job.match.missingSkills} tone="miss" />
              {(job.match.flags || []).length > 0 && (
                <>
                  <h4 className="sec">flags</h4>
                  <Chips items={job.match.flags} tone="flag" />
                </>
              )}
              <div className="kv mt16">
                <div>your YOE</div><div>{job.match.yearsOfExperience}</div>
                <div>detected field</div><div>{job.match.detectedField || '—'}</div>
                <div>posting seniority</div><div>{job.match.detectedSeniority}</div>
                <div>seen {job.seenCount || 1}×</div><div>first {timeAgo(job.firstSeenAt)}</div>
              </div>
            </div>
          )}
          {tab === 'intel' && (
            <div className="mt12">
              {loading && !intel && <Spinner text="reading the posting…" />}
              {intel && (
                <>
                  <div className="flexr wrap" style={{ gap: 10 }}>
                    <span className={`pill ${intel.research.verdict === 'good' ? 'on' : intel.research.verdict === 'mixed' ? 'warn' : ''}`}>
                      {intel.research.verdict}
                    </span>
                    <span className="dim small">{intel.research.coverage}</span>
                    <span className={`chip ${intel.match.delta > 0 ? 'good' : intel.match.delta < 0 ? 'miss' : ''}`}>
                      matcher {intel.match.baseScore} → {intel.match.score}{intel.match.delta ? ` (${intel.match.delta > 0 ? '+' : ''}${intel.match.delta} from signals)` : ' (signals changed nothing)'}
                    </span>
                  </div>
                  {intel.match.applied?.length > 0 && (
                    <div className="note info mt12 small">
                      <h5>applied to your score</h5>
                      {intel.match.applied.map((n) => (
                        <div key={n}>· {n}</div>
                      ))}
                    </div>
                  )}

                  <h4 className="sec">what this posting reveals</h4>
                  {intel.research.insights.length === 0 && <div className="note">nothing extractable — the posting has no numbers, no stage, no process detail. That is itself a signal.</div>}
                  <div className="list">
                    {intel.research.insights.map((i) => (
                      <div key={i.id} className="panel" style={{ background: 'var(--panel-2)', padding: '10px 12px' }}>
                        <div className="flexr" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                          <b className="small">{i.label}</b>
                          <span className="small" style={{ color: 'var(--brand-2)' }}>{i.value}</span>
                        </div>
                        <div className="dim small mt8" style={{ marginTop: 3 }}>why it matters: {i.why}</div>
                      </div>
                    ))}
                  </div>

                  {intel.research.warnings.length > 0 && (
                    <>
                      <h4 className="sec">watch out</h4>
                      <div className="note warn small">
                        {intel.research.warnings.map((w) => (
                          <div key={w}>· {w}</div>
                        ))}
                      </div>
                    </>
                  )}
                  {intel.research.positives.length > 0 && (
                    <>
                      <h4 className="sec">in its favour</h4>
                      <div className="note ok small">
                        {intel.research.positives.map((w) => (
                          <div key={w}>· {w}</div>
                        ))}
                      </div>
                    </>
                  )}

                  <h4 className="sec">tailored resume for this posting</h4>
                  <div className="note small">
                    Same facts, re-ordered and re-weighted for <b>this</b> posting. Nothing is written that is not already in your profile — the audit below
                    says exactly which of your bullets moved and why.
                  </div>
                  <div className="btn-row mt12">
                    <button className="btn sm" onClick={() => setShowTailored((v) => !v)}>
                      {showTailored ? 'hide' : 'preview'} tailored resume
                    </button>
                    <button className="btn sm" disabled={!tailored} onClick={() => copy(tailored.plain, 'plain-text resume copied — paste it into any ATS box')}>
                      copy plain text
                    </button>
                    <a className="btn sm" href={api.tailoredUrl(job.id)} download>
                      download .txt
                    </a>
                  </div>
                  {tailored?.audit?.skillsPromoted?.length > 0 && (
                    <div className="job-bits">
                      {tailored.audit.skillsPromoted.map((s) => (
                        <span key={s} className="chip good">
                          {s} — in their stack
                        </span>
                      ))}
                    </div>
                  )}
                  {showTailored && (
                    <pre style={{ marginTop: 12, maxHeight: 420 }}>
                      {tailored.tailored}
                    </pre>
                  )}
                  {tailored && (
                    <div className="kv mt12">
                      <div>bullets ranked</div>
                      <div>{tailored.audit.bullets.length}</div>
                      <div>demoted</div>
                      <div>{tailored.audit.droppedBullets}</div>
                      <div>not claimed</div>
                      <div>{tailored.audit.untouchedRequirements.join(', ') || '—'}</div>
                      <div>source check</div>
                      <div>{tailored.audit.fabricationRisk}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {tab === 'post' && (
            <div className="mt12">
              {loading && !full && <Spinner text="loading posting…" />}
              {full && (
                <>
                  <pre style={{ maxHeight: 460 }}>{(full.job.description || '').slice(0, 3500)}</pre>
                  <h4 className="sec">questions the composer will answer</h4>
                  <ul className="list" style={{ margin: 0, paddingLeft: 18 }}>
                    {full.questions.map((qq, i) => <li key={i} className="small">{qq}</li>)}
                  </ul>
                  {!full.hasResume && <div className="note warn mt12">no resume on file — letters fall back to profile bullets only.</div>}
                </>
              )}
            </div>
          )}
          {tab === 'draft' && (
            <div className="mt12">
              {job.app ? (
                <>
                  <div className="flexr"><span className="pill on">{job.app.status}</span><span className="dim small">{job.app.letterMode} · {job.app.letterWords} words</span></div>
                  <div className="letter mt12">{job.app.letter}</div>
                </>
              ) : (
                <div className="empty"><b>not drafted yet</b>hit “draft application” and ApplyFlow writes the letter + answers.</div>
              )}
            </div>
          )}
        </div>

        <aside className="panel">
          <div className="panel-body">
            <h4 className="sec mt16" style={{ marginTop: 0 }}>actions</h4>
            <div className="list">
              <button className="btn primary sm" disabled={busy} onClick={onDraft}>draft application now</button>
              {job.url && <a className="btn sm" href={job.url} target="_blank" rel="noreferrer noopener">open original posting ↗</a>}
              <button className="btn sm ghost" onClick={() => copy(`${job.title} @ ${job.company}\n${job.location || ''}\n${job.url}\n\n${job.description || ''}`.slice(0, 24000), 'posting copied')}>copy posting</button>
              <button className="btn sm ghost" onClick={() => copy(JSON.stringify(job.match, null, 2), 'match JSON copied')}>copy match JSON</button>
            </div>
            <h4 className="sec">posting</h4>
            <div className="kv">
              <div>source</div><div>{job.source}</div>
              <div>posted</div><div>{job.postedAt ? `${postedAgo(job.postedAt)} · ${String(job.postedAt).slice(0, 10)}` : '—'}</div>
              <div>contract</div><div>{job.contractType || '—'}</div>
              <div>category</div><div>{job.category || '—'}</div>
              <div>salary</div>
              <div>{payLine(job, { withCaveat: true }) || 'not stated'}</div>
              {job.experienceText && <div>experience</div>}
              {job.experienceText && <div>{job.experienceText}</div>}
            </div>
            <h4 className="sec">tags</h4>
            <Chips items={(job.tags || []).slice(0, 14)} />
            {job.applyEmail && (
              <>
                <h4 className="sec">apply by email</h4>
                <div className="small mono">{job.applyEmail}</div>
              </>
            )}
            {intel && (
              <>
                <h4 className="sec">direct submit</h4>
                {full?.submit?.ok ? (
                  <div className="note ok small">
                    {full.submit.kind} board detected — ApplyFlow can POST this application through {full.submit.kind}'s public API (dry run first, your call to
                    confirm).
                  </div>
                ) : (
                  <div className="note small">{full?.submit?.reason || 'checking…'}</div>
                )}
              </>
            )}
            <div className="note info mt16 small">
              Drafting composes letter + answers + a tailored resume + prefill pack. Nothing is sent to {job.company} until you submit it (or your extension
              does, in your own logged-in browser session).
            </div>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
