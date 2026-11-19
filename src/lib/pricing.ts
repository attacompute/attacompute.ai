import { DEFAULT_PLATFORM_FEE } from '../config';
import type { AdvertisedModel, ModelSellerOffer } from '../types/antseed';

export const PRICE_FIELDS = ['input', 'cached', 'output'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

export interface TokenPrice {
  input: number;
  cached: number;
  output: number;
}

export type PeerGateReason =
  | 'own_listing'
  | 'invalid_price'
  | 'reported_failing'
  | 'model_check_diff'
  | 'offline';

export interface EvaluatedPeer {
  address: string;
  name: string;
  advertisedAs: string;
  input: number;
  cached: number;
  output: number;
  reputation: number | null;
  trusted: boolean;
  verified: boolean;
  live: boolean;
  organic: boolean;
  health: string | null;
  healthReason: string | null;
  modelCheck: string | null;
  gate: PeerGateReason | null;
  blockingFields: PriceField[];
  eligibleNow: boolean;
  eligibleAtLive: boolean;
  deltaStatus: 'unchanged_eligible' | 'gained' | 'dropped' | 'ineligible';
  /** Minimum listing price per field needed to unlock this peer at the current factor */
  unlockPrice: TokenPrice;
}

export interface MarketStats {
  totalSellers: number;
  /** 1-based rank among all priced sellers (including us), ordered by blended price (input + output) */
  rankAtPrice: number;
  rankAtLive: number;
  cheaperAtPrice: number;
  minInput: number | null;
  medianInput: number | null;
  minOutput: number | null;
  medianOutput: number | null;
}

export interface ModelPricingEvaluation {
  livePrice: TokenPrice;
  activePrice: TokenPrice;
  factor: number;
  invalidCachedAboveInput: boolean;
  peers: EvaluatedPeer[];
  eligibleLiveCount: number;
  eligibleActiveCount: number;
  gainedPeers: EvaluatedPeer[];
  droppedPeers: EvaluatedPeer[];
  market: MarketStats;
  savePctAtActive: number | null;
}

const EPS = 1e-12;

export function derivePlatformFee(feesMicro: number, revenueMicro: number): number {
  if (!Number.isFinite(feesMicro) || !Number.isFinite(revenueMicro) || revenueMicro <= 0) {
    return DEFAULT_PLATFORM_FEE;
  }
  const ratio = feesMicro / revenueMicro;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 0.25) {
    return DEFAULT_PLATFORM_FEE;
  }
  return Math.round(ratio * 10_000) / 10_000;
}

/**
 * Fallback ceiling factor derived purely from public fee rate and user-selected headroom.
 * factor = (1 - platformFee) * (1 - extraHeadroomPct / 100)
 */
export function computeFallbackFactor(platformFee: number, extraHeadroomPct: number): number {
  const safeFee = Math.min(0.25, Math.max(0, Number.isFinite(platformFee) ? platformFee : DEFAULT_PLATFORM_FEE));
  const safeHeadroom = Math.min(50, Math.max(0, Number.isFinite(extraHeadroomPct) ? extraHeadroomPct : 0));
  return (1 - safeFee) * (1 - safeHeadroom / 100);
}

export function roundPrice(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 10_000) / 10_000;
}

/** Smallest tidy listing price that still admits a peer offer under the ceiling. */
export function ceilTidyPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = value >= 1 ? 100 : value >= 0.1 ? 1000 : 10_000;
  return Math.ceil(value * unit - 1e-9) / unit;
}

export function extractListingPrice(model: AdvertisedModel): TokenPrice | null {
  if (model.modality !== 'text') return null;
  if (model.input_usd_per_m == null || model.output_usd_per_m == null) return null;
  const input = Math.max(0, model.input_usd_per_m);
  const output = Math.max(0, model.output_usd_per_m);
  const cached = model.cached_input_usd_per_m != null ? Math.max(0, model.cached_input_usd_per_m) : input;
  return { input, cached, output };
}

export function priceAdmits(offer: TokenPrice, listing: TokenPrice, factor: number): boolean {
  return (
    offer.input <= listing.input * factor + EPS &&
    offer.cached <= listing.cached * factor + EPS &&
    offer.output <= listing.output * factor + EPS
  );
}

export function blockingFieldsFor(offer: TokenPrice, listing: TokenPrice, factor: number): PriceField[] {
  const fields: PriceField[] = [];
  if (offer.input > listing.input * factor + EPS) fields.push('input');
  if (offer.cached > listing.cached * factor + EPS) fields.push('cached');
  if (offer.output > listing.output * factor + EPS) fields.push('output');
  return fields;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1];
  const b = sorted[mid];
  return a != null && b != null ? (a + b) / 2 : null;
}

function blendedScore(p: { input: number; output: number }): number {
  // Standard marketplace blend weighting input + output tokens (1:1 sum, matching legacy rank logic)
  return p.input + p.output;
}

function computeRank(ourPrice: TokenPrice, competitors: Array<{ input: number; output: number }>): {
  rank: number;
  cheaper: number;
} {
  const ours = blendedScore(ourPrice);
  let cheaper = 0;
  for (const c of competitors) {
    if (blendedScore(c) + EPS < ours) cheaper += 1;
  }
  return { rank: cheaper + 1, cheaper };
}

export function computeSliderRange(
  liveValue: number,
  peers: EvaluatedPeer[],
  field: PriceField,
  listPrice: number | null,
): { min: number; max: number; step: number } {
  const unlockValues = peers
    .filter((p) => p.gate === null && Number.isFinite(p.unlockPrice[field]))
    .map((p) => p.unlockPrice[field]);

  const anchor = Math.max(liveValue, listPrice ?? 0, 0.05);
  const minCandidate = liveValue === 0 ? 0 : Math.min(liveValue * 0.25, ...unlockValues.filter((v) => v > 0));
  const min = liveValue === 0 ? 0 : Math.max(0, roundPrice(minCandidate * 0.85));

  // Cap upper bound sensibly so extreme outlier sellers don't crush the slider scale
  const reasonableUnlocks = unlockValues.filter((v) => v <= anchor * 3.5);
  const maxUnlock = reasonableUnlocks.length ? Math.max(...reasonableUnlocks) : 0;
  const max = Math.max(liveValue * 2.2, maxUnlock * 1.15, (listPrice ?? 0) * 1.25, 0.25);

  const step = max >= 20 ? 0.05 : max >= 2 ? 0.01 : max >= 0.2 ? 0.002 : 0.0005;
  return { min, max: roundPrice(max), step };
}

export function computePriceToIncludePeer(
  currentPrice: TokenPrice,
  peer: Pick<EvaluatedPeer, 'input' | 'cached' | 'output'>,
  factor: number,
): TokenPrice {
  const safeFactor = Math.max(0.05, factor);
  const next: TokenPrice = {
    input: Math.max(currentPrice.input, ceilTidyPrice(peer.input / safeFactor)),
    cached: Math.max(currentPrice.cached, ceilTidyPrice(peer.cached / safeFactor)),
    output: Math.max(currentPrice.output, ceilTidyPrice(peer.output / safeFactor)),
  };
  if (next.cached > next.input) {
    next.input = next.cached;
  }
  return {
    input: roundPrice(next.input),
    cached: roundPrice(next.cached),
    output: roundPrice(next.output),
  };
}

export function evaluateModelPricing(params: {
  livePrice: TokenPrice;
  activePrice: TokenPrice;
  offers: ModelSellerOffer[];
  selfAddress: string;
  /** Other public wallets that are ours (e.g. a retired seller wallet still announcing). Shown as "Your listing", never as a fallback or competitor. */
  ownAddresses?: readonly string[];
  factor: number;
  listInputUsdPerM: number | null;
}): ModelPricingEvaluation {
  const { livePrice, activePrice, offers, selfAddress, factor, listInputUsdPerM } = params;
  const selfLower = selfAddress.toLowerCase();
  const ownLower = new Set((params.ownAddresses ?? []).map((a) => a.toLowerCase()));
  const safeFactor = Math.max(0.05, factor);

  const peers: EvaluatedPeer[] = [];
  const marketCompetitors: Array<{ input: number; output: number }> = [];

  for (const offer of offers) {
    const addrLower = offer.address.toLowerCase();
    if (addrLower === selfLower) continue;

    const input = offer.input_usd_per_m;
    const output = offer.output_usd_per_m;
    const cached = offer.cached_input_usd_per_m ?? input;

    let gate: PeerGateReason | null = null;
    if (ownLower.has(addrLower)) {
      gate = 'own_listing';
    } else if (
      input == null ||
      output == null ||
      cached == null ||
      !Number.isFinite(input) ||
      !Number.isFinite(output) ||
      !Number.isFinite(cached) ||
      input < 0 ||
      output < 0 ||
      cached < 0 ||
      cached > input + EPS
    ) {
      gate = 'invalid_price';
    } else if (offer.health === 'failing') {
      gate = 'reported_failing';
    } else if (offer.model_check === 'DIFF') {
      gate = 'model_check_diff';
    } else if (offer.live === false) {
      // Not announcing right now: buyers and our router cannot reach it, so it is not a usable fallback.
      gate = 'offline';
    }

    const safeInput = input != null && Number.isFinite(input) ? input : 0;
    const safeOutput = output != null && Number.isFinite(output) ? output : 0;
    const safeCached = cached != null && Number.isFinite(cached) ? cached : safeInput;

    if (gate !== 'invalid_price' && gate !== 'own_listing') {
      marketCompetitors.push({ input: safeInput, output: safeOutput });
    }

    const offerPrice: TokenPrice = { input: safeInput, cached: safeCached, output: safeOutput };
    const eligibleAtLive = gate === null && priceAdmits(offerPrice, livePrice, safeFactor);
    const eligibleNow = gate === null && priceAdmits(offerPrice, activePrice, safeFactor);
    const blockingFields = gate === null ? blockingFieldsFor(offerPrice, activePrice, safeFactor) : [];

    let deltaStatus: EvaluatedPeer['deltaStatus'] = 'ineligible';
    if (eligibleAtLive && eligibleNow) deltaStatus = 'unchanged_eligible';
    else if (!eligibleAtLive && eligibleNow) deltaStatus = 'gained';
    else if (eligibleAtLive && !eligibleNow) deltaStatus = 'dropped';

    peers.push({
      address: addrLower,
      name: offer.name || `${addrLower.slice(0, 6)}…${addrLower.slice(-4)}`,
      advertisedAs: offer.advertised_as,
      input: safeInput,
      cached: safeCached,
      output: safeOutput,
      reputation: offer.reputation,
      trusted: offer.trusted || (offer.reputation != null && offer.reputation >= 60),
      verified: offer.verified,
      live: offer.live,
      organic: offer.organic,
      health: offer.health,
      healthReason: offer.health_reason,
      modelCheck: offer.model_check,
      gate,
      blockingFields,
      eligibleNow,
      eligibleAtLive,
      deltaStatus,
      unlockPrice: {
        input: ceilTidyPrice(safeInput / safeFactor),
        cached: ceilTidyPrice(safeCached / safeFactor),
        output: ceilTidyPrice(safeOutput / safeFactor),
      },
    });
  }

  // Sort peers: gained first, dropped second, eligible third, price-blocked fourth, gated last
  const priority = (p: EvaluatedPeer): number => {
    if (p.deltaStatus === 'gained') return 0;
    if (p.deltaStatus === 'dropped') return 1;
    if (p.eligibleNow) return 2;
    if (p.gate === null) return 3;
    return 4;
  };

  peers.sort((a, b) => {
    const dp = priority(a) - priority(b);
    if (dp !== 0) return dp;
    const scoreDiff = blendedScore(a) - blendedScore(b);
    if (Math.abs(scoreDiff) > EPS) return scoreDiff;
    return (b.reputation ?? -1) - (a.reputation ?? -1);
  });

  const gainedPeers = peers.filter((p) => p.deltaStatus === 'gained');
  const droppedPeers = peers.filter((p) => p.deltaStatus === 'dropped');
  const eligibleLiveCount = peers.filter((p) => p.eligibleAtLive).length;
  const eligibleActiveCount = peers.filter((p) => p.eligibleNow).length;

  const liveRank = computeRank(livePrice, marketCompetitors);
  const activeRank = computeRank(activePrice, marketCompetitors);

  const allInputs = [...marketCompetitors.map((c) => c.input), activePrice.input];
  const allOutputs = [...marketCompetitors.map((c) => c.output), activePrice.output];

  let savePctAtActive: number | null = null;
  if (listInputUsdPerM != null && listInputUsdPerM > 0) {
    if (activePrice.input === 0) {
      savePctAtActive = 100;
    } else if (activePrice.input < listInputUsdPerM) {
      savePctAtActive = Math.round(((listInputUsdPerM - activePrice.input) / listInputUsdPerM) * 100);
    }
  }

  return {
    livePrice,
    activePrice,
    factor: safeFactor,
    invalidCachedAboveInput: activePrice.cached > activePrice.input + EPS,
    peers,
    eligibleLiveCount,
    eligibleActiveCount,
    gainedPeers,
    droppedPeers,
    market: {
      totalSellers: marketCompetitors.length + 1,
      rankAtPrice: activeRank.rank,
      rankAtLive: liveRank.rank,
      cheaperAtPrice: activeRank.cheaper,
      minInput: marketCompetitors.length ? Math.min(...marketCompetitors.map((c) => c.input)) : null,
      medianInput: median(allInputs),
      minOutput: marketCompetitors.length ? Math.min(...marketCompetitors.map((c) => c.output)) : null,
      medianOutput: median(allOutputs),
    },
    savePctAtActive,
  };
}

export function hasPriceEdit(live: TokenPrice, edited: TokenPrice | undefined): boolean {
  if (!edited) return false;
  return (
    Math.abs(live.input - edited.input) > 1e-6 ||
    Math.abs(live.cached - edited.cached) > 1e-6 ||
    Math.abs(live.output - edited.output) > 1e-6
  );
}

export function pctChange(oldVal: number, newVal: number): number | null {
  if (Math.abs(oldVal) < 1e-9) {
    return Math.abs(newVal) < 1e-9 ? 0 : null;
  }
  return Math.round(((newVal - oldVal) / oldVal) * 1000) / 10;
}
