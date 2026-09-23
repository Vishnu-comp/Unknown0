/* AutoFill Pro - options page logic */
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
  if (text) setTimeout(function () { el.textContent = ''; }, 2500);
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
  say('Saved ✓');
}

function load() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['afx_profile_v1'], function (res) {
      resolve(res.afx_profile_v1 || null);
    });
  });
}

// ---------- tabs ----------
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

// ---------- actions ----------
$('save-btn').addEventListener('click', save);
$('qa-add').addEventListener('click', function () { addQaRow('', ''); });

$('resume-input').addEventListener('change', async function () {
  var file = this.files && this.files[0];
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) {
    say('Resume too large (max 6 MB).', false);
    this.value = '';
    return;
  }
  var resume = await fileToBase64(file);
  var profile = await load() || collectForm();
  profile.resume = resume;
  profile.customAnswers = collectQa();
  await chrome.storage.local.set({ afx_profile_v1: profile });
  renderResume(profile);
  say('Resume stored ✓');
});

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
    say('Imported ✓');
  } catch (e) {
    say('Invalid JSON file.', false);
  }
  this.value = '';
});

// ---------- matcher tester ----------
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

// ---------- boot ----------
(async function init() {
  var profile = await load();
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

  // autosave shortly after edits
  var t = null;
  document.addEventListener('input', function () {
    clearTimeout(t);
    t = setTimeout(function () { save().catch(function () {}); }, 900);
  });
})();
