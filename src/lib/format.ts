export function microToUsd(micro: number | null | undefined): number {
  if (micro == null || !Number.isFinite(micro)) return 0;
  return micro / 1_000_000;
}

export function formatUsd(usd: number | null | undefined, digits = 2): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(usd);
}

export function formatMicroUsd(micro: number | null | undefined, digits = 2): string {
  if (micro == null || !Number.isFinite(micro)) return '—';
  return formatUsd(microToUsd(micro), digits);
}

export function formatPricePerM(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  if (value >= 100) return `$${value.toFixed(2)}`;
  if (value >= 10) return `$${value.toFixed(2)}`;
  if (value >= 1) return `$${value.toFixed(3).replace(/0$/, '')}`;
  if (value >= 0.01) return `$${value.toFixed(4).replace(/0{1,2}$/, '')}`;
  return `$${value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1000) return Math.round(value).toLocaleString('en-US');
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(value);
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatSignedPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function shortAddress(address: string | null | undefined, prefix = 6, suffix = 4): string {
  if (!address) return '—';
  if (address.length <= prefix + suffix + 2) return address;
  return `${address.slice(0, prefix)}…${address.slice(-suffix)}`;
}

export function formatRelativeAge(unixSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return 'unknown';
  const deltaSec = Math.max(0, Math.round(nowMs / 1000 - unixSeconds));
  if (deltaSec < 45) return `${deltaSec}s ago`;
  const mins = Math.round(deltaSec / 60);
  if (mins < 90) return `${mins}m ago`;
  const hours = deltaSec / 3600;
  if (hours < 36) return `${hours.toFixed(1)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatBlockLag(lagBlocks: number | null | undefined): string {
  if (lagBlocks == null || !Number.isFinite(lagBlocks)) return 'unknown lag';
  return `${lagBlocks.toLocaleString()} blocks behind`;
}

export function formatShortDate(isoDay: string): string {
  const parts = isoDay.split('-');
  if (parts.length !== 3) return isoDay;
  const monthIdx = Number(parts[1]) - 1;
  const dayNum = Number(parts[2]);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[monthIdx];
  return month ? `${month} ${dayNum}` : isoDay;
}
