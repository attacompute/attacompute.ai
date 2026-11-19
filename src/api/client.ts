import { CATALOG_CACHE_TTL_MS, LIVE_CACHE_TTL_MS, type AppConfig } from '../config';
import type {
  ChannelsData,
  ModelMarketData,
  NetworkHealthData,
  NetworkStatusData,
  OptionalSellerMetadata,
  RequestsData,
  SellerChecksData,
  SellerDailyData,
  SellerDetail,
  SellerDirectoryRow,
  SellerModelsData,
  TransactionsData,
} from '../types/antseed';
import {
  FIXTURE_CHANNELS,
  FIXTURE_NETWORK_HEALTH,
  FIXTURE_REQUESTS,
  FIXTURE_SELLER_CHECKS,
  FIXTURE_SELLER_DAILY,
  FIXTURE_SELLER_DETAIL,
  FIXTURE_SELLER_MODELS,
  FIXTURE_SELLERS_DIRECTORY,
  FIXTURE_STATUS,
  FIXTURE_TRANSACTIONS,
  getFixtureModelMarket,
} from './fixtures';
import {
  validateChannels,
  validateModelMarket,
  validateNetworkHealth,
  validateNetworkStatus,
  validateOptionalSellerMetadata,
  validatePricesFallback,
  validateRequests,
  validateSellerChecks,
  validateSellerDaily,
  validateSellerDetail,
  validateSellerModels,
  validateSellersDirectory,
  validateTransactions,
  type ValidatedEnvelope,
} from './validate';

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
}

export class RateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`Rate limited by AntSeedStats (retrying in ${Math.ceil(retryAfterMs / 1000)}s)`);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class AntSeedApiClient {
  private readonly config: AppConfig;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private backoffUntilMs = 0;
  private consecutiveRateLimits = 0;

  constructor(config: AppConfig) {
    this.config = config;
  }

  getBackoffRemainingMs(now = Date.now()): number {
    return Math.max(0, this.backoffUntilMs - now);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async fetchJson<T>(
    path: string,
    validator: (raw: unknown) => T,
    opts: { ttlMs: number; force?: boolean; fixtureRaw?: unknown },
  ): Promise<T> {
    const url = `${this.config.apiBase}${path}`;
    const now = Date.now();

    if (this.config.useFixtures && opts.fixtureRaw !== undefined) {
      return validator(opts.fixtureRaw);
    }

    const cached = this.cache.get(url) as CacheEntry<T> | undefined;
    if (!opts.force && cached && cached.expiresAt > now) {
      return cached.value;
    }

    // Respect global 429 backoff window — return stale cache when available
    if (this.backoffUntilMs > now) {
      if (cached) return cached.value;
      throw new RateLimitError(this.backoffUntilMs - now);
    }

    const existing = this.inflight.get(url) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });

        if (res.status === 429) {
          this.consecutiveRateLimits += 1;
          const retryHeader = res.headers.get('retry-after');
          const parsedHeaderSec = retryHeader ? Number(retryHeader) : NaN;
          const expBackoffMs = Math.min(300_000, Math.pow(2, this.consecutiveRateLimits) * 2000);
          const jitterMs = Math.round(Math.random() * 1500);
          const waitMs = Number.isFinite(parsedHeaderSec)
            ? Math.max(5_000, parsedHeaderSec * 1000)
            : expBackoffMs + jitterMs;
          this.backoffUntilMs = Date.now() + waitMs;
          if (cached) return cached.value;
          throw new RateLimitError(waitMs);
        }

        if (!res.ok) {
          throw new Error(`AntSeedStats HTTP ${res.status} on ${path}`);
        }

        const raw: unknown = await res.json();
        const validated = validator(raw);
        this.consecutiveRateLimits = 0;
        const doneAt = Date.now();
        this.cache.set(url, {
          value: validated,
          fetchedAt: doneAt,
          expiresAt: doneAt + opts.ttlMs,
        });
        return validated;
      } catch (err) {
        if (cached && !(err instanceof RateLimitError)) {
          return cached.value;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
        this.inflight.delete(url);
      }
    })();

    this.inflight.set(url, promise);
    return promise;
  }

  getSellerDetail(force = false): Promise<ValidatedEnvelope<SellerDetail>> {
    return this.fetchJson(
      `/sellers/${encodeURIComponent(this.config.sellerAddress)}`,
      validateSellerDetail,
      { ttlMs: LIVE_CACHE_TTL_MS, force, fixtureRaw: FIXTURE_SELLER_DETAIL },
    );
  }

  getSellersDirectory(
    force = false,
  ): Promise<ValidatedEnvelope<{ total: number; sellers: SellerDirectoryRow[] }>> {
    return this.fetchJson('/sellers?sort=revenue_7d&limit=150', validateSellersDirectory, {
      ttlMs: CATALOG_CACHE_TTL_MS,
      force,
      fixtureRaw: FIXTURE_SELLERS_DIRECTORY,
    });
  }

  getSellerModels(force = false): Promise<ValidatedEnvelope<SellerModelsData>> {
    return this.fetchJson(
      `/sellers/${encodeURIComponent(this.config.sellerAddress)}/models`,
      validateSellerModels,
      { ttlMs: CATALOG_CACHE_TTL_MS, force, fixtureRaw: FIXTURE_SELLER_MODELS },
    );
  }

  getSellerDaily(force = false): Promise<ValidatedEnvelope<SellerDailyData>> {
    return this.fetchJson(
      `/sellers/${encodeURIComponent(this.config.sellerAddress)}/daily`,
      validateSellerDaily,
      { ttlMs: CATALOG_CACHE_TTL_MS, force, fixtureRaw: FIXTURE_SELLER_DAILY },
    );
  }

  getSellerChecks(force = false): Promise<ValidatedEnvelope<SellerChecksData>> {
    return this.fetchJson(
      `/sellers/${encodeURIComponent(this.config.sellerAddress)}/checks`,
      validateSellerChecks,
      { ttlMs: CATALOG_CACHE_TTL_MS, force, fixtureRaw: FIXTURE_SELLER_CHECKS },
    );
  }

  getStatus(force = false): Promise<ValidatedEnvelope<NetworkStatusData>> {
    return this.fetchJson('/status', validateNetworkStatus, {
      ttlMs: LIVE_CACHE_TTL_MS,
      force,
      fixtureRaw: FIXTURE_STATUS,
    });
  }

  getNetworkHealth(force = false): Promise<ValidatedEnvelope<NetworkHealthData>> {
    return this.fetchJson('/network/health', validateNetworkHealth, {
      ttlMs: CATALOG_CACHE_TTL_MS,
      force,
      fixtureRaw: FIXTURE_NETWORK_HEALTH,
    });
  }

  async getModelMarket(
    modelId: string,
    display: string,
    force = false,
  ): Promise<ValidatedEnvelope<ModelMarketData>> {
    try {
      return await this.fetchJson(
        `/models/${encodeURIComponent(modelId)}`,
        validateModelMarket,
        {
          ttlMs: CATALOG_CACHE_TTL_MS,
          force,
          fixtureRaw: getFixtureModelMarket(modelId, display),
        },
      );
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      return this.fetchJson(
        `/prices?model=${encodeURIComponent(modelId)}&limit=100`,
        (raw) => validatePricesFallback(raw, modelId, display),
        {
          ttlMs: CATALOG_CACHE_TTL_MS,
          force,
          fixtureRaw: { data: { total: 0, listings: [] }, meta: {} },
        },
      );
    }
  }

  getChannels(force = false): Promise<ValidatedEnvelope<ChannelsData>> {
    return this.fetchJson('/channels?limit=200', validateChannels, {
      ttlMs: LIVE_CACHE_TTL_MS,
      force,
      fixtureRaw: FIXTURE_CHANNELS,
    });
  }

  getRequests(force = false): Promise<ValidatedEnvelope<RequestsData>> {
    return this.fetchJson('/requests?limit=200', validateRequests, {
      ttlMs: LIVE_CACHE_TTL_MS,
      force,
      fixtureRaw: FIXTURE_REQUESTS,
    });
  }

  getSettlements(force = false): Promise<ValidatedEnvelope<TransactionsData>> {
    return this.fetchJson('/transactions?kind=settle&limit=100', validateTransactions, {
      ttlMs: LIVE_CACHE_TTL_MS,
      force,
      fixtureRaw: FIXTURE_TRANSACTIONS,
    });
  }

  async getOptionalSellerMetadata(): Promise<OptionalSellerMetadata | null> {
    if (!this.config.sellerMetadataProxyUrl || this.config.useFixtures) {
      return null;
    }
    try {
      const res = await fetch(this.config.sellerMetadataProxyUrl, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null;
      const raw: unknown = await res.json();
      return validateOptionalSellerMetadata(raw);
    } catch {
      return null;
    }
  }
}

/** Run async tasks with a strict concurrency cap to stay friendly to AntSeedStats. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(
    items.length,
  );
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (item === undefined) continue;
      try {
        const value = await worker(item);
        results[idx] = { ok: true, value };
      } catch (error) {
        results[idx] = { ok: false, error };
      }
    }
  }

  const count = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}
