# attacompute.ai

Public website for **attacompute** — an independent AI inference provider (seller) on the [AntSeed](https://antseed.com) peer-to-peer AI network, operated from Texas.

> Independent operator. Not affiliated with the AntSeed Foundation.

## What is in this repo

- Static HTML, CSS, and vanilla ES modules deployable directly to **Cloudflare Pages** with zero build server required.
- Hand-crafted Texan ant SVG logo suite (`assets/brand/logo-mark.svg`, `assets/brand/logo-lockup.svg`, `favicon.svg`, PNG icons at 32/180/512, and 1200×630 OG image).
- Self-hosted fonts (`Funnel Display`, `Funnel Sans`, `DM Mono`) in `assets/fonts/` — no third-party font CDNs.
- Live on-chain telemetry and advertised model pricing from the public [AntSeedStats API](https://antseedstats.com/developers) (CC BY 4.0), with `localStorage` caching, 5-minute background refresh, and a build-time fallback snapshot (`data/snapshot.json`).
- Dedicated pages:
  - `/` (`index.html`) — Hero, live stitched stats & daily USDC chart, searchable/sortable models & pricing table, OS-aware AntSeed Desktop download, Desktop/CLI connect guide, trust & Phala TEE verification, FAQ, and footer.
  - `/connect/` (`connect/index.html`) — Complete Desktop, direct Buyer CLI (`:8377`), Gateway CLI (`:8379`), and OpenAI SDK connection guide with copy-to-clipboard commands.
  - `/privacy.html` & `/terms.html` — Plain data handling and terms of use.
- `_headers` — Strict Content Security Policy (`connect-src 'self' https://antseedstats.com`), HSTS, clickjacking protection, and cache rules for Cloudflare Pages.

## Local preview

Serve the repository root with any static HTTP server (never open over `file://`, because ES modules and `data/snapshot.json` require HTTP):

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then visit `http://localhost:3000` (or `http://localhost:8080`).

## Refreshing the fallback snapshot

The site fetches live data client-side from `https://antseedstats.com/api/v1` and falls back to `data/snapshot.json` if the API is unreachable. To refresh the committed snapshot from the public AntSeedStats API:

```bash
node scripts/snapshot.mjs
```

To regenerate the PNG icon fallbacks and OG image from the SVG brand sources (requires local Google Chrome):

```bash
node scripts/render-brand-assets.mjs
```

## Public data sources

- **AntSeedStats API** (`https://antseedstats.com/api/v1`, CC BY 4.0)
  - Current seller (Phala TEE): [`0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139`](https://antseedstats.com/sellers/0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139)
  - Original seller (history since May 2026): [`0xd5e7d5950b6cc71c095da4ace0c0cb8495667be0`](https://antseedstats.com/sellers/0xd5e7d5950b6cc71c095da4ace0c0cb8495667be0)
- **AntSeed Desktop & Docs**: [antseed.com/docs/desktop/](https://antseed.com/docs/desktop/), [antseed.com/docs/quickstart/](https://antseed.com/docs/quickstart/), [antseed.com/docs/gateway/](https://antseed.com/docs/gateway/)

## Deploying on Cloudflare Pages

This site requires **no build step**:

1. Connect the repository in **Cloudflare Dashboard → Workers & Pages → Create → Pages**.
2. Set **Framework preset** to `None`.
3. Leave **Build command** empty and set **Build output directory** to `/` (root).
4. Cloudflare Pages automatically applies `_headers` for CSP, security headers, and static asset caching.

(Optional) Add a scheduled CI job or run `node scripts/snapshot.mjs` periodically to keep `data/snapshot.json` fresh.
