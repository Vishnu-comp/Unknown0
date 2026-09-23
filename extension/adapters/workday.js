/* AutoFill Pro - Workday adapter.
   Works on *.myworkdayjobs.com career sites (and Workday-hosted company
   portals). Understands data-automation-id fields and Workday's custom
   button + listbox dropdowns (country, state, DOB...). */
'use strict';

AFX.adapters = AFX.adapters || {};

AFX.adapters['workday'] = (function () {
  var U = AFX.utils;
  var E = AFX.Engine;
  var AL = AFX.aliases;

  // data-automation-id -> profile key
  var AUTOMATION_MAP = {
    firstname: 'firstName', legalnamefirstname: 'firstName', preferredname: 'firstName',
    middlename: 'middleName', legalnamemiddlename: 'middleName',
    lastname: 'lastName', legalnamelastname: 'lastName', familyname: 'lastName',
    emailaddress: 'email', email: 'email',
    phonenumber: 'phone', phone: 'phone', mobilenumber: 'phone',
    addressline1: 'address1', addressline2: 'address2', city: 'city', municipality: 'city',
    postalcode: 'zip', zip: 'zip', zipcode: 'zip',
    state: 'state', province: 'state',
    country: 'country',
    dateofbirth: 'dob',
    gender: 'gender', sex: 'gender',
    sociallink: 'linkedin', linkedin: 'linkedin', linkedinprofile: 'linkedin'
  };

  function detect() {
    if (/myworkdayjobs\.com$/.test(location.hostname) || /(^|\.)workday\.com$/.test(location.hostname)) return true;
    // some companies embed Workday forms on their own domain
    return !!document.querySelector('[data-automation-id="legalNameSection"], [data-automation-id="externalUrlApply"], [data-automation-id="file-upload-input"], [data-automation-id="firstName"]');
  }

  function mapAutomation(id) {
    if (!id) return null;
    var k = U.normalize(id).replace(/\s+/g, '');
    return AUTOMATION_MAP[k] || AUTOMATION_MAP[k.replace(/section$/, '')] || null;
  }

  /** Click a Workday custom dropdown and choose the best matching option. */
  async function pickWorkdayDropdown(container, value) {
    var trigger =
      container.querySelector('div[role="button"], button[aria-haspopup="listbox"], button[data-automation-id="dropdownIcon"], [role="combobox"]') ||
      (container.getAttribute && container.getAttribute('role') === 'button' ? container : null) ||
      container.querySelector('button, [role="button"], .css-1u3qk0a');
    if (!trigger || !U.isVisible(trigger)) return false;
    trigger.click();
    await U.sleep(450);

    var options = document.querySelectorAll('[role="option"], [role="listbox"] li, li[role="option"], [data-automation-id="menuItem"], .css-1v9bq1o li, ul[role="listbox"] li');
    var visible = Array.prototype.filter.call(options, U.isVisible);
    if (!visible.length) {
      // keyboard fallback
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await U.sleep(250);
    }
    visible = Array.prototype.filter.call(document.querySelectorAll('[role="option"], [role="listbox"] li'), U.isVisible);

    var best = null;
    visible.forEach(function (o) {
      var score = U.optionMatchScore(o.innerText || o.textContent || '', value);
      if (score > 0 && (!best || score > best.score)) best = { node: o, score: score };
    });
    if (!best) {
      var yn = U.guessYesNo(value);
      if (yn) {
        for (var i = 0; i < visible.length; i++) {
          if (U.normalize(visible[i].innerText || '').indexOf(U.normalize(yn)) === 0) { best = { node: visible[i], score: 1 }; break; }
        }
      }
    }
    if (!best) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    best.node.click();
    await U.sleep(250);
    return true;
  }

  async function fillDateOfBirth(profile) {
    var iso = profile.dob;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return 0;
    var n = 0;
    var containers = document.querySelectorAll('[data-automation-id*="dateOfBirth" i], [data-automation-id*="birthDate" i], fieldset, div');
    // narrow: find sections whose label mentions birth
    var sections = [];
    Array.prototype.forEach.call(containers, function (c) {
      var id = (c.getAttribute && c.getAttribute('data-automation-id')) || '';
      if (/dateofbirth|birthdate|dob/i.test(id)) sections.push(c);
    });
    if (!sections.length) {
      Array.prototype.forEach.call(document.querySelectorAll('label, span, legend, [role="heading"]'), function (l) {
        if (/date of birth|birth ?date|\bdob\b/i.test(l.innerText || '')) {
          var sec = l.closest('div, fieldset');
          if (sec && sections.indexOf(sec) < 0) sections.push(sec);
        }
      });
    }

    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      var month = sec.querySelector('select[aria-label="Month"], select[data-automation-id="month"], [data-automation-id="month"] select, [data-automation-id="month"][role="button"]');
      var day = sec.querySelector('input[aria-label="Day"], input[data-automation-id="day"], select[data-automation-id="day"], [data-automation-id="day"] input');
      var year = sec.querySelector('input[aria-label="Year"], input[data-automation-id="year"], select[data-automation-id="year"], [data-automation-id="year"] input');

      if (month && month.tagName === 'SELECT') { if (E.fillSelectOption(month, String(parseInt(m[2], 10)))) n++; }
      else if (month && month.getAttribute && month.getAttribute('role') === 'button') { if (await pickWorkdayDropdown(month.closest('div') || month, String(parseInt(m[2], 10)))) n++; }

      if (day && day.tagName === 'SELECT') { if (E.fillSelectOption(day, String(parseInt(m[3], 10)))) n++; }
      else if (day && day.tagName === 'INPUT') { U.setNativeValue(day, String(parseInt(m[3], 10))); n++; }

      if (year && year.tagName === 'SELECT') { if (E.fillSelectOption(year, m[1])) n++; }
      else if (year && year.tagName === 'INPUT') { U.setNativeValue(year, m[1]); n++; }
    }
    return n;
  }

  function fillFiles(profile) {
    if (!profile.resume || !profile.resume.dataBase64) return 0;
    var count = 0;
    document.querySelectorAll('input[type="file"]').forEach(function (el) {
      var label = U.elementLabel(el) + ' ' + (el.closest('section, div') ? el.closest('section, div').innerText : '');
      if (/resume|cv|upload|document/i.test(label) || /pdf|docx?/.test(el.accept || '') || /file-upload/i.test(el.getAttribute('data-automation-id') || '')) {
        if (E.attachResume(el, profile.resume)) count++;
      }
    });
    return count;
  }

  async function fill(profile) {
    var stats = { filled: 0, skipped: 0, fields: {} };
    var root = document;

    // ---- pass 1: inputs with data-automation-id ----
    root.querySelectorAll('input[data-automation-id], textarea[data-automation-id], select[data-automation-id]').forEach(function (el) {
      if (!U.isVisible(el)) return;
      var id = el.getAttribute('data-automation-id');
      if (/file-upload|search|command|filter/i.test(id)) return;
      var key = mapAutomation(id);
      if (!key) key = (AL.matchField(U.humanizeAttr(id)) || {}).key || null;
      if (!key) return;
      var value = E.resolveValue(profile, key);
      if (!value) return;
      var meta = AL.fieldBy[key];
      if (E.fillControl(el, value, meta && meta.type, id)) {
        stats.filled++;
        stats.fields[key] = (stats.fields[key] || 0) + 1;
      }
    });

    // ---- pass 2: Workday custom dropdowns (country / state / select-likes) ----
    var dropContainers = root.querySelectorAll('[data-automation-id="country"], [data-automation-id="state"], [data-automation-id="region"], [data-automation-id="gender"], [data-automation-id="dropdown"], div[data-automation-id]');
    for (var i = 0; i < dropContainers.length; i++) {
      var c = dropContainers[i];
      if (!U.isVisible(c)) continue;
      if (c.querySelector('input[type="text"], textarea, select')) continue; // real input handled elsewhere
      var id = c.getAttribute('data-automation-id');
      if (/file-upload|search|command|section|table|button|link|next|previous/i.test(id)) continue;
      var key = mapAutomation(id) || (AL.matchField(U.humanizeAttr(id) + ' ' + (c.innerText || '').split('\n')[0]) || {}).key || null;
      if (!key) {
        // try the visible label inside the wrapper
        key = (AL.matchField((c.innerText || '').split('\n').slice(0, 2).join(' ')) || {}).key || null;
      }
      if (!key) continue;
      var value = E.resolveValue(profile, key);
      if (!value) continue;
      if (await pickWorkdayDropdown(c, value)) {
        stats.filled++;
        stats.fields[key] = (stats.fields[key] || 0) + 1;
      } else {
        stats.skipped++;
      }
    }

    // ---- pass 3: date of birth composite fields ----
    var dob = await fillDateOfBirth(profile);
    if (dob) {
      stats.filled += dob;
      stats.fields.dob = dob;
    }

    // ---- pass 4: generic engine for everything else (custom questions) ----
    var generic = E.fillAll(profile, { root: root, fillFiles: false });
    // merge (generic recounts some fields; keep max)
    stats.filled += generic.filled;
    stats.skipped += generic.skipped;
    Object.keys(generic.fields).forEach(function (k) {
      stats.fields[k] = (stats.fields[k] || 0) + generic.fields[k];
    });

    // ---- pass 5: resume upload ----
    var files = fillFiles(profile);
    if (files) {
      stats.filled += files;
      stats.files = files;
      stats.fields.resume = files;
    }

    return stats;
  }

  return { id: 'workday', name: 'Workday', detect: detect, fill: fill };
})();
