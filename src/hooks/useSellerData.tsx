import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AntSeedApiClient, RateLimitError } from '../api/client';
import { deriveAttentionItems, mergeSellerProfile } from '../api/mappers';
import { getAppConfig, POLL_INTERVAL_MS, type AppConfig } from '../config';
import type {
  AttentionItem,
  MergedSellerProfile,
  NetworkHealthData,
  NetworkStatusData,
  OptionalSellerMetadata,
  SellerChecksData,
  SellerDailyData,
  SellerDetail,
  SellerDirectoryRow,
  SellerModelsData,
} from '../types/antseed';

export interface SellerDataContextValue {
  config: AppConfig;
  client: AntSeedApiClient;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  rateLimitUntilMs: number | null;
  lastUpdatedAt: number | null;
  profile: MergedSellerProfile;
  models: SellerModelsData | null;
  daily: SellerDailyData | null;
  checks: SellerChecksData | null;
  status: NetworkStatusData | null;
  health: NetworkHealthData | null;
  metadata: OptionalSellerMetadata | null;
  attentionItems: AttentionItem[];
  refresh: (force?: boolean) => Promise<void>;
}

interface SnapshotResult {
  detail?: SellerDetail;
  directoryRow?: SellerDirectoryRow | null;
  models?: SellerModelsData;
  daily?: SellerDailyData;
  checks?: SellerChecksData;
  status?: NetworkStatusData;
  health?: NetworkHealthData;
  metadata?: OptionalSellerMetadata | null;
  anySuccess: boolean;
  rateLimitUntilMs: number | null;
  error: string | null;
}

async function fetchSellerSnapshot(
  client: AntSeedApiClient,
  sellerAddressLower: string,
  force: boolean,
): Promise<SnapshotResult> {
  const [
    detailRes,
    directoryRes,
    modelsRes,
    dailyRes,
    checksRes,
    statusRes,
    healthRes,
    metaRes,
  ] = await Promise.allSettled([
    client.getSellerDetail(force),
    client.getSellersDirectory(force),
    client.getSellerModels(force),
    client.getSellerDaily(force),
    client.getSellerChecks(force),
    client.getStatus(force),
    client.getNetworkHealth(force),
    client.getOptionalSellerMetadata(),
  ]);

  const out: SnapshotResult = {
    anySuccess: false,
    rateLimitUntilMs: null,
    error: null,
  };

  const errors: string[] = [];
  let rateLimitedMs = 0;

  const handleErr = (reason: unknown, label: string) => {
    if (reason instanceof RateLimitError) {
      rateLimitedMs = Math.max(rateLimitedMs, reason.retryAfterMs);
    } else if (reason instanceof Error) {
      errors.push(`${label}: ${reason.message}`);
    } else {
      errors.push(`${label}: request failed`);
    }
  };

  if (detailRes.status === 'fulfilled') {
    out.detail = detailRes.value.data;
    out.anySuccess = true;
  } else {
    handleErr(detailRes.reason, 'Seller detail');
  }

  if (directoryRes.status === 'fulfilled') {
    out.directoryRow =
      directoryRes.value.data.sellers.find(
        (s) => s.address.toLowerCase() === sellerAddressLower,
      ) ?? null;
    out.anySuccess = true;
  } else {
    handleErr(directoryRes.reason, 'Sellers directory');
  }

  if (modelsRes.status === 'fulfilled') {
    out.models = modelsRes.value.data;
    out.anySuccess = true;
  } else {
    handleErr(modelsRes.reason, 'Seller models');
  }

  if (dailyRes.status === 'fulfilled') {
    out.daily = dailyRes.value.data;
    out.anySuccess = true;
  } else {
    handleErr(dailyRes.reason, 'Daily settlements');
  }

  if (checksRes.status === 'fulfilled') {
    out.checks = checksRes.value.data;
    out.anySuccess = true;
  } else {
    handleErr(checksRes.reason, 'Model checks');
  }

  if (statusRes.status === 'fulfilled') {
    out.status = statusRes.value.data;
    out.anySuccess = true;
  } else {
    handleErr(statusRes.reason, 'Indexer status');
  }

  if (healthRes.status === 'fulfilled') {
    out.health = healthRes.value.data;
    out.anySuccess = true;
  }

  if (metaRes.status === 'fulfilled' && metaRes.value) {
    out.metadata = metaRes.value;
  }

  if (rateLimitedMs > 0) {
    out.rateLimitUntilMs = Date.now() + rateLimitedMs;
    out.error = `AntSeedStats rate limit active — retrying in ${Math.ceil(rateLimitedMs / 1000)}s.`;
  } else if (errors.length > 0) {
    out.error = errors[0] ?? null;
  }

  return out;
}

const SellerDataContext = createContext<SellerDataContextValue | null>(null);

export function SellerDataProvider({
  children,
  configOverride,
}: {
  children: ReactNode;
  configOverride?: AppConfig;
}) {
  const config = useMemo(() => configOverride ?? getAppConfig(), [configOverride]);
  const client = useMemo(() => new AntSeedApiClient(config), [config]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitUntilMs, setRateLimitUntilMs] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [detail, setDetail] = useState<SellerDetail | null>(null);
  const [directoryRow, setDirectoryRow] = useState<SellerDirectoryRow | null>(null);
  const [models, setModels] = useState<SellerModelsData | null>(null);
  const [daily, setDaily] = useState<SellerDailyData | null>(null);
  const [checks, setChecks] = useState<SellerChecksData | null>(null);
  const [status, setStatus] = useState<NetworkStatusData | null>(null);
  const [health, setHealth] = useState<NetworkHealthData | null>(null);
  const [metadata, setMetadata] = useState<OptionalSellerMetadata | null>(null);

  const applySnapshot = useCallback((snap: SnapshotResult) => {
    if (snap.detail !== undefined) setDetail(snap.detail);
    if (snap.directoryRow !== undefined) setDirectoryRow(snap.directoryRow);
    if (snap.models !== undefined) setModels(snap.models);
    if (snap.daily !== undefined) setDaily(snap.daily);
    if (snap.checks !== undefined) setChecks(snap.checks);
    if (snap.status !== undefined) setStatus(snap.status);
    if (snap.health !== undefined) setHealth(snap.health);
    if (snap.metadata !== undefined) setMetadata(snap.metadata);
    if (snap.anySuccess) setLastUpdatedAt(Date.now());
    setRateLimitUntilMs(snap.rateLimitUntilMs);
    setError(snap.error);
    setLoading(false);
    setRefreshing(false);
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      const snap = await fetchSellerSnapshot(client, config.sellerAddressLower, force);
      applySnapshot(snap);
    },
    [client, config.sellerAddressLower, applySnapshot],
  );

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      void fetchSellerSnapshot(client, config.sellerAddressLower, false).then((snap) => {
        if (!cancelled) applySnapshot(snap);
      });
    };

    run();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [client, config.sellerAddressLower, applySnapshot]);

  const profile = useMemo(
    () =>
      mergeSellerProfile({
        config,
        detail,
        directoryRow,
        daily,
        models,
        checks,
      }),
    [config, detail, directoryRow, daily, models, checks],
  );

  const attentionItems = useMemo(
    () =>
      deriveAttentionItems({
        profile,
        models,
        checks,
        status,
        health,
        lastError: error,
      }),
    [profile, models, checks, status, health, error],
  );

  const value = useMemo<SellerDataContextValue>(
    () => ({
      config,
      client,
      loading,
      refreshing,
      error,
      rateLimitUntilMs,
      lastUpdatedAt,
      profile,
      models,
      daily,
      checks,
      status,
      health,
      metadata,
      attentionItems,
      refresh,
    }),
    [
      config,
      client,
      loading,
      refreshing,
      error,
      rateLimitUntilMs,
      lastUpdatedAt,
      profile,
      models,
      daily,
      checks,
      status,
      health,
      metadata,
      attentionItems,
      refresh,
    ],
  );

  return <SellerDataContext.Provider value={value}>{children}</SellerDataContext.Provider>;
}

export function useSellerData(): SellerDataContextValue {
  const ctx = useContext(SellerDataContext);
  if (!ctx) throw new Error('useSellerData must be used within SellerDataProvider');
  return ctx;
}
