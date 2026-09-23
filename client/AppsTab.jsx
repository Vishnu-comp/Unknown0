import { useEffect, useState } from 'react';
import { api, toast, copy, handOff, findExtension } from './api.js';
import { Panel, Ring, Spinner, Chips, fmtMoney, timeAgo, Toggle, Field } from './ui.jsx';

export function AppsTab({ apps, stats, pipeline, refresh, busy, setBusy, meta, openId: openIdProp, submitSupport }) {
  const [openIdState, setOpenId] = useState(openIdProp || null);
  const openId = openIdProp === undefined ? openIdState : openIdProp;
  const [view, setView] = useState('list');
  const [policy, setPolicy] = useState(meta?.autoApply || { enabled: false, minScore: 70, dailyCap: 10, perSourcePerDay: 4, cooldownHours: 24, mode: 'assist' });
  const [preview, setPreview] = useState(null);
  const [loadingRun, setLoadingRun] = useState(false);

  async function savePolicy(next) {
    const p = { ...policy, ...next };
    setPolicy(p);
    try {
      await api.saveSettings({ autoApply: p });
      toast('auto-apply policy saved');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function run(dry) {
    setLoadingRun(true);
    try {
      const r = await api.run({ dryRun: dry, ...policy });
      if (dry) {
        setPreview(r.queued || []);
        toast(`preview: ${r.queued?.length || 0} jobs would be auto-drafted today`, 'ok', 5000);
      } else {
        await refresh();
        setPreview(null);
        toast(`${r.queued?.length || 0} drafted · skipped ${r.skipped?.length || 0}${r.reason ? ` · ${r.reason}` : ''}`, r.queued?.length ? 'ok' : 'warn', 6500);
      }
    } catch (e) {
      toast(e.message, 'err', 8000);
    }
    setLoadingRun(false);
  }

  return (
    <div>
      <div className="flexr" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page">Applications</h1>
          <p className="sub mb0">
            Each pack = cover letter + answers to the questions that job will ask + a pre-fill payload for the browser extension. Review, then send it
            yourself — ApplyFlow never presses Submit on an ATS for you.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn sm" onClick={() => setView(view === 'list' ? 'board' : 'list')}>{view === 'list' ? 'board view' : 'list view'}</button>
          <a className="btn sm" href={api.exportPackUrl} target="_blank" rel="noreferrer">download all (.md)</a>
          <a className="btn sm primary" href={api.exportBatchUrl}>export prefill pack (.json)</a>
        </div>
      </div>

      <Panel title="Auto-apply policy" sub="what runs when you press Run (or the daily timer), and how hard it throttles itself">
        <div className="grid cols-4">
          <Toggle checked={policy.enabled} onChange={(v) => savePolicy({ enabled: v })} label="enable runner" hint="off = only manual drafts" />
          <Field label={`min score · ${policy.minScore}`}>
            <input type="range" min="40" max="95" step="1" value={policy.minScore} onChange={(e) => setPolicy({ ...policy, minScore: Number(e.target.value) })} onMouseUp={() => savePolicy({})} />
          </Field>
          <Field label="daily cap" hint="applications composed per day">
            <input type="number" min="1" max="60" value={policy.dailyCap} onChange={(e) => setPolicy({ ...policy, dailyCap: Number(e.target.value) })} onBlur={() => savePolicy({})} />
          </Field>
          <Field label="per source / day" hint="avoids 10 near-identical applies">
            <input type="number" min="1" max="12" value={policy.perSourcePerDay} onChange={(e) => setPolicy({ ...policy, perSourcePerDay: Number(e.target.value) })} onBlur={() => savePolicy({})} />
          </Field>
        </div>
        <div className="grid cols-4 mt8">
          <Field label="cooldown (hours per job)"><input type="number" min="1" max="336" value={policy.cooldownHours} onChange={(e) => setPolicy({ ...policy, cooldownHours: Number(e.target.value) })} onBlur={() => savePolicy({})} /></Field>
          <Field label="mode" hint="assist = stop before submit">
            <select value={policy.mode} onChange={(e) => savePolicy({ mode: e.target.value })}>
              <option value="assist">assist — draft + prefill, you click send</option>
              <option value="email">email-first — use mailto draft when posted</option>
            </select>
          </Field>
          <div className="flexr" style={{ alignItems: 'flex-end', gap: 8 }}>
            <button className="btn sm" disabled={loadingRun} onClick={() => run(true)}>{loadingRun ? <Spinner /> : 'preview run'}</button>
            <button className="btn primary" disabled={loadingRun || !policy.enabled} onClick={() => run(false)}>run auto-apply now</button>
          </div>
          <div className="note small" style={{ alignSelf: 'end' }}>
            composed today: <b>{stats?.today ?? 0}</b> · drafted total: <b>{stats?.total ?? 0}</b>
          </div>
        </div>

        {preview && (
          <div className="mt12">
            <h4 className="sec">preview — {preview.length} queued, nothing written yet</h4>
            {preview.length === 0 ? <div className="empty">nothing above {policy.minScore} that isn't already applied. Lower the bar or fetch more jobs.</div> : (
              <table>
                <thead><tr><th>job</th><th>company</th><th>source</th><th>score</th><th>flags</th></tr></thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.jobId}>
                      <td>{p.title}</td>
                      <td>{p.company}</td>
                      <td className="small dim">{p.source}</td>
                      <td>{p.score}</td>
                      <td className="small">{(p.flags || []).join('; ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Panel>

      {apps.length === 0 ? (
        <Panel>
          <div className="empty">
            <b>no applications drafted</b>
            Go to Job matches → pick a few ≥65 → “draft selected”. Or press “run auto-apply now”.
          </div>
        </Panel>
      ) : view === 'list' ? (
        <Panel>
          {apps.map((a) => (
            <article className="job" key={a.id}>
              <Ring score={a.score} />
              <div style={{ minWidth: 0 }}>
                <div className="flexr" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="job-title">{a.title}</span>
                  <span className="chip flag">{a.status}</span>
                  <span className="dim small">{a.letterMode} letter · {a.letterWords}w · updated {timeAgo(a.updatedAt)}</span>
                </div>
                <div className="job-meta">
                  <b style={{ color: 'var(--text)' }}>{a.company}</b>
                  <span className="chip src">{a.source}</span>
                  {(a.flags || []).map((f) => <span key={f} className="chip flag">⚠ {f}</span>)}
                  {(a.checklist?.warnings || []).map((w) => <span key={w} className="chip miss">{w}</span>)}
                </div>
                <div className="job-bits">
                  {(a.matchedSkills || []).slice(0, 6).map((s) => <span key={s} className="chip good">✓ {s}</span>)}
                  {(a.missingSkills || []).slice(0, 3).map((s) => <span key={s} className="chip miss">✗ {s}</span>)}
                </div>
              </div>
              <div className="btn-row">
                <button className="btn sm" onClick={() => setOpenId(openId === a.id ? null : a.id)}>{openId === a.id ? 'hide' : 'review pack'}</button>
                <select className="btn sm" style={{ maxWidth: 150 }} value={a.status} onChange={(e) => api.setStatus(a.id, e.target.value).then(refresh)}>
                  {(pipeline || []).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {openId === a.id && (
                <div className="mt12" style={{ gridColumn: '1 / -1' }}>
                  <AppDetail a={a} refresh={refresh} busy={busy} setBusy={setBusy} initialSup={submitSupport} />
                </div>
              )}
            </article>
          ))}
        </Panel>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${(pipeline || []).length}, minmax(170px, 1fr))`, gap: 10, overflowX: 'auto' }}>
          {(pipeline || []).map((stage) => {
            const col = apps.filter((a) => a.status === stage);
            return (
              <div className="panel" key={stage} style={{ minHeight: 150 }}>
                <div className="panel-head" style={{ padding: '9px 11px' }}>
                  <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>{stage}</h3>
                  <span className="dim small">{col.length}</span>
                </div>
                <div className="panel-body" style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {col.map((a) => (
                    <div key={a.id} className="panel" style={{ background: 'var(--panel-2)', padding: 9 }}>
                      <div className="flexr" style={{ gap: 6 }}>
                        <span className="mono" style={{ color: 'var(--brand-2)', fontSize: 11 }}>{a.score}</span>
                        <span className="small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</span>
                      </div>
                      <div className="small" style={{ marginTop: 3 }}>{a.title}</div>
                      <div className="flexr mt8">
                        <button className="btn sm ghost" onClick={() => setOpenId(a.id)}>open</button>
                        <span style={{ flex: 1 }} />
                        <button
                          className="btn sm ghost"
                          title="advance one stage"
                          onClick={() => api.setStatus(a.id, pipeline[Math.min(pipeline.length - 1, pipeline.indexOf(stage) + 1)], 'advanced from board').then(refresh)}
                        >
                          →
                        </button>
                      </div>
                    </div>
                  ))}
                  {!col.length && <span className="dim small">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

function AppDetail({ a, refresh, busy, setBusy, initialSup }) {
  const [letter, setLetter] = useState(a.letter);
  const [answers, setAnswers] = useState(a.answers || []);
  const [showResume, setShowResume] = useState(false);
  const [sup, setSup] = useState(initialSup || null);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const dirty = letter !== a.letter;

  useEffect(() => {
    let alive = true;
    api
      .submitSupport(a.id)
      .then((r) => alive && setSup(r))
      .catch(() => alive && setSup({ support: { ok: false, supported: false, reason: 'could not check submit support' } }));
    return () => {
      alive = false;
    };
  }, [a.id]);

  async function submit(confirm) {
    setSending(true);
    try {
      const r = await api.submitApp(a.id, confirm);
      setPreview(r);
      if (r.sent) toast(`sent via ${r.kind} — application ${r.applicationId}`, 'ok', 6000);
      else if (r.dryRun) toast('dry run — nothing left this machine', 'warn', 6000);
      else toast(r.error || r.message || 'refused', 'err', 9000);
      await refresh();
    } catch (e) {
      toast(e.message, 'err', 9000);
    }
    setSending(false);
  }

  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div>
        <h4 className="sec" style={{ marginTop: 0 }}>cover letter · {a.letterWords} words · {a.letterMode}</h4>
        <textarea style={{ minHeight: 330, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.6 }} value={letter} onChange={(e) => setLetter(e.target.value)} />
        <div className="btn-row mt8">
          <button
            className="btn sm primary"
            disabled={!dirty || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patchApp(a.id, { letter, letterWords: letter.split(/\s+/).filter(Boolean).length, edited: true });
                await refresh();
                toast('letter saved');
              } catch (e) {
                toast(e.message, 'err');
              }
              setBusy(false);
            }}
          >
            save letter
          </button>
          <button className="btn sm" onClick={() => copy(letter, 'letter copied')}>copy</button>
          <button
            className="btn sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.draft([a.jobId], { force: true, mode: 'template' });
                await refresh();
                toast('regenerated from your (possibly updated) profile');
              } catch (e) {
                toast(e.message, 'err');
              }
              setBusy(false);
            }}
          >
            regenerate
          </button>
        </div>
        {(a.checklist?.warnings || []).length > 0 && (
          <div className="note warn mt12 small">
            <h5>read before sending</h5>
            {a.checklist.warnings.map((w) => <div key={w}>· {w}</div>)}
          </div>
        )}

        {a.tailoredResume && (
          <>
            <h4 className="sec">tailored resume · same facts, reordered for this posting</h4>
            <div className="note small">
              {a.tailoredAudit?.bullets?.length || 0} of your bullets ranked against this posting
              {a.tailoredAudit?.droppedBullets ? `, ${a.tailoredAudit.droppedBullets} demoted to the bottom` : ''}
              {a.tailoredAudit?.skillsPromoted?.length ? ` · leading with ${a.tailoredAudit.skillsPromoted.slice(0, 4).join(', ')}` : ''}. Nothing was invented:
              every line traces back to your profile.
            </div>
            <div className="btn-row mt8">
              <button className="btn sm" onClick={() => setShowResume((v) => !v)}>{showResume ? 'hide' : 'read it'}</button>
              <button className="btn sm" onClick={() => copy(a.tailoredPlain || a.tailoredResume, 'plain-text resume copied — paste into the ATS upload box')}>copy plain text</button>
              <a className="btn sm" href={`/api/apps/${a.id}/tailored.txt`} download>download .txt</a>
            </div>
            {showResume && <pre style={{ marginTop: 10, maxHeight: 360 }}>{a.tailoredPlain || a.tailoredResume}</pre>}
          </>
        )}

        {(a.insights?.insights || []).length > 0 && (
          <>
            <h4 className="sec">what this posting reveals</h4>
            <div className="list">
              {a.insights.insights.map((i) => (
                <div key={i.id} className="panel" style={{ background: 'var(--panel-2)', padding: '8px 10px' }}>
                  <div className="flexr" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span className="small" style={{ color: 'var(--muted)' }}>{i.label}</span>
                    <b className="small" style={{ color: 'var(--brand-2)', textAlign: 'right' }}>{i.value}</b>
                  </div>
                </div>
              ))}
            </div>
            {(a.insights.warnings || []).length > 0 && (
              <div className="note warn mt8 small">
                {a.insights.warnings.map((w) => <div key={w}>· {w}</div>)}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <h4 className="sec" style={{ marginTop: 0 }}>screening answers</h4>
        <div className="list">
          {answers.map((ans, i) => (
            <div key={i} className="panel" style={{ background: 'var(--panel-2)', padding: 10 }}>
              <div className="small" style={{ color: 'var(--muted)' }}>{ans.question}</div>
              <textarea
                style={{ marginTop: 6, minHeight: 60 }}
                value={ans.answer}
                onChange={(e) => {
                  const next = [...answers];
                  next[i] = { ...ans, answer: e.target.value, edited: true };
                  setAnswers(next);
                }}
              />
              <div className="flexr mt8">
                <span className={`chip ${ans.confidence > 0.7 ? 'good' : 'flag'}`}>conf {Math.round((ans.confidence || 0) * 100)}%</span>
                <span style={{ flex: 1 }} />
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    await api.patchApp(a.id, { answers });
                    await refresh();
                    toast('answers saved');
                  }}
                >
                  save all answers
                </button>
                <button className="btn sm ghost" onClick={() => copy(`${ans.question}\n${ans.answer}`, 'Q/A copied')}>copy one</button>
              </div>
            </div>
          ))}
        </div>

        <h4 className="sec">send it</h4>
        <div className="list">
          {a.url && (
            <button
              className="btn sm primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const ext = await findExtension(600);
                  if (!ext) {
                    // Nothing installed to talk to: still do the useful half of the job.
                    const r = await api.extensionPayload(a.id);
                    copy(JSON.stringify(r.payload, null, 2), 'no extension on this page — payload copied, apply page opened');
                    window.open(a.url, '_blank', 'noopener');
                    return;
                  }
                  const res = await handOff(a.id, { url: a.url });
                  if (!res?.ok) throw new Error(res?.error || 'the extension did not accept the pack');
                  toast(
                    `opened ${a.company} with ${res.fields} value(s) queued — empty fields only, nothing submitted`,
                    'ok',
                    7000
                  );
                } catch (e) {
                  toast(e.message, 'err', 9000);
                }
                setBusy(false);
              }}
            >
              open the site &amp; autofill
            </button>
          )}
          {a.url && <a className="btn sm" href={a.url} target="_blank" rel="noreferrer noopener">open apply page ↗</a>}
          {a.applyEmail && (
            <a
              className="btn sm"
              href={`mailto:${a.applyEmail}?subject=${encodeURIComponent(`Application: ${a.title} — ${a.letter ? (a.prefill?.fields?.['full.name'] || '') : ''}`)}&body=${encodeURIComponent(letter.slice(0, 1400))}`}
            >
              email draft → {a.applyEmail}
            </a>
          )}
          <a className="btn sm" href={api.prefillUrl(a.id)}>download prefill pack (.json)</a>
          <button
            className="btn sm"
            onClick={async () => {
              const r = await api.extensionPayload(a.id);
              copy(JSON.stringify(r.payload, null, 2), 'extension payload copied — paste into ApplyFlow extension');
            }}
          >
            copy extension payload
          </button>
          <button
            className="btn sm ghost"
            onClick={() =>
              copy(
                [`# ${a.title} @ ${a.company}`, `match ${a.score}/100 · ${a.source}`, '', '## letter', letter, '', '## answers', ...answers.map((x) => `Q: ${x.question}\nA: ${x.answer}\n`)].join('\n'),
                'full pack copied as text'
              )
            }
          >
            copy everything as text
          </button>
          <button className="btn sm" onClick={() => api.setStatus(a.id, 'submitted', 'marked by user').then(refresh)}>mark submitted</button>
          <button className="btn sm danger" onClick={() => api.delApp(a.id).then(refresh)}>delete</button>

          {sup && (
            <>
              <h4 className="sec">direct ATS submit</h4>
              {sup.support.ok ? (
                <div className="note ok small">
                  {sup.support.kind} board with a public apply API — ApplyFlow can POST this without opening a browser. It always shows you the exact payload
                  first.
                </div>
              ) : (
                <div className="note small">{sup.support.reason}</div>
              )}
              <div className="btn-row mt8">
                <button className="btn sm" disabled={sending} onClick={() => submit(false)}>preview payload (dry run)</button>
                {sup.support.ok && (
                  <button className="btn sm primary" disabled={sending || a.status === 'submitted'} onClick={() => submit(true)}>
                    {a.status === 'submitted' ? 'already submitted' : 'confirm + send now'}
                  </button>
                )}
              </div>
              {preview && (
                <div className="panel mt12" style={{ background: 'var(--panel-2)', padding: 12 }}>
                  <div className="flexr" style={{ justifyContent: 'space-between' }}>
                    <b className="small">{preview.sent ? 'sent' : preview.dryRun ? 'dry run — nothing left this machine' : 'refused'}</b>
                    <span className={`pill ${preview.sent ? 'on' : preview.error ? 'warn' : ''}`} style={{ fontSize: 11 }}>{preview.status || (preview.dryRun ? 'not sent' : 'blocked')}</span>
                  </div>
                  <div className="kv mt8">
                    <div>endpoint</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{preview.endpoint}</div>
                    <div>board · job</div><div>{preview.board || '—'} · {preview.jobNumber || '—'}</div>
                    <div>resume</div><div>{preview.resume?.filename} · {(preview.resume?.bytes || 0).toLocaleString()} bytes {preview.resume?.uploadedFile ? '(your file)' : '(generated text)'}</div>
                    <div>payload</div><div>{(preview.candidate?.first_name || '')} {(preview.candidate?.last_name || '')} &lt;{preview.candidate?.emails?.[0]?.value}&gt; · {preview.answers?.length || 0} questionnaire answer(s)</div>
                    <div>application id</div><div>{preview.applicationId || '—'}</div>
                  </div>
                  {(preview.issues || []).length > 0 && (
                    <div className="note warn mt8 small">
                      {preview.issues.map((x) => <div key={x}>· {x}</div>)}
                    </div>
                  )}
                  {preview.error && <div className="note warn mt8 small">{preview.error}</div>}
                  {preview.hint && <div className="dim small mt8">{preview.hint}</div>}
                  {!preview.sent && preview.ok && !preview.issues?.length && (
                    <div className="btn-row mt8">
                      <button className="btn sm primary" disabled={sending || !sup.support.ok} onClick={() => submit(true)}>
                        send exactly this
                      </button>
                      <span className="dim small">re-check the resume line and the answers first — this goes to the employer's ATS</span>
                    </div>
                  )}
                </div>
              )}
              {(sup.log || []).length > 0 && (
                <details className="mt12">
                  <summary className="dim small">submit log ({sup.log.length})</summary>
                  <div className="list mt8">
                    {sup.log.map((e) => (
                      <div key={e.id} className="small" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span className={`chip ${e.sent ? 'good' : e.dryRun ? '' : 'miss'}`}>{e.sent ? 'sent' : e.dryRun ? 'dry' : 'failed'}</span>
                        <span className="dim">{timeAgo(e.at)}</span>
                        <span>{e.company} — {e.title}</span>
                        <span className="mono dim">{e.error || e.note || e.externalId || ''}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
        <div className="note info mt12 small">
          Extension flow: export the prefill pack → load <span className="mono">extension/</span> in chrome://extensions (unpacked) → open the apply page →
          Fill. It types into the form in <i>your</i> browser, in <i>your</i> session. You review and press submit.
        </div>
      </div>
    </div>
  );
}
