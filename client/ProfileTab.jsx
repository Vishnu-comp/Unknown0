import { useState } from 'react';
import { api, toast, copy } from './api.js';
import { Panel, Field, Input, NumField, Area, Chips, Toggle, Spinner, fmtMoney } from './ui.jsx';

const inPath = (obj, path, value) => {
  const keys = path.split('.');
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...(cur[k] || {}) };
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
};

export function ProfileTab({ profile, meta, setProfile, refresh, busy }) {
  const [draft, setDraft] = useState(profile);
  const [newSkill, setNewSkill] = useState('');
  const [newInclude, setNewInclude] = useState('');
  const [newExclude, setNewExclude] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const set = (path, value) => setDraft((d) => inPath(d, path, value));
  const fields = meta?.fields || [];

  async function save() {
    try {
      const { profile: p, jobsUpdated } = await api.saveProfile(draft);
      setProfile(p);
      await refresh();
      toast(`Profile saved · ${jobsUpdated} jobs re-scored`);
    } catch (e) {
      toast(e.message, 'err', 6000);
    }
  }

  async function addSkill() {
    const name = newSkill.trim();
    if (!name) return;
    try {
      const { skills } = await api.addSkills([{ name, level: 3, core: false }]);
      setDraft((d) => ({ ...d, skills }));
      setProfile((p) => ({ ...p, skills }));
      setNewSkill('');
      await refresh();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  return (
    <div>
      <div className="flexr" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page">Your master profile</h1>
          <p className="sub">
            Everything here is what ApplyFlow writes into application forms and cover letters. Fill it once, then let resume parsing and manual edits keep
            it current. The <b>answers</b> section is what stops a form from asking you the same six questions 40 times a month.
          </p>
        </div>
        <div className="btn-row">
          {dirty && <span className="pill warn"><span className="dot" />unsaved</span>}
          <button className="btn ghost sm" onClick={() => setDraft(profile)} disabled={!dirty}>revert</button>
          <button className="btn primary" onClick={save} disabled={busy || !dirty}>{busy ? <Spinner text="saving…" /> : 'Save & re-score jobs'}</button>
        </div>
      </div>

      <Panel title="Identity & contact">
        <div className="grid cols-3">
          <Field label="Full name"><Input value={draft.fullName} onChange={(v) => set('fullName', v)} /></Field>
          <Field label="Email"><Input value={draft.email} onChange={(v) => set('email', v)} type="email" /></Field>
          <Field label="Phone"><Input value={draft.phone} onChange={(v) => set('phone', v)} /></Field>
          <Field label="LinkedIn"><Input value={draft.linkedin} onChange={(v) => set('linkedin', v)} /></Field>
          <Field label="GitHub"><Input value={draft.github} onChange={(v) => set('github', v)} /></Field>
          <Field label="Portfolio / website"><Input value={draft.portfolio} onChange={(v) => set('portfolio', v)} /></Field>
          <Field label="Headline" hint="used as your one-liner in letters & form fields" wide>
            <Input value={draft.linkedinHeadline} onChange={(v) => set('linkedinHeadline', v)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Where & how you work">
        <div className="grid cols-4">
          <Field label="City"><Input value={draft.location?.city} onChange={(v) => set('location.city', v)} /></Field>
          <Field label="State / region"><Input value={draft.location?.state} onChange={(v) => set('location.state', v)} /></Field>
          <Field label="Country"><Input value={draft.location?.country} onChange={(v) => set('location.country', v)} /></Field>
          <Field label="Work setup">
            <select value={draft.remotePreference || 'any'} onChange={(e) => set('remotePreference', e.target.value)}>
              {['any', 'remote', 'hybrid', 'onsite'].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid cols-2 mt12">
          <Toggle checked={draft.openToRelocate} onChange={(v) => set('openToRelocate', v)} label="Open to relocation" hint="sets willingness fields + answers" />
          <Toggle checked={draft.needSponsorship} onChange={(v) => set('needSponsorship', v)} label="I need visa sponsorship" hint="when off, no-sponsorship postings are NOT penalised" />
        </div>
        <Field label="Work authorisation / eligibility notes" hint="free text the composer can paste where ATSs ask 'are you authorized to work in…'" wide>
          <Area
            rows={2}
            value={(draft.workAuth || []).join('\n')}
            onChange={(v) => set('workAuth', v.split('\n').map((s) => s.trim()).filter(Boolean))}
            placeholder={'India\nEU Blue Card eligible\nno US visa now'}
          />
        </Field>
      </Panel>

      <Panel
        title="Targeting — this is what the matcher optimises for"
        sub="Fields + title keywords pull jobs up the list; exclude keywords push them down and block auto-apply."
      >
        <h4 className="sec">Fields</h4>
        <div className="job-bits">
          {fields.map((f) => {
            const on = (draft.targets?.fields || []).includes(f.id);
            return (
              <button
                key={f.id}
                className={`btn sm ${on ? 'primary' : 'ghost'}`}
                onClick={() => set('targets.fields', on ? (draft.targets?.fields || []).filter((x) => x !== f.id) : [...(draft.targets?.fields || []), f.id])}
              >
                {f.label} {on && '✓'}
              </button>
            );
          })}
        </div>

        <h4 className="sec">Title keywords (must-have signals)</h4>
        <Chips items={draft.targets?.titleKeywords || []} onRemove={(it) => set('targets.titleKeywords', (draft.targets.titleKeywords || []).filter((x) => x !== it))} tone="good" />
        <div className="flexr mt8">
          <input style={{ maxWidth: 320 }} placeholder="e.g. backend engineer" value={newInclude} onChange={(e) => setNewInclude(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (set('targets.titleKeywords', [...(draft.targets.titleKeywords || []), newInclude]), setNewInclude(''))} />
          <button className="btn sm" onClick={() => { if (newInclude.trim()) { set('targets.titleKeywords', [...(draft.targets.titleKeywords || []), newInclude.trim()]); setNewInclude(''); } }}>add</button>
        </div>

        <h4 className="sec">Exclude keywords</h4>
        <Chips items={draft.targets?.excludeKeywords || []} onRemove={(it) => set('targets.excludeKeywords', (draft.targets.excludeKeywords || []).filter((x) => x !== it))} tone="miss" />
        <div className="flexr mt8">
          <input style={{ maxWidth: 320 }} placeholder="e.g. staffing, .net, BPO, unpaid" value={newExclude} onChange={(e) => setNewExclude(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (set('targets.excludeKeywords', [...(draft.targets.excludeKeywords || []), newExclude]), setNewExclude(''))} />
          <button className="btn sm" onClick={() => { if (newExclude.trim()) { set('targets.excludeKeywords', [...(draft.targets.excludeKeywords || []), newExclude.trim()]); setNewExclude(''); } }}>add</button>
        </div>

        <div className="grid cols-4 mt16">
          <Field label="Seniority aimed at">
            <select
              multiple
              size={5}
              value={draft.targets?.seniority || []}
              onChange={(e) => set('targets.seniority', [...e.target.selectedOptions].map((o) => o.value))}
            >
              {['intern', 'junior', 'mid', 'senior', 'staff'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Salary floor (annual)" hint={fmtMoney(draft.targets?.minSalary, draft.targets?.salaryCurrency) || 'used to reject lowballs'}>
            <NumField value={draft.targets?.minSalary} onChange={(v) => set('targets.minSalary', v)} step={50000} />
          </Field>
          <Field label="Currency">
            <select value={draft.targets?.salaryCurrency || 'INR'} onChange={(e) => set('targets.salaryCurrency', e.target.value)}>
              {['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Job types">
            <select
              multiple
              size={3}
              value={draft.targets?.jobTypes || ['full_time']}
              onChange={(e) => set('targets.jobTypes', [...e.target.selectedOptions].map((o) => o.value))}
            >
              {['full_time', 'contract', 'internship', 'part_time'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        <h4 className="sec">Target companies / org types (soft boost in letters)</h4>
        <div className="grid cols-2">
          <Field label="Aiming for"><Chips items={draft.targets?.companiesTarget || []} tone="good" /><Area rows={2} value={(draft.targets?.companiesTarget || []).join('\n')} onChange={(v) => set('targets.companiesTarget', v.split('\n').map((s) => s.trim()).filter(Boolean))} /></Field>
          <Field label="Avoiding"><Chips items={draft.targets?.companiesAvoid || []} tone="miss" /><Area rows={2} value={(draft.targets?.companiesAvoid || []).join('\n')} onChange={(v) => set('targets.companiesAvoid', v.split('\n').map((s) => s.trim()).filter(Boolean))} /></Field>
        </div>
      </Panel>

      <Panel title="Skills" sub="Levels weight the matcher (5 = expert). Core skills get a bonus in the match score and lead the cover letter.">
        <div className="job-bits">
          {(draft.skills || []).map((s) => (
            <span key={s.name} className={`chip ${s.core ? 'good' : ''} rm`} title={`level ${s.level}/5 — click × to drop`} onClick={() => set('skills', (draft.skills || []).filter((x) => x.name !== s.name))}>
              {s.name} <span className="dim">{'●'.repeat(s.level)}</span>
              {s.core && <span style={{ color: 'var(--brand-2)' }}> ·core</span>}
            </span>
          ))}
        </div>
        <div className="flexr mt12">
          <input style={{ maxWidth: 300 }} placeholder="add a skill (e.g. Terraform)" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSkill()} />
          <button className="btn sm" onClick={addSkill}>add</button>
          <span className="dim small">save to persist</span>
        </div>
        <Field label="Bulk paste (comma or newline separated)" hint="paste a list from your resume; they get added as level 3, non-core" wide>
          <Area
            rows={2}
            placeholder="Terraform, Kafka, BigQuery, Playwright"
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                const items = e.target.value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
                if (!items.length) return;
                try {
                  const { skills } = await api.addSkills(items.map((name) => ({ name, level: 3, core: false })));
                  setDraft((d) => ({ ...d, skills }));
                  e.target.value = '';
                  toast(`added ${items.length} skills (unsaved until you hit Save)`);
                } catch (err) {
                  toast(err.message, 'err');
                }
              }
            }}
          />
        </Field>
      </Panel>

      <Panel
        title="Experience"
        right={<button className="btn sm" onClick={() => set('experience', [{ company: '', title: '', location: '', start: '', end: '', current: false, bullets: [] }, ...(draft.experience || [])])}>+ add role</button>}
      >
        {(draft.experience || []).length === 0 && <div className="empty"><b>no roles yet</b>add one manually or let the resume parser fill it.</div>}
        {(draft.experience || []).map((ex, i) => (
          <div key={i} className="panel" style={{ marginBottom: 12, background: 'var(--panel-2)' }}>
            <div className="panel-body">
              <div className="grid cols-4">
                <Field label="Title"><Input value={ex.title} onChange={(v) => set(`experience.${i}.title`, v)} /></Field>
                <Field label="Company"><Input value={ex.company} onChange={(v) => set(`experience.${i}.company`, v)} /></Field>
                <Field label="Start (YYYY-MM)"><Input value={ex.start} onChange={(v) => set(`experience.${i}.start`, v)} placeholder="2023-03" /></Field>
                <Field label="End (blank = current)"><Input value={ex.current ? '' : ex.end} onChange={(v) => set(`experience.${i}.end`, v)} placeholder={ex.current ? 'present' : '2023-02'} /></Field>
              </div>
              <div className="flexr mb0 mt8">
                <Toggle checked={ex.current} onChange={(v) => set(`experience.${i}.current`, v)} label="current role" />
                <span style={{ flex: 1 }} />
                <button className="btn sm danger" onClick={() => set('experience', (draft.experience || []).filter((_, j) => j !== i))}>remove role</button>
              </div>
              <Field label="Bullets (one per line) — these get quoted verbatim in cover letters" wide>
                <Area rows={4} value={(ex.bullets || []).join('\n')} onChange={(v) => set(`experience.${i}.bullets`, v.split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean))} />
              </Field>
            </div>
          </div>
        ))}
      </Panel>

      <Panel
        title="Education"
        right={<button className="btn sm" onClick={() => set('education', [{ school: '', degree: '', start: '', end: '', gpa: '', highlights: [] }, ...(draft.education || [])])}>+ add</button>}
      >
        {(draft.education || []).map((ed, i) => (
          <div key={i} className="grid cols-4" style={{ marginBottom: 10 }}>
            <Field label="School"><Input value={ed.school} onChange={(v) => set(`education.${i}.school`, v)} /></Field>
            <Field label="Degree"><Input value={ed.degree} onChange={(v) => set(`education.${i}.degree`, v)} /></Field>
            <Field label="Years"><Input value={`${ed.start || ''} – ${ed.end || ''}`} onChange={(v) => { const [a, b] = v.split('–').map((s) => s.trim()); set(`education.${i}.start`, a); set(`education.${i}.end`, b || a); }} /></Field>
            <Field label="GPA / grade"><Input value={ed.gpa} onChange={(v) => set(`education.${i}.gpa`, v)} /></Field>
          </div>
        ))}
      </Panel>

      <Panel title="Standing answers" sub="What gets written into the free-text and yes/no questions an ATS throws at you. {tokens} are replaced per job.">
        <div className="grid cols-2">
          <Field label="Why this company / role"><Area rows={3} value={draft.freeTextAnswers?.whyCompanyTemplate} onChange={(v) => set('freeTextAnswers.whyCompanyTemplate', v)} /></Field>
          <Field label="Salary expectation"><Area rows={2} value={draft.freeTextAnswers?.salaryExpectation} onChange={(v) => set('freeTextAnswers.salaryExpectation', v)} /></Field>
          <Field label="Notice period"><Input value={draft.freeTextAnswers?.noticePeriod} onChange={(v) => set('freeTextAnswers.noticePeriod', v)} /></Field>
          <Field label="How did you hear about us"><Input value={draft.freeTextAnswers?.howDidYouHear} onChange={(v) => set('freeTextAnswers.howDidYouHear', v)} /></Field>
          <Field label="'Are you legally authorized…'"><Input value={draft.freeTextAnswers?.areYouLegallyAble} onChange={(v) => set('freeTextAnswers.areYouLegallyAble', v)} /></Field>
          <Field label="'Will you require sponsorship…'"><Input value={draft.freeTextAnswers?.requireVisaSponsorshipNowOrFuture} onChange={(v) => set('freeTextAnswers.requireVisaSponsorshipNowOrFuture', v)} /></Field>
        </div>
        <h4 className="sec">Checkbox defaults</h4>
        <div className="grid cols-3">
          {[
            ['authorizedToWork', 'authorized to work'],
            ['requireSponsorship', 'requires sponsorship'],
            ['legallyAge18', '18+'],
            ['consentBackgroundCheck', 'consent: background check'],
            ['consentDataProcessing', 'consent: data processing'],
          ].map(([k, label]) => (
            <Toggle key={k} checked={draft.boolAnswers?.[k]} onChange={(v) => set(`boolAnswers.${k}`, v)} label={label} />
          ))}
        </div>
        <div className="note info mt16">
          <h5>Never auto-answered</h5>
          Anything involving self-identification (gender, ethnicity, veteran, disability) is pre-filled only if you type it in Diversity below, and ApplyFlow
          will flag those fields as “needs your hand”. Filling them for you would be a disclosure you didn't choose.
        </div>
        <div className="grid cols-4 mt12">
          {['veteran', 'disability', 'ethnicity', 'gender'].map((k) => (
            <Field key={k} label={k === 'veteran' ? 'veteran status (optional)' : `${k} (optional)`}>
              <Input value={draft.diversity?.[k]} onChange={(v) => set(`diversity.${k}`, v)} placeholder="leave blank = skip" />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel title="Self-test" sub="Copy this into a terminal to see exactly what the composer will write for a demo job.">
        <button className="btn sm" onClick={() => copy(JSON.stringify({ profile: draft }, null, 2), 'profile JSON copied')}>copy profile JSON</button>
      </Panel>
    </div>
  );
}

export function ResumeTab({ resume, setResume, refresh, busy }) {
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [applying, setApplying] = useState(false);

  async function upload(file) {
    if (!file) return;
    try {
      const { resume: r, appliedSuggestions } = await api.uploadResume(file);
      setResume(r);
      await refresh();
      toast(appliedSuggestions?.length ? `resume parsed · ${appliedSuggestions.length} profile fields updated` : 'resume parsed');
    } catch (e) {
      toast(e.message, 'err', 8000);
    }
  }

  const s = resume?.summary;
  return (
    <div>
      <h1 className="page">Resume</h1>
      <p className="sub">PDF, DOCX, TXT or MD. We extract text, split sections, mine skills/roles, then propose profile updates — you approve, nothing is hidden.</p>

      <Panel title="Upload" right={resume ? <span className="pill on"><span className="dot" />{resume.filename}</span> : <span className="pill">no resume yet</span>}>
        <div
          className={`drag ${over ? 'over' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}
        >
          {busy ? <Spinner text="parsing…" /> : (
            <>
              <div>drop your resume here, or</div>
              <div className="btn-row" style={{ justifyContent: 'center', marginTop: 8 }}>
                <label className="btn primary sm" style={{ cursor: 'pointer' }}>
                  choose file
                  <input type="file" accept=".pdf,.docx,.txt,.md,.rtf,.html" style={{ display: 'none' }} onChange={(e) => upload(e.target.files[0])} />
                </label>
                <button className="btn sm ghost" onClick={() => copy('/api/export/prefill.json', 'export URL copied')}>need a sample? paste below ↓</button>
              </div>
            </>
          )}
        </div>
        <Field label="…or paste the text of your resume" hint="works for scanned PDFs where text extraction fails" wide>
          <Area rows={6} value={text} onChange={setText} placeholder={'Alex Kumar\nSoftware Engineer · Bengaluru\n\nEXPERIENCE\nNimbus Labs — Software Engineer II (Mar 2023 – present)\n• …'} />
        </Field>
        <button
          className="btn primary"
          disabled={text.trim().length < 80}
          onClick={async () => {
            try {
              const { resume: r, appliedSuggestions } = await api.pasteResume(text);
              setResume(r);
              setText('');
              await refresh();
              toast(`parsed${appliedSuggestions?.length ? ` · applied: ${appliedSuggestions.join(', ')}` : ''}`);
            } catch (e) {
              toast(e.message, 'err', 7000);
            }
          }}
        >
          Parse pasted text
        </button>
      </Panel>

      {resume && (
        <>
          <Panel
            title="Proposed profile updates"
            sub={resume.suggestedPatch?.changed?.length ? 'these came from the document, not from you — review them' : 'nothing new found; your profile already covers it'}
            right={
              resume.suggestedPatch?.changed?.length ? (
                <button
                  className="btn sm primary"
                  disabled={applying}
                  onClick={async () => {
                    setApplying(true);
                    try {
                      const r = await api.applySuggestions();
                      toast(`applied: ${r.changed.join(', ') || 'nothing new'}`);
                      await refresh();
                    } catch (e) {
                      toast(e.message, 'err');
                    }
                    setApplying(false);
                  }}
                >
                  {applying ? <Spinner text="applying…" /> : 'apply all'}
                </button>
              ) : null
            }
          >
            {resume.suggestedPatch?.changed?.length ? (
              <>
                <Chips items={resume.suggestedPatch.changed} tone="good" />
                <pre className="mt12">{JSON.stringify(resume.suggestedPatch.patch, null, 2).slice(0, 2600)}</pre>
              </>
            ) : (
              <div className="empty">no changes needed</div>
            )}
          </Panel>

          <div className="grid cols-2">
            <Panel title={`What we detected · ${s?.words || 0} words / ${(resume.bytes / 1024).toFixed(1)} kB`}>
              <div className="kv">
                <div>name</div><div>{s?.name || '—'}</div>
                <div>headline</div><div>{s?.headline || '—'}</div>
                <div>email</div><div>{s?.contact?.email || '—'}</div>
                <div>phone</div><div>{s?.contact?.phone || '—'}</div>
                <div>links</div><div className="mono small">{[s?.contact?.linkedin, s?.contact?.github, s?.contact?.website].filter(Boolean).join(' · ') || '—'}</div>
                <div>experience blocks</div><div>{s?.experience?.length || 0}</div>
                <div>education blocks</div><div>{s?.education?.length || 0}</div>
                <div>years detected</div><div>{s?.yearsOfExperience ?? '—'}</div>
              </div>
              <h4 className="sec">skills mined ({s?.skills?.length || 0})</h4>
              <Chips items={(s?.skills || []).slice(0, 40)} />
            </Panel>
            <Panel title="Quantified wins found" sub="these feed cover letters so they aren't all vibes">
              {(s?.wins || []).length ? (
                <ul className="list" style={{ margin: 0, paddingLeft: 18 }}>
                  {s.wins.map((w, i) => <li key={i} className="small">{w}</li>)}
                </ul>
              ) : (
                <div className="empty">no metric-bearing sentences found — add numbers to your bullets, they are the difference between skimmed and read</div>
              )}
              <div className="btn-row mt16">
                <button className="btn sm" onClick={() => copy(s?.text || resume.text, 'resume text copied')}>copy extracted text</button>
                <span className="dim small">sections: {Object.keys(s?.sections || {}).join(', ')}</span>
              </div>
            </Panel>
          </div>

          <Panel title="Extracted raw text" foot={<span className="dim small">If this looks wrong, your PDF is an image — re-export as text-based PDF.</span>}>
            <pre className="exp">{(resume.text || '').slice(0, 4000)}</pre>
          </Panel>
        </>
      )}
    </div>
  );
}
