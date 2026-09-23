/* ApplyFlow popup: pack store + content-script bridge. */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = { pack: null, batch: null };

async function load() {
  const { pack, autoOnOpen, log, serverUrl, harvestLimit } = await chrome.storage.local.get(['pack', 'autoOnOpen', 'log', 'serverUrl', 'harvestLimit']);
  state.pack = pack || null;
  $('#autoOnOpen').checked = Boolean(autoOnOpen);
  /* The address is remembered here rather than hardcoded: dev runs on :3000, but a
     tunnel or a box on the LAN needs a different host, and the content script reads
     the same key. */
  $('#serverUrl').value = serverUrl || '';
  $('#harvestLimit').value = harvestLimit || 25;
  render();
  $('#log').innerHTML = (log || []).map((l) => `<div>${l}</div>`).join('') || '<div>no actions yet</div>';
}

async function pushLog(line) {
  const { log = [] } = await chrome.storage.local.get('log');
  log.unshift(`${new Date().toLocaleTimeString()} · ${line}`);
  await chrome.storage.local.set({ log: log.slice(0, 60) });
}

function render() {
  const p = state.pack;
  const el = $('#pack-summary');
  if (!p) {
    el.innerHTML = '<div class="empty">no pack loaded — open “Import pack”</div>';
    $('#fill').disabled = true;
    return;
  }
  $('#fill').disabled = false;
  el.innerHTML = `
    <div class="row" style="align-items:flex-start">
      <div class="score">${p.match?.score ?? '–'}</div>
      <div style="flex:1;min-width:0">
        <b>${esc(p.job?.title || 'untitled role')}</b><br />
        <span class="muted">${esc(p.job?.company || '')} · ${esc(Object.keys(p.fields || {}).filter((k) => p.fields[k]).length + ' fields mapped')}</span>
      </div>
    </div>
    ${p.letter ? `<div class="row" style="margin-top:8px"><span class="tag">letter ${p.letter.split(/\s+/).length} words</span><span class="tag">${(p.answers || []).length} answers</span>${p.checklist?.warnings?.length ? `<span class="warn">⚠ ${p.checklist.warnings.length} warning(s)</span>` : '<span class="ok">no warnings</span>'}</div>` : ''}
  `;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function adopt(pack, label) {
  state.pack = pack;
  chrome.storage.local.set({ pack });
  render();
  pushLog(`loaded pack: ${label || pack.job?.title || 'manual'}`);
  $('#paste-status').textContent = '✓ loaded';
  $('#paste-status').className = 'ok';
}

function normalizePack(raw) {
  const p = raw?.kind === 'applyflow.prefill' ? raw.payload : raw?.payload || raw;
  if (!p?.fields) throw new Error('no .payload.fields in that JSON — is this an ApplyFlow export?');
  return { ...p, letter: (raw?.letter || p.fields['cover.letter'] || '').trim(), answers: raw?.answers || p.answers || [], checklist: raw?.checklist || p.checklist };
}

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

async function send(msg) {
  const t = await activeTab();
  if (!t?.id) return { ok: false, error: 'no active tab' };
  if (/^(chrome|about|edge|devtools):/.test(t.url || '')) return { ok: false, error: 'open the application page first' };
  try {
    return await chrome.tabs.sendMessage(t.id, msg);
  } catch (e) {
    // content script not present (e.g. installed after the tab was opened)
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ['content.css'] });
      return await chrome.tabs.sendMessage(t.id, msg);
    } catch (err) {
      return { ok: false, error: `cannot inject into ${t.url} — reload that tab` };
    }
  }
}

$$('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    ['apply', 'pack', 'harvest', 'log', 'about'].forEach((t) => ($('#tab-' + t).hidden = t !== b.dataset.t));
  })
);

$('#fill').addEventListener('click', async () => {
  const r = await send({ type: 'fill', pack: state.pack });
  pushLog(`fill → ${r?.filled ?? 0} fields${r?.error ? ' · ' + r.error : ''}`);
  if (r?.error) alert(r.error);
});

$('#autofill').addEventListener('click', async () => {
  const r = await send({ type: 'autofill', pack: state.pack });
  pushLog(`autofill → ${r?.touched ?? 0}`);
  if (r?.error) alert(r.error);
});

$('#survey').addEventListener('click', async () => {
  const r = await send({ type: 'survey' });
  const box = $('#log');
  const rows = (r?.rows || []).map((x) => `<div class="${x.key ? 'ok' : 'muted'}">${x.key ? '✓' : '·'} ${esc(x.label)} → ${x.key || '<i>unmapped</i>'} <span class="muted">${esc(x.value)}</span></div>`).join('');
  box.innerHTML = rows || '<div>no inputs found on this page</div>';
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === 'log'));
  ['apply', 'pack', 'harvest', 'about'].forEach((t) => ($('#tab-' + t).hidden = true));
  $('#tab-log').hidden = false;
});

$('#askSite').addEventListener('click', async () => {
  const box = $('#site-status');
  const t = await activeTab();
  if (!t?.url || !/^https?:\/\//i.test(t.url)) {
    box.textContent = 'this tab is not a web page I can ask about';
    return;
  }
  box.textContent = 'asking your local server…';
  /* the lookup lives in the worker (a popup is a page of its own: it cannot fetch
     localhost with the same origin rules, and the worker already owns the answer) */
  let r = null;
  try {
    r = await chrome.runtime.sendMessage({ type: 'applyflow:page-opened', url: t.url, tabIdHint: t.id });
  } catch (e) {
    box.textContent = 'the worker did not answer — reopen the popup once to wake it';
    return;
  }
  if (!r?.ok) {
    box.textContent = r?.error || 'lookup failed';
    return;
  }
  if (!r.found) {
    box.textContent = 'nothing drafted matches this page — open the job in ApplyFlow and draft a pack first';
    return;
  }
  box.textContent = `${r.found} pack(s) — best: ${r.reason || 'unranked'}${r.fill ? ' · filling' : ' · not auto-filling (you can fill manually)'}`;
  if (r.pack?.fields) {
    state.pack = r.pack;
    const f = await send({ type: 'autofill', pack: r.pack });
    box.textContent += ` · wrote ${f?.touched ?? 0} empty field(s)`;
  }
});

$('#pasteFocused').addEventListener('click', async () => {
  if (!state.pack?.letter) return alert('no letter in the loaded pack');
  const r = await send({ type: 'pasteFocused', text: state.pack.letter });
  if (r?.error) alert(r.error);
  else pushLog('pasted letter into focused field');
});

$('#clear').addEventListener('click', () => send({ type: 'clearMarks' }));

$('#autoOnOpen').addEventListener('change', (e) => {
  chrome.storage.local.set({ autoOnOpen: e.target.checked });
  pushLog(`auto-on-load ${e.target.checked ? 'on' : 'off'}`);
});

$('#paste').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#loadPaste').click();
});
$('#loadPaste').addEventListener('click', () => {
  try {
    adopt(normalizePack(JSON.parse($('#paste').value.trim())), 'pasted');
  } catch (err) {
    $('#paste-status').textContent = err.message;
    $('#paste-status').className = 'warn';
  }
});

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const text = await f.text();
  try {
    const json = JSON.parse(text);
    if (json.kind === 'applyflow.prefill-batch') {
      state.batch = json.packs || [];
      $('#batch-box').hidden = false;
      $('#batch-list').innerHTML = state.batch
        .map(
          (p, i) =>
            `<div data-i="${i}" style="cursor:pointer" class="batchrow">${p.score ?? '–'} · <b>${esc(p.job?.title || '')}</b> @ ${esc(p.job?.company || '')} <span class="muted">${esc(p.source || '')}</span></div>`
        )
        .join('');
      $$('.batchrow').forEach((r) =>
        r.addEventListener('click', () => {
          const p = state.batch[Number(r.dataset.i)];
          adopt(normalizePack({ payload: p, letter: p.letter, answers: p.answers }), p.job?.title);
          $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === 'apply'));
          ['pack', 'log', 'about'].forEach((t) => ($('#tab-' + t).hidden = true));
          $('#tab-apply').hidden = false;
        })
      );
      $('#paste-status').textContent = `${state.batch.length} jobs — click one`;
      return;
    }
    adopt(normalizePack(json), json.payload?.job?.title);
  } catch (err) {
    $('#paste-status').textContent = 'parse error: ' + err.message;
    $('#paste-status').className = 'warn';
  }
});

$('#copyLetter').addEventListener('click', async () => {
  if (!state.pack?.letter) return alert('no letter');
  await navigator.clipboard.writeText(state.pack.letter);
  pushLog('copied letter');
});

$('#dlLetter').addEventListener('click', () => {
  if (!state.pack?.letter) return alert('no letter');
  const blob = new Blob([state.pack.letter], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cover-letter-${(state.pack.job?.company || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
  a.click();
  pushLog('downloaded cover letter');
});

/* ------------------------------- harvest (read) ------------------------------ */

function hstat(msg, kind) {
  const el = $('#harvest-status');
  if (!el) return;
  el.textContent = msg;
  el.className = kind === 'bad' ? 'warn' : kind === 'good' ? 'ok' : 'muted';
}

async function saveServer() {
  const v = $('#serverUrl').value.trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) {
    $('#server-status').textContent = 'include http:// or https://';
    $('#server-status').className = 'warn';
    return false;
  }
  await chrome.storage.local.set({ serverUrl: v });
  $('#server-status').textContent = v ? 'saved' : 'cleared → content script default (127.0.0.1:3000)';
  $('#server-status').className = v ? 'ok' : 'muted';
  return true;
}

$('#saveServer').addEventListener('click', saveServer);
$('#serverUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveServer();
});

$('#harvestPush').addEventListener('click', async () => {
  if (!$('#serverUrl').value.trim() && !(await chrome.storage.local.get('serverUrl')).serverUrl) {
    if (!confirm('No ApplyFlow address set — use http://127.0.0.1:3000?')) return;
  }
  if (!(await saveServer())) return hstat('fix the server address first', 'bad');
  const limit = Math.min(50, Math.max(1, Number($('#harvestLimit').value) || 25));
  await chrome.storage.local.set({ harvestLimit: limit });
  const btn = $('#harvestPush');
  btn.disabled = true;
  hstat('reading the page…');
  const r = await send({ type: 'harvestPush', baseUrl: $('#serverUrl').value.trim().replace(/\/+$/, ''), limit });
  btn.disabled = false;
  if (r?.error) hstat(r.error, 'bad');
  else hstat(`read ${r.scraped} card(s) on ${r.source} · ${r.imported} new, ${r.skipped || 0} already there · corpus ${r.total}`, 'good');
  pushLog(`harvest ${r?.source || '?'} → +${r?.imported ?? 0}/${r?.scraped ?? 0}${r?.error ? ' · ' + r.error : ''}`);
});

/* Preview first. Importing a page whose cards were parsed badly is how a job list
   fills up with "Untitled role @ Company withheld" rows, so "read only" exists. */
$('#harvestPeek').addEventListener('click', async () => {
  const limit = Math.min(50, Math.max(1, Number($('#harvestLimit').value) || 25));
  hstat('reading the page…');
  const r = await send({ type: 'harvest', limit });
  if (r?.error) return hstat(r.error, 'bad');
  hstat(`${r.jobs.length} card(s) from ${r.source}: ${r.jobs.slice(0, 3).map((j) => `${j.title} @ ${j.company}`).join(' · ')}${r.jobs.length > 3 ? ' …' : ''} — nothing posted`, 'good');
  pushLog(`harvest preview → ${r.jobs.length} on ${r.source} (not posted)`);
});

load();
