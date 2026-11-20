#!/usr/bin/env node
// Generates faithful raster brand assets from the original ant logo PNG:
// - Transparent marks: assets/brand/logo-mark-{64,128,256,512}.png (+ .webp if cwebp is installed)
// - Favicons (rounded cream tile for light/dark tab contrast): assets/brand/favicon-{16,32,48}.png + favicon.ico
// - App icons (opaque sand/cream #f5f0e6): assets/brand/apple-touch-icon.png (180x180), assets/brand/icon-512.png (512x512)
// - Social card: assets/brand/og-image.png (1200x630, rendered with self-hosted fonts via local headless Chrome)
//
// Usage:
//   node scripts/render-brand-assets.mjs /path/to/original-logo.png
//   BRAND_SOURCE_PNG=/path/to/original-logo.png node scripts/render-brand-assets.mjs
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "assets/brand");
const TMP_PROFILE = path.join(ROOT, ".taste-skill/chrome-brand");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SOURCE_PNG = process.argv[2] || process.env.BRAND_SOURCE_PNG;
if (!SOURCE_PNG) {
  console.error(
    "Usage: node scripts/render-brand-assets.mjs <path-to-original-logo.png>\n" +
      "   or: BRAND_SOURCE_PNG=<path> node scripts/render-brand-assets.mjs"
  );
  process.exit(1);
}
if (!fs.existsSync(SOURCE_PNG)) {
  console.error(`Source PNG not found: ${SOURCE_PNG}`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_PROFILE, { recursive: true });

/* ------------------------------------------------ minimal pure-Node PNG codec */
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
function decodePng(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Input is not a valid PNG file");
  }
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
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const out = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowIn + x];
      const a = x >= bpp ? out[rowOut + x - bpp] : 0;
      const b = y > 0 ? out[rowOut - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[rowOut - stride + x - bpp] : 0;
      let val = v;
      if (f === 1) val = (v + a) & 255;
      else if (f === 2) val = (v + b) & 255;
      else if (f === 3) val = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) val = (v + paeth(a, b, c)) & 255;
      out[rowOut + x] = val;
    }
  }
  return { width, height, bpp, data: out };
}

function encodePng(width, height, rgba, opaque = false) {
  const bpp = opaque ? 3 : 4;
  const colorType = opaque ? 2 : 6;
  const stride = width * bpp;
  const pixels = opaque ? new Uint8Array(width * height * 3) : rgba;
  if (opaque) {
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      pixels[j] = rgba[i];
      pixels[j + 1] = rgba[i + 1];
      pixels[j + 2] = rgba[i + 2];
    }
  }
  const filtered = Buffer.alloc(height * (stride + 1));
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let bestF = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const cand = candidates[f];
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const v = pixels[row + x];
        const a = x >= bpp ? pixels[row + x - bpp] : 0;
        const b = y > 0 ? pixels[row - stride + x] : 0;
        const c = x >= bpp && y > 0 ? pixels[row - stride + x - bpp] : 0;
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
    const dst = y * (stride + 1);
    filtered[dst] = bestF;
    filtered.set(candidates[bestF], dst + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;

  const idat = zlib.deflateSync(filtered, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

// Indexed PNG (colorType 3) when the rendered image has <= 256 unique RGBA entries (lossless & tiny)
function encodeIndexedIfPossible(width, height, rgba, opaque = false) {
  const palette = [];
  const indexMap = new Map();
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = opaque ? 255 : rgba[i * 4 + 3];
    const key = a === 0 ? 0 : (((r << 24) >>> 0) | (g << 16) | (b << 8) | a) >>> 0;
    let idx = indexMap.get(key);
    if (idx === undefined) {
      if (palette.length >= 256) return encodePng(width, height, rgba, opaque);
      idx = palette.length;
      indexMap.set(key, idx);
      palette.push(a === 0 ? [0, 0, 0, 0] : [r, g, b, a]);
    }
    indices[i] = idx;
  }

  // Filter scanlines (1 byte per pixel)
  const filtered = Buffer.alloc(height * (width + 1));
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(width));
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let bestF = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const cand = candidates[f];
      let score = 0;
      for (let x = 0; x < width; x++) {
        const v = indices[row + x];
        const a = x >= 1 ? indices[row + x - 1] : 0;
        const b = y > 0 ? indices[row - width + x] : 0;
        const c = x >= 1 && y > 0 ? indices[row - width + x - 1] : 0;
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
    const dst = y * (width + 1);
    filtered[dst] = bestF;
    filtered.set(candidates[bestF], dst + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3; // indexed colour

  const plte = Buffer.alloc(palette.length * 3);
  const trnsBytes = [];
  let hasAlpha = false;
  palette.forEach(([r, g, b, a], idx) => {
    plte[idx * 3] = r;
    plte[idx * 3 + 1] = g;
    plte[idx * 3 + 2] = b;
    trnsBytes.push(a);
    if (a < 255) hasAlpha = true;
  });

  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", plte)
  ];
  if (hasAlpha) chunks.push(pngChunk("tRNS", Buffer.from(trnsBytes)));
  chunks.push(pngChunk("IDAT", zlib.deflateSync(filtered, { level: 9 })));
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));

  const indexed = Buffer.concat(chunks);
  const full = encodePng(width, height, rgba, opaque);
  return indexed.length < full.length ? indexed : full;
}

function buildIco(pngEntries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngEntries.length, 4);

  const dir = Buffer.alloc(16 * pngEntries.length);
  let offset = 6 + 16 * pngEntries.length;
  pngEntries.forEach((entry, idx) => {
    const p = idx * 16;
    dir[p] = entry.size >= 256 ? 0 : entry.size;
    dir[p + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[p + 2] = 0;
    dir[p + 3] = 0;
    dir.writeUInt16LE(1, p + 4);
    dir.writeUInt16LE(32, p + 6);
    dir.writeUInt32LE(entry.png.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...pngEntries.map((e) => e.png)]);
}

/* ------------------------------------------- colour-distance alpha key + crop */
const srgbToLinear = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  srgbToLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(l) {
  const c = l <= 0 ? 0 : l >= 1 ? 1 : l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

function keyOriginalLogo(src) {
  const { width, height, bpp, data } = src;

  // Estimate cream background from 16x16 corner patches
  let bgR = 0, bgG = 0, bgB = 0, bgN = 0;
  for (const [cx, cy] of [
    [0, 0],
    [width - 16, 0],
    [0, height - 16],
    [width - 16, height - 16]
  ]) {
    for (let y = cy; y < cy + 16; y++) {
      for (let x = cx; x < cx + 16; x++) {
        const idx = (y * width + x) * bpp;
        bgR += data[idx];
        bgG += data[idx + 1];
        bgB += data[idx + 2];
        bgN++;
      }
    }
  }
  const bg = [bgR / bgN, bgG / bgN, bgB / bgN];

  // Estimate solid rust foreground colour from interior pixels far from cream background
  let fgR = 0, fgG = 0, fgB = 0, fgN = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * bpp];
    const g = data[i * bpp + 1];
    const b = data[i * bpp + 2];
    if (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) > 180) {
      fgR += r;
      fgG += g;
      fgB += b;
      fgN++;
    }
  }
  const fg = [Math.round(fgR / fgN), Math.round(fgG / fgN), Math.round(fgB / fgN)];

  // Projection vector bg -> fg: recovers exact antialiased alpha from the original raster
  const vx = fg[0] - bg[0];
  const vy = fg[1] - bg[1];
  const vz = fg[2] - bg[2];
  const v2 = vx * vx + vy * vy + vz * vz;

  // The original logo is a flat solid rust silhouette (interior std < 0.8/255) on cream.
  // Using the exact sampled fg RGB with the exact antialiased alpha eliminates source dither
  // noise and cream edge halos while keeping the silhouette 100% faithful to the original raster.
  const rgba = new Uint8Array(width * height * 4);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  const LOW = 0.035;
  const HIGH = 0.96;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = data[i * bpp];
      const g = data[i * bpp + 1];
      const b = data[i * bpp + 2];
      const srcA = bpp === 4 ? data[i * bpp + 3] / 255 : 1;

      const t = ((r - bg[0]) * vx + (g - bg[1]) * vy + (b - bg[2]) * vz) / v2;
      const a = Math.max(0, Math.min(1, (t - LOW) / (HIGH - LOW))) * srcA;
      const aByte = Math.round(a * 255);

      const o = i * 4;
      rgba[o] = aByte === 0 ? 0 : fg[0];
      rgba[o + 1] = aByte === 0 ? 0 : fg[1];
      rgba[o + 2] = aByte === 0 ? 0 : fg[2];
      rgba[o + 3] = aByte;

      if (aByte > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return {
    width,
    height,
    rgba,
    bbox: { minX, minY, maxX, maxY, bw: maxX - minX + 1, bh: maxY - minY + 1 },
    fg,
    bg: bg.map((v) => Math.round(v))
  };
}

function renderSquare(keyed, size, { fillRatio = 0.92, bgHex = null, cornerRadiusRatio = 0 } = {}) {
  const { width: sw, height: sh, rgba, bbox } = keyed;
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const span = Math.max(bbox.bw, bbox.bh) / fillRatio;
  const srcX0 = cx - span / 2;
  const srcY0 = cy - span / 2;
  const scale = span / size;

  const out = new Uint8Array(size * size * 4);
  const bgRgb = bgHex
    ? [
        parseInt(bgHex.slice(1, 3), 16),
        parseInt(bgHex.slice(3, 5), 16),
        parseInt(bgHex.slice(5, 7), 16)
      ]
    : null;
  const bgLin = bgRgb ? bgRgb.map((v) => srgbToLinear[v]) : null;
  const fgLin = keyed.fg.map((v) => srgbToLinear[v]);
  const rad = cornerRadiusRatio * size;

  for (let dy = 0; dy < size; dy++) {
    const sy0 = srcY0 + dy * scale;
    const sy1 = sy0 + scale;
    const iy0 = Math.max(0, Math.floor(sy0));
    const iy1 = Math.min(sh - 1, Math.ceil(sy1) - 1);

    for (let dx = 0; dx < size; dx++) {
      const sx0 = srcX0 + dx * scale;
      const sx1 = sx0 + scale;
      const ix0 = Math.max(0, Math.floor(sx0));
      const ix1 = Math.min(sw - 1, Math.ceil(sx1) - 1);

      let sumA = 0;
      for (let sy = iy0; sy <= iy1; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = ix0; sx <= ix1; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          sumA += (rgba[(sy * sw + sx) * 4 + 3] / 255) * wx * wy;
        }
      }

      const fgA = Math.min(1, sumA / (scale * scale));
      const o = (dy * size + dx) * 4;

      if (bgLin) {
        let maskA = 1;
        if (rad > 0) {
          let hits = 0;
          const inner = size / 2 - rad;
          for (let oy = 0; oy < 4; oy++) {
            const py = Math.abs(dy + (oy + 0.5) / 4 - size / 2) - inner;
            for (let ox = 0; ox < 4; ox++) {
              const px = Math.abs(dx + (ox + 0.5) / 4 - size / 2) - inner;
              const dist = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - rad;
              if (dist <= 0) hits++;
            }
          }
          maskA = hits / 16;
        }
        const aByte = Math.round(maskA * 255);
        out[o] = aByte === 0 ? 0 : linearToSrgb(fgLin[0] * fgA + bgLin[0] * (1 - fgA));
        out[o + 1] = aByte === 0 ? 0 : linearToSrgb(fgLin[1] * fgA + bgLin[1] * (1 - fgA));
        out[o + 2] = aByte === 0 ? 0 : linearToSrgb(fgLin[2] * fgA + bgLin[2] * (1 - fgA));
        out[o + 3] = aByte;
      } else {
        const aByte = Math.round(fgA * 255);
        out[o] = aByte === 0 ? 0 : keyed.fg[0];
        out[o + 1] = aByte === 0 ? 0 : keyed.fg[1];
        out[o + 2] = aByte === 0 ? 0 : keyed.fg[2];
        out[o + 3] = aByte;
      }
    }
  }
  return out;
}

/* ------------------------------------------- generate raster marks & icons */
const decoded = decodePng(SOURCE_PNG);
const keyed = keyOriginalLogo(decoded);
const fgHex = "#" + keyed.fg.map((v) => v.toString(16).padStart(2, "0")).join("");
console.log(
  `Source: ${decoded.width}x${decoded.height}, bbox=${keyed.bbox.bw}x${keyed.bbox.bh}, fg=${fgHex}, bg=rgb(${keyed.bg.join(",")})`
);

// 1. Transparent ant marks for nav, hero, FAQ, OG card (1x/2x srcset)
for (const size of [64, 128, 256, 512]) {
  const rgba = renderSquare(keyed, size, { fillRatio: 0.92 });
  const png = encodeIndexedIfPossible(size, size, rgba, false);
  const outPath = path.join(OUT_DIR, `logo-mark-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${path.relative(ROOT, outPath)} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

// Optional WebP counterparts when cwebp is available
async function tryWebp(pngPath) {
  const webpPath = pngPath.replace(/\.png$/, ".webp");
  try {
    await execFileAsync("cwebp", ["-quiet", "-lossless", "-z", "9", pngPath, "-o", webpPath], { timeout: 15000 });
    const stat = fs.statSync(webpPath);
    console.log(`Wrote ${path.relative(ROOT, webpPath)} (${(stat.size / 1024).toFixed(1)} KB)`);
  } catch {
    // cwebp optional
  }
}
for (const size of [64, 128, 256, 512]) {
  await tryWebp(path.join(OUT_DIR, `logo-mark-${size}.png`));
}

// 2. Favicons (16, 32, 48 on rounded cream tile #f5f0e6 + multi-size favicon.ico)
const faviconEntries = [];
for (const size of [16, 32, 48]) {
  const rgba = renderSquare(keyed, size, {
    fillRatio: 0.84,
    bgHex: "#f5f0e6",
    cornerRadiusRatio: 0.22
  });
  const png = encodeIndexedIfPossible(size, size, rgba, false);
  const outPath = path.join(OUT_DIR, `favicon-${size}.png`);
  fs.writeFileSync(outPath, png);
  faviconEntries.push({ size, png });
  console.log(`Wrote ${path.relative(ROOT, outPath)} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}
const icoBuf = buildIco(faviconEntries);
fs.writeFileSync(path.join(ROOT, "favicon.ico"), icoBuf);
console.log(`Wrote favicon.ico (16/32/48, ${(icoBuf.length / 1024).toFixed(1)} KB)`);

// 3. Opaque app icons (apple-touch-icon 180x180, icon-512 512x512 on #f5f0e6)
for (const [name, size] of [
  ["apple-touch-icon.png", 180],
  ["icon-512.png", 512]
]) {
  const rgba = renderSquare(keyed, size, { fillRatio: 0.76, bgHex: "#f5f0e6" });
  const png = encodeIndexedIfPossible(size, size, rgba, true);
  const outPath = path.join(OUT_DIR, name);
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${path.relative(ROOT, outPath)} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

/* ------------------------------------------- render OG image (1200x630) via self-contained file:// HTML */
function fontDataUri(rel) {
  const b64 = fs.readFileSync(path.join(ROOT, "assets/fonts", rel)).toString("base64");
  return `data:font/woff2;base64,${b64}`;
}
const logoDataUri = `data:image/png;base64,${fs.readFileSync(path.join(OUT_DIR, "logo-mark-512.png")).toString("base64")}`;

const ogHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  @font-face { font-family: "Funnel Display"; src: url("${fontDataUri("funnel-display-400-700.woff2")}") format("woff2"); font-weight: 400 700; font-style: normal; }
  @font-face { font-family: "Funnel Sans"; src: url("${fontDataUri("funnel-sans-400-600.woff2")}") format("woff2"); font-weight: 400 600; font-style: normal; }
  @font-face { font-family: "DM Mono"; src: url("${fontDataUri("dm-mono-400.woff2")}") format("woff2"); font-weight: 400; font-style: normal; }
  @font-face { font-family: "DM Mono"; src: url("${fontDataUri("dm-mono-500.woff2")}") format("woff2"); font-weight: 500; font-style: normal; }
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
    background: #f5f0e6;
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
    font-size: 76px; line-height: 1.02; font-weight: 500; letter-spacing: -0.035em;
    color: #1f1916; margin-bottom: 22px;
  }
  p {
    font-size: 25px; line-height: 1.45; color: #4c4540; max-width: 640px; margin-bottom: 34px;
  }
  .meta {
    display: flex; gap: 28px; font-family: "DM Mono", monospace; font-size: 17px; color: #1f1916;
    border-top: 1px solid rgba(31, 25, 22, 0.14); padding-top: 22px;
  }
  .meta span { color: #68625d; }
  .mark-wrap {
    width: 320px; height: 320px; border-radius: 44px;
    background: #ebe3d5; border: 1.5px solid rgba(31, 25, 22, 0.12);
    display: grid; place-items: center; padding: 34px;
  }
  .mark-wrap img { width: 252px; height: 252px; display: block; }
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
    <div class="mark-wrap"><img src="${logoDataUri}" alt="" width="252" height="252"></div>
  </div>
</body></html>`;

const tmpHtml = path.join(os.tmpdir(), `attacompute-og-${process.pid}.html`);
const tmpOg = path.join(os.tmpdir(), `attacompute-og-${process.pid}.png`);
const ogOut = path.join(OUT_DIR, "og-image.png");
fs.writeFileSync(tmpHtml, ogHtml);

try {
  await execFileAsync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--user-data-dir=${TMP_PROFILE}`,
      "--window-size=1200,630",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      `--screenshot=${tmpOg}`,
      `file://${tmpHtml}`
    ],
    { timeout: 30000 }
  );
  if (!fs.existsSync(tmpOg)) {
    throw new Error("Chrome failed to produce OG screenshot");
  }
  const ogDec = decodePng(tmpOg);
  const ogRgba = new Uint8Array(ogDec.width * ogDec.height * 4);
  for (let i = 0; i < ogDec.width * ogDec.height; i++) {
    ogRgba[i * 4] = ogDec.data[i * ogDec.bpp];
    ogRgba[i * 4 + 1] = ogDec.data[i * ogDec.bpp + 1];
    ogRgba[i * 4 + 2] = ogDec.data[i * ogDec.bpp + 2];
    ogRgba[i * 4 + 3] = 255;
  }
  const ogOpt = encodePng(ogDec.width, ogDec.height, ogRgba, true);
  fs.writeFileSync(ogOut, ogOpt);
  console.log(`Wrote ${path.relative(ROOT, ogOut)} (1200x630, ${(ogOpt.length / 1024).toFixed(1)} KB)`);
} finally {
  fs.rmSync(tmpHtml, { force: true });
  fs.rmSync(tmpOg, { force: true });
}
