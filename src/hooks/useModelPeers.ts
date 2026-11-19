import { useCallback, useEffect, useMemo, useState } from 'react';
import { mapWithConcurrency } from '../api/client';
import type { AdvertisedModel, ModelMarketData } from '../types/antseed';
import { useSellerData } from './useSellerData';

export interface ModelPeersState {
  marketByModel: Record<string, ModelMarketData>;
  loadingModels: boolean;
  loadedCount: number;
  totalCount: number;
  error: string | null;
  reload: () => Promise<void>;
}

export function useModelPeers(advertised: AdvertisedModel[]): ModelPeersState {
  const { client } = useSellerData();
  const [marketByModel, setMarketByModel] = useState<Record<string, ModelMarketData>>({});
  const [loadedCount, setLoadedCount] = useState(0);
  const [manualLoading, setManualLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const textModels = useMemo(
    () => advertised.filter((m) => m.modality === 'text'),
    [advertised],
  );
  const modelKey = useMemo(() => textModels.map((m) => m.model).join('|'), [textModels]);

  useEffect(() => {
    if (!modelKey) return;
    let cancelled = false;
    const force = reloadNonce > 0;
    let completed = 0;

    void mapWithConcurrency(textModels, 4, async (m) => {
      const res = await client.getModelMarket(m.model, m.model_display, force);
      completed += 1;
      if (!cancelled) {
        setLoadedCount(completed);
        setMarketByModel((prev) => ({ ...prev, [m.model]: res.data }));
      }
      return res.data;
    }).then((results) => {
      if (cancelled) return;
      const failedCount = results.filter((r) => !r.ok).length;
      setError(
        failedCount > 0
          ? `${failedCount} model market snapshot${failedCount === 1 ? '' : 's'} could not be loaded. Retry shortly.`
          : null,
      );
      setManualLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [client, modelKey, textModels, reloadNonce]);

  const reload = useCallback(async () => {
    setManualLoading(true);
    setError(null);
    setReloadNonce((n) => n + 1);
  }, []);

  const loadingModels =
    manualLoading || (textModels.length > 0 && loadedCount < textModels.length && error === null);

  return {
    marketByModel,
    loadingModels,
    loadedCount,
    totalCount: textModels.length,
    error,
    reload,
  };
}
