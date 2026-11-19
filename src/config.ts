export interface AppConfig {
  basePath: string;
  apiBase: string;
  sellerAddress: string;
  sellerAddressLower: string;
  /** Other public wallets of ours (retired seller wallets); never counted as fallback peers or competitors. */
  ownAddresses: string[];
  sellerName: string;
  agentId: string;
  priceChangeRepo: string;
  priceChangeLabel: string;
  priceChangeWebhookUrl: string | null;
  sellerMetadataProxyUrl: string | null;
  useFixtures: boolean;
}

const DEFAULT_SELLER_ADDRESS = '0x6C8044f5E6fb2aD70dD31FD7A20FAE05A73FA139';
// Retired seller wallet (public on-chain). AntSeedStats still lists it as "attacompute.ai".
const DEFAULT_OWN_ADDRESSES = ['0xD5E7d5950B6CC71c095DA4ACE0C0CB8495667be0'];
const DEFAULT_API_BASE = 'https://antseedstats.com/api/v1';

function readEnv(key: string): string {
  const val = (import.meta.env as Record<string, unknown>)[key];
  return typeof val === 'string' ? val.trim() : '';
}

function detectFixtureMode(): boolean {
  if (readEnv('VITE_USE_FIXTURES') === 'true') return true;
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('fixture') === '1';
    } catch {
      return false;
    }
  }
  return false;
}

export function getAppConfig(): AppConfig {
  const sellerAddress = readEnv('VITE_SELLER_ADDRESS') || DEFAULT_SELLER_ADDRESS;
  const apiBase = (readEnv('VITE_ANTSEEDSTATS_API_BASE') || DEFAULT_API_BASE).replace(/\/+$/, '');
  const rawBase = readEnv('VITE_BASE_PATH') || import.meta.env.BASE_URL || '/';
  const basePath = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const webhook = readEnv('VITE_PRICE_CHANGE_WEBHOOK_URL') || null;
  const metadataProxy = readEnv('VITE_SELLER_METADATA_PROXY_URL') || null;

  return {
    basePath,
    apiBase,
    sellerAddress,
    sellerAddressLower: sellerAddress.toLowerCase(),
    ownAddresses: (readEnv('VITE_OWN_ADDRESSES') || DEFAULT_OWN_ADDRESSES.join(','))
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a) && a !== sellerAddress.toLowerCase()),
    sellerName: readEnv('VITE_SELLER_NAME') || 'attacompute.ai',
    agentId: readEnv('VITE_AGENT_ID') || '47214',
    priceChangeRepo: readEnv('VITE_PRICE_CHANGE_REPO') || 'attacompute/node',
    priceChangeLabel: readEnv('VITE_PRICE_CHANGE_LABEL') || 'price-change',
    priceChangeWebhookUrl: webhook,
    sellerMetadataProxyUrl: metadataProxy,
    useFixtures: detectFixtureMode(),
  };
}

export const TRUST_THRESHOLD = 60;
export const DEFAULT_PLATFORM_FEE = 0.04;
export const POLL_INTERVAL_MS = 60_000;
export const CATALOG_CACHE_TTL_MS = 300_000;
export const LIVE_CACHE_TTL_MS = 45_000;
