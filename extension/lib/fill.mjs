/**
 * The actual fill operation, shared by the extension content script and the
 * jsdom tests so what we test is what ships.
 *
 * Rules: never submit, never clear a field that already has a value (unless
 * asked), never touch password/captcha/consent-to-marketing controls, and
 * return an auditable log.
 */
import { mapKey, SELECTOR, pickOption, pickRadio, isFilled, isEditableControl } from './fieldmap.mjs';

const win = (el) => el.ownerDocument?.defaultView || globalThis;



const dispatch = (el) => {
  const w = win(el);
  for (const type of ['input', 'change', 'blur']) {
    try {
      el.dispatchEvent(new w.Event(type, { bubbles: true }));
    } catch {
      /* detached node or exotic element — value is already set */
    }
  }
};

function setNative(el, value) {
  const w = el.ownerDocument?.defaultView;
  let setter = null;
  if (w && el.tagName === 'TEXTAREA' && !isEditableControl(el)) {
    setter = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value')?.set;
  } else if (w && el.tagName === 'INPUT') {
    setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
  }
  if (setter) setter.call(el, String(value));
  else el.value = String(value);
}

export function fillControl(el, value, opts = {}) {
  if (!el) return { filled: false, why: 'control not found on this page' };
  if (value == null || value === '') return { filled: false, why: 'empty pack value' };
  if (el.disabled || el.readOnly) return { filled: false, why: 'read-only' };
  if (!opts.overwrite && isFilled(el)) return { filled: false, why: 'already filled' };

  if (el.tagName === 'SELECT') {
    const opt = pickOption(el, value);
    if (!opt) return { filled: false, why: 'no matching option' };
    if (opt.value === el.value) return { filled: false, why: 'already selected' };
    el.value = opt.value;
    dispatch(el);
    return { filled: true, via: 'select', value: opt.text.trim() || opt.value };
  }
  if (el.type === 'radio') {
    const name = el.getAttribute('name');
    if (!name) return { filled: false, why: 'radio without name' };
    const W = win(el);
    const root = (el.getRootNode && el.getRootNode()) || el.ownerDocument;
    const esc = W.CSS && W.CSS.escape ? W.CSS.escape(name) : String(name).replace(/["\\]/g, '');
    const group = [...(root && root.querySelectorAll ? root.querySelectorAll(`input[type=radio][name="${esc}"]`) : [])];
    const pick = pickRadio(group.length ? group : [el], value);
    if (!pick) return { filled: false, why: 'no matching radio option' };
    if (pick.checked) return { filled: false, why: 'already selected' };
    pick.checked = true;
    dispatch(pick);
    return { filled: true, via: 'radio', value: (pick.value || '').slice(0, 40) };
  }
  if (el.type === 'checkbox') {
    const want = /^(yes|true|1|i do|i am|i agree|agree)\b/i.test(String(value).trim());
    if (el.checked === want) return { filled: false, why: 'already set' };
    el.checked = want;
    dispatch(el);
    return { filled: true, via: 'checkbox', value: want ? 'checked' : 'unchecked' };
  }
  if (isEditableControl(el)) {
    el.textContent = String(value);
    const W = win(el);
    try {
      el.dispatchEvent(new W.InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
    } catch {
      el.dispatchEvent(new W.Event('input', { bubbles: true }));
    }
    return { filled: true, via: 'contenteditable', value: String(value).slice(0, 40) };
  }
  if (el.type === 'number') {
    let n = String(value).replace(/[^\d.\-]/g, '');
    if (/^0+$/.test(n)) n = '0';
    if (!n) return { filled: false, why: 'not numeric' };
    setNative(el, n);
    dispatch(el);
    return { filled: true, via: 'input', value: n };
  }
  if (el.type === 'email') {
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(value))) return { filled: false, why: 'not a valid email' };
    setNative(el, value);
    dispatch(el);
    return { filled: true, via: 'input', value: String(value).slice(0, 40) };
  }
  if (el.type === 'date') {
    const iso = String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0] || (String(value).match(/\d{4}/)?.[0] ? String(value).match(/\d{4}/)[0] + '-01-01' : '');
    if (!iso) return { filled: false, why: 'unparseable date' };
    setNative(el, iso.slice(0, 10));
    dispatch(el);
    return { filled: true, via: 'input', value: iso.slice(0, 10) };
  }
  setNative(el, value);
  dispatch(el);
  return { filled: true, via: 'input', value: String(value).slice(0, 60) };
}

export function visibleControls(doc, { onlyVisible = true } = {}) {
  return [...doc.querySelectorAll(SELECTOR)].filter((el) => {
    if (el.closest('#applyflow-panel')) return false;
    if (!onlyVisible) return true;
    if (typeof el.getBoundingClientRect !== 'function') return true;
    const r = el.getBoundingClientRect();
    if (r.width <= 4 || r.height <= 4) return false;
    const style = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });
}

/**
 * Fill an entire document from a pack.
 * Returns { filled, skipped, rows[], questions[] } — rows are per-control
 * audit records, questions lists label text we could not map at all.
 */
export function fillDocument(doc, pack, opts = {}) {
  const fields = pack?.fields || {};
  const rows = [];
  const usedKeys = new Set();
  const handledRadioGroups = new Set();
  let filled = 0;
  for (const el of visibleControls(doc, { onlyVisible: opts.onlyVisible !== false })) {
    const { key, source, label } = mapKey(el);
    if (!key) {
      rows.push({ control: tagOf(el), label: short(label), status: 'ignored', why: source || 'no label text' });
      continue;
    }
    // one decision per yes/no radio group — otherwise the first option of the
    // pair marks the whole group "already handled" and "No" can never win
    if (el.type === 'radio') {
      const groupKey = el.getAttribute('name') || (el.closest && el.closest('fieldset') ? `fs:${[...el.closest('fieldset').querySelectorAll('input')].indexOf(el)}` : key);
      if (handledRadioGroups.has(groupKey)) {
        rows.push({ control: tagOf(el), label: short(label), key, status: 'ignored', why: 'same radio group already handled' });
        continue;
      }
      handledRadioGroups.add(groupKey);
    }
    if (pack?.onlyEmpty && isFilled(el)) {
      rows.push({ control: tagOf(el), label: short(label), key, status: 'kept', why: 'already had a value' });
      continue;
    }
    const res = fillControl(el, fields[key], opts);
    if (res.filled) {
      filled++;
      usedKeys.add(key);
      rows.push({ control: tagOf(el), label: short(label), key, status: 'filled', via: res.via, sample: res.value });
    } else {
      rows.push({ control: tagOf(el), label: short(label), key, status: 'skipped', why: res.why });
    }
  }

  const answered = answerByLabel(doc, pack);
  filled += answered.filled;
  rows.push(...answered.rows);

  const unmapped = Object.keys(fields).filter((k) => fields[k] && !usedKeys.has(k) && !['cover.letter', 'summary'].includes(k));
  return { filled, skipped: rows.filter((r) => r.status === 'skipped').length, rows, unmapped, questions: [] };
}

function answerByLabel(doc, pack) {
  const rows = [];
  let filled = 0;
  for (const ans of pack?.answers || []) {
    const probe = String(ans.question || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 30).trim();
    if (probe.length < 8) continue;
    const nodes = [...doc.querySelectorAll('label, legend, [role="heading"], th, .question, [class*="question" i], [class*="label" i], p, span')];
    const target = nodes.find((n) => (n.textContent || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').includes(probe));
    if (!target) continue;
    const scope = target.closest('div, li, section, tr, fieldset, td') || target.parentElement;
    const input = scope && scope.querySelector('textarea, input[type=text], input[type=email], input[type=number], select, [contenteditable="true"]');
    if (!input) continue;
    const res = fillControl(input, ans.answer, { onlyEmpty: true });
    if (res.filled) {
      filled++;
      rows.push({ control: tagOf(input), label: short(target.textContent), key: 'answer:' + short(ans.question, 26), status: 'filled', via: 'question-match', sample: res.value });
    }
  }
  return { filled, rows };
}

const tagOf = (el) => (el.type ? `${el.tagName.toLowerCase()}[${el.type}]` : el.tagName.toLowerCase());
const short = (s, n = 46) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
