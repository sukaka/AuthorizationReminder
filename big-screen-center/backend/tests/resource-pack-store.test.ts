import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { SqlExecutor } from '../src/db.js'
import { ResourcePackStore } from '../src/resource-pack-store.js'
import type { StoreDatabase } from '../src/store-types.js'

const temporaryDirectories: string[] = []

const memoryDatabase = () => {
  const inserts: unknown[][] = []
  const executor: SqlExecutor = {
    async query() {
      return []
    },
    async get() {
      return null
    },
    async run(sql, params = []) {
      if (sql.includes('INSERT INTO screen_resource_packs')) inserts.push(params)
      return { insertId: inserts.length, affectedRows: 1 }
    },
  }
  const database: StoreDatabase = {
    ...executor,
    async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>) {
      return work(executor)
    },
  }
  return { database, inserts }
}

const createSignedFixture = async () => {
  const assetsRoot = await mkdtemp(path.join(tmpdir(), 'resource-pack-'))
  temporaryDirectories.push(assetsRoot)
  const filePath = path.join(assetsRoot, 'maps', 'fixture.json')
  await mkdir(path.dirname(filePath), { recursive: true })
  const contents = '{"type":"FeatureCollection","features":[]}'
  await writeFile(filePath, contents)
  const manifest = {
    packKey: 'china-map',
    version: 1,
    files: [{
      path: 'maps/fixture.json',
      sha256: createHash('sha256').update(contents).digest('hex'),
    }],
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const signature = sign(null, Buffer.from(JSON.stringify(manifest)), privateKey)
    .toString('base64')
  return {
    assetsRoot,
    manifest,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    signature,
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  )
})

describe('ResourcePackStore', () => {
  it('verifies Ed25519 signatures and every file digest before storing', async () => {
    const fixture = await createSignedFixture()
    const memory = memoryDatabase()
    const store = new ResourcePackStore({
      database: memory.database,
      assetsRoot: fixture.assetsRoot,
      publicKey: fixture.publicKey,
    })

    const stored = await store.upload({
      manifest: fixture.manifest,
      signatureBase64: fixture.signature,
      uploadedBy: 9,
    })

    expect(stored).toMatchObject({ id: 1, packKey: 'china-map', version: 1 })
    expect(memory.inserts).toHaveLength(1)
  })

  it('rejects traversal and symlinks that escape the assets root', async () => {
    const fixture = await createSignedFixture()
    const outside = path.join(fixture.assetsRoot, '..', 'outside-pack.json')
    await writeFile(outside, '{}')
    await symlink(outside, path.join(fixture.assetsRoot, 'escaped.json'))
    const memory = memoryDatabase()
    const store = new ResourcePackStore({
      database: memory.database,
      assetsRoot: fixture.assetsRoot,
      publicKey: fixture.publicKey,
    })

    await expect(store.upload({
      manifest: {
        packKey: 'unsafe',
        version: 1,
        files: [{ path: '../outside-pack.json', sha256: '0'.repeat(64) }],
      },
      signatureBase64: fixture.signature,
      uploadedBy: 9,
    })).rejects.toThrow('path')

    const escapedManifest = {
      packKey: 'unsafe',
      version: 2,
      files: [{
        path: 'escaped.json',
        sha256: createHash('sha256').update('{}').digest('hex'),
      }],
    }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const escapedStore = new ResourcePackStore({
      database: memory.database,
      assetsRoot: fixture.assetsRoot,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })
    const escapedSignature = sign(
      null,
      Buffer.from(JSON.stringify(escapedManifest)),
      privateKey,
    ).toString('base64')

    await expect(escapedStore.upload({
      manifest: escapedManifest,
      signatureBase64: escapedSignature,
      uploadedBy: 9,
    })).rejects.toThrow('escapes assets')
  })
})
