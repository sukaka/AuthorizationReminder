import { randomUUID } from 'node:crypto'

import { Router, type Request, type Response } from 'express'

import {
  authorizeRequest,
  AuthError,
  hasCapability,
  type AuthorizationContext,
} from '../auth.js'
import { writeAuditEvent } from '../audit.js'
import type { ResourcePackService } from '../resource-pack-store.js'
import type { StoreDatabase } from '../store-types.js'

type Authorize = (request: Request) => Promise<AuthorizationContext>

export interface ResourceRouterOptions {
  authorize?: Authorize
  database: StoreDatabase
  resourcePacks: ResourcePackService
}

const sendError = (response: Response, error: unknown) => {
  const statusCode = error instanceof AuthError
    ? error.statusCode
    : Number((error as { statusCode?: number })?.statusCode || 400)
  response.status(statusCode).json({
    error: error instanceof Error ? error.message : '资源包操作失败',
  })
}

const requireSysadmin = (auth: AuthorizationContext) => {
  if (!hasCapability(auth.screenRole, 'source:admin')) {
    throw Object.assign(new Error('仅系统管理员可管理资源包'), { statusCode: 403 })
  }
}

const audit = (
  database: StoreDatabase,
  auth: AuthorizationContext,
  action: string,
  packKey: string,
  version: number,
  request: Request,
) => writeAuditEvent(database, {
  actorUserId: auth.user.id,
  action,
  entityType: 'resource-pack',
  entityId: `${packKey}:${version}`,
  detail: {
    requestId: String(request.headers['x-request-id'] || randomUUID()).slice(0, 128),
    packKey,
    version,
  },
})

export const createResourceRouter = ({
  authorize = authorizeRequest,
  database,
  resourcePacks,
}: ResourceRouterOptions) => {
  const router = Router()

  router.post('/resources/packs', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireSysadmin(auth)
      const result = await resourcePacks.upload({
        manifest: request.body?.manifest,
        signatureBase64: String(request.body?.signatureBase64 || ''),
        uploadedBy: auth.user.id,
      })
      await audit(
        database,
        auth,
        'resource-pack.upload',
        result.packKey,
        result.version,
        request,
      )
      response.status(201).json(result)
    } catch (error) {
      sendError(response, error)
    }
  })

  router.post('/resources/packs/:packKey/:version/enable', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireSysadmin(auth)
      const version = Number(request.params.version)
      const result = await resourcePacks.enable(request.params.packKey, version)
      await audit(
        database,
        auth,
        'resource-pack.enable',
        result.packKey,
        result.version,
        request,
      )
      response.json(result)
    } catch (error) {
      sendError(response, error)
    }
  })

  router.post('/resources/packs/:packKey/:version/rollback', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireSysadmin(auth)
      const version = Number(request.params.version)
      const result = await resourcePacks.rollback(request.params.packKey, version)
      await audit(
        database,
        auth,
        'resource-pack.rollback',
        result.packKey,
        result.version,
        request,
      )
      response.json(result)
    } catch (error) {
      sendError(response, error)
    }
  })

  return router
}
