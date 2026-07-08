import { createApp } from './app.js'
import { MysqlSnapshotStore } from './cache.js'
import { closeDatabase, initializeDatabase } from './db.js'

const port = Number(process.env.PORT || 5192)
const database = await initializeDatabase()
const app = createApp({
  database,
  snapshots: new MysqlSnapshotStore(database),
})

const server = app.listen(port, () => {
  console.log(`Big-screen backend listening on port ${port}`)
})

const shutdown = async () => {
  server.close(async () => {
    await closeDatabase()
    process.exit(0)
  })
}

process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown())
