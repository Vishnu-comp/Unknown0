/**
 * Single source of truth for "which ATS control means what".
 * Used by the extension (via dynamic import) and unit-tested in scripts/fieldmap.test.mjs.
 */

export const PATTERNS = [
  // Priority-ordered: earlier rules win. The shape of the list is the contract —
  // specific intent first, generic labels (bare "name", generic "date", "title")
  // only as last-resort fallbacks.
  [/first\s*name|given\s*name|fname|applicant_first|contact_first|preferred[\s_-]*name/i, 'first.name'],
  [/last\s*name|family\s*name|surname|lname|applicant_last|contact_last|second[\s_-]*name/i, 'last.name'],
  [/e-?mail(?!\s*(\bnewsletter\b))/i, 'email'],
  [/\b(phone|mobile|telephone|cell)\b|contact[_\s-]*number/i, 'phone'],
  [/current\s*(compensation|salary|ctc)|(compensation|salary|ctc)[^|]{0,14}\bcurrent\b|present\s*(salary|ctc|compensation)/i, 'salary.current'],
  [/salary[^|]{0,26}(expectation|expectations|desired|requirement|requested)|(expected|desired)[^|]{0,26}(ctc|salary|compensation|comp\b)|compensation[^|]{0,22}expect/i, 'salary.expected'],
  [/notice[\s_-]*period|available[\s_-]*(from|date)|earliest[\s_-]*start|availability|when\s+(could|can|would)\s+you\s+start|join(ing)?\s*date|\bdate\s+you\s+can\s+start|\bcan\s+you\s+start\b|\bstart\s+(date|day)\b(?![^|]{0,28}(school|college|university|program|course|role|position|job|company|employment|contract))/i, 'notice.period'],
  [/work\s*(authorization|authorized|authorised)|authoriz(ed|e)?\s+to\s+work|authoris(ed|e)?\s+to\s+work|right\s+to\s+work|legally\s+(be|able|authorized|authorised)|eligible\s+to\s+work/i, 'work.authorized'],
  [/sponsor(ship)?|visa|require.{0,24}sponsor/i, 'requires.sponsorship'],
  [/background[\s_-]*check|consent[^|]{0,18}background/i, 'background.agree'],
  [/(?!.{0,60}background)\b(terms|privacy|gdpr|data\s*processing)\b|how\s+we\s+(process|handle)/i, 'consent.data'],
  [/relocat/i, 'relocate.willing'],
  [/cover\s*letter|motivation\s*(letter|statement)|statement\s*of\s*interest|additional\s*(info|information|comment|note)s?|why\s+(do\s+you\s+want\s+to\s+(join|apply)|are\s+you\s+(interested|a\s+good\s+fit)|should\s+we)/i, 'cover.letter'],
  [/reason\s+(for\s+)?(leaving|looking)|why\s+are\s+you\s+looking|why\s+(do\s+you\s+want\s+to\s+leave|are\s+you\s+leaving)/i, 'reason.for.leaving'],
  [/current\s*(employer|company)|\bemployer\b|present\s*company|who\s+do\s+you\s+work\s+for|\bcompany\b(?!\s*(size|industry\s*you\s*like))/i, 'current.company'],
  [/job\s*title(?!.*(desired|expected))|current\s*(title|position|role)|position\s+you\s+hold|your\s+current\s+role/i, 'current.title'],
  [/years\s*of\s*(experience|exp)|total\s*experience|\byoe\b|experience\s*(level|length)|how\s+many\s+years/i, 'experience.years'],
  [/school|university|college|institution|institute|alma\s*mater/i, 'education.school'],
  [/(^|[^a-z])(degree|qualification|field\s*of\s*study|major\b)(?!.*(school|college|university))/i, 'education.degree'],
  [/\b(gpa|cgpa)\b|grade\s*point|percentage\s*of\s*marks/i, 'gpa'],
  [/graduat(e|ion)\s*(year|date)|year\s*of\s*(completion|graduation)|education\s*end/i, 'education.endYear'],
  [/attended\s*from|education\s*start|(school|college|university|degree|program)[^|]{0,14}\bstart\b|\bstart\b[^|]{0,14}\b(edu|graduat)/i, 'education.startYear'],
  [/address\s*(1|line\s*1|street)|street\s*(address|line)|\bstreet\b/i, 'address.street'],
  [/\bcity\b|\btown\b/i, 'location.city'],
  [/\b(state|province|region|county)\b/i, 'location.state'],
  [/\b(zip|postal)\b(\s*(code)?)?/i, 'address.postalCode'],
  [/\bcountry\b/i, 'location.country'],
  [/location|where\s+are\s+you\s+based|current\s*(address|residence|location)|preferred\s*(work\s*)?location|desired\s*location/i, 'location'],
  [/\blinked(in)?\b|professional\s*network/i, 'linkedin'],
  [/\bgithub\b|git\s*hub/i, 'github'],
  [/portfolio|personal\s*(site|url|web|website)|other\s*link|\bwebsite\b|\burl\b/i, 'portfolio'],
  [/referral|how\s+did\s+you\s+hear|where\s+did\s+you\s+hear|source\s+of\s+(applicant|candidate)|requisition|\breq\s*id\b/i, 'referral'],
  [/summary|about\s*(you|me)|profile\s*description|headline|\bbio\b/i, 'summary'],
  [/\bgender\b|\bpronouns?\b/i, 'gender'],
  [/\bveteran\b|protected\s*veteran/i, 'veteran.status'],
  [/\bdisabilit|\bdisabled\b|neurodiverg/i, 'disability.status'],
  [/\bethni|\brace\b|self-?identif/i, 'race.ethnicity'],
  [/your\s*(full\s*)?name|applicant\s*name|candidate\s*name|legal\s*name|\bfull\s*name\b|name\s+on\s+(resume|application|diploma)/i, 'full.name'],
  // absolute last resort: label is literally just "name"
  [/(^|\|\s*|:|\.|>)\s*name\s*(\*|:|\([^)]*\))?\s*(\||$)/i, 'full.name'],
];

/** Controls we must never touch, whatever the label says. */
export const NEVER_FILL = /captcha|recaptcha|password|passcode|otp|two[- ]?factor|csrf|authenticity|signature|credit ?card|ssn|social security|tax ?id|bank|account ?number|route ?number|routing/i;

/** Fields that exist but should be surfaced for a human decision, not typed. */
export const HUMAN_ONLY = /\bnewsletter\b|opt-?in|marketing|subscribe|consent to receive/i;

export const SELECTOR =
  'input:not([type=hidden]):not([type=file]):not([type=password]),textarea,select,[contenteditable="true"],[data-qa-field]';

const LABELISH = [
  'name',
  'id',
  'placeholder',
  'aria-label',
  'data-test',
  'data-test-id',
  'data-qa',
  'autocomplete',
  'fieldid',
  'title',
];

export function describeControl(el) {
  const bits = [];
  for (const attr of LABELISH) {
    const v = el.getAttribute && el.getAttribute(attr);
    if (v) bits.push(v);
  }
  if (el.labels) for (const l of el.labels) if (l.textContent) bits.push(l.textContent);
  const lab = el.closest && el.closest('label');
  if (lab) bits.push(lab.textContent);
  const fs = el.closest && el.closest('fieldset');
  if (fs) {
    const lg = fs.querySelector('legend');
    if (lg) bits.push(lg.textContent);
  }
  const group = el.closest && el.closest('[id*="field" i],[class*="field" i],[class*="form-group" i],[class*="FormItem" i],[class*="question" i]');
  if (group) {
    bits.push(group.getAttribute('id') || '');
    bits.push(typeof group.className === 'string' ? group.className : '');
    const legend = group.querySelector && group.querySelector('legend,label,th,.question,[class*="label" i]');
    if (legend) bits.push(legend.textContent);
  }
  const preceding = el.previousElementSibling;
  if (preceding && (preceding.tagName === 'LABEL' || preceding.tagName === 'SPAN')) bits.push(preceding.textContent);
  const legend = el.closest && el.closest('fieldset') ? el.closest('fieldset').querySelector('legend')?.textContent : '';
  if (legend) bits.push(legend);
  if (el.dataset && el.dataset.qaField) bits.push('data-qa-field:' + el.dataset.qaField);
  // label text that lives in a sibling or the wrapping row (very common: <input><span>Label</span>)
  const sib = el.nextElementSibling && /^(SPAN|LABEL|DIV|P|TH|TD)$/.test(el.nextElementSibling.tagName) ? el.nextElementSibling.textContent : '';
  if (sib) bits.push(sib);
  const joined = bits.filter(Boolean).join(' | ').replace(/\s+/g, ' ').trim();
  if (joined.replace(/[^a-z]/gi, '').length < 12) {
    const wrap = el.closest('div,li,tr,section,td') || el.parentElement;
    if (wrap && wrap.textContent) bits.push(wrap.textContent);
  }
  return bits.filter(Boolean).join(' | ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

export function mapKey(el) {
  if (el.dataset && el.dataset.qaField) {
    const forced = el.dataset.qaField;
    return { key: forced, source: 'data-qa-field', label: forced };
  }
  const label = describeControl(el);
  if (!label) return { key: null, source: null, label: '' };
  if (NEVER_FILL.test(label)) return { key: null, source: 'never-fill', label };
  if (HUMAN_ONLY.test(label)) return { key: null, source: 'human-only', label };
  for (const [rx, key] of PATTERNS) if (rx.test(label)) return { key, source: 'heuristic', label };
  return { key: null, source: 'unmapped', label };
}

const YES_WORDS = /^(yes|true|1|i do|i am|i agree|agree|yes,? i|no preference)\b/i;
const NO_WORDS = /^(no|none|not|prefer not|n\/a|0|false)\b/i;

export function boolValueFor(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (NO_WORDS.test(s)) return false;
  if (YES_WORDS.test(s)) return true;
  return null;
}

/** Pick the radio option whose text/value best matches the desired answer. */
export function pickRadio(group, want) {
  const wantBool = boolValueFor(want);
  const wanted = String(want || '').toLowerCase().trim();
  let best = null;
  let bestScore = 0;
  for (const input of group) {
    const text = `${input.value || ''} ${input.nextSibling && input.nextSibling.textContent ? input.nextSibling.textContent : ''} ${
      (input.labels && [...input.labels].map((l) => l.textContent).join(' ')) || ''
    } ${input.getAttribute('aria-label') || ''}`
      .toLowerCase()
      .trim();
    let score = 0;
    if (wanted && text === wanted) score = 100;
    else if (wanted && text.includes(wanted.slice(0, 24))) score = 80;
    else if (wanted && wanted.split(/[\s,]+/).some((w) => w.length > 2 && text.includes(w))) score = 45;
    if (wantBool === true && /^(yes|true|1|i do|i am|i agree)\b/.test(text)) score = Math.max(score, 70);
    if (wantBool === false && /^(no|none|not|prefer not)\b/.test(text)) score = Math.max(score, 70);
    if (score > bestScore) {
      bestScore = score;
      best = input;
    }
  }
  return best && bestScore >= 45 ? best : null;
}

/**
 * Choose a <select> option for a value. Exact match wins; otherwise the option
 * with the most whole-word token overlap (min 4 chars, so "in"/"on"/"us" from a
 * city string can't accidentally match "Bengaluru").
 */
export function pickOption(select, value) {
  const wanted = String(value).toLowerCase().trim();
  const opts = [...select.options].filter((o) => o.value !== '' || o.text);
  const exact = opts.find((o) => (o.value || '').toLowerCase() === wanted || o.text.trim().toLowerCase() === wanted);
  if (exact) return exact;
  const tokens = [...new Set(wanted.split(/[^a-z0-9+#]+/).filter((w) => w.length >= 4))];
  if (tokens.length) {
    let best = null;
    let bestHits = 0;
    for (const o of opts) {
      const hay = `${o.text} ${o.value}`.toLowerCase();
      const hits = tokens.filter((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(hay)).length;
      if (hits > bestHits) {
        bestHits = hits;
        best = o;
      }
    }
    if (best) return best;
  }
  const prefix = opts.find((o) => `${o.text} ${o.value}`.toLowerCase().includes(wanted.slice(0, 12)));
  return prefix || null;
}

/** Rich-text editor boxes some ATSs use for cover letters. */
export function isEditableControl(el) {
  if (!el || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return false;
  if (el.isContentEditable === true) return true;
  const attr = el.getAttribute && el.getAttribute('contenteditable');
  if (attr == null) return false;
  return attr === '' || /^(true|plaintext-only|paragraphs)$/i.test(attr);
}

/** True when a control looks already answered (we don't overwrite by default). */
export function isFilled(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  if (isEditableControl(el)) return (el.textContent || '').trim().length > 0;
  return String(el.value ?? '').trim().length > 0;
}
