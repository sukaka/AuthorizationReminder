import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { app } from '../src/app.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frontendRoot = path.resolve(backendRoot, '..', 'frontend')

async function readPackageScripts(packageRoot: string): Promise<Record<string, string>> {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  return packageJson.scripts ?? {}
}

describe('big-screen scaffold', () => {
  it('registers a minimal health endpoint', () => {
    const healthLayer = app.router.stack.find(
      (layer: { route?: { path?: string } }) => layer.route?.path === '/health',
    ) as {
      route: {
        stack: Array<{
          handle: (
            request: Record<string, never>,
            response: { json: (body: unknown) => void },
          ) => void
        }>
      }
    } | undefined
    let responseBody: unknown

    expect(healthLayer).toBeDefined()
    healthLayer?.route.stack[0]?.handle({}, {
      json(body) {
        responseBody = body
      },
    })
    expect(responseBody).toEqual({
      status: 'ok',
      service: 'big-screen-backend',
    })
  })

  it('keeps typecheck separate from production builds', async () => {
    const backendScripts = await readPackageScripts(backendRoot)
    const frontendScripts = await readPackageScripts(frontendRoot)

    expect(backendScripts.typecheck).toBe('tsc -p tsconfig.json --noEmit')
    expect(backendScripts.build).toBe('tsc -p tsconfig.build.json')
    expect(backendScripts.start).toBe('node dist/server.js')
    expect(frontendScripts.typecheck).toBe('vue-tsc --noEmit')
    expect(frontendScripts.build).toBe('vue-tsc --noEmit && vite build')
  })
})
