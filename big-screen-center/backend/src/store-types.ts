import type { DatabaseClient, SqlExecutor } from './db.js'

export type PickSqlRunner = Pick<SqlExecutor, 'run'>
export type StoreDatabase = Pick<DatabaseClient, 'query' | 'get' | 'run' | 'transaction'>
