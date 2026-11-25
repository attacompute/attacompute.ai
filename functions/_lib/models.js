// Pure mapping and transport helpers for attacompute live seller metadata.
// Imported by the Cloudflare Pages Function (functions/api/models.js),
// the snapshot script (scripts/snapshot.mjs), and node --test unit tests.

export const DEFAULT_METADATA_URL = "http://66.220.6.105:14324/metadata";
export const DEFAULT_METADATA_VERSION = "18";
export const UPSTREAM_TIMEOUT_MS = 5000;
export const EDGE_CACHE_TTL_SECONDS = 60;
export const CACHE_CONTROL_HEADER = "public, max-age=60, stale-while-revalidate=300";

function toNonNegativePrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value === 0 ? 0 : value;
}

function normalizeHealth(entry) {
  const raw = typeof entry === "string" ? entry : entry?.status;
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return normalized || null;
}

function resolveUpdatedAt(timestamp, now) {
  if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0) {
    const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } else if (typeof timestamp === "string" && timestamp.trim()) {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  const fallback = now instanceof Date ? now : new Date(now ?? Date.now());
  return fallback.toISOString();
}

/**
 * Maps raw AntSeed seller /metadata (v18) into minimal public JSON for display.
 * Strips signatures, channel counts, IPs, peer IDs, capabilities, and perf internals.
 *
 * @param {object} raw - Raw JSON from seller /metadata
 * @param {{ now?: number | Date }} [options]
 * @returns {{ updatedAt: string, models: Array<{ model: string, input: number | null, cachedInput: number | null, output: number | null, free: boolean, health: string | null }> }}
 */
export function mapSellerMetadataToPublicModels(raw, { now } = {}) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.providers)) {
    throw new Error("Invalid seller metadata payload: expected object with providers array");
  }

  const seen = new Set();
  const models = [];

  for (const provider of raw.providers) {
    if (!provider || typeof provider !== "object" || !Array.isArray(provider.services)) {
      continue;
    }

    const servicePricing =
      provider.servicePricing && typeof provider.servicePricing === "object"
        ? provider.servicePricing
        : null;
    const defaultPricing =
      provider.defaultPricing && typeof provider.defaultPricing === "object"
        ? provider.defaultPricing
        : null;
    const serviceHealth =
      provider.serviceHealth && typeof provider.serviceHealth === "object"
        ? provider.serviceHealth
        : null;

    for (const rawModelId of provider.services) {
      if (typeof rawModelId !== "string") continue;
      const model = rawModelId.trim();
      if (!model || seen.has(model)) continue;
      seen.add(model);

      const hasServicePricing =
        servicePricing !== null &&
        Object.hasOwn(servicePricing, model) &&
        servicePricing[model] !== null &&
        typeof servicePricing[model] === "object";

      const pricing = hasServicePricing ? servicePricing[model] : defaultPricing;
      const input = toNonNegativePrice(pricing?.inputUsdPerMillion);
      const cachedInput = toNonNegativePrice(pricing?.cachedInputUsdPerMillion);
      const output = toNonNegativePrice(pricing?.outputUsdPerMillion);

      const presentPrices = [input, cachedInput, output].filter((v) => v !== null);
      const free = presentPrices.length > 0 && presentPrices.every((v) => v === 0);

      const health =
        serviceHealth !== null && Object.hasOwn(serviceHealth, model)
          ? normalizeHealth(serviceHealth[model])
          : null;

      models.push({
        model,
        input,
        cachedInput,
        output,
        free,
        health
      });
    }
  }

  return {
    updatedAt: resolveUpdatedAt(raw.timestamp, now),
    models
  };
}

/**
 * Merges optional display metadata (display name, modality, price-matched savings)
 * into live seller models without ever inventing or overriding prices.
 */
export function mergeDisplayMetadata(publicModels = [], metaLookup = null) {
  const byId = metaLookup && typeof metaLookup === "object" ? metaLookup : {};
  return publicModels.map((entry) => {
    const id = String(entry?.model || "").trim();
    const meta = id && Object.hasOwn(byId, id) ? byId[id] : null;
    const input = toNonNegativePrice(entry?.input);
    const cachedInput = toNonNegativePrice(entry?.cachedInput);
    const output = toNonNegativePrice(entry?.output);
    const free = Boolean(entry?.free);
    const health = normalizeHealth(entry?.health);

    let savePct = null;
    if (!free && meta && typeof meta.save_pct === "number" && Number.isFinite(meta.save_pct) && meta.save_pct > 0) {
      const refInput = toNonNegativePrice(meta.input_usd_per_m);
      if (refInput === null || (input !== null && Math.abs(refInput - input) < 1e-9)) {
        savePct = Math.round(meta.save_pct);
      }
    }

    const modality =
      typeof meta?.modality === "string" && meta.modality.trim()
        ? meta.modality.trim().toLowerCase()
        : "text";

    const displayName =
      typeof meta?.model_display === "string" && meta.model_display.trim()
        ? meta.model_display.trim()
        : id;

    return {
      model: id,
      model_display: displayName,
      advertised_as: id,
      modality,
      free,
      health,
      input_usd_per_m: input,
      cached_input_usd_per_m: cachedInput,
      output_usd_per_m: output,
      save_pct: savePct
    };
  });
}

/**
 * Detects whether a URL targets a raw IP address or a non-standard port,
 * where Cloudflare Workers' standard fetch() has production restrictions
 * and cloudflare:sockets should be used instead.
 */
export function isDirectIpOrCustomPort(urlInput) {
  const parsed = urlInput instanceof URL ? urlInput : new URL(String(urlInput));
  const host = parsed.hostname;
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  const isIpv6 = host.startsWith("[") || host.includes(":");
  if (isIpv4 || isIpv6) return true;

  if (!parsed.port) return false;
  if (parsed.protocol === "http:" && parsed.port === "80") return false;
  if (parsed.protocol === "https:" && parsed.port === "443") return false;
  return true;
}

function findSequence(haystack, needle, start = 0) {
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function concatUint8Arrays(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decodeChunkedBody(bodyBytes) {
  const crlf = new Uint8Array([13, 10]);
  const ascii = new TextDecoder("ascii");
  const pieces = [];
  let offset = 0;

  while (offset < bodyBytes.byteLength) {
    const lineEnd = findSequence(bodyBytes, crlf, offset);
    if (lineEnd === -1) {
      throw new Error("Malformed chunked HTTP response: missing chunk size terminator");
    }
    const sizeLine = ascii.decode(bodyBytes.subarray(offset, lineEnd)).split(";")[0].trim();
    const size = Number.parseInt(sizeLine, 16);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("Malformed chunked HTTP response: invalid chunk size");
    }
    offset = lineEnd + 2;
    if (size === 0) {
      return concatUint8Arrays(pieces);
    }
    if (offset + size + 2 > bodyBytes.byteLength) {
      throw new Error("Truncated chunked HTTP response");
    }
    pieces.push(bodyBytes.subarray(offset, offset + size));
    offset += size + 2;
  }

  throw new Error("Truncated chunked HTTP response: missing terminating chunk");
}

/**
 * Parses a raw HTTP/1.1 byte buffer into status, lowercased headers, and UTF-8 body text.
 */
export function parseHttp11Response(rawBytes) {
  const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  const headerSep = new Uint8Array([13, 10, 13, 10]);
  const sepIndex = findSequence(bytes, headerSep);
  if (sepIndex === -1) {
    throw new Error("Malformed HTTP response: missing header terminator");
  }

  const headerText = new TextDecoder("latin1").decode(bytes.subarray(0, sepIndex));
  const lines = headerText.split("\r\n");
  const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})\b/.exec(lines[0] || "");
  if (!statusMatch) {
    throw new Error("Malformed HTTP status line");
  }
  const status = Number.parseInt(statusMatch[1], 10);

  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(":");
    if (colon === -1) continue;
    const name = lines[i].slice(0, colon).trim().toLowerCase();
    const value = lines[i].slice(colon + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }

  let bodyBytes = bytes.subarray(sepIndex + 4);
  const transferEncoding = (headers["transfer-encoding"] || "").toLowerCase();

  if (transferEncoding.includes("chunked")) {
    bodyBytes = decodeChunkedBody(bodyBytes);
  } else if (headers["content-length"] !== undefined) {
    const expected = Number.parseInt(headers["content-length"], 10);
    if (!Number.isFinite(expected) || expected < 0) {
      throw new Error("Invalid Content-Length header");
    }
    if (bodyBytes.byteLength < expected) {
      throw new Error("Truncated HTTP response body");
    }
    bodyBytes = bodyBytes.subarray(0, expected);
  }

  const bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  return { status, headers, bodyText };
}
