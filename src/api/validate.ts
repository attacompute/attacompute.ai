import type {
  AdvertisedModel,
  ApiMeta,
  ChannelItem,
  ChannelsData,
  DailyPoint,
  FailingServiceEntry,
  IndexerSubsystem,
  ModelCheckRecord,
  ModelChecksSummary,
  ModelMarketData,
  ModelSellerOffer,
  NetworkHealthData,
  NetworkStatusData,
  OptionalSellerMetadata,
  RequestEvent,
  RequestsData,
  SellerChecksData,
  SellerDailyData,
  SellerDetail,
  SellerDirectoryRow,
  SellerModelsData,
  SoldModel,
  TransactionEvent,
  TransactionsData,
  TrustParts,
  VerificationEntry,
} from '../types/antseed';

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNullableString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asNullableBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

export interface ValidatedEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

function parseMeta(raw: unknown): ApiMeta {
  const m = isRecord(raw) ? raw : {};
  return {
    as_of_block: asNullableNumber(m.as_of_block),
    as_of_ts: asNullableNumber(m.as_of_ts),
    indexer_lag_blocks: asNullableNumber(m.indexer_lag_blocks),
    generated_at: asNullableNumber(m.generated_at),
    max_age_s: asNullableNumber(m.max_age_s),
  };
}

function unwrapEnvelope(raw: unknown, label: string): { data: UnknownRecord; meta: ApiMeta } {
  if (!isRecord(raw) || !isRecord(raw.data)) {
    throw new Error(`Invalid ${label} response: expected { data } envelope`);
  }
  return { data: raw.data, meta: parseMeta(raw.meta) };
}

function parseModelChecksSummary(raw: unknown): ModelChecksSummary | null {
  if (!isRecord(raw)) return null;
  return {
    same: asNumber(raw.same, 0),
    diff: asNumber(raw.diff, 0),
    points_multiplier: asNullableNumber(raw.points_multiplier),
    read_ts: asNullableNumber(raw.read_ts),
  };
}

function parseTrustParts(raw: unknown): TrustParts | null {
  if (!isRecord(raw)) return null;
  return {
    history: asNullableNumber(raw.history),
    usage: asNullableNumber(raw.usage),
    power: asNullableNumber(raw.power),
    identity: asNullableNumber(raw.identity),
    identity_kind: asNullableString(raw.identity_kind),
    free_models: asNullableNumber(raw.free_models),
    epoch: asNullableNumber(raw.epoch),
  };
}

function parseVerifications(raw: unknown): VerificationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: VerificationEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const kind = asString(item.kind);
    const target = asString(item.target);
    if (!kind || !target) continue;
    out.push({
      kind,
      target,
      verified: asBool(item.verified),
      href: asNullableString(item.href),
    });
  }
  return out;
}

export function validateSellerDetail(raw: unknown): ValidatedEnvelope<SellerDetail> {
  const { data: d, meta } = unwrapEnvelope(raw, 'seller detail');
  const address = asString(d.address);
  if (!address) throw new Error('Invalid seller detail: missing address');

  return {
    meta,
    data: {
      address: address.toLowerCase(),
      agent_id: asNullableString(d.agent_id),
      peer_id: asNullableString(d.peer_id),
      name: asNullableString(d.name),
      model_checks: parseModelChecksSummary(d.model_checks),
      rank: asNullableNumber(d.rank),
      share: asNullableNumber(d.share),
      revenue_micro: asNumber(d.revenue_micro, 0),
      revenue_7d_micro: asNumber(d.revenue_7d_micro, 0),
      revenue_prev_7d_micro: asNumber(d.revenue_prev_7d_micro, 0),
      fees_micro: asNumber(d.fees_micro, 0),
      settles: asNumber(d.settles, 0),
      channels: asNumber(d.channels, 0),
      buyers: asNumber(d.buyers, 0),
      tokens: asNumber(d.tokens, 0),
      requests: asNumber(d.requests, 0),
      reputation: asNullableNumber(d.reputation),
      trust: parseTrustParts(d.trust),
      ghost_rate: asNullableNumber(d.ghost_rate),
      stake_usdc: asNullableNumber(d.stake_usdc),
      verified: asBool(d.verified),
      verification: parseVerifications(d.verification),
      live: asBool(d.live),
      wash_registry: asBool(d.wash_registry),
      organic: asBool(d.organic),
      tee_advertised: asBool(d.tee_advertised),
      first_settle_ts: asNullableNumber(d.first_settle_ts),
      last_settle_ts: asNullableNumber(d.last_settle_ts),
    },
  };
}

export function validateSellersDirectory(
  raw: unknown,
): ValidatedEnvelope<{ total: number; sellers: SellerDirectoryRow[] }> {
  const { data: d, meta } = unwrapEnvelope(raw, 'sellers directory');
  const rawList = Array.isArray(d.sellers) ? d.sellers : [];
  const sellers: SellerDirectoryRow[] = [];

  for (const item of rawList) {
    if (!isRecord(item)) continue;
    const address = asString(item.address);
    if (!address) continue;
    sellers.push({
      address: address.toLowerCase(),
      agent_id: asNullableString(item.agent_id),
      name: asNullableString(item.name),
      verified: asBool(item.verified),
      live: asBool(item.live),
      tee_advertised: asBool(item.tee_advertised),
      revenue_micro: asNumber(item.revenue_micro, 0),
      revenue_6h_micro: asNumber(item.revenue_6h_micro, 0),
      revenue_prev_6h_micro: asNumber(item.revenue_prev_6h_micro, 0),
      revenue_24h_micro: asNumber(item.revenue_24h_micro, 0),
      revenue_prev_24h_micro: asNumber(item.revenue_prev_24h_micro, 0),
      revenue_7d_micro: asNumber(item.revenue_7d_micro, 0),
      revenue_30d_micro: asNumber(item.revenue_30d_micro, 0),
      revenue_prev_30d_micro: asNumber(item.revenue_prev_30d_micro, 0),
      fees_micro: asNumber(item.fees_micro, 0),
      settles: asNumber(item.settles, 0),
      channels: asNumber(item.channels, 0),
      tokens: asNumber(item.tokens, 0),
      tokens_24h: asNumber(item.tokens_24h, 0),
      tokens_7d: asNumber(item.tokens_7d, 0),
      tokens_30d: asNumber(item.tokens_30d, 0),
      requests: asNumber(item.requests, 0),
      models: asNumber(item.models, 0),
      reputation: asNullableNumber(item.reputation),
      ghost_rate: asNullableNumber(item.ghost_rate),
      organic: asBool(item.organic),
      first_settle_ts: asNullableNumber(item.first_settle_ts),
      last_settle_ts: asNullableNumber(item.last_settle_ts),
    });
  }

  return {
    meta,
    data: { total: asNumber(d.total, sellers.length), sellers },
  };
}

export function validateSellerModels(raw: unknown): ValidatedEnvelope<SellerModelsData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'seller models');
  const advertised: AdvertisedModel[] = [];
  const sold: SoldModel[] = [];

  if (Array.isArray(d.advertised)) {
    for (const item of d.advertised) {
      if (!isRecord(item)) continue;
      const model = asString(item.model);
      if (!model) continue;
      advertised.push({
        model,
        model_display: asString(item.model_display, model),
        advertised_as: asString(item.advertised_as, model),
        input_usd_per_m: asNullableNumber(item.input_usd_per_m),
        cached_input_usd_per_m: asNullableNumber(item.cached_input_usd_per_m),
        output_usd_per_m: asNullableNumber(item.output_usd_per_m),
        free: asBool(item.free),
        protocols: asNullableString(item.protocols),
        list_input_usd_per_m: asNullableNumber(item.list_input_usd_per_m),
        save_pct: asNullableNumber(item.save_pct),
        modality: asString(item.modality, 'text'),
        model_check: asNullableString(item.model_check),
        health: asNullableString(item.health),
        health_reason: asNullableString(item.health_reason),
        health_checked_ts: asNullableNumber(item.health_checked_ts),
        health_not_served: asBool(item.health_not_served),
        requests_last_hour: asNullableNumber(item.requests_last_hour),
        success_rate: asNullableNumber(item.success_rate),
        first_token_ms_p50: asNullableNumber(item.first_token_ms_p50),
      });
    }
  }

  if (Array.isArray(d.sold)) {
    for (const item of d.sold) {
      if (!isRecord(item)) continue;
      const model = asString(item.model);
      if (!model) continue;
      sold.push({
        model,
        model_display: asString(item.model_display, model),
        settled_micro: asNumber(item.settled_micro, 0),
        tokens: asNumber(item.tokens, 0),
        requests: asNumber(item.requests, 0),
        buyers: asNumber(item.buyers, 0),
      });
    }
  }

  return {
    meta,
    data: {
      address: asString(d.address).toLowerCase(),
      model_checks: parseModelChecksSummary(d.model_checks),
      advertised,
      sold,
    },
  };
}

export function validateSellerDaily(raw: unknown): ValidatedEnvelope<SellerDailyData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'seller daily');
  const days: DailyPoint[] = [];

  if (Array.isArray(d.days)) {
    for (const item of d.days) {
      if (!isRecord(item)) continue;
      const day = asString(item.day);
      if (!day) continue;
      days.push({
        day,
        settled_micro: asNumber(item.settled_micro, 0),
        fees_micro: asNumber(item.fees_micro, 0),
        settles: asNumber(item.settles, 0),
        buyers: asNumber(item.buyers, 0),
        tokens_in: asNullableNumber(item.tokens_in),
        tokens_out: asNullableNumber(item.tokens_out),
      });
    }
  }

  return {
    meta,
    data: {
      address: asString(d.address).toLowerCase(),
      from: asString(d.from),
      to: asString(d.to),
      days,
    },
  };
}

export function validateSellerChecks(raw: unknown): ValidatedEnvelope<SellerChecksData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'seller checks');
  const models: ModelCheckRecord[] = [];

  if (Array.isArray(d.models)) {
    for (const item of d.models) {
      if (!isRecord(item)) continue;
      const service = asString(item.service);
      if (!service) continue;
      let proofUrl: string | null = null;
      if (Array.isArray(item.reads) && item.reads.length > 0 && isRecord(item.reads[0])) {
        proofUrl = asNullableString(item.reads[0].proof_url);
      }
      models.push({
        service,
        model: asString(item.model, service),
        model_id: asNullableString(item.model_id),
        model_display: asNullableString(item.model_display),
        epoch: asNumber(item.epoch, 0),
        audited_ts: asNullableNumber(item.audited_ts),
        verdict: asString(item.verdict, 'UNKNOWN'),
        close_call: asBool(item.close_call),
        not_tested: asNullableString(item.not_tested),
        valid_until_epoch: asNullableNumber(item.valid_until_epoch),
        counts_now: asNullableBool(item.counts_now),
        diffs: asNullableNumber(item.diffs),
        total: asNullableNumber(item.total),
        proof_url: proofUrl,
      });
    }
  }

  const liveObj = isRecord(d.live)
    ? {
        same: asNumber(d.live.same, 0),
        diff: asNumber(d.live.diff, 0),
        points_multiplier: asNullableNumber(d.live.points_multiplier),
      }
    : null;

  return {
    meta,
    data: {
      address: asString(d.address).toLowerCase(),
      agent_id: asNullableString(d.agent_id),
      name: asNullableString(d.name),
      epoch: asNullableNumber(d.epoch),
      unread: asNullableNumber(d.unread),
      evidence_missing: asNullableNumber(d.evidence_missing),
      live: liveObj,
      models,
    },
  };
}

export function validateNetworkStatus(raw: unknown): ValidatedEnvelope<NetworkStatusData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'status');
  const subsystems: IndexerSubsystem[] = [];

  if (Array.isArray(d.subsystems)) {
    for (const item of d.subsystems) {
      if (!isRecord(item)) continue;
      const key = asString(item.key);
      if (!key) continue;
      subsystems.push({
        key,
        status: asString(item.status, 'unknown'),
        detail: asString(item.detail),
      });
    }
  }

  return {
    meta,
    data: {
      overall: asString(d.overall, 'unknown'),
      head_block: asNullableNumber(d.head_block),
      last_indexed_block: asNullableNumber(d.last_indexed_block),
      lag_blocks: asNullableNumber(d.lag_blocks),
      subsystems,
    },
  };
}

function parseFailingEntries(raw: unknown): FailingServiceEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FailingServiceEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const seller = asString(item.seller);
    const advertised_as = asString(item.advertised_as);
    if (!seller || !advertised_as) continue;
    out.push({
      seller: seller.toLowerCase(),
      seller_name: asNullableString(item.seller_name),
      advertised_as,
      reason: asNullableString(item.reason),
      reason_label: asNullableString(item.reason_label),
      http_status: asNullableNumber(item.http_status),
      since_ts: asNullableNumber(item.since_ts),
      checked_ts: asNullableNumber(item.checked_ts),
    });
  }
  return out;
}

export function validateNetworkHealth(raw: unknown): ValidatedEnvelope<NetworkHealthData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'network health');
  return {
    meta,
    data: {
      at_ts: asNullableNumber(d.at_ts),
      services: asNumber(d.services, 0),
      healthy: asNumber(d.healthy, 0),
      failing: asNumber(d.failing, 0),
      failing_services: parseFailingEntries(d.failing_services),
      not_served_services: parseFailingEntries(d.not_served_services),
    },
  };
}

export function validateModelMarket(raw: unknown): ValidatedEnvelope<ModelMarketData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'model market');
  const model = asString(d.model);
  if (!model) throw new Error('Invalid model market: missing model id');
  const sellers: ModelSellerOffer[] = [];

  if (Array.isArray(d.sellers)) {
    for (const item of d.sellers) {
      if (!isRecord(item)) continue;
      const address = asString(item.address);
      if (!address) continue;
      sellers.push({
        address: address.toLowerCase(),
        agent_id: asNullableString(item.agent_id),
        name: asNullableString(item.name),
        advertised_as: asString(item.advertised_as, model),
        input_usd_per_m: asNullableNumber(item.input_usd_per_m),
        cached_input_usd_per_m: asNullableNumber(item.cached_input_usd_per_m),
        output_usd_per_m: asNullableNumber(item.output_usd_per_m),
        free: asBool(item.free),
        save_pct: asNullableNumber(item.save_pct),
        reputation: asNullableNumber(item.reputation),
        verified: asBool(item.verified),
        organic: asBool(item.organic),
        proven: asBool(item.proven),
        trusted: asBool(item.trusted),
        live: asBool(item.live),
        health: asNullableString(item.health),
        health_reason: asNullableString(item.health_reason),
        model_check: asNullableString(item.model_check),
        requests_last_hour: asNullableNumber(item.requests_last_hour),
        success_rate: asNullableNumber(item.success_rate),
      });
    }
  }

  return {
    meta,
    data: {
      model,
      display: asString(d.display, model),
      sellers,
    },
  };
}

export function validatePricesFallback(
  raw: unknown,
  modelId: string,
  display: string,
): ValidatedEnvelope<ModelMarketData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'prices');
  const sellers: ModelSellerOffer[] = [];

  if (Array.isArray(d.listings)) {
    for (const item of d.listings) {
      if (!isRecord(item)) continue;
      const address = asString(item.seller);
      if (!address) continue;
      sellers.push({
        address: address.toLowerCase(),
        agent_id: asNullableString(item.agent_id),
        name: asNullableString(item.seller_name),
        advertised_as: asString(item.advertised_as, modelId),
        input_usd_per_m: asNullableNumber(item.input_usd_per_m),
        cached_input_usd_per_m: asNullableNumber(item.cached_input_usd_per_m),
        output_usd_per_m: asNullableNumber(item.output_usd_per_m),
        free: asBool(item.free),
        save_pct: asNullableNumber(item.save_pct),
        reputation: asNullableNumber(item.reputation),
        verified: asBool(item.verified),
        organic: asBool(item.organic),
        proven: asBool(item.proven),
        trusted: asBool(item.trusted),
        live: asBool(item.live),
        health: asNullableString(item.health),
        health_reason: asNullableString(item.health_reason),
        model_check: null,
        requests_last_hour: null,
        success_rate: null,
      });
    }
  }

  return {
    meta,
    data: { model: modelId, display, sellers },
  };
}

export function validateChannels(raw: unknown): ValidatedEnvelope<ChannelsData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'channels');
  const statsRaw = isRecord(d.stats) ? d.stats : {};
  const channels: ChannelItem[] = [];

  if (Array.isArray(d.channels)) {
    for (const item of d.channels) {
      if (!isRecord(item)) continue;
      const channel_id = asString(item.channel_id);
      const buyer = asString(item.buyer);
      const seller = asString(item.seller);
      if (!channel_id || !buyer || !seller) continue;
      channels.push({
        channel_id,
        buyer: buyer.toLowerCase(),
        seller: seller.toLowerCase(),
        seller_name: asNullableString(item.seller_name),
        settled_micro: asNumber(item.settled_micro, 0),
        settles: asNumber(item.settles, 0),
        first_seen_ts: asNumber(item.first_seen_ts, 0),
        last_activity_ts: asNumber(item.last_activity_ts, 0),
      });
    }
  }

  return {
    meta,
    data: {
      stats: {
        opened: asNumber(statsRaw.opened, 0),
        active: asNumber(statsRaw.active, 0),
        settled: asNumber(statsRaw.settled, 0),
        closed: asNumber(statsRaw.closed, 0),
      },
      channels,
    },
  };
}

export function validateRequests(raw: unknown): ValidatedEnvelope<RequestsData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'requests');
  const events: RequestEvent[] = [];

  if (Array.isArray(d.events)) {
    for (const item of d.events) {
      if (!isRecord(item)) continue;
      const tx = asString(item.tx);
      const seller = asString(item.seller);
      const buyer = asString(item.buyer);
      if (!tx || !seller || !buyer) continue;
      events.push({
        tx,
        block: asNumber(item.block, 0),
        ts: asNumber(item.ts, 0),
        channel_id: asString(item.channel_id),
        buyer: buyer.toLowerCase(),
        seller: seller.toLowerCase(),
        seller_name: asNullableString(item.seller_name),
        model: asString(item.model),
        model_display: asString(item.model_display, asString(item.model)),
        free: asBool(item.free),
        requests: asNumber(item.requests, 0),
        tokens_in: asNumber(item.tokens_in, 0),
        tokens_cached: asNumber(item.tokens_cached, 0),
        tokens_out: asNumber(item.tokens_out, 0),
        settled_micro: asNumber(item.settled_micro, 0),
      });
    }
  }

  return { meta, data: { events } };
}

export function validateTransactions(raw: unknown): ValidatedEnvelope<TransactionsData> {
  const { data: d, meta } = unwrapEnvelope(raw, 'transactions');
  const events: TransactionEvent[] = [];

  if (Array.isArray(d.events)) {
    for (const item of d.events) {
      if (!isRecord(item)) continue;
      const tx = asString(item.tx);
      const account = asString(item.account);
      if (!tx || !account) continue;
      events.push({
        tx,
        block: asNumber(item.block, 0),
        ts: asNumber(item.ts, 0),
        kind: asString(item.kind),
        account: account.toLowerCase(),
        account_name: asNullableString(item.account_name),
        value: asNumber(item.value, 0),
        unit: asString(item.unit),
        model: asString(item.model),
        model_id: asNullableString(item.model_id),
      });
    }
  }

  return { meta, data: { events } };
}

export function validateOptionalSellerMetadata(raw: unknown): OptionalSellerMetadata | null {
  if (!isRecord(raw) || raw.configured !== true || !isRecord(raw.data)) return null;
  const d = raw.data;
  return {
    version: asNullableNumber(d.version),
    displayName: asNullableString(d.displayName),
    totalServices: asNumber(d.totalServices, 0),
    currentLoad: asNumber(d.currentLoad, 0),
    maxConcurrency: asNumber(d.maxConcurrency, 0),
    onChainChannelCount: asNullableNumber(d.onChainChannelCount),
    onChainGhostCount: asNullableNumber(d.onChainGhostCount),
    timestamp: asNullableNumber(d.timestamp),
  };
}
