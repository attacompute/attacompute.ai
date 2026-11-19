import { describe, expect, it } from 'vitest';
import {
  FIXTURE_CHANNELS,
  FIXTURE_MODELS_MARKET,
  FIXTURE_NETWORK_HEALTH,
  FIXTURE_REQUESTS,
  FIXTURE_SELLER_CHECKS,
  FIXTURE_SELLER_DAILY,
  FIXTURE_SELLER_DETAIL,
  FIXTURE_SELLER_MODELS,
  FIXTURE_SELLERS_DIRECTORY,
  FIXTURE_STATUS,
  FIXTURE_TRANSACTIONS,
} from '../api/fixtures';
import { buildLiveTopology, deriveAttentionItems, mergeSellerProfile } from '../api/mappers';
import {
  validateChannels,
  validateModelMarket,
  validateNetworkHealth,
  validateNetworkStatus,
  validateRequests,
  validateSellerChecks,
  validateSellerDaily,
  validateSellerDetail,
  validateSellerModels,
  validateSellersDirectory,
  validateTransactions,
} from '../api/validate';
import { getAppConfig } from '../config';

describe('API validation & seller mappers', () => {
  const config = getAppConfig();
  const detail = validateSellerDetail(FIXTURE_SELLER_DETAIL).data;
  const directory = validateSellersDirectory(FIXTURE_SELLERS_DIRECTORY).data;
  const directoryRow =
    directory.sellers.find((s) => s.address === config.sellerAddressLower) ?? null;
  const models = validateSellerModels(FIXTURE_SELLER_MODELS).data;
  const daily = validateSellerDaily(FIXTURE_SELLER_DAILY).data;
  const checks = validateSellerChecks(FIXTURE_SELLER_CHECKS).data;
  const status = validateNetworkStatus(FIXTURE_STATUS).data;
  const health = validateNetworkHealth(FIXTURE_NETWORK_HEALTH).data;

  it('merges null detail fields gracefully with directory row', () => {
    const profile = mergeSellerProfile({
      config,
      detail,
      directoryRow,
      daily,
      models,
      checks,
    });

    expect(profile.name).toBe('attacompute.ai');
    expect(profile.agentId).toBe('47214');
    expect(profile.reputation).toBeCloseTo(39.88, 2);
    expect(profile.reputationSource).toBe('directory');
    expect(profile.trust).toBeNull();
    expect(profile.requests).toBe(57089);
    expect(profile.tokens).toBe(1704517668);
    expect(profile.liveChecksSame).toBe(3);
    expect(profile.liveChecksDiff).toBe(0);
    expect(profile.pointsMultiplier).toBe(1.06);
    expect(profile.derivedPlatformFee).toBeCloseTo(0.04, 4);
  });

  it('derives actionable needs-attention alerts from public signals', () => {
    const profile = mergeSellerProfile({
      config,
      detail,
      directoryRow,
      daily,
      models,
      checks,
    });

    const alerts = deriveAttentionItems({
      profile,
      models,
      checks,
      status,
      health,
      lastError: null,
      nowMs: 1795108400 * 1000,
    });

    const ids = alerts.map((a) => a.id);
    expect(ids).toContain('not-live');
    expect(ids).toContain('trust-below-threshold');
    expect(ids).toContain('evidence-missing');
  });

  it('builds live topology with generic Direct upstream label and eligible AntSeed peers', () => {
    const channels = validateChannels(FIXTURE_CHANNELS).data.channels;
    const requests = validateRequests(FIXTURE_REQUESTS).data.events;
    const transactions = validateTransactions(FIXTURE_TRANSACTIONS).data.events;

    const marketByModel = Object.fromEntries(
      Object.entries(FIXTURE_MODELS_MARKET).map(([k, v]) => [k, validateModelMarket(v).data]),
    );

    const topo = buildLiveTopology({
      sellerAddress: config.sellerAddressLower,
      channels,
      requests,
      transactions,
      models,
      marketByModel,
      platformFee: 0.04,
    });

    expect(topo.buyers.length).toBeGreaterThan(0);
    expect(topo.upstreams[0]?.label).toBe('Direct upstream');
    expect(topo.upstreams.some((u) => u.kind === 'peer')).toBe(true);
    expect(topo.events.length).toBeGreaterThan(0);
  });

  it('rejects malformed envelopes cleanly', () => {
    expect(() => validateSellerDetail(null)).toThrow(/Invalid seller detail/);
    expect(() => validateSellerDetail({ data: {} })).toThrow(/missing address/);
  });
});
