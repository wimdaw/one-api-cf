import { Pool } from "pg"
import { translateSql, normalizeBindingValue } from "./dialect"
import type { D1Like } from "./sqlite"

// ---------------------------------------------------------------------------
// PostgreSQL 驱动
// 使用 pg (纯 JS), SQL 经 translateSql 翻译 (SQLite -> PostgreSQL 方言)
// PG 使用 $1/$2 位置参数, 这里统一转成 $N
// ---------------------------------------------------------------------------

// 将 ? 参数占位符转为 pg 的 $N
function convertPlaceholders(sql: string, count: number): string {
    let index = 0
    return sql.replace(/\?/g, () => {
        index += 1
        return `$${index}`
    })
}

class PgStatement {
    private pool: Pool
    private sql: string
    private text: string | null = null
    private values: unknown[] = []

    constructor(pool: Pool, sql: string) {
        this.pool = pool
        this.sql = translateSql(sql, "postgres")
    }

    bind(...params: unknown[]) {
        this.values = params.map((p) => normalizeBindingValue(p, "postgres"))
        this.text = convertPlaceholders(this.sql, this.values.length)
        return this
    }

    private async runQuery() {
        if (!this.text) {
            this.text = convertPlaceholders(this.sql, 0)
        }
        return await this.pool.query(this.text, this.values)
    }

    async run() {
        const result = await this.runQuery()
        return { success: true, meta: { changes: result.rowCount ?? 0, last_row_id: 0 } }
    }

    async all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { duration?: number } }> {
        const result = await this.runQuery()
        return { results: result.rows as unknown as T[], meta: { duration: 0 } }
    }

    async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
        const result = await this.runQuery()
        const row = result.rows[0] as Record<string, unknown> | undefined
        if (!row) return null
        if (columnName !== undefined) {
            return (row[columnName] as T) ?? null
        }
        return row as T
    }
}

export class PgDriver {
    private pool: Pool

    constructor(config: {
        host: string
        port: number
        user: string
        password: string
        database: string
        max?: number
        ssl?: boolean
    }) {
        this.pool = new Pool({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            max: config.max ?? 10,
            ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        })
    }

    getDB(): D1Like {
        const pool = this.pool

        return {
            prepare: (sql: string) => new PgStatement(pool, sql),
            async exec(sql: string) {
                const client = await pool.connect()
                try {
                    const statements = sql
                        .split(";")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    for (const stmt of statements) {
                        const translated = translateSql(stmt, "postgres")
                        await client.query(translated)
                    }
                    return { success: true }
                } finally {
                    client.release()
                }
            },
            async batch(statements: unknown[]) {
                const client = await pool.connect()
                try {
                    const results: { success: boolean; meta: { changes: number } }[] = []
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
                        const translated = translateSql(stmtSql, "postgres")
                        const converted = convertPlaceholders(translated, params.length)
                        const result = await client.query(converted, params)
                        results.push({ success: true, meta: { changes: result.rowCount ?? 0 } })
                    }
                    return results
                } finally {
                    client.release()
                }
            },
            get driver(): string {
                return "postgres"
            },
            get initQueries(): string {
                return ""
            },
        }
    }
}