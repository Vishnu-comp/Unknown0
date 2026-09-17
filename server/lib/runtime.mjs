/**
 * Runtime version guard.
 *
 * The floor here is the *dependencies'* floor, not the app's: `pdfjs-dist` 3.x
 * (the last line that declares Node 18) and `jsdom` 26 (which needs `>=18`) are
 * pinned for exactly that reason. npm only *warns* when a dependency wants more
 * than your runtime has — install succeeds, the UI comes up, and the first PDF
 * then explodes inside a library with a message about your document. Checking
 * once at boot turns that into a legible refusal.
 *
 * If you ever bump pdfjs-dist to 4.x, its legacy build needs Node 20+ and jsdom
 * 30 needs 22.22+; raise MIN_NODE in the same commit, or this guard starts
 * lying. `scripts/match.test.mjs` checks the pins and this number agree.
 */
export const MIN_NODE = { major: 18, minor: 0 };

export function nodeVersionTuple(v = process.versions.node) {
  const [major = 0, minor = 0] = String(v).replace(/^v/, '').split('.').map(Number);
  return { major, minor };
}

export function nodeTooOld(v = process.versions.node) {
  const { major, minor } = nodeVersionTuple(v);
  return major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor);
}

/** Human answer, not just a complaint: what breaks, what still works, how to fix it. */
export function nodeVersionAdvice(v = process.versions.node) {
  const { major } = nodeVersionTuple(v);
  const feature = `${MIN_NODE.major}.${MIN_NODE.minor}`;
  return (
    `Node v${v} is older than ${feature}, which is what pdfjs-dist@3 and jsdom@26 declare. ` +
    (major < 16
      ? `At this age even ESM entry points can fail to load, so nothing here is guaranteed to start. `
      : `Everything except PDF text extraction will probably still work — the parser needs ${feature}+. `) +
    `Upgrade with one of:  brew install node@18 && brew link --overwrite node@18  ·  ` +
    `nvm install --lts=hydrogen && nvm use --lts=hydrogen  ·  volta install node@18. ` +
    `Or skip the upgrade: pass a .txt/.docx resume, or paste the text on the Resume tab.`
  );
}

export function guardNodeVersion({ hard = false, log = console } = {}) {
  if (!nodeTooOld()) return true;
  const msg = nodeVersionAdvice();
  if (hard) {
    log.error(`\n  ✗ ${msg}\n`);
    log.error(`  Set APPLYFLOW_ALLOW_OLD_NODE=1 to start regardless (PDF upload stays as noisy as it is).\n`);
    if (!process.env.APPLYFLOW_ALLOW_OLD_NODE) process.exit(1);
    log.warn(`  APPLYFLOW_ALLOW_OLD_NODE is set — continuing on Node v${process.versions.node}.\n`);
    return false;
  }
  return true;
}
