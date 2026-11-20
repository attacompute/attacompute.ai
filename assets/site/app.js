// attacompute public client module:
// - Live AntSeedStats fetching with 5-minute refresh, localStorage cache, and data/snapshot.json fallback
// - Accessible sortable + filterable models table (MWG: responsive-table, sortable-table)
// - OS detection for AntSeed Desktop download buttons
// - Copy-to-clipboard (MWG: copy-button)
import { renderDailyChart } from "./chart.js";
import { initCopyButtons } from "./copy.js";

const API_BASE = "https://antseedstats.com/api/v1";
const CURRENT_SELLER = "0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139";
const CURRENT_PEER = "6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139";
const ORIGINAL_SELLER = "0xd5e7d5950b6cc71c095da4ace0c0cb8495667be0";
const CACHE_KEY = "attacompute_antseedstats_v1";
const REFRESH_MS = 5 * 60 * 1000;

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
let activeFilter = "all";
let searchQuery = "";
let modelsExpanded = false;
let lastUpdatedAt = null;
let dataSourceMode = "snapshot"; // "live" | "cache" | "snapshot"

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
  if (n < 0.1) return `$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  if (n < 1) return `$${n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
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
  if (diffSec < 45) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function updateTimestampLabels() {
  const text =
    dataSourceMode === "live"
      ? `Updated ${fmtRelativeTime(lastUpdatedAt)}`
      : dataSourceMode === "cache"
        ? `Cached ${fmtRelativeTime(lastUpdatedAt)} (API offline)`
        : `Snapshot ${fmtRelativeTime(lastUpdatedAt)}`;
  for (const el of document.querySelectorAll("[data-updated-label]")) {
    el.textContent = text;
  }
  for (const dot of document.querySelectorAll("[data-live-dot]")) {
    dot.classList.toggle("live-dot--stale", dataSourceMode !== "live");
  }
}

function sanitizeModels(advertised = []) {
  return advertised.map((m) => ({
    model: m.model || "",
    model_display: m.model_display || m.advertised_as || m.model || "",
    advertised_as: m.advertised_as || m.model || "",
    modality: (m.modality || "text").toLowerCase(),
    free: Boolean(m.free),
    input_usd_per_m: m.input_usd_per_m ?? null,
    cached_input_usd_per_m: m.cached_input_usd_per_m ?? null,
    output_usd_per_m: m.output_usd_per_m ?? null,
    image_usd: m.image_usd ?? null,
    video_usd_per_second: m.video_usd_per_second ?? null,
    video_usd_per_video: m.video_usd_per_video ?? null,
    usd_per_request: m.usd_per_request ?? null,
    save_pct: m.save_pct ?? null
  }));
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

async function fetchLiveBundle() {
  const [curSeller, origSeller, curDaily, origDaily, curModels] = await Promise.all([
    fetchJson(`${API_BASE}/sellers/${CURRENT_SELLER}`),
    fetchJson(`${API_BASE}/sellers/${ORIGINAL_SELLER}`),
    fetchJson(`${API_BASE}/sellers/${CURRENT_SELLER}/daily?from=2026-01-01&to=2026-12-31`),
    fetchJson(`${API_BASE}/sellers/${ORIGINAL_SELLER}/daily?from=2026-01-01&to=2026-12-31`),
    fetchJson(`${API_BASE}/sellers/${CURRENT_SELLER}/models`)
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
    },
    models: sanitizeModels(curModels?.data?.advertised || [])
  };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sellers?.current || !Array.isArray(parsed?.models)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(bundle) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(bundle));
  } catch {
    // Storage quota or private browsing
  }
}

async function readSnapshot() {
  const base = document.documentElement.dataset.root || "";
  const res = await fetch(`${base}data/snapshot.json`);
  if (!res.ok) throw new Error("Snapshot fetch failed");
  return res.json();
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
  setText("[data-stat='model-count']", String(bundle?.models?.length || 0));

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
  tr.dataset.search = `${m.model_display} ${m.advertised_as} ${m.modality} ${m.free ? "free" : ""}`.toLowerCase();

  // Col 1: Row header (Model display + advertised_as + copy button)
  const th = document.createElement("th");
  th.scope = "row";
  th.dataset.value = m.model_display;

  const cell = document.createElement("div");
  cell.className = "model-cell";

  const nameSpan = document.createElement("span");
  nameSpan.className = "model-name";
  nameSpan.textContent = m.model_display;

  const idRow = document.createElement("span");
  idRow.className = "model-id-row";

  const code = document.createElement("code");
  code.className = "model-id-code";
  code.textContent = m.advertised_as;

  const copyWrap = document.createElement("span");
  copyWrap.className = "copy-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn copy-btn--light";
  btn.setAttribute("command", "--copy");
  btn.dataset.copyValue = `${CURRENT_PEER}@${m.advertised_as}`;
  btn.setAttribute("aria-label", `Copy pinned model ID for ${m.model_display}`);
  btn.append(...makeCopySvg());

  const tip = document.createElement("span");
  tip.className = "copy-tip";
  tip.setAttribute("role", "status");

  copyWrap.append(btn, tip);
  idRow.append(code, copyWrap);
  cell.append(nameSpan, idRow);
  th.append(cell);

  // Col 2: Modality
  const tdMod = document.createElement("td");
  tdMod.dataset.value = m.free ? `free ${m.modality}` : m.modality;
  const badge = document.createElement("span");
  badge.className = m.free ? "mod-badge mod-badge--free" : "mod-badge";
  badge.textContent = m.free ? `${m.modality} · Free` : m.modality;
  tdMod.append(badge);

  // Col 3: Input / Unit price
  const tdIn = document.createElement("td");
  tdIn.className = "num";
  let primaryPrice = m.input_usd_per_m;
  let primaryText = fmtPricePerM(m.input_usd_per_m, m.free);
  if (m.modality === "image" && m.image_usd != null) {
    primaryPrice = m.image_usd;
    primaryText = `${fmtPricePerM(m.image_usd, m.free)} / img`;
  } else if (m.modality === "video" && (m.video_usd_per_second != null || m.video_usd_per_video != null)) {
    if (m.video_usd_per_second != null) {
      primaryPrice = m.video_usd_per_second;
      primaryText = `${fmtPricePerM(m.video_usd_per_second, m.free)} / s`;
    } else {
      primaryPrice = m.video_usd_per_video;
      primaryText = `${fmtPricePerM(m.video_usd_per_video, m.free)} / vid`;
    }
  } else if (m.usd_per_request != null && primaryPrice == null) {
    primaryPrice = m.usd_per_request;
    primaryText = `${fmtPricePerM(m.usd_per_request, m.free)} / req`;
  }
  tdIn.dataset.value = m.free ? "0" : String(primaryPrice ?? 999999);
  tdIn.textContent = primaryText;

  // Col 4: Cached input
  const tdCached = document.createElement("td");
  tdCached.className = "num";
  tdCached.dataset.value = m.free ? "0" : String(m.cached_input_usd_per_m ?? 999999);
  tdCached.textContent = m.free ? "Free" : fmtPricePerM(m.cached_input_usd_per_m, false);

  // Col 5: Output
  const tdOut = document.createElement("td");
  tdOut.className = "num";
  tdOut.dataset.value = m.free ? "0" : String(m.output_usd_per_m ?? 999999);
  tdOut.textContent = m.free ? "Free" : fmtPricePerM(m.output_usd_per_m, false);

  // Col 6: Save %
  const tdSave = document.createElement("td");
  tdSave.className = "num";
  tdSave.dataset.value = String(m.save_pct ?? -1);
  if (m.save_pct != null && Number(m.save_pct) > 0) {
    const sp = document.createElement("span");
    sp.className = "save-pill";
    sp.textContent = `-${Math.round(Number(m.save_pct))}%`;
    tdSave.append(sp);
  } else {
    tdSave.textContent = "—";
  }

  tr.append(th, tdMod, tdIn, tdCached, tdOut, tdSave);
  return tr;
}

function updateFilterCounts(models) {
  const counts = {
    all: models.length,
    text: models.filter((m) => m.modality === "text").length,
    image: models.filter((m) => m.modality === "image").length,
    video: models.filter((m) => m.modality === "video").length,
    free: models.filter((m) => m.free).length
  };
  for (const btn of document.querySelectorAll("[data-filter]")) {
    const key = btn.dataset.filter;
    const badge = btn.querySelector(".filter-btn__count");
    if (badge && key in counts) {
      badge.textContent = String(counts[key]);
    }
  }
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
    statusEl.textContent = `Showing ${visibleCount} of ${currentModels.length} advertised models`;
  }
}

function renderModelsTable(models = []) {
  const tbody = document.getElementById("models-tbody");
  if (!tbody) return;

  // Sort sensibly: Free models first, then lower input price first, then display name
  currentModels = [...models].sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    const ap = a.input_usd_per_m ?? a.image_usd ?? a.video_usd_per_second ?? a.usd_per_request ?? 999;
    const bp = b.input_usd_per_m ?? b.image_usd ?? b.video_usd_per_second ?? b.usd_per_request ?? 999;
    if (ap !== bp) return ap - bp;
    return collator.compare(a.model_display, b.model_display);
  });

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
  updateFilterCounts(currentModels);
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

  if (!("CommandEvent" in window)) {
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

  for (const btn of document.querySelectorAll("[data-filter]")) {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter || "all";
      for (const other of document.querySelectorAll("[data-filter]")) {
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

async function loadAntSeedStats() {
  const hasDataTargets = document.getElementById("daily-chart") || document.getElementById("models-tbody");
  if (!hasDataTargets) return;

  // 1. Instant hydrate from localStorage cache or build-time snapshot to keep CLS ~0
  const cached = readCache();
  if (cached) {
    dataSourceMode = "cache";
    lastUpdatedAt = cached.generated_at;
    renderStats(cached);
    renderModelsTable(cached.models);
    updateTimestampLabels();
  } else {
    try {
      const snap = await readSnapshot();
      dataSourceMode = "snapshot";
      lastUpdatedAt = snap.generated_at;
      renderStats(snap);
      renderModelsTable(snap.models);
      updateTimestampLabels();
    } catch {
      // Static HTML already contains initial numbers
    }
  }

  // 2. Fetch fresh live data from AntSeedStats
  const refresh = async () => {
    if (document.hidden && dataSourceMode === "live") return;
    try {
      const live = await fetchLiveBundle();
      dataSourceMode = "live";
      lastUpdatedAt = live.generated_at;
      writeCache(live);
      renderStats(live);
      renderModelsTable(live.models);
      updateTimestampLabels();
    } catch {
      // Keep last-good cached or snapshot values cleanly
      updateTimestampLabels();
    }
  };

  await refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(updateTimestampLabels, 30000);
}

// Boot
initCopyButtons();
initSortableTable();
initModelControls();
initOsDetection();
loadAntSeedStats();
