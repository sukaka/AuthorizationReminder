#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = path.join(projectRoot, 'assets')
const templatesRoot = path.join(projectRoot, 'frontend', 'src', 'templates')
const remoteUrlPattern = /https?:\/\//i
const protocolRelativeUrlPatterns = [
  /(?:url\(\s*|['"`]\s*)\/\//i,
  /\b[\w:-]+\s*=\s*(?:['"`]\s*)?\/\//i,
  /@import\s+(?:url\(\s*)?(?:['"`]\s*)?\/\//i,
]
const quotedValuePattern = /(['"`])((?:\\.|(?!\1).)*)\1/gs
const cssUrlPattern = /url\(\s*(?:(['"`])((?:\\.|(?!\1).)*)\1|([^'"`\s)]+))\s*\)/gis
const resourceAttributePattern =
  /\b(?:src|href)\s*=\s*(?:(['"`])((?:\\.|(?!\1).)*)\1|([^\s'"`=<>]+))/gis
const resourceExtensionPattern =
  /\.(?:avif|bin|css|csv|eot|fbx|geojson|gif|glb|gltf|jpeg|jpg|json|ktx2|mp3|mp4|obj|otf|png|svg|ttf|webm|webp|woff2?)$/i
const textExtensionPattern = /\.(?:css|csv|geojson|html|js|json|mjs|svg|ts|tsx|txt|vue)$/i

async function listFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const nestedFiles = await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(directory, entry.name)
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

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveResourceReference(sourceFile, reference) {
  const normalized = reference.split(/[?#]/, 1)[0]

  if (normalized.startsWith('/assets/')) {
    return path.join(assetsRoot, normalized.slice('/assets/'.length))
  }
  if (normalized.startsWith('assets/')) {
    return path.join(assetsRoot, normalized.slice('assets/'.length))
  }

  return path.resolve(path.dirname(sourceFile), normalized)
}

function extractReferences(contents) {
  const references = new Set(
    [...contents.matchAll(quotedValuePattern)].map((match) => match[2]),
  )

  for (const match of contents.matchAll(cssUrlPattern)) {
    references.add(match[2] ?? match[3])
  }
  for (const match of contents.matchAll(resourceAttributePattern)) {
    references.add(match[2] ?? match[3])
  }

  return references
}

function containsRemoteUrl(contents) {
  return (
    remoteUrlPattern.test(contents) ||
    protocolRelativeUrlPatterns.some((pattern) => pattern.test(contents))
  )
}

async function verifyFile(file, failures) {
  if (!textExtensionPattern.test(file)) {
    return 0
  }

  const contents = await readFile(file, 'utf8')
  const displayPath = path.relative(projectRoot, file)

  if (containsRemoteUrl(contents)) {
    failures.push(`${displayPath}: remote or protocol-relative URL is not allowed`)
  }

  let checkedReferences = 0
  for (const reference of extractReferences(contents)) {
    const bareReference = reference.split(/[?#]/, 1)[0]
    if (!resourceExtensionPattern.test(bareReference)) {
      continue
    }

    checkedReferences += 1
    const resolved = resolveResourceReference(file, reference)
    if (!isWithin(assetsRoot, resolved)) {
      failures.push(`${displayPath}: resource path escapes assets: ${reference}`)
    }
  }

  return checkedReferences
}

const templateFiles = await listFiles(templatesRoot)
const assetFiles = await listFiles(assetsRoot)
const failures = []
let checkedReferences = 0

for (const file of [...templateFiles, ...assetFiles]) {
  checkedReferences += await verifyFile(file, failures)
}

const templateCount = templateFiles.filter((file) => textExtensionPattern.test(file)).length

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
}
