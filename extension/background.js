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
  return false;
});

/* A handoff nobody claimed (blocked page, crash, user closed the tab) should not sit in
   storage holding a pack full of personal data. */
chrome.runtime.onStartup?.addListener(() => chrome.storage.local.remove('pending'));
chrome.tabs.onRemoved?.addListener(async (tabId) => {
  const { pending } = await chrome.storage.local.get('pending');
  if (pending && pending.tabId === tabId) await chrome.storage.local.remove('pending');
});
