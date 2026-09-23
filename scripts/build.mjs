import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(ROOT, 'public');

const common = {
  bundle: true,
  entryPoints: [path.join(ROOT, 'client', 'main.jsx')],
  outfile: path.join(outdir, 'app.js'),
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  jsxImportSource: 'react',
  logLevel: 'info',
  target: ['chrome110', 'firefox110', 'safari16'],
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production') },
};

fs.mkdirSync(outdir, { recursive: true });

/* keep the extension's copy of the shared mapper in lockstep with server/lib */
fs.mkdirSync(path.join(ROOT, 'extension', 'lib'), { recursive: true });
for (const f of ['fieldmap.mjs', 'fill.mjs', 'harvest.mjs']) {
  fs.copyFileSync(path.join(ROOT, 'server', 'lib', f), path.join(ROOT, 'extension', 'lib', f));
}

fs.copyFileSync(path.join(ROOT, 'client', 'index.html'), path.join(outdir, 'index.html'));
fs.copyFileSync(path.join(ROOT, 'client', 'styles.css'), path.join(outdir, 'styles.css'));

if (process.argv.includes('--watch')) {
  const ctx = await context(common);
  await ctx.watch();
  fs.copyFileSync(path.join(ROOT, 'client', 'index.html'), path.join(outdir, 'index.html'));
  fs.copyFileSync(path.join(ROOT, 'client', 'styles.css'), path.join(outdir, 'styles.css'));
  console.log('esbuild watching client/ → public/');
} else {
  await build({ ...common, minify: true, sourcemap: false });
  console.log('built public/app.js');
}
