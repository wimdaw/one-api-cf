import mysql from "mysql2/promise"
import { translateSql, normalizeBindingValue, SqlDialect } from "./dialect"
import type { D1Like } from "./sqlite"

// ---------------------------------------------------------------------------
// MySQL 驱动
// 使用 mysql2 (纯 JS), SQL 经 translateSql 翻译 (SQLite -> MySQL 方言)
// ---------------------------------------------------------------------------

class MysqlStatement {
    private pool: mysql.Pool
    private sql: string
    private params: unknown[] = []
    private getConn: () => Promise<mysql.PoolConnection>

    constructor(pool: mysql.Pool, sql: string) {
        this.pool = pool
        this.sql = translateSql(sql, "mysql")
        this.getConn = () => pool.getConnection()
    }

    bind(...params: unknown[]) {
        this.params = params.map((p) => normalizeBindingValue(p, "mysql"))
        return this
    }

    async run() {
        const conn = await this.getConn()
        try {
            const [result] = await conn.query(this.sql, this.params) as unknown as [mysql.ResultSetHeader]
            return { success: true, meta: { changes: result.affectedRows ?? 0, last_row_id: result.insertId ?? 0 } }
        } finally {
            conn.release()
        }
    }

    async all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { duration?: number } }> {
        const conn = await this.getConn()
        try {
            const [rows] = await conn.query(this.sql, this.params) as unknown as [mysql.RowDataPacket[]]
            return { results: rows as unknown as T[], meta: { duration: 0 } }
        } finally {
            conn.release()
        }
    }

    async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
        const conn = await this.getConn()
        try {
            const [rows] = await conn.query(this.sql, this.params) as unknown as [mysql.RowDataPacket[]]
            const row = rows[0] as unknown as Record<string, unknown> | undefined
            if (!row) return null
            if (columnName !== undefined) {
                return (row[columnName] as T) ?? null
            }
            return row as T
        } finally {
            conn.release()
        }
    }
}

export class MysqlDriver {
    private pool: mysql.Pool

    constructor(config: {
        host: string
        port: number
        user: string
        password: string
        database: string
        connectionLimit?: number
    }) {
        this.pool = mysql.createPool({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            connectionLimit: config.connectionLimit ?? 10,
            waitForConnections: true,
        })
    }

    getDB(): D1Like {
        const pool = this.pool

        return {
            prepare: (sql: string) => new MysqlStatement(pool, sql),
            async exec(sql: string) {
                const conn = await pool.getConnection()
                try {
                    const statements = sql
                        .split(";")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    for (const stmt of statements) {
                        const translated = translateSql(stmt, "mysql")
                        await conn.query(translated)
                    }
                    return { success: true }
                } finally {
                    conn.release()
                }
            },
            async batch(statements: unknown[]) {
                const conn = await pool.getConnection()
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
                        const translated = translateSql(stmtSql, "mysql")
                        // 复用 batch 逻辑: 返回项含 success
                    const [result] = await conn.query(translated, params) as unknown as [mysql.ResultSetHeader]
                        results.push({ success: true, meta: { changes: result.affectedRows ?? 0 } })
                    }
                    return results
                } finally {
                    conn.release()
                }
            },
            get driver(): string {
                return "mysql"
            },
            get initQueries(): string {
                return ""
            },
        }
    }
}