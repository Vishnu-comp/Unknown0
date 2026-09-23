/* AutoFill Pro - Google Forms adapter.
   Understands question cards: text, paragraph, radio, checkbox, dropdown,
   linear scale, date and "Other" option follow-ups. */
'use strict';

AFX.adapters = AFX.adapters || {};

AFX.adapters['google-forms'] = (function () {
  var U = AFX.utils;
  var E = AFX.Engine;
  var AL = AFX.aliases;

  function detect() {
    return /(^|\.)docs\.google\.com$/.test(location.hostname) && /\/forms\//.test(location.pathname);
  }

  function questionCards() {
    var cards = document.querySelectorAll('div[role="listitem"]');
    if (!cards.length) cards = document.querySelectorAll('.freebirdFormviewerViewItemsItemItem, .Qr7Oae');
    return Array.prototype.slice.call(cards);
  }

  function questionText(card) {
    var h = card.querySelector('[role="heading"] span, span.freebirdFormviewerViewItemsItemItemTitle, .M7eMe, [role="heading"]');
    var t = h ? (h.innerText || h.textContent) : '';
    if (!t) {
      var first = card.querySelector('span, label, legend');
      t = first ? (first.innerText || first.textContent) : '';
    }
    // strip required-asterisk and descriptions (take first line)
    return String(t || '').replace(/\*/g, '').split('\n')[0].trim();
  }

  function pickRadioOrCheck(nodes, value, multi) {
    if (!nodes.length) return false;
    var best = null;
    nodes.forEach(function (n) {
      var text = n.getAttribute('aria-label') || n.getAttribute('data-value') ||
        (n.closest('[role="radio"], [role="checkbox"], label') && (n.closest('[role="radio"], [role="checkbox"], label').innerText || '')) || '';
      var score = U.optionMatchScore(text, value);
      if (score > 0 && (!best || score > best.score)) best = { node: n, score: score, text: text };
    });

    // Google Forms "Other" option: reveal + fill the text box
    var other = nodes.find(function (n) {
      var t = (n.getAttribute('aria-label') || n.getAttribute('data-value') || '').toLowerCase();
      return t.indexOf('other') === 0 || t === '__other_option__';
    });
    var isShortAnswerChoice = best && best.score > 0;
    if (!isShortAnswerChoice && other) {
      other.click();
      return true; // caller will fill revealed input via custom answer pass
    }
    if (!best) {
      var yn = U.guessYesNo(value);
      if (yn) {
        for (var i = 0; i < nodes.length; i++) {
          var t2 = (nodes[i].getAttribute('aria-label') || nodes[i].getAttribute('data-value') || '');
          if (U.normalize(t2).indexOf(U.normalize(yn)) === 0) { best = { node: nodes[i], score: 1 }; break; }
        }
      }
    }
    if (!best) return false;
    if (multi) {
      var wanted = String(value).split(/[,;|]/).map(function (s) { return U.normalize(s); }).filter(Boolean);
      var any = false;
      nodes.forEach(function (n) {
        var text = U.normalize(n.getAttribute('aria-label') || n.getAttribute('data-value') || '');
        if (wanted.some(function (w) { return w && text.indexOf(w) >= 0; })) { n.click(); any = true; }
      });
      return any;
    }
    best.node.click();
    return true;
  }

  async function fillDateQuestion(card, iso) {
    var parts = {};
    ['Month', 'Day', 'Year'].forEach(function (name) {
      var el = card.querySelector('input[aria-label="' + name + '"], input[placeholder="' + name + '"], input[aria-label^="' + name + '"]');
      if (el) parts[name.toLowerCase()] = el;
    });
    if (!parts.month && !parts.day && !parts.year) {
      var single = card.querySelector('input[placeholder*="MM"], input[placeholder*="DD"], input[placeholder*="YYYY"]');
      if (single) {
        U.setNativeValue(single, U.formatDate(iso, single.placeholder || ''));
        return true;
      }
      return false;
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return false;
    if (parts.month) {
      if (parts.month.tagName === 'SELECT') E.fillSelectOption(parts.month, String(parseInt(m[2], 10)));
      else U.setNativeValue(parts.month, String(parseInt(m[2], 10)));
    }
    if (parts.day) U.setNativeValue(parts.day, String(parseInt(m[3], 10)));
    if (parts.year) U.setNativeValue(parts.year, m[1]);
    return true;
  }

  async function fillDropdown(card, value) {
    var trigger = card.querySelector('div[role="listbox"]');
    if (!trigger) return false;
    trigger.click();
    await U.sleep(350);
    var options = document.querySelectorAll('[role="listbox"] [role="option"], [role="option"], .exportSelectPopup li, li[data-value]');
    var visible = Array.prototype.filter.call(options, U.isVisible);
    var best = null;
    visible.forEach(function (o) {
      var score = U.optionMatchScore(o.innerText || o.textContent || o.getAttribute('data-value') || '', value);
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
    return true;
  }

  function isDateQuestion(card) {
    return !!card.querySelector('input[aria-label="Year"], input[placeholder="YYYY"], input[placeholder*="MM/DD"], input[placeholder*="DD/MM"], input[aria-label="Month"]');
  }

  async function fillOneCard(card, profile) {
    var q = questionText(card);
    if (!q) return false;
    // explicit custom answers take priority (user intent), then profile fields
    var value = AL.matchCustomAnswer(profile.customAnswers, q) || '';
    var key = 'custom';
    if (!value) {
      var match = AL.matchField(q);
      key = match ? match.key : null;
      value = key ? E.resolveValue(profile, key) : '';
    }
    if (!value && !(key === 'dob' && profile.dob)) return false;

    if (key === 'dob' && profile.dob && isDateQuestion(card)) {
      return fillDateQuestion(card, profile.dob);
    }

    var radios = Array.prototype.filter.call(card.querySelectorAll('[role="radio"]'), U.isVisible);
    if (radios.length) return pickRadioOrCheck(radios, value, false);

    var checks = Array.prototype.filter.call(card.querySelectorAll('[role="checkbox"]'), U.isVisible);
    if (checks.length) return pickRadioOrCheck(checks, value, true);

    if (card.querySelector('div[role="listbox"]')) return fillDropdown(card, value);

    var textarea = card.querySelector('textarea');
    if (textarea && U.isVisible(textarea)) {
      U.setNativeValue(textarea, value);
      return true;
    }

    var input = card.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type])');
    if (input && U.isVisible(input)) {
      if (isDateQuestion(card) && key === 'dob') return fillDateQuestion(card, profile.dob);
      return E.fillControl(input, value, key !== 'custom' ? AL.fieldBy[key].type : null, q);
    }

    return false;
  }

  async function fill(profile) {
    var stats = { filled: 0, skipped: 0, fields: {} };
    var cards = questionCards();
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var ok = await fillOneCard(card, profile);
      if (ok) {
        stats.filled++;
        var q = questionText(card);
        var m = AL.matchField(q);
        var k = m ? m.key : 'custom';
        stats.fields[k] = (stats.fields[k] || 0) + 1;
      } else {
        stats.skipped++;
      }
    }
    return stats;
  }

  return { id: 'google-forms', name: 'Google Forms', detect: detect, fill: fill };
})();
