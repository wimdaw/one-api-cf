// ---------------------------------------------------------------------------
// SQL 方言翻译器
// 项目 SQL 基于 SQLite(与 D1 一致)。Docker 模式运行在 MySQL/PostgreSQL 时,
// 在发送给驱动前将 SQLite 专属语法翻译为目标方言。
// ---------------------------------------------------------------------------

export type SqlDialect = "sqlite" | "mysql" | "postgres"

// 需要翻译的 SQLite 专属片段
type TranslationRule = {
    // SQLite 正则 -> 替代函数(捕获组)
    name: string
    regex: RegExp
    replace: (match: string, ...groups: string[]) => string
}

// datetime('now') 及其变体(如 datetime('now', '+7 days'))
const datetimeNowRegex = /datetime\(('now'\s*[^)]*?)\)/gi

// json_extract(col, '$.path') 或 json_extract(col, '$.a', ...)
const jsonExtractRegex = /json_extract\s*\(\s*([^,()]+)\s*,\s*((?:'[^']*')(?:\s*,\s*(?:'[^']*'))*)?\s*\)/gi

// INSERT OR IGNORE
const insertOrIgnoreRegex = /INSERT\s+OR\s+IGNORE\s+INTO/gi

// ON CONFLICT(key) DO UPDATE SET a=excluded.a, ... / DO NOTHING
const onConflictRegex = /ON\s+CONFLICT\s*\(([^)]+)\)\s*DO\s+(UPDATE\s+SET\s+([\s\S]*?))(?=;|$)|ON\s+CONFLICT\s*\(([^)]+)\)\s*DO\s+NOTHING/gi

// REPLACE INTO (SQLite 语法, PG 不支持)
const replaceIntoRegex = /REPLACE\s+INTO/gi

// PRAGMA table_info / PRAGMA table_xinfo
const pragmaTableInfoRegex = /PRAGMA\s+table_info\s*\(\s*'?\w+'?\s*\)/gi
const pragmaXInfoRegex = /PRAGMA\s+table_xinfo\s*\(\s*'?\w+'?\s*\)/gi

// sqlite_master 表查询 (D1 迁移专用) -> information_schema
const sqliteMasterRegex = /SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*\?/gi
// PRAGMA table_info(api_token) 迁移专用 -> information_schema.columns
const pragmaTableInfoFullRegex = /PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)/gi

// INSERT ... ON CONFLICT(key) DO UPDATE SET col = excluded.col, ...
function translateOnConflictMySQL(sql: string): string {
    // MySQL 8: ON DUPLICATE KEY UPDATE col=VALUES(col)  (VALUES() 已弃用但可用)
    let hasNothing = false
    const mapped = sql.replace(onConflictRegex, (_m, conflictKey, _do, updateSet) => {
        if (updateSet && updateSet.trim()) {
            // excluded.col -> VALUES(col)
            const m = updateSet.replace(/\bexcluded\.(\w+)/g, "VALUES($1)")
            return `\nON DUPLICATE KEY UPDATE ${m.trim()}`
        }
        hasNothing = true
        return "" // DO NOTHING: 移除 ON CONFLICT 子句
    })
    if (hasNothing) {
        // 转为 INSERT IGNORE INTO (匹配 DO NOTHING 语义)
        return mapped.replace(/^\s*INSERT\s+INTO/i, "INSERT IGNORE INTO")
    }
    return mapped
}

function translateOnConflictPostgres(sql: string): string {
    // PostgreSQL: ON CONFLICT 已原生支持 excluded.*, 但需处理 INSERT ... ON CONFLICT 无 PK 情况
    // PG 的 excluded 引用保留原样即可
    return sql.replace(onConflictRegex, (m) => m)
}

export function translateSql(sql: string, dialect: SqlDialect): string {
    if (dialect === "sqlite") {
        return sql
    }

    let out = sql

    if (dialect === "mysql") {
        // datetime('now') -> NOW()
        out = out.replace(datetimeNowRegex, "NOW()")
        // datetime(列名) 排序函数 -> 列名本身 (MySQL 无 datetime() 函数)
        out = out.replace(/\bdatetime\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi, "$1")
        // -- 先做 TEXT -> VARCHAR 转换 (列类型), 此时尚未引入 PRIMARY KEY 占位 --
        // 主键 TEXT 列 -> VARCHAR
        out = out.replace(/(\w+)\s+TEXT\s+PRIMARY\s+KEY/gi, "$1 VARCHAR(191) PRIMARY KEY")
        // NOT NULL TEXT -> VARCHAR (确保能作非空/主键邻接)
        out = out.replace(/(\w+)\s+TEXT\s+NOT\s+NULL/gi, "$1 VARCHAR(191) NOT NULL")
        // TEXT 带 DEFAULT -> VARCHAR (TEXT 无法设 DEFAULT)
        out = out.replace(/(\w+)\s+TEXT\s+DEFAULT\b/gi, "$1 VARCHAR(191) DEFAULT")
        // 其余独立 TEXT -> TEXT
        out = out.replace(/(\w+)\s+TEXT\s+(?!PRIMARY|UNIQUE)/gi, "$1 TEXT")

        // -- 保护 DDL/索引关键词, 避免误转义列名 key --
        const keyKeywords = new Map<string, string>()
        const protectKey = (m: string, idx: number) => {
            const ph = `__KKEY_${idx}__`
            keyKeywords.set(ph, m)
            return ph
        }
        let pid = 0
        out = out.replace(/\b(PRIMARY|FOREIGN|UNIQUE|ON DUPLICATE)\s+KEY\b/gi, (m) => protectKey(m, pid++))
        out = out.replace(/\bKEY\s*\(/gi, (m) => protectKey(m, pid++))

        // 转义裸列名 key -> `key` (独立词, 非关键词)
        out = out.replace(/(?<![A-Za-z0-9_])key(?![A-Za-z0-9_]|`)/gi, () => "`key`")
        // 转义裸列名 usage (MySQL 保留字) -> `usage`
        out = out.replace(/(?<![A-Za-z0-9_])usage(?![A-Za-z0-9_]|`)/gi, () => "`usage`")

        // 还原占位符
        for (const [ph, orig] of keyKeywords) {
            out = out.replace(ph, orig)
        }

        // json_extract -> JSON_EXTRACT (MySQL 原生支持)
        out = out.replace(jsonExtractRegex, "JSON_EXTRACT($1, $2)")
        // INSERT OR IGNORE -> INSERT IGNORE
        out = out.replace(insertOrIgnoreRegex, "INSERT IGNORE INTO")
        // ON CONFLICT -> ON DUPLICATE KEY UPDATE
        out = translateOnConflictMySQL(out)
        // SQLite 迁移专用查询翻译
        const tableMatch = sqliteMasterRegex.exec(out)
        if (tableMatch) {
            out = out.replace(sqliteMasterRegex, "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?")
        }
        out = out.replace(pragmaTableInfoFullRegex, (m, tbl) =>
            `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${tbl}'`)
        // sqlite_master 其他残留
        out = out.replace(/sqlite_master/gi, "INFORMATION_SCHEMA.TABLES")
    } else if (dialect === "postgres") {
        // 1. datetime('now'...) 函数 -> now()
        out = out.replace(datetimeNowRegex, "now()")
        // 2. datetime(列名) 排序函数 -> 列名本身 (PG 无 datetime() 函数; 这些列存 ISO 时间戳直接可排序)
        out = out.replace(/\bdatetime\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi, "$1")
        // 3. DDL: SQLite DATETIME 列类型 -> PG TIMESTAMP (此时剩下的 DATETIME 都是类型)
        out = out.replace(/\bDATETIME\b/gi, "TIMESTAMP")
        // json_extract(col, '$.a.b') -> (col::jsonb->>'a.b') 用于数值比较, 显式转 numeric
        out = out.replace(jsonExtractRegex, (m, col, pathsArg) => {
            const colTrim = col.trim()
            if (!pathsArg) {
                return `${colTrim}::jsonb`
            }
            const pathMatch = pathsArg.match(/'\$?\.?([^']*)'/)
            if (!pathMatch) {
                return `${colTrim}::jsonb`
            }
            const jsonPath = pathMatch[1].replace(/^\./, "")
            // PG 的 ->> 返回 text; 项目内 json_extract 均用于数值比较, 显式转 numeric
            return `CAST(${colTrim}::jsonb->>'${jsonPath}' AS NUMERIC)`
        })
        // INSERT OR IGNORE -> ON CONFLICT DO NOTHING (需附加到语句末尾)
        out = out.replace(insertOrIgnoreRegex, "INSERT INTO")
        // ON CONFLICT(key) DO UPDATE: PG 原生支持 excluded.*, 无需改
        out = translateOnConflictPostgres(out)
        // SQLite 迁移专用查询翻译 (PG)
        out = out.replace(sqliteMasterRegex, "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?")
        out = out.replace(pragmaTableInfoFullRegex, (m, tbl) =>
            `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${tbl}'`)
        // sqlite_master 残留
        out = out.replace(/sqlite_master/gi, "INFORMATION_SCHEMA.TABLES")
    }

    return out
}

// 将 SQLite 布尔/数字绑定参数规范为目标方言可接受的值
// (mysql2/pg 对 undefined 等值处理不同)
export function normalizeBindingValue(
    value: unknown,
    dialect: SqlDialect
): unknown {
    if (value === undefined) {
        return null
    }
    if (value === null) {
        return null
    }
    return value
}

// 返回标识符引用符(用于驱动层, 当前不需要转义处理)
export function quoteIdentifier(name: string, dialect: SqlDialect): string {
    switch (dialect) {
        case "mysql":
            return `\`${name.replace(/`/g, "``")}\``
        case "postgres":
            return `"${name.replace(/"/g, '""')}"`
        default:
            return name
    }
}