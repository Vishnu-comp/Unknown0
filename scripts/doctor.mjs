#!/usr/bin/env node
/**
 * `npm run doctor` — answers "why does every source fail on my machine?" with evidence
 * instead of a guess.
 *
 * It exists because the app once printed "a filtering/inspecting proxy answered for this
 * host" from a single errno, and a user with an Amazon-issued certificate and no proxy was
 * sent hunting a middlebox that did not exist. So every claim here is something the script
 * actually measured: the certificate a host presents, whether this Node trusts it, whether
 * the machine's own trust store trusts it, and whether the recommended fix works — the fix
 * is re-run under `NODE_EXTRA_CA_CERTS` and reported as fixed or not fixed.
 *
 * Read-only. Nothing here writes to the store; the only file it may create is the CA
 * bundle you ask for with --export-ca.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import tls from 'node:tls';

import { nodeTooOld, nodeVersionAdvice } from '../server/lib/runtime.mjs';
import { diagnoseTls, exportSystemCerts } from '../server/lib/tlsdiag.mjs';
import { resolveSourceConfigs } from '../server/lib/ingest.mjs';
import { getSettings, getProfile, DEFAULT_PROFILE, dataDir } from '../server/lib/db.mjs';

const ARGV = process.argv.slice(2);
const JSON_OUT = ARGV.includes('--json');
const EXPORT_CA = ARGV.includes('--export-ca');
const HOSTS_FLAG = ARGV.find((a) => a.startsWith('--hosts='));
const ONLY = HOSTS_FLAG ? HOSTS_FLAG.split('=')[1].split(',') : null;

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { b: '\x1b[1m', dim: '\x1b[2m', ok: '\x1b[32m', warn: '\x1b[33m', err: '\x1b[31m', off: '\x1b[0m' }
  : new Proxy({}, { get: () => '' });

const out = [];
const say = (s = '') => out.push(s);
const head = (t) => say(`\n${C.b}${t}${C.off}`);
const VERDICT = {
  fine: ['ok', 'trusted and reachable over TLS'],
  intercepted: ['err', 'a proxy is answering for this host'],
  'not-trusted': ['warn', 'real certificate, but this Node does not trust its root'],
  'wrong-host': ['err', 'the certificate presented is for a different hostname'],
  blocked: ['err', 'the connection never reached TLS'],
  unknown: ['warn', 'could not be classified'],
};

/* The hosts each source actually talks to, so the doctor checks what the app checks. */
function hostsForSources() {
  const settings = (() => {
    try {
      return getSettings();
    } catch {
      return null;
    }
  })();
  let enabled = [];
  try {
    enabled = resolveSourceConfigs(settings, null).enabled || [];
  } catch {}
  const hosts = new Map();
  const add = (host, why) => {
    if (!host) return;
    if (!hosts.has(host)) hosts.set(host, new Set());
    hosts.get(host).add(why);
  };
  const keys = new Set(enabled.map((e) => e.key || e.source));
  if (ONLY) {
    hosts.clear();
    for (const h of ONLY) add(h.trim(), 'requested');
    return [...hosts].map(([host, why]) => ({ host, why: [...why] }));
  }
  if (keys.has('github_archive')) add('api.github.com', 'github_archive');
  if (keys.has('adzuna')) add('api.adzuna.com', 'adzuna');
  if (keys.has('jooble')) add('jooble.org', 'jooble');
  for (const cfg of enabled.filter((e) => e.key === 'greenhouse' || e.key === 'lever')) add('boards-api.greenhouse.io', 'greenhouse');
  for (const cfg of enabled.filter((e) => e.key === 'lever')) add('api.lever.co', 'lever');
  if (keys.has('naukri')) add('naukri.com', 'naukri');
  if (!hosts.size) {
    // nothing enabled (or settings unreadable) — check the two hosts that bite most often
    add('api.github.com', 'github_archive (default)');
    add('boards-api.greenhouse.io', 'greenhouse (no key needed)');
  }
  return [...hosts].map(([host, why]) => ({ host, why: [...why] }));
}

function retestWithCas(host, caPath) {
  const script = `fetch('https://${host}/').then(r=>console.log(r.status)).catch(e=>console.log(e.cause?.code||e.message))`;
  const r = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_EXTRA_CA_CERTS: caPath },
  });
  const line = (r.stdout || '').trim().split('\n').pop() || (r.stderr || '').trim().split('\n').pop() || 'no output';
  return { line, worked: /^2\d\d|^3\d\d/.test(line) };
}

async function main() {
  head(`ApplyFlow doctor  ·  ${new Date().toISOString().slice(0, 16).replace('T', ' ')}  ·  ${os.platform()} ${os.arch()}`);

  /* 1. runtime ------------------------------------------------------------- */
  head('1. Runtime');
  const tooOld = nodeTooOld();
  say(`   node            ${process.version}${tooOld ? `  ${C.warn}${nodeVersionAdvice()}${C.off}` : `  ${C.ok}ok${C.off}`}`);
  const roots = tls.rootCertificates.length;
  const extra = process.env.NODE_EXTRA_CA_CERTS;
  say(`   TLS roots       ${roots} built in${extra ? ` + NODE_EXTRA_CA_CERTS=${extra}` : '  (no extra CA file — the usual cause of "valid cert, not trusted")'}`);
  const proxyVars = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'].filter((v) => process.env[v]);
  say(`   proxy env       ${proxyVars.length ? proxyVars.map((v) => `${v}=${process.env[v]}`).join('  ') : C.dim + 'none set' + C.off}`);

  /* 2. TLS verdicts -------------------------------------------------------- */
  head('2. Sources over TLS');
  const results = [];
  const sys = exportSystemCerts();
  for (const { host, why } of hostsForSources()) {
    let d;
    try {
      d = await diagnoseTls(host);
    } catch (e) {
      d = { kind: 'unknown', error: e?.message };
    }
    const [tone, label] = VERDICT[d.kind] || VERDICT.unknown;
    const mark = { ok: C.ok, warn: C.warn, err: C.err }[tone] || '';
    say(`   ${mark}${d.kind === 'fine' ? '✓' : '⚠'}${C.off} ${host.padEnd(26)} ${label}`);
    if (d.issuer) say(`     ${C.dim}issuer${C.off}      ${d.issuer}`);
    if (d.subject && d.kind !== 'fine') say(`     ${C.dim}subject${C.off}     ${d.subject}`);
    if (d.error && d.kind !== 'fine') say(`     ${C.dim}reason${C.off}      ${d.error}`);
    if (d.kind === 'blocked' && typeof d.portOpen === 'boolean') {
      say(`     ${C.dim}tcp/443${C.off}     ${d.portOpen ? 'port opens, then the TLS handshake is reset — a filter that allows the socket and kills TLS' : 'port does not connect at all'}`);
    }
    const r = { host, why, ...d };

    if (d.kind === 'not-trusted') {
      say(`     ${C.dim}system store${C.off}  ${sys.source} (${sys.count} certs) — which does trust this root`);
      if (EXPORT_CA && sys.pem) {
        const f = path.join(os.tmpdir(), `applyflow-system-ca-${process.pid}.crt`);
        fs.writeFileSync(f, sys.pem);
        const t = retestWithCas(host, f);
        say(`     ${t.worked ? C.ok + 'fix verified' : C.warn + 'fix did not verify'}${C.off}: re-fetched with NODE_EXTRA_CA_CERTS=${f} → ${t.line}`);
        r.fix = { file: f, worked: t.worked, line: t.line };
      } else {
        say(`     → run ${C.b}npm run doctor -- --export-ca${C.off} to write the system bundle and prove the fix`);
      }
    }
    if (d.kind === 'intercepted') {
      say(`     → the issuer above is the proxy. Trust its CA (or your corporate bundle), or fetch from a network that is not intercepting. Settings → Import jobs JSON and the browser extension both bypass this entirely.`);
    }
    if (d.kind === 'fine') say(`     ${C.dim}→${C.off} trusted and reachable; this host is not the problem`);
    results.push(r);
  }

  /* 3. local state --------------------------------------------------------- */
  head('3. Local state');
  const dir = dataDir();
  let writable = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-${process.pid}.tmp`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
  } catch (e) {
    writable = false;
    say(`   ${C.err}data dir not writable${C.off}: ${dir} — ${e.message}`);
  }
  if (writable) say(`   ${C.ok}✓${C.off} data dir            ${dir} (writable)`);

  const prof = (() => {
    try {
      return getProfile();
    } catch {
      return null;
    }
  })();
  if (prof) {
    const scaffold = DEFAULT_PROFILE;
    const invented = ['consentBackgroundCheck', 'consentDataProcessing', 'authorizedToWork', 'requireSponsorship'].filter(
      (k) => prof.boolAnswers?.[k] !== undefined && scaffold.boolAnswers?.[k] === undefined
    );
    const jobs = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8'));
      } catch {
        return [];
      }
    })();
    const demo = (jobs || []).filter((j) => j?.source === 'demo' || j?.source === 'fixture' || /^job_demo_/.test(String(j?.id || ''))).length;
    say(`   profile             ${prof.fullName ? C.ok : C.warn}"${prof.fullName || '(blank — a fresh install)'}"${C.off}${invented.length ? `  ${C.warn}${invented.length} attestation(s) the app set for you: ${invented.join(', ')}${C.off}` : ''}`);
    if (invented.length) say(`     → clear them with ${C.b}POST /api/reset?profile=1${C.off} then reload your resume`);
    say(`   job store           ${jobs.length} posting(s)${demo ? `  ${C.warn}${demo} of them are the removed demo corpus — boot purges these${C.off}` : ''}`);
    if (demo) say(`     ${C.dim}(purgeDemoJobs runs at boot; it left them alone here because the doctor never writes)${C.off}`);
  }

  /* 4. what to do ---------------------------------------------------------- */
  head('4. What this means');
  const blocked = results.filter((r) => r.kind === 'blocked').length;
  const intercepted = results.filter((r) => r.kind === 'intercepted').length;
  const untrusted = results.filter((r) => r.kind === 'not-trusted').length;
  const fine = results.filter((r) => r.kind === 'fine').length;
  if (intercepted) say(`   ${intercepted} host(s) are being answered by a proxy. Live fetches cannot be trusted to work; use the extension or Import jobs JSON, or trust the proxy CA.`);
  if (untrusted) say(`   ${untrusted} host(s) present a real certificate your Node does not trust. Fix the trust store (--export-ca), do not disable verification.`);
  if (blocked) say(`   ${blocked} host(s) never completed a TLS handshake — that is a network/egress block, not a certificate problem.`);
  if (fine) say(`   ${fine} host(s) are reachable and trusted${blocked + intercepted + untrusted ? ' — so the app, the proxy and your ISP are not the whole story; look at the failures above' : ' — fetching should work'}.`);
  if (!results.length) say('   Nothing was checked — pass --hosts=a.com,b.com to name them.');
  say(C.dim + `   read-only run${EXPORT_CA ? ' · CA bundle written only under the temp path above' : ''} · no store writes${C.off}\n`);

  if (JSON_OUT) console.log(JSON.stringify({ node: process.version, roots, proxy: proxyVars, results, dataDir: dir, writable }, null, 2));
  else console.log(out.join('\n'));
}

await main();
