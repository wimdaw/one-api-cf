#!/usr/bin/env bash
# Cloudflare Pages 高级(_worker.js)模式构建脚本
# 用法: bash scripts/build-pages.sh
# 产物: public/ (静态前端) + public/_worker.js (whole-bundle worker)
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== 1. 构建前端 -> public/ ==="
bun run --filter frontend build

echo "=== 2. 打包 worker -> public/_worker.js (Pages Advanced mode) ==="
# --external pg/mysql2: 这些 Node-only 数据库驱动只在 Docker(Node) 模式使用,
# Worker 模式走 D1/KV 不调用它们; 排除可避免 node 内置(tls/dns)在大 bundle 中报错。
# --external nodemailer: SMTP 发件只在 Node 自部署模式使用, Worker/Pages 走 Resend。
bun build src/index.ts \
  --outfile=public/_worker.js \
  --target=browser \
  --format=esm \
  --minify \
  --external pg \
  --external mysql2 \
  --external nodemailer

echo "=== 3. 复制 sql.js wasm 到 public/ (KV 模式首次初始化用) ==="
cp node_modules/sql.js/dist/sql-wasm.wasm public/sql-wasm.wasm
echo "✅ sql-wasm.wasm -> public/"

echo "=== 4. 校验产物 ==="
ls -la public/_worker.js
grep -q 'export{' public/_worker.js && echo "✅ _worker.js 为 ES module 入口" || { echo "❌ 产物非 ES module"; exit 1; }

echo "✅ Pages 构建完成: public/ (frontend) + _worker.js (worker) + sql-wasm.wasm"