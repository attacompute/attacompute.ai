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
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
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
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const reqId = ++id;
          ws.send(JSON.stringify({ id: reqId, method, params }));
          return new Promise((res, rej) => pending.set(reqId, { res, rej }));
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
    fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));
    console.log("Saved", path.relative(ROOT, outPath));
  }

  await capture({ urlPath: "/", width: 1440, height: 900, fullPage: true, outName: "home-1440.png" });
  await capture({ urlPath: "/", width: 1440, height: 900, fullPage: false, scrollToSelector: "#models", outName: "models-1440.png" });
  await capture({ urlPath: "/", width: 390, height: 844, fullPage: true, outName: "home-390.png" });
  await capture({ urlPath: "/connect/", width: 1440, height: 900, fullPage: true, outName: "connect-1440.png", waitMs: 1200 });
  await capture({ urlPath: "/connect/", width: 390, height: 844, fullPage: true, outName: "connect-390.png", waitMs: 1200 });

  cdp.close();
} finally {
  chromeProc.kill("SIGTERM");
  server.close();
}
