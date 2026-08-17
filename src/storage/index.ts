import { SqliteDriver, D1Like } from "./sqlite"
import { MysqlDriver } from "./mysql"
import { PgDriver } from "./postgres"

// ---------------------------------------------------------------------------
// 数据库适配层入口
// 根据 DB_DRIVER 环境变量选择:
//   sqlite(默认) | mysql | postgres
// 统一返回 D1 兼容接口 (D1Like), 业务代码零修改即可在三种数据库上运行。
// ---------------------------------------------------------------------------

export type DbConfig = {
    driver: "sqlite" | "mysql" | "postgres"
    // sqlite
    filename?: string
    // mysql / postgres
    host?: string
    port?: number
    user?: string
    password?: string
    database?: string
    ssl?: boolean
}

let currentDb: D1Like | null = null

function normalizeDriver(value: string | undefined): "sqlite" | "mysql" | "postgres" {
    const v = (value || "").trim().toLowerCase()
    if (v === "mysql") return "mysql"
    if (v === "postgres" || v === "postgresql" || v === "pg") return "postgres"
    return "sqlite"
}

// 自动从环境变量构建配置 (Docker 部署时注入)
export function loadConfigFromEnv(): DbConfig {
    return {
        driver: normalizeDriver(process.env.DB_DRIVER),
        filename: process.env.DB_FILE || "./data/one-api-cf.db",
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT || (normalizeDriver(process.env.DB_DRIVER) === "postgres" ? 5432 : 3306)),
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "one_api_workers",
        ssl: (process.env.DB_SSL || "false") === "true",
    }
}

export async function initDb(config?: DbConfig): Promise<D1Like> {
    const cfg = config ?? loadConfigFromEnv()

    if (cfg.driver === "mysql") {
        const driver = new MysqlDriver({
            host: cfg.host || "127.0.0.1",
            port: cfg.port || 3306,
            user: cfg.user || "root",
            password: cfg.password || "",
            database: cfg.database || "one_api_workers",
        })
        currentDb = driver.getDB()
    } else if (cfg.driver === "postgres") {
        const driver = new PgDriver({
            host: cfg.host || "127.0.0.1",
            port: cfg.port || 5432,
            user: cfg.user || "postgres",
            password: cfg.password || "",
            database: cfg.database || "one_api_workers",
            ssl: cfg.ssl,
        })
        currentDb = driver.getDB()
    } else {
        const driver = await SqliteDriver.create(cfg.filename || ":memory:")
        currentDb = driver.getDB()
    }

    return currentDb
}

export function getDb(): D1Like {
    if (!currentDb) {
        throw new Error("Database not initialized. Call initDb() first.")
    }
    return currentDb
}

export function isDbInitialized(): boolean {
    return currentDb !== null
}

export { D1Like }

// ---------------------------------------------------------------------------
// Cloudflare 部署的统一数据库接入
// 根据环境自动选择:
//   - 有 D1 binding (env.DB)  → 直接用 D1 (原生 SQLite)
//   - 有 KV binding (env.STORE)  → 用 KV 驱动的 sql-asm.js 内存库 + KV 持久化
// 返回统一的 D1Like 接口, 业务代码无需区分 D1 / KV。
// ---------------------------------------------------------------------------

import { getKvDb } from "./kv"

const resolveCache = new WeakMap<object, Promise<D1Like>>()

export async function resolveDb(env: Record<string, unknown>): Promise<D1Like> {
    // 1. D1 模式: env.DB 存在 (且不是 KV 占位)
    if (env && (env as any).DB && typeof (env as any).DB.prepare === "function") {
        return (env as any).DB as D1Like
    }

    // 2. KV 模式: env.STORE (或 KV_STORAGE) 存在
    const kvBinding = (env as any).STORE || (env as any).KV_STORAGE
    if (kvBinding && typeof (kvBinding as any).get === "function") {
        if (resolveCache.has(kvBinding)) {
            return resolveCache.get(kvBinding)!
        }
        const p = getKvDb(kvBinding, (env as any).ASSETS)
        resolveCache.set(kvBinding, p)
        return p
    }

    // 3. 兜底: 无 binding (如 Docker build 时的 CF 编译), 抛错提示
    throw new Error(
        "No database configured. Set a D1 binding (DB) or a KV namespace (STORE) in wrangler config."
    )
}