import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise'

import { config } from './config.js'
import { runMigrations } from './migrations.js'

export interface RunResult {
  insertId: number
  affectedRows: number
}

export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  run(sql: string, params?: unknown[]): Promise<RunResult>
}

export interface DatabaseClient extends SqlExecutor {
  transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T>
}

let pool: Pool | null = null

const sleep = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs))

const safeIdentifier = (value: string, label: string) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error(`${label} contains unsafe characters`)
  return value
}

const createPool = (database?: string, useAdmin = false) => mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: useAdmin ? config.database.adminUser : config.database.user,
  password: useAdmin ? config.database.adminPassword : config.database.password,
  database,
  waitForConnections: true,
  connectionLimit: config.database.connectionLimit,
  dateStrings: true,
})

const waitForDatabase = async (targetPool: Pool, label: string) => {
  for (let attempt = 1; attempt <= config.database.connectRetries; attempt += 1) {
    try {
      await targetPool.query('SELECT 1')
      return
    } catch (error) {
      if (attempt === config.database.connectRetries) throw error
      console.warn(`[big-screen-db] waiting for ${label} (${attempt}/${config.database.connectRetries})`)
      await sleep(config.database.connectDelayMs)
    }
  }
}

export const bootstrapDatabase = async () => {
  const databaseName = safeIdentifier(config.database.name, 'MYSQL_DATABASE')
  const appUser = safeIdentifier(config.database.user, 'MYSQL_USER')
  const adminPool = createPool(undefined, true)
  await waitForDatabase(adminPool, 'mysql admin connection')
  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    await adminPool.query(
      `CREATE USER IF NOT EXISTS '${appUser}'@'%' IDENTIFIED BY ?`,
      [config.database.password],
    )
    await adminPool.query(
      `ALTER USER '${appUser}'@'%' IDENTIFIED BY ?`,
      [config.database.password],
    )
    await adminPool.query(
      `GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO '${appUser}'@'%'`,
    )
    await adminPool.query('FLUSH PRIVILEGES')
  } finally {
    await adminPool.end()
  }
}

const executorFor = (target: Pool | PoolConnection): SqlExecutor => ({
  async query<T>(sql: string, params: unknown[] = []) {
    const [rows] = await target.query<RowDataPacket[]>(sql, params)
    return rows as T[]
  },
  async get<T>(sql: string, params: unknown[] = []) {
    const rows = await this.query<T>(sql, params)
    return rows[0] || null
  },
  async run(sql: string, params: unknown[] = []) {
    const [result] = await target.execute<ResultSetHeader>(sql, params as never[])
    return {
      insertId: Number(result.insertId || 0),
      affectedRows: Number(result.affectedRows || 0),
    }
  },
})

const databaseClient = (): DatabaseClient => {
  if (!pool) throw new Error('Big-screen database has not been initialized')
  const executor = executorFor(pool)
  return {
    ...executor,
    async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>) {
      if (!pool) throw new Error('Big-screen database has not been initialized')
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const result = await work(executorFor(connection))
        await connection.commit()
        return result
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    },
  }
}

export const initializeDatabase = async () => {
  await bootstrapDatabase()
  pool = createPool(config.database.name)
  await waitForDatabase(pool, 'big-screen database')
  await runMigrations(databaseClient())
  return databaseClient()
}

export const getDatabase = () => databaseClient()

export const closeDatabase = async () => {
  const currentPool = pool
  pool = null
  await currentPool?.end()
}
