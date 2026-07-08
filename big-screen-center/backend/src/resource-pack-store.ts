import { createHash, verify } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { StoreDatabase } from './store-types.js'

const ResourcePackManifestSchema = z.object({
  packKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  version: z.number().int().positive(),
  files: z.array(z.object({
    path: z.string().min(1).max(240),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
}).strict()

export type ResourcePackManifest = z.infer<typeof ResourcePackManifestSchema>

export interface ResourcePackUpload {
  manifest: unknown
  signatureBase64: string
  uploadedBy: number
}

export interface ResourcePackResult {
  id?: number
  packKey: string
  version: number
  enabled?: boolean
}

export interface ResourcePackService {
  upload(input: ResourcePackUpload): Promise<ResourcePackResult>
  enable(packKey: string, version: number): Promise<ResourcePackResult>
  rollback(packKey: string, version: number): Promise<ResourcePackResult>
}

export interface ResourcePackStoreOptions {
  database: StoreDatabase
  assetsRoot: string
  publicKey: string
}

const isWithin = (parent: string, candidate: string) => {
  const relative = path.relative(parent, candidate)
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const safeAssetPath = (assetsRoot: string, relativePath: string) => {
  if (
    path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).some((segment) => segment === '..')
  ) {
    throw new Error(`Resource path is invalid: ${relativePath}`)
  }
  const resolved = path.resolve(assetsRoot, relativePath)
  if (!isWithin(path.resolve(assetsRoot), resolved)) {
    throw new Error(`Resource path escapes assets: ${relativePath}`)
  }
  return resolved
}

const rejectSymlinks = async (
  assetsRoot: string,
  target: string,
  relativePath: string,
) => {
  const segments = path.relative(assetsRoot, target).split(path.sep).filter(Boolean)
  let current = assetsRoot
  for (const segment of segments) {
    current = path.join(current, segment)
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(`Resource real path escapes assets: ${relativePath}`)
    }
  }
}

const validatePackKey = (packKey: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(packKey)) {
    throw new Error('Resource pack key is invalid')
  }
}

const validateVersion = (version: number) => {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error('Resource pack version is invalid')
  }
}

export class ResourcePackStore implements ResourcePackService {
  constructor(private readonly options: ResourcePackStoreOptions) {}

  async upload(input: ResourcePackUpload): Promise<ResourcePackResult> {
    const manifest = ResourcePackManifestSchema.parse(input.manifest)
    if (!Number.isSafeInteger(input.uploadedBy) || input.uploadedBy <= 0) {
      throw new Error('Resource pack uploader is invalid')
    }

    const root = path.resolve(this.options.assetsRoot)
    const realAssetsRoot = await realpath(root)
    for (const file of manifest.files) {
      const resolved = safeAssetPath(root, file.path)
      await rejectSymlinks(root, resolved, file.path)
      const realFile = await realpath(resolved)
      if (!isWithin(realAssetsRoot, realFile)) {
        throw new Error(`Resource real path escapes assets: ${file.path}`)
      }
      const digest = createHash('sha256')
        .update(await readFile(realFile))
        .digest('hex')
      if (digest !== file.sha256) {
        throw new Error(`Resource digest mismatch: ${file.path}`)
      }
    }

    if (!this.options.publicKey.trim()) {
      throw new Error('BIG_SCREEN_RESOURCE_PUBLIC_KEY is required')
    }
    const manifestJson = JSON.stringify(manifest)
    const signature = Buffer.from(input.signatureBase64, 'base64')
    let signatureValid = false
    try {
      signatureValid = verify(
        null,
        Buffer.from(manifestJson),
        this.options.publicKey,
        signature,
      )
    } catch {
      signatureValid = false
    }
    if (!signatureValid) throw new Error('Resource pack signature is invalid')

    const manifestSha256 = createHash('sha256')
      .update(manifestJson)
      .digest('hex')
    const result = await this.options.database.run(
      `INSERT INTO screen_resource_packs
        (pack_key, version_no, manifest_json, sha256, signature_base64, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        manifest.packKey,
        manifest.version,
        manifestJson,
        manifestSha256,
        input.signatureBase64,
        input.uploadedBy,
      ],
    )
    return {
      id: result.insertId,
      packKey: manifest.packKey,
      version: manifest.version,
    }
  }

  async enable(packKey: string, version: number): Promise<ResourcePackResult> {
    validatePackKey(packKey)
    validateVersion(version)
    await this.options.database.transaction(async (transaction) => {
      await transaction.run(
        'UPDATE screen_resource_packs SET enabled = 0 WHERE pack_key = ?',
        [packKey],
      )
      const result = await transaction.run(
        `UPDATE screen_resource_packs
         SET enabled = 1
         WHERE pack_key = ? AND version_no = ?`,
        [packKey, version],
      )
      if (result.affectedRows !== 1) {
        throw Object.assign(new Error('Resource pack version was not found'), {
          statusCode: 404,
        })
      }
    })
    return { packKey, version, enabled: true }
  }

  rollback(packKey: string, version: number) {
    return this.enable(packKey, version)
  }
}
