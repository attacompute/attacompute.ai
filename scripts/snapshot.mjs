#!/usr/bin/env node
// Fetches a build-time fallback snapshot from the public AntSeedStats API (CC BY 4.0)
// and writes data/snapshot.json with only public display fields.
// Usage: node scripts/snapshot.mjs
import fs from "node:fs";
import path from "node:path";

const BASE = "https://antseedstats.com/api/v1";
const CURRENT_SELLER = "0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139";
const ORIGINAL_SELLER = "0xd5e7d5950b6cc71c095da4ace0c0cb8495667be0";
const OUT_FILE = path.join(process.cwd(), "data/snapshot.json");

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "attacompute-site-snapshot/1.0" }
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

function sanitizeModels(raw) {
  const advertised = raw?.data?.advertised || [];
  return advertised.map((m) => ({
    model: m.model,
    model_display: m.model_display || m.advertised_as || m.model,
    advertised_as: m.advertised_as || m.model,
    modality: (m.modality || "text").toLowerCase(),
    free: Boolean(m.free),
    input_usd_per_m: m.input_usd_per_m ?? null,
    cached_input_usd_per_m: m.cached_input_usd_per_m ?? null,
    output_usd_per_m: m.output_usd_per_m ?? null,
    image_usd: m.image_usd ?? null,
    video_usd_per_second: m.video_usd_per_second ?? null,
    video_usd_per_video: m.video_usd_per_video ?? null,
    usd_per_request: m.usd_per_request ?? null,
    usd_per_1m_chars: m.usd_per_1m_chars ?? null,
    save_pct: m.save_pct ?? null
  }));
}

const [curSeller, origSeller, curDaily, origDaily, curModels] = await Promise.all([
  getJson(`${BASE}/sellers/${CURRENT_SELLER}`),
  getJson(`${BASE}/sellers/${ORIGINAL_SELLER}`),
  getJson(`${BASE}/sellers/${CURRENT_SELLER}/daily?from=2026-01-01&to=2026-12-31`),
  getJson(`${BASE}/sellers/${ORIGINAL_SELLER}/daily?from=2026-01-01&to=2026-12-31`),
  getJson(`${BASE}/sellers/${CURRENT_SELLER}/models`)
]);

const snapshot = {
  generated_at: new Date().toISOString(),
  attribution: "Data: AntSeedStats (antseedstats.com), CC BY 4.0",
  sellers: {
    current: sanitizeSeller(curSeller),
    original: sanitizeSeller(origSeller)
  },
  daily: {
    current: sanitizeDaily(curDaily),
    original: sanitizeDaily(origDaily)
  },
  models: sanitizeModels(curModels)
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 2) + "\n");
console.log(
  `Wrote ${path.relative(process.cwd(), OUT_FILE)}: ` +
  `current=$${snapshot.sellers.current.revenue_usd} (${snapshot.daily.current.length}d), ` +
  `original=$${snapshot.sellers.original.revenue_usd} (${snapshot.daily.original.length}d), ` +
  `models=${snapshot.models.length}`
);
