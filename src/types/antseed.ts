export interface ApiMeta {
  as_of_block: number | null;
  as_of_ts: number | null;
  indexer_lag_blocks: number | null;
  generated_at: number | null;
  max_age_s: number | null;
}

export interface VerificationEntry {
  kind: string;
  target: string;
  verified: boolean;
  href: string | null;
}

export interface TrustParts {
  history: number | null;
  usage: number | null;
  power: number | null;
  identity: number | null;
  identity_kind: string | null;
  free_models: number | null;
  epoch: number | null;
}

export interface ModelChecksSummary {
  same: number;
  diff: number;
  points_multiplier: number | null;
  read_ts: number | null;
}

export interface SellerDetail {
  address: string;
  agent_id: string | null;
  peer_id: string | null;
  name: string | null;
  model_checks: ModelChecksSummary | null;
  rank: number | null;
  share: number | null;
  revenue_micro: number;
  revenue_7d_micro: number;
  revenue_prev_7d_micro: number;
  fees_micro: number;
  settles: number;
  channels: number;
  buyers: number;
  tokens: number;
  requests: number;
  reputation: number | null;
  trust: TrustParts | null;
  ghost_rate: number | null;
  stake_usdc: number | null;
  verified: boolean;
  verification: VerificationEntry[];
  live: boolean;
  wash_registry: boolean;
  organic: boolean;
  tee_advertised: boolean;
  first_settle_ts: number | null;
  last_settle_ts: number | null;
}

export interface SellerDirectoryRow {
  address: string;
  agent_id: string | null;
  name: string | null;
  verified: boolean;
  live: boolean;
  tee_advertised: boolean;
  revenue_micro: number;
  revenue_6h_micro: number;
  revenue_prev_6h_micro: number;
  revenue_24h_micro: number;
  revenue_prev_24h_micro: number;
  revenue_7d_micro: number;
  revenue_30d_micro: number;
  revenue_prev_30d_micro: number;
  fees_micro: number;
  settles: number;
  channels: number;
  tokens: number;
  tokens_24h: number;
  tokens_7d: number;
  tokens_30d: number;
  requests: number;
  models: number;
  reputation: number | null;
  ghost_rate: number | null;
  organic: boolean;
  first_settle_ts: number | null;
  last_settle_ts: number | null;
}

export interface AdvertisedModel {
  model: string;
  model_display: string;
  advertised_as: string;
  input_usd_per_m: number | null;
  cached_input_usd_per_m: number | null;
  output_usd_per_m: number | null;
  free: boolean;
  protocols: string | null;
  list_input_usd_per_m: number | null;
  save_pct: number | null;
  modality: string;
  model_check: string | null;
  health: string | null;
  health_reason: string | null;
  health_checked_ts: number | null;
  health_not_served: boolean;
  requests_last_hour: number | null;
  success_rate: number | null;
  first_token_ms_p50: number | null;
}

export interface SoldModel {
  model: string;
  model_display: string;
  settled_micro: number;
  tokens: number;
  requests: number;
  buyers: number;
}

export interface SellerModelsData {
  address: string;
  model_checks: ModelChecksSummary | null;
  advertised: AdvertisedModel[];
  sold: SoldModel[];
}

export interface DailyPoint {
  day: string;
  settled_micro: number;
  fees_micro: number;
  settles: number;
  buyers: number;
  tokens_in: number | null;
  tokens_out: number | null;
}

export interface SellerDailyData {
  address: string;
  from: string;
  to: string;
  days: DailyPoint[];
}

export interface ModelCheckRecord {
  service: string;
  model: string;
  model_id: string | null;
  model_display: string | null;
  epoch: number;
  audited_ts: number | null;
  verdict: string;
  close_call: boolean;
  not_tested: string | null;
  valid_until_epoch: number | null;
  counts_now: boolean | null;
  diffs: number | null;
  total: number | null;
  proof_url: string | null;
}

export interface SellerChecksData {
  address: string;
  agent_id: string | null;
  name: string | null;
  epoch: number | null;
  unread: number | null;
  evidence_missing: number | null;
  live: {
    same: number;
    diff: number;
    points_multiplier: number | null;
  } | null;
  models: ModelCheckRecord[];
}

export interface IndexerSubsystem {
  key: string;
  status: string;
  detail: string;
}

export interface NetworkStatusData {
  overall: string;
  head_block: number | null;
  last_indexed_block: number | null;
  lag_blocks: number | null;
  subsystems: IndexerSubsystem[];
}

export interface FailingServiceEntry {
  seller: string;
  seller_name: string | null;
  advertised_as: string;
  reason: string | null;
  reason_label: string | null;
  http_status: number | null;
  since_ts: number | null;
  checked_ts: number | null;
}

export interface NetworkHealthData {
  at_ts: number | null;
  services: number;
  healthy: number;
  failing: number;
  failing_services: FailingServiceEntry[];
  not_served_services: FailingServiceEntry[];
}

export interface ModelSellerOffer {
  address: string;
  agent_id: string | null;
  name: string | null;
  advertised_as: string;
  input_usd_per_m: number | null;
  cached_input_usd_per_m: number | null;
  output_usd_per_m: number | null;
  free: boolean;
  save_pct: number | null;
  reputation: number | null;
  verified: boolean;
  organic: boolean;
  proven: boolean;
  trusted: boolean;
  live: boolean;
  health: string | null;
  health_reason: string | null;
  model_check: string | null;
  requests_last_hour: number | null;
  success_rate: number | null;
}

export interface ModelMarketData {
  model: string;
  display: string;
  sellers: ModelSellerOffer[];
}

export interface ChannelItem {
  channel_id: string;
  buyer: string;
  seller: string;
  seller_name: string | null;
  settled_micro: number;
  settles: number;
  first_seen_ts: number;
  last_activity_ts: number;
}

export interface ChannelsData {
  stats: {
    opened: number;
    active: number;
    settled: number;
    closed: number;
  };
  channels: ChannelItem[];
}

export interface RequestEvent {
  tx: string;
  block: number;
  ts: number;
  channel_id: string;
  buyer: string;
  seller: string;
  seller_name: string | null;
  model: string;
  model_display: string;
  free: boolean;
  requests: number;
  tokens_in: number;
  tokens_cached: number;
  tokens_out: number;
  settled_micro: number;
}

export interface RequestsData {
  events: RequestEvent[];
}

export interface TransactionEvent {
  tx: string;
  block: number;
  ts: number;
  kind: string;
  account: string;
  account_name: string | null;
  value: number;
  unit: string;
  model: string;
  model_id: string | null;
}

export interface TransactionsData {
  events: TransactionEvent[];
}

export interface OptionalSellerMetadata {
  version: number | null;
  displayName: string | null;
  totalServices: number;
  currentLoad: number;
  maxConcurrency: number;
  onChainChannelCount: number | null;
  onChainGhostCount: number | null;
  timestamp: number | null;
}

export interface MergedSellerProfile {
  address: string;
  name: string;
  agentId: string;
  live: boolean;
  verified: boolean;
  verification: VerificationEntry[];
  organic: boolean;
  washRegistry: boolean;
  teeAdvertised: boolean;
  rank: number | null;
  share: number | null;
  revenueLifetimeMicro: number;
  revenueTodayMicro: number;
  revenue24hMicro: number;
  revenuePrev24hMicro: number | null;
  revenue7dMicro: number;
  revenuePrev7dMicro: number;
  revenue30dMicro: number;
  revenuePrev30dMicro: number | null;
  feesMicro: number;
  derivedPlatformFee: number;
  settles: number;
  channels: number;
  buyers: number;
  requests: number | null;
  tokens: number | null;
  tokens24h: number | null;
  tokens7d: number | null;
  tokens30d: number | null;
  reputation: number | null;
  reputationSource: 'detail' | 'directory' | 'unavailable';
  trust: TrustParts | null;
  ghostRate: number | null;
  stakeUsdc: number | null;
  firstSettleTs: number | null;
  lastSettleTs: number | null;
  liveChecksSame: number | null;
  liveChecksDiff: number | null;
  pointsMultiplier: number | null;
}

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  actionLabel?: string;
  actionTo?: string;
}
