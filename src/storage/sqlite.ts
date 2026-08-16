import initSqlJs, { Database as SqlJsDatabase } from "sql.js"

// ---------------------------------------------------------------------------
// SQLite 驱动 (默认, Docker 模式)
// 使用 sql.js (纯 WASM, 零原生编译依赖) 模拟 D1 兼容 API:
//   db.prepare(sql).bind(...).run()/first()/all()  |  db.exec(sql)  |  db.batch([...])
// D1 本身就是 SQLite, 所以 SQL 无需方言翻译。
// ---------------------------------------------------------------------------

let sqlWasmUrl: string | null = null

export function configureSqlWasm(url: string) {
    sqlWasmUrl = url
}

class SqliteStatement {
    private database: SqlJsDatabase
    private sql: string
    private params: unknown[] = []

    constructor(database: SqlJsDatabase, sql: string) {
        this.database = database
        this.sql = sql
    }

    bind(...params: unknown[]) {
        this.params = params
        return this
    }

    private bindParams(): any {
        return this.params as any
    }

    private runStatement(): { changes: number } {
        this.database.run(this.sql, this.bindParams())
        // sql.js 通过 getRowsModified() 获取受影响行数
        return { changes: this.database.getRowsModified() }
    }

    async run() {
        const info = this.runStatement()
        return {
            success: true,
            meta: { changes: info.changes, last_row_id: 0 },
        }
    }

    async all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { duration?: number } }> {
        const stmt = this.database.prepare(this.sql)
        try {
            stmt.bind(this.bindParams())
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
            stmt.bind(this.bindParams())
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

export class SqliteDriver {
    private database: SqlJsDatabase
    private filename: string

    private constructor(database: SqlJsDatabase, filename: string) {
        this.database = database
        this.filename = filename
    }

    // 落盘到文件 (sql.js 内存库持久化)
    persistNow(): void {
        if (!this.filename || this.filename === ":memory:") {
            return
        }
        try {
            const data = this.database.export()
            // 动态 import node:fs (仅 Node 环境调用; Cloudflare Worker 不调用 persistNow)
            const fsPromise = import("node:fs") as Promise<typeof import("node:fs")>
            fsPromise.then((fs) => {
                fs.writeFileSync(this.filename, Buffer.from(data))
            }).catch(() => {
                // 非 Node 环境 (Worker) 忽略
            })
        } catch (error) {
            console.error("[sqlite] persist failed:", error)
        }
    }

    static async create(filename: string | ":memory:"): Promise<SqliteDriver> {
        const SQL = await initSqlJs({
            locateFile: () => sqlWasmUrl ?? "sql-wasm.wasm",
        })
        let database: SqlJsDatabase

        if (filename === ":memory:") {
            database = new SQL.Database()
        } else {
            const fs = await import("node:fs")
            const path = await import("node:path")
            const dir = path.dirname(filename)
            if (dir && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            if (fs.existsSync(filename)) {
                const fileBuffer = fs.readFileSync(filename)
                database = new SQL.Database(fileBuffer)
            } else {
                database = new SQL.Database()
            }
        }

        // 开启 WAL 兼容行为 (sql.js 内存模式无需)
        try {
            database.run("PRAGMA journal_mode = WAL")
        } catch {
            // 内存库忽略
        }

        const driver = new SqliteDriver(database, filename)
        // 周期性落盘 (sql.js 内存库 -> 文件), 防止重启丢数据 (仅 Node 环境)
        if (filename && filename !== ":memory:") {
            const g = globalThis as any
            if (typeof g.setInterval === "function") {
                g.setInterval(() => driver.persistNow(), 8000)
            }
            const handleExit = () => {
                driver.persistNow()
                if (typeof g.process?.exit === "function") {
                    g.process.exit(0)
                }
            }
            if (typeof g.process?.once === "function") {
                g.process.once("SIGINT", handleExit)
                g.process.once("SIGTERM", handleExit)
            }
        }
        return driver
    }

    // 返回一个 D1 兼容的 DB 对象
    getDB(): D1Like {
        const db = this.database

        return {
            prepare: (sql: string) => new SqliteStatement(db, sql),
            async exec(sql: string) {
                // 分号分割多条语句 (简单处理)
                const statements = sql
                    .split(";")
                    .map((s) => s.trim())
                    .filter(Boolean)
                for (const stmt of statements) {
                    db.exec(stmt)
                }
                return { success: true }
            },
            async batch(statements: unknown[]) {
                const results: { success: boolean; meta: { changes: number; last_row_id?: number } }[] = []
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
                    results.push({ success: true, meta: { changes: db.getRowsModified() } })
                }
                return results
            },
            get driver(): string {
                return "sqlite"
            },
            get initQueries(): string {
                return ""
            },
            // 持久化到文件 (sql.js 内存库落盘)
            persist(filename: string) {
                const fs = require("node:fs") as typeof import("node:fs")
                const data = db.export()
                fs.writeFileSync(filename, Buffer.from(data))
            },
        }
    }
}

export type D1Like = {
    prepare(sql: string): {
        bind(...params: unknown[]): {
            run(): Promise<{ success: boolean; meta: { changes: number; last_row_id?: number } }>
            all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { duration?: number } }>
            first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>
        }
    }
    exec(sql: string): Promise<{ success: boolean }>
    batch(statements: unknown[]): Promise<{ success: boolean; meta: { changes: number; last_row_id?: number } }[]>
    driver: string
    initQueries: string
    persist?(filename: string): void
}