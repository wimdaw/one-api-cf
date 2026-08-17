#!/usr/bin/env bash
# Cloudflare Pages 高级(_worker.js)模式构建脚本
# 用法: bash scripts/build-pages.sh
# 产物: public/ (静态前端) + public/_worker.js (whole-bundle worker)
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== 1. 构建前端 -> public/ ==="
bun run --filter frontend build

echo "=== 2. 打包 worker -> public/_worker.js (Pages Advanced mode) ==="
bun build src/index.ts \
  --outfile=public/_worker.js \
  --target=browser \
  --format=esm \
  --minify

echo "=== 3. 复制 sql.js wasm 到 public/ (KV 模式首次初始化用) ==="
cp node_modules/sql.js/dist/sql-wasm.wasm public/sql-wasm.wasm
echo "✅ sql-wasm.wasm -> public/"

echo "=== 4. 校验产物 ==="
ls -la public/_worker.js
grep -q 'export{' public/_worker.js && echo "✅ _worker.js 为 ES module 入口" || { echo "❌ 产物非 ES module"; exit 1; }

echo "✅ Pages 构建完成: public/ (frontend) + _worker.js (worker) + sql-wasm.wasm"