// Node-only path helpers shared by the server, library service, and tools.
//
// Every path exposed to clients or read from JSON is treated as unsafe until it
// has been resolved inside an explicit root. Nothing here touches the network
// or the Express layer so the helpers stay easy to test.

import fs from 'node:fs'
import path from 'node:path'

export const AUDIO_RE = /\.(ogg|mp3|wav)$/i

// True when `targetAbs` is `rootAbs` itself or a descendant of it.
export function isInside(rootAbs, targetAbs) {
  if (typeof rootAbs !== 'string' || typeof targetAbs !== 'string') return false
  const root = path.resolve(rootAbs)
  const target = path.resolve(targetAbs)
  if (target === root) return true
  const base = root.endsWith(path.sep) ? root : root + path.sep
  return target.startsWith(base)
}

// Resolve a *relative* id/path inside `rootAbs`.
//
// Absolute input, NUL bytes, and normalized escapes return null. Matching the
// old `resolveSoundsetDir` semantics, the root itself is not an acceptable
// target.
export function resolveInside(rootAbs, relOrAbs) {
  if (typeof rootAbs !== 'string' || !rootAbs) return null
  if (typeof relOrAbs !== 'string' || !relOrAbs) return null
  if (relOrAbs.includes('\0')) return null
  if (path.isAbsolute(relOrAbs)) return null

  const root = path.resolve(rootAbs)
  const target = path.normalize(path.join(root, relOrAbs))
  if (target === root) return null
  if (!isInside(root, target)) return null
  return target
}

export function toPosixPath(p) {
  return String(p).replace(/\\/g, '/')
}

// Relative path from a directory to a target, always using forward slashes.
export function relativePosix(fromDirAbs, toAbs) {
  const rel = path.relative(path.resolve(fromDirAbs), path.resolve(toAbs))
  return toPosixPath(rel) || '.'
}

// Lowercase, ASCII-only slug suitable for a library folder name.
export function slugify(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Return a free path in `dirAbs`, adding -2, -3, ... before the extension.
export function uniquePath(dirAbs, filename) {
  const base = path.basename(String(filename))
  const ext = path.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base

  let candidate = path.join(dirAbs, base)
  let n = 1
  while (fs.existsSync(candidate)) {
    n += 1
    candidate = path.join(dirAbs, `${stem}-${n}${ext}`)
  }
  return candidate
}

// Depth-first walk of directories below `rootAbs` (the root itself is not
// yielded). `rel` is always a posix path relative to the root.
export function* walkDirs(rootAbs, { skipDirNames = [] } = {}) {
  const root = path.resolve(rootAbs)
  const skip = new Set(skipDirNames)

  function* walk(abs, rel) {
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (skip.has(entry.name)) continue

      const childAbs = path.join(abs, entry.name)
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      yield { abs: childAbs, rel: toPosixPath(childRel) }
      yield* walk(childAbs, childRel)
    }
  }

  yield* walk(root, '')
}

// Sorted audio files in one directory, with their byte size.
export function listAudioFiles(dirAbs) {
  let entries
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true })
  } catch {
    return []
  }

  const files = []
  for (const entry of entries) {
    if (!entry.isFile() || !AUDIO_RE.test(entry.name)) continue
    let size = 0
    try {
      size = fs.statSync(path.join(dirAbs, entry.name)).size
    } catch {
      // Keep a zero size if the file disappears mid-scan.
    }
    files.push({ file: entry.name, size })
  }

  files.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }))
  return files
}
