#!/usr/bin/env node
// Renders PNG fallbacks (32, 180 apple-touch, 512) and OG image (1200x630) from SVG brand assets
// using local headless Chrome. Run: node scripts/render-brand-assets.mjs
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "assets/brand");
const TMP_PROFILE = path.join(ROOT, ".taste-skill/chrome-brand");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_PROFILE, { recursive: true });

const faviconSvg = fs.readFileSync(path.join(ROOT, "favicon.svg"), "utf8");
const logoMarkSvg = fs.readFileSync(path.join(ROOT, "assets/brand/logo-mark.svg"), "utf8");
const fontsCss = fs.readFileSync(path.join(ROOT, "assets/fonts/fonts.css"), "utf8");

function makeIconHtml(size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
    svg { width: ${size}px; height: ${size}px; display: block; }
  </style></head><body>${faviconSvg}</body></html>`;
}

function makeOgHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    ${fontsCss.replace(/url\(\.\//g, "url(/assets/fonts/")}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 1200px; height: 630px; overflow: hidden;
      background: #f5f0e6; color: #1f1916;
      font-family: "Funnel Sans", system-ui, sans-serif;
    }
    .card {
      width: 1200px; height: 630px; padding: 68px 80px;
      display: grid; grid-template-columns: 1fr 340px; align-items: center; gap: 56px;
      position: relative;
      background:
        radial-gradient(620px 420px at 88% 20%, rgba(168, 72, 50, 0.14), transparent 70%),
        radial-gradient(520px 380px at 82% 85%, rgba(42, 127, 126, 0.13), transparent 70%),
        #f5f0e6;
    }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 10px;
      font-family: "DM Mono", monospace; font-size: 16px; font-weight: 500;
      color: #a84832; background: #ebe3d5; padding: 8px 16px; border-radius: 999px;
      border: 1px solid rgba(31, 25, 22, 0.12); width: fit-content; margin-bottom: 24px;
    }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #2a7f7e; }
    h1 {
      font-family: "Funnel Display", system-ui, sans-serif;
      font-size: 74px; line-height: 1.02; font-weight: 500; letter-spacing: -0.035em;
      color: #1f1916; margin-bottom: 22px;
    }
    p {
      font-size: 25px; line-height: 1.45; color: #544d48; max-width: 640px; margin-bottom: 34px;
    }
    .meta {
      display: flex; gap: 28px; font-family: "DM Mono", monospace; font-size: 17px; color: #1f1916;
      border-top: 1px solid rgba(31, 25, 22, 0.14); padding-top: 22px;
    }
    .meta span { color: #68625d; }
    .mark-wrap {
      width: 320px; height: 320px; border-radius: 44px;
      background: #ebe3d5; border: 1.5px solid rgba(31, 25, 22, 0.12);
      display: grid; place-items: center; padding: 28px;
    }
    .mark-wrap svg { width: 264px; height: 264px; display: block; }
  </style></head><body>
    <div class="card">
      <div>
        <div class="eyebrow"><span class="dot"></span>Phala TEE verified · Operated from Texas</div>
        <h1>attacompute</h1>
        <p>Independent AI inference peer on the AntSeed network. Pay per request in USDC.</p>
        <div class="meta">
          <div>attacompute.ai</div>
          <span>·</span>
          <div>Compute, cultivated.</div>
        </div>
      </div>
      <div class="mark-wrap">${logoMarkSvg}</div>
    </div>
  </body></html>`;
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url === "/icon-32") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(makeIconHtml(32)); }
  if (url === "/icon-180") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(makeIconHtml(180)); }
  if (url === "/icon-512") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(makeIconHtml(512)); }
  if (url === "/og") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(makeOgHtml()); }
  const filePath = path.join(ROOT, url.replace(/^\//, ""));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mime = ext === ".woff2" ? "font/woff2" : ext === ".css" ? "text/css" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    return fs.createReadStream(filePath).pipe(res);
  }
  res.writeHead(404); res.end("Not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

async function snap(route, width, height, outFile) {
  await execFileAsync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--user-data-dir=${TMP_PROFILE}`,
    `--window-size=${width},${height}`,
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    `--screenshot=${outFile}`,
    `http://127.0.0.1:${port}${route}`
  ], { timeout: 30000 });
  console.log("Rendered", path.relative(ROOT, outFile), `${width}x${height}`);
}

try {
  await snap("/icon-32", 32, 32, path.join(OUT_DIR, "favicon-32.png"));
  await snap("/icon-180", 180, 180, path.join(OUT_DIR, "apple-touch-icon.png"));
  await snap("/icon-512", 512, 512, path.join(OUT_DIR, "icon-512.png"));
  await snap("/og", 1200, 630, path.join(OUT_DIR, "og-image.png"));
} finally {
  server.close();
}
