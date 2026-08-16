# 🌐 one-api-cf

> **README Languages / README 语言:** 🌐 [English](README.en.md) | [简体中文](README.md)

<div align="center">
<h1>One API on Cloudflare (one-api-cf)</h1>

A distributed, low-latency, high-performance AI unified gateway built on Cloudflare Workers — with channel management, load balancing, and usage analytics.
</div>

<div align="right">
Credits: built on top of <a href="https://github.com/Tokinx/one-api-workers" target="_blank">one-api-workers</a>, informed by the architecture of <a href="https://github.com/yutian81/ai-gateway" target="_blank">ai-gateway</a>, and inspired by <a href="https://github.com/dreamhunter2333/awsl-one-api" target="_blank">dreamhunter2333/awsl-one-api</a>
</div>

## Overview

- Built on Cloudflare Workers: global distributed network, low latency, high performance
- Unified proxy entry: supports `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/audio/speech`, `/v1/models`
- Load-balancing routing: weight-based routing, multi-key per channel, failure retry, key rotation, and cross-channel fallback
- Quota & billing: token-level quota control, global model pricing, channel-level model pricing
- Observability: writes to Cloudflare Analytics Engine on Workers/Pages; writes to a local database (SQLite/MySQL/PostgreSQL) on Docker/self-hosted — full overview, trends, breakdowns, and usage log search in both modes
- Admin dashboard: React + Vite management UI covering channels, tokens, pricing, API testing, system settings
- Admin security: default admin token login, optional Telegram two-factor verification, rate-limited login chain and session cookies
- API docs: Swagger, ReDoc, and OpenAPI JSON exposed via Chanfana, togglable in system settings

## Supported Scope

### Proxy Endpoints

| Route | Description | Channel Types |
| --- | --- | --- |
| `/v1/chat/completions` | OpenAI Chat Completions compatible proxy | `openai`, `azure-openai`, `gemini` |
| `/v1/messages` | Anthropic Claude Messages compatible proxy | `claude`, `claude-to-openai` |
| `/v1/responses` | OpenAI / Azure Responses proxy | `openai-responses`, `azure-openai-responses` |
| `/v1/audio/speech` | TTS speech generation proxy | `openai-audio`, `azure-openai-audio` |
| `/v1/models` | Model list filtered by token permission & quota | Dynamically returned from token-accessible channels |

## Deployment

Three deployment options — pick any:

### Option 1: GitHub Actions One-Click (Recommended)

**Fork** this repo to your GitHub, configure 3 secrets under **Settings → Secrets and variables → Actions**, and push to `main` to auto-deploy:

| Secret | Description |
|---|---|
| `CF_API_TOKEN` | Cloudflare API Token (Workers + D1 edit permission) |
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `ADMIN_TOKEN` | Admin dashboard login token |

CI automatically creates the D1 database and Analytics Engine dataset, then deploys the Worker. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Option 2: Cloudflare Pages Deployment

Deploy in Pages advanced `_worker.js` mode; the frontend static files are hosted by Pages. Create a Pages project in the Dashboard → bind D1 + Analytics in Settings → trigger the **Deploy to Cloudflare Pages** workflow. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Option 3: Docker Deployment (Self-Hosted)

Run locally / self-hosted with SQLite/MySQL/PostgreSQL — no Cloudflare required:

```bash
docker compose up -d --build             # default SQLite
docker compose --profile mysql up -d
docker compose --profile postgres up -d
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Manual Deployment (Cloudflare Worker)

```bash
# Create D1 database, note its Name & ID
bunx wrangler d1 create one-api-cf

# Enable Analytics Engine and create a dataset, note the dataset Name
# Update the above into wrangler.jsonc

# Set production secrets
wrangler secret put ADMIN_TOKEN
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ACCOUNT_ID

# Deploy the Worker
bun run deploy
```

### Admin Dashboard

Current dashboard pages include:

- `Dashboard`: total requests, success rate, cost, latency, token/channel/model/provider distributions
- `Usage Logs`: filtered detail logs by time range, dimension, keyword, and result
- `Channels`: channel config, weight, auto-retry/rotation, model mapping, fetch upstream model list
- `Tokens`: API token management, channel access scope, quota limits, usage reset
- `Pricing`: global model pricing editing, per-token and per-call billing
- `API Test`: test `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/audio/speech` directly in the dashboard
- `System Settings`: Telegram admin verification, currency display precision, API docs toggle

## Project Structure

```text
one-api-cf/
├── src/
│   ├── admin/                    # Admin API: auth / channel / token / pricing / analytics / system
│   ├── analytics/                # Analytics Engine write & query
│   ├── db/                       # D1 init & migration
│   ├── providers/                # Upstream proxy implementations
│   ├── storage/                  # DB adapter layer (SQLite/MySQL/PostgreSQL) for Docker
│   ├── node-entry.ts             # Node.js runtime entry (Docker)
│   ├── billing.ts                # Billing & money precision
│   ├── channel-config.ts         # Channel config normalization
│   ├── system-config.ts          # System config & Telegram security config
│   └── index.ts                  # Worker entry
├── frontend/
│   ├── src/pages/                # Dashboard / Channels / Tokens / Pricing / Usage Logs / Settings
│   ├── src/components/           # Layout, charts, UI components
│   └── package.json              # Frontend build & lint
├── public/                       # Frontend build output, served by the Worker
├── docs/                         # Docs & security guide
├── tests/                        # Mock upstream + local E2E scripts
├── wrangler.jsonc                # Production config
├── wrangler.local.jsonc          # Local Worker config
├── Dockerfile                    # Docker build
├── docker-compose.yml            # Docker compose (SQLite/MySQL/PostgreSQL)
├── type.d.ts                     # Worker bindings & shared types
└── package.json                  # Root workspace & dev commands
```

## Quick Start

### Prerequisites

- Bun 1.3+
- Cloudflare account, Workers + D1 database + Analytics Engine (`usage_events_by_token`)

### Install Dependencies

```bash
bun install
```

### Configure Cloudflare Bindings

The `wrangler.jsonc` / `wrangler.local.jsonc` in this repo already contain the required binding structure, but you need to replace them with your own environment info:

- `d1_databases[].database_name` / `database_id`: replace with your own D1
- `analytics_engine_datasets[].dataset`: defaults to `usage_events_by_token`
- `vars.FRONTEND_DEV_SERVER_URL`: only for local dev, defaults to `http://127.0.0.1:5173`
- `assets`: keep `public/` and the `ASSETS` binding as-is

Key secrets in the current config:

- `ADMIN_TOKEN`: admin login token, required
- `CF_API_TOKEN`: for querying Analytics Engine SQL, powers dashboard analytics & usage logs
- `CF_ACCOUNT_ID`: paired with `CF_API_TOKEN`, for Cloudflare Analytics queries

Example:

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ACCOUNT_ID
```

For local development you can supply these via `.dev.vars`; scripts under `tests/` also read this file first.

### Database Initialization & Migration

The project auto-runs D1 schema initialization and migration on first request — no manual SQL needed.

To trigger initialization manually after deploy (with admin auth):

```text
POST /api/admin/db_initialize
```

### Local Development

Start the full-stack dev:

```bash
bun run dev
```

Common URLs:

- Frontend Vite dev server: `http://127.0.0.1:5173`
- Worker local service: `http://127.0.0.1:8787`

Other common commands:

```bash
bun run dev:worker
bun run build
bun run cf-typegen
cd frontend && bun run lint
```

## Docs

- [Usage & Configuration](docs/usage-and-configuration.md)
- [Admin Auth & Protection](docs/security/admin-auth-protection.md)
- [Testing & Verification](docs/testing.md)
- [Deployment Guide (English)](docs/DEPLOYMENT.en.md)

## Contributing

Issues and Pull Requests are welcome.

## License

MIT License

**Credits**
- <a href="https://github.com/Tokinx/one-api-workers" target="_blank">one-api-workers</a> — base capability of this project
- <a href="https://github.com/yutian81/ai-gateway" target="_blank">ai-gateway</a> — reference for lightweight gateway & multi-channel orchestration
- <a href="https://github.com/dreamhunter2333/awsl-one-api" target="_blank">dreamhunter2333/awsl-one-api</a> — early models and ideas

Credits: <a href="https://github.com/dreamhunter2333/awsl-one-api" target="_blank">dreamhunter2333/awsl-one-api</a>

## Support

For questions or suggestions, open an Issue or contact the maintainers.