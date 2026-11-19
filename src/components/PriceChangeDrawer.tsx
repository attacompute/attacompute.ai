import { Check, Copy, Download, ExternalLink, Send, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig } from '../config';
import {
  buildGitHubIssueLink,
  buildPriceChangePayload,
  type EditedModelSummary,
} from '../lib/changeRequest';
import { formatPricePerM, formatSignedPct } from '../lib/format';

interface PriceChangeDrawerProps {
  open: boolean;
  onClose: () => void;
  config: AppConfig;
  platformFee: number;
  extraHeadroomPct: number;
  effectiveFactor: number;
  editedModels: EditedModelSummary[];
}

export function PriceChangeDrawer({
  open,
  onClose,
  config,
  platformFee,
  extraHeadroomPct,
  effectiveFactor,
  editedModels,
}: PriceChangeDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [note, setNote] = useState('');
  const [confirmLargeSwing, setConfirmLargeSwing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [postingWebhook, setPostingWebhook] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleBackdrop = (event: MouseEvent) => {
      if (event.target === dialog) {
        onClose();
      }
    };
    dialog.addEventListener('click', handleBackdrop);
    return () => dialog.removeEventListener('click', handleBackdrop);
  }, [onClose]);

  const payload = useMemo(
    () =>
      buildPriceChangePayload({
        sellerName: config.sellerName,
        sellerAddress: config.sellerAddress,
        agentId: config.agentId,
        platformFee,
        extraHeadroomPct,
        effectiveFactor,
        editedModels,
        note,
      }),
    [config, platformFee, extraHeadroomPct, effectiveFactor, editedModels, note],
  );

  const hasInvalidCached = editedModels.some((m) => m.evaluation.invalidCachedAboveInput);
  const hasLargeSwing = payload.changes.some((c) => c.pctChange != null && Math.abs(c.pctChange) > 20);
  const actionsDisabled =
    payload.changes.length === 0 || hasInvalidCached || (hasLargeSwing && !confirmLargeSwing);

  const jsonString = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function handleOpenGitHubIssue() {
    if (actionsDisabled) return;
    const link = buildGitHubIssueLink({
      repo: config.priceChangeRepo,
      label: config.priceChangeLabel,
      payload,
    });

    if (link.truncatedForUrl) {
      const ok = await copyToClipboard(link.bodyText);
      setStatusMessage(
        ok
          ? 'Request exceeded GitHub URL length — full Markdown + JSON was copied to your clipboard. Paste into the opened issue.'
          : 'Request exceeded GitHub URL length — use "Copy JSON" below and paste into the opened GitHub issue.',
      );
    } else {
      setStatusMessage(`Opened prefilled GitHub issue in ${config.priceChangeRepo}.`);
    }

    window.open(link.url, '_blank', 'noopener,noreferrer');
  }

  async function handleCopyJson() {
    if (actionsDisabled) return;
    const ok = await copyToClipboard(jsonString);
    if (ok) {
      setCopiedJson(true);
      setStatusMessage('Structured price-change JSON copied to clipboard.');
      window.setTimeout(() => setCopiedJson(false), 2200);
    } else {
      setStatusMessage('Clipboard write was blocked by the browser. Use Download JSON instead.');
    }
  }

  function handleDownloadJson() {
    if (actionsDisabled) return;
    const stamp = payload.timestamp.replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attacompute-price-change-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatusMessage('Downloaded structured price-change JSON.');
  }

  async function handleWebhookPost() {
    if (actionsDisabled || !config.priceChangeWebhookUrl) return;
    setPostingWebhook(true);
    setStatusMessage(null);
    try {
      const res = await fetch(config.priceChangeWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: jsonString,
      });
      if (!res.ok) {
        throw new Error(`Endpoint returned HTTP ${res.status}`);
      }
      setStatusMessage('Price-change proposal posted to configured review endpoint.');
    } catch (err) {
      setStatusMessage(
        err instanceof Error
          ? `Webhook request failed: ${err.message}. Use GitHub issue or Download JSON instead.`
          : 'Webhook request failed. Use GitHub issue or Download JSON instead.',
      );
    } finally {
      setPostingWebhook(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="review-dialog"
      aria-labelledby="review-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="review-dialog-inner">
        <div className="review-header">
          <div>
            <h2 id="review-dialog-title" style={{ fontSize: '1.15rem' }}>
              Review price-change proposal
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', marginTop: 2 }}>
              {payload.changes.length} field change{payload.changes.length === 1 ? '' : 's'} across{' '}
              {editedModels.length} model{editedModels.length === 1 ? '' : 's'}
            </p>
          </div>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close review drawer">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="review-body">
          <div className="attention-item severity-info" style={{ margin: 0 }}>
            <div className="attention-body">
              <ShieldCheck size={17} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
              <div>
                <div className="attention-title">Preview only — live prices are never changed here</div>
                <div className="attention-detail">
                  Submitting builds a structured change request for operator review. Live repricing
                  requires the operator&apos;s approval and the normal seller deploy workflow.
                </div>
              </div>
            </div>
          </div>

          {hasInvalidCached && (
            <div className="attention-item severity-critical" role="alert" style={{ margin: 0 }}>
              <div className="attention-body">
                <div>
                  <div className="attention-title">Invalid price: cached input exceeds input</div>
                  <div className="attention-detail">
                    Fix any model where cached input is above input price before exporting a request.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Field</th>
                  <th className="cell-num">Old → New</th>
                  <th className="cell-num">Change</th>
                  <th>Rank</th>
                  <th>Fallbacks</th>
                </tr>
              </thead>
              <tbody>
                {payload.changes.map((c) => (
                  <tr key={`${c.model}:${c.field}`}>
                    <td>
                      <strong>{c.modelDisplay}</strong>
                      <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                        {c.advertisedAs}
                      </div>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{c.field}</td>
                    <td className="cell-num">
                      {formatPricePerM(c.oldUsdPerM)} →{' '}
                      <strong style={{ color: 'var(--ink-1)' }}>{formatPricePerM(c.newUsdPerM)}</strong>
                    </td>
                    <td
                      className="cell-num"
                      style={{
                        color:
                          c.pctChange == null
                            ? 'var(--ink-2)'
                            : c.pctChange > 0
                              ? 'var(--warn)'
                              : 'var(--good)',
                      }}
                    >
                      {formatSignedPct(c.pctChange)}
                    </td>
                    <td className="mono" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      #{c.rankImpact.before} → #{c.rankImpact.after}
                      <span style={{ color: 'var(--ink-3)' }}>/{c.rankImpact.totalSellers}</span>
                    </td>
                    <td className="mono" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {c.fallbackImpact.beforeCount} → {c.fallbackImpact.afterCount}
                      {c.fallbackImpact.gainedPeers.length > 0 && (
                        <span style={{ color: 'var(--good)', marginLeft: 6 }}>
                          +{c.fallbackImpact.gainedPeers.length}
                        </span>
                      )}
                      {c.fallbackImpact.droppedPeers.length > 0 && (
                        <span style={{ color: 'var(--bad)', marginLeft: 6 }}>
                          −{c.fallbackImpact.droppedPeers.length}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label style={{ display: 'grid', gap: 6, fontSize: '0.84375rem' }}>
            <span style={{ fontWeight: 500 }}>Optional rationale / note</span>
            <input
              type="text"
              className="search-input"
              style={{ paddingLeft: 12 }}
              placeholder="e.g. Raise Sonnet 5.5 slightly to restore 2 healthy fallback peers"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {hasLargeSwing && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.84375rem',
                color: 'var(--warn)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={confirmLargeSwing}
                onChange={(e) => setConfirmLargeSwing(e.target.checked)}
              />
              <span>I have reviewed price adjustments larger than 20%</span>
            </label>
          )}

          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--ink-2)' }}>
              Inspect structured request JSON ({jsonString.length.toLocaleString()} bytes)
            </summary>
            <pre className="json-pre" style={{ marginTop: 8 }}>
              {jsonString}
            </pre>
          </details>

          {statusMessage && (
            <div role="status" aria-live="polite" className="pill pill-accent" style={{ whiteSpace: 'normal', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
              {statusMessage}
            </div>
          )}
        </div>

        <div className="review-footer">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={actionsDisabled}
              onClick={() => void handleCopyJson()}
            >
              {copiedJson ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copiedJson ? 'Copied JSON' : 'Copy JSON'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={actionsDisabled}
              onClick={handleDownloadJson}
            >
              <Download size={15} aria-hidden="true" />
              Download JSON
            </button>
            {config.priceChangeWebhookUrl && (
              <button
                type="button"
                className="btn"
                disabled={actionsDisabled || postingWebhook}
                onClick={() => void handleWebhookPost()}
              >
                <Send size={15} aria-hidden="true" />
                {postingWebhook ? 'Sending…' : 'Send to review endpoint'}
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            disabled={actionsDisabled}
            onClick={() => void handleOpenGitHubIssue()}
          >
            <ExternalLink size={15} aria-hidden="true" />
            Open GitHub issue ({config.priceChangeRepo})
          </button>
        </div>
      </div>
    </dialog>
  );
}
