import { describe, expect, it } from 'vitest';
import { FIXTURE_MODELS_MARKET, FIXTURE_SELLER_MODELS } from '../api/fixtures';
import { validateModelMarket, validateSellerModels } from '../api/validate';
import type { ModelSellerOffer } from '../types/antseed';
import {
  blockingFieldsFor,
  ceilTidyPrice,
  computeFallbackFactor,
  computePriceToIncludePeer,
  derivePlatformFee,
  evaluateModelPricing,
  extractListingPrice,
  priceAdmits,
} from '../lib/pricing';

const SELF = '0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139';

describe('derivePlatformFee & computeFallbackFactor', () => {
  it('derives public fee ratio from fees_micro / revenue_micro', () => {
    // 801207 / 20030795 ≈ 0.0400
    expect(derivePlatformFee(801207, 20030795)).toBeCloseTo(0.04, 4);
  });

  it('falls back to 4% when revenue is zero or invalid', () => {
    expect(derivePlatformFee(0, 0)).toBe(0.04);
    expect(derivePlatformFee(500, -10)).toBe(0.04);
    expect(derivePlatformFee(999, 1000)).toBe(0.04); // > 25% sanity guard
  });

  it('computes factor with 0% default headroom and custom extra headroom', () => {
    expect(computeFallbackFactor(0.04, 0)).toBeCloseTo(0.96, 6);
    expect(computeFallbackFactor(0.04, 5)).toBeCloseTo(0.96 * 0.95, 6);
  });
});

describe('priceAdmits, blockingFieldsFor & ceilTidyPrice', () => {
  const factor = 0.96;

  it('admits a peer only when input, cached, and output are each <= listing * factor', () => {
    const listing = { input: 2.0, cached: 0.1, output: 10.0 };
    expect(priceAdmits({ input: 1.92, cached: 0.096, output: 9.6 }, listing, factor)).toBe(true);
    expect(priceAdmits({ input: 1.93, cached: 0.096, output: 9.6 }, listing, factor)).toBe(false);
    expect(priceAdmits({ input: 1.92, cached: 0.097, output: 9.6 }, listing, factor)).toBe(false);
    expect(priceAdmits({ input: 1.92, cached: 0.096, output: 9.61 }, listing, factor)).toBe(false);
  });

  it('identifies exact blocking fields', () => {
    const listing = { input: 1.9, cached: 0.095, output: 9.5 };
    expect(blockingFieldsFor({ input: 1.88, cached: 0.092, output: 9.4 }, listing, factor)).toEqual([
      'input',
      'cached',
      'output',
    ]);
    expect(blockingFieldsFor({ input: 1.7, cached: 0.092, output: 8.5 }, listing, factor)).toEqual([
      'cached',
    ]);
  });

  it('computes smallest tidy price that still admits a peer', () => {
    const snapped = computePriceToIncludePeer(
      { input: 1.9, cached: 0.095, output: 9.5 },
      { input: 1.88, cached: 0.092, output: 9.4 },
      0.96,
    );
    expect(priceAdmits({ input: 1.88, cached: 0.092, output: 9.4 }, snapped, 0.96)).toBe(true);
    expect(snapped.input).toBe(ceilTidyPrice(1.88 / 0.96));
    expect(snapped.cached).toBe(ceilTidyPrice(0.092 / 0.96));
    expect(snapped.output).toBe(ceilTidyPrice(9.4 / 0.96));
  });
});

describe('evaluateModelPricing on sanitized Claude Sonnet 5.5 fixture', () => {
  const models = validateSellerModels(FIXTURE_SELLER_MODELS).data;
  const sonnet = models.advertised.find((m) => m.model === 'claude-sonnet-5-5')!;
  const market = validateModelMarket(FIXTURE_MODELS_MARKET['claude-sonnet-5-5']).data;
  const livePrice = extractListingPrice(sonnet)!;

  it('excludes failing-health peers and computes live rank & eligible fallbacks', () => {
    const ev = evaluateModelPricing({
      livePrice,
      activePrice: livePrice,
      offers: market.sellers,
      selfAddress: SELF,
      factor: 0.96,
      listInputUsdPerM: sonnet.list_input_usd_per_m,
    });

    // GesundAI has health="failing", so it is gated despite cheap price
    const gesund = ev.peers.find((p) => p.name === 'GesundAI');
    expect(gesund?.gate).toBe('reported_failing');
    expect(gesund?.eligibleNow).toBe(false);

    // Open Forge (1.45/0.07/7.2) and Apex Ant (1.72/0.085/8.6) fit under 1.9*0.96=1.824 / 0.0912 / 9.12
    expect(ev.eligibleLiveCount).toBe(2);
    expect(ev.eligibleActiveCount).toBe(2);
    expect(ev.gainedPeers).toHaveLength(0);
    expect(ev.droppedPeers).toHaveLength(0);
    expect(ev.market.totalSellers).toBe(market.sellers.length + 1);
    expect(ev.market.rankAtLive).toBe(5);
  });

  it('tracks peers becoming available when price increases', () => {
    const raised = { input: 2.0, cached: 0.1, output: 10.0 };
    const ev = evaluateModelPricing({
      livePrice,
      activePrice: raised,
      offers: market.sellers,
      selfAddress: SELF,
      factor: 0.96,
      listInputUsdPerM: sonnet.list_input_usd_per_m,
    });

    // RedPill (1.88/0.092/9.4) now fits under 2.0*0.96=1.92 / 0.096 / 9.6
    expect(ev.gainedPeers.map((p) => p.name)).toEqual(['RedPill']);
    expect(ev.droppedPeers).toHaveLength(0);
    expect(ev.eligibleActiveCount).toBe(3);
  });

  it('tracks peers dropping out and rank improving when price decreases', () => {
    const lowered = { input: 1.6, cached: 0.08, output: 8.0 };
    const ev = evaluateModelPricing({
      livePrice,
      activePrice: lowered,
      offers: market.sellers,
      selfAddress: SELF,
      factor: 0.96,
      listInputUsdPerM: sonnet.list_input_usd_per_m,
    });

    // Apex Ant (1.72/0.085/8.6) drops out; only Open Forge stays eligible
    expect(ev.droppedPeers.map((p) => p.name)).toEqual(['Apex Ant']);
    expect(ev.gainedPeers).toHaveLength(0);
    expect(ev.eligibleActiveCount).toBe(1);
    expect(ev.market.rankAtPrice).toBeLessThan(ev.market.rankAtLive);
  });

  it('flags invalid state when cached input exceeds input', () => {
    const ev = evaluateModelPricing({
      livePrice,
      activePrice: { input: 1.0, cached: 1.5, output: 5.0 },
      offers: market.sellers,
      selfAddress: SELF,
      factor: 0.96,
      listInputUsdPerM: sonnet.list_input_usd_per_m,
    });
    expect(ev.invalidCachedAboveInput).toBe(true);
  });
});

describe('evaluateModelPricing own-wallet and offline gates', () => {
  const offer = (address: string, name: string, live: boolean): ModelSellerOffer => ({
    address,
    agent_id: null,
    name,
    advertised_as: 'demo-model',
    input_usd_per_m: 1,
    cached_input_usd_per_m: 0.1,
    output_usd_per_m: 5,
    free: false,
    save_pct: null,
    reputation: 70,
    verified: true,
    organic: true,
    proven: true,
    trusted: true,
    live,
    health: null,
    health_reason: null,
    model_check: null,
    requests_last_hour: null,
    success_rate: null,
  });
  const OLD = '0xd5e7d5950b6cc71c095da4ace0c0cb8495667be0';
  const ev = evaluateModelPricing({
    livePrice: { input: 2, cached: 0.2, output: 10 },
    activePrice: { input: 2, cached: 0.2, output: 10 },
    offers: [
      offer(OLD, 'attacompute.ai', true),
      offer('0x1111111111111111111111111111111111111111', 'Live Peer', true),
      offer('0x2222222222222222222222222222222222222222', 'Sleepy Peer', false),
    ],
    selfAddress: SELF,
    ownAddresses: [OLD.toUpperCase()],
    factor: 0.96,
    listInputUsdPerM: null,
  });

  it('labels our retired wallet as our own listing, never a fallback or competitor', () => {
    const own = ev.peers.find((p) => p.address === OLD);
    expect(own?.gate).toBe('own_listing');
    expect(own?.eligibleNow).toBe(false);
    expect(ev.market.totalSellers).toBe(3); // us + two real peers
  });

  it('does not count offline peers as available fallbacks', () => {
    expect(ev.peers.find((p) => p.name === 'Sleepy Peer')?.gate).toBe('offline');
    expect(ev.eligibleActiveCount).toBe(1);
  });
});
