import { useMemo, useState } from 'react';
import { formatMicroUsd, formatShortDate, microToUsd } from '../lib/format';
import type { DailyPoint } from '../types/antseed';

export function MiniSparkline({ days }: { days: DailyPoint[] }) {
  const points = useMemo(() => {
    const slice = days.slice(-14);
    if (slice.length < 2) return null;
    const vals = slice.map((d) => microToUsd(d.settled_micro));
    const max = Math.max(...vals, 0.01);
    const w = 84;
    const h = 24;
    const coords = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - 3 - (v / max) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { polyline: coords.join(' '), area: `0,${h} ${coords.join(' ')} ${w},${h}` };
  }, [days]);

  if (!points) return null;

  return (
    <svg width="84" height="24" viewBox="0 0 84 24" aria-hidden="true" focusable="false">
      <polygon points={points.area} fill="var(--accent-soft)" />
      <polyline
        points={points.polyline}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RevenueChart({ days }: { days: DailyPoint[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const series = useMemo(() => {
    if (days.length === 0) return [];
    // Show up to last 30 days; if fewer than 7 days exist, pad leading zero context days?
    // Keep actual indexed UTC days clearly labelled so we never fabricate missing history.
    return days.slice(-30);
  }, [days]);

  if (series.length === 0) {
    return (
      <div className="empty-state">
        <strong>No daily settlements indexed yet</strong>
        <p style={{ fontSize: '0.84375rem' }}>
          Settled USDC per UTC day will appear here once AntSeedStats indexes on-chain settlements.
        </p>
      </div>
    );
  }

  const maxUsd = Math.max(...series.map((d) => microToUsd(d.settled_micro)), 1);
  const svgW = 640;
  const svgH = 200;
  const padLeft = 48;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 30;
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;

  const slotW = plotW / Math.max(series.length, 1);
  const barW = Math.min(44, Math.max(8, slotW * 0.62));
  const hovered = activeIdx != null ? series[activeIdx] ?? null : series[series.length - 1] ?? null;

  const ticks = [0, 0.5, 1].map((ratio) => ({
    ratio,
    y: padTop + plotH * (1 - ratio),
    label: `$${(maxUsd * ratio).toFixed(maxUsd >= 100 ? 0 : 1)}`,
  }));

  return (
    <div className="chart-box">
      <div className="chart-tooltip" aria-live="polite">
        {hovered && (
          <>
            <strong className="mono" style={{ color: 'var(--ink-1)' }}>
              {formatShortDate(hovered.day)} (UTC)
            </strong>
            <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
              {formatMicroUsd(hovered.settled_micro)} settled
            </span>
            <span>
              {hovered.settles} settle{hovered.settles === 1 ? '' : 's'}
            </span>
            <span>
              {hovered.buyers} buyer{hovered.buyers === 1 ? '' : 's'}
            </span>
            <span className="mono" style={{ color: 'var(--ink-3)' }}>
              Fees {formatMicroUsd(hovered.fees_micro)}
            </span>
          </>
        )}
      </div>

      <svg
        className="chart-svg"
        viewBox={`0 0 ${svgW} ${svgH}`}
        role="img"
        aria-label={`Daily settled USDC chart covering ${series.length} UTC day${series.length === 1 ? '' : 's'}`}
      >
        <defs>
          <linearGradient id="revBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-bar)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--chart-bar)" stopOpacity="0.38" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t.ratio}>
            <line
              x1={padLeft}
              x2={svgW - padRight}
              y1={t.y}
              y2={t.y}
              stroke="var(--chart-grid)"
              strokeDasharray={t.ratio === 0 ? undefined : '3 4'}
            />
            <text
              x={padLeft - 8}
              y={t.y + 4}
              textAnchor="end"
              fill="var(--ink-3)"
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              {t.label}
            </text>
          </g>
        ))}

        {series.map((d, i) => {
          const usd = microToUsd(d.settled_micro);
          const barH = Math.max(3, (usd / maxUsd) * plotH);
          const cx = padLeft + i * slotW + slotW / 2;
          const x = cx - barW / 2;
          const y = padTop + plotH - barH;
          const isSelected = activeIdx === i || (activeIdx === null && i === series.length - 1);
          const showLabel =
            series.length <= 8 || i === 0 || i === series.length - 1 || i % Math.ceil(series.length / 6) === 0;

          return (
            <g
              key={d.day}
              tabIndex={0}
              role="button"
              aria-label={`${d.day}: ${formatMicroUsd(d.settled_micro)} across ${d.settles} settlements`}
              onMouseEnter={() => setActiveIdx(i)}
              onFocus={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
              onBlur={() => setActiveIdx(null)}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx="4"
                fill={isSelected ? 'var(--chart-bar)' : 'url(#revBarGrad)'}
                opacity={isSelected ? 1 : 0.78}
              />
              {showLabel && (
                <text
                  x={cx}
                  y={svgH - 8}
                  textAnchor="middle"
                  fill={isSelected ? 'var(--ink-1)' : 'var(--ink-3)'}
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                >
                  {formatShortDate(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
