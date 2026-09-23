/**
 * Why did a TLS connection fail? The three answers look identical from `fetch`
 * (`TypeError: fetch failed` + one code) and need opposite fixes, so this probes the
 * actual peer certificate instead of guessing.
 *
 *   intercepted  — the cert was issued by someone other than a public CA for that host:
 *                  a filtering proxy is answering for it. Fix the proxy's CA, not the app.
 *                  (Real example, this app's own sandbox: `api.github.com` presents
 *                  `O=E2B, CN=E2B Proxy CA` while `registry.npmjs.org` presents Google.)
 *   not trusted  — the cert is well-formed, valid and for the right hostname, but this
 *                  Node does not trust its root. A stale/partial CA bundle is the common
 *                  cause; `node -p "tls.rootCertificates.length"` says it outright. This
 *                  is the case where "a filtering proxy answered" would be a LIE — an
 *                  earlier version of this file printed exactly that sentence from
 *                  UNABLE_TO_VERIFY_LEAF_SIGNATURE alone, and a user with an Amazon-issued
 *                  cert and no proxy was sent off to hunt a middlebox that did not exist.
 *   blocked      — nothing answered the handshake at all (RST / refused / DNS / timeout),
 *                  so no certificate exists to look at. Firewall, or an egress allowlist.
 *
 * Deliberately small: one handshake per diagnosis, `rejectUnauthorized: false` so a bad
 * chain still returns the cert we are trying to describe, and a hard timeout. Nothing
 * here is on the request path more than once per failed fetch, and a failing probe just
 * leaves the caller's plain error alone — the diagnostic must never become a new failure.
 */
import fs from 'node:fs';
import tls from 'node:tls';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const TIMEOUT = Number(process.env.TLS_DIAG_TIMEOUT_MS || 6000);

/** Public CA organisations whose intermediates actually appear on the internet. Only used
 *  to decide "is this issuer plausibly public?", never to name a company. */
const PUBLIC_CA_ORGS = [
  'Amazon', 'Google Trust', 'Google Internet', 'Let\\u2019s Encrypt', "Let's Encrypt",
  'ISRG', 'DigiCert', 'GlobalSign', 'Sectigo', 'USERTrust', 'COMODO', 'Certum', 'Entrust',
  'Starfield', 'QuoVadis', 'IdenTrust', 'Harica', 'T-Systems', 'BJCA', 'iTrusChina',
  'SSL.com', 'Savvis', 'Internet Security Research Group', 'ISRG',
];

export function isPublicCaIssuer(issuer) {
  const s = String(issuer || '');
  return PUBLIC_CA_ORGS.some((org) => new RegExp(org.replace(/[\\'"]/g, ''), 'i').test(s));
}

/** "O=Amazon\nCN=Amazon RSA 2048 M04" → "Amazon / Amazon RSA 2048 M04" */
export function oneLineDn(dn) {
  if (!dn) return '';
  return String(dn)
    .split('\n')
    .map((p) => p.trim().replace(/^(CN|O|OU|C|ST|L)=/, ''))
    .filter(Boolean)
    .join(' / ');
}

/** SANs carry wildcards, and a bare CN does not count when SANs are present (RFC 6125). */
export function sanMatches(san, host) {
  const names = String(san || '')
    .split(',')
    .map((x) => x.trim().replace(/^DNS:/i, ''))
    .filter(Boolean);
  const h = String(host || '').toLowerCase();
  return names.some((n) => {
    n = n.toLowerCase();
    if (n === h) return true;
    if (n.startsWith('*.')) {
      const rest = n.slice(2);
      return h.endsWith('.' + rest) && !h.slice(0, -(rest.length + 1)).includes('.');
    }
    return false;
  });
}

function connectOnce(host, port = 443) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(v);
    };
    const t = setTimeout(() => {
      try { s.destroy(); } catch {}
      done({ kind: 'blocked', code: 'HANDSHAKE_TIMEOUT' });
    }, TIMEOUT);
    const isIp = net.isIP(host) !== 0;
    const s = tls.connect({ host, port, servername: isIp ? undefined : host, timeout: TIMEOUT, rejectUnauthorized: false }, () => {
      let cert = null;
      try {
        cert = s.getPeerX509Certificate();
      } catch {}
      const authorized = s.authorized === true;
      const authorizationError = s.authorizationError || null;
      // read everything off `cert` before destroy(): nothing is available after that
      const selfSigned = !!cert && cert.issuer === cert.subject;
      const san = cert?.subjectAltName || '';
      try { s.destroy(); } catch {}
      if (!cert) return done({ kind: 'blocked', code: 'NO_PEER_CERTIFICATE' });
      done({
        kind: 'cert',
        issuer: oneLineDn(cert.issuer),
        subject: oneLineDn(cert.subject),
        validTo: cert.validTo,
        forHost: sanMatches(san, host),
        selfSigned,
        authorizationError,
        authorized,
      });
    });
    s.on('error', (e) => done({ kind: 'blocked', code: e.code || e.message }));
    s.on('timeout', () => {
      try { s.destroy(); } catch {}
      done({ kind: 'blocked', code: 'HANDSHAKE_TIMEOUT' });
    });
  });
}

/** Raw TCP, to tell "port closed/reset" apart from "TLS refused". */
function tcpOnce(host, port = 443) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 4000 });
    const finish = (v) => {
      try { s.destroy(); } catch {}
      resolve(v);
    };
    s.setTimeout(4000);
    s.on('connect', () => finish({ open: true }));
    s.on('error', (e) => finish({ open: false, code: e.code || e.message }));
    s.on('timeout', () => finish({ open: false, code: 'TIMEOUT' }));
  });
}

/**
 * The diagnosis for one host. `e` is the error fetch threw, if there was one.
 * Never throws: if the probes fail, the caller still gets its original message.
 */
export async function diagnoseTls(host, e = null, { port = 443 } = {}) {
  const code = String(e?.cause?.code || e?.code || e?.message || '');
  const base = { host, code: code || null };
  let cert = null;
  try {
    cert = await connectOnce(host, port);
  } catch (err) {
    return { ...base, kind: 'unknown', note: `probe failed: ${err?.message || err}` };
  }

  if (cert.kind === 'cert') {
    const publicIssuer = isPublicCaIssuer(cert.issuer);
    /* Issuer == subject is a self-signed certificate, which is its own story: a local dev
       server, a device's UI, a proxy. Calling all of those "intercepted" would be a
       guess of the same kind this file exists to stop. */
    if (!publicIssuer && cert.selfSigned) {
      return { ...base, kind: 'self-signed', issuer: cert.issuer, subject: cert.subject };
    }
    if (!publicIssuer) {
      return { ...base, kind: 'intercepted', issuer: cert.issuer, subject: cert.subject, forHost: cert.forHost };
    }
    if (!cert.forHost) {
      return { ...base, kind: 'wrong-host', issuer: cert.issuer, subject: cert.subject };
    }
    if (cert.authorized) return { ...base, kind: 'fine', issuer: cert.issuer };
    return {
      ...base,
      kind: 'not-trusted',
      issuer: cert.issuer,
      validTo: cert.validTo,
      error: cert.authorizationError || code,
    };
  }
  let tcp = { open: false, code: null };
  try {
    tcp = await tcpOnce(host, port);
  } catch {}
  return { ...base, kind: 'blocked', error: cert.code, portOpen: tcp.open, tcpCode: tcp.code };
}

/**
 * The system's own trust store, exported so Node can be pointed at it. Needed because
 * "not-trusted" with a *valid public cert* usually means Node's bundled roots are stale,
 * and the machine's keychain/CA bundle is the authoritative one.
 */
export function exportSystemCerts() {
  const out = {};
  try {
    const mac = spawnSync('security', ['find-certificate', '-a', '-p', '/System/Library/Keychains/SystemRootCertificates.keychain'], { encoding: 'utf8', timeout: 15000 });
    if (mac.status === 0 && /BEGIN CERTIFICATE/.test(mac.stdout || '')) {
      out.source = 'macOS SystemRootCertificates.keychain';
      out.pem = mac.stdout;
      out.count = (mac.stdout.match(/BEGIN CERTIFICATE/g) || []).length;
      return out;
    }
  } catch {}
  for (const f of ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/cert.pem']) {
    try {
      const pem = fs.readFileSync(f, 'utf8');
      const count = (pem.match(/BEGIN CERTIFICATE/g) || []).length;
      if (count) return { source: f, pem, count };
    } catch {}
  }
  return { source: null, pem: '', count: 0 };
}
