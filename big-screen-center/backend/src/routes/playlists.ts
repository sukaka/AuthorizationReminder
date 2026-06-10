import { randomUUID } from 'node:crypto'

import { Router, type Request, type Response } from 'express'

import {
  authorizeRequest,
  AuthError,
  hasCapability,
  type AuthorizationContext,
} from '../auth.js'
import { writeAuditEvent } from '../audit.js'
import { screenCatalog } from '../catalog.js'
import { PlaylistStore } from '../playlist-store.js'
import type { StoreDatabase } from '../store-types.js'

type Authorize = (request: Request) => Promise<AuthorizationContext>

export interface PlaylistRouterOptions {
  database: StoreDatabase
  authorize?: Authorize
}

const sendError = (response: Response, error: unknown) => {
  const statusCode = error instanceof AuthError
    ? error.statusCode
    : Number((error as { statusCode?: number })?.statusCode || 400)
  response.status(statusCode).json({
    error: error instanceof Error ? error.message : '播放列表操作失败',
  })
}

const requireCapability = (
  auth: AuthorizationContext,
  capability: 'screen:play' | 'playlist:write',
) => {
  if (!hasCapability(auth.screenRole, capability)) {
    throw Object.assign(new Error('无权限执行播放列表操作'), { statusCode: 403 })
  }
}

export const createPlaylistRouter = ({
  database,
  authorize = authorizeRequest,
}: PlaylistRouterOptions) => {
  const router = Router()
  const store = new PlaylistStore(database)

  router.get('/playlists', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireCapability(auth, 'screen:play')
      response.json({ playlists: await store.list(auth.user.id) })
    } catch (error) {
      sendError(response, error)
    }
  })

  router.get('/playlists/:playlistId', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireCapability(auth, 'screen:play')
      const playlist = await store.get(Number(request.params.playlistId))
      if (playlist.ownerUserId !== auth.user.id && auth.screenRole !== 'sysadmin') {
        throw Object.assign(new Error('无权限访问该播放列表'), { statusCode: 403 })
      }
      response.json(playlist)
    } catch (error) {
      sendError(response, error)
    }
  })

  router.post('/playlists', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireCapability(auth, 'playlist:write')
      const items = Array.isArray(request.body?.items) ? request.body.items : []
      for (const item of items) {
        const template = screenCatalog.find(
          (candidate) => candidate.id === item?.templateId,
        )
        if (!template) {
          throw Object.assign(new Error('播放列表包含未知模板'), { statusCode: 400 })
        }
        if (!auth.allowedSystems.includes(template.systemKey)) {
          throw Object.assign(new Error('播放列表包含无权限模板'), { statusCode: 403 })
        }
      }
      const playlist = await store.create({
        ...request.body,
        ownerUserId: auth.user.id,
      })
      await writeAuditEvent(database, {
        actorUserId: auth.user.id,
        action: 'playlist.create',
        entityType: 'playlist',
        entityId: playlist.id,
        detail: {
          requestId: String(
            request.headers['x-request-id'] || randomUUID(),
          ).slice(0, 128),
          itemCount: playlist.items.length,
        },
      })
      response.status(201).json(playlist)
    } catch (error) {
      sendError(response, error)
    }
  })

  return router
}
