/* MV3 service worker: hands the content script its config + pack on load. */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === 'applyflow:boot-config') {
    chrome.storage.local.get(['pack', 'autoOnOpen'], ({ pack, autoOnOpen }) => {
      respond({ ok: true, pack: pack || null, autoOnOpen: Boolean(autoOnOpen) });
    });
    return true;
  }
  if (msg?.type === 'applyflow:log') {
    chrome.notifications?.create?.({ type: 'basic', title: 'ApplyFlow', message: String(msg.text || '').slice(0, 120), iconUrl: 'icons/icon48.png' });
    respond({ ok: true });
    return false;
  }
  return false;
});
