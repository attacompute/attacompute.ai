import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');
const INDEX_HTML = join(process.cwd(), 'dist', 'index.html');

// Budgets (gzipped bytes)
const MAX_INITIAL_JS_GZIP = 120 * 1024; // 120 KB total initial JS (entry + react vendor)
const MAX_INITIAL_CSS_GZIP = 35 * 1024; // 35 KB CSS

const html = readFileSync(INDEX_HTML, 'utf8');
const files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js') || f.endsWith('.css'));

const rows = files.map((file) => {
  const fullPath = join(DIST_ASSETS, file);
  const raw = readFileSync(fullPath);
  const gzip = gzipSync(raw).length;
  const isInitial = html.includes(file);
  const isThree = file.includes('three-vendor') || file.toLowerCase().includes('live3d');
  return { file, raw: statSync(fullPath).size, gzip, isInitial, isThree };
});

const initialJs = rows.filter((r) => r.file.endsWith('.js') && r.isInitial);
const lazyJs = rows.filter((r) => r.file.endsWith('.js') && !r.isInitial);
const initialCss = rows.filter((r) => r.file.endsWith('.css') && r.isInitial);

const fmtKb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;

console.log('\n=== Bundle Size Report ===');
console.log('\nInitial JS (loaded on Overview / Pricing):');
for (const r of initialJs) {
  console.log(`  ${r.file.padEnd(40)} raw ${fmtKb(r.raw).padStart(9)} | gzip ${fmtKb(r.gzip).padStart(8)}`);
}
const totalInitialJsGzip = initialJs.reduce((sum, r) => sum + r.gzip, 0);
console.log(`  TOTAL initial JS gzip: ${fmtKb(totalInitialJsGzip)} (budget: ${fmtKb(MAX_INITIAL_JS_GZIP)})`);

console.log('\nLazy JS (loaded on demand — 3D scene & route chunks):');
for (const r of lazyJs) {
  console.log(`  ${r.file.padEnd(40)} raw ${fmtKb(r.raw).padStart(9)} | gzip ${fmtKb(r.gzip).padStart(8)}`);
}

console.log('\nInitial CSS:');
for (const r of initialCss) {
  console.log(`  ${r.file.padEnd(40)} raw ${fmtKb(r.raw).padStart(9)} | gzip ${fmtKb(r.gzip).padStart(8)}`);
}
const totalCssGzip = initialCss.reduce((sum, r) => sum + r.gzip, 0);

let failed = false;

if (totalInitialJsGzip > MAX_INITIAL_JS_GZIP) {
  console.error(`\nFAIL: Initial JS gzip (${fmtKb(totalInitialJsGzip)}) exceeds budget (${fmtKb(MAX_INITIAL_JS_GZIP)}).`);
  failed = true;
}

if (totalCssGzip > MAX_INITIAL_CSS_GZIP) {
  console.error(`\nFAIL: Initial CSS gzip (${fmtKb(totalCssGzip)}) exceeds budget (${fmtKb(MAX_INITIAL_CSS_GZIP)}).`);
  failed = true;
}

const initialHasThree = initialJs.some((r) => r.isThree);
if (initialHasThree) {
  console.error('\nFAIL: 3D (three.js) bundle must be lazy-loaded, not included in initial HTML assets!');
  failed = true;
}

const hasLazyThree = lazyJs.some((r) => r.file.includes('three-vendor'));
if (!hasLazyThree) {
  console.error('\nFAIL: Expected lazy three-vendor chunk in dist/assets!');
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log('\nPASS: Bundle budgets and lazy-loaded 3D chunk verified.\n');
