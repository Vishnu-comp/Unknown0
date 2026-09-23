/**
 * "I navigated to a job page myself — fill my details in."
 *
 * Two rules, both of which must hold or this feature is a liability:
 *   1. a pack may only be *typed* when the page can be tied to that specific
 *      application, not merely to the same ATS host;
 *   2. when it cannot, the page says so rather than staying silent.
 *
 *   node scripts/site.test.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankAppsForSite } from '../server/lib/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
const ok = (cond, label) => {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
};

const GH = 'https://job-boards.greenhouse.io';
const apps = [
  {
    id: 'a_gitlab',
    title: 'AI Engineer',
    company: 'GitLab',
    score: 46,
    url: `${GH}/gitlab/jobs/8556658002`,
    prefill: { fields: { email: 'me@example.com' }, checkboxes: {} },
  },
  {
    id: 'a_stripe',
    title: 'Backend Engineer',
    company: 'Stripe',
    score: 81,
    url: `${GH}/stripe/jobs/5551`,
    prefill: { fields: { email: 'me@example.com' }, checkboxes: {} },
  },
  {
    id: 'a_direct',
    title: 'Software Development Engineer',
    company: 'Zuul',
    score: 60,
    url: 'https://zuul.example.com/careers/software-development-engineer',
    prefill: { fields: { email: 'me@example.com' }, checkboxes: {} },
  },
  { id: 'a_nopack', title: 'Ghost Role', company: 'Nowhere', url: `${GH}/nowhere/jobs/1` },
];

const top = (page) => rankAppsForSite(apps, page)[0] || null;

/* ------------------------------- 1. exactness -------------------------------- */

let m = top(`${GH}/gitlab/jobs/8556658002`);
ok(m?.app.id === 'a_gitlab' && m.reason === 'exact URL' && m.trustworthy === true,
  'the posting you drafted against matches exactly and is allowed to type');

m = top('https://zuul.example.com/careers/software-development-engineer');
ok(m?.reason === 'exact URL', 'a company-run careers page matches on its own URL too');

m = top('https://www.job-boards.greenhouse.io/gitlab/jobs/8556658002');
ok(m?.app.id === 'a_gitlab', 'a www. prefix on the same host is not treated as a different site');

m = top(`${GH}/gitlab/jobs/8556658002?source=twitter`);
ok(m?.app.id === 'a_gitlab' && m.reason === 'exact URL', 'a tracking query on the same posting is still that posting');

/* ------------------------- 2. a shared ATS is not a match -------------------- */

m = top(`${GH}/stripe/jobs/9999`);
ok(m && m.reason === 'same board, different posting' && m.trustworthy === false,
  'a different Stripe posting is a candidate you must click — never typed automatically');

m = top(`${GH}/gitlab/jobs/7777`);
ok(m?.app.id === 'a_gitlab' && m.trustworthy === false,
  'the right board, the wrong role: still not trusted, even though the company matches');

/* a re-posted role has a new number, so it is a different URL — offered, not auto-typed */
m = top(`${GH}/gitlab/jobs/ai-engineer-2026`);
ok(m?.app.id === 'a_gitlab' && m.trustworthy === false,
  'a re-posted role (same board+company, new URL) is offered but never typed on its own');

m = top(`${GH}/otherco/jobs/9`);
ok(m && /different company/.test(m.reason) && m.trustworthy === false,
  'another company on the same ATS host is labelled a guess, never a trustworthy match');

ok(rankAppsForSite(apps, 'https://linkedin.com/jobs/view/whatever').length === 0,
  'a page with nothing drafted for it returns nothing at all — the chip then says so');

ok(!rankAppsForSite(apps, 'not a url').length && !rankAppsForSite(apps, '').length && !rankAppsForSite(apps, null)?.error,
  'garbage page input cannot throw, it just matches nothing');

/* --------------------------- 3. packs without a pack ------------------------- */

ok(!rankAppsForSite(apps, `${GH}/nowhere/jobs/1`).some((r) => r.app.id === 'a_nopack'),
  'an application with no prefill pack is never offered (nothing to type into a form)');

ok(!('a_nopack' in rankAppsForSite(apps, `${GH}/nowhere/jobs/1`).map((r) => r.app.id)),
  'and it does not show up as an empty suggestion either');

/* -------------------------------- 4. ranking --------------------------------- */

const order = rankAppsForSite(apps, `${GH}/gitlab/jobs/8556658002`).map((r) => [r.app.id, r.trustworthy]);
ok(order[0][0] === 'a_gitlab' && order[0][1] === true,
  'the trustworthy match sorts first, so the extension reads the right one off [0]');
ok(order[1]?.[0] === 'a_stripe' && order[1]?.[1] === false,
  'the weak one is still listed (you can click it yourself) but flagged untrustworthy');

/* ------------------- 5. the worker's decision, executed not grepped ---------- */

const bg = fs.readFileSync(path.join(here, '..', 'extension', 'background.js'), 'utf8');
const body = bg.slice(bg.indexOf('function autoFillFor'), bg.indexOf('async function serverBase'));
const store = {};
const calls = { fetched: [], sent: [] };
const chrome = {
  storage: { local: { get: async (k) => ({ ...store }), set: async (o) => Object.assign(store, o) } },
  runtime: {
    onMessageExternal: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    getManifest: () => ({ version: '0' }),
    notifications: { create: () => {} },
  },
  tabs: { create: async () => ({ id: 1 }), sendMessage: async (id, m) => calls.sent.push(m.type), onRemoved: { addListener: () => {} } },
};
const ctx = vm.createContext({
  chrome, console, setTimeout, Date, Object, String, JSON, Error, Boolean, Number, RegExp, Promise, URL,
  fetch: async (u) => { calls.fetched.push(u); return { ok: true, json: async () => ({ packs: [] }) }; },
});
ctx.globalThis = ctx;
/* evaluate the worker's own source text, then hand back the gate */
const autoFillFor = vm.runInContext(`(() => { ${body}\n  return autoFillFor; })()`, ctx);

ok(typeof autoFillFor === 'function', 'the auto-fill gate is a real function we can execute');

const exact = { reason: 'exact URL', trustworthy: true, payload: { fields: { email: 'a@b' } } };
ok(autoFillFor(exact, true).fill === true, 'exact pack + site switched on → it types, and says which reason');
ok(autoFillFor(exact, false).fill === false && /off for this site/.test(autoFillFor(exact, false).why),
  'the same pack is NOT typed when this site is switched off — and the page is told why');
ok(autoFillFor({ ...exact, trustworthy: false }, true).fill === false,
  'an untrustworthy match is never typed automatically, whatever the reason string claims');
ok(autoFillFor({ reason: 'exact URL', trustworthy: true, payload: {} }, true).fill === false,
  'a pack with no fields cannot trigger a fill');
ok(autoFillFor(null, true).fill === false && autoFillFor(undefined, true).fill === false,
  'no pack at all is a clean no, not a throw');
ok(autoFillFor({ reason: 'exact URL', trustworthy: true, payload: { fields: {} }, }, true).fill === true,
  'an empty-but-present pack still counts as a pack (the filler decides what to write)');

/* the URL must never leave the machine: serverBase only ever returns localhost */
const serverBase = vm.runInContext(
  `(() => { ${bg.slice(bg.indexOf('async function serverBase'), bg.indexOf('async function packForPage'))}\n  return serverBase; })()`,
  ctx
);
store.serverUrl = 'https://evil.example.com';
ok((await serverBase()) === null, 'a non-localhost serverUrl is refused — your pack never leaves this machine');
store.serverUrl = 'http://localhost:3000/';
ok((await serverBase()) === 'http://localhost:3000', 'the configured localhost origin is used as-is (trailing slash trimmed)');
delete store.serverUrl;
ok((await serverBase()) === 'http://localhost:3000', 'with nothing configured it assumes the local dev server, not the internet');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
