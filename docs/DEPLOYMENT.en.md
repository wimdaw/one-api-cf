# one-api-cf Deployment Guide

> **Languages / 语言:** [English](DEPLOYMENT.en.md) | [简体中文](DEPLOYMENT.md)

This project supports **four deployment methods** (Workers one-click / local manual / Pages / Docker). After deploy, 2 free channels (**OpenCode** and **Kilo Gateway**) are pre-seeded — out of the box, no upstream API key needed.

---

## Database Mode Selection (Important)

Cloudflare deploys (Workers/Pages) support **two database backends** with identical features — pick either:

| Mode | Description | Notes |
|---|---|---|
| **D1 (Recommended)** | Cloudflare native D1 (SQLite); `usage_record` stored directly | Full features, native queries |
| **KV** | Cloudflare Key-Value + built-in sql-asm.js in-memory engine | No D1 needed; data persisted as a snapshot in KV; same UI/analytics |

- **Feature-equivalent**: channels, tokens, settings, login, and the usage analytics dashboard all work in both modes.
- **Workers deploy**: when manually triggering the workflow, pick `db_mode` = `d1` or `kv`; the corresponding resource is auto-created.
- **Pages deploy**: in the Pages project **Settings → Bindings**, add **D1 Database (`DB`)** or **KV Namespace (`STORE`)**.
- Both modes can be migrated anytime (export/import the database snapshot).

---

## Option 1: GitHub Actions One-Click Auto-Deploy (Recommended)

CI automatically handles: database (D1 or KV) creation, rewriting `wrangler.jsonc`, building, and deploying. No manual Cloudflare dashboard interaction required.

### 1. Push code to your own GitHub repository

```bash
git remote add origin https://github.com/<your-username>/one-api-cf.git
git push -u origin main
```

### 2. Configure GitHub Secrets

Repo → **Settings → Secrets and variables → Actions**, add these 3 Secrets:

| Secret | Description |
|---|---|
| `CF_API_TOKEN` | Cloudflare API Token; permissions must include **Workers edit, D1 database, account-level read/write** (analytics stored in the database, no Analytics Engine needed) |
| `CF_ACCOUNT_ID` | Your Cloudflare account ID (found in the Dashboard bottom-right) |
| `ADMIN_TOKEN` | Admin dashboard login token (custom; use a long random string) |

### 3. Trigger deploy

- **Method A (recommended, pick DB)**: GitHub page → **Actions** → **Deploy to Cloudflare Workers** → **Run workflow**, pick `db_mode` = `d1` or `kv` → run. The matching database is created automatically and deployed.
- **Method B**: push to the `main` branch to auto-trigger (D1 mode by default).

After deploy, the output shows a `*.workers.dev` domain.

### 4. Done

No manual config needed. Open the dashboard → login → **Channels** to see the pre-seeded **OpenCode (Free)** and **Kilo Gateway (Free)** channels.

---

## Option 2: Local Manual Deploy

For environments where you want manual control, or local debugging.

### 1. Prerequisites

- [Bun 1.3+](https://bun.sh)
- Cloudflare account (Workers + D1 or KV permission; analytics stored in the database, no Analytics Engine needed)
- wrangler installed (`bun add -g wrangler`, or bundled as a devDependency)

### 2. Install dependencies

```bash
bun install
```

### 3. Create Cloudflare resources

**For D1 mode:**

```bash
# Login
bunx wrangler login

# Create D1 database, note the returned ID
bunx wrangler d1 create one-api-cf
```

**Or for KV mode:**

```bash
# Create a KV namespace, note the returned ID
bunx wrangler kv namespace create one-api-cf-store
```

### 4. Configure wrangler.jsonc

Edit the file and fill in:
- **D1 mode**: `d1_databases[].database_id` → your D1 database ID (binding `DB`)
- **KV mode**: `kv_namespaces[].id` → your KV namespace ID (binding `STORE`, see `wrangler.kv.jsonc`)

> Usage analytics are written to the `usage_record` table in the database (auto-created on first migration); no separate analytics product needed in either mode.

### 5. Set secrets

```bash
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put CF_API_TOKEN
bunx wrangler secret put CF_ACCOUNT_ID
```

### 6. Deploy

```bash
bun run deploy   # equivalent to: build frontend + wrangler deploy
```

> Tip: on first request or when `POST /api/admin/db_initialize` is triggered, D1 tables are auto-initialized and free channels are seeded.

---

## Option 3: Cloudflare Pages Deployment (Advanced `_worker.js` Mode)

Deploy in **Pages advanced mode**: the whole Worker is bundled as `public/_worker.js`, and the frontend static files are hosted by Pages — behavior identical to Workers.

### 1. Local build

```bash
bash scripts/build-pages.sh
# Output: public/ (static frontend) + public/_worker.js (whole Worker bundle)
```

### 2. GitHub Actions auto-deploy

The repo already contains `.github/workflows/deploy-pages.yml`. Configure:

| Secret / Variable | Description |
|---|---|
| `CF_API_TOKEN` | Cloudflare API Token (Pages edit permission) |
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `CF_PAGES_PROJECT`(optional Variable) | Pages project name, default `one-api-cf` |

**Create the Pages project manually in Cloudflare before first deploy**:

1. Dashboard → **Workers & Pages** → **Create** → **Pages** → create empty project `one-api-cf`
2. In the Pages project → **Settings → Bindings** add (pick one):
   - **D1 Database** → `DB` → select your `one-api-cf` database (usage analytics also stored in this D1)
   - or **KV Namespace** → `STORE` → select your `one-api-cf-store` namespace (KV mode)
3. In the Pages project → **Settings → Environment variables** add:
   - `ADMIN_TOKEN` (admin dashboard token)

Then manually trigger the **Deploy to Cloudflare Pages** workflow.

> Note: Pages D1/KV bindings are configured in **project Settings** (not in the wrangler config); `_worker.js` reads bindings with matching names automatically.

---

## Option 4: Docker Deployment (Self-Hosted)

Run locally on the Node.js runtime, supporting **SQLite (default) / MySQL / PostgreSQL** — no Cloudflare required.

### 1. Quick start (default SQLite)

```bash
# Build + start (default SQLite, no external database)
docker compose up -d --build

# Access the admin dashboard
# http://localhost:3000   (ADMIN_TOKEN defaults to admin; change in production)
```

SQLite data persists in the `oaw_data` volume (container path `/app/data/one-api-cf.db`), surviving restarts.

### 2. Use MySQL

```bash
# Start app + mysql database
docker compose --profile mysql up -d --build

# Configure connection via .env
# DB_DRIVER=mysql
# DB_HOST=mysql
# DB_PORT=3306
# DB_USER=root
# DB_PASSWORD=rootpass
# DB_NAME=one_api_workers
```

### 3. Use PostgreSQL

```bash
docker compose --profile postgres up -d --build

# DB_DRIVER=postgres
# DB_HOST=postgres
# DB_PORT=5432
# DB_USER=postgres
# DB_PASSWORD=pgpass
# DB_NAME=one_api_workers
```

### 4. Environment variable reference

Copy `.env.example` to `.env` and modify as needed:

| Variable | Description | Default |
|---|---|---|
| `DB_DRIVER` | `sqlite`(default)/ `mysql` / `postgres` | `sqlite` |
| `DB_FILE` | SQLite file path (container) | `/app/data/one-api-cf.db` |
| `DB_HOST` / `DB_PORT` | MySQL/PG host & port | `127.0.0.1` / `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Database credentials | — |
| `ADMIN_TOKEN` | Admin dashboard token | `admin` |
| `PORT` | Server port | `3000` |

> **Database selection logic**: when `DB_DRIVER` is unset, SQLite is used by default; when set to `mysql` or `postgres`, the corresponding driver is used. On first start, tables are auto-created and free channels are seeded.

### 5. Analytics

| Deployment | Usage / analytics storage |
|---|---|
| **Cloudflare (Workers/Pages)** | **D1 `usage_record` table** (auto-created on first migration); dashboard queries it directly |
| **Docker (SQLite/MySQL/PostgreSQL)** | Local database **`usage_record` table** (auto-created); dashboard reads from the database |

In both modes, the dashboard **Dashboard (overview/trend/breakdown), Usage Logs, and Events** all work; the data source is auto-adapted — no manual configuration needed.

> Tip: SQLite data **auto-persists to disk** (every 8 seconds + at process exit), so channels, tokens, and usage records survive restarts.

---

## Free Channels

After deploy, the following 2 **keyless** free channels are pre-seeded (you can disable them under channel management):

| Channel | Endpoint | Pre-seeded models |
|---|---|---|
| **OpenCode (Free)** | `https://opencode.ai/zen/v1` | `deepseek-v4-flash-free`, `mimo-v2.5-free`, `nemotron-3-ultra-free`, `hy3-free` |
| **Kilo Gateway (Free)** | `https://api.kilo.ai/api/gateway` | `kilo-auto/free`, `stepfun/step-3.7-flash:free`, `poolside/laguna-s-2.1:free`, `tencent/hy3:free` |

> Kilo Gateway provides 361 upstream models (queryable at `/api/gateway/models`); `kilo-auto/free` auto-routes to the free upstream. For more models, add `:free`-suffixed models in the channel config.

---

## Usage

```bash
curl https://<your-domain>/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ***" \
  -d '{"model":"opencode/deepseek-v4-flash-free","messages":[{"role":"user","content":"hi"}]}'
```

Model ID format: `<channel-key>/<model-name>` or directly write the in-channel model name.