import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorBanner, SkeletonCard } from '../components/DataState';
import { PriceChangeDrawer } from '../components/PriceChangeDrawer';
import { useModelPeers } from '../hooks/useModelPeers';
import { useSellerData } from '../hooks/useSellerData';
import type { EditedModelSummary } from '../lib/changeRequest';
import { formatPercent, formatPricePerM, formatSignedPct, shortAddress } from '../lib/format';
import {
  PRICE_FIELDS,
  computeFallbackFactor,
  computePriceToIncludePeer,
  computeSliderRange,
  evaluateModelPricing,
  extractListingPrice,
  hasPriceEdit,
  pctChange,
  roundPrice,
  type EvaluatedPeer,
  type ModelPricingEvaluation,
  type PriceField,
  type TokenPrice,
} from '../lib/pricing';
import type { AdvertisedModel } from '../types/antseed';

const FIELD_META: Record<PriceField, { label: string; short: string }> = {
  input: { label: 'Input', short: 'In' },
  cached: { label: 'Cached input', short: 'Cached' },
  output: { label: 'Output', short: 'Out' },
};

type FilterChip = 'all' | 'no-fallback' | 'edited' | 'paid';
type SortOption = 'revenue' | 'name' | 'fallbacks' | 'rank';
type PeerFilter = 'all' | 'eligible' | 'changed' | 'trusted';

interface EditSnapshot {
  edits: Record<string, TokenPrice>;
}

const GATE_LABELS: Record<NonNullable<EvaluatedPeer['gate']>, string> = {
  own_listing: 'Your listing',
  invalid_price: 'Invalid offer',
  reported_failing: 'Reported failing',
  model_check_diff: 'Model check DIFF',
  offline: 'Offline now',
};

export function PricingPage() {
  const { config, loading, profile, models, error: sellerError, refresh } = useSellerData();
  const [searchParams] = useSearchParams();
  const deepLinkedModel = searchParams.get('model');

  const advertised = useMemo(() => models?.advertised ?? [], [models]);
  const textListings = useMemo(
    () =>
      advertised
        .map((model) => ({ model, livePrice: extractListingPrice(model) }))
        .filter((item): item is { model: AdvertisedModel; livePrice: TokenPrice } => item.livePrice !== null),
    [advertised],
  );
  const nonTextListings = useMemo(
    () => advertised.filter((m) => m.modality !== 'text'),
    [advertised],
  );

  const soldByModel = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of models?.sold ?? []) {
      map.set(s.model, s.settled_micro);
    }
    return map;
  }, [models]);

  const { marketByModel, loadingModels, loadedCount, totalCount, error: peersError, reload } =
    useModelPeers(advertised);

  const [extraHeadroomPct, setExtraHeadroomPct] = useState(0);
  const [query, setQuery] = useState('');
  const [filterChip, setFilterChip] = useState<FilterChip>('all');
  const [sortBy, setSortBy] = useState<SortOption>('revenue');
  const [peerFilterByModel, setPeerFilterByModel] = useState<Record<string, PeerFilter>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Undo / redo edit history
  const [history, setHistory] = useState<EditSnapshot[]>([{ edits: {} }]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const edits = useMemo(() => history[historyIdx]?.edits ?? {}, [history, historyIdx]);

  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < history.length - 1;

  const commitEdits = useCallback(
    (nextEdits: Record<string, TokenPrice>) => {
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIdx + 1);
        const capped = sliced.length >= 60 ? sliced.slice(sliced.length - 59) : sliced;
        return [...capped, { edits: nextEdits }];
      });
      setHistoryIdx((idx) => Math.min(idx + 1, 59));
    },
    [historyIdx],
  );

  const updateModelPrice = useCallback(
    (modelId: string, livePrice: TokenPrice, nextPrice: TokenPrice) => {
      const cleaned: TokenPrice = {
        input: roundPrice(nextPrice.input),
        cached: roundPrice(nextPrice.cached),
        output: roundPrice(nextPrice.output),
      };
      const next = { ...edits };
      if (!hasPriceEdit(livePrice, cleaned)) {
        delete next[modelId];
      } else {
        next[modelId] = cleaned;
      }
      commitEdits(next);
    },
    [edits, commitEdits],
  );

  const resetModel = useCallback(
    (modelId: string) => {
      if (!edits[modelId]) return;
      const next = { ...edits };
      delete next[modelId];
      commitEdits(next);
    },
    [edits, commitEdits],
  );

  const resetAll = useCallback(() => {
    if (Object.keys(edits).length === 0) return;
    commitEdits({});
  }, [edits, commitEdits]);

  // Default open model derived cleanly (deep-linked model or Claude Sonnet 5.5 / first listing)
  const defaultOpenModelId = useMemo(() => {
    if (deepLinkedModel && textListings.some((x) => x.model.model === deepLinkedModel)) {
      return deepLinkedModel;
    }
    const preferred =
      textListings.find((x) => x.model.model === 'claude-sonnet-5-5') ?? textListings[0];
    return preferred?.model.model ?? null;
  }, [textListings, deepLinkedModel]);

  const effectiveFactor = useMemo(
    () => computeFallbackFactor(profile.derivedPlatformFee, extraHeadroomPct),
    [profile.derivedPlatformFee, extraHeadroomPct],
  );

  const evaluations = useMemo(() => {
    const out = new Map<string, ModelPricingEvaluation>();
    for (const { model, livePrice } of textListings) {
      const activePrice = edits[model.model] ?? livePrice;
      const offers = marketByModel[model.model]?.sellers ?? [];
      out.set(
        model.model,
        evaluateModelPricing({
          livePrice,
          activePrice,
          offers,
          selfAddress: config.sellerAddressLower,
          ownAddresses: config.ownAddresses,
          factor: effectiveFactor,
          listInputUsdPerM: model.list_input_usd_per_m,
        }),
      );
    }
    return out;
  }, [textListings, edits, marketByModel, config.sellerAddressLower, config.ownAddresses, effectiveFactor]);

  const editedSummaries = useMemo<EditedModelSummary[]>(() => {
    const list: EditedModelSummary[] = [];
    for (const { model, livePrice } of textListings) {
      const edit = edits[model.model];
      const evaluation = evaluations.get(model.model);
      if (edit && evaluation && hasPriceEdit(livePrice, edit)) {
        list.push({
          model: model.model,
          modelDisplay: model.model_display,
          advertisedAs: model.advertised_as,
          evaluation,
        });
      }
    }
    return list;
  }, [textListings, edits, evaluations]);

  const visibleListings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = textListings.filter(({ model, livePrice }) => {
      const ev = evaluations.get(model.model);
      if (
        needle &&
        !model.model_display.toLowerCase().includes(needle) &&
        !model.model.toLowerCase().includes(needle) &&
        !model.advertised_as.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (filterChip === 'no-fallback' && ev && ev.eligibleActiveCount > 0) return false;
      if (filterChip === 'edited' && !hasPriceEdit(livePrice, edits[model.model])) return false;
      if (filterChip === 'paid' && model.free) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      const evA = evaluations.get(a.model.model);
      const evB = evaluations.get(b.model.model);
      if (sortBy === 'name') return a.model.model_display.localeCompare(b.model.model_display);
      if (sortBy === 'fallbacks') {
        return (evA?.eligibleActiveCount ?? 0) - (evB?.eligibleActiveCount ?? 0);
      }
      if (sortBy === 'rank') {
        return (evA?.market.rankAtPrice ?? 999) - (evB?.market.rankAtPrice ?? 999);
      }
      return (soldByModel.get(b.model.model) ?? 0) - (soldByModel.get(a.model.model) ?? 0);
    });
  }, [textListings, query, filterChip, sortBy, evaluations, edits, soldByModel]);

  const summaryStats = useMemo(() => {
    let liveCovered = 0;
    let activeCovered = 0;
    let totalGained = 0;
    let totalDropped = 0;

    for (const { model } of textListings) {
      const ev = evaluations.get(model.model);
      if (!ev) continue;
      if (ev.eligibleLiveCount > 0) liveCovered += 1;
      if (ev.eligibleActiveCount > 0) activeCovered += 1;
      totalGained += ev.gainedPeers.length;
      totalDropped += ev.droppedPeers.length;
    }

    return {
      total: textListings.length,
      liveCovered,
      activeCovered,
      totalGained,
      totalDropped,
      editedCount: editedSummaries.length,
    };
  }, [textListings, evaluations, editedSummaries.length]);

  if (loading && !models) {
    return (
      <div>
        <div className="page-header">
          <div>
            <div className="page-eyebrow">Pricing Workbench</div>
            <h1 className="page-title">Prices, Rank &amp; Fallback Peers</h1>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <SkeletonCard height={100} />
          <SkeletonCard height={180} />
          <SkeletonCard height={180} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Pricing &amp; Fallback Workbench</div>
          <h1 className="page-title">Prices, Market Rank &amp; Fallback Peers</h1>
          <p className="page-subtitle">
            Slide input, cached-input, and output rates to preview rank changes and see exactly
            which AntSeed fallback peers become available or drop out. Live prices are never changed
            directly here.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!canUndo}
            onClick={() => setHistoryIdx((i) => Math.max(0, i - 1))}
            title="Undo last price edit"
          >
            <Undo2 size={14} aria-hidden="true" />
            Undo
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!canRedo}
            onClick={() => setHistoryIdx((i) => Math.min(history.length - 1, i + 1))}
            title="Redo price edit"
          >
            <Redo2 size={14} aria-hidden="true" />
            Redo
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={summaryStats.editedCount === 0}
            onClick={resetAll}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reset all
          </button>
        </div>
      </div>

      {sellerError && <ErrorBanner message={sellerError} onRetry={() => void refresh(true)} />}
      {peersError && <ErrorBanner message={peersError} onRetry={() => void reload()} />}

      {/* Public Fallback Rule + Extra Headroom Control */}
      <section className="pricing-rule-bar" aria-label="Fallback calculation rule">
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
            Fallback rule: peer price ≤ our price ×{' '}
            <span className="mono" style={{ color: 'var(--accent)' }}>
              {(effectiveFactor * 100).toFixed(2)}%
            </span>
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--ink-2)' }}>
            Applies independently to input, cached input, and output. Derived platform fee:{' '}
            <span className="mono">{formatPercent(profile.derivedPlatformFee, 2)}</span> (from public
            chain fees / revenue)
            {loadingModels && totalCount > 0
              ? ` · Loading competitor markets (${loadedCount}/${totalCount})…`
              : ''}
          </div>
        </div>

        <label className="headroom-control">
          <span>Extra headroom</span>
          <input
            type="number"
            className="headroom-input"
            min={0}
            max={25}
            step={0.5}
            value={extraHeadroomPct}
            aria-label="Extra headroom percentage"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setExtraHeadroomPct(Math.min(25, Math.max(0, v)));
            }}
          />
          <span className="mono">%</span>
        </label>
      </section>

      {/* Compact Summary KPIs */}
      <section className="kpi-grid kpi-grid-4" aria-label="Pricing summary">
        <article className="kpi-card">
          <span className="kpi-label">Text models advertised</span>
          <div className="kpi-value">{summaryStats.total}</div>
          <div className="kpi-foot">
            <span>{nonTextListings.length} non-text listing{nonTextListings.length === 1 ? '' : 's'}</span>
          </div>
        </article>

        <article className="kpi-card">
          <span className="kpi-label">Models with ≥1 fallback</span>
          <div className="kpi-value">
            {summaryStats.activeCovered}
            <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink-3)', marginLeft: 4 }}>
              / {summaryStats.total}
            </span>
          </div>
          <div className="kpi-foot">
            <span>
              {summaryStats.activeCovered !== summaryStats.liveCovered
                ? `Live: ${summaryStats.liveCovered} / ${summaryStats.total}`
                : 'Matches live prices'}
            </span>
          </div>
        </article>

        <article className="kpi-card">
          <span className="kpi-label">Fallback peer delta</span>
          <div className="kpi-value" style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ color: summaryStats.totalGained > 0 ? 'var(--good)' : 'var(--ink-2)' }}>
              +{summaryStats.totalGained}
            </span>
            <span style={{ color: summaryStats.totalDropped > 0 ? 'var(--bad)' : 'var(--ink-3)', fontSize: '1.25rem' }}>
              −{summaryStats.totalDropped}
            </span>
          </div>
          <div className="kpi-foot">
            <span>Gained / dropped across edits</span>
          </div>
        </article>

        <article className="kpi-card">
          <span className="kpi-label">Pending edits</span>
          <div className="kpi-value" style={{ color: summaryStats.editedCount > 0 ? 'var(--accent)' : undefined }}>
            {summaryStats.editedCount}
          </div>
          <div className="kpi-foot">
            <span>{summaryStats.editedCount > 0 ? 'Ready to review & export' : 'Adjust any slider below'}</span>
          </div>
        </article>
      </section>

      {/* Filter & Sort Toolbar */}
      <div className="pricing-toolbar">
        <div className="search-input-wrap">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            className="search-input"
            placeholder="Filter models…"
            aria-label="Filter models"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="seg-group" role="group" aria-label="Filter models by status">
          {(
            [
              ['all', 'All'],
              ['no-fallback', 'No fallback'],
              ['edited', `Edited (${summaryStats.editedCount})`],
              ['paid', 'Paid'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="seg-btn"
              aria-pressed={filterChip === id}
              onClick={() => setFilterChip(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--ink-2)' }}>
          <span>Sort</span>
          <select
            className="select-control"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Sort models"
          >
            <option value="revenue">Revenue</option>
            <option value="fallbacks">Fewest fallbacks</option>
            <option value="rank">Best rank</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </label>
      </div>

      {/* Model Workbench Cards */}
      {visibleListings.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No models match your filters"
            detail="Try clearing your search query or switching back to All models."
          />
        </div>
      ) : (
        <div className="pricing-list">
          {visibleListings.map(({ model, livePrice }) => {
            const ev = evaluations.get(model.model);
            if (!ev) return null;
            const isOpen = expanded[model.model] ?? model.model === defaultOpenModelId;
            const isEdited = hasPriceEdit(livePrice, edits[model.model]);
            const peerFilter = peerFilterByModel[model.model] ?? 'all';
            const rankDelta = ev.market.rankAtLive - ev.market.rankAtPrice; // positive = moved up (cheaper)

            const visiblePeers = ev.peers.filter((p) => {
              if (peerFilter === 'eligible') return p.eligibleNow;
              if (peerFilter === 'changed') return p.deltaStatus === 'gained' || p.deltaStatus === 'dropped';
              if (peerFilter === 'trusted') return p.trusted;
              return true;
            });

            return (
              <article
                key={model.model}
                className={`model-card${isEdited ? ' edited' : ''}${ev.invalidCachedAboveInput ? ' invalid' : ''}`}
              >
                <button
                  type="button"
                  className="model-card-header"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [model.model]: !(prev[model.model] ?? model.model === defaultOpenModelId),
                    }))
                  }
                >
                  <div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                      <strong style={{ fontSize: '0.98rem' }}>{model.model_display}</strong>
                      {isEdited && <span className="pill pill-accent" style={{ padding: '1px 7px' }}>Edited</span>}
                      {model.free && <span className="pill" style={{ padding: '1px 7px' }}>Free</span>}
                      {ev.savePctAtActive != null && !model.free && (
                        <span className="pill pill-good" style={{ padding: '1px 7px' }}>
                          Save {ev.savePctAtActive}%
                        </span>
                      )}
                      {ev.invalidCachedAboveInput && (
                        <span className="pill pill-bad" style={{ padding: '1px 7px' }}>
                          Cached &gt; Input
                        </span>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--ink-3)', marginTop: 3 }}>
                      {model.advertised_as}
                      {model.list_input_usd_per_m != null
                        ? ` · List ${formatPricePerM(model.list_input_usd_per_m)}/M in`
                        : ''}
                    </div>
                  </div>

                  <div className="model-price-triplet">
                    {PRICE_FIELDS.map((field) => {
                      const diff = ev.activePrice[field] - livePrice[field];
                      const dir = Math.abs(diff) < 1e-6 ? '' : diff > 0 ? 'up' : 'down';
                      return (
                        <div key={field}>
                          <span className="price-cell-label">{FIELD_META[field].short} $/M</span>
                          <span className={`price-cell-val ${dir}`}>
                            {formatPricePerM(ev.activePrice[field])}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="model-card-market-col">
                    <span className="price-cell-label">Market rank</span>
                    <div className="mono" style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                      #{ev.market.rankAtPrice}
                      <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
                        /{ev.market.totalSellers}
                      </span>
                      {rankDelta !== 0 && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: '0.75rem',
                            color: rankDelta > 0 ? 'var(--good)' : 'var(--warn)',
                          }}
                        >
                          {rankDelta > 0 ? `↑${rankDelta}` : `↓${Math.abs(rankDelta)}`}
                        </span>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                      Med {formatPricePerM(ev.market.medianInput)} / {formatPricePerM(ev.market.medianOutput)}
                    </div>
                  </div>

                  <div>
                    <span className="price-cell-label">Fallback peers</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong
                        className="mono"
                        style={{
                          fontSize: '0.98rem',
                          color:
                            ev.eligibleActiveCount === 0
                              ? 'var(--bad)'
                              : ev.eligibleActiveCount === 1
                                ? 'var(--warn)'
                                : 'var(--good)',
                        }}
                      >
                        {ev.eligibleActiveCount}
                      </strong>
                      {ev.gainedPeers.length > 0 && (
                        <span className="pill pill-good" style={{ padding: '1px 6px' }}>
                          +{ev.gainedPeers.length}
                        </span>
                      )}
                      {ev.droppedPeers.length > 0 && (
                        <span className="pill pill-bad" style={{ padding: '1px 6px' }}>
                          −{ev.droppedPeers.length}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="model-card-chevron" style={{ color: 'var(--ink-3)', display: 'inline-flex' }}>
                    {isOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
                  </span>
                </button>

                {isOpen && (
                  <div className="model-card-body">
                    {/* Market benchmark summary row */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: '0.8125rem' }}>
                        <span className="pill">
                          Rank: <strong className="mono">#{ev.market.rankAtPrice} of {ev.market.totalSellers}</strong>
                          {isEdited && ev.market.rankAtPrice !== ev.market.rankAtLive && (
                            <span className="mono" style={{ color: 'var(--ink-3)' }}>
                              (live #{ev.market.rankAtLive})
                            </span>
                          )}
                        </span>
                        <span className="pill">
                          Min in/out:{' '}
                          <strong className="mono">
                            {formatPricePerM(ev.market.minInput)} / {formatPricePerM(ev.market.minOutput)}
                          </strong>
                        </span>
                        <span className="pill">
                          Median in/out:{' '}
                          <strong className="mono">
                            {formatPricePerM(ev.market.medianInput)} / {formatPricePerM(ev.market.medianOutput)}
                          </strong>
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {ev.market.medianInput != null && ev.market.medianOutput != null && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              const medIn = roundPrice(ev.market.medianInput ?? livePrice.input);
                              const medOut = roundPrice(ev.market.medianOutput ?? livePrice.output);
                              const cached = Math.min(medIn, roundPrice(ev.activePrice.cached));
                              updateModelPrice(model.model, livePrice, {
                                input: medIn,
                                cached,
                                output: medOut,
                              });
                            }}
                          >
                            Snap to median
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!isEdited}
                          onClick={() => resetModel(model.model)}
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                          Reset model
                        </button>
                      </div>
                    </div>

                    {ev.invalidCachedAboveInput && (
                      <div className="attention-item severity-critical" role="alert" style={{ margin: 0 }}>
                        <div className="attention-body">
                          <AlertTriangle size={16} style={{ color: 'var(--bad)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                          <div>
                            <div className="attention-title">Cached input exceeds input price</div>
                            <div className="attention-detail">
                              AntSeed buyers reject listings where cached input &gt; input. Lower cached input or raise input.
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Three Sliders with Competitor Price Ticks */}
                    <div className="sliders-grid">
                      {PRICE_FIELDS.map((field) => {
                        const range = computeSliderRange(
                          livePrice[field],
                          ev.peers,
                          field,
                          field === 'input' ? model.list_input_usd_per_m : null,
                        );
                        const val = ev.activePrice[field];
                        const liveVal = livePrice[field];
                        const deltaPct = pctChange(liveVal, val);
                        const posPct = (v: number) =>
                          Math.max(0, Math.min(100, ((v - range.min) / Math.max(range.max - range.min, 1e-6)) * 100));
                        const medianVal =
                          field === 'input'
                            ? ev.market.medianInput
                            : field === 'output'
                              ? ev.market.medianOutput
                              : null;

                        return (
                          <div key={field} className="slider-panel">
                            <div className="slider-header">
                              <label htmlFor={`num-${model.model}-${field}`} className="slider-title">
                                {FIELD_META[field].label}
                                <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> $/M</span>
                              </label>
                              <div className="price-input-box">
                                <span style={{ color: 'var(--ink-3)' }}>$</span>
                                <input
                                  id={`num-${model.model}-${field}`}
                                  type="number"
                                  className="price-num-input"
                                  min={0}
                                  step="any"
                                  inputMode="decimal"
                                  value={val}
                                  aria-label={`${FIELD_META[field].label} USD per million tokens for ${model.model_display}`}
                                  onChange={(e) => {
                                    const n = Number(e.target.value);
                                    if (!Number.isFinite(n) || n < 0) return;
                                    updateModelPrice(model.model, livePrice, {
                                      ...ev.activePrice,
                                      [field]: n,
                                    });
                                  }}
                                />
                              </div>
                            </div>

                            <input
                              type="range"
                              className="range-slider"
                              min={range.min}
                              max={range.max}
                              step={range.step}
                              value={Math.min(range.max, Math.max(range.min, val))}
                              aria-label={`${FIELD_META[field].label} slider for ${model.model_display}`}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                updateModelPrice(model.model, livePrice, {
                                  ...ev.activePrice,
                                  [field]: n,
                                });
                              }}
                            />

                            {/* Competitor Unlock Ticks Track */}
                            <div
                              className="tick-track"
                              role="img"
                              aria-label={`Competitor unlock thresholds for ${FIELD_META[field].label}`}
                            >
                              {ev.peers
                                .filter((p) => p.gate === null)
                                .map((peer) => {
                                  const unlock = peer.unlockPrice[field];
                                  if (unlock < range.min || unlock > range.max) return null;
                                  const cls =
                                    peer.deltaStatus === 'gained'
                                      ? 'tick-gained'
                                      : peer.deltaStatus === 'dropped'
                                        ? 'tick-dropped'
                                        : peer.eligibleNow
                                          ? 'tick-eligible'
                                          : 'tick-blocked';
                                  return (
                                    <span
                                      key={peer.address}
                                      className={`tick-mark ${cls}`}
                                      style={{ left: `${posPct(unlock).toFixed(2)}%` }}
                                      title={`${peer.name} unlocks ${FIELD_META[field].label.toLowerCase()} at ${formatPricePerM(unlock)}/M (peer asks ${formatPricePerM(peer[field])}/M)`}
                                    />
                                  );
                                })}

                              {medianVal != null && medianVal >= range.min && medianVal <= range.max && (
                                <span
                                  className="tick-mark tick-median"
                                  style={{ left: `${posPct(medianVal).toFixed(2)}%` }}
                                  title={`Market median ${formatPricePerM(medianVal)}/M`}
                                />
                              )}

                              <span
                                className="tick-mark tick-live"
                                style={{ left: `${posPct(liveVal).toFixed(2)}%` }}
                                title={`Current live price ${formatPricePerM(liveVal)}/M`}
                              />
                            </div>

                            <div className="slider-meta">
                              <span className="mono">{formatPricePerM(range.min)}</span>
                              <span
                                className="mono"
                                style={{
                                  color:
                                    Math.abs(val - liveVal) < 1e-6
                                      ? 'var(--ink-3)'
                                      : val > liveVal
                                        ? 'var(--warn)'
                                        : 'var(--good)',
                                }}
                              >
                                {Math.abs(val - liveVal) < 1e-6
                                  ? `Live ${formatPricePerM(liveVal)}`
                                  : `${formatSignedPct(deltaPct)} vs ${formatPricePerM(liveVal)}`}
                              </span>
                              <span className="mono">{formatPricePerM(range.max)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Explicit Gained / Dropped Fallback Impact Banner */}
                    {(ev.gainedPeers.length > 0 || ev.droppedPeers.length > 0) && (
                      <div className="impact-banner" aria-live="polite">
                        {ev.gainedPeers.length > 0 && (
                          <div className="impact-group">
                            <span style={{ color: 'var(--good)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <ArrowUpRight size={15} aria-hidden="true" />
                              Become available ({ev.gainedPeers.length}):
                            </span>
                            {ev.gainedPeers.map((p) => (
                              <span key={p.address} className="pill pill-good">
                                {p.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {ev.droppedPeers.length > 0 && (
                          <div className="impact-group">
                            <span style={{ color: 'var(--bad)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <ArrowDownRight size={15} aria-hidden="true" />
                              Drop out ({ev.droppedPeers.length}):
                            </span>
                            {ev.droppedPeers.map((p) => (
                              <span key={p.address} className="pill pill-bad">
                                {p.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Competitor & Fallback Peer Table */}
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontSize: '0.84375rem', fontWeight: 600 }}>
                          Marketplace sellers &amp; fallback peers ({ev.peers.length})
                        </div>
                        <div className="seg-group" role="group" aria-label={`Filter peers for ${model.model_display}`}>
                          {(
                            [
                              ['all', 'All'],
                              ['eligible', `Available (${ev.eligibleActiveCount})`],
                              ['changed', `Changed (${ev.gainedPeers.length + ev.droppedPeers.length})`],
                              ['trusted', 'Trust ≥60'],
                            ] as const
                          ).map(([f, lbl]) => (
                            <button
                              key={f}
                              type="button"
                              className="seg-btn"
                              aria-pressed={peerFilter === f}
                              onClick={() =>
                                setPeerFilterByModel((prev) => ({ ...prev, [model.model]: f }))
                              }
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>

                      {visiblePeers.length === 0 ? (
                        <div className="card" style={{ padding: 16 }}>
                          <EmptyState
                            title={
                              loadingModels && !marketByModel[model.model]
                                ? 'Loading competitor listings…'
                                : 'No peers match this filter'
                            }
                            detail="Try switching to All peers or refreshing market data."
                          />
                        </div>
                      ) : (
                        <div className="table-scroll">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Peer</th>
                                <th>Fallback status</th>
                                <th className="cell-num">Input</th>
                                <th className="cell-num">Cached</th>
                                <th className="cell-num">Output</th>
                                <th className="cell-num">Trust</th>
                                <th>Signals</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {visiblePeers.map((peer) => {
                                const rowCls =
                                  peer.deltaStatus === 'gained'
                                    ? 'row-gained'
                                    : peer.deltaStatus === 'dropped'
                                      ? 'row-dropped'
                                      : '';
                                return (
                                  <tr key={peer.address} className={rowCls}>
                                    <td>
                                      <div style={{ fontWeight: 550 }}>{peer.name}</div>
                                      <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                                        {shortAddress(peer.address)}
                                      </div>
                                    </td>

                                    <td>
                                      {peer.gate ? (
                                        <span className="pill pill-bad">{GATE_LABELS[peer.gate]}</span>
                                      ) : peer.deltaStatus === 'gained' ? (
                                        <span className="pill pill-good">Becomes available</span>
                                      ) : peer.deltaStatus === 'dropped' ? (
                                        <span className="pill pill-bad">Drops out</span>
                                      ) : peer.eligibleNow ? (
                                        <span className="pill pill-good">
                                          <CheckCircle2 size={12} aria-hidden="true" />
                                          Available
                                        </span>
                                      ) : (
                                        <span className="pill">
                                          Needs higher {peer.blockingFields.join(', ')}
                                        </span>
                                      )}
                                    </td>

                                    <td
                                      className={`cell-num${peer.blockingFields.includes('input') ? ' price-blocking' : ''}`}
                                    >
                                      {formatPricePerM(peer.input)}
                                    </td>
                                    <td
                                      className={`cell-num${peer.blockingFields.includes('cached') ? ' price-blocking' : ''}`}
                                    >
                                      {formatPricePerM(peer.cached)}
                                    </td>
                                    <td
                                      className={`cell-num${peer.blockingFields.includes('output') ? ' price-blocking' : ''}`}
                                    >
                                      {formatPricePerM(peer.output)}
                                    </td>

                                    <td className="cell-num">
                                      <span
                                        style={{
                                          color: peer.trusted ? 'var(--good)' : 'var(--ink-2)',
                                          fontWeight: peer.trusted ? 600 : 400,
                                        }}
                                      >
                                        {peer.reputation != null ? peer.reputation.toFixed(1) : '—'}
                                      </span>
                                    </td>

                                    <td>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {peer.live ? (
                                          <span className="pill pill-good" style={{ padding: '1px 6px' }}>
                                            Live
                                          </span>
                                        ) : (
                                          <span className="pill" style={{ padding: '1px 6px' }}>
                                            Offline
                                          </span>
                                        )}
                                        {peer.health === 'healthy' && (
                                          <span className="pill" style={{ padding: '1px 6px' }}>
                                            Healthy
                                          </span>
                                        )}
                                        {peer.verified && (
                                          <span className="pill pill-accent" style={{ padding: '1px 6px' }} title="Verified owner">
                                            <ShieldCheck size={11} aria-hidden="true" />
                                            Verified
                                          </span>
                                        )}
                                        {peer.modelCheck === 'SAME' && (
                                          <span className="pill pill-good" style={{ padding: '1px 6px' }}>
                                            SAME
                                          </span>
                                        )}
                                      </div>
                                    </td>

                                    <td style={{ textAlign: 'right' }}>
                                      {peer.gate === null && !peer.eligibleNow && (
                                        <button
                                          type="button"
                                          className="btn btn-sm"
                                          onClick={() => {
                                            const snapped = computePriceToIncludePeer(
                                              ev.activePrice,
                                              peer,
                                              effectiveFactor,
                                            );
                                            updateModelPrice(model.model, livePrice, snapped);
                                          }}
                                          title={`Raise sliders just enough to unlock ${peer.name}`}
                                        >
                                          <Plus size={13} aria-hidden="true" />
                                          Include
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Sticky Batch Edit Bar */}
      {editedSummaries.length > 0 && (
        <div className="batch-bar" role="region" aria-label="Pending price edits">
          <div className="batch-bar-inner">
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <strong>
                {editedSummaries.length} model{editedSummaries.length === 1 ? '' : 's'} edited
              </strong>
              <span className="mono" style={{ fontSize: '0.8125rem', color: 'var(--ink-2)' }}>
                Fallbacks:{' '}
                <span style={{ color: 'var(--good)' }}>+{summaryStats.totalGained}</span> /{' '}
                <span style={{ color: 'var(--bad)' }}>−{summaryStats.totalDropped}</span>
              </span>
              <span className="hide-mobile" style={{ fontSize: '0.8rem', color: 'var(--ink-3)' }}>
                Preview only — never changes live prices
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={resetAll}>
                Reset all
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setDrawerOpen(true)}
              >
                <Send size={14} aria-hidden="true" />
                Submit for change
              </button>
            </div>
          </div>
        </div>
      )}

      <PriceChangeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        config={config}
        platformFee={profile.derivedPlatformFee}
        extraHeadroomPct={extraHeadroomPct}
        effectiveFactor={effectiveFactor}
        editedModels={editedSummaries}
      />
    </div>
  );
}
