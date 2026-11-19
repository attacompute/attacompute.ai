import { AlertTriangle, RefreshCw } from 'lucide-react';

export function SkeletonCard({ height = 140 }: { height?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Loading panel">
      <div className="skeleton" style={{ width: '36%', height: 14, marginBottom: 14 }} />
      <div className="skeleton" style={{ width: '100%', height: Math.max(48, height - 48) }} />
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="attention-item severity-warning" role="alert" style={{ marginBottom: 16 }}>
      <div className="attention-body">
        <AlertTriangle size={17} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <div>
          <div className="attention-title">Data notice</div>
          <div className="attention-detail">{message}</div>
        </div>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          <RefreshCw size={13} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p style={{ maxWidth: '46ch', fontSize: '0.84375rem' }}>{detail}</p>
    </div>
  );
}
