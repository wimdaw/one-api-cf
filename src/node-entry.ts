// ---------------------------------------------------------------------------
// Node.js 运行时入口 (Docker 部署用)
// 在不改动 Cloudflare Worker 代码的前提下, 用 fake env 注入:
//   - DB: 数据库适配层 (sqlite/mysql/postgres, 默认 sqlite)
//   - ASSETS: 本地静态文件服务 (public/)
//   - USAGE_ANALYTICS: 无 binding 时跳过 (analytics 自动降级)
// 用法:
//   DB_DRIVER=sqlite|mysql|postgres node dist/node-entry.js
// ---------------------------------------------------------------------------

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { initDb, getDb, D1Like } from "./storage"
import { configureSqlWasm } from "./storage/sqlite"
import app from "./index"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, "..")

// ---------- 静态文件服务 (模拟 CF ASSETS.fetch) ----------
class NodeAssets {
    private publicDir: string

    constructor(publicDir: string) {
        this.publicDir = publicDir
    }

    private resolvePath(pathname: string): string {
        // 去除 query/hash
        let cleanPath = pathname.split("?")[0].split("#")[0]
        // SPA fallback: 非文件路径返回 index.html
        const filePath = path.join(this.publicDir, cleanPath)
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return filePath
        }
        // SPA 路由回退
        const indexPath = path.join(this.publicDir, "index.html")
        return fs.existsSync(indexPath) ? indexPath : filePath
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)
        const resolved = this.resolvePath(url.pathname)

        try {
            if (!fs.existsSync(resolved)) {
                return new Response("Not Found", { status: 404 })
            }
            const content = fs.readFileSync(resolved)
            const ext = path.extname(resolved).toLowerCase()
            const contentType = MIME_TYPES[ext] || "application/octet-stream"
            return new Response(content, {
                headers: { "Content-Type": contentType },
            })
        } catch (error) {
            return new Response("Internal Server Error", { status: 500 })
        }
    }
}

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
}

// ---------- Analytics 降级 (写入内存/忽略) ----------
// CF Analytics Engine 在 Node 中不可用, 提供 noop 以优雅降级
const noopAnalytics = {
    writeDataPoint() {
        // no-op: Docker 模式下用量分析默认关闭
    },
}

// ---------- 启动 ----------
async function main() {
    // 配置 sql.js wasm 路径(sqlite 驱动需要)
    const sqlWasmPath = process.env.SQL_WASM_PATH
        || path.join(ROOT_DIR, "node_modules", "sql.js", "dist", "sql-wasm.wasm")
    if (fs.existsSync(sqlWasmPath)) {
        configureSqlWasm(sqlWasmPath)
    }

    // 1. 初始化数据库
    const db: D1Like = await initDb()

    // 2. 构造 fake env
    const env: any = {
        DB: db,
        ASSETS: new NodeAssets(path.join(ROOT_DIR, "public")),
        USAGE_ANALYTICS: undefined, // 触发 usage-logger 优雅降级
        USAGE_ANALYTICS_DATASET: process.env.USAGE_ANALYTICS_DATASET || "usage_events_by_token",
        ADMIN_TOKEN: process.env.ADMIN_TOKEN || "admin",
        ADMIN_USERNAME: process.env.ADMIN_USERNAME || "",
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",
        CF_API_TOKEN: process.env.CF_API_TOKEN || "",
        CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || "",
        ADMIN_CORS_ORIGINS: process.env.ADMIN_CORS_ORIGINS || "",
        FRONTEND_DEV_SERVER_URL: process.env.FRONTEND_DEV_SERVER_URL || "",
    }

    // 3. 启动 HTTP 服务 (Node 原生 http, 经 Hono app.fetch)
    const port = Number(process.env.PORT || 3000)
    const host = process.env.HOST || "0.0.0.0"

    const http = await import("node:http")

    const server = http.createServer(async (req, res) => {
        try {
            const request = await toFetchRequest(req, req.headers.host || `localhost:${port}`)
            const response = await app.fetch(request, env, {
                waitUntil() {
                    // no-op: Node 无 waitUntil
                },
            } as any)
            await writeFetchResponse(res, response)
        } catch (error) {
            console.error("[one-api-cf] Error handling request:", error)
            res.writeHead(500, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: { message: "Internal Server Error" } }))
        }
    })

    server.listen(port, host, () => {
        console.log(`[one-api-cf] Node server listening on http://${host}:${port}`)
        console.log(`[one-api-cf] DB driver: ${db.driver}`)
    })

    return server
}

// 将 Node http.IncomingMessage 转换为 Fetch Request
async function toFetchRequest(req: import("node:http").IncomingMessage, host: string): Promise<Request> {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const body = Buffer.concat(chunks)

    const url = new URL(req.url || "/", `http://${host}`)
    const headers = new Headers()
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headers.set(req.rawHeaders[i], req.rawHeaders[i + 1])
    }
    // 计算 content-length
    if (body.length > 0 && !headers.has("content-length")) {
        headers.set("content-length", String(body.length))
    }

    return new Request(url.toString(), {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method || "") ? undefined : body,
    })
}

// 将 Fetch Response 写出到 Node http.ServerResponse
async function writeFetchResponse(
    res: import("node:http").ServerResponse,
    response: Response,
): Promise<void> {
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
        headers[key] = value
    })
    // 继承状态码与 body
    res.writeHead(response.status, response.statusText, headers)

    if (response.body) {
        const reader = response.body.getReader()
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                res.write(Buffer.from(value))
            }
        } finally {
            reader.releaseLock()
        }
    }
    res.end()
}

main().catch((error) => {
    console.error("[one-api-cf] Failed to start:", error)
    process.exit(1)
})