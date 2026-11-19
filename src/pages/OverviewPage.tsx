import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorBanner, SkeletonCard } from '../components/DataState';
import { MiniSparkline, RevenueChart } from '../components/RevenueChart';
import { TrustCard } from '../components/TrustCard';
import { TRUST_THRESHOLD } from '../config';
import { useSellerData } from '../hooks/useSellerData';
import {
  formatBlockLag,
  formatCompact,
  formatMicroUsd,
  formatPercent,
  formatRelativeAge,
  formatSignedPct,
  shortAddress,
} from '../lib/format';

type RevenueWindow = 'today' | '7d' | '30d';

export function OverviewPage() {
  const {
    config,
    loading,
    error,
    profile,
    models,
    daily,
    checks,
    status,
    health,
    metadata,
    attentionItems,
    refresh,
  } = useSellerData();

  const [revWindow, setRevWindow] = useState<RevenueWindow>('today');
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);

  const revenueDisplay = useMemo(() => {
    if (revWindow === 'today') {
      const prev = profile.revenuePrev24hMicro;
      const cur = profile.revenueTodayMicro || profile.revenue24hMicro;
      const deltaPct = prev && prev > 0 ? ((profile.revenue24hMicro - prev) / prev) * 100 : null;
      return {
        label: 'Today (UTC)',
        micro: cur,
        sub:
          deltaPct != null
            ? `${formatSignedPct(deltaPct)} vs prev 24h`
            : `24h rolling: ${formatMicroUsd(profile.revenue24hMicro)}`,
      };
    }
    if (revWindow === '7d') {
      const prev = profile.revenuePrev7dMicro;
      const deltaPct = prev > 0 ? ((profile.revenue7dMicro - prev) / prev) * 100 : null;
      return {
        label: 'Last 7 days',
        micro: profile.revenue7dMicro,
        sub:
          deltaPct != null
            ? `${formatSignedPct(deltaPct)} vs prev 7d`
            : `${formatMicroUsd(profile.revenueLifetimeMicro)} lifetime`,
      };
    }
    const prev = profile.revenuePrev30dMicro;
    const deltaPct = prev && prev > 0 ? ((profile.revenue30dMicro - prev) / prev) * 100 : null;
    return {
      label: 'Last 30 days',
      micro: profile.revenue30dMicro,
      sub:
        deltaPct != null
          ? `${formatSignedPct(deltaPct)} vs prev 30d`
          : `Platform fee ${formatPercent(profile.derivedPlatformFee, 1)}`,
    };
  }, [profile, revWindow]);

  const topSoldModels = useMemo(() => {
    const sold = [...(models?.sold ?? [])].sort((a, b) => b.settled_micro - a.settled_micro);
    const total = sold.reduce((s, m) => s + m.settled_micro, 0) || 1;
    return sold.map((m) => ({
      ...m,
      share: m.settled_micro / total,
    }));
  }, [models]);

  const visibleSold = showAllModels ? topSoldModels : topSoldModels.slice(0, 6);

  const healthSummary = useMemo(() => {
    const adv = models?.advertised ?? [];
    const healthy = adv.filter((m) => m.health === 'healthy').length;
    const failing = adv.filter((m) => m.health === 'failing').length;
    const unreported = adv.length - healthy - failing;
    const netFailing = (health?.failing_services ?? []).filter(
      (f) => f.seller.toLowerCase() === profile.address.toLowerCase(),
    ).length;
    return {
      total: adv.length,
      healthy,
      failing: Math.max(failing, netFailing),
      unreported,
    };
  }, [models, health, profile.address]);

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(config.sellerAddress);
      setCopiedAddr(true);
      window.setTimeout(() => setCopiedAddr(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  }

  if (loading && !models && !daily) {
    return (
      <div>
        <div className="page-header">
          <div>
            <div className="page-eyebrow">Seller Overview</div>
            <h1 className="page-title">{config.sellerName}</h1>
          </div>
        </div>
        <div className="kpi-grid">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonCard key={i} height={116} />
          ))}
        </div>
        <div className="bento-grid">
          <div className="col-7">
            <SkeletonCard height={260} />
          </div>
          <div className="col-5">
            <SkeletonCard height={260} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">AntSeed Marketplace Seller</div>
          <h1 className="page-title">{profile.name}</h1>
          <p className="page-subtitle">
            Focused live status, settled revenue, trust standing, and verification checks from public
            on-chain telemetry.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Link to="/dashboard/pricing" className="btn">
            Adjust prices
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link to="/dashboard/live" className="btn btn-primary">
            Open 3D live flow
          </Link>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void refresh(true)} />}

      {/* Compact Identity & Live Status Strip */}
      <section className="identity-strip" aria-label="Seller identity and live status">
        <div className="identity-group">
          <span className={`pill ${profile.live ? 'pill-good' : 'pill-bad'}`}>
            <span className={`status-dot${profile.live ? ' pulse' : ''}`} aria-hidden="true" />
            {profile.live ? 'Listing live on DHT' : 'Not live on DHT'}
          </span>

          <span className="pill">
            <span className="mono">Agent #{profile.agentId}</span>
          </span>

          <button
            type="button"
            className="copy-chip"
            onClick={() => void handleCopyAddress()}
            title="Copy seller wallet address"
          >
            <span>{shortAddress(config.sellerAddress)}</span>
            {copiedAddr ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          </button>

          {profile.verified && (
            <span className="pill pill-accent">
              <ShieldCheck size={13} aria-hidden="true" />
              Verified owner
            </span>
          )}

          {profile.teeAdvertised && <span className="pill">TEE advertised</span>}

          {metadata && (
            <span className="pill">
              Load {metadata.currentLoad}/{metadata.maxConcurrency}
            </span>
          )}
        </div>

        <div className="identity-group" style={{ fontSize: '0.8125rem', color: 'var(--ink-2)' }}>
          <span>
            Last settle:{' '}
            <strong className="mono" style={{ color: 'var(--ink-1)' }}>
              {formatRelativeAge(profile.lastSettleTs)}
            </strong>
          </span>
          <span aria-hidden="true" style={{ color: 'var(--border-strong)' }}>
            ·
          </span>
          <span>
            Indexer:{' '}
            <strong
              className="mono"
              style={{
                color:
                  status?.overall === 'ok'
                    ? 'var(--good)'
                    : status?.overall === 'down'
                      ? 'var(--bad)'
                      : 'var(--warn)',
              }}
            >
              {status ? `${status.overall.toUpperCase()} · ${formatBlockLag(status.lag_blocks)}` : '—'}
            </strong>
          </span>
        </div>
      </section>

      {/* Derived Needs Attention Strip */}
      <section aria-label="Needs attention" style={{ marginBottom: 20 }}>
        {attentionItems.length === 0 ? (
          <div className="attention-item" style={{ borderColor: 'var(--good-border)' }}>
            <div className="attention-body">
              <CheckCircle2 size={17} style={{ color: 'var(--good)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
              <div>
                <div className="attention-title">All clear</div>
                <div className="attention-detail">
                  Listing is live, trust meets the {TRUST_THRESHOLD} buyer gate, and no services are failing.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="attention-list">
            {attentionItems.map((item) => {
              const Icon =
                item.severity === 'critical'
                  ? AlertCircle
                  : item.severity === 'warning'
                    ? AlertTriangle
                    : Info;
              const iconColor =
                item.severity === 'critical'
                  ? 'var(--bad)'
                  : item.severity === 'warning'
                    ? 'var(--warn)'
                    : 'var(--accent)';
              return (
                <div key={item.id} className={`attention-item severity-${item.severity}`}>
                  <div className="attention-body">
                    <Icon size={17} style={{ color: iconColor, flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                    <div>
                      <div className="attention-title">{item.title}</div>
                      <div className="attention-detail">{item.detail}</div>
                    </div>
                  </div>
                  {item.actionLabel && item.actionTo && (
                    item.actionTo.startsWith('#') ? (
                      <a href={item.actionTo} className="btn btn-sm">
                        {item.actionLabel}
                      </a>
                    ) : (
                      <Link to={item.actionTo} className="btn btn-sm">
                        {item.actionLabel}
                      </Link>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5 Primary Hero KPIs */}
      <section className="kpi-grid" aria-label="Key metrics">
        <article className="kpi-card kpi-featured">
          <div className="kpi-top">
            <span className="kpi-label" style={{ whiteSpace: 'nowrap' }}>Revenue</span>
            <div className="seg-group" role="group" aria-label="Revenue window">
              {(['today', '7d', '30d'] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  className="seg-btn"
                  aria-pressed={revWindow === w}
                  onClick={() => setRevWindow(w)}
                >
                  {w === 'today' ? 'Today' : w}
                </button>
              ))}
            </div>
          </div>
          <div className="kpi-value">{formatMicroUsd(revenueDisplay.micro)}</div>
          <div className="kpi-foot">
            <span>{revenueDisplay.sub}</span>
            <MiniSparkline days={daily?.days ?? []} />
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Trust score</span>
            <span
              className={`pill ${
                profile.reputation != null && profile.reputation >= TRUST_THRESHOLD
                  ? 'pill-good'
                  : 'pill-warn'
              }`}
              style={{ padding: '2px 8px' }}
            >
              gate {TRUST_THRESHOLD}
            </span>
          </div>
          <div className="kpi-value">
            {profile.reputation != null ? profile.reputation.toFixed(1) : '—'}
          </div>
          <div className="kpi-foot">
            <span>
              {profile.reputation != null && profile.reputation < TRUST_THRESHOLD
                ? `${(TRUST_THRESHOLD - profile.reputation).toFixed(1)} pts below buyer default`
                : profile.reputation != null
                  ? 'Meets default buyer routing'
                  : 'Score currently null'}
            </span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Active buyers &amp; channels</span>
            {profile.rank != null && (
              <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                Rank #{profile.rank}
              </span>
            )}
          </div>
          <div className="kpi-value">
            {profile.buyers}
            <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--ink-3)', marginLeft: 6 }}>
              buyers
            </span>
          </div>
          <div className="kpi-foot">
            <span className="mono">
              {profile.channels} channels · {profile.settles} settles
            </span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Requests &amp; tokens</span>
            <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
              {models?.advertised.length ?? 0} models
            </span>
          </div>
          <div className="kpi-value">{formatCompact(profile.requests)}</div>
          <div className="kpi-foot">
            <span className="mono">
              {profile.tokens != null ? `${formatCompact(profile.tokens)} tokens` : 'Tokens unavailable'}
            </span>
            {profile.tokens24h != null && profile.tokens24h > 0 && (
              <span className="mono">{formatCompact(profile.tokens24h)} / 24h</span>
            )}
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Model-check verdicts</span>
            {profile.pointsMultiplier != null && (
              <span className="pill pill-accent" style={{ padding: '2px 8px' }}>
                <Sparkles size={11} aria-hidden="true" />
                {profile.pointsMultiplier.toFixed(2)}×
              </span>
            )}
          </div>
          <div className="kpi-value">
            {profile.liveChecksSame != null ? (
              <>
                <span style={{ color: 'var(--good)' }}>{profile.liveChecksSame}</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--ink-3)', marginLeft: 5 }}>
                  SAME
                </span>
              </>
            ) : (
              '—'
            )}
          </div>
          <div className="kpi-foot">
            <span className="mono">
              {profile.liveChecksDiff != null ? `${profile.liveChecksDiff} DIFF` : 'No live audit'}
              {checks?.epoch != null ? ` · Epoch ${checks.epoch}` : ''}
            </span>
          </div>
        </article>
      </section>

      {/* Secondary Focused Bento Grid */}
      <section className="bento-grid" aria-label="Detailed telemetry">
        <article className="card col-7">
          <div className="card-head">
            <div>
              <h2 className="card-title">Settled revenue · daily UTC</h2>
              <p className="card-sub">
                Gross on-chain channel settlements from AntSeedStats
              </p>
            </div>
            <div className="mono" style={{ fontSize: '0.78rem', color: 'var(--ink-2)', textAlign: 'right' }}>
              <div>Lifetime {formatMicroUsd(profile.revenueLifetimeMicro)}</div>
              <div style={{ color: 'var(--ink-3)' }}>
                Est. fee {formatPercent(profile.derivedPlatformFee, 1)} ({formatMicroUsd(profile.feesMicro)})
              </div>
            </div>
          </div>
          <RevenueChart days={daily?.days ?? []} />
        </article>

        <div className="col-5">
          <TrustCard profile={profile} />
        </div>

        <article className="card col-6">
          <div className="card-head">
            <div>
              <h2 className="card-title">Top models by settled revenue</h2>
              <p className="card-sub">
                Decoded per-model settlements (buyer opt-in lower bound)
              </p>
            </div>
            <Link to="/dashboard/pricing" className="btn btn-sm">
              Pricing workbench
            </Link>
          </div>

          {topSoldModels.length === 0 ? (
            <EmptyState
              title="No per-model sales recorded yet"
              detail="Per-model revenue breakdowns appear as buyers settle channels with usage metadata."
            />
          ) : (
            <>
              <div className="model-bar-list">
                {visibleSold.map((m) => (
                  <div key={m.model} className="model-bar-row">
                    <div className="model-bar-meta">
                      <Link
                        to={`/dashboard/pricing?model=${encodeURIComponent(m.model)}`}
                        className="model-bar-name"
                        title={`Tune pricing for ${m.model_display}`}
                      >
                        {m.model_display}
                      </Link>
                      <div className="model-bar-stats">
                        <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>
                          {formatMicroUsd(m.settled_micro)}
                        </span>
                        <span>{formatCompact(m.requests)} req</span>
                        <span className="hide-mobile">{formatCompact(m.tokens)} tok</span>
                      </div>
                    </div>
                    <div className="model-bar-track" aria-hidden="true">
                      <div
                        className="model-bar-fill"
                        style={{ width: `${Math.max(4, Math.round(m.share * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {topSoldModels.length > 6 && (
                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setShowAllModels((v) => !v)}
                  >
                    {showAllModels
                      ? 'Show top 6'
                      : `Show all ${topSoldModels.length} models`}
                  </button>
                </div>
              )}
            </>
          )}
        </article>

        <article className="card col-6" id="checks-panel">
          <div className="card-head">
            <div>
              <h2 className="card-title">Model-check verdicts &amp; service health</h2>
              <p className="card-sub">
                On-chain auditor proofs and advertised probe status
              </p>
            </div>
            <span
              className={`pill ${healthSummary.failing > 0 ? 'pill-bad' : 'pill-good'}`}
            >
              {healthSummary.failing > 0
                ? `${healthSummary.failing} failing`
                : `${healthSummary.total} advertised · 0 failing`}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 14,
              fontSize: '0.8125rem',
            }}
          >
            <span className="pill">
              Healthy reported: <strong className="mono">{healthSummary.healthy}</strong>
            </span>
            <span className="pill">
              Not reported: <strong className="mono">{healthSummary.unreported}</strong>
            </span>
            {checks?.evidence_missing != null && checks.evidence_missing > 0 && (
              <span className="pill pill-accent">
                {checks.evidence_missing} on-chain verdict{checks.evidence_missing === 1 ? '' : 's'} without IPFS detail
              </span>
            )}
          </div>

          {!checks || checks.models.length === 0 ? (
            <EmptyState
              title="No detailed audit records published yet"
              detail="When approved auditors publish verifiable IPFS evidence for this seller, each service verdict appears here."
            />
          ) : (
            <div className="check-list">
              {checks.models.map((rec) => {
                const isSame = rec.verdict === 'SAME';
                const isDiff = rec.verdict === 'DIFF';
                return (
                  <div key={`${rec.service}:${rec.epoch}`} className="check-row">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: '0.9rem' }}>
                          {rec.model_display ?? rec.service}
                        </strong>
                        <span
                          className={`pill ${isSame ? 'pill-good' : isDiff ? 'pill-bad' : 'pill-warn'}`}
                          style={{ padding: '1px 8px' }}
                        >
                          {rec.verdict}
                        </span>
                        {rec.counts_now && (
                          <span className="pill pill-accent" style={{ padding: '1px 8px' }}>
                            Active
                          </span>
                        )}
                      </div>
                      <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--ink-3)', marginTop: 4 }}>
                        Epoch {rec.epoch}
                        {rec.valid_until_epoch != null ? ` → valid through ${rec.valid_until_epoch}` : ''}
                        {rec.diffs != null && rec.total != null ? ` · ${rec.diffs}/${rec.total} diffs` : ''}
                        {rec.audited_ts != null ? ` · ${formatRelativeAge(rec.audited_ts)}` : ''}
                      </div>
                    </div>

                    {rec.proof_url && (
                      <a
                        href={rec.proof_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm btn-ghost"
                      >
                        Proof
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
