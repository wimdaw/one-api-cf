# ---------------------------------------------------------------------------
# one-api-cf - Docker 部署
# 多阶段构建: 前端 + Node 运行时 (支持 SQLite/MySQL/PostgreSQL)
# ---------------------------------------------------------------------------

# ---------- Stage 1: 构建前端 + Node 入口 ----------
FROM oven/bun:1.3 AS builder

WORKDIR /build

# 依赖
COPY package.json bun.lock* ./
COPY frontend/package.json ./frontend/
RUN bun install

# 源码
COPY . .

# 构建前端到 public/
RUN bun run --filter frontend build

# 打包 Node 入口 (Docker 运行时)
RUN bun build src/node-entry.ts \
    --outfile=dist/node-entry.js \
    --target=node \
    --format=esm

# ---------- Stage 2: 运行时 ----------
FROM node:22-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 复制构建产物
COPY --from=builder /build/public ./public
COPY --from=builder /build/dist ./dist

# 复制 sql.js 的 wasm (SQLite 驱动需要)
COPY --from=builder /build/node_modules/sql.js/dist/sql-wasm.wasm ./sql-wasm.wasm
ENV SQL_WASM_PATH=/app/sql-wasm.wasm

# 复制 node_modules (mysql2/pg/hono 等运行时依赖需保留)
COPY --from=builder /build/node_modules ./node_modules

# 创建数据目录 (SQLite 默认持久化)
RUN mkdir -p /app/data

# 端口
ENV PORT=3000
EXPOSE 3000

# 默认: SQLite (默认数据库)
# 可通过环境变量切换 DB_DRIVER=mysql / postgres
ENV DB_DRIVER=sqlite
ENV DB_FILE=/app/data/one-api-cf.db

VOLUME ["/app/data"]

CMD ["node", "dist/node-entry.js"]