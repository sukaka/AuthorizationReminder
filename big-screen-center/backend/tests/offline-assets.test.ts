import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verifierSource = path.resolve(backendRoot, '../deploy/verify-offline-assets.mjs')
const temporaryProjects: string[] = []

async function writeProjectFile(projectRoot: string, relativePath: string, contents: string) {
  const file = path.join(projectRoot, relativePath)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, contents)
}

async function runVerifier(
  contents: string,
  relativePath = 'assets/fixture.txt',
  setup?: (projectRoot: string) => Promise<void>,
) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'offline-assets-'))
  temporaryProjects.push(projectRoot)

  const verifier = path.join(projectRoot, 'deploy/verify-offline-assets.mjs')
  await mkdir(path.dirname(verifier), { recursive: true })
  await copyFile(verifierSource, verifier)
  await writeProjectFile(projectRoot, relativePath, contents)
  await setup?.(projectRoot)

  return spawnSync(process.execPath, [verifier], { encoding: 'utf8' })
}

async function pathExists(target: string) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
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
      'frontend/src/App.vue',
      async (projectRoot) => {
        await writeProjectFile(projectRoot, 'assets/a.png', 'a')
        await writeProjectFile(projectRoot, 'assets/b.png', 'b')
      },
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

  it('scans frontend source outside the templates directory', async () => {
    const result = await runVerifier(
      '<script setup>const texture = "https://cdn.example/a.png"</script>',
      'frontend/src/components/RiskyPanel.vue',
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('remote or protocol-relative URL is not allowed')
  })

  it.each(['https:\\/\\/cdn.example/a.png', '\\/\\/cdn.example/a.png'])(
    'rejects escaped remote URL text %s',
    async (url) => {
      const result = await runVerifier(`{"texture":"${url}"}`, 'assets/fixture.json')

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('remote or protocol-relative URL is not allowed')
    },
  )

  it('rejects encoded traversal before resolving an assets path', async () => {
    const result = await runVerifier(
      '<img src=/assets/%2e%2e/outside.png>',
      'frontend/src/components/RiskyPanel.vue',
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('resource path escapes assets')
  })

  it('reports invalid URL encoding in resource paths without crashing', async () => {
    const result = await runVerifier('<img src=/assets/%zz.png>')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid URL encoding in resource path')
  })

  it('rejects an assets reference whose target file does not exist', async () => {
    const result = await runVerifier('<img src=/assets/does-not-exist.png>')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('resource target does not exist')
  })

  it('accepts an assets reference whose target file exists', async () => {
    const result = await runVerifier(
      '<img src=/assets/existing.png>',
      'frontend/src/App.vue',
      (projectRoot) => writeProjectFile(projectRoot, 'assets/existing.png', 'png'),
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Offline asset verification passed')
  })

  it('does not decode-check a non-resource percent string', async () => {
    const result = await runVerifier('const label = "100% ready"\n', 'frontend/src/App.vue')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Offline asset verification passed')
  })

  it(
    'build scripts create production output without emitting test artifacts',
    async () => {
      const projectRoot = path.resolve(backendRoot, '..')
      const frontendRoot = path.join(projectRoot, 'frontend')
      const backendDist = path.join(backendRoot, 'dist')
      const frontendDist = path.join(frontendRoot, 'dist')
      const viteConfigOutput = path.join(frontendRoot, 'vite.config.js')
      const frontendTsBuildInfo = path.join(frontendRoot, 'tsconfig.tsbuildinfo')

      await rm(backendDist, { force: true, recursive: true })
      await rm(frontendDist, { force: true, recursive: true })
      await rm(viteConfigOutput, { force: true })
      await rm(frontendTsBuildInfo, { force: true })

      const backendBuild = spawnSync('npm', ['--prefix', backendRoot, 'run', 'build'], {
        encoding: 'utf8',
      })
      const frontendBuild = spawnSync('npm', ['--prefix', frontendRoot, 'run', 'build'], {
        encoding: 'utf8',
      })

      expect(backendBuild.status, backendBuild.stderr || backendBuild.stdout).toBe(0)
      expect(frontendBuild.status, frontendBuild.stderr || frontendBuild.stdout).toBe(0)
      expect(await pathExists(path.join(backendDist, 'server.js'))).toBe(true)
      expect(await pathExists(path.join(backendDist, 'tests'))).toBe(false)
      expect(await pathExists(path.join(frontendDist, 'index.html'))).toBe(true)
      expect(await pathExists(viteConfigOutput)).toBe(false)
      expect(await pathExists(frontendTsBuildInfo)).toBe(false)
    },
    30000,
  )
})
