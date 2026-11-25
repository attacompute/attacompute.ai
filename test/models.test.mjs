import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_CONTROL_HEADER,
  isDirectIpOrCustomPort,
  mapSellerMetadataToPublicModels,
  mergeDisplayMetadata,
  parseHttp11Response
} from "../functions/_lib/models.js";
import { handleModelsRequest } from "../functions/api/models.js";

const SAMPLE_SELLER_METADATA = {
  peerId: "6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139",
  version: 18,
  displayName: "attacompute.ai",
  publicAddress: "66.220.6.105:14324",
  providers: [
    {
      provider: "openai",
      services: ["claude-sonnet-5.5", "gpt-6-astra"],
      defaultPricing: { inputUsdPerMillion: 10, outputUsdPerMillion: 10 },
      maxConcurrency: 50,
      currentLoad: 3,
      servicePricing: {
        "claude-sonnet-5.5": {
          inputUsdPerMillion: 1.9,
          outputUsdPerMillion: 9.5,
          cachedInputUsdPerMillion: 0.095
        },
        "gpt-6-astra": {
          inputUsdPerMillion: 5,
          outputUsdPerMillion: 29.5,
          cachedInputUsdPerMillion: 0.59
        }
      },
      serviceHealth: {
        "claude-sonnet-5.5": { status: "healthy", checkedAt: 1795628859939, source: "probe" },
        "gpt-6-astra": { status: "Degraded ", checkedAt: 1795628863061, source: "probe" }
      },
      servicePerformance: {
        "claude-sonnet-5.5": { requests: 77, successRate: 1 }
      }
    },
    {
      provider: "openai",
      services: ["minimax-m3.1-flash", "minimax-m3"],
      defaultPricing: { inputUsdPerMillion: 10, outputUsdPerMillion: 10 },
      servicePricing: {
        "minimax-m3.1-flash": { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        "minimax-m3": {
          inputUsdPerMillion: 0.3,
          outputUsdPerMillion: 1.2,
          cachedInputUsdPerMillion: 0.06
        }
      },
      serviceHealth: {
        "minimax-m3.1-flash": { status: "healthy", checkedAt: 1795628680842, source: "traffic" }
      }
    }
  ],
  capabilities: ["verification.response-auth.v1", "seller.model-health.v1"],
  region: "unknown",
  timestamp: 1795628952460,
  verifications: { domains: [{ domain: "d5v1n2.com", methods: ["dns-txt"] }] },
  onChainChannelCount: 1443,
  onChainGhostCount: 2,
  signature: "3afaac459abc44b80e5dc7d48a60f11efe3f1f90785719d49c2ac59fc67fcf68"
};

test("mapSellerMetadataToPublicModels maps providers and strips internal fields", () => {
  const result = mapSellerMetadataToPublicModels(SAMPLE_SELLER_METADATA);

  assert.deepEqual(Object.keys(result).sort(), ["models", "updatedAt"]);
  assert.equal(result.updatedAt, "2026-11-25T17:49:12.460Z");
  assert.equal(result.models.length, 4);

  assert.deepEqual(result.models[0], {
    model: "claude-sonnet-5.5",
    input: 1.9,
    cachedInput: 0.095,
    output: 9.5,
    free: false,
    health: "healthy"
  });

  assert.deepEqual(result.models[1], {
    model: "gpt-6-astra",
    input: 5,
    cachedInput: 0.59,
    output: 29.5,
    free: false,
    health: "degraded"
  });

  assert.deepEqual(result.models[2], {
    model: "minimax-m3.1-flash",
    input: 0,
    cachedInput: null,
    output: 0,
    free: true,
    health: "healthy"
  });

  assert.deepEqual(result.models[3], {
    model: "minimax-m3",
    input: 0.3,
    cachedInput: 0.06,
    output: 1.2,
    free: false,
    health: null
  });

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "signature",
    "3afaac459",
    "onChainChannelCount",
    "onChainGhostCount",
    "publicAddress",
    "66.220.6.105",
    "14324",
    "peerId",
    "6c8044f5e6fb",
    "capabilities",
    "verifications",
    "servicePerformance",
    "maxConcurrency",
    "currentLoad"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `Output must not contain ${forbidden}`);
  }
});

test("mapSellerMetadataToPublicModels free-tier, fallback pricing, deduplication, and timestamp edge cases", () => {
  const result = mapSellerMetadataToPublicModels(
    {
      timestamp: 1795628952, // unix seconds
      providers: [
        {
          services: ["free-all-zero", "free-input-only", "paid-cached", "no-prices", "uses-default", "free-all-zero"],
          defaultPricing: { inputUsdPerMillion: 2.5, outputUsdPerMillion: 7.5 },
          servicePricing: {
            "free-all-zero": { inputUsdPerMillion: 0, cachedInputUsdPerMillion: 0, outputUsdPerMillion: 0 },
            "free-input-only": { inputUsdPerMillion: 0, outputUsdPerMillion: 1.2 },
            "paid-cached": { inputUsdPerMillion: 0, cachedInputUsdPerMillion: 0.01, outputUsdPerMillion: 0 },
            "no-prices": { inputUsdPerMillion: -1, outputUsdPerMillion: Number.NaN }
          }
        }
      ]
    },
    { now: Date.UTC(2026, 10, 25, 0, 0, 0) }
  );

  assert.equal(result.updatedAt, "2026-11-25T17:49:12.000Z");
  assert.equal(result.models.length, 5, "Duplicate model IDs must be deduplicated");

  const byId = Object.fromEntries(result.models.map((m) => [m.model, m]));
  assert.equal(byId["free-all-zero"].free, true);
  assert.equal(byId["free-input-only"].free, false);
  assert.equal(byId["paid-cached"].free, false);
  assert.deepEqual(byId["no-prices"], {
    model: "no-prices",
    input: null,
    cachedInput: null,
    output: null,
    free: false,
    health: null
  });
  assert.deepEqual(byId["uses-default"], {
    model: "uses-default",
    input: 2.5,
    cachedInput: null,
    output: 7.5,
    free: false,
    health: null
  });

  assert.throws(() => mapSellerMetadataToPublicModels(null), /Invalid seller metadata/);
  assert.throws(() => mapSellerMetadataToPublicModels({}), /Invalid seller metadata/);
});

test("mergeDisplayMetadata merges only existing display metadata and suppresses stale savings", () => {
  const publicModels = [
    { model: "gpt-6-astra", input: 5, cachedInput: 0.59, output: 29.5, free: false, health: "healthy" },
    { model: "claude-sonnet-5.5", input: 2.4, cachedInput: 0.1, output: 11, free: false, health: "healthy" },
    { model: "brand-new-model", input: 0.8, cachedInput: null, output: 2.4, free: false, health: "healthy" }
  ];
  const metaLookup = {
    "gpt-6-astra": { model_display: "GPT-6 Astra", modality: "text", save_pct: 50, input_usd_per_m: 5 },
    "claude-sonnet-5.5": { model_display: "Claude Sonnet 5.5", modality: "text", save_pct: 5, input_usd_per_m: 1.9 },
    "removed-model": { model_display: "Removed Model", modality: "text", save_pct: 40, input_usd_per_m: 1 }
  };

  const merged = mergeDisplayMetadata(publicModels, metaLookup);
  assert.equal(merged.length, 3, "Must not add models missing from live seller metadata");

  assert.equal(merged[0].model_display, "GPT-6 Astra");
  assert.equal(merged[0].save_pct, 50, "Keep save_pct when live price matches reference");
  assert.equal(merged[0].input_usd_per_m, 5);

  assert.equal(merged[1].model_display, "Claude Sonnet 5.5");
  assert.equal(merged[1].input_usd_per_m, 2.4, "Must keep live seller price");
  assert.equal(merged[1].save_pct, null, "Must suppress stale save_pct when live price changed");

  assert.equal(merged[2].model_display, "brand-new-model");
  assert.equal(merged[2].modality, "text");
  assert.equal(merged[2].save_pct, null);
});

test("isDirectIpOrCustomPort detects raw IP addresses and non-standard ports", () => {
  assert.equal(isDirectIpOrCustomPort("http://66.220.6.105:14324/metadata"), true);
  assert.equal(isDirectIpOrCustomPort("http://66.220.6.105/metadata"), true);
  assert.equal(isDirectIpOrCustomPort("http://[::1]:8080/metadata"), true);
  assert.equal(isDirectIpOrCustomPort("https://meta.attacompute.ai:8443/metadata"), true);
  assert.equal(isDirectIpOrCustomPort("https://meta.attacompute.ai/metadata"), false);
  assert.equal(isDirectIpOrCustomPort("https://meta.attacompute.ai:443/metadata"), false);
  assert.equal(isDirectIpOrCustomPort("http://meta.attacompute.ai:80/metadata"), false);
});

test("parseHttp11Response handles Content-Length, chunked encoding, UTF-8, and error cases", () => {
  const body = JSON.stringify({ ok: true, label: "café" });
  const bodyBytes = new TextEncoder().encode(body);
  const raw = new TextEncoder().encode(
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bodyBytes.byteLength}\r\nConnection: close\r\n\r\n${body}`
  );
  const parsed = parseHttp11Response(raw);
  assert.equal(parsed.status, 200);
  assert.deepEqual(JSON.parse(parsed.bodyText), { ok: true, label: "café" });

  const chunkedRaw = new TextEncoder().encode(
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n7\r\n{\"a\":1,\r\n6\r\n\"b\":2}\r\n0\r\n\r\n"
  );
  const parsedChunked = parseHttp11Response(chunkedRaw);
  assert.equal(parsedChunked.status, 200);
  assert.deepEqual(JSON.parse(parsedChunked.bodyText), { a: 1, b: 2 });

  const truncated = new TextEncoder().encode("HTTP/1.1 200 OK\r\nContent-Length: 50\r\n\r\n{}");
  assert.throws(() => parseHttp11Response(truncated), /Truncated HTTP response/);
});

test("handleModelsRequest returns cached minimal public JSON via fetch and caches at edge", async () => {
  const store = new Map();
  const mockCache = {
    async match(req) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      store.set(req.url, res.clone());
    }
  };

  let fetchCalls = 0;
  let seenHeaders = null;
  const mockFetch = async (url, init) => {
    fetchCalls++;
    seenHeaders = init.headers;
    return new Response(JSON.stringify(SAMPLE_SELLER_METADATA), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const res1 = await handleModelsRequest(
    {
      request: new Request("https://attacompute.ai/api/models?bust=1"),
      env: { SELLER_METADATA_URL: "https://meta.attacompute.ai/metadata" }
    },
    { fetchImpl: mockFetch, cache: mockCache }
  );

  assert.equal(res1.status, 200);
  assert.equal(res1.headers.get("Cache-Control"), CACHE_CONTROL_HEADER);
  assert.equal(res1.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(seenHeaders["x-antseed-metadata-version"], "18");

  const body1 = await res1.json();
  assert.equal(body1.models.length, 4);
  assert.equal(body1.updatedAt, "2026-11-25T17:49:12.460Z");
  assert.equal(fetchCalls, 1);

  // Second request with a different query string must still hit the canonical edge cache entry
  const res2 = await handleModelsRequest(
    {
      request: new Request("https://attacompute.ai/api/models?bust=2"),
      env: { SELLER_METADATA_URL: "https://meta.attacompute.ai/metadata" }
    },
    { fetchImpl: mockFetch, cache: mockCache }
  );
  assert.equal(res2.status, 200);
  assert.equal(fetchCalls, 1, "Expected edge cache hit without re-fetching upstream");
});

test("handleModelsRequest uses socket transport for raw IP / custom port endpoints", async () => {
  let writtenReq = "";
  let connectedTarget = null;
  const jsonBody = JSON.stringify(SAMPLE_SELLER_METADATA);
  const rawHttp = new TextEncoder().encode(
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(jsonBody)}\r\nConnection: close\r\n\r\n${jsonBody}`
  );

  const mockSocketConnect = (target) => {
    connectedTarget = target;
    return {
      writable: new WritableStream({
        write(chunk) {
          writtenReq += new TextDecoder().decode(chunk);
        }
      }),
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(rawHttp.subarray(0, 48));
          controller.enqueue(rawHttp.subarray(48));
          controller.close();
        }
      }),
      async close() {}
    };
  };

  const res = await handleModelsRequest(
    { request: new Request("https://attacompute.ai/api/models") },
    { socketConnect: mockSocketConnect, cache: null }
  );

  assert.equal(res.status, 200);
  assert.deepEqual(connectedTarget, { hostname: "66.220.6.105", port: 14324 });
  assert.match(writtenReq, /^GET \/metadata HTTP\/1\.1\r\n/);
  assert.match(writtenReq, /x-antseed-metadata-version: 18\r\n/);
  const data = await res.json();
  assert.equal(data.models.length, 4);
});

test("handleModelsRequest returns 502 JSON without leaking upstream details on failure", async () => {
  const failingFetch = async () => {
    throw new Error("ECONNREFUSED 66.220.6.105:14324");
  };

  const res = await handleModelsRequest(
    {
      request: new Request("https://attacompute.ai/api/models"),
      env: { SELLER_METADATA_URL: "https://meta.attacompute.ai/metadata" }
    },
    { fetchImpl: failingFetch, cache: null }
  );

  assert.equal(res.status, 502);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const text = await res.text();
  assert.equal(text.includes("66.220.6.105"), false);
  const body = JSON.parse(text);
  assert.equal(typeof body.error, "string");

  // Empty providers list also triggers 502 so client falls back cleanly
  const emptyFetch = async () =>
    new Response(JSON.stringify({ providers: [], timestamp: Date.now() }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  const resEmpty = await handleModelsRequest(
    {
      request: new Request("https://attacompute.ai/api/models"),
      env: { SELLER_METADATA_URL: "https://meta.attacompute.ai/metadata" }
    },
    { fetchImpl: emptyFetch, cache: null }
  );
  assert.equal(resEmpty.status, 502);
});
