import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildBusinessDetailUrl,
  openBusinessDetail,
} from '../src/interactions/business-navigation'

const viteEnvKeys = [
  'VITE_SCA_APP_URL',
  'VITE_TRAIN_EXAM_APP_URL',
  'VITE_REMINDER_APP_URL',
] as const
const repositoryRoot = resolve(process.cwd(), '../..')

describe('business navigation', () => {
  beforeEach(() => {
    for (const key of viteEnvKeys) vi.stubEnv(key, '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the local SCA port and filters sensitive context parameters', () => {
    expect(buildBusinessDetailUrl({
      systemKey: 'sca',
      detailPath: '/',
      currentHref: 'http://127.0.0.1:18092/play/sca-01',
      context: {
        metric: 'criticalRisks',
        dateRange: '30d',
        token: 'secret',
        user: 'operator',
        customer: 'internal',
      },
    })).toBe(
      'http://127.0.0.1:18089/?metric=criticalRisks&dateRange=30d',
    )
  })

  it('opens the local training system safely in a new tab', () => {
    const open = vi.fn()

    openBusinessDetail(
      {
        systemKey: 'train-exam',
        detailPath: '/',
        currentHref: 'http://localhost:18092/play/train-01',
        context: { metric: 'course_total' },
      },
      open,
    )

    expect(open).toHaveBeenCalledWith(
      'http://localhost:18087/?metric=course_total',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('uses the local reminder port for an IPv6 loopback host', () => {
    expect(buildBusinessDetailUrl({
      systemKey: 'reminder',
      detailPath: '/',
      currentHref: 'https://[::1]:18092/play/remind-01',
      context: {},
    })).toBe('https://[::1]:18080/')
  })

  it('uses the current origin for a non-local unconfigured deployment', () => {
    expect(buildBusinessDetailUrl({
      systemKey: 'sca',
      detailPath: '/',
      currentHref: 'https://screen.example.com/play/sca-01',
      context: { projectId: 42 },
    })).toBe('https://screen.example.com/?projectId=42')
  })

  it.each([
    'javascript:alert(1)',
    '//evil.example/a',
    'https://evil.example/a',
    '/unlisted',
  ])('rejects unsafe or unlisted detail path %s', (detailPath) => {
    expect(() => buildBusinessDetailUrl({
      systemKey: 'reminder',
      detailPath,
      currentHref: 'http://localhost:18092/play/remind-01',
      context: {},
    })).toThrow('业务详情路径不在白名单中')
  })

  it('includes only allowed string, number, and boolean context values', () => {
    expect(buildBusinessDetailUrl({
      systemKey: 'sca',
      detailPath: '/',
      currentHref: 'https://screen.example.com/play/sca-01',
      context: {
        metric: 'risk',
        dateRange: 30,
        projectId: false,
        category: true,
      },
    })).toBe(
      'https://screen.example.com/?metric=risk&dateRange=30&projectId=false&category=true',
    )
  })

  it('rejects object and null context values', () => {
    expect(buildBusinessDetailUrl({
      systemKey: 'sca',
      detailPath: '/',
      currentHref: 'https://screen.example.com/play/sca-01',
      context: {
        metric: { key: 'risk' },
        dateRange: null,
        projectId: ['project-1'],
        category: 'security',
      },
    })).toBe('https://screen.example.com/?category=security')
  })

  it('uses a configured http origin and removes its path', () => {
    vi.stubEnv('VITE_SCA_APP_URL', 'https://sca.example.com/application')

    expect(buildBusinessDetailUrl({
      systemKey: 'sca',
      detailPath: '/',
      currentHref: 'https://screen.example.com/play/sca-01',
      context: {},
    })).toBe('https://sca.example.com/')
  })

  it('never builds a dangerous URL from a javascript configuration', () => {
    vi.stubEnv('VITE_REMINDER_APP_URL', 'javascript:alert(1)')

    const url = buildBusinessDetailUrl({
      systemKey: 'reminder',
      detailPath: '/',
      currentHref: 'https://screen.example.com/play/remind-01',
      context: {},
    })

    expect(url).toBe('https://screen.example.com/')
    expect(url).not.toMatch(/^javascript:/)
  })

  it('keeps business origins empty in the default big-screen build', () => {
    const env = { ...process.env }
    for (const key of viteEnvKeys) delete env[key]

    const config = JSON.parse(execFileSync(
      'docker',
      ['compose', 'config', '--format', 'json'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env,
      },
    )) as {
      services: {
        'web-big-screen': {
          build: {
            args: Record<string, string>
          }
        }
      }
    }

    expect(config.services['web-big-screen'].build.args).toMatchObject({
      VITE_SCA_APP_URL: '',
      VITE_TRAIN_EXAM_APP_URL: '',
      VITE_REMINDER_APP_URL: '',
    })
  })
})
