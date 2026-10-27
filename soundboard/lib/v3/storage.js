// v3 storage helpers: safe paths, atomic JSON, and content-addressed audio.
//
// This module performs filesystem I/O but has no knowledge of the v3 entity
// shapes. All path builders reject absolute paths and traversal segments.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export const HASH_RE = /^[a-f0-9]{64}$/
export const AUDIO_EXTENSIONS = Object.freeze(['ogg', 'mp3', 'wav'])

function pathError(message) {
  const err = new Error(message)
  err.code = 'invalid-path'
  return err
}

export function isValidHash(value) {
  return typeof value === 'string' && HASH_RE.test(value)
}

function audioExtension(value) {
  const ext = String(value ?? '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase()
  return AUDIO_EXTENSIONS.includes(ext) ? ext : null
}

export function extensionOf(name) {
  if (typeof name !== 'string') return null
  const base = name.split(/[\\/]/).pop() || ''
  const index = base.lastIndexOf('.')
  if (index < 0) return null
  return audioExtension(base.slice(index + 1))
}

// Join parts below `root`, rejecting absolute inputs and `..` segments.
export function safeJoin(root, ...parts) {
  if (typeof root !== 'string' || !root) throw pathError('A storage root is required')
  const rootAbs = path.resolve(root)

  for (const part of parts) {
    if (typeof part !== 'string') throw pathError('Path segments must be strings')
    if (!part) continue
    if (part.includes('\0')) throw pathError('Path segments may not contain NUL bytes')
    if (path.isAbsolute(part) || /^[A-Za-z]:[\\/]/.test(part)) {
      throw pathError(`Absolute path segments are not allowed: ${part}`)
    }
    if (part.split(/[\\/]/).includes('..')) {
      throw pathError(`Path traversal is not allowed: ${part}`)
    }
  }

  const joined = path.resolve(rootAbs, ...parts)
  const relative = path.relative(rootAbs, joined)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw pathError(`Path escapes its root: ${parts.join('/')}`)
  }
  return joined
}

export function soundPath(soundsDir, hash, ext) {
  if (!isValidHash(hash)) throw pathError(`Invalid sound hash: ${hash}`)
  const normalizedExt = audioExtension(ext)
  if (!normalizedExt) throw pathError(`Invalid audio extension: ${ext}`)
  return safeJoin(soundsDir, hash.slice(0, 2), `${hash}.${normalizedExt}`)
}

export function scenePath(dataDir, id) {
  if (
    typeof id !== 'string' ||
    !id ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0')
  ) {
    throw pathError(`Invalid scene id: ${id}`)
  }
  return safeJoin(dataDir, 'scenes', `${id}.json`)
}

export function catalogPath(dataDir) {
  return safeJoin(dataDir, 'catalog.json')
}

export function libraryPath(dataDir) {
  return safeJoin(dataDir, 'library.json')
}

export function globalPath(dataDir) {
  return safeJoin(dataDir, 'global.json')
}

export function importDonePath(dataDir) {
  return safeJoin(dataDir, 'import-done')
}

export function contentAddressedRelPath(hash, ext) {
  if (!isValidHash(hash)) throw pathError(`Invalid sound hash: ${hash}`)
  const normalizedExt = audioExtension(ext)
  if (!normalizedExt) throw pathError(`Invalid audio extension: ${ext}`)
  return `${hash.slice(0, 2)}/${hash}.${normalizedExt}`
}

export async function ensureDirs(...dirs) {
  for (const entry of dirs.flat()) {
    if (typeof entry !== 'string' || !entry) continue
    await fs.mkdir(entry, { recursive: true })
  }
}

export async function readJson(file, fallback) {
  try {
    const text = await fs.readFile(file, 'utf8')
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export async function writeJsonAtomic(file, value) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })

  const base = path.basename(file)
  const temp = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  )

  const text = `${JSON.stringify(value, null, 2)}\n`
  try {
    await fs.writeFile(temp, text, 'utf8')
    await fs.rename(temp, file)
  } catch (err) {
    try {
      await fs.unlink(temp)
    } catch {
      // The temp file may not exist; ignore cleanup failures.
    }
    throw err
  }
}

export async function fileInfo(abs) {
  try {
    const stat = await fs.stat(abs)
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return { exists: false, size: 0, mtimeMs: 0 }
  }
}

export async function hashFile(abs) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(abs)) hash.update(chunk)
  return hash.digest('hex')
}
