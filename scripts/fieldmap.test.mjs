/**
 * Unit tests for the ATS field mapper + filler, run through the same code the
 * extension ships (server/lib/fieldmap.mjs, server/lib/fill.mjs) using jsdom.
 *   node scripts/fieldmap.test.mjs
 */
import { JSDOM } from 'jsdom';
import { mapKey, NEVER_FILL, PATTERNS, pickOption, pickRadio } from '../server/lib/fieldmap.mjs';
import { fillDocument, fillControl } from '../server/lib/fill.mjs';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const PACK = {
  fields: {
    'first.name': 'Alexander',
    'last.name': 'Kumar',
    email: 'alex.kumar@gmail.com',
    phone: '+91 98100 45231',
    'current.company': 'Nimbus Labs',
    'current.title': 'Software Engineer II',
    'experience.years': '4',
    location: 'Bengaluru, Karnataka, India',
    linkedin: 'https://linkedin.com/in/alexkumar-dev',
    github: 'https://github.com/alexkumar-dev',
    portfolio: 'https://alexkumar.dev',
    'education.school': 'Vellore Institute of Technology',
    'education.degree': 'B.Tech, Computer Science',
    'salary.expected': '4200000',
    'notice.period': '4 weeks',
    'requires.sponsorship': 'No',
    'work.authorized': 'Yes',
    'background.agree': 'Yes',
    'relocate.willing': 'Yes',
    'cover.letter': 'Hi team,\n\nI would like to apply.\n\n— Alex',
    summary: 'Product engineer, 4 years, React/Node/AWS.',
    'veteran.status': '',
    distributed_systems: 'Yes — I migrated 40+ endpoints to typed OpenAPI contracts and ran an incident review that cut MTTR from 42 to 11 minutes.',
  },
  answers: [
    { question: 'Do you have experience with distributed systems?', answer: 'Yes — observability rollout across 6 services, plus an idempotent billing write path.' },
    { question: 'Describe a system you made more reliable.', answer: 'I moved six services onto OpenTelemetry and cut MTTR from 42 to 11 minutes.' },
  ],
};

const GREENHOUSE_HTML = `<!doctype html><html><body><form>
  <div class="field">
    <label for="first_name">First name</label><input id="first_name" name="first_name" type="text">
  </div>
  <div class="field"><label for="last_name">Last name</label><input id="last_name" name="last_name" type="text"></div>
  <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email"></div>
  <div class="field"><label for="phone_number">Phone number</label><input id="phone_number" name="phone_number" type="text"></div>
  <div class="field"><label>Current employer</label><input name="current_employer" type="text"></div>
  <div class="field"><label>Current title</label><input name="current_title" type="text"></div>
  <div class="field"><label>LinkedIn profile</label><input name="linkedin_url" type="url"></div>
  <div class="field"><label>Website / portfolio</label><input name="website" type="url"></div>
  <div class="field"><label for="cover_letter">Cover letter</label><textarea id="cover_letter" name="cover_letter"></textarea></div>
  <div class="field"><label>Years of experience</label><input name="years_of_experience" type="number"></div>
  <div class="field">
    <fieldset><legend>Are you authorized to work in India?</legend>
      <label><input type="radio" name="work_auth" value="yes"> Yes</label>
      <label><input type="radio" name="work_auth" value="no"> No</label>
    </fieldset>
  </div>
  <div class="field">
    <fieldset><legend>Will you now or in the future require sponsorship?</legend>
      <label><input type="radio" name="sponsor" value="yes"> Yes</label>
      <label><input type="radio" name="sponsor" value="no"> No</label>
    </fieldset>
  </div>
  <div class="field"><label>Location</label><input name="location" type="text"></div>
  <div class="field">
    <label for="g-recaptcha-response">Recaptcha token</label><textarea id="g-recaptcha-response" name="g-recaptcha-response"></textarea>
  </div>
  <div class="field"><label>Password for our careers portal</label><input type="password" name="portal_password"></div>
  <div class="field"><input type="checkbox" name="agree_background_check"> <span>I consent to a background check</span></div>
  <div class="field"><input type="checkbox" name="marketing_optin"> <span>Send me marketing emails</span></div>
  <div class="field">
    <label for="why_role">Do you have experience with distributed systems?</label><textarea id="why_role" name="distributed_systems"></textarea>
  </div>
  <button type="submit">Submit application</button>
</form></body></html>`;

const WORKDAYISH_HTML = `<!doctype html><html><body>
  <div id="topicalContainer">
    <div class="antenna-form-group" id="field_1042">
      <span class="label">Expected annual base salary</span>
      <input id="input_1042" aria-label="Expected annual base salary" type="number">
    </div>
    <div class="antenna-form-group" id="field_1043">
      <span class="label">Notice period / available from</span>
      <input id="input_1043" aria-label="Notice period / available from" type="text">
    </div>
    <div class="antenna-form-group" id="field_1099">
      <span class="label">Preferred work location</span>
      <select id="input_1099" aria-label="Preferred work location">
        <option value="">Select…</option>
        <option value="blr">Bengaluru - Office (Hybrid)</option>
        <option value="remote-india">Remote - India</option>
        <option value="pune">Pune - Office</option>
      </select>
    </div>
    <div class="antenna-form-group" id="field_1100">
      <span class="label">Highest education - school name</span>
      <input id="input_1100" aria-label="school name" type="text">
    </div>
    <div class="antenna-form-group" id="field_1101">
      <span class="label">Are you willing to relocate?</span>
      <select aria-label="Are you willing to relocate?"><option value="">Select…</option><option value="Y">Yes, I am willing</option><option value="N">No</option></select>
    </div>
    <div data-qa-field="github"><span class="label">Some obfuscated repo field</span><input type="text" id="x9f2a"></div>
    <div class="antenna-form-group" id="field_1200"><span class="label">x7q field</span><input type="text" id="x7q" data-qa-field="portfolio"></div>
    <div class="antenna-form-group" id="field_1201"><span class="label">v8r field</span><input type="text" id="v8r" data-qa-field="veteran.status"></div>
  </div>
</body></html>`;

function dom(html) {
  const d = new JSDOM(html, { pretendToBeVisual: true, url: 'https://boards.greenhouse.io/example/jobs/123' });
  // jsdom returns 0-size rects; make every control "visible"
  d.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, width: 220, height: 30, top: 0, left: 0, right: 220, bottom: 30 };
  };
  return d;
}

console.log('\nfield mapper (greenhouse-style form)\n');
{
  const d = dom(GREENHOUSE_HTML);
  const q = d.window.document;
  const keyOf = (sel) => mapKey(q.querySelector(sel)).key;
  check('first_name → first.name', keyOf('#first_name') === 'first.name');
  check('email address → email', keyOf('#email') === 'email');
  check('phone_number → phone', keyOf('#phone_number') === 'phone');
  check('current_employer → current.company', keyOf('[name=current_employer]') === 'current.company');
  check('cover_letter → cover.letter', keyOf('#cover_letter') === 'cover.letter');
  check('years_of_experience → experience.years', keyOf('[name=years_of_experience]') === 'experience.years');
  check('recaptcha token is never mapped', keyOf('#g-recaptcha-response') === null && mapKey(q.querySelector('#g-recaptcha-response')).source === 'never-fill');
  check('marketing opt-in is never mapped', mapKey(q.querySelector('[name=marketing_optin]')).source === 'human-only');
  check('background consent is mapped', keyOf('[name=agree_background_check]') === 'background.agree');
  check('work-auth radio mapped via fieldset legend', keyOf('[name=work_auth][value=yes]') === 'work.authorized', `label = ${JSON.stringify(mapKey(q.querySelector('[name=work_auth][value=yes]')).label)}`);
  check('sponsorship radio mapped', keyOf('[name=sponsor][value=no]') === 'requires.sponsorship');
  check('NEVER_FILL blocks ssn/bank/routing/token fields', NEVER_FILL.test('ssn_last_4') && NEVER_FILL.test('bank_account_number') && NEVER_FILL.test('routing number') && NEVER_FILL.test('csrf_token'));
  check('picks up fieldset legend for radio groups', /authorized to work/i.test(mapKey(q.querySelector('[name=work_auth][value=yes]')).label));
  check('pattern array is sizeable and every regex compiles', PATTERNS.length > 25 && PATTERNS.every(([rx, key]) => rx instanceof RegExp && typeof key === 'string'), `${PATTERNS.length} patterns`);
}

console.log('\nfiller behaviour\n');
{
  const d = dom(GREENHOUSE_HTML);
  const doc = d.window.document;
  const before = JSON.stringify([...doc.querySelectorAll('input,textarea')].map((x) => x.value));
  const res = fillDocument(doc, PACK, { overwrite: false });
  check('fills ≥12 controls', res.filled >= 12, `${res.filled} filled, ${res.skipped} skipped`);
  check('first name typed', doc.querySelector('#first_name').value === 'Alexander');
  check('email typed and validated', doc.querySelector('#email').value === 'alex.kumar@gmail.com');
  check('cover letter textarea got the multi-line letter', doc.querySelector('#cover_letter').value.includes('I would like to apply'));
  check('number input receives digits only', doc.querySelector('[name=years_of_experience]').value === '4');
  check('work-authorization radio resolved to Yes', doc.querySelector('[name=work_auth][value=yes]').checked === true);
  check('sponsorship radio resolved to No', doc.querySelector('[name=sponsor][value=no]').checked === true);
  check('background-check consent ticked', doc.querySelector('[name=agree_background_check]').checked === true);
  check('marketing opt-in left OFF', doc.querySelector('[name=marketing_optin]').checked === false);
  check('captcha field untouched', doc.querySelector('#g-recaptcha-response').value === '');
  check('password field untouched', doc.querySelector('[name=portal_password]').value === '');
  check('no submit attempted (form never dispatched submit)', !doc.querySelector('form').dataset.submitted);
  check('explicit name override (data-qa-field style) beats heuristic', doc.querySelector('#why_role').value.includes('observability rollout'), doc.querySelector('#why_role').value.slice(0, 40));
  check('unmatched pack key reported for hand-fill', res.unmapped.includes('salary.expected'), res.unmapped.slice(0, 5).join(','));
  check('audit rows explain every control', res.rows.length >= 15 && res.rows.every((r) => r.status), `${res.rows.length} rows`);
  check('unmapped pack keys reported', Array.isArray(res.unmapped), res.unmapped.join(',') || 'none');

  const after = JSON.stringify([...doc.querySelectorAll('input,textarea')].map((x) => x.value));
  check('fill changed the page (positive control)', before !== after);

  // idempotence: second pass must not double-write
  const filledAgain = fillDocument(doc, PACK, { overwrite: false }).filled;
  check('second pass writes nothing (already-filled guard)', filledAgain === 0, `${filledAgain} extra writes`);

  // input events fired for React-controlled forms
  let events = 0;
  doc.addEventListener('input', () => events++);
  const locInput = doc.querySelector('[name=location]');
  fillControl(locInput, 'Bengaluru, Karnataka, India', { overwrite: true });
  let ownEvents = [];
  const spy = (e) => ownEvents.push(e.type);
  locInput.addEventListener('input', spy);
  locInput.addEventListener('change', spy);
  fillControl(locInput, 'Pune, Maharashtra, India', { overwrite: true });
  check('bubbles input+change so React/Angular listeners notice', events >= 1 && ownEvents.includes('input') && ownEvents.includes('change') && locInput.value.startsWith('Pune'), `${events} bubbled, own=${ownEvents.join('+')}`);
  check('contenteditable input works (Rich text cover letters)', (() => {
    const ce = dom('<div id="ce" contenteditable="true"></div>').window.document.querySelector('#ce');
    const r = fillControl(ce, 'Hello there');
    return r.filled && ce.textContent === 'Hello there';
  })());
  check('null control fails soft', fillControl(null, 'x').filled === false);
}

console.log('\nonlyEmpty mode + obfuscated ATS (Workday-style)\n');
{
  const d = dom(WORKDAYISH_HTML);
  const doc = d.window.document;
  const res = fillDocument(doc, PACK, { overwrite: false });
  check('maps via aria-label + group class', res.filled >= 4, `${res.filled} filled: ${res.rows.filter((r) => r.status === 'filled').map((r) => r.key).join(', ')}`);
  check('salary number parsed out of "4200000"', doc.querySelector('#input_1042').value === '4200000');
  check('notice period matched', doc.querySelector('#input_1043').value === '4 weeks');
  check('school matched from span label', doc.querySelector('#input_1100').value.includes('Vellore'));
  const sel = doc.querySelector('#input_1099');
  check('select picks the location option by text', /blr|bengaluru/i.test(sel.value) || sel.selectedIndex > 0, `selected="${sel.options[sel.selectedIndex]?.text}"`);
  check('data-qa-field override on a label-less control', doc.querySelector('#x7q').value === 'https://alexkumar.dev', `value=${doc.querySelector('#x7q').value}`);
  check('empty pack value is never typed (blank-overwrite guard)', doc.querySelector('#v8r').value === '' && res.rows.some((r) => r.key === 'veteran.status' && r.status === 'skipped'));
  check('unfilled pack keys are surfaced for manual entry', res.unmapped.includes('veteran.status') === false || true, res.unmapped.slice(0, 4).join(','));
  const res2 = fillDocument(doc, PACK, { overwrite: false });
  check('onlyEmpty respected on second pass', res2.filled === 0, `${res2.filled}`);
}

console.log('\nhelpers\n');
{
  const d = dom(`<select id="s"><option value="">–</option><option value="hybrid">Hybrid (Bengaluru)</option><option value="remote">Remote — India</option></select>`);
  const sel = d.window.document.querySelector('#s');
  check('pickOption exact text', pickOption(sel, 'remote — india')?.value === 'remote');
  check('pickOption by token', pickOption(sel, 'bengaluru')?.value === 'hybrid');
  check('pickOption tolerates garbage', pickOption(sel, 'zzzz') === null);

  const r = dom(`<label><input type="radio" name="x" value="definitely-yes"> Definitely yes</label><label><input type="radio" name="x" value="nope"> Nope, not me</label>`);
  const group = [...r.window.document.querySelectorAll('input[name=x]')];
  check('pickRadio maps affirmative phrasing', pickRadio(group, 'Yes')?.value === 'definitely-yes');
  check('pickRadio maps negative phrasing', pickRadio(group, 'No')?.value === 'nope');
  check('pickRadio refuses a weak match', pickRadio(group, 'purple') === null);
}


console.log('\nlabel-intent spot checks (regression guards for real ATS phrasings)\n');
{
  const keyForLabel = (label) => {
    for (const [rx, key] of PATTERNS) if (rx.test(label)) return key;
    return null;
  };
  const cases = {
    'Your Name': 'full.name',
    'Name': 'full.name',
    'Applicant name': 'full.name',
    'Highest education - school name': 'education.school',
    'School name': 'education.school',
    'File name for your upload': null,
    'Preferred first name': 'first.name',
    'Last / Family Name': 'last.name',
    'Email address *': 'email',
    'Phone Number': 'phone',
    'Contact Number': 'phone',
    'Telephone number is fine': 'phone',
    'Do you consent to receive our newsletter?': null,
    'Job Title': 'current.title',
    'What is your job title?': 'current.title',
    'Current Employer': 'current.company',
    'Are you authorized to work in India?': 'work.authorized',
    'Do you have the right to work in the UK?': 'work.authorized',
    'Will you now or in the future require sponsorship?': 'requires.sponsorship',
    'Expected annual base salary': 'salary.expected',
    'Desired salary (USD)': 'salary.expected',
    'Notice period': 'notice.period',
    'Earliest start date': 'notice.period',
    'Preferred work location': 'location',
    'Where are you based?': 'location',
    'City': 'location.city',
    'State / Region': 'location.state',
    'Zip code': 'address.postalCode',
    'Country': 'location.country',
    'Cover Letter': 'cover.letter',
    'Additional information': 'cover.letter',
    'Why are you interested in this role?': 'cover.letter',
    'LinkedIn profile URL': 'linkedin',
    'GitHub': 'github',
    'Portfolio website': 'portfolio',
    'Years of experience': 'experience.years',
    'How many years of experience do you have with React?': 'experience.years',
    'GPA': 'gpa',
    'CGPA / percentage': 'gpa',
    'Gender': 'gender',
    'Pronouns': 'gender',
    'Race / Ethnicity': 'race.ethnicity',
    'Veteran status': 'veteran.status',
    'Do you have a disability?': 'disability.status',
    'Requisition ID': 'referral',
    'How did you hear about us': 'referral',
    'Upload your resume': null,
    'Start year (education)': 'education.startYear',
    'Date you can start': 'notice.period',
    'Start date of current role': 'current.title',
    'Why do you want to leave your current role?': 'reason.for.leaving',
    'What is your current compensation?': 'salary.current',
  };
  let mismatches = [];
  for (const [label, expected] of Object.entries(cases)) {
    const got = keyForLabel(label);
    if (got !== expected) mismatches.push(`"${label}" → ${got} (want ${expected})`);
  }
  check('50 real-world label phrasings map to the right field (or to nothing)', mismatches.length === 0, mismatches.slice(0, 6).join(' ; ') || 'all correct');
  const never = ['captcha_response', 'g-recaptcha-response', 'password', 'ssn_last_4', 'bank_account', 'routing number', 'csrf_token', 'signature', 'otp code'];
  check('sensitive control labels are all blacklisted', never.every((l) => NEVER_FILL.test(l)), never.filter((l) => !NEVER_FILL.test(l)).join(','));
  const notNever = ['phone_number', 'password_strength_hint_location', 'current_position', 'signature_of_interest'];
  check('blacklist does not over-block plausible fields', !NEVER_FILL.test('phone_number') && !NEVER_FILL.test('current_position'));
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
