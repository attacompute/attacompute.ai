#!/usr/bin/env node
// Fetches build-time fallback snapshots:
// 1. Live seller metadata (model list, per-token prices, health) -> data/models-snapshot.json
// 2. Public AntSeedStats telemetry (seller totals + daily USDC history, CC BY 4.0)
//    plus optional display metadata (display names, modality, price-matched savings)
//    -> data/snapshot.json (models list comes from seller metadata, never AntSeedStats)
//
// Usage:
//   node scripts/snapshot.mjs               # refresh both stats and models snapshots
//   node scripts/snapshot.mjs --models-only # refresh only seller-metadata models in both files
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_METADATA_URL,
  DEFAULT_METADATA_VERSION,
  mapSellerMetadataToPublicModels,
  mergeDisplayMetadata
} from "../functions/_lib/models.js";

const BASE = "https://antseedstats.com/api/v1";
const CURRENT_SELLER = "0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139";
const ORIGINAL_SELLER = "0xd5e7d5950b6cc71c095da4ace0c0cb8495667be0";
const METADATA_URL = process.env.SELLER_METADATA_URL || DEFAULT_METADATA_URL;
const METADATA_VERSION = process.env.SELLER_METADATA_VERSION || DEFAULT_METADATA_VERSION;
const MODELS_ONLY = process.argv.includes("--models-only");

const SNAPSHOT_FILE = path.join(process.cwd(), "data/snapshot.json");
const MODELS_SNAPSHOT_FILE = path.join(process.cwd(), "data/models-snapshot.json");

async function getJson(url, extraHeaders = {}, timeoutMs = 10000) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "attacompute-site-snapshot/1.0",
      ...extraHeaders
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function sanitizeSeller(raw) {
  const d = raw?.data || {};
  return {
    address: d.address,
    name: d.name ?? null,
    rank: d.rank ?? null,
    revenue_micro: Number(d.revenue_micro || 0),
    revenue_usd: d.revenue_usd ?? "0.00",
    revenue_7d_micro: Number(d.revenue_7d_micro || 0),
    revenue_7d_usd: d.revenue_7d_usd ?? "0.00",
    fees_micro: Number(d.fees_micro || 0),
    fees_usd: d.fees_usd ?? "0.00",
    settles: Number(d.settles || 0),
    channels: Number(d.channels || 0),
    buyers: Number(d.buyers || 0),
    tokens: Number(d.tokens || 0),
    requests: Number(d.requests || 0),
    reputation: d.reputation ?? null,
    verified: Boolean(d.verified),
    verification: Array.isArray(d.verification)
      ? d.verification.map((v) => ({
          kind: v.kind,
          target: v.target,
          verified: Boolean(v.verified),
          href: v.href
        }))
      : [],
    tee_advertised: Boolean(d.tee_advertised),
    organic: d.organic ?? null,
    first_settle_ts: d.first_settle_ts ?? null,
    last_settle_ts: d.last_settle_ts ?? null
  };
}

function sanitizeDaily(raw) {
  const days = raw?.data?.days || [];
  return days.map((d) => ({
    day: d.day,
    settled_micro: Number(d.settled_micro || 0),
    settled_usd: d.settled_usd ?? "0.00",
    settles: Number(d.settles || 0),
    buyers: Number(d.buyers || 0),
    tokens_in: d.tokens_in == null ? null : Number(d.tokens_in),
    tokens_out: d.tokens_out == null ? null : Number(d.tokens_out)
  }));
}

function buildDisplayMetaLookup(sellerModels, antseedStatsModelsRaw) {
  const advertised = Array.isArray(antseedStatsModelsRaw?.data?.advertised)
    ? antseedStatsModelsRaw.data.advertised
    : [];
  const byAdvertisedAs = new Map();
  for (const row of advertised) {
    const key = String(row?.advertised_as || row?.model || "").trim();
    if (key) byAdvertisedAs.set(key, row);
  }

  const meta = {};
  for (const m of sellerModels) {
    const ref = byAdvertisedAs.get(m.model);
    if (!ref) continue;
    const refInput =
      typeof ref.input_usd_per_m === "number" && Number.isFinite(ref.input_usd_per_m)
        ? ref.input_usd_per_m
        : null;
    const priceMatches =
      refInput !== null && m.input !== null && Math.abs(refInput - m.input) < 1e-9;
    const savePct =
      !m.free &&
      priceMatches &&
      typeof ref.save_pct === "number" &&
      Number.isFinite(ref.save_pct) &&
      ref.save_pct > 0
        ? Math.round(ref.save_pct)
        : null;

    meta[m.model] = {
      model_display:
        typeof ref.model_display === "string" && ref.model_display.trim()
          ? ref.model_display.trim()
          : m.model,
      modality:
        typeof ref.modality === "string" && ref.modality.trim()
          ? ref.modality.trim().toLowerCase()
          : "text",
      save_pct: savePct,
      input_usd_per_m: m.input
    };
  }
  return meta;
}

const [rawSellerMeta, antseedStatsModels] = await Promise.all([
  getJson(METADATA_URL, { "x-antseed-metadata-version": METADATA_VERSION }),
  getJson(`${BASE}/sellers/${CURRENT_SELLER}/models`).catch(() => null)
]);

const sellerModelsPayload = mapSellerMetadataToPublicModels(rawSellerMeta);
if (sellerModelsPayload.models.length === 0) {
  throw new Error("Seller metadata returned 0 models; aborting snapshot write");
}

const displayMeta = buildDisplayMetaLookup(sellerModelsPayload.models, antseedStatsModels);
const mergedModels = mergeDisplayMetadata(sellerModelsPayload.models, displayMeta);

const modelsSnapshot = {
  updatedAt: sellerModelsPayload.updatedAt,
  models: sellerModelsPayload.models,
  meta: displayMeta
};

let snapshot;
if (MODELS_ONLY && fs.existsSync(SNAPSHOT_FILE)) {
  const existing = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  snapshot = {
    ...existing,
    models_updated_at: sellerModelsPayload.updatedAt,
    models: mergedModels
  };
} else {
  const [curSeller, origSeller, curDaily, origDaily] = await Promise.all([
    getJson(`${BASE}/sellers/${CURRENT_SELLER}`),
    getJson(`${BASE}/sellers/${ORIGINAL_SELLER}`),
    getJson(`${BASE}/sellers/${CURRENT_SELLER}/daily?from=2026-01-01&to=2026-12-31`),
    getJson(`${BASE}/sellers/${ORIGINAL_SELLER}/daily?from=2026-01-01&to=2026-12-31`)
  ]);
  snapshot = {
    generated_at: new Date().toISOString(),
    models_updated_at: sellerModelsPayload.updatedAt,
    attribution: "Data: AntSeedStats (antseedstats.com), CC BY 4.0",
    sellers: {
      current: sanitizeSeller(curSeller),
      original: sanitizeSeller(origSeller)
    },
    daily: {
      current: sanitizeDaily(curDaily),
      original: sanitizeDaily(origDaily)
    },
    models: mergedModels
  };
}

fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
fs.writeFileSync(MODELS_SNAPSHOT_FILE, JSON.stringify(modelsSnapshot, null, 2) + "\n");
fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + "\n");

console.log(
  `Wrote ${path.relative(process.cwd(), MODELS_SNAPSHOT_FILE)} (${modelsSnapshot.models.length} models, updatedAt=${modelsSnapshot.updatedAt})`
);
console.log(
  `Wrote ${path.relative(process.cwd(), SNAPSHOT_FILE)}: ` +
    `current=$${snapshot.sellers.current.revenue_usd} (${snapshot.daily.current.length}d), ` +
    `original=$${snapshot.sellers.original.revenue_usd} (${snapshot.daily.original.length}d), ` +
    `models=${snapshot.models.length}`
);
