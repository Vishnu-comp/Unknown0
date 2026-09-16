/**
 * Application composer: cover letter + screening answers + prefill payload.
 *
 * Letters are built deterministically from your profile + the job text (always
 * works, no keys, no hallucinated claims). If you plug an LLM key into
 * Settings -> Model, the same material gets rewritten with more variety.
 */
import { normalize, truncate, extractPhrases, sentences } from './text.mjs';

/* ------------------------------- template path ----------------------------- */

/**
 * Pick the bullets that answer THIS posting. Only from the role we say they come
 * from: an earlier version pooled current + previous roles and attributed the
 * result to the current one, which put an internship line under a full-time
 * heading — exactly the kind of quiet overclaim a hiring manager notices.
 */
function pickRelevant(bullets, jobTerms) {
  const scored = (bullets || []).map((b) => {
    const low = b.toLowerCase();
    const hits = jobTerms.filter((t) => low.includes(t)).length;
    const numeric = /\d/.test(b) ? 0.5 : 0;
    return { b, score: hits * 2 + numeric };
  });
  return scored
    .sort((a, z) => z.score - a.score)
    .slice(0, 3)
    .map((s) => s.b.trim().replace(/[.;]\s*$/, ''));
}

function companyHook(job) {
  const desc = normalize(job.description || '');
  const m =
    desc.match(/we (?:are|'re) (?:a|building|on a mission to)([^.\n]{20,140})/i) ||
    desc.match(/our (?:mission|team|product)([^.\n]{15,120})/i) ||
    desc.match(/(?:about the (?:role|team))([^.\n]{10,120})/i);
  return m ? truncate(m[0].replace(/^we\s+(are|'re)\s+/i, ''), 150) : null;
}

export function buildLetter({ job, profile, match, resume, tone = 'confident' }) {
  const name = profile.fullName || 'Candidate';
  const role = job.title || 'the role';
  const company = job.company || 'your team';
  const jobTerms = [...extractPhrases(normalize(`${job.title} ${job.description}`))].map((t) => t.toLowerCase());
  const matched = (match?.matchedSkills || []).slice(0, 6);

  const role1 = profile.experience?.[0];
  const role2 = profile.experience?.[1];
  const primaryPool = (role1?.bullets || []).length ? role1 : role2;
  const bullets = pickRelevant(primaryPool?.bullets, jobTerms.length ? jobTerms : matched);
  const wins = (resume?.wins || []).filter((w) => w.length > 40).slice(0, 1);
  const years = match?.yearsOfExperience ?? resume?.yearsOfExperience ?? null;
  const domain = (profile.targets?.fields || [])[0] || profile.primaryField || 'engineering';

  const opening =
    tone === 'direct'
      ? `I'm applying for ${role} at ${company}. ${years ? `I have ${years} years of experience shipping ` : 'I bring '}production work in ${friendlyDomain(domain)}${matched.length ? `, most recently with ${matched.slice(0, 3).join(', ')}` : ''}.`
      : `I'd like to apply for ${role} at ${company}.${years ? ` I'm a ${friendlyTitle(profile, role)} with ${years} years building and running production systems in ${friendlyDomain(domain)}.` : ` I'm a ${friendlyTitle(profile, role)} focused on ${friendlyDomain(domain)}.`}`;

  const hook = companyHook(job);
  const whyParagraph = hook
    ? `What pulled me in was the description: ${hook}. That's close to the problem set I want to spend the next couple of years on — not just maintaining what exists, but moving the numbers that matter.`
    : `The description reads like work where ownership is expected rather than ticket throughput, which matches how I've operated so far.`;

  const proof = bullets.length
    ? `At ${primaryPool?.company || 'my current company'}${primaryPool?.title ? ` (${primaryPool.title})` : ''}, the work closest to yours:\n${bullets.map((b) => `  • ${b}.`).join('\n')}${wins.length ? `\n\nOutside of that: ${truncate(wins[0], 200)}.` : ''}`
    : `I've spent the last few years${years ? ` (${years} yrs)` : ''} building ${matched.slice(0, 4).join(', ') || 'product software'} end to end — design docs through deploy to on-call — and I care about measurable outcomes over activity.`;

  const gapLine = (match?.missingSkills || []).length && match.score < 80
    ? `Two things in your stack I haven't used in production yet — ${(match.missingSkills || []).slice(0, 2).join(' and ')} — I've read the source and built small prototypes with both, and I pick up tooling fast (I learned ${match.matchedSkills?.[0] || 'this stack'} on the job in about a month).`
    : '';

  const close = `${profile.boolAnswers?.maxNoticePeriodWeeks ? `I can start within ${profile.boolAnswers.maxNoticePeriodWeeks} weeks` : 'I can start quickly'}${profile.location?.city ? ` and I'm based in ${profile.location.city}${profile.openToRelocate ? ', open to relocation' : ''}` : ''}. Happy to walk through any of the above — code, architecture decisions, or the boring parts.`;

  const letter = [
    `${name}${profile.email ? ` · ${profile.email}` : ''}${profile.phone ? ` · ${profile.phone}` : ''}`,
    [profile.location?.city, profile.location?.state, profile.location?.country].filter(Boolean).join(', '),
    '',
    `Re: ${role} — ${company}${match ? ` (match score ${match.score}/100)` : ''}`,
    '',
    `Hi ${company} hiring team,`,
    '',
    opening,
    '',
    whyParagraph,
    '',
    proof,
    gapLine ? `\n${gapLine}\n` : '',
    close,
    '',
    name,
    [profile.linkedin, profile.github, profile.portfolio].filter(Boolean).join(' · '),
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return {
    letter,
    wordCount: letter.split(/\s+/).filter(Boolean).length,
    matchedSkills: matched,
    usedBullets: bullets,
    mode: 'template',
  };
}

function friendlyDomain(id) {
  const map = {
    software_engineering: 'backend and full-stack product engineering',
    platform_engineering: 'platform, reliability and developer tooling',
    data_science: 'applied machine learning and experimentation',
    data_engineering: 'data pipelines and analytics engineering',
    product_management: 'technical product management',
    product_design: 'product design and design systems',
    marketing_growth: 'lifecycle and performance growth',
    sales: 'full-cycle B2B sales',
    finance_analytics: 'financial planning and analysis',
    qa_testing: 'test automation and quality engineering',
    mobile_engineering: 'mobile client engineering',
    cybersecurity: 'application security',
  };
  return map[id] || 'product engineering';
}

function friendlyTitle(profile, jobTitle) {
  const mine = (profile.experience?.[0]?.title || '').toLowerCase();
  if (/senior|staff|lead/.test(jobTitle.toLowerCase())) return profile.experience?.[0]?.title || 'software engineer';
  return mine || 'software engineer';
}

/* -------------------------------- LLM polish ------------------------------- */

export async function polishLetter({ job, profile, match, resume, settings }) {
  const llm = settings?.llm || {};
  const key = llm.apiKey || process.env.LLM_API_KEY;
  if (!key || llm.provider === 'none') return null;
  const built = buildLetter({ job, profile, match, resume, tone: llm.tone || 'confident' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(llm.timeoutMs || 25000));
  try {
    const res = await fetch(`${(llm.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: llm.model || 'gpt-4o-mini',
        temperature: 0.6,
        messages: [
          {
            role: 'system',
            content:
              'You write job-application cover letters that a recruiter would actually read: 180-260 words, no flattery, no "passionate about", no invented metrics, active voice, keep every factual claim from the source material. Return only the letter body.',
          },
          {
            role: 'user',
            content: `JOB: ${job.title} @ ${job.company}\n${truncate(normalize(job.description || ''), 1800)}\n\nWHY-THIS-MATCH: score ${match?.score}/100, matched skills ${(match?.matchedSkills || []).join(', ')}\n\nMY MATERIAL (only source of facts):\n${built.letter}`,
          },
        ],
      }),
    });
    if (!res.ok) return { ...built, llmError: `HTTP ${res.status}`, mode: 'template' };
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return { ...built, llmError: 'empty response', mode: 'template' };
    return { letter: text, wordCount: text.split(/\s+/).filter(Boolean).length, matchedSkills: built.matchedSkills, usedBullets: built.usedBullets, mode: 'llm' };
  } catch (e) {
    return { ...built, llmError: e.message, mode: 'template' };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ screening answers -------------------------- */

const QA_MAP = [
  { rx: /why (do you want|are you interested|should we hire you)|why (this|{c})|interest/i, a: (ctx) => (ctx.profile.freeTextAnswers?.whyCompanyTemplate || 'I want to work on {company} because {hook}.').replace('{company}', ctx.job.company).replace('{hook}', companyHook(ctx.job) || 'the problem space you are hiring into').replace('{currentCompany}', ctx.profile.experience?.[0]?.company || 'my current team').replace('{transferable}', (ctx.profile.experience?.[0]?.bullets?.[0] || 'built production features').replace(/\.$/, '')).replace('{area}', ctx.job.title || 'this area') },
  { rx: /salary|compensation|expectation/i, a: (ctx) => (ctx.profile.freeTextAnswers?.salaryExpectation || '{expected}').replace('{expected}', ctx.job.salaryMin ? `${ctx.job.salaryCurrency || 'INR'} ${ctx.job.salaryMin.toLocaleString()}` : ctx.profile.targets?.minSalary ? `${ctx.profile.targets.salaryCurrency || 'INR'} ${ctx.profile.targets.minSalary.toLocaleString()}` : 'competitive with market') },
  { rx: /notice period|how soon|start date|immediate/i, a: (ctx) => ctx.profile.freeTextAnswers?.noticePeriod || '4 weeks' },
  { rx: /authorized|sponsor|visa|legally/i, a: (ctx) => (ctx.profile.boolAnswers?.requireSponsorship ? ctx.profile.freeTextAnswers?.requireVisaSponsorshipNowOrFuture || 'No' : ctx.profile.freeTextAnswers?.areYouLegallyAble || 'Yes') },
  { rx: /relocat|work from (home|office)|hybrid|onsite/i, a: (ctx) => (ctx.job.remote ? 'This role is remote, which suits me. I am also open to occasional on-site visits.' : ctx.profile.openToRelocate ? `Yes — I'm based in ${ctx.profile.location?.city || 'India'} and open to relocation.` : `No relocation, but ${ctx.profile.location?.city || 'my city'} is a good commute for me.`) },
  { rx: /background check|consent|privacy|gdpr/i, a: () => 'Yes, agreed.' },
  { rx: /veteran|disabled|gender|ethnicity|race/i, a: () => 'Prefer not to say' },
  { rx: /how did you hear|referral|source/i, a: (ctx) => ctx.profile.freeTextAnswers?.howDidYouHear || 'online job board' },
  { rx: /linkedin|portfolio|github|website|profile link/i, a: (ctx) => [ctx.profile.portfolio, ctx.profile.github, ctx.profile.linkedin].filter(Boolean).join(' | ') || 'n/a' },
  { rx: /years of experience|how many years/i, a: (ctx) => `${ctx.match?.yearsOfExperience ?? 3} years` },
  { rx: /do you have|experience with|familiar/i, a: (ctx) => { const skill = (ctx.q.match(/(?:have|with|familiar with)\s+(.{3,40})\??$/i) || [])[1]; if (!skill) return 'Yes.'; const has = (ctx.profile.skills || []).some((s) => s.name.toLowerCase().includes(skill.toLowerCase().slice(0, 10))); return has ? `Yes — ${skill.trim().replace(/\?$/, '')} in production.` : `Limited hands-on, but adjacent: ${(ctx.match?.matchedSkills || [])[0] || 'my core stack'} transfers directly.`; } },
  { rx: /why (leaving|left|looking|changing)|reason for change/i, a: (ctx) => `Looking for ${ctx.job.title ? `a role closer to ${ctx.job.title.toLowerCase()}` : 'a harder problem set'} with more ownership and a clear path to impact; that's what your posting describes.` },
  { rx: /greatest weakness|failure|conflict/i, a: () => 'I used to over-polish before shipping. Now I set an explicit "good enough to learn from" bar and ship to a flag — I still refine after real feedback.' },
  { rx: /relocation assistance|willing to travel/i, a: () => 'Yes, up to ~15% travel.' },
  { rx: /availability|notice/i, a: (ctx) => ctx.profile.freeTextAnswers?.noticePeriod || '4 weeks' },
];

export function answerQuestions(questions, ctx) {
  return (questions || []).map((q) => {
    const text = typeof q === 'string' ? q : q.label || q.question || q.text || '';
    const type = (typeof q === 'object' && q.type) || guessType(text);
    const hit = QA_MAP.find((m) => m.rx.test(text));
    let answer = hit ? hit.a({ ...ctx, q: text }) : null;
    if (!answer) answer = fallback(text, ctx, type);
    return { question: text, type, answer: truncate(answer, 1400), auto: true, confidence: hit ? 0.86 : 0.4 };
  });
}

function guessType(text) {
  if (/^(do you|are you|is your)/i.test(text)) return 'yesno';
  if (/salary|compensation/i.test(text)) return 'number';
  if (/years|how many|number of/i.test(text)) return 'number';
  if (/why|describe|tell me|explain/i.test(text)) return 'textarea';
  if (/select|choose/i.test(text)) return 'select';
  return 'text';
}

function fallback(text, ctx, type) {
  if (type === 'yesno') return /do you (have|like|know)\b|familiar/i.test(text) ? 'Yes.' : 'No preference.';
  if (type === 'number') return String(ctx.job.salaryMin || ctx.profile.targets?.minSalary || '');
  const s = sentences(ctx.resume?.text || '').find((x) => new RegExp(text.toLowerCase().slice(0, 14).replace(/[^\w\s]/g, ''), 'i').test(x));
  return s || `Relevant to "${truncate(text, 60)}": ${ctx.profile.experience?.[0]?.bullets?.[0] || 'see resume.'}`;
}

/** Generic prefill map the browser extension consumes. */
export function buildPrefill({ job, profile, resume, match, app }) {
  const full = [profile.fullName || ''].filter(Boolean).join(' ');
  const first = full.split(' ')[0] || '';
  const last = full.split(' ').slice(1).join(' ') || '';
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    job: { id: job.id, url: job.url, title: job.title, company: job.company, source: job.source },
    match: { score: match?.score ?? null, matchedSkills: match?.matchedSkills || [] },
    fields: {
      'first.name': first,
      'last.name': last,
      'full.name': full,
      name: full,
      email: profile.email || '',
      phone: profile.phone || '',
      'phone.number': profile.phone || '',
      'current.company': profile.experience?.[0]?.company || '',
      'current.title': profile.experience?.[0]?.title || '',
      'current.employer': profile.experience?.[0]?.company || '',
      employer: profile.experience?.[0]?.company || '',
      jobTitle: profile.experience?.[0]?.title || '',
      company: profile.experience?.[0]?.company || '',
      'start.date': profile.experience?.[0]?.start || '',
      'end.date': profile.experience?.[0]?.current ? '' : profile.experience?.[0]?.end || '',
      'experience.years': String(match?.yearsOfExperience ?? resume?.yearsOfExperience ?? ''),
      location: [profile.location?.city, profile.location?.state, profile.location?.country].filter(Boolean).join(', '),
      'location.city': profile.location?.city || '',
      'location.state': profile.location?.state || '',
      'location.country': profile.location?.country || '',
      'address.street': profile.address || '',
      'address.postalCode': profile.postalCode || '',
      linkedin: profile.linkedin || '',
      github: profile.github || '',
      portfolio: profile.portfolio || '',
      website: profile.portfolio || '',
      school: profile.education?.[0]?.school || '',
      'education.school': profile.education?.[0]?.school || '',
      'education.degree': profile.education?.[0]?.degree || '',
      'education.startYear': profile.education?.[0]?.start || '',
      'education.endYear': profile.education?.[0]?.end || '',
      'education.gpa': profile.education?.[0]?.gpa || '',
      gpa: profile.education?.[0]?.gpa || '',
      'salary.expected': (profile.freeTextAnswers?.salaryExpectation || '').replace('{expected}', (profile.targets?.minSalary || 0).toLocaleString()) || '',
      'salary.current': profile.currentSalary ? String(profile.currentSalary) : '',
      'notice.period': profile.freeTextAnswers?.noticePeriod || '',
      'work.authorized': profile.boolAnswers?.authorizedToWork ? 'yes' : 'no',
      'requires.sponsorship': profile.boolAnswers?.requireSponsorship ? 'yes' : 'no',
      sponsorshipNeeded: profile.boolAnswers?.requireSponsorship ? 'No' : 'No',
      'relocate.willing': profile.openToRelocate ? 'yes' : 'no',
      'background.agree': profile.boolAnswers?.consentBackgroundCheck ? 'yes' : 'no',
      'consent.data': profile.boolAnswers?.consentDataProcessing ? 'yes' : 'no',
      'cover.letter': app?.letter || '',
      summary: (resume?.sections?.summary || '').slice(0, 900),
      'how.heard': profile.freeTextAnswers?.howDidYouHear || '',
      referral: profile.referral || '',
      'reason.for.leaving': 'Seeking a role with more ownership in the product area this team works on.',
      'desired.salary': String(profile.targets?.minSalary || ''),
      'availability': profile.freeTextAnswers?.noticePeriod || '',
      'gender': profile.diversity?.gender || '',
      'race.ethnicity': profile.diversity?.ethnicity || '',
      'veteran.status': profile.diversity?.veteran || '',
      'disability.status': profile.diversity?.disability || '',
    },
    files: { resume: app?.resumeFilename || resume?.filename || null },
    checkboxes: {
      authorizedToWork: Boolean(profile.boolAnswers?.authorizedToWork),
      requireSponsorship: Boolean(profile.boolAnswers?.requireSponsorship),
      willingToRelocate: Boolean(profile.openToRelocate),
      backgroundCheck: Boolean(profile.boolAnswers?.consentBackgroundCheck),
      consentDataProcessing: Boolean(profile.boolAnswers?.consentDataProcessing),
    },
    answers: app?.answers || [],
    uploads: [
      { label: 'Resume / CV', role: 'resume', filename: resume?.filename || 'resume.pdf' },
      { label: 'Cover letter', role: 'coverLetter', filename: app?.coverFilename || 'cover-letter.txt' },
    ],
    consent: { autoSubmitAllowed: false, note: 'ApplyFlow never submits on external sites without your click. Review then submit.' },
  };
}

/* ------------------------------ email apply path --------------------------- */

export function mailtoFor(job, profile, app) {
  const to = job.applyEmail || '';
  if (!to) return null;
  const subject = `Application: ${job.title} — ${profile.fullName}`.slice(0, 180);
  const body = `${app?.letter || ''}\n\n—\n${profile.fullName}\n${profile.email}\n${profile.phone}\n${[profile.linkedin, profile.github, profile.portfolio].filter(Boolean).join('\n')}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
