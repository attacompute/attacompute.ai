// Cloudflare Pages Function: GET /api/models
// Proxies live attacompute seller metadata over HTTPS, strips internal fields,
// and caches the minimal public model list at the Cloudflare edge.
import {
  CACHE_CONTROL_HEADER,
  DEFAULT_METADATA_URL,
  DEFAULT_METADATA_VERSION,
  EDGE_CACHE_TTL_SECONDS,
  UPSTREAM_TIMEOUT_MS,
  isDirectIpOrCustomPort,
  mapSellerMetadataToPublicModels,
  parseHttp11Response
} from "../_lib/models.js";

const MAX_UPSTREAM_BYTES = 512 * 1024;
const BASE_SECURITY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Robots-Tag": "noindex"
};

function sanitizeHeaderValue(value) {
  return String(value ?? "").replace(/[\r\n]/g, "").trim();
}

function buildCanonicalCacheKey(requestUrl) {
  const url = new URL(requestUrl);
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...BASE_SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

async function fetchViaFetchApi(upstreamUrl, version, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-antseed-metadata-version": version
      },
      signal: controller.signal,
      cf: {
        cacheTtl: EDGE_CACHE_TTL_SECONDS,
        cacheEverything: true
      }
    });
    if (!res.ok) {
      throw new Error(`Upstream HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaCloudflareSocket(upstreamUrl, version, timeoutMs, socketConnect) {
  const parsed = new URL(upstreamUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Unsupported upstream protocol");
  }

  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === "https:"
      ? 443
      : 80;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const pathAndQuery = `${parsed.pathname || "/"}${parsed.search || ""}`;
  const hostHeader = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  const safeVersion = sanitizeHeaderValue(version);

  const socket = socketConnect(
    { hostname, port },
    parsed.protocol === "https:" ? { secureTransport: "on" } : { secureTransport: "off" }
  );

  let timerId;
  let reader = null;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error("Upstream metadata timeout")), timeoutMs);
  });

  const ioPromise = (async () => {
    const reqText =
      `GET ${pathAndQuery} HTTP/1.1\r\n` +
      `Host: ${hostHeader}\r\n` +
      `Accept: application/json\r\n` +
      `x-antseed-metadata-version: ${safeVersion}\r\n` +
      `Connection: close\r\n\r\n`;

    const writer = socket.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(reqText));
    } finally {
      writer.releaseLock();
    }

    reader = socket.readable.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_UPSTREAM_BYTES) {
          throw new Error("Upstream metadata exceeded maximum response size");
        }
        chunks.push(value);
      }
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const parsedRes = parseHttp11Response(merged);
    if (parsedRes.status < 200 || parsedRes.status >= 300) {
      throw new Error(`Upstream HTTP ${parsedRes.status}`);
    }
    return JSON.parse(parsedRes.bodyText);
  })();
  // Prevent unhandled rejection if timeoutPromise wins the race before socket cleanup settles.
  ioPromise.catch(() => {});

  try {
    return await Promise.race([ioPromise, timeoutPromise]);
  } finally {
    clearTimeout(timerId);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cleanup errors
      }
    }
    try {
      await socket.close();
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function loadCloudflareSocketConnect() {
  try {
    const mod = await import("cloudflare:sockets");
    return typeof mod?.connect === "function" ? mod.connect : null;
  } catch {
    return null;
  }
}

async function fetchUpstreamMetadata(upstreamUrl, version, timeoutMs, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const deadline = Date.now() + timeoutMs;

  if (isDirectIpOrCustomPort(upstreamUrl)) {
    const socketConnect = deps.socketConnect ?? (await loadCloudflareSocketConnect());
    if (socketConnect) {
      try {
        return await fetchViaCloudflareSocket(upstreamUrl, version, timeoutMs, socketConnect);
      } catch (socketError) {
        const remainingMs = deadline - Date.now();
        if ((deps.socketConnect && !deps.allowFetchFallback) || remainingMs <= 250) {
          throw socketError;
        }
        return fetchViaFetchApi(upstreamUrl, version, remainingMs, fetchImpl);
      }
    }
  }
  return fetchViaFetchApi(upstreamUrl, version, timeoutMs, fetchImpl);
}

export async function handleModelsRequest(context, deps = {}) {
  const { request, env, waitUntil } = context;
  const cache = deps.cache !== undefined ? deps.cache : typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = buildCanonicalCacheKey(request.url);

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {
      // Ignore cache read failures and fetch upstream
    }
  }

  const upstreamUrl = env?.SELLER_METADATA_URL || DEFAULT_METADATA_URL;
  const version = sanitizeHeaderValue(env?.SELLER_METADATA_VERSION || DEFAULT_METADATA_VERSION);
  const timeoutMs = Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : UPSTREAM_TIMEOUT_MS;

  try {
    const raw = await fetchUpstreamMetadata(upstreamUrl, version, timeoutMs, deps);
    const mapped = mapSellerMetadataToPublicModels(raw, { now: deps.now });

    if (!Array.isArray(mapped.models) || mapped.models.length === 0) {
      throw new Error("Upstream seller metadata returned no models");
    }

    const response = jsonResponse(mapped, 200, {
      "Cache-Control": CACHE_CONTROL_HEADER
    });

    if (cache) {
      const putPromise = cache.put(cacheKey, response.clone()).catch(() => {});
      if (typeof waitUntil === "function") {
        waitUntil(putPromise);
      } else {
        await putPromise;
      }
    }

    return response;
  } catch {
    return jsonResponse(
      { error: "Upstream seller metadata unavailable" },
      502,
      { "Cache-Control": "no-store" }
    );
  }
}

export async function onRequestGet(context) {
  return handleModelsRequest(context);
}
