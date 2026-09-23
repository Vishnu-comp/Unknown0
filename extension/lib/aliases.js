/* AutoFill Pro - profile field schema + label->field matching.
   Pure logic: testable from Node, shared by the content engine and the
   "matcher tester" on the options page. */
'use strict';

var AFX = (typeof globalThis !== 'undefined' ? globalThis : window).AFX || {};
AFX.aliases = (function () {

  var normalize = (AFX.utils && AFX.utils.normalize) || function (s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[_\-./\\|,:;!?(){}\[\]"'`*+&#@%^$~=<>]+/g, ' ').replace(/\s+/g, ' ').trim();
  };

  /**
   * Each field: {
   *   key      - profile key
   *   label    - human name (UI)
   *   type     - hint for the UI + filler (text|email|tel|url|date|number|longtext|select|yesno|csv)
   *   aliases  - phrases that identify the field on a form (longer = more specific)
   *   notIf    - if the question contains any of these words, do NOT match
   * }
   * Order matters as a tie-break: more specific fields first.
   */
  var FIELDS = [
    { key: 'fullName', label: 'Full name', type: 'text',
      aliases: ['full name', 'complete name', 'candidate name', 'applicant name', 'your name', 'name'] },

    { key: 'firstName', label: 'First name', type: 'text',
      aliases: ['first name', 'firstname', 'given name', 'legal first name', 'forename', 'fname', 'first'] },

    { key: 'middleName', label: 'Middle name', type: 'text',
      aliases: ['middle name', 'middlename', 'middle initial', 'middle'] },

    { key: 'lastName', label: 'Last name', type: 'text',
      aliases: ['last name', 'lastname', 'family name', 'legal last name', 'surname', 'lname', 'last'] },

    { key: 'email', label: 'Email', type: 'email',
      aliases: ['email address', 'e mail', 'email id', 'mail id', 'personal email', 'work email', 'primary email', 'official email', 'email', 'mail'] },

    { key: 'alternateEmail', label: 'Alternate email', type: 'email',
      aliases: ['alternate email', 'secondary email', 'other email', 'second email'] },

    { key: 'phone', label: 'Phone', type: 'tel',
      aliases: ['phone number', 'mobile number', 'contact number', 'telephone number', 'mobile no', 'phone no', 'contact no', 'whatsapp number', 'whatsapp', 'cell phone', 'cell number', 'mobile phone', 'mobile', 'phone', 'telephone', 'cell', 'contact'] },

    { key: 'alternatePhone', label: 'Alternate phone', type: 'tel',
      aliases: ['alternate phone', 'alternate mobile', 'secondary phone', 'other phone', 'home phone', 'landline'] },

    { key: 'dob', label: 'Date of birth', type: 'date',
      aliases: ['date of birth', 'birth date', 'birthdate', 'birthday', 'born on', 'dob', 'birth day'] },

    { key: 'gender', label: 'Gender', type: 'select',
      aliases: ['gender', 'sex'], },

    { key: 'nationality', label: 'Nationality', type: 'text',
      aliases: ['nationality', 'citizenship', 'country of citizenship', 'citizen of', 'citizen'] },

    { key: 'address1', label: 'Address line 1', type: 'text',
      aliases: ['address line 1', 'address line one', 'street address', 'address line', 'residential address', 'current address', 'present address', 'permanent address', 'home address', 'address 1', 'address1', 'street', 'address'] },

    { key: 'address2', label: 'Address line 2', type: 'text',
      aliases: ['address line 2', 'address line two', 'address 2', 'address2', 'apartment', 'suite', 'landmark', 'line 2', 'apt'] },

    { key: 'city', label: 'City', type: 'text',
      aliases: ['current city', 'present city', 'city town', 'city', 'town'] },

    { key: 'state', label: 'State / Province', type: 'text',
      aliases: ['state province', 'province', 'state'] },

    { key: 'zip', label: 'ZIP / Postal code', type: 'text',
      aliases: ['zip code', 'postal code', 'pin code', 'pincode', 'post code', 'postcode', 'zip', 'postal', 'pin'] },

    { key: 'country', label: 'Country', type: 'text',
      aliases: ['country of residence', 'country living', 'country', 'nation'],
      notIf: ['code', 'phone', 'dial', 'isd', 'calling'] },

    { key: 'linkedin', label: 'LinkedIn URL', type: 'url',
      aliases: ['linkedin profile', 'linkedin url', 'linkedin link', 'linked in', 'linkedin', 'li profile'] },

    { key: 'github', label: 'GitHub URL', type: 'url',
      aliases: ['github profile', 'github url', 'git hub', 'github', 'git'] },

    { key: 'portfolio', label: 'Portfolio / Website', type: 'url',
      aliases: ['portfolio url', 'portfolio link', 'personal site', 'personal website', 'personal webpage', 'personal page', 'web site', 'website url', 'homepage', 'home page', 'portfolio', 'blog url', 'website', 'webpage', 'blog', 'url', 'website link'] },

    { key: 'twitter', label: 'Twitter / X URL', type: 'url',
      aliases: ['twitter handle', 'twitter profile', 'twitter url', 'twitter link', 'x profile', 'x handle', 'twitter'] },

    { key: 'currentCompany', label: 'Current / last company', type: 'text',
      aliases: ['current company', 'present employer', 'current employer', 'current organization', 'current organisation', 'most recent company', 'latest company', 'recent employer', 'recent company', 'last employer', 'employer name', 'company name', 'organization name', 'organisation name', 'current workplace', 'company', 'employer', 'organization', 'organisation', 'workplace'] },

    { key: 'currentTitle', label: 'Current / last title', type: 'text',
      aliases: ['current title', 'present designation', 'current designation', 'current role', 'current position', 'current job title', 'most recent title', 'latest designation', 'recent designation', 'job title', 'job designation', 'job role', 'position title', 'role title', 'designation', 'title', 'role', 'position'],
      notIf: ['mr', 'mrs', 'ms', 'salutation', 'prefix', 'name prefix', 'movie', 'book', 'page'] },

    { key: 'yearsExperience', label: 'Total experience (years)', type: 'number',
      aliases: ['years of experience', 'total experience years', 'total experience', 'experience in years', 'work experience years', 'work experience in years', 'yrs of experience', 'years experience', 'experience years', 'exp years', 'exp year', 'years of work experience', 'experience', 'yoe', 'years', 'experience in it years'],
      notIf: ['month', 'current company', 'present company', 'this company', 'project', 'field', 'gap'] },

    { key: 'monthsExperience', label: 'Experience (months)', type: 'number',
      aliases: ['months of experience', 'experience months', 'exp months', 'months of work experience', 'experience', 'months'],
      notIf: ['year', 'current company', 'present company', 'this company', 'notice', 'probation'] },

    { key: 'currentCTC', label: 'Current CTC / Salary', type: 'text',
      aliases: ['current ctc', 'present ctc', 'current salary', 'present salary', 'last drawn salary', 'last salary', 'current package', 'current compensation', 'current pay', 'current wage', 'ctc lakhs', 'ctc per annum', 'salary per annum', 'annual salary', 'annual ctc', 'ctc', 'salary'],
      notIf: ['expected', 'desired', 'expectation', 'demand', 'want'] },

    { key: 'expectedCTC', label: 'Expected CTC / Salary', type: 'text',
      aliases: ['expected ctc', 'expected salary', 'expected compensation', 'expected package', 'expected pay', 'expected wage', 'desired salary', 'desired compensation', 'desired pay', 'salary expectation', 'compensation expectation', 'salary expected', 'ctc expected', 'expected', 'expectation'] },

    { key: 'noticePeriod', label: 'Notice period (days)', type: 'text',
      aliases: ['notice period days', 'notice period in days', 'notice period', 'serving notice', 'notice time', 'np days', 'np period', 'notice', 'available to join', 'available from', 'when can you join', 'when can you start', 'joining availability', 'how soon can you start', 'start date availability'] },

    { key: 'summary', label: 'Summary / About you', type: 'longtext',
      aliases: ['profile summary', 'career objective', 'brief introduction', 'cover note', 'cover letter', 'about you', 'about yourself', 'about me', 'introduce yourself', 'tell us about yourself', 'tell me about yourself', 'summary', 'objective', 'introduction'] },

    { key: 'highestEducation', label: 'Highest education', type: 'text',
      aliases: ['highest education', 'highest qualification', 'education level', 'qualification level', 'highest degree', 'highest academic', 'education qualification'] },

    { key: 'degree', label: 'Degree', type: 'text',
      aliases: ['ug degree', 'pg degree', 'graduation degree', 'undergraduate degree', 'postgraduate degree', 'degree name', 'degree obtained', 'degree completed', 'degree major', 'course name', 'program name', 'qualification name', 'degree', 'graduation', 'programme', 'program', 'course'] },

    { key: 'major', label: 'Major / Specialization', type: 'text',
      aliases: ['field of study', 'area of study', 'specialisation', 'specialization', 'major subject', 'academic stream', 'discipline', 'stream', 'concentration', 'branch', 'major'] },

    { key: 'university', label: 'University / College', type: 'text',
      aliases: ['university name', 'college name', 'institution name', 'school name', 'alma mater', 'institute name', 'university', 'college', 'institution', 'institute', 'academy', 'school'] },

    { key: 'gpa', label: 'GPA / Percentage', type: 'text',
      aliases: ['cgpa', 'percentage', 'grade point', 'aggregate', 'marks percentage', 'gpa', 'grade', 'marks', 'percent', 'score'] },

    { key: 'graduationYear', label: 'Graduation year', type: 'text',
      aliases: ['year of graduation', 'year of passing', 'year of completion', 'year completed', 'graduation year', 'graduation date', 'grad year', 'completion year', 'passing year', 'yop', 'year of passing'] },

    { key: 'skills', label: 'Skills', type: 'csv',
      aliases: ['key skills', 'technical skills', 'top skills', 'core skills', 'skill set', 'skillset', 'technologies', 'competencies', 'skills'] },

    { key: 'languages', label: 'Languages', type: 'csv',
      aliases: ['languages known', 'known languages', 'languages spoken', 'language known', 'languages', 'language'] },

    { key: 'workAuthorization', label: 'Work authorization', type: 'yesno',
      aliases: ['work authorization', 'work authorisation', 'legally authorized', 'legally authorised', 'authorized to work', 'authorised to work', 'legally eligible', 'eligible to work', 'right to work', 'work permit', 'visa status', 'work eligibility', 'authorization status', 'sponsorship', 'permitted to work'] },

    { key: 'willingToRelocate', label: 'Willing to relocate', type: 'yesno',
      aliases: ['willing to relocate', 'open to relocation', 'ready to relocate', 'willingness to relocate', 'relocation', 'relocate'] },

    { key: 'gender', label: 'Gender', type: 'select', aliases: [] } // placeholder removed below
  ];

  // remove accidental placeholder entry
  FIELDS = FIELDS.filter(function (f) { return f.aliases.length > 0; });

  var BLOCK_LABEL_RE = /(password|passwd|captcha|recaptcha|one[- ]time|otp|verification code|verify code|security code|security question|cvv|cvc|card number|cardno|credit card|debit card|routing|iban|account number|swift|ssn|social security|\bsin\b|tax id|\bein\b|secret)/i;

  var fieldBy = {};
  FIELDS.forEach(function (f) {
    f.aliases = f.aliases.slice().sort(function (a, b) { return b.length - a.length; });
    fieldBy[f.key] = f;
  });

  function wordBoundaryIndex(hay, needle) {
    var idx = hay.indexOf(needle);
    while (idx >= 0) {
      var before = idx === 0 ? ' ' : hay.charAt(idx - 1);
      var after = idx + needle.length >= hay.length ? ' ' : hay.charAt(idx + needle.length);
      if (before === ' ' && after === ' ') return idx;
      idx = hay.indexOf(needle, idx + 1);
    }
    return -1;
  }

  /**
   * Match a form question / label to a profile field.
   * Returns { key, score } or null.
   */
  function matchField(labelText) {
    var raw = String(labelText == null ? '' : labelText).split('|')[0]; // first label variant is strongest
    if (BLOCK_LABEL_RE.test(raw)) return null;
    var label = normalize(raw);
    if (!label) return null;

    var best = null;

    FIELDS.forEach(function (f, order) {
      if (f.notIf && f.notIf.some(function (w) { return label.indexOf(normalize(w)) >= 0; })) return;

      for (var i = 0; i < f.aliases.length; i++) {
        var alias = normalize(f.aliases[i]);
        if (!alias) continue;
        var score = 0;

        if (label === alias) {
          score = 10000 + alias.length;
        } else if (wordBoundaryIndex(label, alias) >= 0) {
          // label contains the alias as a phrase -> more specific (longer) aliases win
          score = 5000 + alias.length * 10 - (label.length - alias.length);
        } else if (wordBoundaryIndex(alias, label) >= 0 && label.length >= 3) {
          // alias contains the label (label is an abbreviation like "name", "ctc")
          score = 2000 + label.length * 10;
        } else {
          // token overlap: every significant token of the shorter side must appear.
          // Generic question-words are ignored ("how did you hear about us").
          var STOP = { about: 1, you: 1, your: 1, me: 1, us: 1, our: 1, the: 1, and: 1, for: 1, with: 1, from: 1, that: 1, this: 1, have: 1, has: 1, what: 1, when: 1, where: 1, how: 1, does: 1, did: 1, are: 1, is: 1, please: 1, enter: 1, provide: 1, select: 1, choose: 1, per: 1, any: 1, all: 1, your: 1 };
          var at = alias.split(' ').filter(function (t) { return t.length > 2 && !STOP[t]; });
          var lt = label.split(' ').filter(function (t) { return t.length > 2 && !STOP[t]; });
          if (at.length && lt.length) {
            var hit = at.filter(function (t) { return lt.indexOf(t) >= 0; }).length;
            if (hit && hit === Math.min(at.length, lt.length)) {
              score = (hit / Math.max(at.length, lt.length)) * 800;
            }
          }
        }

        if (score > 0) {
          // earlier fields win ties (they are the more specific ones)
          var candidate = { key: f.key, score: score - order * 0.01 };
          if (!best || candidate.score > best.score) best = candidate;
        }
      }
    });

    return best;
  }

  /** Fallback: user-saved keyword -> answer pairs for site-specific questions. */
  function matchCustomAnswer(customAnswers, labelText) {
    var label = normalize(labelText);
    if (!label || !Array.isArray(customAnswers)) return null;
    for (var i = 0; i < customAnswers.length; i++) {
      var row = customAnswers[i] || {};
      var kws = String(row.keywords || '').toLowerCase().split(',').map(function (k) { return k.trim(); }).filter(Boolean);
      for (var k = 0; k < kws.length; k++) {
        if (kws[k] && label.indexOf(normalize(kws[k])) >= 0) return String(row.answer == null ? '' : row.answer);
      }
    }
    return null;
  }

  return {
    FIELDS: FIELDS,
    fieldBy: fieldBy,
    matchField: matchField,
    matchCustomAnswer: matchCustomAnswer
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AFX.aliases;
}
