/** API + tiny toast system shared by every tab. */
let listeners = [];
export function onToast(fn) {
  listeners.push(fn);
  return () => (listeners = listeners.filter((l) => l !== fn));
}
export function toast(msg, kind = 'ok', ms = 3600) {
  const id = Math.random().toString(36).slice(2);
  listeners.forEach((l) => l({ id, msg, kind }));
  setTimeout(() => listeners.forEach((l) => l({ id, remove: true })), ms);
}

async function req(method, url, body, isForm) {
  const opts = { method, headers: {} };
  if (body && !isForm) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isForm) {
    opts.body = body;
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  meta: () => req('GET', '/api/meta'),
  profile: () => req('GET', '/api/profile'),
  saveProfile: (p) => req('PUT', '/api/profile', p),
  addSkills: (skills) => req('POST', '/api/profile/skills', { skills }),
  delSkill: (name) => req('DELETE', `/api/profile/skills/${encodeURIComponent(name)}`),

  resume: () => req('GET', '/api/resume'),
  uploadResume: (file) => {
    const fd = new FormData();
    fd.append('resume', file);
    fd.append('applySuggestions', 'true');
    return req('POST', '/api/resume', fd, true);
  },
  pasteResume: (text, applySuggestions = true) => req('POST', '/api/resume', { text, applySuggestions }),
  applySuggestions: () => req('POST', '/api/resume/apply-suggestions'),

  jobs: (q = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
    return req('GET', `/api/jobs${qs ? `?${qs}` : ''}`);
  },
  job: (id) => req('GET', `/api/jobs/${id}`),
  jobResearch: (id) => req('GET', `/api/jobs/${id}/research`),
  jobTailored: (id) => req('GET', `/api/jobs/${id}/tailored`),
  tailoredUrl: (id) => `/api/jobs/${id}/tailored?format=txt`,
  fetchJobs: (sources) => req('POST', '/api/jobs/fetch', { sources }),
  fetchStatus: () => req('GET', '/api/jobs/fetch-status'),
  recompute: () => req('POST', '/api/jobs/recompute'),
  clearJobs: () => req('POST', '/api/jobs/clear'),

  apps: () => req('GET', '/api/apps'),
  draft: (jobIds, opts = {}) => req('POST', '/api/apps/draft', { jobIds, ...opts }),
  patchApp: (id, patch) => req('PATCH', `/api/apps/${id}`, patch),
  setStatus: (id, status, note) => req('POST', `/api/apps/${id}/status`, { status, note }),
  delApp: (id) => req('DELETE', `/api/apps/${id}`),
  prefillUrl: (id) => `/api/apps/${id}/prefill`,
  submitSupport: (id) => req('GET', `/api/apps/${id}/submit-support`),
  submitApp: (id, confirm = false) => req('POST', `/api/apps/${id}/submit`, { confirm }),
  submissions: () => req('GET', '/api/submissions'),
  extensionPayload: (id) => req('GET', `/api/apps/${id}/extension-payload`),

  runner: () => req('GET', '/api/runner'),
  run: (body = {}) => req('POST', '/api/runner/run', body),

  settings: () => req('GET', '/api/settings'),
  saveSettings: (s) => req('PUT', '/api/settings', s),
  reset: () => req('POST', '/api/reset'),
  /* ?profile=1 is opt-in at the route because a profile is the expensive thing to
     re-type; the UI asks separately rather than folding it into the plain wipe. */
  resetAll: () => req('POST', '/api/reset?profile=1'),

  /* Paste-and-import. Rows are normalised server-side, so the payload can be a bare
     array, {jobs:[…]} or a raw Naukri search response — see server/lib/harvest.mjs. */
  importJobs: (body) => req('POST', '/api/jobs/import', body),

  exportBatchUrl: '/api/export/prefill.json',
  exportPackUrl: '/api/export/pack.md',
};

/* ---------------- extension bridge (open the site AND fill it) ----------------
   A page cannot script another tab, so the only honest route is chrome.runtime
   messaging into the add-on's worker, which the worker relays to its own content
   script. We discover the extension id by postMessage — the content script on THIS
   page announces it — because chrome.runtime.id is undefined on a web page and
   probing a hardcoded id would fingerprint every browser that loads the app.
   If nothing answers, the extension is not installed on this profile and the UI
   says so instead of pretending the click worked. */
export function findExtension(timeoutMs = 800) {
  return new Promise((resolve) => {
    const done = (v) => {
      clearTimeout(t);
      window.removeEventListener('message', on);
      resolve(v);
    };
    const t = setTimeout(() => done(null), timeoutMs);
    const on = (e) => {
      if (e.source !== window || e.data?.type !== 'applyflow:ext') return;
      done({ id: e.data.id });
    };
    window.addEventListener('message', on);
    window.postMessage({ type: 'applyflow:hand' }, window.location.origin);
  });
}

export async function handOff(id, { url, onlyEmpty = true, active = true } = {}) {
  const ext = await findExtension();
  if (!ext) return { ok: false, error: 'no extension on this page' };
  /* The worker cannot read our API, so the pack travels with the message — this is the
     exact object the popup's Fill uses (fields + checkboxes + onlyEmpty), which is why
     nothing new can be invented in transit. */
  const { payload } = await api.extensionPayload(id);
  if (!payload?.fields || !Object.keys(payload.fields).length) {
    return { ok: false, error: 'this application has no prefill pack — draft it first' };
  }
  return new Promise((resolve) => {
    window.chrome.runtime.sendMessage(
      ext.id,
      { type: 'applyflow.ext:handoff', jobId: id, payload, url, onlyEmpty, active },
      (res) => {
        const err = window.chrome?.runtime?.lastError?.message;
        if (err) return resolve({ ok: false, error: err });
        resolve(res || { ok: false, error: 'the extension did not answer — reload it at chrome://extensions' });
      }
    );
  });
}

export async function copy(text, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(label);
  }
}
