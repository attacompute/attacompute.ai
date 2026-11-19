import { TRUST_THRESHOLD, type AppConfig } from '../config';
import { formatBlockLag, formatRelativeAge } from '../lib/format';
import { derivePlatformFee, evaluateModelPricing, extractListingPrice } from '../lib/pricing';
import type {
  AttentionItem,
  ChannelItem,
  MergedSellerProfile,
  ModelMarketData,
  NetworkHealthData,
  NetworkStatusData,
  RequestEvent,
  SellerChecksData,
  SellerDailyData,
  SellerDetail,
  SellerDirectoryRow,
  SellerModelsData,
  TransactionEvent,
} from '../types/antseed';

export function mergeSellerProfile(params: {
  config: AppConfig;
  detail: SellerDetail | null;
  directoryRow: SellerDirectoryRow | null;
  daily: SellerDailyData | null;
  models: SellerModelsData | null;
  checks: SellerChecksData | null;
}): MergedSellerProfile {
  const { config, detail, directoryRow, daily, models, checks } = params;

  const revenueLifetimeMicro = detail?.revenue_micro ?? directoryRow?.revenue_micro ?? 0;
  const feesMicro = detail?.fees_micro ?? directoryRow?.fees_micro ?? 0;
  const derivedPlatformFee = derivePlatformFee(feesMicro, revenueLifetimeMicro);

  const days = daily?.days ?? [];
  const latestDay = days.length > 0 ? days[days.length - 1] : null;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const matchingToday = days.find((d) => d.day === todayUtc) ?? latestDay;

  const revenueTodayMicro = matchingToday?.settled_micro ?? directoryRow?.revenue_24h_micro ?? 0;
  const revenue24hMicro = directoryRow?.revenue_24h_micro ?? revenueTodayMicro;
  const revenuePrev24hMicro = directoryRow ? directoryRow.revenue_prev_24h_micro : null;

  const revenue7dMicro = detail?.revenue_7d_micro ?? directoryRow?.revenue_7d_micro ?? 0;
  const revenuePrev7dMicro = detail?.revenue_prev_7d_micro ?? 0;

  const sum30dFromDaily = days.reduce((acc, d) => acc + d.settled_micro, 0);
  const revenue30dMicro =
    directoryRow?.revenue_30d_micro ?? (sum30dFromDaily > 0 ? sum30dFromDaily : revenueLifetimeMicro);
  const revenuePrev30dMicro = directoryRow ? directoryRow.revenue_prev_30d_micro : null;

  // Prefer detail reputation when non-null; fall back to /sellers directory row (crawler quirk)
  let reputation: number | null = null;
  let reputationSource: MergedSellerProfile['reputationSource'] = 'unavailable';
  if (detail?.reputation != null) {
    reputation = detail.reputation;
    reputationSource = 'detail';
  } else if (directoryRow?.reputation != null) {
    reputation = directoryRow.reputation;
    reputationSource = 'directory';
  }

  // Merge requests & tokens (detail sometimes returns 0 while directory/sold holds counts)
  const soldRequests = models?.sold.reduce((sum, s) => sum + s.requests, 0) ?? 0;
  const soldTokens = models?.sold.reduce((sum, s) => sum + s.tokens, 0) ?? 0;

  const rawRequests =
    (detail && detail.requests > 0 ? detail.requests : null) ??
    (directoryRow && directoryRow.requests > 0 ? directoryRow.requests : null) ??
    (soldRequests > 0 ? soldRequests : null);

  const rawTokens =
    (detail && detail.tokens > 0 ? detail.tokens : null) ??
    (directoryRow && directoryRow.tokens > 0 ? directoryRow.tokens : null) ??
    (soldTokens > 0 ? soldTokens : null);

  const liveChecks = checks?.live ?? detail?.model_checks ?? models?.model_checks ?? null;

  return {
    address: detail?.address ?? directoryRow?.address ?? config.sellerAddressLower,
    name: detail?.name ?? directoryRow?.name ?? checks?.name ?? config.sellerName,
    agentId: detail?.agent_id ?? directoryRow?.agent_id ?? checks?.agent_id ?? config.agentId,
    live: detail?.live ?? directoryRow?.live ?? false,
    verified: detail?.verified ?? directoryRow?.verified ?? false,
    verification: detail?.verification ?? [],
    organic: detail?.organic ?? directoryRow?.organic ?? true,
    washRegistry: detail?.wash_registry ?? false,
    teeAdvertised: detail?.tee_advertised ?? directoryRow?.tee_advertised ?? false,
    rank: detail?.rank ?? null,
    share: detail?.share ?? null,
    revenueLifetimeMicro,
    revenueTodayMicro,
    revenue24hMicro,
    revenuePrev24hMicro,
    revenue7dMicro,
    revenuePrev7dMicro,
    revenue30dMicro,
    revenuePrev30dMicro,
    feesMicro,
    derivedPlatformFee,
    settles: detail?.settles ?? directoryRow?.settles ?? 0,
    channels: detail?.channels ?? directoryRow?.channels ?? 0,
    buyers: detail?.buyers ?? 0,
    requests: rawRequests,
    tokens: rawTokens,
    tokens24h: directoryRow ? directoryRow.tokens_24h : null,
    tokens7d: directoryRow ? directoryRow.tokens_7d : null,
    tokens30d: directoryRow ? directoryRow.tokens_30d : null,
    reputation,
    reputationSource,
    trust: detail?.trust ?? null,
    ghostRate: detail?.ghost_rate ?? directoryRow?.ghost_rate ?? null,
    stakeUsdc: detail?.stake_usdc ?? null,
    firstSettleTs: detail?.first_settle_ts ?? directoryRow?.first_settle_ts ?? null,
    lastSettleTs: detail?.last_settle_ts ?? directoryRow?.last_settle_ts ?? null,
    liveChecksSame: liveChecks ? liveChecks.same : null,
    liveChecksDiff: liveChecks ? liveChecks.diff : null,
    pointsMultiplier: liveChecks?.points_multiplier ?? null,
  };
}

export function deriveAttentionItems(params: {
  profile: MergedSellerProfile;
  models: SellerModelsData | null;
  checks: SellerChecksData | null;
  status: NetworkStatusData | null;
  health: NetworkHealthData | null;
  lastError: string | null;
  nowMs?: number;
}): AttentionItem[] {
  const { profile, models, checks, status, health, lastError, nowMs = Date.now() } = params;
  const items: AttentionItem[] = [];

  if (!profile.live) {
    items.push({
      id: 'not-live',
      severity: 'critical',
      title: 'Listing not announcing on DHT',
      detail:
        'AntSeedStats currently sees live: false for this seller wallet. Buyers cannot discover new routes until the DHT announcement is active.',
    });
  }

  if (profile.reputation == null) {
    items.push({
      id: 'trust-null',
      severity: 'warning',
      title: `Trust score unavailable (buyer threshold: ${TRUST_THRESHOLD})`,
      detail:
        'AntSeedStats returned null for trust breakdown on this address. Verify DHT announcement mapping and on-chain reputation.',
      actionLabel: 'Inspect trust',
      actionTo: '#trust-panel',
    });
  } else if (profile.reputation < TRUST_THRESHOLD) {
    const gap = (TRUST_THRESHOLD - profile.reputation).toFixed(1);
    items.push({
      id: 'trust-below-threshold',
      severity: 'warning',
      title: `Trust score ${profile.reputation.toFixed(1)} is ${gap} pts below the ${TRUST_THRESHOLD} buyer gate`,
      detail:
        'Default AntSeed buyers filter out sellers below 60 trust. Growing organic usage, stake power, and verified model checks closes the gap.',
      actionLabel: 'View trust levers',
      actionTo: '#trust-panel',
    });
  }

  const failingAdvertised = (models?.advertised ?? []).filter((m) => m.health === 'failing');
  const failingFromHealth = (health?.failing_services ?? []).filter(
    (f) => f.seller.toLowerCase() === profile.address.toLowerCase(),
  );
  const failingCount = Math.max(failingAdvertised.length, failingFromHealth.length);
  if (failingCount > 0) {
    const names = (
      failingAdvertised.length > 0
        ? failingAdvertised.map((m) => m.model_display)
        : failingFromHealth.map((f) => f.advertised_as)
    )
      .slice(0, 3)
      .join(', ');
    items.push({
      id: 'failing-services',
      severity: 'critical',
      title: `${failingCount} service${failingCount === 1 ? '' : 's'} reported failing`,
      detail: `Buyers skip models marked failing: ${names}. Check model health and fallback pricing.`,
      actionLabel: 'Open Pricing',
      actionTo: '/dashboard/pricing',
    });
  }

  if (checks?.live && checks.live.diff > 0) {
    items.push({
      id: 'model-check-diff',
      severity: 'critical',
      title: `${checks.live.diff} live DIFF model-check verdict${checks.live.diff === 1 ? '' : 's'}`,
      detail:
        'Auditors recorded a DIFF verdict on one or more services, which reduces points multiplier and buyer confidence.',
      actionLabel: 'View checks',
      actionTo: '#checks-panel',
    });
  } else if (checks?.evidence_missing && checks.evidence_missing > 0) {
    items.push({
      id: 'evidence-missing',
      severity: 'info',
      title: `${checks.evidence_missing} audited verdict${checks.evidence_missing === 1 ? '' : 's'} awaiting IPFS evidence`,
      detail:
        'The on-chain contract counts these verdicts toward your live multiplier, though evidence files are not yet readable by AntSeedStats.',
      actionLabel: 'View checks',
      actionTo: '#checks-panel',
    });
  }

  if (status && (status.overall !== 'ok' || (status.lag_blocks != null && status.lag_blocks > 6000))) {
    items.push({
      id: 'indexer-lag',
      severity: status.overall === 'down' ? 'critical' : 'warning',
      title: `AntSeedStats indexer ${status.overall} (${formatBlockLag(status.lag_blocks)})`,
      detail: 'On-chain settlement figures and live events may trail chain head until ingestion catches up.',
    });
  }

  if (profile.lastSettleTs != null) {
    const ageHours = (nowMs / 1000 - profile.lastSettleTs) / 3600;
    if (ageHours > 24) {
      items.push({
        id: 'stale-settle',
        severity: 'info',
        title: `Last settlement was ${formatRelativeAge(profile.lastSettleTs, nowMs)}`,
        detail: 'No channel settlements recorded in the last 24 hours.',
      });
    }
  }

  if (lastError) {
    items.push({
      id: 'api-error',
      severity: 'warning',
      title: 'Partial data refresh issue',
      detail: lastError,
    });
  }

  return items;
}

export interface LiveBuyerNode {
  id: string;
  address: string;
  label: string;
  channels: number;
  settledMicro: number;
  settles: number;
  recentRequests: number;
  recentTokens: number;
  lastActivityTs: number;
  models: string[];
}

export interface LiveUpstreamNode {
  id: string;
  kind: 'direct' | 'peer';
  label: string;
  address?: string;
  backedModels: string[];
  reputation: number | null;
  trusted: boolean;
  live: boolean;
  verified: boolean;
  health: string | null;
}

export interface LiveEventItem {
  id: string;
  kind: 'request' | 'settle' | 'channel';
  ts: number;
  buyer: string;
  modelDisplay: string;
  settledMicro: number;
  tokens: number;
  requests: number;
  free: boolean;
  tx?: string;
}

export interface LiveTopology {
  buyers: LiveBuyerNode[];
  upstreams: LiveUpstreamNode[];
  events: LiveEventItem[];
  totalRecentRequests: number;
  totalRecentChannels: number;
}

export function buildLiveTopology(params: {
  sellerAddress: string;
  ownAddresses?: readonly string[];
  channels: ChannelItem[];
  requests: RequestEvent[];
  transactions: TransactionEvent[];
  models: SellerModelsData | null;
  marketByModel: Record<string, ModelMarketData>;
  platformFee: number;
}): LiveTopology {
  const { sellerAddress, channels, requests, transactions, models, marketByModel, platformFee } = params;
  const selfLower = sellerAddress.toLowerCase();

  const myChannels = channels.filter((c) => c.seller.toLowerCase() === selfLower);
  const myRequests = requests.filter((r) => r.seller.toLowerCase() === selfLower);
  const myTx = transactions.filter((t) => t.account.toLowerCase() === selfLower && t.kind === 'settle');

  const buyerMap = new Map<string, LiveBuyerNode>();
  const ensureBuyer = (addr: string, ts: number): LiveBuyerNode => {
    const key = addr.toLowerCase();
    let existing = buyerMap.get(key);
    if (!existing) {
      existing = {
        id: `buyer:${key}`,
        address: key,
        label: `${key.slice(0, 6)}…${key.slice(-4)}`,
        channels: 0,
        settledMicro: 0,
        settles: 0,
        recentRequests: 0,
        recentTokens: 0,
        lastActivityTs: ts,
        models: [],
      };
      buyerMap.set(key, existing);
    }
    if (ts > existing.lastActivityTs) existing.lastActivityTs = ts;
    return existing;
  };

  for (const ch of myChannels) {
    const b = ensureBuyer(ch.buyer, ch.last_activity_ts);
    b.channels += 1;
    b.settledMicro += ch.settled_micro;
    b.settles += ch.settles;
  }

  for (const req of myRequests) {
    const b = ensureBuyer(req.buyer, req.ts);
    b.recentRequests += req.requests;
    b.recentTokens += req.tokens_in + req.tokens_out;
    if (req.model_display && !b.models.includes(req.model_display)) {
      b.models.push(req.model_display);
    }
  }

  const buyers = [...buyerMap.values()]
    .sort((a, b) => b.settledMicro - a.settledMicro || b.lastActivityTs - a.lastActivityTs)
    .slice(0, 8);

  // Aggregate eligible fallback peers across advertised models using public factor = (1 - platformFee)
  const factor = 1 - platformFee;
  const peerMap = new Map<string, LiveUpstreamNode>();
  const advertised = models?.advertised ?? [];

  for (const adv of advertised) {
    const livePrice = extractListingPrice(adv);
    if (!livePrice) continue;
    const market = marketByModel[adv.model];
    if (!market) continue;
    const evaluation = evaluateModelPricing({
      livePrice,
      activePrice: livePrice,
      offers: market.sellers,
      selfAddress: selfLower,
      ownAddresses: params.ownAddresses,
      factor,
      listInputUsdPerM: adv.list_input_usd_per_m,
    });
    for (const peer of evaluation.peers) {
      if (!peer.eligibleNow) continue;
      const existing = peerMap.get(peer.address);
      if (existing) {
        if (!existing.backedModels.includes(adv.model_display)) {
          existing.backedModels.push(adv.model_display);
        }
      } else {
        peerMap.set(peer.address, {
          id: `peer:${peer.address}`,
          kind: 'peer',
          label: peer.name,
          address: peer.address,
          backedModels: [adv.model_display],
          reputation: peer.reputation,
          trusted: peer.trusted,
          live: peer.live,
          verified: peer.verified,
          health: peer.health,
        });
      }
    }
  }

  const peerNodes = [...peerMap.values()]
    .sort((a, b) => b.backedModels.length - a.backedModels.length || (b.reputation ?? 0) - (a.reputation ?? 0))
    .slice(0, 7);

  // Primary generic direct upstream node (never exposes upstream vendor names)
  const directNode: LiveUpstreamNode = {
    id: 'upstream:direct',
    kind: 'direct',
    label: 'Direct upstream',
    backedModels: advertised.map((a) => a.model_display),
    reputation: null,
    trusted: true,
    live: true,
    verified: true,
    health: 'healthy',
  };

  const events: LiveEventItem[] = [
    ...myRequests.map<LiveEventItem>((r) => ({
      id: `req:${r.tx}:${r.model}`,
      kind: 'request',
      ts: r.ts,
      buyer: r.buyer,
      modelDisplay: r.model_display || r.model,
      settledMicro: r.settled_micro,
      tokens: r.tokens_in + r.tokens_out,
      requests: r.requests,
      free: r.free,
      tx: r.tx,
    })),
    ...myTx.map<LiveEventItem>((t) => ({
      id: `tx:${t.tx}`,
      kind: 'settle',
      ts: t.ts,
      buyer: t.account,
      modelDisplay: t.model || 'Channel settlement',
      settledMicro: Math.round(t.value * 1_000_000),
      tokens: 0,
      requests: 0,
      free: false,
      tx: t.tx,
    })),
    ...myChannels.map<LiveEventItem>((c) => ({
      id: `ch:${c.channel_id}`,
      kind: 'channel',
      ts: c.last_activity_ts,
      buyer: c.buyer,
      modelDisplay: `${c.settles} settle${c.settles === 1 ? '' : 's'} on channel`,
      settledMicro: c.settled_micro,
      tokens: 0,
      requests: 0,
      free: false,
    })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20);

  return {
    buyers,
    upstreams: [directNode, ...peerNodes],
    events,
    totalRecentRequests: myRequests.reduce((s, r) => s + r.requests, 0),
    totalRecentChannels: myChannels.length,
  };
}
