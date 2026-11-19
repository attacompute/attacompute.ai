import { describe, expect, it } from 'vitest';
import { FIXTURE_MODELS_MARKET, FIXTURE_SELLER_MODELS } from '../api/fixtures';
import { validateModelMarket, validateSellerModels } from '../api/validate';
import {
  MAX_GITHUB_ISSUE_URL_LEN,
  buildGitHubIssueLink,
  buildPriceChangePayload,
} from '../lib/changeRequest';
import { evaluateModelPricing, extractListingPrice } from '../lib/pricing';

const SELF = '0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139';

describe('buildPriceChangePayload & buildGitHubIssueLink', () => {
  const models = validateSellerModels(FIXTURE_SELLER_MODELS).data;
  const sonnet = models.advertised.find((m) => m.model === 'claude-sonnet-5-5')!;
  const market = validateModelMarket(FIXTURE_MODELS_MARKET['claude-sonnet-5-5']).data;
  const livePrice = extractListingPrice(sonnet)!;

  it('builds structured JSON with rank & fallback impact and never mutates live data', () => {
    const evaluation = evaluateModelPricing({
      livePrice,
      activePrice: { input: 2.0, cached: 0.1, output: 10.0 },
      offers: market.sellers,
      selfAddress: SELF,
      factor: 0.96,
      listInputUsdPerM: sonnet.list_input_usd_per_m,
    });

    const payload = buildPriceChangePayload({
      sellerName: 'attacompute.ai',
      sellerAddress: SELF,
      agentId: '47214',
      platformFee: 0.04,
      extraHeadroomPct: 0,
      effectiveFactor: 0.96,
      editedModels: [
        {
          model: sonnet.model,
          modelDisplay: sonnet.model_display,
          advertisedAs: sonnet.advertised_as,
          evaluation,
        },
      ],
      note: 'Restore RedPill fallback',
      timestamp: '2026-11-19T18:00:00.000Z',
    });

    expect(payload.schemaVersion).toBe('attacompute.price-change.v1');
    expect(payload.changes).toHaveLength(3);
    expect(payload.changes[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      field: 'input',
      oldUsdPerM: 1.9,
      newUsdPerM: 2.0,
      pctChange: 5.3,
    });
    expect(payload.changes[0]?.fallbackImpact.beforeCount).toBe(2);
    expect(payload.changes[0]?.fallbackImpact.afterCount).toBe(3);
    expect(payload.changes[0]?.fallbackImpact.gainedPeers[0]).toContain('RedPill');

    const link = buildGitHubIssueLink({
      repo: 'attacompute/node',
      label: 'price-change',
      payload,
    });

    expect(link.truncatedForUrl).toBe(false);
    expect(link.url).toContain('https://github.com/attacompute/node/issues/new?');
    expect(link.url).toContain('labels=price-change');
    expect(link.url.length).toBeLessThanOrEqual(MAX_GITHUB_ISSUE_URL_LEN);
  });

  it('keeps URL under GitHub length limit and flags clipboard fallback for huge batches', () => {
    const evaluation = evaluateModelPricing({
      livePrice,
      activePrice: { input: 2.0, cached: 0.1, output: 10.0 },
      offers: market.sellers,
      selfAddress: SELF,
      factor: 0.96,
      listInputUsdPerM: sonnet.list_input_usd_per_m,
    });

    const manyModels = Array.from({ length: 24 }, (_, idx) => ({
      model: `model-${idx}`,
      modelDisplay: `Model Display Name ${idx}`,
      advertisedAs: `model-alias-${idx}`,
      evaluation,
    }));

    const payload = buildPriceChangePayload({
      sellerName: 'attacompute.ai',
      sellerAddress: SELF,
      agentId: '47214',
      platformFee: 0.04,
      extraHeadroomPct: 0,
      effectiveFactor: 0.96,
      editedModels: manyModels,
      timestamp: '2026-11-19T18:00:00.000Z',
    });

    const link = buildGitHubIssueLink({
      repo: 'attacompute/node',
      label: 'price-change',
      payload,
    });

    expect(link.truncatedForUrl).toBe(true);
    expect(link.url.length).toBeLessThan(1500);
    expect(link.bodyText).toContain('attacompute.price-change.v1');
  });
});
