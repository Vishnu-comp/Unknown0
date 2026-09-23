/* AutoFill Pro - generic fill engine: walks page controls, matches labels to
   profile fields, fills values safely (works with React/Vue/Angular inputs). */
'use strict';

AFX.Engine = (function () {
  var U = AFX.utils;
  var AL = AFX.aliases;

  var SKIP_TYPE = ['submit', 'button', 'reset', 'image', 'file', 'hidden', 'search', 'password', 'color', 'range'];

  /** Resolve a profile value for a field key (derives names from fullName etc.). */
  function resolveValue(profile, key) {
    if (!profile) return '';
    var direct = profile[key];
    if (direct != null && String(direct).trim() !== '') return direct;

    var full = String(profile.fullName || '').trim();
    var parts = full.split(/\s+/).filter(Boolean);
    switch (key) {
      case 'firstName': return parts.length ? parts[0] : '';
      case 'lastName': return parts.length > 1 ? parts[parts.length - 1] : '';
      case 'middleName': return parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
    }
    return '';
  }

  /** Resolve the value + field key for a question/label.
      Explicit custom answers take priority over profile fields (user intent). */
  function resolveFor(profile, label) {
    var custom = AL.matchCustomAnswer(profile.customAnswers, label);
    if (custom) return { key: 'custom', value: custom };
    var m = AL.matchField(label);
    if (!m) return { key: null, value: '' };
    return { key: m.key, value: resolveValue(profile, m.key) };
  }

  function isTextLike(el) {
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'SELECT') return false;
    if (el.tagName === 'INPUT') {
      var t = (el.type || 'text').toLowerCase();
      return SKIP_TYPE.indexOf(t) < 0 && t !== 'checkbox' && t !== 'radio';
    }
    return el.isContentEditable === true;
  }

  function collectControls(root) {
    root = root || document;
    var els = root.querySelectorAll('input, textarea, select, [contenteditable="true"]');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!U.isVisible(el)) continue;
      if (el.tagName === 'INPUT' && SKIP_TYPE.indexOf((el.type || '').toLowerCase()) >= 0) continue;
      if (el.type === 'checkbox' || el.type === 'radio') continue; // handled as groups / singles below
      if (!isTextLike(el) && el.tagName !== 'SELECT') continue;
      out.push(el);
    }
    return out;
  }

  /** Fill one control with a display value. kind hints formatting (date etc.). */
  function fillControl(el, value, kind, labelText) {
    if (value == null || String(value) === '') return false;
    value = String(value);

    if (el.tagName === 'SELECT') return fillSelectOption(el, value);

    if (el.type === 'date') {
      var iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
      if (!iso) return false;
      U.setNativeValue(el, iso);
      return true;
    }

    if (kind === 'date' || (labelText && /\b(dob|date of birth|birth ?date|birthday)\b/i.test(labelText))) {
      value = U.formatDate(value, el.placeholder || el.getAttribute && el.getAttribute('aria-label') || labelText || '');
    }

    if (el.type === 'number') value = value.replace(/[^\d.\-]/g, '');
    if (el.type === 'email' && !/@/.test(value)) return false;
    if (el.type === 'url' && !/^(https?:\/\/|www\.|[\w-]+\.[a-z]{2,})/i.test(value)) {
      if (/^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i.test(value)) return false;
    }

    if (el.maxLength && el.maxLength > 0 && value.length > el.maxLength) {
      value = value.slice(0, el.maxLength);
    }

    U.setNativeValue(el, value);
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  /** Select the best matching <option> in a native select. */
  function fillSelectOption(select, value) {
    var opts = Array.prototype.slice.call(select.options || []);
    if (!opts.length) return false;

    // placeholder-ish first option check
    var best = null;
    for (var i = 0; i < opts.length; i++) {
      var text = (opts[i].text || opts[i].textContent || '').trim();
      if (!text || /^(select|choose|pick|please select|--|—|none)$/i.test(text)) continue;
      var score = U.optionMatchScore(text, value);
      if (score > 0 && (!best || score > best.score)) best = { opt: opts[i], score: score };
    }
    if (!best) {
      var yn = U.guessYesNo(value);
      if (yn) {
        for (var j = 0; j < opts.length; j++) {
          var t = (opts[j].text || opts[j].textContent || '').trim();
          if (U.normalize(t) === U.normalize(yn)) { best = { opt: opts[j], score: 1 }; break; }
        }
      }
    }
    if (!best) return false;
    select.value = best.opt.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /**
   * Fill a radio group. `nodes` = array of clickable option nodes
   * (input[type=radio] or [role=radio]). Returns true if one was chosen.
   */
  function fillRadioNodes(nodes, value) {
    if (!nodes || !nodes.length) return false;
    var best = null;
    nodes.forEach(function (n) {
      var text = (n.getAttribute && n.getAttribute('aria-label')) ||
        (n.labels && n.labels[0] && n.labels[0].textContent) ||
        (n.closest && (function () {
          var w = n.closest('label, [role="radio"], .docsshelfWidgetCollectionItem, .Od2TWd, label');
          return w ? (w.innerText || w.textContent) : '';
        })()) ||
        (n.getAttribute && n.getAttribute('data-value')) || '';
      var score = U.optionMatchScore(text, value);
      if (score > 0 && (!best || score > best.score)) best = { node: n, score: score };
    });
    if (!best) {
      var yn = U.guessYesNo(value);
      if (yn) {
        for (var i = 0; i < nodes.length; i++) {
          var t = (nodes[i].getAttribute('aria-label') || nodes[i].closest('label, [role="radio"]') && (nodes[i].closest('label, [role="radio"]').innerText || '') || nodes[i].getAttribute('data-value') || '');
          if (U.normalize(t).indexOf(U.normalize(yn)) === 0) { best = { node: nodes[i], score: 1 }; break; }
        }
      }
    }
    if (!best) return false;
    var el = best.node;
    el.click();
    if (el.type === 'radio') {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  /** Check matching checkboxes for a comma-separated value ("skill1, skill2"). */
  function fillCheckboxNodes(nodes, value) {
    if (!nodes || !nodes.length) return false;
    var wanted = String(value).split(/[,;|]/).map(function (s) { return U.normalize(s); }).filter(Boolean);
    var any = false;
    // single yes/no checkbox
    if (wanted.length === 1 && /^(yes|no|true|false)$/.test(wanted[0])) {
      return fillRadioNodes(nodes, value);
    }
    nodes.forEach(function (n) {
      var text = U.normalize((n.getAttribute('aria-label') || '') + ' ' +
        (n.closest('label') ? n.closest('label').innerText : '') + ' ' +
        (n.getAttribute('data-value') || ''));
      var hit = wanted.some(function (w) {
        return w && (text.indexOf(w) >= 0 || w.indexOf(text) >= 0 && text.length > 2);
      });
      if (hit) {
        n.click();
        if (n.type === 'checkbox') {
          n.checked = true;
          n.dispatchEvent(new Event('change', { bubbles: true }));
        }
        any = true;
      }
    });
    return any;
  }

  /** Single checkbox bound to a yes/no field. */
  function fillSingleCheckbox(el, value) {
    var yn = U.guessYesNo(value);
    var want = yn ? yn === 'Yes' : !!String(value).trim();
    el.checked = want;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('click', { bubbles: true }));
    el.checked = want;
    return true;
  }

  function highlight(el) {
    try {
      var prev = el.style.outline;
      el.style.outline = '2px solid #22c55e';
      el.style.outlineOffset = '1px';
      el.scrollIntoView && el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(function () { el.style.outline = prev || ''; }, 1800);
    } catch (e) { /* ignore */ }
  }

  /** Attach a stored resume ({name, type, dataBase64}) to a file input. */
  function attachResume(fileInput, resume) {
    if (!fileInput || !resume || !resume.dataBase64) return false;
    try {
      var bin = atob(resume.dataBase64);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var file = new File([arr], resume.name || 'resume.pdf', { type: resume.type || 'application/pdf' });
      var dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function fillFiles(root, profile, stats) {
    var files = (root || document).querySelectorAll('input[type="file"]');
    for (var i = 0; i < files.length; i++) {
      var el = files[i];
      if (!U.isVisible(el)) continue;
      var accept = (el.accept || '').toLowerCase();
      var label = U.elementLabel(el) + ' ' + (el.closest('section, [class*="section"], div') && el.closest('section, [class*="section"], div').innerText || '');
      if (profile.resume && profile.resume.dataBase64 && /pdf|docx?|resume|cv/i.test(accept + ' ' + label)) {
        if (attachResume(el, profile.resume)) {
          stats.filled++;
          stats.files = (stats.files || 0) + 1;
          if (settings.highlight) highlight(el);
        }
      }
    }
  }

  var settings = { highlight: true };

  /**
   * Generic page fill. `opts.labelFn(el)` may override label extraction
   * (used by Google Forms question cards). `opts.root` limits the search.
   */
  function fillAll(profile, opts) {
    opts = opts || {};
    settings.highlight = opts.highlight !== false;
    var root = opts.root || document;
    var stats = { filled: 0, skipped: 0, fields: {} };

    function record(key, ok, el) {
      if (ok) {
        stats.filled++;
        stats.fields[key || 'custom'] = (stats.fields[key || 'custom'] || 0) + 1;
        if (settings.highlight) highlight(el);
      } else {
        stats.skipped++;
      }
    }

    // ---- pass 1: text-like inputs, textareas, selects, contenteditable ----
    var controls = collectControls(root);

    controls.forEach(function (el) {
      var label = opts.labelFn ? opts.labelFn(el) : U.elementLabel(el);
      var r = resolveFor(profile, label);
      if (!r.value) { stats.skipped++; return; }
      var fieldMeta = r.key !== 'custom' ? AL.fieldBy[r.key] : null;
      record(r.key, fillControl(el, r.value, fieldMeta && fieldMeta.type, label), el);
    });

    // ---- pass 2: radio groups ----
    var radios = root.querySelectorAll('input[type="radio"], [role="radio"]');
    var groups = [];
    Array.prototype.forEach.call(radios, function (r) {
      if (!U.isVisible(r)) return;
      var container = r.closest('[role="radiogroup"], fieldset, [class*="question"], [data-automation-id], li, form') || r.parentElement;
      var g = groups.find(function (x) {
        return x.container === container || (r.name && x.name === r.name);
      });
      if (!g) {
        // derive a label for the whole group: prefer the legend/question heading
        // over the individual option text ("Yes"/"No")
        var labelEl = container && container.querySelector('legend, [role="heading"], .title, [class*="title"], [class*="label"]');
        var label = opts.labelFn ? opts.labelFn(r)
          : (labelEl ? (labelEl.innerText || labelEl.textContent) : U.elementLabel(r));
        if (r.name && (!label || label.length < 3)) {
          var first = container && container.querySelector('input[type="radio"][name="' + r.name + '"], [role="radio"]');
          if (first) label = opts.labelFn ? opts.labelFn(first) : U.elementLabel(first);
        }
        g = { container: container, name: r.name || null, nodes: [], label: label || (container && container.innerText || '').split('\n')[0] };
        groups.push(g);
      }
      g.nodes.push(r);
    });

    groups.forEach(function (g) {
      var r = resolveFor(profile, g.label);
      if (!r.value) { stats.skipped++; return; }
      record(r.key, fillRadioNodes(g.nodes, r.value), g.nodes[0]);
    });

    // ---- pass 3: checkbox groups + single checkboxes ----
    var boxes = root.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
    var cbGroups = [];
    Array.prototype.forEach.call(boxes, function (r) {
      if (!U.isVisible(r)) return;
      var container = r.closest('[role="group"], fieldset, [class*="question"], [data-automation-id], li, form') || r.parentElement;
      var g = cbGroups.find(function (x) {
        return x.container === container || (r.name && x.name === r.name);
      });
      if (!g) {
        var labelEl = container && container.querySelector('legend, [role="heading"], .title, [class*="title"], [class*="label"]');
        var labelText = labelEl ? (labelEl.innerText || labelEl.textContent) : (opts.labelFn ? opts.labelFn(r) : U.elementLabel(r));
        g = { container: container, name: r.name || null, nodes: [], label: labelText };
        cbGroups.push(g);
      }
      g.nodes.push(r);
    });

    cbGroups.forEach(function (g) {
      var r = resolveFor(profile, g.label);
      if (!r.value) { stats.skipped++; return; }
      var ok = g.nodes.length === 1 && !/[,;|]/.test(String(r.value))
        ? fillSingleCheckbox(g.nodes[0], r.value)
        : fillCheckboxNodes(g.nodes, r.value);
      record(r.key, ok, g.nodes[0]);
    });

    // ---- pass 4: resume file inputs ----
    if (profile.resume && profile.resume.dataBase64 && opts.fillFiles !== false) {
      fillFiles(root, profile, stats);
    }

    return stats;
  }

  return {
    fillAll: fillAll,
    fillControl: fillControl,
    fillSelectOption: fillSelectOption,
    fillRadioNodes: fillRadioNodes,
    fillCheckboxNodes: fillCheckboxNodes,
    fillFiles: fillFiles,
    attachResume: attachResume,
    resolveValue: resolveValue,
    resolveFor: resolveFor,
    collectControls: collectControls
  };
})();
