/**
 * Optional Cloudflare Pages Function proxy for the seller's public /metadata endpoint.
 *
 * Why a proxy? Seller /metadata endpoints often serve plain HTTP, which browsers block
 * from an HTTPS dashboard page (mixed-content restriction).
 *
 * Security & privacy:
 * - Off by default: when SELLER_METADATA_URL is unset, returns { configured: false }.
 * - Never exposes raw network endpoints: strips `publicAddress` and `signature` before
 *   forwarding only safe public telemetry fields.
 * - Caches responses for 30 seconds at the edge to avoid hammering the seller node.
 */

interface Env {
  SELLER_METADATA_URL?: string;
}

interface PagesContext {
  env: Env;
}

interface RawProvider {
  provider?: unknown;
  services?: unknown;
  maxConcurrency?: unknown;
  currentLoad?: unknown;
}

interface RawMetadata {
  version?: unknown;
  displayName?: unknown;
  providers?: unknown;
  onChainChannelCount?: unknown;
  onChainGhostCount?: unknown;
  timestamp?: unknown;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const target = context.env.SELLER_METADATA_URL?.trim();
  if (!target) {
    return new Response(JSON.stringify({ configured: false, data: null }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60',
      },
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    return new Response(
      JSON.stringify({ configured: false, error: 'Invalid SELLER_METADATA_URL configuration' }),
      {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ configured: true, data: null, error: `Upstream HTTP ${upstream.status}` }),
        {
          status: 502,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }

    const raw = (await upstream.json()) as RawMetadata;
    const providers = Array.isArray(raw.providers)
      ? (raw.providers as RawProvider[]).map((p) => ({
          servicesCount: Array.isArray(p.services) ? p.services.length : 0,
          maxConcurrency: typeof p.maxConcurrency === 'number' ? p.maxConcurrency : null,
          currentLoad: typeof p.currentLoad === 'number' ? p.currentLoad : null,
        }))
      : [];

    // Strip any IP/port (publicAddress) and signature; return only public aggregate fields.
    const safePayload = {
      configured: true,
      data: {
        version: typeof raw.version === 'number' ? raw.version : null,
        displayName: typeof raw.displayName === 'string' ? raw.displayName : null,
        totalServices: providers.reduce((sum, p) => sum + p.servicesCount, 0),
        currentLoad: providers.reduce((sum, p) => sum + (p.currentLoad ?? 0), 0),
        maxConcurrency: providers.reduce((sum, p) => sum + (p.maxConcurrency ?? 0), 0),
        onChainChannelCount:
          typeof raw.onChainChannelCount === 'number' ? raw.onChainChannelCount : null,
        onChainGhostCount:
          typeof raw.onChainGhostCount === 'number' ? raw.onChainGhostCount : null,
        timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : null,
      },
    };

    return new Response(JSON.stringify(safePayload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ configured: true, data: null, error: 'Seller metadata unreachable' }),
      {
        status: 504,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}
