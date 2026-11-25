# Build Notes — attacompute.ai Redesign

Date: 2026-11-20  
Branch: `redesign/texan-site`

## 1. Design Concept & Brand Identity

**attacompute** is an independent AI inference provider on the AntSeed peer-to-peer network, operated from Texas (`"Compute, cultivated."`). The redesign keeps a clean, editorial, developer-trustworthy surface anchored in attacompute's rust-and-cream palette:

- **Palette (`start.mjs brand`, `<html data-ground="sand">`)**:
  - Background sand `#f5f0e6`, surface `#ebe3d5`, espresso ink `#1f1916`, warm muted `#68625d`
  - Primary terracotta rust `#a84832` (drawn directly from the original ant head mark)
  - Secondary teal `#2a7f7e` for verified TEE badges, free-model accents, and the active TEE seller series in the settlement chart
- **Self-hosted typography (`funnel` pair + monospace)**:
  - `Funnel Display`, `Funnel Sans`, and `DM Mono` served as 4 subset `.woff2` files in `assets/fonts/` (52 KiB total, zero third-party font CDNs), preloaded with `crossorigin` in `<head>`.
- **Brand Mark (Original Ant)**:
  - Generated faithfully from the original rust ant head raster (`#ae4b33` on cream) with a colour-distance alpha key so antialiased edges stay clean on every ground.
  - Exported across `assets/brand/logo-mark-{64,128,256,512}.{png,webp}`, `favicon.ico`, `assets/brand/favicon-{16,32,48}.png`, `assets/brand/apple-touch-icon.png`, `assets/brand/icon-512.png`, `assets/profile.png` (512×512, 15.7 KB for legacy social-preview links), and `assets/brand/og-image.png` (1200×630) via `scripts/render-brand-assets.mjs`.

## 2. Architecture, Continuity & Live Data Pipeline

- **Static Cloudflare Pages output + Pages Function (`/api/models`)** with zero build server or runtime secrets.
- **Route & Header Continuity with Live Site (`_headers`, `_redirects`, `404.html`, `robots.txt`, `sitemap.xml`)**:
  - `_headers` scopes `Strict-Transport-Security: max-age=15552000` (no `includeSubDomains`) to `https://attacompute.ai/*` and `https://d5v1n2.com/*`, adds `X-Robots-Tag: noindex` for `https://d5v1n2.pages.dev/*` and `https://:version.d5v1n2.pages.dev/*`, allows Cloudflare Web Analytics (`https://static.cloudflareinsights.com` in `script-src`, `https://cloudflareinsights.com` in `connect-src`), and covers `/api/models` and `/data/models-snapshot.json` via `connect-src 'self'`.
  - `_redirects` maps legacy paths (`/about`, `/about/` → `/#trust`; `/contact`, `/contact/` → `/#contact`; `/models`, `/models/` → `/#models`) via 301 redirects.
  - Subpages live at `/connect/` (`connect/index.html`), `/privacy/` (`privacy/index.html`), and `/terms/` (`terms/index.html`) so Cloudflare Pages' automatic `.html` handling never loops.
  - Includes an on-brand `404.html` (with the original ant emblem and links to `/` and `/connect/`), `robots.txt`, and `sitemap.xml`.
  - Contact block (`#contact` in the home footer, plus footer links on every page) lists `dev@attacompute.ai` (`mailto:`) and `@AttaCompute` on X (`https://x.com/AttaCompute`) with guidance to include the model, approximate time, and request ID if available and to keep keys and wallet secrets out of public posts.
  - Copy accurately describes attacompute as operated from Texas while its Phala TEE peer runs on Phala Cloud (`"AI inference, operated from Texas"`).
- **Live Seller Metadata Proxy (`functions/api/models.js`, `functions/_lib/models.js`)**:
  - Serves `GET /api/models` as a Cloudflare Pages Function so HTTPS visitors on `attacompute.ai` pull live models, per-token prices, and per-model health directly from attacompute's own seller metadata endpoint (`http://66.220.6.105:14324/metadata` with `x-antseed-metadata-version: 18`) without mixed-content or CSP issues.
  - Uses a 5-second upstream timeout and `cloudflare:sockets` raw TCP HTTP/1.1 transport for raw-IP / custom-port origins (since Cloudflare Workers' standard `fetch()` restricts direct IP / non-standard port origins in production), with automatic `fetch()` support for standard HTTPS/HTTP hostnames or local dev. Optional Cloudflare Pages environment variables `SELLER_METADATA_URL` and `SELLER_METADATA_VERSION` allow overriding the upstream target (for example, to an HTTPS hostname or Cloudflare Tunnel) without a code change.
  - Pure mapping module `functions/_lib/models.js` (underscored so Cloudflare Pages excludes it from public route generation) maps upstream providers into minimal public JSON (`{ updatedAt, models: [{ model, input, cachedInput, output, free, health }] }`) and strips signatures, channel counts, IPs, peer IDs, capabilities, and performance internals.
  - Caches `200 OK` responses at the Cloudflare edge via the Cache API (`caches.default`, canonicalized without query params) and `cf: { cacheTtl: 60, cacheEverything: true }` with `Cache-Control: public, max-age=60, stale-while-revalidate=300`, plus explicit security headers (`X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy`, `X-Robots-Tag: noindex`, because `_headers` only applies to static assets and not Pages Functions).
  - Returns `502 Bad Gateway` JSON with `Cache-Control: no-store` on any upstream failure, timeout, or empty provider list (without leaking upstream IPs or error details) so the client falls back seamlessly.
- **Live Models Table & Honest Fallback Chain (`assets/site/app.js`, `data/models-snapshot.json`)**:
  - Fetches `/api/models` first for `#models` and `[data-stat="model-count"]`; falls back to `localStorage` (`attacompute_models_v1`), then to the build-time seller-metadata snapshot `data/models-snapshot.json` (with `data/snapshot.json` and static HTML rows as final fallbacks so CLS stays ~0).
  - Tracks models and stats status labels independently (`[data-models-updated-label]` vs `[data-stats-updated-label]`) so `"Live"`, `"Cached"`, and `"Snapshot"` indicators remain honest if either upstream is offline.
  - Merges existing display names, modality, and price-matched savings from `data/models-snapshot.json` / AntSeedStats metadata only where they already exist; never invents prices and suppresses stale savings percentages if a live price changed.
  - Displays semantic per-model health status (`Healthy`, `Degraded`, `Offline`) with both shape and text indicators (never color alone) and `@media (forced-colors: active)` support.
- **Live AntSeedStats integration (`assets/site/app.js`, `assets/site/chart.js`)**:
  - Fetches `https://antseedstats.com/api/v1` for on-chain settlement telemetry and daily volume series across both the active Phala TEE seller (`0x6c8044f5e6fb2ad70dd31fd7a20fae05a73fa139`) and the original seller (`0xd5e7d5950b6cc71c095da4ace0c0cb8495667be0`).
  - Caches stats payloads in `localStorage` (`attacompute_antseedstats_v1`) with a 5-minute refresh; falls back immediately to `data/snapshot.json` (generated by `scripts/snapshot.mjs`) if the API is unreachable.
  - Stitches daily settled gross USDC across both sellers (May 9, 2026 through present) into a clean inline SVG bar chart (`#stats`) with an explicit **Nov 18, 2026** TEE switchover marker and keyboard/pointer bar inspection.
  - Displays gross on-chain settled USDC clearly labeled as gross before protocol fees, never net profit, alongside an explicit CC BY 4.0 attribution link to AntSeedStats.
- **Interactive Models & Pricing Table (`#models`)**:
  - Live searchable, filterable (`All`, `Text`, `Free`, plus `Image`/`Video` automatically when advertised), and sortable per-token pricing table with one-click copy of `<peerId>@<advertised_as>` pinned model IDs.
  - Progressive compact view (6 rows on desktop, 4 on mobile) with a one-click toggle to show all advertised models.
- **OS-Detecting AntSeed Desktop Download & Connection Docs (`#download`, `#connect`, `/connect/`)**:
  - Detects macOS Apple silicon vs Intel, Windows x64, and Linux x64/arm64 (via `navigator.userAgentData` + WebGL renderer/UA fallback) to highlight the matching direct `download.antseed.com/vpr/<platform>` installer.
  - Dedicated `/connect/` guide covers AntSeed Desktop, direct buyer CLI (`localhost:8377`), and AntSeed Gateway with per-app API keys (`localhost:8379` + `/console`), with copy buttons on every command.

## 3. taste-skill (`design-taste-frontend` v2.5.1) Record

- **Classification**: `software` (`page-type="software"`, `site-kind="software"`).
- **Deals**:
  - Hero: `centred` (`data-enter`) with live AntSeed Gateway preview frame on `gradient-mesh`.
  - Structure: `nav-mega`, `footer-statement`, `close-type`, `surface-pairs`, `solid` buttons, client original ant mark.
  - Backgrounds: `plain`, `surface` (`#models`, `#download`), `plain` (`#connect` with baked `grain-gradient` still panels), `bg-band` (`#trust`), `bg-mist` (`#faq`).
  - Moment: `liquid-type` on `#trust` (`Compute, cultivated.`).
- **Voice & Copy Lint**:
  - Plain, factual infrastructure voice; zero generic AI SaaS clichés; every claim backed by verifiable on-chain or official AntSeed docs.
  - `copy-lint.mjs index.html --kind software`: **0 FAIL**, 1 non-blocking WARN (`copy-stat-strip` on live AntSeedStats counters).
- **Moments Check**:
  - `moments.mjs check index.html --page software --effects gradient-mesh,grain-gradient`: **ok** (`1 moment liquid-type`, WebGL 2 of 4).
- **Layout Check (`assets/layout/check.mjs`)**:
  - `index.html` at `1440x900,1280x800,1024x768,834x1194,768x1024,390x844`: **0 findings** across all six viewports.
  - `connect/index.html` and `404.html` at `1440x900,1024x768,768x1024,390x844`: **0 findings** across all viewports.
  - Hero gateway window (`.hero__window` vs `.ly-piece` content height):
    - `1440×900`: window `356px`, content `253px` (top/bottom clearance `52px`, badge row clearance `40px`)
    - `1280×800`: window `319px`, content `228px` (top/bottom clearance `46px`, badge row clearance `39px`)
    - `1024×768`: window `305px`, content `228px` (top/bottom clearance `39px`, badge row clearance `39px`)
    - `390×844`: window `266px`, content `242px` (top/bottom clearance `12px`, badge row clearance `11px`)
- **Finish Gate (`scripts/gate.mjs index.html`)**:
  - **`GATE: PASS`** (0 open FAIL, 0 waivers, 24 non-blocking WARNs).
- **Performance Audit (`scripts/perf.mjs index.html`)**:
  - 1440px: LCP **80 ms**, FCP **64 ms**, CLS **0.000**, TBT **0 ms** (WebGL off), total transfer **266.8 KiB**, **0 broken requests**, 0 oversized images.
  - 390px: LCP **72 ms**, FCP **48 ms**, CLS **0.000**, TBT **0 ms** (WebGL off), total transfer **263.1 KiB**, **0 broken requests**, 0 oversized images.
- **Console & CSP Verification**:
  - Verified in headless Chrome with `_headers` Content-Security-Policy active across `/`, `/connect/`, `/privacy/`, `/terms/`, and `/404.html`: **0 console errors** on every page.

## 4. Modern Web Guidance Applied

All retrieved Modern Web Guidance guides were applied directly to the implementation:

- **`responsive-table`**: Wrapped `#models` table in a keyboard-scrollable `tabindex="0" role="region" aria-labelledby` container with `container-type: inline-size` and `@container (width < 680px)` stacked card layout injecting CSS-variable labels via `::before`.
- **`sortable-table`**: `<button type="button" commandfor="models-table" command="--sort">` inside each sortable `<th scope="col">`, `aria-sort` applied only on the active column header, `Intl.Collator` (`numeric: true, sensitivity: 'base'`) + numeric `data-value` comparison, in-place row reordering with `moveBefore()` (and `appendChild()` fallback) without rebuilding `<tbody>`, and a single visually hidden `role="status"` live region.
- **`copy-button`**: Declarative Invoker Commands (`command="--copy" commandfor="..."`) with single-path fallback when `!('CommandEvent' in window)`, `min-inline-size`/`min-block-size`, explicit `aria-label` on icon-only buttons, and sibling `role="status"` confirmation bubbles outside `<button>` (using `\u00A0` toggle for VoiceOver repeat announcements).
- **`security`**: Strict `_headers` CSP with exact SHA-256 script hashes (zero `'unsafe-inline'` scripts), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy`, HSTS, and zero `innerHTML` DOM sinks (`textContent` + `createElement` only).
- **`performance`** & **`optimize-image-priority`**: Self-hosted `.woff2` font preloads with `crossorigin` and no `fetchpriority="high"`, `fetchpriority="high"` exclusively on the above-the-fold hero mark, `loading="lazy"` on below-fold icons/marks without `fetchpriority="low"`, `type="module"` deferred scripts, and bfcache-safe `Cache-Control` (no `no-store`).
- **`color`**: `color-mix(in oklab, ...)` (avoiding `in oklch` with neutrals), WCAG AA contrast verified across sand/surface/dark-terminal surfaces, non-color state indicators, and `@media (forced-colors: active)` system-color borders and highlights.
- **`motion`**: Opt-in motion inside `@media (prefers-reduced-motion: no-preference)`, compositor-friendly transitions, and visible static final states.
- **`improve-text-layout-and-legibility`**: Scoped `text-wrap: balance` to headings and `text-wrap: pretty` to paragraphs/list items rather than globally.

## 5. Screenshots Captured

Verified visually and compressed in headless Chrome (`scripts/capture-screenshots.mjs`, total **2.78 MiB** < 3 MB):

- `docs/screenshots/home-1440.png` (1,440.3 KB) — Home page full length at 1440×900
- `docs/screenshots/models-1440.png` (87.5 KB) — Live models & pricing table at 1440×900
- `docs/screenshots/home-390.png` (856.0 KB) — Home page full length at 390×844
- `docs/screenshots/connect-1440.png` (246.9 KB) — `/connect/` guide full length at 1440×900
- `docs/screenshots/connect-390.png` (216.6 KB) — `/connect/` guide full length at 390×844

## 6. Operational Notes

- **Base64 noise tile (`--g-noise-soft`)**: `assets/site/site.css` overrides `--g-noise-soft` with a base64-encoded equivalent of the SVG noise filter from `assets/backgrounds/backgrounds.css`, eliminating the stray `/%23n` sub-request without modifying any kit file (`perf.mjs` reports `0 broken requests`).
- **Dynamic modality tabs**: `assets/site/app.js` renders modality filter buttons for modalities with > 0 advertised models (currently `All (14)`, `Text (14)`, `Free (1)`), and automatically adds `Image` or `Video` chips whenever the seller advertises those modalities live.
- **CSP hash maintenance**: `_headers` pins the exact SHA-256 hashes of the two small inline `<script>` tags in `index.html`. If either inline `<script>` changes, recompute its SHA-256 hash and update `_headers`.
- **Snapshot refresh**: Run `node scripts/snapshot.mjs` (or `node scripts/snapshot.mjs --models-only`) anytime to refresh `data/models-snapshot.json` and `data/snapshot.json` from live seller metadata + AntSeedStats. `snapshot.mjs` explicitly strips internal/upstream fields (`list_source`, `signature`, IPs, channel counts, etc.) so only minimal public display data is written.
- **Unit tests**: Run `node --test test/models.test.mjs` to verify seller-metadata → public-JSON mapping, field stripping, free-tier detection, display-metadata merging, raw HTTP/1.1 parsing, edge caching, and `502` error handling.

## 7. Deployment (Cloudflare Pages + Pages Functions)

- **Project setup (`README.md` / `_headers`)**: This repository is documented as a **git-connected Cloudflare Pages project** (`d5v1n2.pages.dev` / `attacompute.ai`, Framework preset `None`, empty build command, build output directory `/`).
- **Deploying Pages Functions**: Cloudflare Pages automatically discovers and compiles `functions/api/models.js` (ignoring `functions/_lib/models.js` because of its leading underscore) and deploys `/api/models` together with the static site on the next Cloudflare Pages deploy — i.e., **merging and pushing to `main`** on a git-connected Pages project (PR branches also get automatic preview deployments of the Function). If deploying manually via CLI instead of git-push, `npx wrangler pages deploy . --project-name d5v1n2` also bundles `functions/` from the repository root automatically.
- **Optional environment variables**: In Cloudflare Dashboard → **Workers & Pages → Settings → Variables and Secrets**, you may optionally set `SELLER_METADATA_URL` (defaults to `http://66.220.6.105:14324/metadata`) and `SELLER_METADATA_VERSION` (defaults to `18`) if you later put a hostname or Cloudflare Tunnel in front of the seller metadata service.
- **Post-deploy verification**:
  1. `curl -i https://attacompute.ai/api/models` — expect `200 OK`, `Cache-Control: public, max-age=60, stale-while-revalidate=300`, and minimal `{ updatedAt, models }` JSON with no signatures, IPs, or channel counts.
  2. Visit `https://attacompute.ai/#models` (or `/models`, which 301-redirects to `/#models`) and confirm the table displays live models with `"Live · Updated …"` status and `"Source: Live seller metadata"`.
