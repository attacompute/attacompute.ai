import { Box, Layers, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLiveTopology } from '../api/mappers';
import { EmptyState, ErrorBanner } from '../components/DataState';
import { POLL_INTERVAL_MS } from '../config';
import { useModelPeers } from '../hooks/useModelPeers';
import { useSellerData } from '../hooks/useSellerData';
import { useTheme } from '../hooks/useTheme';
import { formatCompact, formatMicroUsd, formatRelativeAge, shortAddress } from '../lib/format';
import { LiveScene2D } from '../live/LiveScene2D';
import { detectWebGLSupport, isLowPowerHeuristic, prefersReducedMotion } from '../live/webgl';
import type { ChannelItem, RequestEvent, TransactionEvent } from '../types/antseed';

const LiveScene3D = lazy(() => import('../live/LiveScene3D'));

export function LivePage() {
  const { client, config, profile, models } = useSellerData();
  const { resolved: theme } = useTheme();
  const advertised = useMemo(() => models?.advertised ?? [], [models]);
  const { marketByModel } = useModelPeers(advertised);

  const webglAvailable = useMemo(() => detectWebGLSupport(), []);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const lowPower = useMemo(() => isLowPowerHeuristic(), []);

  // Automatically select 3D when WebGL is supported and device isn't reduced-motion / low-power
  const [viewMode, setViewMode] = useState<'3d' | '2d'>(() =>
    webglAvailable && !reducedMotion && !lowPower ? '3d' : '2d',
  );
  const [webglLost, setWebglLost] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>('hub');

  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [requests, setRequests] = useState<RequestEvent[]>([]);
  const [transactions, setTransactions] = useState<TransactionEvent[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyLiveFeeds = useCallback(
    (
      chRes: PromiseSettledResult<{ data: { channels: ChannelItem[] } }>,
      reqRes: PromiseSettledResult<{ data: { events: RequestEvent[] } }>,
      txRes: PromiseSettledResult<{ data: { events: TransactionEvent[] } }>,
    ) => {
      let hadError = false;
      if (chRes.status === 'fulfilled') setChannels(chRes.value.data.channels);
      else hadError = true;

      if (reqRes.status === 'fulfilled') setRequests(reqRes.value.data.events);
      else hadError = true;

      if (txRes.status === 'fulfilled') setTransactions(txRes.value.data.events);
      else hadError = true;

      setFeedError(
        hadError ? 'Some live public feeds could not refresh; showing latest cached snapshot.' : null,
      );
      setFeedLoading(false);
    },
    [],
  );

  const loadLiveFeeds = useCallback(
    async (force = false) => {
      const [chRes, reqRes, txRes] = await Promise.allSettled([
        client.getChannels(force),
        client.getRequests(force),
        client.getSettlements(force),
      ]);
      if (!mountedRef.current) return;
      applyLiveFeeds(chRes, reqRes, txRes);
    },
    [client, applyLiveFeeds],
  );

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void Promise.allSettled([
        client.getChannels(false),
        client.getRequests(false),
        client.getSettlements(false),
      ]).then(([chRes, reqRes, txRes]) => {
        if (!cancelled) applyLiveFeeds(chRes, reqRes, txRes);
      });
    };

    poll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client, applyLiveFeeds]);

  const topology = useMemo(
    () =>
      buildLiveTopology({
        sellerAddress: config.sellerAddressLower,
        ownAddresses: config.ownAddresses,
        channels,
        requests,
        transactions,
        models,
        marketByModel,
        platformFee: profile.derivedPlatformFee,
      }),
    [
      config.sellerAddressLower,
      config.ownAddresses,
      channels,
      requests,
      transactions,
      models,
      marketByModel,
      profile.derivedPlatformFee,
    ],
  );

  const selectedDetail = useMemo(() => {
    if (!selectedId || selectedId === 'hub') {
      return {
        kind: 'hub' as const,
        title: profile.name,
        subtitle: `ERC-8004 Agent #${profile.agentId} · ${shortAddress(config.sellerAddress)}`,
        metrics: [
          ['Status', profile.live ? 'Live on DHT' : 'Not live on DHT'],
          ['7d Settled', formatMicroUsd(profile.revenue7dMicro)],
          ['Trust score', profile.reputation != null ? `${profile.reputation.toFixed(1)} / 100` : '—'],
          ['Advertised', `${advertised.length} models`],
        ],
        tags: profile.verified ? ['Verified owner'] : [],
      };
    }

    const buyer = topology.buyers.find((b) => b.id === selectedId);
    if (buyer) {
      return {
        kind: 'buyer' as const,
        title: `Buyer ${buyer.label}`,
        subtitle: buyer.address,
        metrics: [
          ['Settled', formatMicroUsd(buyer.settledMicro)],
          ['Channels', String(buyer.channels)],
          ['Settles', String(buyer.settles)],
          ['Last seen', formatRelativeAge(buyer.lastActivityTs)],
        ],
        tags: buyer.models,
      };
    }

    const upstream = topology.upstreams.find((u) => u.id === selectedId);
    if (upstream) {
      return {
        kind: upstream.kind,
        title: upstream.label,
        subtitle:
          upstream.kind === 'direct'
            ? 'Primary direct inference capacity'
            : `AntSeed fallback peer · ${shortAddress(upstream.address)}`,
        metrics: [
          ['Models backed', String(upstream.backedModels.length)],
          ['Trust score', upstream.reputation != null ? upstream.reputation.toFixed(1) : 'Primary'],
          ['Health', upstream.health ?? 'Not reported'],
          ['Status', upstream.live ? 'Live' : 'Offline'],
        ],
        tags: upstream.backedModels.slice(0, 6),
      };
    }

    return null;
  }, [selectedId, profile, config.sellerAddress, advertised.length, topology]);

  const handleContextLost = useCallback(() => {
    setWebglLost(true);
    setViewMode('2d');
  }, []);

  const show3D = viewMode === '3d' && webglAvailable && !webglLost;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Live Public Topology</div>
          <h1 className="page-title">Buyers → {profile.name} → Upstreams &amp; Peers</h1>
          <p className="page-subtitle">
            Real-time public channels, settlements, and eligible AntSeed fallback peers. Drag to
            orbit, scroll to zoom, or select any node to inspect its links.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <div className="seg-group" role="group" aria-label="Visualization renderer">
            <button
              type="button"
              className="seg-btn"
              aria-pressed={show3D}
              disabled={!webglAvailable || webglLost}
              onClick={() => setViewMode('3d')}
              title={
                !webglAvailable
                  ? 'WebGL is unavailable on this browser'
                  : 'Interactive 3D WebGL view'
              }
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Box size={13} aria-hidden="true" />
                3D WebGL
              </span>
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={!show3D}
              onClick={() => setViewMode('2d')}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Layers size={13} aria-hidden="true" />
                2D Diagram
              </span>
            </button>
          </div>

          {show3D && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setResetSignal((n) => n + 1)}
              title="Reset 3D camera"
            >
              <RotateCcw size={13} aria-hidden="true" />
              Reset camera
            </button>
          )}

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void loadLiveFeeds(true)}
            title="Refresh channels & requests"
          >
            <RefreshCw size={13} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {feedError && <ErrorBanner message={feedError} onRetry={() => void loadLiveFeeds(true)} />}

      <div className="live-layout">
        <section className="live-stage-card" aria-label="Live network topology stage">
          <div className="live-overlay-top">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span className="pill">
                Buyers: <strong className="mono">{topology.buyers.length}</strong>
              </span>
              <span className="pill">
                Fallback peers:{' '}
                <strong className="mono">{Math.max(0, topology.upstreams.length - 1)}</strong>
              </span>
              <span className="pill">
                Recent events: <strong className="mono">{topology.events.length}</strong>
              </span>
            </div>

            {(!webglAvailable || webglLost || reducedMotion) && (
              <span className="pill pill-accent">
                {!webglAvailable || webglLost
                  ? '2D fallback active (WebGL unavailable)'
                  : 'Reduced motion respected'}
              </span>
            )}
          </div>

          <div className="live-canvas-wrap">
            {show3D ? (
              <Suspense
                fallback={
                  <LiveScene2D
                    topology={topology}
                    profile={profile}
                    theme={theme}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    reducedMotion={reducedMotion}
                  />
                }
              >
                <LiveScene3D
                  topology={topology}
                  profile={profile}
                  theme={theme}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  reducedMotion={reducedMotion}
                  resetSignal={resetSignal}
                  onContextLost={handleContextLost}
                />
              </Suspense>
            ) : (
              <LiveScene2D
                topology={topology}
                profile={profile}
                theme={theme}
                selectedId={selectedId}
                onSelect={setSelectedId}
                reducedMotion={reducedMotion}
              />
            )}
          </div>

          <div className="live-legend" aria-label="Visualization legend">
            <div className="legend-items">
              <span className="legend-dot">
                <span className="legend-swatch" style={{ background: 'var(--warn)' }} />
                Active buyers
              </span>
              <span className="legend-dot">
                <span className="legend-swatch" style={{ background: 'var(--accent)' }} />
                {profile.name} &amp; Direct upstream
              </span>
              <span className="legend-dot">
                <span className="legend-swatch" style={{ background: 'var(--good)' }} />
                Eligible AntSeed fallback peers
              </span>
            </div>
            <span className="mono" style={{ color: 'var(--ink-3)' }}>
              {show3D ? 'Drag to orbit · Scroll to zoom · Click node' : 'Click or Tab + Enter on any node'}
            </span>
          </div>
        </section>

        {/* Right Sidebar: Keyboard-Accessible Inspector + Activity Feed */}
        <aside className="live-sidebar" aria-label="Node inspector and activity feed">
          <article className="card">
            <div className="card-head" style={{ marginBottom: 12 }}>
              <div>
                <h2 className="card-title">{selectedDetail?.title ?? profile.name}</h2>
                <p className="card-sub mono" style={{ fontSize: '0.74rem' }}>
                  {selectedDetail?.subtitle}
                </p>
              </div>
              {selectedDetail?.kind === 'hub' && profile.verified && (
                <ShieldCheck size={17} style={{ color: 'var(--accent)' }} aria-hidden="true" />
              )}
            </div>

            {selectedDetail && (
              <>
                <div className="trust-parts-grid" style={{ marginTop: 0 }}>
                  {selectedDetail.metrics.map(([k, v]) => (
                    <div key={k} className="trust-part">
                      <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>{k}</div>
                      <div className="mono" style={{ fontSize: '0.88rem', fontWeight: 600, marginTop: 2 }}>
                        {v}
                      </div>
                    </div>
                  ))}
                </div>

                {selectedDetail.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
                    {selectedDetail.tags.map((t) => (
                      <span key={t} className="pill" style={{ padding: '2px 8px' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Quick keyboard node selector */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)', marginBottom: 8 }}>
                Focus node
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <button
                  type="button"
                  className={`btn btn-sm${selectedId === 'hub' ? ' btn-primary' : ''}`}
                  onClick={() => setSelectedId('hub')}
                >
                  {profile.name}
                </button>
                {topology.buyers.slice(0, 4).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`btn btn-sm${selectedId === b.id ? ' btn-primary' : ''}`}
                    onClick={() => setSelectedId(b.id)}
                  >
                    {b.label}
                  </button>
                ))}
                {topology.upstreams.slice(0, 4).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`btn btn-sm${selectedId === u.id ? ' btn-primary' : ''}`}
                    onClick={() => setSelectedId(u.id)}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
            </div>
          </article>

          <article className="card">
            <div className="card-head" style={{ marginBottom: 12 }}>
              <div>
                <h2 className="card-title">Recent public activity</h2>
                <p className="card-sub">Filtered for {shortAddress(config.sellerAddress)}</p>
              </div>
            </div>

            {feedLoading ? (
              <div className="skeleton" style={{ height: 140 }} />
            ) : topology.events.length === 0 ? (
              <EmptyState
                title="Quiet public window"
                detail="No channels or request settlements for this seller appeared in the latest 200 global AntSeedStats events."
              />
            ) : (
              <div className="activity-feed">
                {topology.events.map((ev) => (
                  <div key={ev.id} className="activity-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontSize: '0.82rem' }}>{ev.modelDisplay}</strong>
                      <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                        {ev.free ? 'Free' : formatMicroUsd(ev.settledMicro)}
                      </span>
                    </div>
                    <div
                      className="mono"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.73rem',
                        color: 'var(--ink-3)',
                      }}
                    >
                      <span>
                        {ev.kind.toUpperCase()} · {shortAddress(ev.buyer)}
                        {ev.tokens > 0 ? ` · ${formatCompact(ev.tokens)} tok` : ''}
                      </span>
                      <span>{formatRelativeAge(ev.ts)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </aside>
      </div>
    </div>
  );
}
