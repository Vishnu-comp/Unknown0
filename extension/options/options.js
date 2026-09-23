/* AutoFill Pro - options page logic (profile editor, resume auto-import,
   missing-details quick questions, custom answers, backup, matcher tester) */
'use strict';

var $ = function (id) { return document.getElementById(id); };

var TITLES = {
  personal: 'Personal details',
  links: 'Links & profiles',
  work: 'Work & preferences',
  education: 'Education',
  extras: 'Custom answers & resume',
  settings: 'Settings & data'
};

/* The few details a resume can never contain -> asked one-liner style. */
var QUICK_META = {
  dob: { label: 'Date of birth', type: 'date' },
  gender: { label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other', 'Prefer not to say'] },
  currentCTC: { label: 'Current salary / CTC', type: 'text', ph: 'e.g. 12 LPA' },
  expectedCTC: { label: 'Expected salary / CTC', type: 'text', ph: 'e.g. 18 LPA' },
  noticePeriod: { label: 'Notice period (days)', type: 'text', ph: 'e.g. 30' },
  workAuthorization: { label: 'Work authorization', type: 'text', ph: 'e.g. Yes' },
  willingToRelocate: { label: 'Willing to relocate', type: 'select', options: ['Yes', 'No'] }
};

// ---------------------------------------------------------------- storage

function collectForm() {
  var profile = {};
  document.querySelectorAll('[data-key]').forEach(function (el) {
    profile[el.getAttribute('data-key')] = el.value.trim();
  });
  return profile;
}

function fillForm(profile) {
  document.querySelectorAll('[data-key]').forEach(function (el) {
    var v = profile[el.getAttribute('data-key')];
    if (v != null) el.value = v;
  });
  document.querySelectorAll('[data-setting]').forEach(function (el) {
    var s = profile.settings && profile.settings[el.getAttribute('data-setting')];
    if (el.getAttribute('data-setting') === 'showWidget' && s === undefined) s = true;
    if (el.getAttribute('data-setting') === 'highlightFilled' && s === undefined) s = true;
    el.checked = !!s;
  });
}

function collectQa() {
  var rows = [];
  document.querySelectorAll('.qa-row').forEach(function (row) {
    var k = row.querySelector('.qa-k').value.trim();
    var a = row.querySelector('.qa-a').value.trim();
    if (k || a) rows.push({ keywords: k, answer: a });
  });
  return rows;
}

function addQaRow(k, a) {
  var row = document.createElement('div');
  row.className = 'qa-row';
  row.innerHTML =
    '<input class="qa-k" placeholder="keywords (comma separated) e.g. authorized, sponsor" />' +
    '<input class="qa-a" placeholder="answer e.g. Yes" />' +
    '<button type="button" class="danger">✕</button>';
  row.querySelector('.qa-k').value = k || '';
  row.querySelector('.qa-a').value = a || '';
  row.querySelector('button').addEventListener('click', function () { row.remove(); });
  $('qa-list').appendChild(row);
}

function renderResume(profile) {
  var r = profile && profile.resume;
  if (r && r.dataBase64) {
    $('resume-info').textContent = 'Stored: ' + (r.name || 'resume') + ' (' + Math.round((r.dataBase64.length * 3) / 4 / 1024) + ' KB)';
    $('resume-info').classList.remove('muted');
  } else {
    $('resume-info').textContent = 'No resume stored.';
    $('resume-info').classList.add('muted');
  }
}

function say(text, ok) {
  var el = $('save-state');
  el.textContent = text;
  el.style.color = ok === false ? '#dc2626' : '#16a34a';
  if (text && ok !== false) setTimeout(function () { el.textContent = ''; }, 4000);
}

function updateBanners(profile) {
  var hasData = !!(profile && String(profile.fullName || profile.firstName || profile.email || profile.phone || '').trim());
  $('first-run').hidden = hasData;
  $('saved-banner').hidden = !hasData;
  if (!hasData) $('missing-card').hidden = true;
}

function load() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['afx_profile_v1'], function (res) {
      resolve(res.afx_profile_v1 || null);
    });
  });
}

async function save() {
  var existing = await load() || {};
  var profile = collectForm();
  profile.customAnswers = collectQa();
  profile.resume = existing.resume || null;
  profile.settings = {};
  document.querySelectorAll('[data-setting]').forEach(function (el) {
    profile.settings[el.getAttribute('data-setting')] = el.checked;
  });
  await chrome.storage.local.set({ afx_profile_v1: profile });
  updateBanners(profile);
  return profile;
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var data = String(reader.result).split(',')[1] || '';
      resolve({ name: file.name, type: file.type || 'application/pdf', dataBase64: data });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------ resume auto-import

/** Fill only EMPTY form fields from the parsed resume; never overwrite typing. */
function mergeParsed(parsed) {
  var merged = [];
  Object.keys(parsed.profile).forEach(function (key) {
    var v = String(parsed.profile[key] || '').trim();
    if (!v) return;
    var el = document.querySelector('[data-key="' + key + '"]');
    if (el && !String(el.value).trim()) {
      el.value = v;
      merged.push(key);
      el.classList.add('just-filled');
      setTimeout(function () { el.classList.remove('just-filled'); }, 3500);
    }
  });
  return merged;
}

/** Ask only for the fields a resume cannot know (dob, notice, expected CTC…). */
function renderMissing(missing) {
  var wrap = $('missing-quick');
  wrap.innerHTML = '';
  var still = (missing || []).filter(function (m) {
    var el = document.querySelector('[data-key="' + m.key + '"]');
    return !el || !String(el.value).trim();
  });
  if (!still.length) {
    $('missing-card').hidden = true;
    return;
  }
  still.forEach(function (m) {
    var meta = QUICK_META[m.key] || { label: m.label, type: 'text' };
    var label = document.createElement('label');
    label.className = 'quick';
    label.appendChild(document.createTextNode(meta.label));
    var input;
    if (meta.options) {
      input = document.createElement('select');
      input.innerHTML = '<option value="">—</option>' + meta.options.map(function (o) {
        return '<option>' + o + '</option>';
      }).join('');
    } else {
      input = document.createElement('input');
      input.type = meta.type || 'text';
      if (meta.ph) input.placeholder = meta.ph;
    }
    input.setAttribute('data-quick', m.key);
    function sync() {
      var main = document.querySelector('[data-key="' + m.key + '"]');
      if (main) main.value = input.value;
      input.classList.toggle('done', !!input.value);
    }
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    label.appendChild(input);
    wrap.appendChild(label);
  });
  $('missing-title').textContent = 'Just ' + still.length + ' detail' + (still.length === 1 ? '' : 's') + ' your resume can’t know';
  $('missing-card').hidden = false;
}

async function handleResumeFile(file, inputEl) {
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) {
    say('Resume too large (max 6 MB).', false);
    inputEl.value = '';
    return;
  }
  say('Reading resume…');
  var stored = await fileToBase64(file);

  // 1) extract text (PDF via pdf.js, TXT directly; DOCX/PNG kept for upload only)
  var text = '';
  try {
    if (/\.pdf$/i.test(file.name)) {
      if (window.AFXExtractPdfText) {
        text = await window.AFXExtractPdfText(file);
      } else {
        say('PDF engine is still loading — try again in a second.', false);
        return;
      }
    } else if (/\.(txt|md)$/i.test(file.name)) {
      text = await file.text();
    }
  } catch (e) {
    say('Could not read the PDF (' + (e && e.message || e) + '). Is it a real PDF?', false);
    return;
  }

  // 2) parse into profile fields (filename is a weak fallback for name/role)
  var parsed = (window.AFX && AFX.resume) ? AFX.resume.parse(text, file.name) : { profile: {}, filledKeys: [], missing: [] };
  var merged = mergeParsed(parsed);

  // 3) store the resume itself (for auto-attach on job portals)
  var existing = await load() || {};
  existing.resume = stored;
  await chrome.storage.local.set({ afx_profile_v1: existing });

  // 4) save the merged fields, then ask only what is missing
  await save();
  renderResume(await load());
  renderMissing(parsed.missing);
  if (merged.length) {
    say('Auto-filled ' + merged.length + ' field' + (merged.length === 1 ? '' : 's') + ' from ' + file.name + ' ✓ — answer the questions above, then Save.');
  } else {
    say('Resume stored ✓ (no new fields to fill — everything was already set).');
  }
  updateBanners(await load());
  if (inputEl) inputEl.value = '';
}

// ---------------------------------------------------------------- actions

document.querySelectorAll('.nav-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    btn.classList.add('active');
    var tab = btn.getAttribute('data-tab');
    $('tab-' + tab).classList.add('active');
    $('tab-title').textContent = TITLES[tab] || '';
  });
});

$('save-btn').addEventListener('click', async function () {
  await save();
  say('Saved ✓');
});
$('qa-add').addEventListener('click', function () { addQaRow('', ''); });

$('resume-quick').addEventListener('change', function () { handleResumeFile(this.files[0], this); });
$('resume-input').addEventListener('change', function () { handleResumeFile(this.files[0], this); });

$('resume-clear').addEventListener('click', async function () {
  var profile = await load() || {};
  profile.resume = null;
  await chrome.storage.local.set({ afx_profile_v1: profile });
  $('resume-input').value = '';
  renderResume(profile);
  say('Resume removed');
});

$('export-btn').addEventListener('click', async function () {
  var profile = await load();
  if (!profile) { say('Nothing saved yet - press Save first.', false); return; }
  var blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'autofill-pro-profile.json';
  a.click();
});

$('import-input').addEventListener('change', async function () {
  var file = this.files && this.files[0];
  if (!file) return;
  try {
    var text = await file.text();
    var profile = JSON.parse(text);
    await chrome.storage.local.set({ afx_profile_v1: profile });
    fillForm(profile);
    (profile.customAnswers || []).forEach(function (r) { addQaRow(r.keywords, r.answer); });
    renderResume(profile);
    updateBanners(profile);
    renderMissing(profile.customAnswers ? [] : (window.AFX ? AFX.resume.parse('', '').missing : []));
    say('Imported ✓');
  } catch (e) {
    say('Invalid JSON file.', false);
  }
  this.value = '';
});

// ------------------------------------------------------------ matcher test

function runTest() {
  var label = $('test-label').value;
  var out = $('test-result');
  var custom = collectQa();
  var m = AFX.aliases.matchField(label);
  var ca = AFX.aliases.matchCustomAnswer(custom, label);
  out.classList.remove('ok', 'none');
  if (m) {
    var f = AFX.aliases.fieldBy[m.key];
    out.textContent = '→ profile field: “' + f.label + '” (' + m.key + ')' + (ca ? ' · custom answer also matches' : '');
    out.classList.add('ok');
  } else if (ca) {
    out.textContent = '→ no profile field, but custom answer matches: “' + ca + '”';
    out.classList.add('ok');
  } else {
    out.textContent = '→ no match (add a custom answer to cover it)';
    out.classList.add('none');
  }
}
$('test-btn').addEventListener('click', runTest);
$('test-label').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') runTest();
});

// -------------------------------------------------------------------- boot

(async function init() {
  var profile = await load();
  updateBanners(profile);
  if (profile) {
    fillForm(profile);
    (profile.customAnswers || []).forEach(function (r) { addQaRow(r.keywords, r.answer); });
    renderResume(profile);
  } else {
    addQaRow('authorized to work, legally authorized', 'Yes');
    addQaRow('relocate, relocation', 'Yes');
    addQaRow('sponsorship', 'No');
    addQaRow('how did you hear', 'LinkedIn');
    renderResume(null);
  }

  // autosave shortly after edits (typing in main or quick fields)
  var t = null;
  document.addEventListener('input', function () {
    clearTimeout(t);
    t = setTimeout(function () { save().catch(function () {}); }, 900);
  });
})();
