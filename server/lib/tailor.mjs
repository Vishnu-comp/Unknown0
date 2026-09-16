/**
 * Resume tailoring: same facts, better order and emphasis for THIS posting.
 *
 * Hard rule — nothing is invented. Every line in the output traces back to a
 * real bullet, skill or metric in the user's profile/resume. Tailoring is
 * ordering, selection and headline wording, never fabrication.
 */
import { normalize, extractPhrases, truncate } from './text.mjs';

const STOP = new Set(['with', 'that', 'this', 'from', 'into', 'over', 'your', 'have', 'been', 'will', 'role', 'team', 'work', 'using', 'across', 'about']);

function jobSignals(job) {
  const text = normalize(`${job.title} ${(job.tags || []).join(' ')} ${job.description || ''}`);
  const phrases = new Set(extractPhrases(text).map((p) => p.toLowerCase()));
  const words = new Map();
  for (const w of text.toLowerCase().replace(/[^a-z0-9+#.\- ]/g, ' ').split(/\s+/)) {
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
    words.set(w, (words.get(w) || 0) + 1);
  }
  const topWords = [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w]) => w);
  // must-have lines from the posting's own requirements block
  const reqLines = (job.requirements || []).length
    ? job.requirements
    : (normalize(job.description || '')
        .split(/\n+/)
        .map((l) => l.replace(/^[-•*\d.\s]+/, '').trim())
        .filter((l) => /\b(years?|experience|proficien|strong|deep|hands-on|ability to|comfortable|own|build|ship|bonus|nice to have|required|must)\b/i.test(l) && l.length > 20)
        .slice(0, 14));
  return { phrases, topWords, reqLines, raw: text };
}

function scoreBullet(bullet, sig) {
  const b = normalize(bullet).toLowerCase();
  let score = 0;
  const why = [];
  for (const p of sig.phrases) {
    if (p.length > 2 && b.includes(p)) {
      score += 3;
      why.push(p);
    }
  }
  for (const w of sig.topWords) if (b.includes(w)) score += 1;
  if (/\d/.test(b)) score += 1.5;
  if (/%|\b(x|k|m|hrs?|min|days?|users?|customers?|requests?|tickets?)\b/i.test(b)) score += 1.5;
  if (b.length > 60 && b.length < 220) score += 0.6;
  if (/^(led|architected|designed|built|shipped|migrated|reduced|cut|improved|automated|owned)\b/i.test(b.trim())) score += 0.8;
  if (/assisted|helped with|participated|was responsible for|involved in/i.test(b)) score -= 1.2;
  return { score, why: [...new Set(why)] };
}

/** Reordered + trimmed skills so the posting's stack leads. */
function rankSkills(skills, sig) {
  return [...(skills || [])]
    .map((s) => {
      const name = s.name.toLowerCase();
      let score = (s.level || 3) * 0.6 + (s.core ? 1.2 : 0);
      if (sig.phrases.has(name)) score += 4;
      else for (const tok of name.split(/[\s/(),]+/)) if (tok.length > 3 && sig.topWords.includes(tok)) score += 1.4;
      return { ...s, _score: score, requested: sig.phrases.has(name) };
    })
    .sort((a, b) => b._score - a._score);
}

function buildHeadline(profile, job, sig, match) {
  const role = normalize(job.title)
    .replace(/\b(sr\.?|senior|staff|lead|principal|ii|iii|iv)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;])/g, '$1')
    .replace(/\s+([()])/g, ' $1').replace(/\s{2,}/g, ' ')
    .trim();
  const mine = profile.linkedinHeadline || `${(profile.experience?.[0]?.title || 'Software Engineer').trim()}`;
  const leadSkills = rankSkills(profile.skills, sig)
    .filter((s) => s._score > 3)
    .slice(0, 4)
    .map((s) => s.name);
  const years = match?.yearsOfExperience ?? null;
  const parts = [role || mine];
  if (years) parts.push(`${years} yrs`);
  if (leadSkills.length) parts.push(leadSkills.join(' · '));
  if (profile.location?.city) parts.push(profile.location.city + (job.remote ? ' · remote-friendly' : ''));
  return parts.join(' — ');
}

/**
 * Returns the tailored resume text plus an audit trail of what moved and why,
 * so the user can see it is re-arrangement, not fiction.
 */
export function tailorResume({ job, profile, resume, match }) {
  const sig = jobSignals(job);
  const rankedSkills = rankSkills(profile.skills, sig);
  const requested = rankedSkills.filter((s) => s.requested);
  const missing = (match?.missingSkills || []).filter((m) => !rankedSkills.some((s) => s.name.toLowerCase() === m));

  const blocks = [];
  for (const [i, ex] of (profile.experience || []).entries()) {
    const bullets = (ex.bullets || []).map((b) => ({ b, ...scoreBullet(b, sig) })).sort((a, z) => z.score - a.score);
    const kept = bullets.filter((x, idx) => idx < 4 || x.score >= 2.5);
    blocks.push({
      order: i,
      company: ex.company,
      title: ex.title,
      location: ex.location,
      period: `${ex.start || ''}${ex.current ? ' – present' : ex.end ? ` – ${ex.end}` : ''}`.replace(/^ – /, ''),
      bullets: kept,
      dropped: bullets.length - kept.length,
    });
  }

  const wins = (resume?.wins || []).map((w) => ({ b: w, ...scoreBullet(w, sig) })).filter((x) => x.score >= 3).sort((a, z) => z.score - a.score).slice(0, 3);

  /* Skills the posting matched are listed with the user's own capitalisation
     when they already have the skill — "react" from the posting, "React.js" as
     it appears on their resume. "in their words" describes which skills were
     picked, not how they are spelled; ATS keyword matching is case-insensitive,
     and a resume that reads "sql · jenkins" looks like a list dump. */
  const profileCase = new Map((profile.skills || []).map((sk) => [String(sk.name).toLowerCase(), String(sk.name)]));
  const requestedNames = requested.map((r) => {
    const raw = String(r.name);
    const exact = profileCase.get(raw);
    if (exact) return exact;
    const stem = raw.replace(/[.,]?(js|py|ts)$/i, '').trim();
    if (stem.length > 2) {
      const byStem = [...profileCase.entries()].find(([k]) => k === stem || k.startsWith(stem + ' ') || k.startsWith(stem + '.'));
      if (byStem) return byStem[1];
    }
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  });

  const line = '─'.repeat(64);
  const contact = [
    [profile.email, profile.phone].filter(Boolean).join(' · '),
    [profile.location?.city, profile.location?.state, profile.location?.country].filter(Boolean).join(', '),
    [profile.linkedin, profile.github, profile.portfolio].filter(Boolean).join(' · '),
  ]
    .filter(Boolean)
    .join(' · ');
  const out = [
    profile.fullName || 'Candidate',
    contact,
    '',
    line,
    buildHeadline(profile, job, sig, match),
    line,
    '',
    `RELEVANT SKILLS · ${requested.length} of the stack in this posting, in their words`,
    wrap([...new Set(requestedNames)].join(' · ') || rankedSkills.slice(0, 8).map((s) => s.name).join(' · '), 72),
    '',
    'EXPERIENCE',
  ];

  for (const blk of blocks) {
    out.push('');
    out.push(`${blk.company}${blk.title ? ` — ${blk.title}` : ''}${blk.period ? `  (${blk.period})` : ''}${blk.location ? ` · ${blk.location}` : ''}`);
    for (const x of blk.bullets) out.push(`  • ${x.b}`);
    if (!blk.bullets.length) out.push('  • (no bullets in your profile for this role yet — worth adding two)');
  }

  if (wins.length) {
    out.push('');
    out.push('OUTCOMES THAT MATTER FOR THIS ROLE');
    for (const w of wins) out.push(`  • ${w.b}`);
  }

  if ((resume?.education || profile.education || []).length) {
    out.push('');
    out.push('EDUCATION');
    for (const ed of resume?.education?.length ? resume.education : profile.education) {
      // a range, not just the end year: "MCA (2025)" hides that it was a 2-year
      // programme, and marks/percentage are the one thing Indian resumes are read for
      const span = ed.start && ed.end && ed.start !== ed.end ? `${ed.start} – ${ed.end}` : ed.end || ed.start || '';
      const score = ed.gpa ? `GPA ${ed.gpa}` : ed.marks || '';
      out.push(
        `  ${ed.school || ''}${ed.degree ? ` — ${ed.degree}` : ''}${span ? ` (${span})` : ''}${score ? ` · ${score}` : ''}${(ed.highlights || []).length ? ` · ${ed.highlights.join('; ')}` : ''}`
      );
    }
  }

  if (profile.certifications?.length) {
    out.push('');
    out.push('CERTIFICATIONS');
    for (const c of profile.certifications) out.push(`  • ${typeof c === 'string' ? c : c.name}`);
  }

  out.push('');
  out.push(line);
  out.push(
    missing.length
      ? `Not claimed (and correctly absent): ${missing.slice(0, 6).join(', ')}. If you have touched any of these, add a bullet — do not let the generator invent one.`
      : 'Every requirement in this posting that maps to a named skill is present in the profile above.'
  );

  const audit = {
    headline: buildHeadline(profile, job, sig, match),
    skillsPromoted: requested.map((s) => s.name),
    bullets: blocks.flatMap((b) => b.bullets.map((x) => ({ company: b.company, text: truncate(x.b, 90), score: Math.round(x.score * 10) / 10, matched: x.why }))),
    droppedBullets: blocks.reduce((n, b) => n + Math.max(0, b.dropped), 0),
    winsUsed: wins.length,
    untouchedRequirements: missing,
    fabricationRisk: wins.length + blocks.reduce((n, b) => n + b.bullets.length, 0) === 0 ? 'no source bullets — output is profile-only' : 'all lines traced to profile/resume',
  };

  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), audit };
}

function wrap(text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) {
      lines.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.join('\n');
}

/** Plain-text ATS paste version (no box-drawing, one column, no unicode bullets). */
export function toAtsPlain(tailored) {
  return tailored
    .replace(/[─—–]/g, (c) => (c === '─' ? '-' : '-'))
    .replace(/[•·]/g, '-')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
