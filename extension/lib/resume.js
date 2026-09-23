/* AutoFill Pro - resume parser: free text (extracted from PDF/TXT) -> profile
   fields. Pure JS, testable from Node. Tuned for tech resumes (1-2 page,
   single column, common section headers).

   Returns { profile, filledKeys, missing } - `missing` lists the important
   fields a resume rarely contains, which the UI then asks the user for. */
'use strict';

var AFX = (typeof globalThis !== 'undefined' ? globalThis : window).AFX || {};
AFX.resume = (function () {

  var EMAIL_RE = /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/;
  var URL_RE = new RegExp(
    '(?:https?:\\/\\/|www\\.)[^\\s,;|()[\\]]+' +
    '|linkedin\\.com\\/(?:in|pub)\\/[^\\s,;|()[\\]]+' +
    '|github\\.com\\/[^\\s,;|()[\\]]+' +
    '|\\b[\\w-]+\\.(?:com|in|dev|io|ai|net|org|co|me|tech|app|edu|info|blog|xyz|online|site)(?:\\/[^\\s,;|()[\\]]*)?',
    'i');

  var SECTION_RE = new RegExp(
    '^\\s*(summary|objective|profile|about(?:\\s+me)?|career\\s+objective|' +
    'skills|technical\\s+skills|technologies|tech\\s+stack|core\\s+competenc\\w*|' +
    'experience|work\\s+experience|professional\\s+experience|employment(?:\\s+history)?|internships?|' +
    'education|academics|academic\\s+details|qualifications?|' +
    'projects?|certifications?|achievements?|awards|activities|interests|hobbies|' +
    'languages|personal(?:\\s+details?)?|declaration)\\s*[:\\-–—]?\\s*$', 'i');

  var MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
  var DATE_TOKEN = '(?:' + MONTH + '[\\s\\-\\/]*\'?\\d{2,4}|\\d{1,2}[\\s\\-\\/]\'?\\d{2,4}|\\d{4}|\\d{1,2}[\\s\\-\\/]' + MONTH + '[\\s\\-\\/]\'?\\d{2,4})';
  var DATE_RANGE_RE = new RegExp('(' + DATE_TOKEN + ')\\s*(?:\\-|\\u2013|\\u2014|to|till|until)\\s*(' + DATE_TOKEN + '|present|current|now|ongoing)', 'i');

  var ROLE_RE = /\b(sde[\s-]?\d|software\s+(engineer|developer|development\s+engineer)|software\s+development\s+engineer|full[\s-]?stack\s+developer|front[\s-]?end\s+developer|back[\s-]?end\s+developer|web\s+developer|developer|engineer|analyst|consultant|intern|trainee|associate|architect|manager)\b/i;

  var DEGREE_MAP = [
    [/\bb\.?\s?tech(?:nology)?\b/i, 'B.Tech'],
    [/\bb\.?\s?e\b|\bbachelor\s+of\s+engineering\b/i, 'B.E.'],
    [/\bb\.?\s?sc(?:ience)?\b|\bbachelor\s+of\s+science\b/i, 'B.Sc'],
    [/\bbca\b/i, 'BCA'], [/\bbba\b/i, 'BBA'],
    [/\bm\.?\s?tech(?:nology)?\b/i, 'M.Tech'],
    [/\bm\.?\s?e\b|\bmaster\s+of\s+engineering\b/i, 'M.E.'],
    [/\bm\.?\s?sc(?:ience)?\b|\bmaster\s+of\s+science\b/i, 'M.Sc'],
    [/\bmca\b/i, 'MCA'], [/\bmba\b/i, 'MBA'],
    [/\bph\.?\s?d\b/i, 'Ph.D'], [/\bdiploma\b/i, 'Diploma']
  ];

  var MAJOR_RE = /\b(computer\s+science(?:\s*(?:and|&)\s*engineering)?|information\s+(science(?:\s*(?:and|&)\s*engineering)?|technology)|electronic\w*(?:\s*(?:and|&)\s*communication\w*)?|electrical(?:\s*(?:and|&)\s*electronics\w*)?|mechanical|civil|chemical|biotech\w*|data\s+science|machine\s+learning|artificial\s+intelligence|it)\b/i;

  var COLLEGE_RE = /\b([\w.&'\- ]{2,60}?\s+(college|institute|university|academy|vidyapeeth|iit|nit|iiit)\b[\w.&'\- ]{0,30})/i;

  var PROGRAMMING_WORDS = /^(java|python|c\+\+|c#|javascript|typescript|react|angular|vue|node|express|spring|springboot|spring boot|django|flask|html|css|sql|mysql|postgres\w*|mongodb|redis|aws|azure|gcp|docker|kubernetes|k8s|git|github|linux|bash|shell|linux|go|golang|rust|swift|kotlin|scala|ruby|rails|php|laravel|jquery|bootstrap|tailwind|next\.?js|nuxt|redux|graphql|rest|api|selenium|jest|junit|ml|nlp|pandas|numpy|tensorflow|pytorch|powerbi|excel|figma|jira|agile|scrum|ci\/cd|jenkins|terraform|firebase|android|ios)$/i;
  var SPOKEN_WORDS = /^(english|hindi|kannada|tamil|telugu|malayalam|marathi|bengali|gujarati|punjabi|odia|urdu|french|german|spanish|portuguese|italian|russian|chinese|japanese|korean|arabic|dutch|swedish|turkish)$/i;

  var NAME_BAD = /(@|http|\d{3,}|phone|mobile|email|e-mail|address|linkedin|github|resume|curriculum|vitae|summary|objective|skills?|experience|education|project|certificat|achievement|declaration|page\b|https?|www\.)/i;

  function cleanLines(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/[\u2022\u25cf\u25aa\u2713\u2714\u00b7\u2043]+/g, ' ')
      .split('\n')
      .map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); })
      .filter(Boolean);
  }

  function parseMonthYear(token) {
    token = String(token || '').trim().toLowerCase().replace(/'/g, '');
    var mNames = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    var m;
    if (/^(present|current|now|ongoing|till date|to date)$/.test(token)) return new Date();
    if ((m = /^([a-z]{3})[a-z]*[\s\-/]*(\d{2,4})$/.exec(token))) {
      var mo = mNames[m[1]];
      var y = parseInt(m[2], 10);
      if (y < 100) y += y > 70 ? 1900 : 2000;
      return new Date(y, mo, 1);
    }
    if ((m = /^(\d{1,2})[\s\-/]([a-z]{3})[a-z]*[\s\-/]?(\d{2,4})$/.exec(token))) {
      var mo2 = mNames[m[2]];
      var y2 = parseInt(m[3], 10);
      if (y2 < 100) y2 += y2 > 70 ? 1900 : 2000;
      return new Date(y2, mo2, 1);
    }
    if ((m = /^(\d{1,2})[\s\-/](\d{1,2})[\s\-/](\d{2,4})$/.exec(token))) {
      var y3 = parseInt(m[3], 10);
      if (y3 < 100) y3 += y3 > 70 ? 1900 : 2000;
      return new Date(y3, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    }
    if ((m = /^(\d{4})$/.exec(token))) return new Date(parseInt(m[1], 10), 3, 1);
    return null;
  }

  function splitSections(lines) {
    var sections = { top: [] };
    var current = 'top';
    lines.forEach(function (l) {
      var m = SECTION_RE.exec(l);
      if (m && l.length <= 42) {
        current = m[1].toLowerCase().replace(/[^a-z]/g, '');
        if (!sections[current]) sections[current] = [];
        return;
      }
      if (!sections[current]) sections[current] = [];
      sections[current].push(l);
    });
    return sections;
  }

  function firstMatch(re, text) {
    var m = re.exec(text || '');
    return m ? m[0] : '';
  }

  function nameFromLine(line) {
    if (!line || line.length > 40 || NAME_BAD.test(line)) return '';
    var words = line.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 4) return '';
    if (words.some(function (w) { return /^\d+$/.test(w); })) return '';
    var good = words.filter(function (w) {
      return /^[A-Z][A-Za-z.'\-]{1,}$/.test(w) || /^[A-Z]{2,5}$/.test(w);
    }).length;
    return good >= Math.ceil(words.length * 0.7) ? words.join(' ') : '';
  }

  function nameFromFilename(fileName) {
    if (!fileName) return '';
    var base = String(fileName).replace(/\.[a-z0-9]+$/i, '');
    var tokens = base.split(/[_\-\s]+/).filter(Boolean);
    var good = tokens.filter(function (t) {
      return /^[A-Za-z]{2,12}$/.test(t) &&
        !/^(resume|cv|final|updated|latest|copy|my|the|doc|pdf|sde|sde\d|job|application|fresher|experienced|contact|details|new|old|draft|v\d+|\d+)$/i.test(t);
    });
    return good.length && good.length <= 3 ? good.map(function (t) {
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    }).join(' ') : '';
  }

  function titleFromFilename(fileName) {
    var m = /\b(sde[\s-]?\d?|sde-?\d|software[\s-]?(engineer|developer)|developer|engineer|intern|analyst)\b/i.exec(String(fileName || ''));
    return m ? m[0].toUpperCase().replace(/-/g, '-') : '';
  }

  function parseDateOfBirth(line) {
    var m = /(?:dob|date\s+of\s+birth|birth\s*date|birthdate)\b\s*[:\-–]?\s*(\d{1,2}[\s\/\-.][\s\/\-.]?\w{2,10}[\s\/\-.]\d{2,4}|\d{1,2}[\s\/\-.]\d{1,2}[\s\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})/i.exec(line);
    if (!m) return '';
    var raw = m[1].trim();
    var iso = '';
    var d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if ((d = /^(\d{1,2})[\s\/\-.](\d{1,2})[\s\/\-.](\d{2,4})$/.exec(raw))) {
      var y = parseInt(d[3], 10); if (y < 100) y += y > 70 ? 1900 : 2000;
      iso = y + '-' + String(parseInt(d[2], 10)).padStart(2, '0') + '-' + String(parseInt(d[1], 10)).padStart(2, '0');
      return iso;
    }
    var t = parseMonthYear(raw) || new Date(raw);
    if (t && !isNaN(t)) {
      iso = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }
    return iso;
  }

  function parseExperience(lines) {
    var out = { company: '', title: '', years: '', months: '', totalMonths: 0 };
    var blocks = []; // {start: Date, end: Date, texts: []}
    var current = null;
    lines.forEach(function (l) {
      var m = DATE_RANGE_RE.exec(l);
      if (m) {
        var s = parseMonthYear(m[1]);
        var e = parseMonthYear(m[2]) || new Date();
        current = { start: s, end: e, head: l, prev: [] };
        blocks.push(current);
      } else if (current) {
        if (current.prev.length < 2 && l) current.prev.push(l);
      }
    });

    var total = 0;
    blocks.forEach(function (b) {
      if (b.start && b.end && !isNaN(b.start) && b.end > b.start) {
        total += (b.end.getFullYear() - b.start.getFullYear()) * 12 + (b.end.getMonth() - b.start.getMonth());
      }
    });
    if (total > 0 && total < 600) out.totalMonths = total;

    // most recent block (first in document order for standard resumes)
    var top = blocks[0];
    if (top) {
      var candidates = [top.head].concat(top.prev.slice().reverse());
      candidates.forEach(function (c) {
        c.split(/\s*[|\u2013\u2014\-–]\s*|\s+at\s+|\s*,\s*/).forEach(function (part) {
          part = part.trim();
          if (!part || DATE_RANGE_RE.test(part)) return;
          if (!out.company && /\b(pvt\.?|private|ltd\.?|llp|inc\.?|corp\.?|technologies|solutions|labs|systems|softwares?|digital|ventures|analytics|consulting|services|group|company|co\.)\b/i.test(part)) {
            out.company = part;
          }
          if (!out.title && ROLE_RE.test(part) && part.length < 60 && !out.company) {
            out.title = part;
          }
        });
        if (!out.title && ROLE_RE.test(c) && c.length < 60) out.title = c.split(/\s*[|,]\s*/).filter(function (p) { return ROLE_RE.test(p); })[0] || out.title;
      });
      if (!out.company) {
        candidates.forEach(function (c) {
          if (!out.company && !DATE_RANGE_RE.test(c) && !ROLE_RE.test(c) && c.split(/\s+/).length <= 6 && !NAME_BAD.test(c)) {
            out.company = c;
          }
        });
      }
      if (!out.title && ROLE_RE.test(top.head)) {
        var t2 = top.head.split(/\s*[|,]\s*/).find(function (p) { return ROLE_RE.test(p); });
        if (t2) out.title = t2.trim();
      }
    }

    if (out.totalMonths > 0) {
      out.years = String(Math.floor(out.totalMonths / 12));
      out.months = String(out.totalMonths % 12);
    }
    return out;
  }

  function parseEducation(lines) {
    var out = { degree: '', major: '', university: '', gpa: '', year: '' };
    var joined = lines.join('\n');
    for (var i = 0; i < DEGREE_MAP.length; i++) {
      if (DEGREE_MAP[i][0].test(joined)) { out.degree = DEGREE_MAP[i][1]; break; }
    }
    var mm = MAJOR_RE.exec(joined);
    if (mm) out.major = mm[1].replace(/\s+/g, ' ').trim();

    lines.forEach(function (l) {
      if (out.university) return;
      l.split(/\s*[|]\s*|\s+[-\u2013\u2014]\s+|\s*,\s*/).forEach(function (seg) {
        if (out.university) return;
        if (/(college|institute|university|academy|vidyapeeth|iit|nit|iiit)\b/i.test(seg) &&
            seg.split(/\s+/).length <= 9 && !/(cgpa|gpa|percentage|grade|marks)/i.test(seg)) {
          out.university = seg.trim().replace(/^(of|from|at)\s+/i, '');
        }
      });
    });

    var gm = /(?:cgpa|gpa|percentage|percent|aggregate|agg\.?|marks)\b\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?\s?%?)/i.exec(joined);
    if (gm) {
      var val = gm[1].replace(/\s/g, '');
      if (/%/.test(val)) out.gpa = val;
      else if (/percent|percentage|marks|agg/i.test(gm[0]) && !/gpa|cgpa/i.test(gm[0])) out.gpa = val + '%';
      else out.gpa = val;
    }

    // graduation year: last 19xx/20xx year in the block (or "expected 2027")
    var years = joined.match(/\b(?:19|20)\d{2}\b/g) || [];
    var em = /expect\w*[\s\S]{0,20}?\b((?:19|20)\d{2})\b/i.exec(joined);
    out.year = em ? em[1] : (years.length ? years[years.length - 1] : '');
    return out;
  }

  function parseSkills(sectionLines) {
    var values = [];
    var spoken = [];
    sectionLines.forEach(function (line) {
      line.split(/\s*[|•\u2022]\s*|,\s*/)
        .forEach(function (chunk) {
          var c = chunk.replace(/^\s*[\w.&\s/]{2,28}:\s*/, '').trim(); // strip "Frameworks:" labels
          if (!c || c.length > 40) return;
          var words = c.split(/[,;\/]|\band\b/).map(function (s) { return s.trim(); }).filter(Boolean);
          words.forEach(function (w) {
            if (!w || w.length > 30) return;
            if (SPOKEN_WORDS.test(w)) spoken.push(w);
            else values.push(w);
          });
        });
    });
    // if line started with "Languages:" and contents are programming-ish, all -> skills
    var uniq = [];
    values.forEach(function (v) { if (uniq.map(function (x) { return x.toLowerCase(); }).indexOf(v.toLowerCase()) < 0) uniq.push(v); });
    return { skills: uniq.slice(0, 30).join(', '), languages: spoken.join(', ') };
  }

  function parse(text, fileName) {
    var lines = cleanLines(text);
    var all = lines.join('\n');
    var profile = {};
    var filled = [];
    function set(key, v) {
      v = String(v == null ? '' : v).trim();
      if (v && !profile[key]) { profile[key] = v; filled.push(key); }
    }

    // --- contact ---
    set('email', (EMAIL_RE.exec(all) || [''])[0]);
    var phone = '';
    var pm = all.match(/\+?\d[\d\s\-()]{8,18}\d/g) || [];
    for (var i = 0; i < pm.length; i++) {
      var digits = pm[i].replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 13 && !/^(19|20)\d{2}$/.test(digits)) { phone = pm[i].replace(/\s+/g, ' ').trim(); break; }
    }
    set('phone', phone);

    var noContact = all.replace(EMAIL_RE, ' ').replace(/\+?\d[\d\s\-()]{8,18}\d/g, ' ');
    var urls = noContact.match(new RegExp(URL_RE.source, 'gi')) || [];
    urls.forEach(function (u) {
      var lu = u.toLowerCase();
      if (!profile.linkedin && /linkedin\.com/.test(lu)) set('linkedin', /^https?:/i.test(u) ? u : 'https://' + u);
      else if (!profile.github && /github\.com/.test(lu)) set('github', /^https?:/i.test(u) ? u : 'https://' + u);
      else set('portfolio', /^https?:|www\./i.test(u) ? u : 'https://' + u);
    });

    // --- name + headline ---
    for (var n = 0; n < Math.min(lines.length, 8); n++) {
      var cand = nameFromLine(lines[n]);
      if (cand) { set('fullName', cand); break; }
    }
    if (!profile.fullName) set('fullName', nameFromFilename(fileName));
    if (profile.fullName) {
      var parts = profile.fullName.split(/\s+/);
      set('firstName', parts[0]);
      if (parts.length > 2) set('middleName', parts.slice(1, -1).join(' '));
      if (parts.length > 1) set('lastName', parts[parts.length - 1]);
    }

    for (var t = 0; t < Math.min(lines.length, 12); t++) {
      if (lines[t].length > 70) continue;
      if (EMAIL_RE.test(lines[t]) || URL_RE.test(lines[t])) continue;
      var role = ROLE_RE.exec(lines[t]);
      if (role) {
        var seg = lines[t].split(/\s*[|,]\s*|\s+-\s+/).find(function (p) { return ROLE_RE.test(p) && p.length < 50; });
        set('currentTitle', (seg || lines[t]).trim());
        break;
      }
    }
    if (!profile.currentTitle) set('currentTitle', titleFromFilename(fileName));

    // --- sections ---
    var S = splitSections(lines);

    if (S.summary || S.objective || S.profile || S.about || S.aboutme || S.careerobjective) {
      set('summary', (S.summary || S.objective || S.profile || S.about || S.aboutme || S.careerobjective).join(' ').slice(0, 1200));
    }

    var skillSec = S.skills || S.technicalskills || S.technologies || S.techstack || S.corecompetencies || [];
    var langSec = S.languages || [];
    var sk = parseSkills(skillSec.length ? skillSec : []);
    set('skills', sk.skills);
    if (langSec.length) {
      var spokenOnly = langSec.join(' ').split(/[,;|]|\band\b/).map(function (s) { return s.trim(); }).filter(Boolean);
      var sp = spokenOnly.filter(function (w) { return SPOKEN_WORDS.test(w); });
      var prog = spokenOnly.filter(function (w) { return !SPOKEN_WORDS.test(w); });
      set('languages', sp.join(', '));
      if (prog.length && !profile.skills) set('skills', sk.skills || prog.join(', '));
      else if (prog.length) set('skills', (profile.skills ? profile.skills + ', ' : '') + prog.join(', '));
    }
    if (!profile.languages && sk.languages) set('languages', sk.languages);

    // "Languages known: English, Hindi" anywhere (but never programming lists)
    if (!profile.languages) {
      lines.forEach(function (l) {
        if (profile.languages) return;
        var m = /^(?:languages?(?:\s+known)?|known\s+languages|spoken\s+languages)\b\s*[:\-–]\s*(.+)$/i.exec(l);
        if (!m) return;
        var sp = m[1].split(/[,;|]|\band\b/).map(function (s) { return s.trim(); })
          .filter(function (w) { return SPOKEN_WORDS.test(w); });
        if (sp.length) set('languages', sp.join(', '));
      });
    }

    var expSec = S.experience || S.workexperience || S.professionalexperience || S.employment || S.employmenthistory || S.internships || [];
    if (expSec.length) {
      var exp = parseExperience(expSec);
      set('currentCompany', exp.company);
      set('currentTitle', exp.title || profile.currentTitle);
      if (exp.title && profile.currentTitle && profile.currentTitle !== exp.title && filled.indexOf('currentTitle') >= 0) {
        profile.currentTitle = exp.title; // experience title beats header guess
      }
      if (exp.years) set('yearsExperience', exp.years);
      if (exp.months && exp.months !== '0') set('monthsExperience', exp.months);
    }

    var eduSec = S.education || S.academics || S.academicdetails || S.qualification || S.qualifications || [];
    if (eduSec.length) {
      var edu = parseEducation(eduSec);
      set('degree', edu.degree);
      set('highestEducation', edu.degree ? (/^(M\.|MBA|Ph\.D|M\.Tech|M\.E|M\.Sc|MCA)/.test(edu.degree) ? "Master's or above" : "Bachelor's") : '');
      set('major', edu.major);
      set('university', edu.university);
      set('gpa', edu.gpa);
      set('graduationYear', edu.year);
    }

    // --- personal-ish direct fields ---
    lines.forEach(function (l) {
      if (!profile.dob) set('dob', parseDateOfBirth(l));
      var g = /\b(?:gender|sex)\b\s*[:\-–]\s*(male|female|other|non[\s-]?binary)/i.exec(l);
      if (g) set('gender', g[1].charAt(0).toUpperCase() + g[1].slice(1).toLowerCase());
      var nat = /\b(?:nationality|citizen\w*)\b\s*[:\-–]\s*([a-z .]{2,30})/i.exec(l);
      if (nat) set('nationality', nat[1].trim());
      var np = /\b(?:notice\s*period|notice)\b\s*[:\-–]?\s*(\d{1,3})\b/i.exec(l);
      if (np) set('noticePeriod', np[1]);
      var ctc = /\b(?:current\s+)?(?:ctc|salary|compensation)\b\s*[:\-–]?\s*([\d.,]+\s?(?:lpa|lakhs?|k|per\s+annum|pa)?)\b/i.exec(l);
      if (ctc && /ctc|salary/i.test(l)) set('currentCTC', ctc[1].trim());
      var loc = /\b(?:address|location|city)\b\s*[:\-–]\s*([^\n]{2,60})/i.exec(l);
      if (loc) {
        var bits = loc[1].split(/,\s*|\s*-\s*/);
        set('city', bits[0]);
        if (bits[1]) set('state', bits[1]);
        var zipm = /\b(\d{6})\b|\b(\d{5}(?:-\d{4})?)\b/.exec(loc[1]);
        if (zipm) set('zip', zipm[1] || zipm[2]);
      }
    });

    // "Bengaluru, Karnataka - 560038" style contact block (no label)
    if (!profile.city) {
      for (var ci = 0; ci < Math.min(lines.length, 5); ci++) {
        var l2 = lines[ci];
        if (/pvt|ltd|inc|corp|college|institute|university|technologies|solutions|school/i.test(l2)) continue;
        var rem = l2.replace(EMAIL_RE, ' ').replace(/\+?\d[\d\s\-()]{8,18}\d/g, ' ').replace(new RegExp(URL_RE.source, 'gi'), ' ');
        var lm = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?),\s*([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\b\s*[-–—:]?\s*(\d{6}|\d{5}(?:-\d{4})?)?/.exec(rem);
        if (lm) {
          set('city', lm[1]);
          set('state', lm[2]);
          if (lm[3]) set('zip', lm[3]);
          break;
        }
      }
    }

    // --- what a resume almost never has: ask the user ---
    var QUESTIONS = [
      { key: 'dob', label: 'Date of birth', type: 'date' },
      { key: 'gender', label: 'Gender', type: 'select' },
      { key: 'currentCTC', label: 'Current salary / CTC', type: 'text' },
      { key: 'expectedCTC', label: 'Expected salary / CTC', type: 'text' },
      { key: 'noticePeriod', label: 'Notice period (days)', type: 'text' },
      { key: 'workAuthorization', label: 'Work authorization', type: 'text' },
      { key: 'willingToRelocate', label: 'Willing to relocate', type: 'yesno' }
    ];
    var missing = QUESTIONS.filter(function (q) { return !profile[q.key]; });

    return { profile: profile, filledKeys: filled, missing: missing };
  }

  return { parse: parse, nameFromFilename: nameFromFilename };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AFX.resume;
}
