/**
 * ApplyFlow content script — prefill application forms inside YOUR browser session.
 *
 * Design rules:
 *  1. never submit a form, never click anything that sends data
 *  2. never touch password / captcha / token / marketing-opt-in controls
 *  3. every write is logged in the floating panel so you can audit it
 *  4. already-filled controls are left alone unless told otherwise
 *
 * The mapping + fill logic is shared with the server (extension/lib/*.mjs,
 * copied from server/lib by `npm run sync:extension`) and unit-tested with
 * jsdom in scripts/fieldmap.test.mjs — so this file is a thin transport layer.
 */
(async () => {
  if (window.__applyflow) return;
  window.__applyflow = true;

  let engine = null;
  let harvest = null;
  try {
    const [fm, fl, hv] = await Promise.all([
      import(chrome.runtime.getURL('lib/fieldmap.mjs')),
      import(chrome.runtime.getURL('lib/fill.mjs')),
      import(chrome.runtime.getURL('lib/harvest.mjs')).catch(() => null),
    ]);
    harvest = hv;
    engine = { mapKey: fm.mapKey, fillDocument: fl.fillDocument, fillControl: fl.fillControl, visibleControls: fl.visibleControls, isFilled: fl.isFilled, PATTERNS: fm.PATTERNS, SELECTOR: fm.SELECTOR };
  } catch (e) {
    /* fall back to the built-in map below */
  }

  /* ------------------------- fallback (self-contained) ------------------------ */
  const FALLBACK_PATTERNS = [
    [/first\s*name|given\s*name|fname|preferred\s*name/i, 'first.name'],
    [/last\s*name|family\s*name|surname|lname/i, 'last.name'],
    [/e-?mail/i, 'email'],
    [/\b(phone|mobile|telephone|cell)\b|contact[_\s-]*number/i, 'phone'],
    [/current\s*(employer|company)|\bemployer\b/i, 'current.company'],
    [/job\s*title|current\s*(title|position|role)/i, 'current.title'],
    [/years\s*of\s*experience|\byoe\b/i, 'experience.years'],
    [/work\s*authoriz|authorized\s+to\s+work|right\s+to\s+work/i, 'work.authorized'],
    [/sponsor|visa/i, 'requires.sponsorship'],
    [/notice\s*period|available\s*from|earliest\s*start/i, 'notice.period'],
    [/background[\s_-]*check/i, 'background.agree'],
    [/relocat/i, 'relocate.willing'],
    [/cover\s*letter|additional\s*info/i, 'cover.letter'],
    [/school|university|college/i, 'education.school'],
    [/degree|qualification/i, 'education.degree'],
    [/salary/i, 'salary.expected'],
    [/location|where\s+are\s+you\s+based/i, 'location'],
    [/linkedin/i, 'linkedin'],
    [/github/i, 'github'],
    [/portfolio|website/i, 'portfolio'],
    [/referral|how\s+did\s+you\s+hear/i, 'referral'],
    [/^name$|full\s*name|your\s*name/i, 'full.name'],
  ];
  const NEVER = /captcha|recaptcha|password|otp|csrf|signature|ssn|bank|routing|newsletter|opt-?in|marketing/i;
  const FALLBACK_SELECTOR = 'input:not([type=hidden]):not([type=file]):not([type=password]),textarea,select,[contenteditable="true"],[data-qa-field]';

  function fallbackKey(el) {
    if (el.dataset?.qaField) return el.dataset.qaField;
    const label = [
      el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('placeholder'), el.getAttribute('aria-label'),
      el.getAttribute('data-test'), el.getAttribute('data-qa'), el.getAttribute('autocomplete'),
      el.labels && [...el.labels].map((l) => l.textContent).join(' '),
      el.closest('label')?.textContent,
      el.nextElementSibling?.textContent,
      el.closest('fieldset')?.querySelector('legend')?.textContent,
    ].filter(Boolean).join(' | ');
    if (NEVER.test(label)) return null;
    for (const [rx, key] of FALLBACK_PATTERNS) if (rx.test(label)) return key;
    return null;
  }

  function fallbackVisible() {
    return [...document.querySelectorAll(FALLBACK_SELECTOR)].filter((el) => {
      if (el.closest('#applyflow-panel')) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 6 && r.height > 6 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
  }

  const labelOf = (el) => (el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.tagName.toLowerCase()).slice(0, 32);

  function fallbackFill(pack) {
    let filled = 0;
    const fields = pack?.fields || {};
    for (const el of fallbackVisible()) {
      const key = fallbackKey(el);
      if (!key) continue;
      const res = fallbackSet(el, fields[key], pack.onlyEmpty);
      if (res) {
        filled++;
        note(`filled ${key} (${labelOf(el)})`, 'fill');
      }
    }
    return filled;
  }

  function fallbackSet(el, value, onlyEmpty) {
    if (value == null || value === '') return false;
    if (onlyEmpty && (el.value || el.checked)) return false;
    if (el.type === 'radio') {
      const name = el.getAttribute('name');
      const wantYes = /^(yes|true|1|i do|i agree)\b/i.test(String(value));
      const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)];
      const hit = group.find((g) => (wantYes ? /^(yes|true|1|i do|i agree)/i : /^(no|none|not|prefer)/i).test(`${g.value} ${g.closest('label')?.textContent || ''}`));
      if (hit && !hit.checked) hit.click();
      return Boolean(hit);
    }
    if (el.type === 'checkbox') {
      const want = /^(yes|true|1|i do|i agree)\b/i.test(String(value));
      if (el.checked !== want) el.click();
      return true;
    }
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find((o) => `${o.text} ${o.value}`.toLowerCase().includes(String(value).toLowerCase().slice(0, 12)));
      if (!opt) return false;
      el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.style.outline = '2px solid rgba(16,185,129,.55)';
    setTimeout(() => (el.style.outline = ''), 1800);
    return true;
  }

  /* --------------------------------- overlay -------------------------------- */
  const log = [];
  let panel = null;
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = 'applyflow-panel';
    panel.innerHTML =
      '<div id="applyflow-head"><b>ApplyFlow</b><span id="applyflow-count"></span><button id="applyflow-toggle" title="minimise">–</button></div><div id="applyflow-log"></div>';
    document.documentElement.appendChild(panel);
    panel.querySelector('#applyflow-toggle').addEventListener('click', () => panel.classList.toggle('min'));
    return panel;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function note(msg, kind = 'ok') {
    log.unshift({ msg, kind, at: new Date().toLocaleTimeString() });
    const el = ensurePanel().querySelector('#applyflow-log');
    el.innerHTML = log.slice(0, 40).map((l) => `<div class="af-row af-${l.kind}"><span>${l.at}</span> ${esc(l.msg)}</div>`).join('');
    ensurePanel().querySelector('#applyflow-count').textContent = `${log.filter((l) => l.kind === 'fill').length} field(s) filled`;
  }

  /* -------------------------------- handlers -------------------------------- */
  const packFrom = (msg) => msg.pack || null;

  function runFill(pack, opts) {
    if (engine) {
      const res = engine.fillDocument(document, pack, opts);
      for (const row of res.rows.filter((r) => r.status === 'filled')) note(`${row.key} → ${row.control} (${row.via})`, 'fill');
      const skipped = res.rows.filter((r) => r.status === 'skipped');
      if (skipped.length) note(`${skipped.length} control(s) skipped: ${skipped.slice(0, 3).map((s) => s.why).join('; ')}`, 'warn');
      if (res.unmapped.length) note(`pack values with no control here: ${res.unmapped.slice(0, 6).join(', ')}`, 'dim');
      note(res.filled ? `done — ${res.filled} field(s) filled, nothing submitted` : 'no fillable controls matched on this page', res.filled ? 'ok' : 'warn');
      return res;
    }
    const filled = fallbackFill(pack);
    note(`done (fallback mapper) — ${filled} filled`, filled ? 'ok' : 'warn');
    return { filled };
  }

  function survey() {
    if (engine) {
      const rows = engine.visibleControls(document, { onlyVisible: true }).map((el) => {
        const { key, source } = engine.mapKey(el);
        return { label: labelOf(el), key: key || null, why: key ? 'mapped' : source, value: (el.value || '').slice(0, 34), type: el.type || el.tagName.toLowerCase() };
      });
      return { ok: true, rows, engine: 'shared' };
    }
    return { ok: true, engine: 'fallback', rows: fallbackVisible().map((el) => ({ label: labelOf(el), key: fallbackKey(el), value: (el.value || '').slice(0, 34), type: el.type || el.tagName.toLowerCase() })) };
  }


  /* ---- harvesting the page you are already looking at -----------------------
     Read-only: no clicks, no navigation, no form writes, no cookies, no tokens.
     The shared module (extension/lib/harvest.mjs, copied from server/lib by
     `npm run build`) is the ONLY implementation. There is deliberately no
     regex-over-markup fallback here: during development a regex pass produced
     "Senior Java Engineer Acme Tech 2-5 Yrs ₹12-18 LPA" as a job title, and a
     wrong-but-plausible job is worse than no job — it flows into a score, a
     letter and a real application form. */
  async function harvestHere(msg) {
    const limit = Math.min(50, Math.max(1, Number(msg?.limit || 25)));
    const host = location.hostname;
    if (!harvest) return { ok: false, error: 'lib/harvest.mjs did not load — run npm run build, then reload the extension at chrome://extensions' };
    if (host === 'www.linkedin.com' || host === 'linkedin.com') {
      const jobs =
        /\/jobs\/view\//.test(location.pathname) && harvest.scrapeLinkedInDetail
          ? [harvest.scrapeLinkedInDetail(harvestDoc(), location)].filter(Boolean)
          : harvest.scrapeLinkedIn(harvestDoc(), { limit });
      if (jobs.length) return { ok: true, source: 'linkedin', jobs, host };
      return { ok: false, error: 'no job cards found here — scroll the results list so LinkedIn renders them, then retry (they are lazy-loaded)' };
    }
    if (host.endsWith('naukri.com')) {
      const jobs = harvest.scrapeNaukri ? harvest.scrapeNaukri(harvestDoc(), location, { limit }) : [];
      if (jobs.length) return { ok: true, source: 'naukri', jobs, host };
      return { ok: false, error: 'no Naukri result rows found on this page — open a /job-listings-… search URL and try again' };
    }
    return { ok: false, error: `this page (${host}) is not a known job-results layout — LinkedIn search/view and Naukri search are supported` };
  }

  const harvestDoc = () => document;

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    (async () => {
      try {
        switch (msg?.type) {
          case 'ping': {
            const list = engine ? engine.visibleControls(document, { onlyVisible: true }) : fallbackVisible();
            return respond({ ok: true, url: location.href, fields: list.length, engine: engine ? 'shared' : 'fallback' });
          }
          case 'fill':
            return respond({ ok: true, ...runFill(packFrom(msg), { overwrite: false }) });
          case 'fillOverwrite':
            return respond({ ok: true, ...runFill(packFrom(msg), { overwrite: true }) });
          case 'autofill': {
            const pack = packFrom(msg) || (await chrome.storage?.local?.get?.('pack'))?.pack;
            const onlyEmptyPack = { ...(pack || {}), onlyEmpty: true };
            return respond({ ok: true, ...runFill(onlyEmptyPack, { overwrite: false }) });
          }
          case 'pasteFocused': {
            const el = document.activeElement;
            if (!el || el === document.body) return respond({ ok: false, error: 'click the target field first' });
            const text = typeof msg.text === 'string' ? msg.text : '';
            const res = engine
              ? engine.fillControl(el, text, { overwrite: true })
              : { filled: fallbackSet(el, text, false) };
            note(res.filled ? `pasted ${text.length} chars into focused field` : 'focused element is not fillable', res.filled ? 'fill' : 'warn');
            return respond({ ok: Boolean(res.filled), why: res.why });
          }
          case 'survey':
            return respond(survey());
          case 'harvest':
            return respond(await harvestHere(msg));
          case 'harvestPush': {
            const r = await harvestHere(msg);
            if (!r.ok) return respond(r);
            const stored = (await chrome.storage?.local?.get?.('serverUrl'))?.serverUrl;
            const base = (msg.baseUrl || stored || 'http://127.0.0.1:3000').replace(/\/+$/, '');
            try {
              const res = await fetch(`${base}/api/jobs/import`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ source: r.source, jobs: r.jobs }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) return respond({ ok: false, error: data.error || `HTTP ${res.status} from ${base}` });
              note(`imported ${data.imported} of ${r.jobs.length} from ${location.hostname} · store now ${data.total}`, 'ok');
              return respond({ ok: true, ...data, scraped: r.jobs.length, source: r.source });
            } catch (e) {
              return respond({ ok: false, error: `could not reach ApplyFlow at ${base} (${e.message}). Set the address in the popup; the app must be running.` });
            }
          }
          case 'clearMarks':
            document.querySelectorAll('#applyflow-panel').forEach((n) => n.remove());
            panel = null;
            return respond({ ok: true });
          default:
            return respond({ ok: false, error: `unknown message ${msg?.type}` });
        }
      } catch (e) {
        return respond({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  });

  note(`ready on ${location.hostname} · ${engine ? 'shared mapper' : 'fallback mapper'}`, 'dim');

  /* optional: fill empty fields as soon as an application-looking page appears */
  setTimeout(async () => {
    let cfg = null;
    try {
      cfg = await chrome.runtime.sendMessage({ type: 'applyflow:boot-config' });
    } catch {
      return note('popup not woken yet — click the toolbar icon once to share storage', 'dim');
    }
    if (!cfg?.ok || !cfg.autoOnOpen || !cfg.pack) return;
    if (!/job|applic|career|apply|posting|role|opening/i.test(`${location.href} ${document.title}`)) return;
    let tries = 0;
    const tick = setInterval(() => {
      const res = runFill({ ...cfg.pack, onlyEmpty: true }, { overwrite: false });
      if (res.filled || ++tries > 10) {
        clearInterval(tick);
        if (!res.filled) note('autofill found nothing new to write', 'dim');
      }
    }, 700);
  }, 900);
})();
