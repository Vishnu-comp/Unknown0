/* AutoFill Pro - LinkedIn adapter.
   Handles Easy Apply modals, profile forms and typeahead comboboxes
   (city / state / school / company suggestions). */
'use strict';

AFX.adapters = AFX.adapters || {};

AFX.adapters['linkedin'] = (function () {
  var U = AFX.utils;
  var E = AFX.Engine;
  var AL = AFX.aliases;

  function detect() {
    return /(^|\.)linkedin\.com$/.test(location.hostname);
  }

  /** After typing into a typeahead input, pick the best suggestion. */
  async function settleTypeaheads(root) {
    var inputs = (root || document).querySelectorAll('input[id*="city"], input[id*="state"], input[id*="school"], input[id*="company"], input[role="combobox"], input[id*="typeahead"], input[aria-autocomplete="list"], input[aria-autocomplete="both"]');
    var clicked = 0;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!U.isVisible(el) || !el.value) continue;
      el.focus();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await U.sleep(650);
      var opts = document.querySelectorAll('.basic-typeahead-input-triggered-content div[role="option"], div[role="listbox"] div[role="option"], .basic-typeahead-dropdown li, .search-basic-typeahead__matching-option, ul.entity-result-list li, [role="listbox"] li');
      var visible = Array.prototype.filter.call(opts, U.isVisible);
      if (!visible.length) continue;
      var target = el.value;
      var best = null;
      visible.forEach(function (o) {
        var score = U.optionMatchScore(o.innerText || o.textContent || '', target);
        if (score > 0 && (!best || score > best.score)) best = { node: o, score: score };
      });
      if (!best) best = { node: visible[0], score: 0 }; // take the first suggestion
      try {
        best.node.click();
        var link = best.node.querySelector && best.node.querySelector('a, [role="option"], button');
        if (link && link !== best.node) link.click();
        clicked++;
        await U.sleep(350);
      } catch (e) { /* ignore */ }
    }
    return clicked;
  }

  function fillEasyApplyResumes(profile) {
    if (!profile.resume || !profile.resume.dataBase64) return 0;
    var count = 0;
    var files = document.querySelectorAll('input[type="file"]');
    Array.prototype.forEach.call(files, function (el) {
      if (!U.isVisible(el)) return;
      var label = U.elementLabel(el) + ' ' + (el.closest('div, section') ? el.closest('div, section').innerText : '');
      if (/resume|cv|document|upload/i.test(label) || /pdf|docx?/.test(el.accept || '')) {
        if (E.attachResume(el, profile.resume)) count++;
      }
    });
    return count;
  }

  async function fill(profile) {
    var root = document.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-modal-content, [role="dialog"], .application-outlet, form') || document;
    var stats = E.fillAll(profile, { root: root });
    await settleTypeaheads(root);
    // city/state fields often resolve after the suggestion click; re-verify empties once
    var files = fillEasyApplyResumes(profile);
    if (files) {
      stats.filled += files;
      stats.files = (stats.files || 0) + files;
      stats.fields.resume = files;
    }
    return stats;
  }

  return { id: 'linkedin', name: 'LinkedIn', detect: detect, fill: fill };
})();
