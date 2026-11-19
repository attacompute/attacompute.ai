import { formatPricePerM, formatSignedPct, shortAddress } from './format';
import { PRICE_FIELDS, pctChange, type ModelPricingEvaluation, type PriceField } from './pricing';

export const MAX_GITHUB_ISSUE_URL_LEN = 6500;

export interface PriceFieldChange {
  model: string;
  modelDisplay: string;
  advertisedAs: string;
  field: PriceField;
  oldUsdPerM: number;
  newUsdPerM: number;
  pctChange: number | null;
  timestamp: string;
  rankImpact: {
    before: number;
    after: number;
    totalSellers: number;
  };
  fallbackImpact: {
    beforeCount: number;
    afterCount: number;
    gainedPeers: string[];
    droppedPeers: string[];
  };
}

export interface PriceChangeRequestPayload {
  schemaVersion: 'attacompute.price-change.v1';
  notice: string;
  seller: {
    name: string;
    address: string;
    agentId: string;
  };
  timestamp: string;
  pricingRule: {
    platformFeePct: number;
    extraHeadroomPct: number;
    effectiveFactor: number;
  };
  note: string | null;
  changes: PriceFieldChange[];
}

export interface EditedModelSummary {
  model: string;
  modelDisplay: string;
  advertisedAs: string;
  evaluation: ModelPricingEvaluation;
}

export function buildPriceChangePayload(params: {
  sellerName: string;
  sellerAddress: string;
  agentId: string;
  platformFee: number;
  extraHeadroomPct: number;
  effectiveFactor: number;
  editedModels: EditedModelSummary[];
  note?: string;
  timestamp?: string;
}): PriceChangeRequestPayload {
  const timestamp = params.timestamp ?? new Date().toISOString();
  const changes: PriceFieldChange[] = [];

  for (const item of params.editedModels) {
    const { evaluation } = item;
    for (const field of PRICE_FIELDS) {
      const oldVal = evaluation.livePrice[field];
      const newVal = evaluation.activePrice[field];
      if (Math.abs(oldVal - newVal) <= 1e-6) continue;
      changes.push({
        model: item.model,
        modelDisplay: item.modelDisplay,
        advertisedAs: item.advertisedAs,
        field,
        oldUsdPerM: oldVal,
        newUsdPerM: newVal,
        pctChange: pctChange(oldVal, newVal),
        timestamp,
        rankImpact: {
          before: evaluation.market.rankAtLive,
          after: evaluation.market.rankAtPrice,
          totalSellers: evaluation.market.totalSellers,
        },
        fallbackImpact: {
          beforeCount: evaluation.eligibleLiveCount,
          afterCount: evaluation.eligibleActiveCount,
          gainedPeers: evaluation.gainedPeers.map((p) => `${p.name} (${shortAddress(p.address)})`),
          droppedPeers: evaluation.droppedPeers.map((p) => `${p.name} (${shortAddress(p.address)})`),
        },
      });
    }
  }

  const trimmedNote = params.note?.trim() || null;

  return {
    schemaVersion: 'attacompute.price-change.v1',
    notice:
      'Proposal generated from the public attacompute.ai dashboard. Live prices are NOT modified automatically; operator review and normal seller deploy are required.',
    seller: {
      name: params.sellerName,
      address: params.sellerAddress,
      agentId: params.agentId,
    },
    timestamp,
    pricingRule: {
      platformFeePct: Math.round(params.platformFee * 10_000) / 100,
      extraHeadroomPct: params.extraHeadroomPct,
      effectiveFactor: Math.round(params.effectiveFactor * 10_000) / 10_000,
    },
    note: trimmedNote,
    changes,
  };
}

export function formatIssueMarkdown(payload: PriceChangeRequestPayload): string {
  const lines: string[] = [
    `## Proposed Price Changes — ${payload.seller.name}`,
    '',
    `> **Reminder:** Submitted via public seller dashboard preview. Live prices are unchanged until approved and deployed through the normal seller workflow.`,
    '',
    `- **Seller:** \`${payload.seller.address}\` (Agent #${payload.seller.agentId})`,
    `- **Generated:** ${payload.timestamp}`,
    `- **Fallback factor:** ${(payload.pricingRule.effectiveFactor * 100).toFixed(2)}% (derived fee ${payload.pricingRule.platformFeePct.toFixed(2)}% + extra headroom ${payload.pricingRule.extraHeadroomPct.toFixed(1)}%)`,
  ];

  if (payload.note) {
    lines.push(`- **Note:** ${payload.note}`);
  }

  lines.push(
    '',
    '| Model | Field | Old ($/M) | New ($/M) | Change | Rank | Fallbacks |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
  );

  for (const c of payload.changes) {
    lines.push(
      `| ${c.modelDisplay} (\`${c.advertisedAs}\`) | ${c.field} | ${formatPricePerM(c.oldUsdPerM)} | ${formatPricePerM(c.newUsdPerM)} | ${formatSignedPct(c.pctChange)} | #${c.rankImpact.before} → #${c.rankImpact.after}/${c.rankImpact.totalSellers} | ${c.fallbackImpact.beforeCount} → ${c.fallbackImpact.afterCount} |`,
    );
  }

  lines.push('', '<details>', '<summary>Structured Request JSON</summary>', '', '```json', JSON.stringify(payload, null, 2), '```', '</details>');
  return lines.join('\n');
}

export interface GitHubIssueLinkResult {
  url: string;
  bodyText: string;
  truncatedForUrl: boolean;
}

export function buildGitHubIssueLink(params: {
  repo: string;
  label: string;
  payload: PriceChangeRequestPayload;
}): GitHubIssueLinkResult {
  const cleanRepo = params.repo.replace(/^\/+|\/+$/g, '') || 'attacompute/node';
  const modelCount = new Set(params.payload.changes.map((c) => c.model)).size;
  const title = `Price change request: ${modelCount} model${modelCount === 1 ? '' : 's'} (${params.payload.timestamp.slice(0, 10)})`;
  const fullBody = formatIssueMarkdown(params.payload);

  const base = `https://github.com/${cleanRepo}/issues/new`;
  const fullParams = new URLSearchParams({
    title,
    labels: params.label || 'price-change',
    body: fullBody,
  });
  const fullUrl = `${base}?${fullParams.toString()}`;

  if (fullUrl.length <= MAX_GITHUB_ISSUE_URL_LEN) {
    return {
      url: fullUrl,
      bodyText: fullBody,
      truncatedForUrl: false,
    };
  }

  const shortBody = [
    `## Proposed Price Changes — ${params.payload.seller.name}`,
    '',
    `The full request (${params.payload.changes.length} field edits across ${modelCount} models) exceeded GitHub's URL length limit and has been copied to your clipboard.`,
    '',
    'Please paste (`Cmd+V` / `Ctrl+V`) the full Markdown & JSON payload here before creating the issue.',
  ].join('\n');

  const shortParams = new URLSearchParams({
    title,
    labels: params.label || 'price-change',
    body: shortBody,
  });

  return {
    url: `${base}?${shortParams.toString()}`,
    bodyText: fullBody,
    truncatedForUrl: true,
  };
}
