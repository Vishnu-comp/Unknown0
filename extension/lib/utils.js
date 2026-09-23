/* AutoFill Pro - shared DOM utilities (loaded in pages as a content script,
   and used by the matcher tests in Node via module.exports). */
'use strict';

var AFX = (typeof globalThis !== 'undefined' ? globalThis : window).AFX || {};
AFX.utils = (function () {

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[_\-./\\|,:;!?(){}\[\]"'`*+&#@%^$~=<>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly && el.tagName !== 'INPUT') return false;
    if (el.type === 'hidden') return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    var style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) return false;
    return true;
  }

  function humanizeAttr(attr) {
    return String(attr == null ? '' : attr)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Robust value setter that survives React / Angular / Vue controlled inputs. */
  function setNativeValue(el, value) {
    var proto;
    if (el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
    else if (el instanceof HTMLSelectElement) proto = HTMLSelectElement.prototype;
    else proto = HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  }

  /** Best-effort visible label text for a form control. */
  function elementLabel(el) {
    if (!el) return '';
    var parts = [];
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) parts.push(aria);

    if (el.labels) {
      for (var i = 0; i < el.labels.length; i++) parts.push(el.labels[i].innerText || el.labels[i].textContent);
    }
    if (el.id) {
      var esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(el.id) : String(el.id).replace(/["\\]/g, '\\$&');
      var byFor = document.querySelector('label[for="' + esc + '"]');
      if (byFor) parts.push(byFor.innerText || byFor.textContent);
    }
    var wrap = el.closest('label');
    if (wrap) parts.push((wrap.innerText || wrap.textContent || '').replace(el.value || '', ''));

    var labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach(function (id) {
        var n = document.getElementById(id);
        if (n) parts.push(n.innerText || n.textContent);
      });
    }

    // closest fieldset legend / wrapper with a heading (Workday / Naukri sections)
    var section = el.closest('fieldset, [class*="field"], [class*="form-item"], [data-automation-id], [role="group"], li, .item');
    if (section) {
      var legend = section.querySelector('legend, [role="heading"], label, .label, [class*="label"], [class*="title"], span');
      if (legend && legend !== el && !legend.contains(el)) parts.push(legend.innerText || legend.textContent);
    }

    var ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) parts.push(ph);
    var title = el.getAttribute && el.getAttribute('title');
    if (title) parts.push(title);
    if (el.name) parts.push(humanizeAttr(el.name));
    if (el.id) parts.push(humanizeAttr(el.id));
    if (el.getAttribute && el.getAttribute('data-automation-id')) parts.push(humanizeAttr(el.getAttribute('data-automation-id')));

    return parts
      .filter(Boolean)
      .map(function (p) { return String(p).trim(); })
      .filter(function (p, i, arr) { return p && arr.indexOf(p) === i; })
      .join(' | ');
  }

  /** Try to derive a display-format date (input value is YYYY-MM-DD). */
  function formatDate(isoDate, hint) {
    if (!isoDate) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate).trim());
    if (!m) return isoDate;
    var y = m[1], mo = m[2], d = m[3];
    var pat = String(hint || '').toUpperCase();
    if (pat.indexOf('DD/MM') >= 0) return d + '/' + mo + '/' + y;
    if (pat.indexOf('YYYY') >= 0 && pat.indexOf('MM') > pat.indexOf('YYYY')) return y + '-' + d + '-' + mo;
    if (pat.indexOf('MM/DD') >= 0) return mo + '/' + d + '/' + y;
    if (pat.indexOf('DD') === 0) return d + '/' + mo + '/' + y;
    // default US style, the most common on international job forms
    return mo + '/' + d + '/' + y;
  }

  var COUNTRY_SYNONYMS = {
    'usa': 'united states of america', 'us': 'united states of america', 'u s a': 'united states of america',
    'united states': 'united states of america', 'america': 'united states of america',
    'uk': 'united kingdom', 'u k': 'united kingdom', 'great britain': 'united kingdom', 'britain': 'united kingdom', 'england': 'united kingdom',
    'uae': 'united arab emirates', 'u a e': 'united arab emirates', 'emirates': 'united arab emirates',
    'south korea': 'korea republic of', 'korea': 'korea republic of',
    'russia': 'russian federation', 'czech': 'czechia', 'holland': 'netherlands', 'the netherlands': 'netherlands',
    'vietnam': 'viet nam', 'burma': 'myanmar', 'ivory coast': "cote d ivoire"
  };

  function valueVariants(value) {
    var v = String(value == null ? '' : value).trim();
    if (!v) return [];
    var n = normalize(v);
    var out = [n, normalize(v.replace(/\(.*?\)/g, ''))];
    if (COUNTRY_SYNONYMS[n]) out.push(COUNTRY_SYNONYMS[n]);
    for (var k in COUNTRY_SYNONYMS) if (COUNTRY_SYNONYMS[k] === n) out.push(normalize(k));
    return out.filter(function (x, i, arr) { return x && arr.indexOf(x) === i; });
  }

  /** Score how well an option text matches a target value (0 = no match). */
  function optionMatchScore(optionText, value) {
    var o = normalize(optionText);
    if (!o) return 0;
    var variants = valueVariants(value);
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      if (!v) continue;
      if (o === v) return 1000;
      if (o.indexOf(v) === 0 || v.indexOf(o) === 0) return 700 - Math.abs(o.length - v.length);
      if (o.indexOf(v) >= 0 || v.indexOf(o) >= 0) return 400 - Math.abs(o.length - v.length);
    }
    // token overlap (e.g. "b.e. computer science" vs "computer science & engineering")
    var vt = normalize(value).split(' ').filter(function (t) { return t.length > 2; });
    if (!vt.length) return 0;
    var hit = vt.filter(function (t) { return o.indexOf(t) >= 0; }).length;
    return hit === 0 ? 0 : (hit / vt.length) * 300;
  }

  /** For Yes/No type answers pick the right radio/select option text. */
  function guessYesNo(value) {
    var v = normalize(value);
    if (!v) return null;
    if (/^(yes|y|true|authorized|authorised|eligible)/.test(v)) return 'Yes';
    if (/^(no|n|false|not authorized|not authorised|ineligible|require sponsorship)/.test(v)) return 'No';
    return null;
  }

  return {
    normalize: normalize,
    sleep: sleep,
    isVisible: isVisible,
    humanizeAttr: humanizeAttr,
    setNativeValue: setNativeValue,
    elementLabel: elementLabel,
    formatDate: formatDate,
    optionMatchScore: optionMatchScore,
    valueVariants: valueVariants,
    guessYesNo: guessYesNo
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalize: AFX.utils.normalize, formatDate: AFX.utils.formatDate, optionMatchScore: AFX.utils.optionMatchScore, guessYesNo: AFX.utils.guessYesNo };
}
