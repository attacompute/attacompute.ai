# attacompute.ai

Website repository for **attacompute.ai** — an AI-inference seller on the AntSeed peer-to-peer marketplace (ERC-8004 Agent `#47214`).

## Seller Dashboard (`/dashboard`)

The public-safe seller dashboard lives under `/dashboard` (`/dashboard`, `/dashboard/pricing`, `/dashboard/live`), structured so the future marketing homepage can mount directly at `/` inside the same Cloudflare Pages project without changing dashboard links or asset paths.

### Pages

1. **Overview (`/dashboard`)** — Calm, high-signal operational status: DHT listing status, last settlement age, indexer lag, derived "needs attention" alerts, settled revenue (`Today` / `7d` / `30d` with daily UTC chart), trust score vs the `60` default buyer routing threshold, active buyers & channels, requests & tokens, top models by revenue, and model-check verdicts (`SAME` / `DIFF`).
2. **Pricing (`/dashboard/pricing`)** — Interactive pricing & fallback-peer workbench for every advertised text model: input / cached-input / output sliders and precise `$` inputs, competitor unlock-price tick tracks, live market rank & median preview, and real-time highlighting of fallback peers that **become available** or **drop out**. Uses the public fallback ceiling `peerPrice <= ourPrice × (1 - platformFee) × (1 - extraHeadroomPct / 100)`, deriving `platformFee` from public chain data (`fees_micro / revenue_micro`, ≈4%) with an optional user-controlled extra headroom % defaulting to `0%`. Supports batch edits, undo/redo, reset, and a review drawer.
3. **Live (`/dashboard/live`)** — Lazy-loaded interactive Three.js 3D topology of **Buyers → attacompute.ai → Direct upstream & AntSeed fallback peers**, driven by public channels, settlements, request events, and eligible fallback peers. Features responsive resizing, `devicePixelRatio` capping, adaptive quality scaling, visibility-change pausing, `prefers-reduced-motion` support, WebGL detection, and a first-class interactive 2D SVG fallback toggle.

### Stack & Structure

- **Vite + React 19 + TypeScript (strict)**: Static asset bundle ideal for Cloudflare Pages/Workers with zero backend required for read views.
- **Route & 3D Code Splitting**: `LivePage` and `three` are lazy-loaded chunks so Overview and Pricing remain lightweight (`npm run check:bundle` enforces size budgets and verifies `three` is never in initial JS).
- **Custom CSS Design Tokens**: Dark ("Obsidian Telemetry") and Light ("Alabaster Instrument") themes meeting WCAG AA contrast, responsive from `360px` to `2560px`, with tabular numerals and keyboard focus management.
- **Future Homepage Integration**: Routes are mounted at `/dashboard/*` with `/` redirecting to `/dashboard` until the homepage is added. Deploying under an external root site at `/dashboard/` is also supported via `VITE_BASE_PATH=/dashboard/`.

### Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:5173/dashboard` (or append `?fixture=1` to preview with sanitized offline sample data).

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite dev server |
| `npm run typecheck` | Run strict TypeScript check (`tsc -b --noEmit`) |
| `npm run lint` | Run ESLint (TypeScript, React Hooks, `jsx-a11y`) |
| `npm test` | Run Vitest unit & component tests |
| `npm run build` | Production build to `dist/` |
| `npm run check:bundle` | Verify initial JS/CSS gzip budgets and lazy 3D chunking |
| `npm run verify` | Run typecheck, lint, tests, build, and bundle check |

### Environment Variables

All variable names and placeholder defaults are documented in [`.env.example`](./.env.example). Never place secrets in `VITE_*` variables (they are embedded in the client bundle).

- `VITE_BASE_PATH` — Static base path (default `/`).
- `VITE_ANTSEEDSTATS_API_BASE` — Public AntSeedStats API base URL (default `https://antseedstats.com/api/v1`).
- `VITE_SELLER_ADDRESS` — Public on-chain seller address.
- `VITE_SELLER_NAME` — Public seller display name (`attacompute.ai`).
- `VITE_AGENT_ID` — Public ERC-8004 agent ID (`47214`).
- `VITE_PRICE_CHANGE_REPO` — GitHub `owner/repo` target for prefilled price-change issues (default `attacompute/node`).
- `VITE_PRICE_CHANGE_LABEL` — Label applied to prefilled GitHub issues (default `price-change`).
- `VITE_PRICE_CHANGE_WEBHOOK_URL` — Optional POST endpoint for Submit-for-change (empty / disabled by default; see below).
- `VITE_SELLER_METADATA_PROXY_URL` — Optional proxy URL (e.g. `/api/seller-metadata`) for enriching concurrency/load from the seller's public `/metadata`. Disabled by default; degrades silently when unset.
- `SELLER_METADATA_URL` *(server-side Cloudflare Pages env var only)* — Upstream URL read by `functions/api/seller-metadata.ts` if the optional metadata proxy is enabled. The function strips raw network addresses (`publicAddress`) before responding.

### Public Data Sources & Rate-Limit Etiquette

All read views fetch directly in the browser from the public [AntSeedStats API](https://antseedstats.com/api/v1) (open CORS, ~300 s server cache):

- `/sellers/{address}`, `/sellers`, `/sellers/{address}/models`, `/sellers/{address}/daily`, `/sellers/{address}/checks`
- `/models/{id}` (with `/prices?model={id}` fallback)
- `/channels`, `/requests`, `/transactions`, `/status`, `/network/health`

The client validates all consumed fields at runtime, caches catalog responses for 5 minutes and live feeds for 45 seconds, polls no faster than once per 60 seconds (pausing when the tab is hidden), deduplicates concurrent requests, caps parallel model queries to 4, and backs off exponentially on HTTP `429`.

### How "Submit for Change" Works

**This dashboard never modifies live seller prices.** All slider adjustments are client-side previews.

Opening **Submit for change** generates a structured JSON proposal (`schemaVersion: "attacompute.price-change.v1"`) containing every modified model, field, old → new rate, `%` change, timestamp, market rank impact, and gained/dropped fallback peers. From the review drawer, the operator can:

1. **Open a prefilled GitHub issue** under their own GitHub login in `VITE_PRICE_CHANGE_REPO` with label `VITE_PRICE_CHANGE_LABEL`. If the payload exceeds GitHub's safe URL length limit, the full Markdown + JSON is copied to the clipboard automatically and the issue opens ready to paste.
2. **Copy JSON** to the clipboard.
3. **Download JSON** as a timestamped `.json` file.
4. *(Optional, off by default)* **POST JSON** to `VITE_PRICE_CHANGE_WEBHOOK_URL`. If you configure this endpoint at deploy time, protect it behind **Cloudflare Access** so only authorized operators can submit proposals.

Live repricing always requires operator approval and the normal seller deployment workflow.

### Deploying to Cloudflare Pages

1. Connect `attacompute/attacompute.ai` in Cloudflare Pages.
2. Build command: `npm run build`
3. Build output directory: `dist`
4. `public/_redirects` is automatically copied into `dist/_redirects` to handle SPA routing for `/dashboard`, `/dashboard/pricing`, and `/dashboard/live`.
5. *(Optional)* To enable the seller `/metadata` proxy without mixed-content HTTP issues, set `SELLER_METADATA_URL` (server-side secret/env) and `VITE_SELLER_METADATA_PROXY_URL=/api/seller-metadata` in Cloudflare Pages settings.
