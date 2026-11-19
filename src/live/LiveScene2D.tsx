import { useMemo } from 'react';
import type { LiveTopology } from '../api/mappers';
import { formatMicroUsd } from '../lib/format';
import type { MergedSellerProfile } from '../types/antseed';

export interface LiveSceneProps {
  topology: LiveTopology;
  profile: MergedSellerProfile;
  theme: 'dark' | 'light';
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
}

export function LiveScene2D({
  topology,
  profile,
  selectedId,
  onSelect,
  reducedMotion,
}: LiveSceneProps) {
  const width = 920;
  const height = 500;
  const hubX = width / 2;
  const hubY = height / 2;

  const buyerPositions = useMemo(() => {
    const list = topology.buyers;
    if (list.length === 0) return [];
    const span = Math.min(340, Math.max(120, (list.length - 1) * 76));
    const startY = hubY - span / 2;
    return list.map((b, i) => {
      const y = list.length === 1 ? hubY : startY + (i / (list.length - 1)) * span;
      const arcOffset = Math.abs((y - hubY) / 180) * 34;
      return { node: b, x: 148 + arcOffset, y };
    });
  }, [topology.buyers, hubY]);

  const upstreamPositions = useMemo(() => {
    const list = topology.upstreams;
    const span = Math.min(360, Math.max(130, (list.length - 1) * 68));
    const startY = hubY - span / 2;
    return list.map((u, i) => {
      const y = list.length === 1 ? hubY : startY + (i / (list.length - 1)) * span;
      const arcOffset = Math.abs((y - hubY) / 180) * 34;
      return { node: u, x: width - 156 - arcOffset, y };
    });
  }, [topology.upstreams, hubY]);

  const hubSelected = selectedId === 'hub';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label={`Interactive network topology: ${topology.buyers.length} active buyers connected through ${profile.name} to direct upstream and ${Math.max(0, topology.upstreams.length - 1)} AntSeed fallback peers`}
    >
      <defs>
        <radialGradient id="hubGlow2d" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <style>{`
          .flow-dash {
            stroke-dasharray: 7 10;
            animation: ${reducedMotion ? 'none' : 'dash-flow 2.4s linear infinite'};
          }
          @keyframes dash-flow {
            from { stroke-dashoffset: 34; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      </defs>

      {/* Subtle architectural guide rings */}
      <circle cx={hubX} cy={hubY} r="135" fill="none" stroke="var(--border-subtle)" strokeDasharray="3 6" />
      <circle cx={hubX} cy={hubY} r="225" fill="none" stroke="var(--border-subtle)" opacity="0.55" />
      <circle cx={hubX} cy={hubY} r="94" fill="url(#hubGlow2d)" />

      {/* Column headers */}
      <text x="155" y="74" textAnchor="middle" fill="var(--ink-3)" fontSize="11" fontFamily="var(--font-mono)">
        BUYERS ({topology.buyers.length})
      </text>
      <text x={hubX} y="74" textAnchor="middle" fill="var(--accent)" fontSize="11" fontFamily="var(--font-mono)">
        SELLER HUB
      </text>
      <text x={width - 155} y="74" textAnchor="middle" fill="var(--ink-3)" fontSize="11" fontFamily="var(--font-mono)">
        UPSTREAM &amp; FALLBACK PEERS ({topology.upstreams.length})
      </text>

      {/* Buyer -> Hub links */}
      {buyerPositions.map(({ node, x, y }) => {
        const active = !selectedId || selectedId === node.id || hubSelected;
        const path = `M ${x + 18} ${y} C ${x + 140} ${y}, ${hubX - 135} ${hubY}, ${hubX - 42} ${hubY}`;
        return (
          <g key={`link-${node.id}`} opacity={active ? 1 : 0.22}>
            <path d={path} fill="none" stroke="var(--warn)" strokeOpacity="0.28" strokeWidth="2.4" />
            <path d={path} fill="none" stroke="var(--warn)" strokeWidth="2" className="flow-dash" />
          </g>
        );
      })}

      {/* Hub -> Upstream / Peer links */}
      {upstreamPositions.map(({ node, x, y }) => {
        const active = !selectedId || selectedId === node.id || hubSelected;
        const stroke = node.kind === 'direct' ? 'var(--accent)' : 'var(--good)';
        const path = `M ${hubX + 42} ${hubY} C ${hubX + 135} ${hubY}, ${x - 140} ${y}, ${x - 18} ${y}`;
        return (
          <g key={`link-${node.id}`} opacity={active ? 1 : 0.22}>
            <path d={path} fill="none" stroke={stroke} strokeOpacity="0.26" strokeWidth={node.kind === 'direct' ? 3 : 2} />
            <path d={path} fill="none" stroke={stroke} strokeWidth={node.kind === 'direct' ? 2.4 : 1.7} className="flow-dash" />
          </g>
        );
      })}

      {/* Buyer nodes */}
      {buyerPositions.length === 0 ? (
        <g>
          <circle cx="155" cy={hubY} r="16" fill="var(--bg-surface-2)" stroke="var(--border-strong)" strokeDasharray="3 3" />
          <text x="155" y={hubY + 34} textAnchor="middle" fill="var(--ink-3)" fontSize="11" fontFamily="var(--font-mono)">
            Quiet window · no recent buyer channels
          </text>
        </g>
      ) : (
        buyerPositions.map(({ node, x, y }) => {
          const isSel = selectedId === node.id;
          return (
            <g
              key={node.id}
              tabIndex={0}
              role="button"
              aria-label={`Buyer ${node.label}, settled ${formatMicroUsd(node.settledMicro)}`}
              onClick={() => onSelect(isSel ? null : node.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(isSel ? null : node.id);
                }
              }}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <circle
                cx={x}
                cy={y}
                r={isSel ? 17 : 14}
                fill="var(--bg-surface)"
                stroke="var(--warn)"
                strokeWidth={isSel ? 3 : 2}
              />
              <circle cx={x} cy={y} r="5" fill="var(--warn)" />
              <text x={x - 24} y={y - 2} textAnchor="end" fill="var(--ink-1)" fontSize="11.5" fontFamily="var(--font-mono)" fontWeight="600">
                {node.label}
              </text>
              <text x={x - 24} y={y + 13} textAnchor="end" fill="var(--ink-3)" fontSize="10.5" fontFamily="var(--font-mono)">
                {formatMicroUsd(node.settledMicro)} · {node.settles}s
              </text>
            </g>
          );
        })
      )}

      {/* Center Hub: attacompute.ai */}
      <g
        tabIndex={0}
        role="button"
        aria-label={`${profile.name} seller hub`}
        onClick={() => onSelect(hubSelected ? null : 'hub')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(hubSelected ? null : 'hub');
          }
        }}
        style={{ cursor: 'pointer', outline: 'none' }}
      >
        <circle
          cx={hubX}
          cy={hubY}
          r="46"
          fill="var(--bg-surface)"
          stroke={profile.live ? 'var(--good)' : 'var(--warn)'}
          strokeWidth={hubSelected ? 3.5 : 2.2}
        />
        <polygon
          points={`${hubX},${hubY - 22} ${hubX + 19},${hubY - 11} ${hubX + 19},${hubY + 11} ${hubX},${hubY + 22} ${hubX - 19},${hubY + 11} ${hubX - 19},${hubY - 11}`}
          fill="var(--accent-soft)"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        <circle cx={hubX} cy={hubY} r="5" fill="var(--accent)" />
        <text x={hubX} y={hubY + 66} textAnchor="middle" fill="var(--ink-1)" fontSize="13" fontFamily="var(--font-display)" fontWeight="650">
          {profile.name}
        </text>
        <text x={hubX} y={hubY + 82} textAnchor="middle" fill="var(--ink-3)" fontSize="10.5" fontFamily="var(--font-mono)">
          Agent #{profile.agentId} · {profile.live ? 'LIVE' : 'OFFLINE'}
        </text>
      </g>

      {/* Upstream & Peer nodes */}
      {upstreamPositions.map(({ node, x, y }) => {
        const isSel = selectedId === node.id;
        const isDirect = node.kind === 'direct';
        const stroke = isDirect ? 'var(--accent)' : 'var(--good)';
        return (
          <g
            key={node.id}
            tabIndex={0}
            role="button"
            aria-label={`${node.label}, backs ${node.backedModels.length} models`}
            onClick={() => onSelect(isSel ? null : node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(isSel ? null : node.id);
              }
            }}
            style={{ cursor: 'pointer', outline: 'none' }}
          >
            {isDirect ? (
              <rect
                x={x - 16}
                y={y - 16}
                width="32"
                height="32"
                rx="8"
                fill="var(--bg-surface)"
                stroke={stroke}
                strokeWidth={isSel ? 3 : 2.2}
              />
            ) : (
              <circle
                cx={x}
                cy={y}
                r={isSel ? 16 : 13}
                fill="var(--bg-surface)"
                stroke={stroke}
                strokeWidth={isSel ? 3 : 2}
              />
            )}
            <circle cx={x} cy={y} r="4.5" fill={stroke} />
            <text x={x + 24} y={y - 2} textAnchor="start" fill="var(--ink-1)" fontSize="11.5" fontFamily="var(--font-sans)" fontWeight="600">
              {node.label.slice(0, 18)}
            </text>
            <text x={x + 24} y={y + 13} textAnchor="start" fill="var(--ink-3)" fontSize="10.5" fontFamily="var(--font-mono)">
              {isDirect
                ? `Primary · ${node.backedModels.length} models`
                : `${node.backedModels.length} model${node.backedModels.length === 1 ? '' : 's'}${node.reputation != null ? ` · T${Math.round(node.reputation)}` : ''}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
