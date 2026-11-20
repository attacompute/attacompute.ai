#!/usr/bin/env node
// Captures deliverable screenshots in docs/screenshots/ against a local HTTP server:
// - home-1440.png (1440x900 full page)
// - home-390.png (390x844 full page)
// - models-1440.png (1440x900 viewport framed on #models)
// - connect-1440.png (1440x900 full page of /connect/)
// - connect-390.png (390x844 full page of /connect/)
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function optimizePngBuffer(buf, quantStep = 6) {
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idats = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idats.push(data);
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return buf;
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const rgba = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowIn + x];
      const a = x >= bpp ? rgba[rowOut + x - bpp] : 0;
      const b = y > 0 ? rgba[rowOut - stride + x] : 0;
      const c = x >= bpp && y > 0 ? rgba[rowOut - stride + x - bpp] : 0;
      let val = v;
      if (f === 1) val = (v + a) & 255;
      else if (f === 2) val = (v + b) & 255;
      else if (f === 3) val = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) val = (v + paeth(a, b, c)) & 255;
      rgba[rowOut + x] = val;
    }
  }
  // Convert to opaque 24-bit RGB and quantize low-order grain noise bits for compact zlib compression
  const outBpp = 3;
  const outStride = width * outBpp;
  const rgb = new Uint8Array(width * height * outBpp);
  for (let i = 0, j = 0; i < rgba.length; i += bpp, j += 3) {
    rgb[j] = Math.min(255, Math.round(rgba[i] / quantStep) * quantStep);
    rgb[j + 1] = Math.min(255, Math.round(rgba[i + 1] / quantStep) * quantStep);
    rgb[j + 2] = Math.min(255, Math.round(rgba[i + 2] / quantStep) * quantStep);
  }
  const filtered = Buffer.alloc(height * (outStride + 1));
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(outStride));
  for (let y = 0; y < height; y++) {
    const row = y * outStride;
    let bestF = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const cand = candidates[f];
      let score = 0;
      for (let x = 0; x < outStride; x++) {
        const v = rgb[row + x];
        const a = x >= outBpp ? rgb[row + x - outBpp] : 0;
        const b = y > 0 ? rgb[row - outStride + x] : 0;
        const c = x >= outBpp && y > 0 ? rgb[row - outStride + x - outBpp] : 0;
        let d = v;
        if (f === 1) d = (v - a) & 255;
        else if (f === 2) d = (v - b) & 255;
        else if (f === 3) d = (v - ((a + b) >> 1)) & 255;
        else if (f === 4) d = (v - paeth(a, b, c)) & 255;
        cand[x] = d;
        score += d < 128 ? d : 256 - d;
      }
      if (score < bestScore) {
        bestScore = score;
        bestF = f;
      }
    }
    const dst = y * (outStride + 1);
    filtered[dst] = bestF;
    filtered.set(candidates[bestF], dst + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const idat = zlib.deflateSync(filtered, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const execFileAsync = promisify(execFile);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs/screenshots");
const PROFILE = path.join(ROOT, ".taste-skill/chrome-shots");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PROFILE, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2"
};

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let filePath = path.join(ROOT, reqPath === "/" ? "index.html" : reqPath.replace(/^\//, ""));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com 'sha256-tLacyvDXM7iOBdrKicHZHGDOpIjXw5dTwO25l/lTFaI=' 'sha256-1bYHHe3SE5ji7T/2HhIPPaOd3hoICy83QpaTDL+iRYk='; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://antseedstats.com https://cloudflareinsights.com; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

// Use CDP via a tiny remote-debugging Chrome instance for true full-page + scrolled-section captures
const debugPort = 9222 + Math.floor(Math.random() * 500);
const chromeProc = execFile(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${debugPort}`,
    "--window-size=1440,900",
    "about:blank"
  ],
  { timeout: 120000 }
);

async function waitForCdp() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chrome CDP did not start");
}

function createCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const reqId = ++id;
          ws.send(JSON.stringify({ id: reqId, method, params }));
          return new Promise((res, rej) => pending.set(reqId, { res, rej }));
        },
        onEvent(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        close() {
          ws.close();
        }
      });
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        for (const fn of listeners) fn(msg);
      }
    });
    ws.addEventListener("error", reject);
  });
}

try {
  const wsUrl = await waitForCdp();
  const cdp = await createCdp(wsUrl);
  await cdp.send("Page.enable");

  async function capture({ urlPath, width, height, fullPage, scrollToSelector, outName, waitMs = 2600 }) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 500
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}${urlPath}` });
    await new Promise((r) => setTimeout(r, waitMs));
    await cdp.send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });

    if (scrollToSelector) {
      await cdp.send("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(scrollToSelector)}); if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' }); })()`
      });
      await new Promise((r) => setTimeout(r, 900));
    }

    let clip;
    if (fullPage) {
      const metrics = await cdp.send("Page.getLayoutMetrics");
      const contentH = Math.ceil(metrics.cssContentSize?.height || metrics.contentSize?.height || height);
      clip = { x: 0, y: 0, width, height: contentH, scale: 1 };
    }

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      ...(fullPage ? { captureBeyondViewport: true, clip } : {})
    });
    const outPath = path.join(OUT_DIR, outName);
    const rawBuf = Buffer.from(shot.data, "base64");
    const optBuf = optimizePngBuffer(rawBuf, 10);
    fs.writeFileSync(outPath, optBuf);
    console.log(`Saved ${path.relative(ROOT, outPath)} (${(optBuf.length / 1024).toFixed(1)} KB)`);
  }

  await capture({ urlPath: "/", width: 1440, height: 900, fullPage: true, outName: "home-1440.png" });
  await capture({ urlPath: "/", width: 1440, height: 900, fullPage: false, scrollToSelector: "#models", outName: "models-1440.png" });
  await capture({ urlPath: "/", width: 390, height: 844, fullPage: true, outName: "home-390.png" });
  await capture({ urlPath: "/connect/", width: 1440, height: 900, fullPage: true, outName: "connect-1440.png", waitMs: 1200 });
  await capture({ urlPath: "/connect/", width: 390, height: 844, fullPage: true, outName: "connect-390.png", waitMs: 1200 });

  // Measure hero app window vs content height across 1440x900, 1280x800, 1024x768, 390x844
  for (const [w, h] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [390, 844]
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: w < 500
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}/` });
    await new Promise((r) => setTimeout(r, 900));
    const res = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const win = document.querySelector('.hero__window').getBoundingClientRect();
        const piece = document.querySelector('.hero__window > .ly-piece').getBoundingClientRect();
        const badges = document.querySelector('.req-badges').getBoundingClientRect();
        return JSON.stringify({
          viewport: '${w}x${h}',
          windowH: Math.round(win.height),
          contentH: Math.round(piece.height),
          topClearance: Math.round(piece.top - win.top),
          bottomClearance: Math.round(win.bottom - piece.bottom),
          badgesClearInsidePiece: Math.round(piece.bottom - badges.bottom)
        });
      })()`,
      returnByValue: true
    });
    console.log("Hero window check:", res.result?.value);
  }

  // Verify console/runtime/CSP errors on /, /connect/, /privacy/, /terms/, /404.html
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  for (const route of ["/", "/connect/", "/privacy/", "/terms/", "/404.html"]) {
    const errs = [];
    const off = cdp.onEvent((msg) => {
      if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
        errs.push(msg.params.args?.map((a) => a.value || a.description).join(" "));
      } else if (msg.method === "Runtime.exceptionThrown") {
        errs.push(msg.params.exceptionDetails?.text || "exception");
      } else if (msg.method === "Log.entryAdded" && msg.params?.entry?.level === "error") {
        const text = msg.params.entry.text || "";
        // Ignore offline antseedstats.com fetch failures during local test if any
        if (!text.includes("antseedstats.com")) errs.push(text);
      }
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}${route}` });
    await new Promise((r) => setTimeout(r, 900));
    off();
    const check = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({ title: document.title, h1: document.querySelector('h1')?.textContent?.trim() })`,
      returnByValue: true
    });
    console.log(`Route ${route}:`, check.result?.value, `errors=${errs.length}`, errs.length ? errs : "");
  }

  cdp.close();
} finally {
  chromeProc.kill("SIGTERM");
  server.close();
}
