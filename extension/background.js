/* MV3 service worker. Two jobs:
   1. hand the content script its config + pack on load (popup-driven flow), and
   2. be the bridge for the app page itself, so "auto-apply" can open the posting and
      fill it without anyone opening a popup or pasting JSON.

   (2) works because an app page can talk to *this* worker via externally_connectable, but
   a page cannot talk to a content script in another tab. So the worker holds one pending
   handoff per tab and releases it exactly once, when that tab's content script reports
   ready. Releasing once matters: reload the apply page and you fill it again, but a stale
   handoff must never leak onto the next site you open.

   Safety inherited by design, not added here: the pack carries `null` for anything the
   user never answered, the shared filler skips nulls, `onlyEmpty` leaves typed text alone,
   and nothing in this file can submit a form. */

const PENDING_MS = 10 * 60 * 1000;

const ok = (respond, extra) => respond({ ok: true, ...(extra || {}) });

async function getPending(tabId) {
  const { pending } = await chrome.storage.local.get('pending');
  if (!pending || pending.tabId !== tabId) return null;
  if (Date.now() - (pending.at || 0) > PENDING_MS) {
    await chrome.storage.local.remove('pending');
    return null;
  }
  return pending;
}

/* ------------------------- "I opened this page myself" -------------------------
   A page cannot read your applications, but this worker can ask your own local
   server which drafted pack belongs to it. Two rules keep that from being scary:
   the fill is only automatic when the match is specific enough to name a reason,
   and the reason is always shown next to what got filled. `autoFillFor` is the
   whole decision and is executed directly by npm run test:features. */

/* A shared board host (job-boards.greenhouse.io/…, jobs.lever.co/…) is not enough on
   its own: filling Stripe's answers into GitLab's form is worse than filling nothing. */
function autoFillFor(pack, auto) {
  const reason = String(pack?.reason || '');
  /* Exactly one thing may be typed without asking: the posting you drafted this pack
     against. `trustworthy` is computed server-side so a refactor here cannot quietly
     widen what gets typed into a form. */
  if (!pack?.payload?.fields) return { fill: false, why: 'no pack' };
  if (pack.trustworthy !== true) return { fill: false, why: 'match too vague to type without asking' };
  if (!/exact URL/.test(reason)) return { fill: false, why: 'not the posting you drafted this pack for' };
  if (!auto) return { fill: false, why: 'auto-fill is off for this site' };
  return { fill: true, why: reason };
}

async function serverBase() {
  const { serverUrl } = await chrome.storage.local.get('serverUrl');
  const v = String(serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
  return /^https?:\/\/localhost(:\d+)?$/i.test(v) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(v) ? v : null;
}

async function packForPage(url) {
  const base = await serverBase();
  if (!base) return { packs: [], error: 'set your ApplyFlow server URL in the popup first' };
  try {
    const r = await fetch(`${base}/api/apps/for-site?page=${encodeURIComponent(url)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { packs: [], error: String(d?.error || `server said ${r.status}`) };
    return { packs: d.packs || [], hint: d.hint || null, base };
  } catch (e) {
    // the server being down is a fact, not a failure worth alarming about
    return { packs: [], error: 'your ApplyFlow server is not answering at ' + base };
  }
}

async function autoFlags() {
  const { autoFillSites, autoOnOpen } = await chrome.storage.local.get(['autoFillSites', 'autoOnOpen']);
  return { perSite: autoFillSites && typeof autoFillSites === 'object' ? autoFillSites : {}, global: Boolean(autoOnOpen) };
}

/* -------------------------------- from the app page -------------------------------- */
chrome.runtime.onMessageExternal?.addListener((msg, sender, respond) => {
  const type = msg?.type || '';

  if (type === 'applyflow.ext:ping') {
    // lets a page prove the bridge exists, so the UI can say "extension not installed"
    return ok(respond, { name: 'ApplyFlow', version: chrome.runtime.getManifest().version, extId: chrome.runtime.id });
  }

  if (type === 'applyflow.ext:handoff') {
    (async () => {
      const pack = msg.payload && msg.payload.fields ? msg.payload : msg.payload?.payload;
      if (!pack?.fields) return respond({ ok: false, error: 'handoff needs payload.fields (the extension pack shape)' });
      const url = String(msg.url || '');
      if (!/^https?:\/\//i.test(url)) return respond({ ok: false, error: 'handoff needs an absolute http(s) url' });

      const tab = await chrome.tabs.create({ url, active: msg.active !== false });
      if (!tab?.id) return respond({ ok: false, error: 'could not open a tab' });
      await chrome.storage.local.set({
        // the pack is stored per tab; the fill itself is driven by the content script
        pending: { tabId: tab.id, at: Date.now(), pack, jobId: msg.jobId || null, onlyEmpty: msg.onlyEmpty !== false, url },
      });
      return respond({ ok: true, tabId: tab.id, fields: Object.keys(pack.fields).length });
    })().catch((e) => respond({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  return respond({ ok: false, error: `unknown message ${type}` });
});

/* ------------------------------- from content scripts ------------------------------ */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === 'applyflow:boot-config') {
    chrome.storage.local.get(['pack', 'autoOnOpen'], ({ pack, autoOnOpen }) => {
      respond({ ok: true, pack: pack || null, autoOnOpen: Boolean(autoOnOpen) });
    });
    return true;
  }

  if (msg?.type === 'applyflow:log') {
    chrome.notifications?.create?.({
      type: 'basic',
      title: 'ApplyFlow',
      message: String(msg.text || '').slice(0, 120),
      iconUrl: 'icons/icon48.png',
    });
    respond({ ok: true });
    return false;
  }

  /* the page the app opened just finished loading — release its pack once */
  if (msg?.type === 'applyflow:ready') {
    (async () => {
      const tabId = sender?.tab?.id;
      if (tabId === undefined) return respond({ ok: false, error: 'no tab' });
      const pending = await getPending(tabId);
      if (!pending) return respond({ ok: false, error: 'nothing pending for this tab' });
      await chrome.storage.local.remove('pending');
      respond({ ok: true, claimed: true });
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'applyflow:fill-handoff', pack: pending.pack, onlyEmpty: pending.onlyEmpty });
      } catch (e) {
        try {
          chrome.notifications?.create?.({
            type: 'basic',
            title: 'ApplyFlow',
            message: 'opened the page but could not fill it — the content script may still be loading. Click the toolbar icon and press Fill.',
            iconUrl: 'icons/icon48.png',
          });
        } catch {}
      }
    })().catch(() => respond({ ok: false, error: 'claim failed' }));
    return true;
  }
  /* the content script says "the user navigated here themselves" */
  if (msg?.type === 'applyflow:page-opened') {
    (async () => {
      /* a content script asks about its own tab; the popup asks about the active tab.
         Both are the same question, so both get the same answer — including the pack,
         which the popup needs because a popup cannot read another frame's storage. */
      const tabId = sender?.tab?.id ?? msg.tabIdHint;
      const url = String(msg.url || sender?.tab?.url || '');
      if (!/^https?:\/\//i.test(url)) return respond({ ok: false, error: 'need a http(s) page url' });
      const { packs, error, hint } = await packForPage(url);
      const top = packs[0] || null;
      const { perSite, global } = await autoFlags();
      let host = '';
      try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch {}
      const siteOn = host in perSite ? perSite[host] !== false : global;
      const call = autoFillFor(top, siteOn);
      // hand the page its chip either way — what it says is the point
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'applyflow:for-site',
          url, host,
          pack: top ? { ...top, reason: top.reason } : null,
          others: packs.slice(1, 4).map((p) => ({ appId: p.appId, title: p.title, company: p.company, reason: p.reason, score: p.score })),
          auto: { siteOn, global, fill: call.fill, why: call.why },
          note: error || hint || null,
        });
      } catch {}
      if (call.fill) {
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'applyflow:fill-handoff', pack: top.payload, onlyEmpty: true });
        } catch {}
      }
      respond({
        ok: true,
        found: packs.length,
        fill: call.fill,
        why: call.why,
        reason: top?.reason || null,
        // given, not guessed at: the popup fills exactly the pack this answer is about
        pack: top?.payload || null,
        others: packs.slice(1, 4).map((p) => ({ appId: p.appId, title: p.title, company: p.company, reason: p.reason })),
      });
    })().catch(() => respond({ ok: false, error: 'lookup failed' }));
    return true;
  }

  /* the page's chip was clicked: fill the exact pack it is showing, whatever the rank */
  if (msg?.type === 'applyflow:fill-this') {
    const tabId = sender?.tab?.id;
    respond({ ok: true });
    (async () => {
      const { packs } = await packForPage(String(msg.url || sender?.tab?.url || ''));
      const one = packs.find((p) => p.appId === msg.appId) || packs[0];
      if (!one?.payload?.fields || tabId === undefined) return;
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'applyflow:fill-handoff', pack: one.payload, onlyEmpty: msg.overwrite === true ? false : true });
      } catch {}
    })().catch(() => {});
    return false;
  }

  /* the chip's "yes, on this site" / "not here" */
  if (msg?.type === 'applyflow:set-site') {
    (async () => {
      const host = String(msg.host || '').toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return respond({ ok: false, error: 'bad host' });
      const { autoFillSites } = await chrome.storage.local.get('autoFillSites');
      const map = autoFillSites && typeof autoFillSites === 'object' ? autoFillSites : {};
      map[host] = msg.on !== false;
      await chrome.storage.local.set({ autoFillSites: map });
      respond({ ok: true, host, on: map[host] });
    })().catch(() => respond({ ok: false, error: 'could not save that' }));
    return true;
  }

  return false;
});

/* A handoff nobody claimed (blocked page, crash, user closed the tab) should not sit in
   storage holding a pack full of personal data. */
chrome.runtime.onStartup?.addListener(() => chrome.storage.local.remove('pending'));
chrome.tabs.onRemoved?.addListener(async (tabId) => {
  const { pending } = await chrome.storage.local.get('pending');
  if (pending && pending.tabId === tabId) await chrome.storage.local.remove('pending');
});
