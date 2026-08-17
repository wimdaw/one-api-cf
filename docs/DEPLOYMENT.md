# one-api-cf 部署指南

> **语言 / Languages:** 🌐 [简体中文](DEPLOYMENT.md) | [English](DEPLOYMENT.en.md)

本项目支持 **四种部署方式**(Workers 一键 / 本地手动 / Pages / Docker),部署完成后自动预置 2 个免费渠道(**OpenCode** 与 **Kilo Gateway**),开箱即用,无需配置任何上游 API Key。

---

## 数据库模式选择(重要)

Cloudflare 部署(Workers/Pages)支持 **两种数据库后端**,功能完全一致,任选其一:

| 模式 | 说明 | 特点 |
|---|---|---|
| **D1(推荐)** | Cloudflare 原生 D1 数据库(SQLite),`usage_record` 直接落表 | 功能最完整,查询天然支持 |
| **KV** | Cloudflare Key-Value 存储 + 内置 sql-asm.js 内存库 | 免建 D1,数据以整体快照存 KV;用法/看板一致 |

- **功能等价**:两种模式下,渠道、令牌、设置、登录、用量分析看板全部可用,后台体验一致。
- **Workers 部署**:手动触发 workflow 时,`db_mode` 下拉选 `d1` 或 `kv` 即可,自动创建对应资源。
- **Pages 部署**:在 Pages 项目 **Settings → Bindings** 添加 **D1 Database(`DB`)** 或 **KV Namespace(`STORE`)**。
- 两种模式可随时迁移(导出/导入数据库快照)。

---

## 方式一:GitHub Actions 一键自动部署(推荐)

CI 会自动完成:数据库(D1 或 KV)创建、`wrangler.jsonc` 自动改写、构建、部署。全程无需手动操作 Cloudflare 面板。

### 1. 推送代码到你自己的 GitHub 仓库

```bash
git remote add origin https://github.com/<你的用户名>/one-api-cf.git
git push -u origin main
```

### 2. 配置 GitHub Secrets

仓库 → **Settings → Secrets and variables → Actions**,添加以下 3 个 Secret:

| Secret | 说明 |
|---|---|
| `CF_API_TOKEN` | Cloudflare API Token,权限需包含 **Workers 编辑、D1 数据库、账号级读写**(分析数据直接存数据库,无需 Analytics Engine) |
| `CF_ACCOUNT_ID` | 你的 Cloudflare 账户 ID(可在 Dashboard 右下角找到) |
| `ADMIN_TOKEN` | 管理后台登录令牌(自定义,请用长随机串) |

### 3. 触发部署

- **方式 A(推荐,选数据库)**:GitHub 页面 → **Actions** → **Deploy to Cloudflare Workers** → **Run workflow**,`db_mode` 下拉选 `d1`(D1)或 `kv`(KV) → 运行。自动创建对应数据库并部署。
- **方式 B**:直接往 `main` 分支 push,自动触发(默认 D1 模式)。

部署完成后,界面会输出一个 `*.workers.dev` 域名。

### 4. 完成

无需任何手动配置。打开后台 → 登录 → 「渠道管理」即可看到已预置的 **OpenCode (Free)** 和 **Kilo Gateway (Free)** 两个渠道。

---

## 方式二:本地手动部署

适合希望手动控制的环境或本地调试。

### 1. 环境要求

- [Bun 1.3+](https://bun.sh)
- Cloudflare 账户(需 Workers + D1 或 KV 权限;分析数据直接存数据库,无需 Analytics Engine)
- wrangler 已安装(`bun add -g wrangler` 或本项目 devDependency 自带)

### 2. 安装依赖

```bash
bun install
```

### 3. 创建 Cloudflare 资源

**选择 D1 模式:**

```bash
# 登录
bunx wrangler login

# 创建 D1 数据库,记录返回的 ID
bunx wrangler d1 create one-api-cf
```

**或选择 KV 模式:**

```bash
# 创建 KV namespace,记录返回的 ID
bunx wrangler kv namespace create one-api-cf-store
```

### 4. 配置 wrangler.jsonc

编辑该文件,填入:
- **D1 模式**:`d1_databases[].database_id` → 你 D1 数据库的 ID(binding 为 `DB`)
- **KV 模式**:`kv_namespaces[].id` → 你 KV namespace 的 ID(binding 为 `STORE`,可参考 `wrangler.kv.jsonc`)

> 用量分析数据写入数据库的 `usage_record` 表(首次迁移自动创建),两种模式无需额外配置数据分析产品。

### 5. 设置 Secret

```bash
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put CF_API_TOKEN
bunx wrangler secret put CF_ACCOUNT_ID
```

### 6. 部署

```bash
bun run deploy   # 等价于: 构建前端 + wrangler deploy
```

> 提示:首次请求或触发 `POST /api/admin/db_initialize` 时,会自动初始化 D1 表并 seed 免费渠道。

---

## 方式三:Cloudflare Pages 部署(高级 _worker.js 模式)

以 **Pages 高级模式**部署:整个 Worker 打包为 `public/_worker.js`,前端静态文件由 Pages 托管,行为与 Workers 一致。

### 1. 本地构建

```bash
bash scripts/build-pages.sh
# 产物: public/ (静态前端) + public/_worker.js (worker 整包)
```

### 2. GitHub Actions 自动部署

仓库已含 `.github/workflows/deploy-pages.yml`,配置:

| Secret / Variable | 说明 |
|---|---|
| `CF_API_TOKEN` | Cloudflare API Token(需 Pages 编辑权限) |
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CF_PAGES_PROJECT`(可选 Variable)| Pages 项目名,默认 `one-api-cf` |

**首次部署前需在 Cloudflare 手动创建 Pages 项目**:

1. Dashboard → **Workers & Pages** → **Create** → **Pages** → 创建空项目 `one-api-cf`
2. 在 Pages 项目 → **Settings → Bindings** 添加(二选一):
   - **D1 Database** → `DB` → 选择你的 `one-api-cf` 数据库(用量分析也存这张 D1)
   - 或 **KV Namespace** → `STORE` → 选择你的 `one-api-cf-store` namespace(KV 模式)
3. 在 Pages 项目 → **Settings → Environment variables** 添加:
   - `ADMIN_TOKEN`(管理后台令牌)

之后手动触发 **Deploy to Cloudflare Pages** workflow 即可。

> 注意:Pages 的 D1/KV 绑定在 **项目 Settings** 里配置(而非 wrangler 配置),`_worker.js` 会自动读取同名 binding。

---

## 方式四:Docker 部署(自托管)

以 Node.js 运行时本地部署,支持 **SQLite(默认)/ MySQL / PostgreSQL** 三种数据库,无需 Cloudflare。

### 1. 快速开始 (默认 SQLite)

```bash
# 构建 + 启动 (默认 SQLite, 无需外部数据库)
docker compose up -d --build

# 访问管理后台
# http://localhost:3000   (ADMIN_TOKEN 默认 admin, 生产请改)
```

SQLite 数据持久化在卷 `oaw_data`(容器内 `/app/data/one-api-cf.db`),重启不丢。

### 2. 使用 MySQL

```bash
# 启动 app + mysql 数据库
docker compose --profile mysql up -d --build

# 通过 .env 指定连接
# DB_DRIVER=mysql
# DB_HOST=mysql
# DB_PORT=3306
# DB_USER=root
# DB_PASSWORD=rootpass
# DB_NAME=one_api_workers
```

### 3. 使用 PostgreSQL

```bash
docker compose --profile postgres up -d --build

# DB_DRIVER=postgres
# DB_HOST=postgres
# DB_PORT=5432
# DB_USER=postgres
# DB_PASSWORD=pgpass
# DB_NAME=one_api_workers
```

### 4. 环境变量参考

复制 `.env.example` 为 `.env` 并按需修改:

| 变量 | 说明 | 默认 |
|---|---|---|
| `DB_DRIVER` | `sqlite`(默认)/ `mysql` / `postgres` | `sqlite` |
| `DB_FILE` | SQLite 文件路径(容器内) | `/app/data/one-api-cf.db` |
| `DB_HOST` / `DB_PORT` | MySQL/PG 主机与端口 | `127.0.0.1` / `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | 数据库凭据 | — |
| `ADMIN_TOKEN` | 管理后台令牌 | `admin` |
| `PORT` | 服务端口 | `3000` |

> **数据库选择逻辑**:不设置 `DB_DRIVER` 时默认用 SQLite;设为 `mysql` 或 `postgres` 时各自使用对应驱动。首次启动会自动建表并 seed 免费渠道。

### 5. 分析功能说明

| 部署方式 | 用量 / 分析数据存储 |
|---|---|
| **Cloudflare (Workers/Pages)** | **D1 数据库 `usage_record` 表**（首次迁移自动建表),后台看板直接查询 |
| **Docker (SQLite/MySQL/PostgreSQL)** | 本地数据库 **`usage_record` 表**(自动建表),后台看板从数据库读取 |

所有部署方式使用**同一条 `usage_record` 数据链路**,后台的 **Dashboard(概览 / 趋势 / 分布)、Usage Logs(用量日志)、Events(最近事件)** 均可直接使用,无需额外配置数据分析产品。

> 提示:SQLite 模式数据**自动持久化落盘**(每 8 秒 + 进程退出时),重启不丢渠道、Token 与用量记录。

---

## 免费渠道说明

部署后自动预置以下 2 个**免 Key** 免费渠道(可在后台渠道管理中禁用):

| 渠道 | Endpoint | 预置模型 |
|---|---|---|
| **OpenCode (Free)** | `https://opencode.ai/zen/v1` | `deepseek-v4-flash-free`、`mimo-v2.5-free`、`nemotron-3-ultra-free`、`hy3-free` |
| **Kilo Gateway (Free)** | `https://api.kilo.ai/api/gateway` | `kilo-auto/free`、`stepfun/step-3.7-flash:free`、`poolside/laguna-s-2.1:free`、`tencent/hy3:free` |

> Kilo Gateway 提供 361 个上游模型(`/api/gateway/models` 可查),`kilo-auto/free` 自动路由到免费上游。如需更多模型,可在渠道配置中添加 `:free` 后缀模型。

---

## 使用

```bash
curl https://<your-domain>/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ***" \
  -d '{"model":"opencode/deepseek-v4-flash-free","messages":[{"role":"user","content":"hi"}]}'
```

模型 ID 格式:`<渠道key>/<模型名>` 或直接写渠道内模型名。