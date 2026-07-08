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
import { SafeJsonSchema, type JsonValue } from '../contracts.js'
import type { StoreDatabase } from '../store-types.js'
import { TemplateStore } from '../template-store.js'

type Authorize = (request: Request) => Promise<AuthorizationContext>

export interface TemplateRouterOptions {
  database: StoreDatabase
  authorize?: Authorize
}

const sendError = (response: Response, error: unknown) => {
  const statusCode = error instanceof AuthError
    ? error.statusCode
    : Number((error as { statusCode?: number })?.statusCode || 400)
  response.status(statusCode).json({
    error: error instanceof Error ? error.message : '模板操作失败',
  })
}

const requireTemplateAccess = (
  auth: AuthorizationContext,
  templateId: string,
  capability: 'template:draft' | 'template:publish',
) => {
  if (!hasCapability(auth.screenRole, capability)) {
    throw Object.assign(new Error('无权限执行模板操作'), { statusCode: 403 })
  }
  const template = screenCatalog.find((candidate) => candidate.id === templateId)
  if (!template) {
    throw Object.assign(new Error('未知大屏模板'), { statusCode: 404 })
  }
  if (!auth.allowedSystems.includes(template.systemKey)) {
    throw Object.assign(new Error('无权限访问该系统模板'), { statusCode: 403 })
  }
  return template
}

const requestId = (request: Request) =>
  String(request.headers['x-request-id'] || randomUUID()).slice(0, 128)

const audit = (
  database: StoreDatabase,
  auth: AuthorizationContext,
  action: string,
  templateId: string,
  detail: JsonValue,
) => writeAuditEvent(database, {
  actorUserId: auth.user.id,
  action,
  entityType: 'template',
  entityId: templateId,
  detail,
})

export const createTemplateRouter = ({
  database,
  authorize = authorizeRequest,
}: TemplateRouterOptions) => {
  const router = Router()
  const store = new TemplateStore(database)

  router.get('/templates/:templateId/draft', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireTemplateAccess(auth, request.params.templateId, 'template:draft')
      response.json({
        templateId: request.params.templateId,
        config: await store.getDraft(request.params.templateId, auth.user.id),
      })
    } catch (error) {
      sendError(response, error)
    }
  })

  router.get('/templates/:templateId/versions', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireTemplateAccess(auth, request.params.templateId, 'template:draft')
      response.json({
        templateId: request.params.templateId,
        versions: await store.listVersions(request.params.templateId),
      })
    } catch (error) {
      sendError(response, error)
    }
  })

  router.put('/templates/:templateId/draft', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireTemplateAccess(auth, request.params.templateId, 'template:draft')
      const config = SafeJsonSchema.parse(request.body?.config)
      const draft = await store.saveDraft(
        request.params.templateId,
        auth.user.id,
        config,
      )
      await audit(database, auth, 'template.draft.save', request.params.templateId, {
        requestId: requestId(request),
        changedFields: typeof config === 'object' && config && !Array.isArray(config)
          ? Object.keys(config)
          : [],
      })
      response.json(draft)
    } catch (error) {
      sendError(response, error)
    }
  })

  router.post('/templates/:templateId/publish', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireTemplateAccess(auth, request.params.templateId, 'template:publish')
      const published = await store.publish(request.params.templateId, auth.user.id)
      await audit(database, auth, 'template.publish', request.params.templateId, {
        requestId: requestId(request),
        version: published.version,
      })
      response.status(201).json(published)
    } catch (error) {
      sendError(response, error)
    }
  })

  router.post('/templates/:templateId/restore-default', async (request, response) => {
    try {
      const auth = await authorize(request)
      const template = requireTemplateAccess(
        auth,
        request.params.templateId,
        'template:draft',
      )
      const draft = await store.saveDraft(
        request.params.templateId,
        auth.user.id,
        template as unknown as JsonValue,
      )
      await audit(
        database,
        auth,
        'template.restore-default',
        request.params.templateId,
        { requestId: requestId(request) },
      )
      response.json(draft)
    } catch (error) {
      sendError(response, error)
    }
  })

  router.post('/templates/:templateId/rollback', async (request, response) => {
    try {
      const auth = await authorize(request)
      requireTemplateAccess(auth, request.params.templateId, 'template:publish')
      const version = Number(request.body?.version)
      const published = await store.rollback(
        request.params.templateId,
        version,
        auth.user.id,
      )
      await audit(database, auth, 'template.rollback', request.params.templateId, {
        requestId: requestId(request),
        sourceVersion: version,
        version: published.version,
      })
      response.status(201).json(published)
    } catch (error) {
      sendError(response, error)
    }
  })

  return router
}
