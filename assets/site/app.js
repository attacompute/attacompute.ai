// attacompute public client module:
// - Live seller models & per-token prices via /api/models (Cloudflare Pages Function)
//   with localStorage cache (attacompute_models_v1) and data/models-snapshot.json fallback
// - Live AntSeedStats settlement telemetry & daily chart with 5-minute refresh,
//   localStorage cache (attacompute_antseedstats_v1), and data/snapshot.json fallback
// - Accessible sortable + filterable models table (MWG: responsive-table, sortable-table)
// - OS detection for AntSeed Desktop download buttons
// - Copy-to-clipboard (MWG: copy-button)
import { renderDailyChart } from "./chart.js";
import { initCopyButtons } from "./copy.js";

const API_BASE = "https://antseedstats.com/api/v1";
const MODELS_API_URL = "/api/models";
const CURRENT_SELLER = "0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139";
const CURRENT_PEER = "6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139";
const ORIGINAL_SELLER = "0xd5e7d5950b6cc71c095da4ace0c0cb8495667be0";
const STATS_CACHE_KEY = "attacompute_antseedstats_v1";
const MODELS_CACHE_KEY = "attacompute_models_v1";
const MODELS_META_CACHE_KEY = "attacompute_models_meta_v1";
const STATS_REFRESH_MS = 5 * 60 * 1000;
const MODELS_REFRESH_MS = 2 * 60 * 1000;

const DOWNLOAD_TARGETS = {
  "mac-arm64": {
    label: "macOS Apple silicon",
    short: "macOS (Apple silicon)",
    href: "https://download.antseed.com/vpr/mac-arm64"
  },
  "mac-x64": {
    label: "macOS Intel",
    short: "macOS (Intel)",
    href: "https://download.antseed.com/vpr/mac-x64"
  },
  "win-x64": {
    label: "Windows x64",
    short: "Windows",
    href: "https://download.antseed.com/vpr/win-x64"
  },
  "linux-x64": {
    label: "Linux x64",
    short: "Linux (x64)",
    href: "https://download.antseed.com/vpr/linux-x64"
  },
  "linux-arm64": {
    label: "Linux arm64",
    short: "Linux (ARM64)",
    href: "https://download.antseed.com/vpr/linux-arm64"
  }
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
let currentModels = [];
let lastRawModels = null;
let lastRenderedFingerprint = "";
let displayMetaMap = {};
let activeFilter = "all";
let searchQuery = "";
let modelsExpanded = false;

let statsSourceMode = "snapshot"; // "live" | "cache" | "snapshot"
let statsUpdatedAt = null;
let modelsSourceMode = "loading"; // "loading" | "live" | "cache" | "snapshot" | "static"
let modelsUpdatedAt = null;

let statsSnapshotPromise = null;
let modelsSnapshotPromise = null;

function fmtUsd(amount) {
  if (amount == null || Number.isNaN(amount)) return "—";
  return `$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtPricePerM(val, isFree) {
  if (isFree) return "Free";
  if (val == null || Number.isNaN(Number(val))) return "—";
  const n = Number(val);
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toFixed(4).replace(/(\.\d{2,}?)0+$/, "$1")}`;
  return `$${n.toFixed(2)}`;
}

function fmtCompactTokens(n) {
  const num = Number(n || 0);
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}k`;
  return String(num);
}

function fmtRelativeTime(isoOrMs) {
  if (!isoOrMs) return "just now";
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (Number.isNaN(ms)) return "recently";
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function toFinitePrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value === 0 ? 0 : value;
}

function normalizeHealth(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return s || null;
}

function healthDisplay(health) {
  if (!health) return null;
  if (health === "healthy") return { label: "Healthy", cls: "model-health--healthy" };
  if (health === "degraded") return { label: "Degraded", cls: "model-health--degraded" };
  if (health === "unhealthy" || health === "down" || health === "offline" || health === "error") {
    return { label: "Offline", cls: "model-health--unhealthy" };
  }
  return {
    label: health.charAt(0).toUpperCase() + health.slice(1),
    cls: "model-health--unknown"
  };
}

function updateStatsTimestampLabels() {
  const text =
    statsSourceMode === "live"
      ? `Live · Updated ${fmtRelativeTime(statsUpdatedAt)}`
      : statsSourceMode === "cache"
        ? `Cached ${fmtRelativeTime(statsUpdatedAt)} (API offline)`
        : statsUpdatedAt
          ? `Snapshot ${fmtRelativeTime(statsUpdatedAt)}`
          : "Snapshot loaded";
  for (const el of document.querySelectorAll("[data-stats-updated-label]")) {
    el.textContent = text;
  }
}

function updateModelsTimestampLabels() {
  let labelText;
  let sourceNote;
  if (modelsSourceMode === "live") {
    labelText = `Live · Updated ${fmtRelativeTime(modelsUpdatedAt)}`;
    sourceNote = "Source: Live seller metadata";
  } else if (modelsSourceMode === "cache") {
    labelText = `Cached ${fmtRelativeTime(modelsUpdatedAt)} (live endpoint offline)`;
    sourceNote = "Source: Cached seller metadata";
  } else if (modelsSourceMode === "snapshot") {
    labelText = modelsUpdatedAt ? `Snapshot ${fmtRelativeTime(modelsUpdatedAt)}` : "Snapshot loaded";
    sourceNote = "Source: Build-time seller snapshot";
  } else if (modelsSourceMode === "static") {
    labelText = "Offline (static snapshot)";
    sourceNote = "Source: Static fallback snapshot";
  } else {
    labelText = "Checking live rates…";
    sourceNote = "Source: attacompute Phala TEE peer metadata";
  }

  for (const el of document.querySelectorAll("[data-models-updated-label]")) {
    el.textContent = labelText;
  }
  for (const el of document.querySelectorAll("[data-models-source-note]")) {
    el.textContent = sourceNote;
  }
}

function updateAllTimestampLabels() {
  updateStatsTimestampLabels();
  updateModelsTimestampLabels();
}

function extractMetaEntries(entries) {
  const out = {};
  if (!entries) return out;
  if (Array.isArray(entries)) {
    for (const item of entries) {
      const id = String(item?.advertised_as || item?.model || "").trim();
      if (!id) continue;
      out[id] = {
        model_display:
          typeof item.model_display === "string" && item.model_display.trim()
            ? item.model_display.trim()
            : id,
        modality:
          typeof item.modality === "string" && item.modality.trim()
            ? item.modality.trim().toLowerCase()
            : "text",
        save_pct:
          typeof item.save_pct === "number" && Number.isFinite(item.save_pct) && item.save_pct > 0
            ? Math.round(item.save_pct)
            : null,
        input_usd_per_m: toFinitePrice(item.input_usd_per_m)
      };
    }
    return out;
  }
  if (typeof entries === "object") {
    for (const [id, item] of Object.entries(entries)) {
      if (!id || !item || typeof item !== "object") continue;
      out[id] = {
        model_display:
          typeof item.model_display === "string" && item.model_display.trim()
            ? item.model_display.trim()
            : id,
        modality:
          typeof item.modality === "string" && item.modality.trim()
            ? item.modality.trim().toLowerCase()
            : "text",
        save_pct:
          typeof item.save_pct === "number" && Number.isFinite(item.save_pct) && item.save_pct > 0
            ? Math.round(item.save_pct)
            : null,
        input_usd_per_m: toFinitePrice(item.input_usd_per_m)
      };
    }
  }
  return out;
}

function absorbDisplayMeta(entries, { persist = false } = {}) {
  const parsed = extractMetaEntries(entries);
  let changed = false;
  for (const [id, info] of Object.entries(parsed)) {
    const prev = displayMetaMap[id];
    if (
      !prev ||
      prev.model_display !== info.model_display ||
      prev.modality !== info.modality ||
      prev.save_pct !== info.save_pct ||
      prev.input_usd_per_m !== info.input_usd_per_m
    ) {
      displayMetaMap[id] = info;
      changed = true;
    }
  }
  if (changed && persist) {
    try {
      localStorage.setItem(MODELS_META_CACHE_KEY, JSON.stringify(displayMetaMap));
    } catch {
      // Storage quota or private browsing
    }
  }
  return changed;
}

function readDisplayMetaCache() {
  try {
    const raw = localStorage.getItem(MODELS_META_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeSellerModelEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.model || raw.advertised_as || "").trim();
  if (!id) return null;

  // Support both minimal /api/models shape ({ input, cachedInput, output })
  // and legacy snapshot shape ({ input_usd_per_m, cached_input_usd_per_m, output_usd_per_m }).
  const input =
    raw.input !== undefined ? toFinitePrice(raw.input) : toFinitePrice(raw.input_usd_per_m);
  const cachedInput =
    raw.cachedInput !== undefined
      ? toFinitePrice(raw.cachedInput)
      : toFinitePrice(raw.cached_input_usd_per_m);
  const output =
    raw.output !== undefined ? toFinitePrice(raw.output) : toFinitePrice(raw.output_usd_per_m);

  const presentPrices = [input, cachedInput, output].filter((v) => v !== null);
  const free =
    typeof raw.free === "boolean"
      ? raw.free
      : presentPrices.length > 0 && presentPrices.every((v) => v === 0);

  return {
    model: id,
    input,
    cachedInput,
    output,
    free,
    health: normalizeHealth(raw.health)
  };
}

function mergeModelsWithDisplayMeta(rawModels = []) {
  const result = [];
  for (const raw of rawModels) {
    const item = normalizeSellerModelEntry(raw);
    if (!item) continue;
    const meta = Object.hasOwn(displayMetaMap, item.model) ? displayMetaMap[item.model] : null;

    let savePct = null;
    if (!item.free && meta?.save_pct != null && Number(meta.save_pct) > 0) {
      const refInput = toFinitePrice(meta.input_usd_per_m);
      if (refInput === null || (item.input !== null && Math.abs(refInput - item.input) < 1e-9)) {
        savePct = Math.round(Number(meta.save_pct));
      }
    }

    result.push({
      model: item.model,
      model_display: meta?.model_display || item.model,
      advertised_as: item.model,
      modality: (meta?.modality || "text").toLowerCase(),
      free: item.free,
      health: item.health,
      input_usd_per_m: item.input,
      cached_input_usd_per_m: item.cachedInput,
      output_usd_per_m: item.output,
      save_pct: savePct
    });
  }
  return result;
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveModels() {
  const payload = await fetchJson(MODELS_API_URL, 6500);
  if (!payload || !Array.isArray(payload.models) || payload.models.length === 0) {
    throw new Error("Invalid /api/models payload");
  }
  const normalized = payload.models.map(normalizeSellerModelEntry).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("Empty /api/models payload");
  }
  return {
    updatedAt: payload.updatedAt || new Date().toISOString(),
    models: normalized
  };
}

function readModelsCache() {
  try {
    const raw = localStorage.getItem(MODELS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) return null;
    const normalized = parsed.models.map(normalizeSellerModelEntry).filter(Boolean);
    if (normalized.length === 0) return null;
    return {
      updatedAt: parsed.updatedAt || null,
      models: normalized
    };
  } catch {
    return null;
  }
}

function writeModelsCache(payload) {
  try {
    localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage quota or private browsing
  }
}

function readModelsSnapshot() {
  if (!modelsSnapshotPromise) {
    const base = document.documentElement.dataset.root || "";
    modelsSnapshotPromise = fetchJson(`${base}data/models-snapshot.json`, 6000)
      .then((snap) => {
        if (snap?.meta) absorbDisplayMeta(snap.meta, { persist: true });
        return snap;
      })
      .catch((err) => {
        modelsSnapshotPromise = null;
        throw err;
      });
  }
  return modelsSnapshotPromise;
}

async function fetchLiveStatsBundle() {
  const [curSeller, origSeller, curDaily, origDaily] = await Promise.all([
    fetchJson(`${API_BASE}/sellers/${CURRENT_SELLER}`),
    fetchJson(`${API_BASE}/sellers/${ORIGINAL_SELLER}`),
    fetchJson(`${API_BASE}/sellers/${CURRENT_SELLER}/daily?from=2026-01-01&to=2026-12-31`),
    fetchJson(`${API_BASE}/sellers/${ORIGINAL_SELLER}/daily?from=2026-01-01&to=2026-12-31`)
  ]);
  return {
    generated_at: new Date().toISOString(),
    sellers: {
      current: curSeller?.data || {},
      original: origSeller?.data || {}
    },
    daily: {
      current: curDaily?.data?.days || [],
      original: origDaily?.data?.days || []
    }
  };
}

function readStatsCache() {
  try {
    const raw = localStorage.getItem(STATS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sellers?.current) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStatsCache(bundle) {
  try {
    localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(bundle));
  } catch {
    // Storage quota or private browsing
  }
}

function readStatsSnapshot() {
  if (!statsSnapshotPromise) {
    const base = document.documentElement.dataset.root || "";
    statsSnapshotPromise = fetchJson(`${base}data/snapshot.json`, 6000)
      .then((snap) => {
        if (Array.isArray(snap?.models)) absorbDisplayMeta(snap.models, { persist: true });
        return snap;
      })
      .catch((err) => {
        statsSnapshotPromise = null;
        throw err;
      });
  }
  return statsSnapshotPromise;
}

function setText(selector, value) {
  for (const node of document.querySelectorAll(selector)) {
    node.textContent = value;
  }
}

function renderStats(bundle) {
  const cur = bundle?.sellers?.current || {};
  const orig = bundle?.sellers?.original || {};

  const curUsd = Number(cur.revenue_micro || 0) / 1e6;
  const origUsd = Number(orig.revenue_micro || 0) / 1e6;
  const totalUsd = curUsd + origUsd;
  const totalSettles = Number(cur.settles || 0) + Number(orig.settles || 0);
  const totalTokens = Number(cur.tokens || 0) + Number(orig.tokens || 0);
  const totalBuyers = Number(cur.buyers || 0) + Number(orig.buyers || 0);

  setText("[data-stat='total-usdc']", fmtUsd(totalUsd));
  setText("[data-stat='total-settles']", totalSettles.toLocaleString("en-US"));
  setText("[data-stat='total-tokens']", fmtCompactTokens(totalTokens));
  setText("[data-stat='total-buyers']", totalBuyers.toLocaleString("en-US"));

  // Per-seller breakdown
  setText("[data-seller='orig-usdc']", fmtUsd(origUsd));
  setText("[data-seller='orig-settles']", Number(orig.settles || 0).toLocaleString("en-US"));
  setText("[data-seller='orig-buyers']", Number(orig.buyers || 0).toLocaleString("en-US"));
  setText("[data-seller='orig-rank']", orig.rank ? `#${orig.rank}` : "—");
  setText("[data-seller='orig-rep']", orig.reputation ? Number(orig.reputation).toFixed(1) : "—");

  setText("[data-seller='cur-usdc']", fmtUsd(curUsd));
  setText("[data-seller='cur-settles']", Number(cur.settles || 0).toLocaleString("en-US"));
  setText("[data-seller='cur-buyers']", Number(cur.buyers || 0).toLocaleString("en-US"));
  setText("[data-seller='cur-rank']", cur.rank ? `#${cur.rank}` : "—");
  setText("[data-seller='cur-tee']", cur.tee_advertised ? "Phala TEE verified" : "TEE pending");

  // Render daily stitched chart
  const chartEl = document.getElementById("daily-chart");
  const readoutEl = document.getElementById("chart-readout");
  if (chartEl) {
    renderDailyChart(chartEl, readoutEl, bundle?.daily?.original || [], bundle?.daily?.current || []);
  }
}

function makeCopySvg() {
  const ns = "http://www.w3.org/2000/svg";
  const copySvg = document.createElementNS(ns, "svg");
  copySvg.setAttribute("viewBox", "0 0 16 16");
  copySvg.setAttribute("aria-hidden", "true");
  copySvg.classList.add("ic-copy");
  const r1 = document.createElementNS(ns, "rect");
  r1.setAttribute("x", "5");
  r1.setAttribute("y", "5");
  r1.setAttribute("width", "8");
  r1.setAttribute("height", "9");
  r1.setAttribute("rx", "1.5");
  r1.setAttribute("fill", "none");
  r1.setAttribute("stroke", "currentColor");
  r1.setAttribute("stroke-width", "1.4");
  const p1 = document.createElementNS(ns, "path");
  p1.setAttribute("d", "M3.5 10.5H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5");
  p1.setAttribute("fill", "none");
  p1.setAttribute("stroke", "currentColor");
  p1.setAttribute("stroke-width", "1.4");
  copySvg.append(r1, p1);

  const checkSvg = document.createElementNS(ns, "svg");
  checkSvg.setAttribute("viewBox", "0 0 16 16");
  checkSvg.setAttribute("aria-hidden", "true");
  checkSvg.classList.add("ic-check");
  const pc = document.createElementNS(ns, "path");
  pc.setAttribute("d", "M3.5 8.5 6.5 11.5 13 4.5");
  pc.setAttribute("fill", "none");
  pc.setAttribute("stroke", "currentColor");
  pc.setAttribute("stroke-width", "1.7");
  pc.setAttribute("stroke-linecap", "round");
  pc.setAttribute("stroke-linejoin", "round");
  checkSvg.append(pc);

  return [copySvg, checkSvg];
}

function buildModelRow(m) {
  const tr = document.createElement("tr");
  tr.dataset.modality = m.modality;
  tr.dataset.free = m.free ? "1" : "0";
  tr.dataset.search = `${m.model_display} ${m.advertised_as} ${m.modality} ${m.free ? "free" : ""} ${m.health || ""}`.toLowerCase();

  // Col 1: Row header (Model display + advertised_as + copy button + semantic health status)
  const th = document.createElement("th");
  th.scope = "row";
  th.dataset.value = m.model_display;

  const cell = document.createElement("div");
  cell.className = "model-cell";

  const hasDistinctDisplay = m.model_display && m.model_display !== m.advertised_as;
  if (hasDistinctDisplay) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "model-name";
    nameSpan.textContent = m.model_display;
    cell.append(nameSpan);
  }

  const idRow = document.createElement("span");
  idRow.className = "model-id-row";

  const code = document.createElement("code");
  code.className = hasDistinctDisplay ? "model-id-code" : "model-id-code model-id-code--primary";
  code.textContent = m.advertised_as;

  const copyWrap = document.createElement("span");
  copyWrap.className = "copy-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn copy-btn--light";
  btn.setAttribute("command", "--copy");
  btn.setAttribute("commandfor", "models-table");
  btn.dataset.copyValue = `${CURRENT_PEER}@${m.advertised_as}`;
  btn.setAttribute("aria-label", `Copy pinned model ID for ${m.model_display}`);
  btn.append(...makeCopySvg());

  const tip = document.createElement("span");
  tip.className = "copy-tip";
  tip.setAttribute("role", "status");

  copyWrap.append(btn, tip);
  idRow.append(code, copyWrap);
  cell.append(idRow);

  const healthInfo = healthDisplay(m.health);
  if (healthInfo) {
    const healthEl = document.createElement("span");
    healthEl.className = `model-health ${healthInfo.cls}`;
    const mark = document.createElement("span");
    mark.className = "model-health__mark";
    mark.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = healthInfo.label;
    healthEl.append(mark, text);
    cell.append(healthEl);
  }

  th.append(cell);

  // Col 2: Modality
  const tdMod = document.createElement("td");
  tdMod.dataset.value = m.free ? `free ${m.modality}` : m.modality;
  const badge = document.createElement("span");
  badge.className = m.free ? "mod-badge mod-badge--free" : "mod-badge";
  badge.textContent = m.free ? `${m.modality} · Free` : m.modality;
  tdMod.append(badge);

  // Col 3: Input / 1M
  const tdIn = document.createElement("td");
  tdIn.className = "num";
  tdIn.dataset.value = m.free ? "0" : String(m.input_usd_per_m ?? 999999);
  tdIn.textContent = fmtPricePerM(m.input_usd_per_m, m.free);

  // Col 4: Cached input / 1M
  const tdCached = document.createElement("td");
  tdCached.className = "num";
  tdCached.dataset.value = m.free ? "0" : String(m.cached_input_usd_per_m ?? 999999);
  tdCached.textContent = m.free ? "Free" : fmtPricePerM(m.cached_input_usd_per_m, false);

  // Col 5: Output / 1M
  const tdOut = document.createElement("td");
  tdOut.className = "num";
  tdOut.dataset.value = m.free ? "0" : String(m.output_usd_per_m ?? 999999);
  tdOut.textContent = m.free ? "Free" : fmtPricePerM(m.output_usd_per_m, false);

  // Col 6: Savings
  const tdSave = document.createElement("td");
  tdSave.className = "num";
  if (m.free) {
    tdSave.dataset.value = "100";
    const sp = document.createElement("span");
    sp.className = "save-pill save-pill--free";
    sp.textContent = "Free";
    tdSave.append(sp);
  } else if (m.save_pct != null && Number(m.save_pct) > 0) {
    tdSave.dataset.value = String(Number(m.save_pct));
    const sp = document.createElement("span");
    sp.className = "save-pill";
    sp.textContent = `Save ${Math.round(Number(m.save_pct))}%`;
    tdSave.append(sp);
  } else {
    tdSave.dataset.value = "-1";
    tdSave.textContent = "—";
  }

  tr.append(th, tdMod, tdIn, tdCached, tdOut, tdSave);
  return tr;
}

function updatePriceSpectrum(models) {
  const summaryEl = document.getElementById("price-spectrum-summary");
  const svgEl = document.getElementById("price-spectrum-svg");
  if (!summaryEl || !models.length) return;

  const freeCount = models.filter((m) => m.free).length;
  const paidInputs = models
    .filter((m) => !m.free && m.input_usd_per_m != null && Number.isFinite(m.input_usd_per_m))
    .map((m) => m.input_usd_per_m)
    .sort((a, b) => a - b);
  const maxSave = models.reduce(
    (best, m) => (!m.free && m.save_pct != null && m.save_pct > best ? m.save_pct : best),
    0
  );

  const parts = [];
  if (freeCount > 0) parts.push("$0 Free");
  if (paidInputs.length > 0) {
    const minPaid = fmtPricePerM(paidInputs[0], false);
    const maxPaid = fmtPricePerM(paidInputs[paidInputs.length - 1], false);
    parts.push(minPaid === maxPaid ? `${minPaid} / 1M` : `${minPaid}–${maxPaid} / 1M`);
  }
  if (maxSave > 0) parts.push(`Save up to ${Math.round(maxSave)}%`);

  if (parts.length > 0) {
    summaryEl.textContent = parts.join(" · ");
  }
  if (svgEl && paidInputs.length > 0) {
    const lowLabel = freeCount > 0 ? "$0 free tier" : fmtPricePerM(paidInputs[0], false);
    const highLabel = fmtPricePerM(paidInputs[paidInputs.length - 1], false);
    const saveClause = maxSave > 0 ? `, with savings up to ${Math.round(maxSave)} percent` : "";
    svgEl.setAttribute(
      "aria-label",
      `Input price distribution across ${models.length} advertised models from ${lowLabel} to ${highLabel} per million tokens${saveClause}`
    );
  }
}

function renderFilterChips(models) {
  const group = document.getElementById("models-filter-group");
  if (!group) return;

  const modCounts = new Map();
  let freeCount = 0;
  for (const m of models) {
    const mod = (m.modality || "text").toLowerCase();
    modCounts.set(mod, (modCounts.get(mod) || 0) + 1);
    if (m.free) freeCount++;
  }

  const preferredOrder = ["text", "image", "video", "audio"];
  const sortedMods = [...modCounts.keys()].sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return collator.compare(a, b);
  });

  const chips = [{ key: "all", label: "All", count: models.length }];
  for (const mod of sortedMods) {
    const count = modCounts.get(mod) || 0;
    if (count > 0) {
      chips.push({ key: mod, label: mod.charAt(0).toUpperCase() + mod.slice(1), count });
    }
  }
  if (freeCount > 0) {
    chips.push({ key: "free", label: "Free", count: freeCount });
  }

  if (!chips.some((c) => c.key === activeFilter)) {
    activeFilter = "all";
  }

  const frag = document.createDocumentFragment();
  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.dataset.filter = chip.key;
    btn.setAttribute("aria-pressed", chip.key === activeFilter ? "true" : "false");
    btn.append(document.createTextNode(`${chip.label} `));
    const countEl = document.createElement("span");
    countEl.className = "filter-btn__count";
    countEl.textContent = String(chip.count);
    btn.append(countEl);
    frag.append(btn);
  }
  group.replaceChildren(frag);
}

function applyModelFilters() {
  const tbody = document.getElementById("models-tbody");
  const emptyRow = document.getElementById("models-empty-row");
  const statusEl = document.getElementById("models-status");
  const moreBtn = document.getElementById("models-more-btn");
  if (!tbody) return;

  const q = searchQuery.trim().toLowerCase();
  const compactLimit = !modelsExpanded && !q && activeFilter === "all" ? (window.innerWidth < 640 ? 4 : 6) : 1000;
  let matchedCount = 0;
  let visibleCount = 0;

  for (const row of tbody.querySelectorAll("tr[data-modality]")) {
    const modMatch =
      activeFilter === "all" ||
      (activeFilter === "free" ? row.dataset.free === "1" : row.dataset.modality === activeFilter);
    const qMatch = !q || (row.dataset.search || "").includes(q);
    const matches = modMatch && qMatch;
    if (matches) matchedCount++;
    const show = matches && matchedCount <= compactLimit;
    row.hidden = !show;
    if (show) visibleCount++;
  }

  if (moreBtn) {
    const remaining = matchedCount - visibleCount;
    moreBtn.hidden = remaining <= 0;
    moreBtn.textContent = `Show all ${matchedCount} models`;
  }
  if (emptyRow) emptyRow.hidden = visibleCount > 0;
  if (statusEl) {
    const modeTag =
      modelsSourceMode === "live"
        ? "live"
        : modelsSourceMode === "cache"
          ? "cached"
          : modelsSourceMode === "snapshot"
            ? "snapshot"
            : "static";
    statusEl.textContent = `Showing ${visibleCount} of ${currentModels.length} advertised models (${modeTag})`;
  }
}

function applyCurrentTableSort() {
  const table = document.getElementById("models-table");
  const tbody = document.getElementById("models-tbody");
  if (!table || !tbody) return;
  const activeTh = table.tHead?.querySelector("th[aria-sort]");
  if (!activeTh) return;

  const index = activeTh.cellIndex;
  const type = activeTh.dataset.type || "text";
  const direction = activeTh.getAttribute("aria-sort");
  const factor = direction === "descending" ? -1 : 1;

  // Keep default Free-first order when sorted ascending by Input / 1M (index 2)
  if (index === 2 && direction === "ascending") return;

  const dataRows = [...tbody.querySelectorAll("tr[data-modality]")];
  const valueOf = (row) => row.cells[index]?.dataset.value ?? row.cells[index]?.textContent.trim() ?? "";

  dataRows.sort((a, b) =>
    factor * (type === "number" ? Number(valueOf(a)) - Number(valueOf(b)) : collator.compare(valueOf(a), valueOf(b)))
  );

  const emptyRow = document.getElementById("models-empty-row");
  for (const row of dataRows) {
    tbody.insertBefore(row, emptyRow || null);
  }
}

function renderModelsTable(rawModels = []) {
  const tbody = document.getElementById("models-tbody");
  const merged = mergeModelsWithDisplayMeta(rawModels);

  setText("[data-stat='model-count']", String(merged.length));
  updatePriceSpectrum(merged);

  if (!tbody) return;

  // Sort sensibly: Free models first, then lower input price first, then display name
  currentModels = [...merged].sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    const ap = a.input_usd_per_m ?? 999999;
    const bp = b.input_usd_per_m ?? 999999;
    if (ap !== bp) return ap - bp;
    return collator.compare(a.model_display, b.model_display);
  });

  const fingerprint = JSON.stringify(currentModels);
  if (fingerprint === lastRenderedFingerprint) {
    applyModelFilters();
    return;
  }
  lastRenderedFingerprint = fingerprint;
  tbody.removeAttribute("data-initial");

  const frag = document.createDocumentFragment();
  for (const m of currentModels) {
    frag.append(buildModelRow(m));
  }

  const emptyRow = document.createElement("tr");
  emptyRow.id = "models-empty-row";
  emptyRow.hidden = true;
  const emptyTd = document.createElement("td");
  emptyTd.colSpan = 6;
  emptyTd.textContent = "No advertised models match that filter right now.";
  emptyRow.append(emptyTd);
  frag.append(emptyRow);

  tbody.replaceChildren(frag);
  applyCurrentTableSort();
  renderFilterChips(currentModels);
  applyModelFilters();
}

function initSortableTable() {
  const table = document.getElementById("models-table");
  const tbody = document.getElementById("models-tbody");
  const statusEl = document.getElementById("models-sort-status");
  if (!table || !tbody) return;

  function sortByHeader(th, button) {
    const direction = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    for (const header of table.tHead.rows[0].cells) header.removeAttribute("aria-sort");
    th.setAttribute("aria-sort", direction);

    const index = th.cellIndex;
    const type = th.dataset.type || "text";
    const factor = direction === "ascending" ? 1 : -1;

    const dataRows = [...tbody.querySelectorAll("tr[data-modality]")];
    const valueOf = (row) => row.cells[index]?.dataset.value ?? row.cells[index]?.textContent.trim() ?? "";

    dataRows.sort((a, b) =>
      factor * (type === "number" ? Number(valueOf(a)) - Number(valueOf(b)) : collator.compare(valueOf(a), valueOf(b)))
    );

    const reorder = () => {
      const emptyRow = document.getElementById("models-empty-row");
      for (const row of dataRows) {
        if (typeof tbody.moveBefore === "function") {
          tbody.moveBefore(row, emptyRow || null);
        } else {
          tbody.insertBefore(row, emptyRow || null);
        }
      }
      applyModelFilters();
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && typeof table.startViewTransition === "function" && dataRows.length <= 40) {
      table.startViewTransition(reorder);
    } else {
      reorder();
    }

    if (statusEl) {
      statusEl.textContent = `Sorted by ${button.textContent.trim()}, ${direction}, ${dataRows.length} models`;
    }
  }

  table.addEventListener("command", (event) => {
    if (event.command !== "--sort") return;
    const th = event.source.closest("th");
    if (th) sortByHeader(th, event.source);
  });

  if (!("commandForElement" in HTMLButtonElement.prototype)) {
    table.tHead?.addEventListener("click", (event) => {
      const button = event.target.closest('button[command="--sort"]');
      if (!button) return;
      const th = button.closest("th");
      if (th) sortByHeader(th, button);
    });
  }
}

function initModelControls() {
  const searchInput = document.getElementById("model-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      applyModelFilters();
    });
  }

  const filterGroup = document.getElementById("models-filter-group");
  if (filterGroup) {
    filterGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn || !filterGroup.contains(btn)) return;
      activeFilter = btn.dataset.filter || "all";
      for (const other of filterGroup.querySelectorAll("[data-filter]")) {
        other.setAttribute("aria-pressed", other === btn ? "true" : "false");
      }
      applyModelFilters();
    });
  }

  const moreBtn = document.getElementById("models-more-btn");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      modelsExpanded = true;
      document.getElementById("models")?.classList.add("is-expanded");
      applyModelFilters();
    });
  }
}

async function detectPlatformKey() {
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const hints = await navigator.userAgentData.getHighEntropyValues(["platform", "architecture"]);
      const p = (hints.platform || "").toLowerCase();
      const arch = (hints.architecture || "").toLowerCase();
      if (p.includes("mac")) return arch.includes("x86") ? "mac-x64" : "mac-arm64";
      if (p.includes("win")) return "win-x64";
      if (p.includes("linux")) return arch.includes("arm") ? "linux-arm64" : "linux-x64";
    }
  } catch {
    // Fallback to userAgent
  }

  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("win")) return "win-x64";
  if (ua.includes("linux") && !ua.includes("android")) {
    return /aarch64|arm64/.test(ua) ? "linux-arm64" : "linux-x64";
  }
  if (ua.includes("mac")) {
    return "mac-arm64";
  }
  return "mac-arm64";
}

async function initOsDetection() {
  const key = await detectPlatformKey();
  const target = DOWNLOAD_TARGETS[key];
  if (!target) return;

  const detectedBtn = document.getElementById("download-detected-btn");
  const detectedNote = document.getElementById("download-detected-note");
  if (detectedBtn) {
    detectedBtn.href = target.href;
    const labelSpan = detectedBtn.querySelector("[data-os-label]");
    if (labelSpan) labelSpan.textContent = `Download for ${target.short}`;
  }
  if (detectedNote) {
    detectedNote.textContent = `Detected ${target.label}. Direct installer from download.antseed.com.`;
  }
  for (const link of document.querySelectorAll("[data-os-key]")) {
    link.classList.toggle("is-detected", link.dataset.osKey === key);
  }
}

async function loadLiveModels() {
  const table = document.getElementById("models-table");
  const hasModelsTarget = document.getElementById("models-tbody") || document.querySelector("[data-stat='model-count']");
  if (!hasModelsTarget) return;

  // Seed display metadata (display names / modality / price-matched savings) from local cache if present
  const cachedMeta = readDisplayMetaCache();
  if (cachedMeta) absorbDisplayMeta(cachedMeta);

  const cachedStats = readStatsCache();
  if (Array.isArray(cachedStats?.models)) absorbDisplayMeta(cachedStats.models);

  modelsSourceMode = "loading";
  updateModelsTimestampLabels();
  if (table) table.setAttribute("aria-busy", "true");

  // Always fetch /api/models first; warm display metadata in parallel only when not yet cached
  const metaWarmup =
    Object.keys(displayMetaMap).length === 0
      ? readModelsSnapshot().catch(() => null)
      : Promise.resolve(null);

  const applyModels = (payload, mode) => {
    lastRawModels = payload.models;
    modelsSourceMode = mode;
    modelsUpdatedAt = payload.updatedAt || null;
    renderModelsTable(lastRawModels);
    updateModelsTimestampLabels();
  };

  try {
    try {
      const live = await fetchLiveModels();
      await metaWarmup;
      writeModelsCache(live);
      applyModels(live, "live");
    } catch {
      // Fallback 1: localStorage cache from last successful /api/models fetch
      const cached = readModelsCache();
      if (cached) {
        await metaWarmup;
        applyModels(cached, "cache");
      } else {
        // Fallback 2: build-time seller-metadata snapshot
        try {
          const snap = await readModelsSnapshot();
          if (Array.isArray(snap?.models) && snap.models.length > 0) {
            applyModels(
              { updatedAt: snap.updatedAt || null, models: snap.models },
              "snapshot"
            );
          } else {
            throw new Error("Empty models snapshot");
          }
        } catch {
          try {
            const legacySnap = await readStatsSnapshot();
            if (Array.isArray(legacySnap?.models) && legacySnap.models.length > 0) {
              applyModels(
                {
                  updatedAt: legacySnap.models_updated_at || legacySnap.generated_at || null,
                  models: legacySnap.models
                },
                "snapshot"
              );
            } else {
              throw new Error("Empty legacy snapshot");
            }
          } catch {
            // Graceful error state: keep static HTML rows intact (CLS = 0)
            modelsSourceMode = "static";
            updateModelsTimestampLabels();
            const statusEl = document.getElementById("models-status");
            if (statusEl) {
              statusEl.textContent = "Live pricing unavailable; showing static snapshot.";
            }
          }
        }
      }
    }
  } finally {
    if (table) table.removeAttribute("aria-busy");
  }

  // Background refresh from /api/models while tab is visible
  const refreshModels = async () => {
    if (document.hidden && modelsSourceMode === "live") return;
    try {
      const live = await fetchLiveModels();
      writeModelsCache(live);
      applyModels(live, "live");
    } catch {
      if (modelsSourceMode === "live") {
        modelsSourceMode = "cache";
      }
      updateModelsTimestampLabels();
      if (lastRawModels) applyModelFilters();
    }
  };

  setInterval(refreshModels, MODELS_REFRESH_MS);
}

async function loadAntSeedStats() {
  const hasStatsTargets = document.getElementById("daily-chart") || document.querySelector("[data-stat='total-usdc']");
  if (!hasStatsTargets) return;

  // 1. Instant hydrate stats from localStorage cache or build-time snapshot to keep CLS ~0
  const cached = readStatsCache();
  if (cached) {
    statsSourceMode = "cache";
    statsUpdatedAt = cached.generated_at;
    renderStats(cached);
    updateStatsTimestampLabels();
  } else {
    try {
      const snap = await readStatsSnapshot();
      statsSourceMode = "snapshot";
      statsUpdatedAt = snap.generated_at;
      renderStats(snap);
      updateStatsTimestampLabels();
    } catch {
      // Static HTML already contains initial numbers
    }
  }

  // 2. Fetch fresh live settlement telemetry from AntSeedStats
  const refreshStats = async () => {
    if (document.hidden && statsSourceMode === "live") return;
    try {
      const live = await fetchLiveStatsBundle();
      statsSourceMode = "live";
      statsUpdatedAt = live.generated_at;
      writeStatsCache(live);
      renderStats(live);
      updateStatsTimestampLabels();
    } catch {
      updateStatsTimestampLabels();
    }
  };

  // Best-effort non-blocking refresh of display metadata (display names / modality / price-matched savings);
  // never overrides model list, counts, or prices from /api/models.
  const refreshDisplayMeta = async () => {
    try {
      const res = await fetchJson(`${API_BASE}/sellers/${CURRENT_SELLER}/models`, 8000);
      const advertised = res?.data?.advertised;
      if (Array.isArray(advertised) && absorbDisplayMeta(advertised, { persist: true }) && lastRawModels) {
        renderModelsTable(lastRawModels);
      }
    } catch {
      // Optional enrichment only; silently ignore
    }
  };

  await refreshStats();
  void refreshDisplayMeta();
  setInterval(refreshStats, STATS_REFRESH_MS);
}

// Boot
initCopyButtons();
initSortableTable();
initModelControls();
initOsDetection();
loadLiveModels();
loadAntSeedStats();
setInterval(updateAllTimestampLabels, 30000);
