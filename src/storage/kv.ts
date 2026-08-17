import type { D1Like } from "./sqlite"

// ---------------------------------------------------------------------------
// KV 驱动 (Cloudflare KV 模式)
// 使用 sql.js wasm 版 (sql-wasm-browser.js glue + wasm 二进制)。
// 为避免 bundle 过大 (wasm 658KB 内联会超 CF 免费版脚本大小限制), wasm 二进制
// 不内联到 bundle, 而是:
//   1. 首次从 ASSETS 加载 (public/sql-wasm.wasm, 由构建脚本复制)
//   2. 缓存到 KV (key: wasm:main), 后续请求直接读 KV
// 数据库整体作为二进制快照持久化到 KV (key: db:main)。
// 冷启动从 KV 加载数据库, 每次写操作后导出回流 KV。所有 SQL 与 D1 完全一致。
// ---------------------------------------------------------------------------

const KV_DB_KEY = "db:main"
const KV_WASM_KEY = "wasm:main"
const WASM_ASSET_PATH = "/sql-wasm.wasm"

let sqlReadyPromise: Promise<any> | null = null
let sqlMod: any = null

async function loadWasmBytes(kv: any, assets: any): Promise<ArrayBuffer> {
    // 1. 先尝试 KV
    const cached = await kv.get(KV_WASM_KEY, { type: "arrayBuffer" })
    if (cached && (cached as ArrayBuffer).byteLength > 0) {
        return cached as ArrayBuffer
    }

    // 2. 从 ASSETS 加载
    let wasmBytes: ArrayBuffer | null = null
    if (assets && typeof assets.fetch === "function") {
        try {
            const url = new URL(WASM_ASSET_PATH, "https://assets.local")
            const resp = await assets.fetch(new Request(url, { method: "GET" }))
            if (resp && resp.ok) {
                wasmBytes = await resp.arrayBuffer()
            }
        } catch (e) {
            console.error("[kv] load wasm from assets failed:", e)
        }
    }

    if (!wasmBytes || (wasmBytes as ArrayBuffer).byteLength === 0) {
        throw new Error(
            "[kv] sql.js wasm not found. Ensure the build script copied sql-wasm.wasm to public/ " +
            "and that ASSETS binding is reachable."
        )
    }

    // 缓存到 KV, 后续直接读 KV
    try {
        await kv.put(KV_WASM_KEY, wasmBytes)
    } catch {
        // 缓存失败不影响本次运行
    }
    return wasmBytes
}

async function getSqlModule(kv: any, assets: any): Promise<any> {
    if (sqlMod) return sqlMod
    if (!sqlReadyPromise) {
        sqlReadyPromise = (async () => {
            const wasmBinary = await loadWasmBytes(kv, assets)
            // 必须在动态 import 前设置 location stub —— sql-asm/wasm glue 在模块顶层
            // 会读 self.location.href (ba = !!WorkerGlobalScope 为 true), 而 Worker 无 location
            const g = globalThis as any
            if (!g.location) {
                g.location = { href: "about:blank", protocol: "about:" }
            }
            // @ts-ignore - sql-wasm-browser.js 无 .d.ts, 类型来自 sql.js 主包
            const mod: any = await import("sql.js/dist/sql-wasm-browser.js")
            const initSqlJs = (mod && mod.default) ? mod.default : mod
            const raw: any = await initSqlJs({
                wasmBinary,
                // 通过 wasmBinary 注入, 绕过 URL 定位
                locateFile: () => "sql-wasm-browser.wasm",
            })
            sqlMod = (raw && raw.default) ? raw.default : raw
        })()
    }
    await sqlReadyPromise
    return sqlMod
}

class KvStatement {
    private database: any
    private sql: string
    private params: unknown[] = []
    private onWrite: (() => Promise<void>) | null = null

    constructor(database: any, sql: string, onWrite?: () => Promise<void>) {
        this.database = database
        this.sql = sql
        this.onWrite = onWrite || null
    }

    bind(...params: unknown[]) {
        this.params = params
        return this
    }

    private runStatement(): { changes: number } {
        this.database.run(this.sql, this.params as any)
        return { changes: this.database.getRowsModified() }
    }

    isWrite(): boolean {
        const s = this.sql.trim().toLowerCase()
        return s.startsWith("insert") || s.startsWith("update") || s.startsWith("delete")
            || s.startsWith("create") || s.startsWith("drop") || s.startsWith("alter")
            || s.startsWith("replace") || s.startsWith("pragma")
    }

    async run() {
        const info = this.runStatement()
        if (this.onWrite && this.isWrite()) {
            await this.onWrite()
        }
        return { success: true, meta: { changes: info.changes, last_row_id: 0 } }
    }

    async all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { duration?: number } }> {
        const stmt = this.database.prepare(this.sql)
        try {
            stmt.bind(this.params as any)
            const rows: T[] = []
            while (stmt.step()) {
                rows.push(stmt.getAsObject() as T)
            }
            return { results: rows, meta: { duration: 0 } }
        } finally {
            stmt.free()
        }
    }

    async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
        const stmt = this.database.prepare(this.sql)
        try {
            stmt.bind(this.params as any)
            if (!stmt.step()) return null
            const row = stmt.getAsObject() as Record<string, unknown>
            if (columnName !== undefined) {
                return (row[columnName] as T) ?? null
            }
            return row as T
        } finally {
            stmt.free()
        }
    }
}

export class KvDriver {
    private database: any
    private kv: any
    private pendingPersist: Promise<void> | null = null
    private persistTimer: ReturnType<typeof setTimeout> | null = null

    private constructor(database: any, kv: any) {
        this.database = database
        this.kv = kv
    }

    persistNow = async (): Promise<void> => {
        if (this.pendingPersist) {
            return this.pendingPersist
        }
        this.pendingPersist = (async () => {
            const data = this.database.export()
            await this.kv.put(KV_DB_KEY, data)
        })().finally(() => {
            this.pendingPersist = null
        })
        return this.pendingPersist
    }

    // 防抖持久化: 配置写操作快速落盘, 高频写入合并
    private queuePersist(): void {
        if (this.persistTimer) {
            return
        }
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null
            this.persistNow().catch((e) => console.error("[kv] persist failed:", e))
        }, 150)
    }

    // persist(debounceMs <= 0): 立即落盘; 否则防抖
    persist(debounceMs = 150): Promise<void> {
        if (debounceMs <= 0) {
            return this.persistNow()
        }
        this.queuePersist()
        return Promise.resolve()
    }

    static async create(kv: any, assets?: any): Promise<KvDriver> {
        const SQL = await getSqlModule(kv, assets)
        let database: any
        const existing = await kv.get(KV_DB_KEY, { type: "arrayBuffer" })
        if (existing && (existing as ArrayBuffer).byteLength > 0) {
            database = new SQL.Database(new Uint8Array(existing as ArrayBuffer))
        } else {
            database = new SQL.Database()
        }
        try {
            database.run("PRAGMA journal_mode = WAL")
        } catch {
            // 忽略
        }
        return new KvDriver(database, kv)
    }

    // 返回 D1 兼容接口
    getDB(): D1Like {
        const db = this.database
        const driver = this

        return {
            prepare: (sql: string) => new KvStatement(db, sql, () => driver.persist(0)),
            async exec(sql: string) {
                const statements = sql
                    .split(";")
                    .map((s) => s.trim())
                    .filter(Boolean)
                for (const stmt of statements) {
                    db.exec(stmt)
                }
                await driver.persist()
                return { success: true }
            },
            async batch(statements: unknown[]) {
                const results: { success: boolean; meta: { changes: number; last_row_id?: number } }[] = []
                let hasWrite = false
                for (const item of statements) {
                    let stmtSql: string
                    let params: unknown[] = []
                    if (typeof item === "string") {
                        stmtSql = item
                    } else if (Array.isArray(item)) {
                        stmtSql = item[0] as string
                        params = (item[1] as unknown[]) || []
                    } else {
                        stmtSql = ""
                    }
                    if (!stmtSql) {
                        results.push({ success: true, meta: { changes: 0 } })
                        continue
                    }
                    db.run(stmtSql, params as any)
                    const mod = db.getRowsModified()
                    results.push({ success: true, meta: { changes: mod } })
                    const s = stmtSql.trim().toLowerCase()
                    if (s.startsWith("insert") || s.startsWith("update") || s.startsWith("delete")
                        || s.startsWith("create") || s.startsWith("drop") || s.startsWith("alter")) {
                        hasWrite = true
                    }
                }
                if (hasWrite) {
                    await driver.persist()
                }
                return results
            },
            get driver(): string {
                return "kv"
            },
            get initQueries(): string {
                return ""
            },
            persist() {
                return driver.persist(0)
            },
        }
    }
}

// 全局缓存当前 KV 驱动实例 (每次请求不需要重建)
let kvCurrentDb: D1Like | null = null
let kvLoading: Promise<D1Like> | null = null

// 懒加载 KV 数据库 (线程安全, 全局单例), 返回 D1Like
export async function getKvDb(kv: unknown, assets?: unknown): Promise<D1Like> {
    if (kvCurrentDb) {
        return kvCurrentDb
    }
    if (kvLoading) {
        return kvLoading
    }
    kvLoading = (async () => {
        const driver = await KvDriver.create(kv, assets)
        kvCurrentDb = driver.getDB()
        return kvCurrentDb
    })().finally(() => {
        kvLoading = null
    })
    return kvLoading
}