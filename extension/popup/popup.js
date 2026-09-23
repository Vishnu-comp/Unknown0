/* AutoFill Pro - popup logic */
'use strict';

var $ = function (id) { return document.getElementById(id); };

function setStatus(text, isError) {
  var el = $('status');
  el.textContent = text || '';
  el.className = 'status' + (isError ? ' err' : '');
}

function completeness(profile) {
  if (!profile) return 0;
  var keys = AFX.aliases.FIELDS.map(function (f) { return f.key; })
    .filter(function (k, i, arr) { return arr.indexOf(k) === i; });
  var filled = keys.filter(function (k) { return String(profile[k] || '').trim(); }).length;
  return Math.round((filled / keys.length) * 100);
}

async function getProfile() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['afx_profile_v1'], function (res) {
      resolve(res.afx_profile_v1 || null);
    });
  });
}

async function saveSettings(settings) {
  var profile = await getProfile() || {};
  profile.settings = Object.assign({}, profile.settings || {}, settings);
  await chrome.storage.local.set({ afx_profile_v1: profile });
}

async function activeTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

async function init() {
  var profile = await getProfile();
  var pct = completeness(profile);
  $('pct').textContent = pct + '%';
  $('bar-fill').style.width = pct + '%';

  var settings = Object.assign(
    { autoFillOnLoad: false, showWidget: true, highlightFilled: true },
    (profile && profile.settings) || {}
  );
  $('t-auto').checked = !!settings.autoFillOnLoad;
  $('t-widget').checked = settings.showWidget !== false;
  $('t-highlight').checked = settings.highlightFilled !== false;

  // detect site
  var tab = await activeTab();
  if (tab && tab.id != null) {
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'AFX_DETECT' }, function (resp) {
        if (chrome.runtime.lastError || !resp) {
          $('site-line').textContent = 'Open a normal website with a form — this page (settings / browser page) cannot be filled';
          return;
        }
        $('site-line').textContent = 'Supported here: ' + resp.site + ' · ' + resp.fields + ' fillable fields';
      });
    } catch (e) {
      $('site-line').textContent = 'Open a normal website with a form to use AutoFill';
    }
  }

  if (!profile || !(profile.fullName || profile.firstName || profile.email)) {
    setStatus('Step 1 of 2: open “Edit My Details”, type YOUR details, press Save', false);
    $('fill-btn').textContent = 'Set Up My Details First…';
  }

  $('fill-btn').addEventListener('click', async function () {
    if (!profile || !(profile.fullName || profile.firstName || profile.email)) {
      setStatus('Nothing is saved yet - gray “e.g.” text is just an example. Type your real details and Save.', true);
      chrome.runtime.openOptionsPage();
      return;
    }
    var tab = await activeTab();
    if (!tab || tab.id == null) return;
    $('fill-btn').disabled = true;
    setStatus('Filling…');
    chrome.tabs.sendMessage(tab.id, { type: 'AFX_FILL' }, function (stats) {
      $('fill-btn').disabled = false;
      if (chrome.runtime.lastError) {
        setStatus('Cannot fill this page. Open the actual form on a normal website (e.g. a Google Form or job application), then press Fill.', true);
        return;
      }
      if (!stats) {
        setStatus('Check your profile - some fields are empty.', true);
        return;
      }
      setStatus('Done: ' + (stats.filled || 0) + ' field(s) filled ✅');
    });
  });

  $('edit-btn').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  $('export-btn').addEventListener('click', async function () {
    var p = await getProfile();
    if (!p) { setStatus('Nothing to export yet.', true); return; }
    var blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'autofill-pro-profile.json';
    a.click();
  });

  [['t-auto', 'autoFillOnLoad'], ['t-widget', 'showWidget'], ['t-highlight', 'highlightFilled']].forEach(function (pair) {
    $(pair[0]).addEventListener('change', function () {
      var s = {};
      s[pair[1]] = $(pair[0]).checked;
      saveSettings(s);
    });
  });
}

init();
