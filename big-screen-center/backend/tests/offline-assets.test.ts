import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verifierSource = path.resolve(backendRoot, '../deploy/verify-offline-assets.mjs')
const temporaryProjects: string[] = []

async function runVerifier(contents: string, relativePath = 'assets/fixture.txt') {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'offline-assets-'))
  temporaryProjects.push(projectRoot)

  const verifier = path.join(projectRoot, 'deploy/verify-offline-assets.mjs')
  const fixture = path.join(projectRoot, relativePath)
  await mkdir(path.dirname(verifier), { recursive: true })
  await mkdir(path.dirname(fixture), { recursive: true })
  await copyFile(verifierSource, verifier)
  await writeFile(fixture, contents)

  return spawnSync(process.execPath, [verifier], { encoding: 'utf8' })
}

afterEach(async () => {
  await Promise.all(
    temporaryProjects.splice(0).map((projectRoot) => rm(projectRoot, { recursive: true })),
  )
})

describe('offline asset verification', () => {
  it.each([
    '<img src=//cdn/a.png>',
    '<link href = //cdn/a.css>',
    '@import //cdn/a.css;',
  ])('rejects an unquoted protocol-relative URL in %s', async (contents) => {
    const result = await runVerifier(contents)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('remote or protocol-relative URL is not allowed')
  })

  it('does not treat an ordinary code comment as a URL', async () => {
    const result = await runVerifier('// comment\nconst value = 1\n')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Offline asset verification passed')
  })

  it.each(['http://cdn.example/a.png', 'https://cdn.example/a.png'])(
    'continues to reject %s',
    async (url) => {
      const result = await runVerifier(`{"texture":"${url}"}`, 'assets/fixture.json')

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('remote or protocol-relative URL is not allowed')
    },
  )

  it('continues to reject paths that escape assets', async () => {
    const result = await runVerifier(
      '{"texture":"../../outside.png"}',
      'assets/fixture.json',
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('resource path escapes assets')
  })

  it.each([
    'body { background: url(../../outside.png); }',
    'body { background: url("../../outside.png"); }',
    '<img src=../../outside.png>',
    '<img src="../../outside.png">',
    '<link href=../../outside.css>',
    "<link href='../../outside.css'>",
  ])('rejects a resource path that escapes assets in %s', async (contents) => {
    const result = await runVerifier(contents)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('resource path escapes assets')
  })

  it.each([
    '// comment\nconst value = 1\n',
    "import helper from '../../outside.js'\n",
    'const label = "../../outside"\n',
  ])('does not treat non-resource text as an asset reference', async (contents) => {
    const result = await runVerifier(contents)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Offline asset verification passed')
  })

  it.each([
    '<video poster=../../outside.png>',
    '<object data=../../outside.svg>',
    '<img srcset=../../a.png 1x,../../b.png 2x>',
  ])('rejects an unquoted resource attribute that escapes assets in %s', async (contents) => {
    const result = await runVerifier(contents)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('resource path escapes assets')
  })

  it('accepts an unquoted srcset whose candidates stay within assets', async () => {
    const result = await runVerifier(
      '<img srcset=/assets/a.png 1x, /assets/b.png 2x>',
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Offline asset verification passed')
  })

  it.each(['<div data-id=123>', '<button aria-label=x>'])(
    'does not treat metadata attributes as asset references in %s',
    async (contents) => {
      const result = await runVerifier(contents)

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Offline asset verification passed')
    },
  )
})
