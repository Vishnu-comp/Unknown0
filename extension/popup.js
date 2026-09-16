/* ApplyFlow popup: pack store + content-script bridge. */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = { pack: null, batch: null };

async function load() {
  const { pack, autoOnOpen, log } = await chrome.storage.local.get(['pack', 'autoOnOpen', 'log']);
  state.pack = pack || null;
  $('#autoOnOpen').checked = Boolean(autoOnOpen);
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
    ['apply', 'pack', 'log', 'about'].forEach((t) => ($('#tab-' + t).hidden = t !== b.dataset.t));
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
  ['apply', 'pack', 'about'].forEach((t) => ($('#tab-' + t).hidden = true));
  $('#tab-log').hidden = false;
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

load();
