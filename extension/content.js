/* AutoFill Pro - content script orchestrator.
   Detects the site adapter, exposes the floating widget, listens for
   messages from popup / keyboard shortcut, and can auto-fill new steps
   that appear (LinkedIn Easy Apply / Workday multi-step). */
'use strict';

(function () {
  var U = AFX.utils;

  var ADAPTER_ORDER = ['google-forms', 'linkedin', 'naukri', 'workday'];
  var state = {
    adapter: null,
    profile: null,
    settings: { autoFillOnLoad: false, showWidget: true, highlightFilled: true },
    sessionActiveUntil: 0,   // re-fill newly appearing steps while active
    lastFillAt: 0
  };

  function pickAdapter() {
    for (var i = 0; i < ADAPTER_ORDER.length; i++) {
      var a = AFX.adapters[ADAPTER_ORDER[i]];
      if (a && a.detect()) return a;
    }
    return {
      id: 'generic',
      name: 'This website',
      detect: function () { return true; },
      fill: function (profile) { return AFX.Engine.fillAll(profile, { highlight: state.settings.highlightFilled }); }
    };
  }

  async function loadProfile() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['afx_profile_v1'], function (res) {
          state.profile = res && res.afx_profile_v1 ? res.afx_profile_v1 : null;
          if (state.profile && state.profile.settings) {
            state.settings = Object.assign(state.settings, state.profile.settings);
          }
          resolve(state.profile);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function hasProfile(profile) {
    return !!(profile && (profile.fullName || profile.firstName || profile.email || profile.phone));
  }

  async function runFill(trigger) {
    await loadProfile();
    if (!hasProfile(state.profile)) {
      widgetToast('Profile is empty - open AutoFill Pro to set up', true);
      try { chrome.runtime.sendMessage({ type: 'AFX_OPEN_OPTIONS' }); } catch (e) {}
      return null;
    }
    var adapter = state.adapter || pickAdapter();
    state.adapter = adapter;
    widgetBusy(true);
    var stats = null;
    try {
      stats = await adapter.fill(state.profile);
    } catch (e) {
      console.warn('[AutoFill Pro] fill error', e);
      widgetToast('Error: ' + (e && e.message || e), true);
      widgetBusy(false);
      return null;
    }
    state.lastFillAt = Date.now();
    state.sessionActiveUntil = Date.now() + 5 * 60 * 1000;
    var msg = stats
      ? 'Filled ' + stats.filled + ' field' + (stats.filled === 1 ? '' : 's') + (stats.files ? ' + resume' : '')
      : 'Nothing to fill';
    widgetToast(msg, false);
    widgetBusy(false);
    updateWidgetBadge();
    return stats;
  }

  // ---------------- Floating widget (Shadow DOM) ----------------

  var widget = { host: null, root: null, btn: null, toast: null, badge: null };

  function widgetToast(text, isError) {
    if (!widget.toast) return;
    widget.toast.textContent = text;
    widget.toast.style.background = isError ? '#7f1d1d' : '#14532d';
    widget.toast.style.opacity = '1';
    clearTimeout(widgetToast._t);
    widgetToast._t = setTimeout(function () { widget.toast.style.opacity = '0'; }, 3200);
  }

  function widgetBusy(busy) {
    if (!widget.btn) return;
    widget.btn.textContent = busy ? '…' : '⚡ Fill';
    widget.btn.disabled = !!busy;
  }

  function countFillable() {
    try {
      return AFX.Engine.collectControls(document).length +
        document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]').length +
        document.querySelectorAll('input[type="file"]').length;
    } catch (e) { return 0; }
  }

  function updateWidgetBadge() {
    if (!widget.badge || !state.adapter) return;
    widget.badge.textContent = state.adapter.name + ' · ' + countFillable() + ' fields';
  }

  function injectWidget() {
    if (window !== window.top) return; // one widget per page
    if (widget.host) return;
    if (!state.settings.showWidget) return;
    if (countFillable() < 1) return;

    var host = document.createElement('div');
    host.id = 'afx-root-' + Math.random().toString(36).slice(2);
    host.style.cssText = 'position:fixed;z-index:2147483646;right:16px;bottom:16px;';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}' +
      '.badge{font-size:10px;color:#fff;background:rgba(15,23,42,.85);padding:3px 8px;border-radius:999px;letter-spacing:.2px;}' +
      'button.fill{cursor:pointer;border:0;color:#fff;font-size:14px;font-weight:600;padding:10px 16px;border-radius:999px;' +
      'background:linear-gradient(135deg,#4f46e5,#7c3aed);box-shadow:0 4px 14px rgba(79,70,229,.45);}' +
      'button.fill:hover{filter:brightness(1.08)}' +
      'button.fill:disabled{opacity:.7;cursor:default}' +
      '.toast{color:#fff;font-size:12px;padding:7px 12px;border-radius:8px;background:#14532d;opacity:0;transition:opacity .25s;max-width:260px;text-align:right;}' +
      '.hide{display:none}' +
      '</style>' +
      '<div class="wrap">' +
      '  <div class="toast"></div>' +
      '  <div class="badge">AutoFill Pro</div>' +
      '  <button class="fill">⚡ Fill</button>' +
      '</div>';

    document.documentElement.appendChild(host);
    widget.host = host;
    widget.root = root;
    widget.btn = root.querySelector('button.fill');
    widget.toast = root.querySelector('.toast');
    widget.badge = root.querySelector('.badge');
    widget.btn.addEventListener('click', function () { runFill('widget'); });
    updateWidgetBadge();
  }

  // ---------------- Multi-step form watcher ----------------

  var watcher = null;
  function startStepWatcher() {
    if (watcher) return;
    var timer = null;
    watcher = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(async function () {
        if (Date.now() > state.sessionActiveUntil) return;
        if (Date.now() - state.lastFillAt < 1200) return;
        var controls = AFX.Engine.collectControls(document);
        var empty = controls.filter(function (el) { return !el.value; });
        if (empty.length >= 1) {
          state.lastFillAt = Date.now();
          try {
            var stats = await state.adapter.fill(state.profile);
            if (stats && stats.filled > 0) widgetToast('New step: filled ' + stats.filled + ' more fields', false);
          } catch (e) { /* ignore */ }
        }
        updateWidgetBadge();
      }, 900);
    });
    watcher.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---------------- Messaging ----------------

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === 'AFX_FILL') {
      runFill('shortcut').then(function (stats) { sendResponse(stats || { filled: 0 }); });
      return true;
    }
    if (msg.type === 'AFX_DETECT') {
      sendResponse({
        site: state.adapter ? state.adapter.name : pickAdapter().name,
        adapterId: state.adapter ? state.adapter.id : pickAdapter().id,
        fields: countFillable(),
        ready: true
      });
      return false;
    }
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.afx_profile_v1) {
      state.profile = changes.afx_profile_v1.newValue || null;
      if (state.profile && state.profile.settings) {
        state.settings = Object.assign(state.settings, state.profile.settings);
      }
    }
  });

  // ---------------- Boot ----------------

  (async function init() {
    // Don't run on tiny / invisible frames
    if (document.body && document.body.offsetHeight < 2) return;
    state.adapter = pickAdapter();
    await loadProfile();
    injectWidget();
    startStepWatcher();
    if (state.settings.autoFillOnLoad && hasProfile(state.profile)) {
      setTimeout(function () { runFill('auto'); }, 800);
    }
  })();
})();
