import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { soundPath, writeJsonAtomic } from '../../lib/v3/storage.js'

export async function tempDir(prefix = 'olea-v3-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

export async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true })
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function soundFixture(id, name = `${id}.ogg`, ext = 'ogg') {
  const hash = sha256(id)
  return {
    id,
    hash,
    ext,
    size: Buffer.byteLength(id),
    duration: null,
    originalName: name,
    addedAt: '2026-01-01T00:00:00.000Z',
  }
}

export async function makeStoreDirs(t) {
  const dir = await tempDir()
  const dataDir = path.join(dir, 'data')
  const soundsDir = path.join(dir, 'sounds')
  await fs.mkdir(dataDir, { recursive: true })
  await fs.mkdir(soundsDir, { recursive: true })
  if (t) t.after(() => cleanup(dir))
  return { dir, dataDir, soundsDir }
}

export async function seedCatalog(dataDir, sounds) {
  await writeJsonAtomic(path.join(dataDir, 'catalog.json'), { version: 3, sounds })
}

export async function writeAudioFixture(soundsDir, sound, data = sound.id) {
  const bytes = Buffer.from(data)
  const file = soundPath(soundsDir, sound.hash, sound.ext)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, bytes)
  return { file, bytes }
}
