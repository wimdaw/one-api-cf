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