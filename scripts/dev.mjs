/**
 * npm run dev → esbuild watch + API server that restarts on server/ changes.
 * No nodemon/pm2 dependency; ~60 lines of glue.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCH_DIR = path.join(ROOT, 'server');
const children = [];
let restarting = null;

function sh(cmd, args, name) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  p.on('exit', (code) => {
    if (!shuttingDown && code) console.log(`[${name}] exited with ${code}`);
  });
  children.push(p);
  return p;
}

let server = sh('node', [path.join(ROOT, 'server', 'index.mjs')], 'api');
sh('node', [path.join(ROOT, 'scripts', 'build.mjs'), '--watch'], 'assets');

let shuttingDown = false;
process.on('SIGINT', () => {
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
});

fs.watch(WATCH_DIR, { recursive: true }, (_e, file) => {
  if (!file || !/\.(mjs|js|json)$/.test(file)) return;
  clearTimeout(restarting);
  restarting = setTimeout(() => {
    console.log(`\n[api] restart (changed ${file})`);
    try {
      server.kill('SIGTERM');
    } catch {}
    server = sh('node', [path.join(ROOT, 'server', 'index.mjs')], 'api');
  }, 250);
});
