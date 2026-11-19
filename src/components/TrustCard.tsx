import { CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { TRUST_THRESHOLD } from '../config';
import { formatPercent } from '../lib/format';
import type { MergedSellerProfile } from '../types/antseed';

export function TrustCard({ profile }: { profile: MergedSellerProfile }) {
  const score = profile.reputation;
  const clamped = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const meetsGate = score != null && score >= TRUST_THRESHOLD;
  const gap = score != null ? Math.max(0, TRUST_THRESHOLD - score) : null;

  const trust = profile.trust;

  return (
    <article className="card" id="trust-panel">
      <div className="card-head">
        <div>
          <h2 className="card-title">Trust score vs {TRUST_THRESHOLD} buyer gate</h2>
          <p className="card-sub">
            AntSeed buyers require reputation ≥ {TRUST_THRESHOLD} by default
          </p>
        </div>
        {meetsGate ? (
          <span className="pill pill-good">
            <CheckCircle2 size={13} aria-hidden="true" />
            Above threshold
          </span>
        ) : (
          <span className="pill pill-warn">
            <ShieldAlert size={13} aria-hidden="true" />
            {gap != null ? `Needs +${gap.toFixed(1)} pts` : 'Unavailable'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div className="kpi-value" style={{ color: meetsGate ? 'var(--good)' : 'var(--warn)' }}>
          {score != null ? score.toFixed(1) : '—'}
          <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink-3)', marginLeft: 4 }}>
            / 100
          </span>
        </div>
        <div className="mono" style={{ fontSize: '0.78rem', color: 'var(--ink-3)' }}>
          {profile.pointsMultiplier != null && `Check multiplier ${profile.pointsMultiplier.toFixed(2)}×`}
          {profile.ghostRate != null && ` · Ghost rate ${formatPercent(profile.ghostRate, 2)}`}
        </div>
      </div>

      <div className="trust-gauge-wrap" style={{ marginTop: 26 }}>
        <span className="trust-threshold-label">Buyer gate · {TRUST_THRESHOLD}</span>
        <div
          className="trust-bar-track"
          role="progressbar"
          aria-label="Seller trust score"
          aria-valuenow={score != null ? Math.round(score) : 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`trust-bar-fill ${meetsGate ? 'above' : 'below'}`}
            style={{ width: `${clamped}%` }}
          />
          <div className="trust-threshold-mark" aria-hidden="true" />
        </div>
      </div>

      {trust ? (
        <div className="trust-parts-grid">
          <div className="trust-part">
            <div className="trust-part-head">
              <span className="trust-part-name">Power / Stake</span>
              <span className="trust-part-val">{trust.power ?? 0} / 70</span>
            </div>
            <div className="trust-part-note">On-chain USDC / staking weight (SDK 0.2.168)</div>
          </div>
          <div className="trust-part">
            <div className="trust-part-head">
              <span className="trust-part-name">Organic Usage</span>
              <span className="trust-part-val">{trust.usage ?? 0} / 30</span>
            </div>
            <div className="trust-part-note">Recent organic settled volume & distinct buyers</div>
          </div>
          <div className="trust-part">
            <div className="trust-part-head">
              <span className="trust-part-name">Identity Bonus</span>
              <span className="trust-part-val">+{trust.identity ?? 0} / 20</span>
            </div>
            <div className="trust-part-note">
              {trust.identity_kind ? `Verified (${trust.identity_kind})` : 'Domain / GitHub ownership proof'}
            </div>
          </div>
          <div className="trust-part">
            <div className="trust-part-head">
              <span className="trust-part-name">Free-Tier Bonus</span>
              <span className="trust-part-val">+{trust.free_models ?? 0} / 5</span>
            </div>
            <div className="trust-part-note">
              Announcing a free model adds +5 (capped at 100 × check multiplier)
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.8125rem',
              color: 'var(--ink-2)',
            }}
          >
            <Info size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <span>
              {profile.reputationSource === 'directory'
                ? 'Score sourced from the AntSeedStats sellers directory. Detailed component parts are currently null on /sellers/{address} while DHT announcement indexing catches up.'
                : 'AntSeedStats currently returns null for trust parts on this address. Component scores appear automatically once DHT announcements align.'}
            </span>
          </div>

          <div className="trust-parts-grid">
            <div className="trust-part">
              <div className="trust-part-head">
                <span className="trust-part-name">Power / Stake</span>
                <span className="trust-part-val">up to 70</span>
              </div>
              <div className="trust-part-note">Largest lever to cross 60 via stake & power</div>
            </div>
            <div className="trust-part">
              <div className="trust-part-head">
                <span className="trust-part-name">Organic Usage</span>
                <span className="trust-part-val">up to 30</span>
              </div>
              <div className="trust-part-note">
                {profile.settles} settles across {profile.buyers} distinct buyers
              </div>
            </div>
            <div className="trust-part">
              <div className="trust-part-head">
                <span className="trust-part-name">Verified Identity</span>
                <span className="trust-part-val">{profile.verified ? 'Verified ✓' : 'Unverified'}</span>
              </div>
              <div className="trust-part-note">
                {profile.verification.length > 0
                  ? profile.verification.map((v) => `${v.kind}: ${v.target}`).join(' · ')
                  : 'Domain & GitHub verification adds up to +20'}
              </div>
            </div>
            <div className="trust-part">
              <div className="trust-part-head">
                <span className="trust-part-name">Model Checks</span>
                <span className="trust-part-val">
                  {profile.pointsMultiplier != null ? `${profile.pointsMultiplier.toFixed(2)}×` : '—'}
                </span>
              </div>
              <div className="trust-part-note">
                {profile.liveChecksSame != null
                  ? `${profile.liveChecksSame} SAME · ${profile.liveChecksDiff ?? 0} DIFF live`
                  : 'SAME verdicts boost score multiplier'}
              </div>
            </div>
          </div>
        </>
      )}
    </article>
  );
}
