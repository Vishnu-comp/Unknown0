/* AutoFill Pro - background service worker */
'use strict';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// Content scripts cannot open the options page directly; they ask us instead.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'AFX_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
  return false;
});

// Keyboard shortcut (Alt+Shift+F) -> tell the active tab's content script to fill.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-form') return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'AFX_FILL' });
  } catch (e) {
    // Content script not present on this page (e.g. chrome:// pages).
  }
});
