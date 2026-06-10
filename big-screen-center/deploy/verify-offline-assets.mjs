#!/usr/bin/env node

import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = path.join(projectRoot, 'assets')
const frontendRoot = path.join(projectRoot, 'frontend')
const frontendSrcRoot = path.join(frontendRoot, 'src')
const frontendPublicRoot = path.join(frontendRoot, 'public')
const frontendIndexHtml = path.join(frontendRoot, 'index.html')
const templatesRoot = path.join(projectRoot, 'frontend', 'src', 'templates')
const ignoredDirectoryNames = new Set(['node_modules', 'dist', 'coverage', 'test-results'])
const remoteUrlPattern = /https?:\/\//i
const protocolRelativeUrlPatterns = [
  /(?:url\(\s*|['"`]\s*)\/\//i,
  /\b[\w:-]+\s*=\s*(?:['"`]\s*)?\/\//i,
  /@import\s+(?:url\(\s*)?(?:['"`]\s*)?\/\//i,
]
const quotedValuePattern = /(['"`])((?:\\.|(?!\1).)*)\1/gs
const cssUrlPattern = /url\(\s*(?:(['"`])((?:\\.|(?!\1).)*)\1|([^'"`\s)]+))\s*\)/gis
const markupTagPattern = /<[A-Za-z][^>]*>/gs
const markupAttributePattern =
  /\b([\w:-]+)\s*=\s*(?:(['"])((?:\\.|(?!\2).)*)\2|([^\s'"`=<>]+))/gis
const sideEffectImportPattern =
  /^\s*import\s*(['"])([^'"\n]+)\1\s*;?\s*$/gm
const fromImportPattern = /\bfrom\s*(['"])([^'"]+)\1/g
const srcsetAttributePattern =
  /\bsrcset\s*=\s*(?:(['"])((?:\\.|(?!\1).)*)\1|([^>]*?))(?=\s+[\w:-]+\s*=|\/?>$)/gis
const resourceExtensionPattern =
  /\.(?:avif|bin|css|csv|eot|fbx|geojson|gif|glb|gltf|jpeg|jpg|json|ktx2|mp3|mp4|obj|otf|png|svg|ttf|webm|webp|woff2?)$/i
const explicitAssetPathPattern = /^(?:\/?assets\/|\.\.?\/)/
const textExtensionPattern = /\.(?:css|csv|geojson|html|js|json|mjs|svg|ts|tsx|txt|vue)$/i

async function listFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const nestedFiles = await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
          return []
        }
        return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
      }),
    )

    return nestedFiles.flat()
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function collectExistingFiles(candidates) {
  const files = []

  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate)
      if (candidateStat.isDirectory()) {
        files.push(...(await listFiles(candidate)))
      } else if (candidateStat.isFile()) {
        files.push(candidate)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  }

  return [...new Set(files)]
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeReference(reference) {
  const withoutFragment = reference.split(/[?#]/, 1)[0]

  try {
    return { value: decodeURIComponent(withoutFragment) }
  } catch {
    return { error: `invalid URL encoding in resource path: ${reference}` }
  }
}

function resolveResourceReference(sourceFile, reference) {
  if (reference.startsWith('/assets/')) {
    return path.join(assetsRoot, reference.slice('/assets/'.length))
  }
  if (reference.startsWith('assets/')) {
    return path.join(assetsRoot, reference.slice('assets/'.length))
  }

  return path.resolve(path.dirname(sourceFile), reference)
}

function extractReferences(contents) {
  const references = new Map(
    [...contents.matchAll(quotedValuePattern)].map((match) => [match[2], false]),
  )

  for (const match of contents.matchAll(cssUrlPattern)) {
    references.set(match[2] ?? match[3], true)
  }

  for (const tagMatch of contents.matchAll(markupTagPattern)) {
    const tag = tagMatch[0]

    for (const match of tag.matchAll(markupAttributePattern)) {
      if (match[1].toLowerCase() !== 'srcset') {
        references.set(match[3] ?? match[4], true)
      }
    }

    for (const match of tag.matchAll(srcsetAttributePattern)) {
      const srcset = match[2] ?? match[3]
      for (const candidate of srcset.split(',')) {
        const reference = candidate.trim().split(/\s+/, 1)[0]
        if (reference) {
          references.set(reference, true)
        }
      }
    }
  }

  return references
}

function containsRemoteUrl(contents) {
  const normalizedContents = contents.replaceAll('\\/', '/')

  return (
    remoteUrlPattern.test(normalizedContents) ||
    protocolRelativeUrlPatterns.some((pattern) => pattern.test(normalizedContents))
  )
}

async function verifyFile(file, failures) {
  if (!textExtensionPattern.test(file)) {
    return 0
  }

  const contents = await readFile(file, 'utf8')
  const displayPath = path.relative(projectRoot, file)
  const moduleImports = new Set([
    ...[...contents.matchAll(sideEffectImportPattern)].map((match) => match[2]),
    ...[...contents.matchAll(fromImportPattern)].map((match) => match[2]),
  ])

  if (containsRemoteUrl(contents)) {
    failures.push(`${displayPath}: remote or protocol-relative URL is not allowed`)
  }

  let checkedReferences = 0
  for (const [reference, hasResourceContext] of extractReferences(contents)) {
    if (moduleImports.has(reference)) {
      continue
    }
    const rawReference = reference.split(/[?#]/, 1)[0]
    const shouldCheckReference =
      resourceExtensionPattern.test(rawReference) ||
      (hasResourceContext && explicitAssetPathPattern.test(rawReference))

    if (!shouldCheckReference) {
      continue
    }

    const normalizedReference = normalizeReference(reference)
    if (normalizedReference.error) {
      failures.push(`${displayPath}: ${normalizedReference.error}`)
      continue
    }

    const bareReference = normalizedReference.value
    const isDecodedResourceReference =
      resourceExtensionPattern.test(bareReference) ||
      (hasResourceContext && explicitAssetPathPattern.test(bareReference))

    if (!isDecodedResourceReference) {
      continue
    }

    checkedReferences += 1
    const resolved = resolveResourceReference(file, bareReference)
    if (!isWithin(assetsRoot, resolved)) {
      failures.push(`${displayPath}: resource path escapes assets: ${reference}`)
      continue
    }

    try {
      const resolvedStat = await stat(resolved)
      if (!resolvedStat.isFile()) {
        failures.push(`${displayPath}: resource target is not a file: ${reference}`)
        continue
      }

      const [realAssetsRoot, realResourcePath] = await Promise.all([
        realpath(assetsRoot),
        realpath(resolved),
      ])
      if (!isWithin(realAssetsRoot, realResourcePath)) {
        failures.push(`${displayPath}: resource real path escapes assets: ${reference}`)
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        failures.push(`${displayPath}: resource target does not exist: ${reference}`)
      } else if (error.code === 'ELOOP') {
        failures.push(`${displayPath}: resource target cannot be resolved: ${reference}`)
      } else {
        throw error
      }
    }
  }

  return checkedReferences
}

const templateFiles = await listFiles(templatesRoot)
const scannedFiles = await collectExistingFiles([
  frontendSrcRoot,
  frontendIndexHtml,
  frontendPublicRoot,
  assetsRoot,
])
const failures = []
let checkedReferences = 0

for (const file of scannedFiles) {
  checkedReferences += await verifyFile(file, failures)
}

const templateIds = new Set()
for (const file of templateFiles.filter((candidate) => textExtensionPattern.test(candidate))) {
  const contents = await readFile(file, 'utf8')
  for (const match of contents.matchAll(/['"]((?:sca|train|remind)-0[1-9])['"]/g)) {
    templateIds.add(match[1])
  }
}
const templateCount = templateIds.size

if (failures.length > 0) {
  console.error('Offline asset verification failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `Offline asset verification passed: ${templateCount} templates, ${checkedReferences} resource references checked.`,
  )
  console.log(`offline assets verified: ${templateCount} templates`)
}
