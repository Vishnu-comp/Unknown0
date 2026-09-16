/**
 * Runtime version guard.
 *
 * The app itself runs on Node 18. What does NOT is the dependency set:
 * pdfjs-dist 6 declares >=22.13 and jsdom 30 declares >=22.22.2, and npm only
 * *warns* about that — `npm install` succeeds, the UI comes up, and the first
 * PDF you drop then dies inside a library with a message about your document.
 * So we check once at boot and say the true thing early.
 */
export const MIN_NODE = { major: 22, minor: 13 };

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
  const { major, minor } = nodeVersionTuple(v);
  const feature = `${MIN_NODE.major}.${MIN_NODE.minor}`;
  return (
    `Node v${v} is older than this dependency set wants (${feature}+). ` +
    `Profile, scoring, letters, tailoring and prefill all still work; ` +
    (major < 22
      ? `PDF parsing (pdfjs-dist) and the jsdom-backed test suite (test:unit) will not — npm only warned about it during install. `
      : `minor releases below ${feature} are untested territory for pdfjs-dist and jsdom. `) +
    `Upgrade with one of:  brew install node@22 && brew link --overwrite node@22  ·  ` +
    `nvm install --lts=jod && nvm use --lts=jod  ·  volta install node@22. ` +
    `Until then: pass a .txt/.docx resume, or paste the text on the Resume tab.`
  );
}

/**
 * Used as a hard exit by the server, and as a thrown error by the PDF path
 * (where "I can't read this file" must never be the wrong diagnosis).
 */
export function guardNodeVersion({ hard = false, log = console } = {}) {
  if (!nodeTooOld()) return true;
  const msg = nodeVersionAdvice();
  if (hard) {
    log.error(`\n  ✗ ${msg}\n`);
    log.error(`  Running anyway is possible only with older deps; we would rather you upgrade.\n`);
    log.error(`  Set APPLYFLOW_ALLOW_OLD_NODE=1 to start regardless (PDF upload stays disabled).\n`);
    if (!process.env.APPLYFLOW_ALLOW_OLD_NODE) process.exit(1);
    log.warn(`  APPLYFLOW_ALLOW_OLD_NODE is set — continuing on Node v${process.versions.node}.\n`);
    return false;
  }
  return true;
}
