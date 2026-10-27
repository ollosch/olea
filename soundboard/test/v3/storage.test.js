import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  HASH_RE,
  contentAddressedRelPath,
  ensureDirs,
  extensionOf,
  fileInfo,
  hashFile,
  isValidHash,
  readJson,
  safeJoin,
  scenePath,
  soundPath,
  writeJsonAtomic,
} from '../../lib/v3/storage.js'
import { sha256, tempDir, cleanup } from './helpers.js'

test('writeJsonAtomic creates directories and round-trips JSON', async (t) => {
  const dir = await tempDir('olea-storage-')
  t.after(() => cleanup(dir))

  const file = path.join(dir, 'nested', 'deeper', 'data.json')
  await writeJsonAtomic(file, { hello: 'world', list: [1, 2, 3] })

  assert.deepEqual(await readJson(file, null), { hello: 'world', list: [1, 2, 3] })
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['data.json'])
})

test('readJson returns the fallback for missing and corrupt files', async (t) => {
  const dir = await tempDir('olea-storage-')
  t.after(() => cleanup(dir))

  assert.equal(await readJson(path.join(dir, 'missing.json'), 'fallback'), 'fallback')

  const bad = path.join(dir, 'bad.json')
  await fs.writeFile(bad, '{ this is not json')
  assert.equal(await readJson(bad, 'fallback'), 'fallback')
})

test('safeJoin accepts descendants and rejects absolute/traversal segments', async (t) => {
  const dir = await tempDir('olea-storage-')
  t.after(() => cleanup(dir))

  assert.equal(safeJoin(dir, 'a', 'b.txt'), path.join(dir, 'a', 'b.txt'))
  assert.throws(() => safeJoin(dir, '../escape'), /traversal/i)
  assert.throws(() => safeJoin(dir, 'a', '..', 'b'), /traversal/i)
  assert.throws(() => safeJoin(dir, 'a/../../b'), /traversal/i)
  assert.throws(() => safeJoin(dir, '/etc/passwd'), /absolute/i)
  assert.throws(() => safeJoin(dir, 'nul\0byte'), /NUL/i)
})

test('hash validation and audio path builders are strict', () => {
  const hash = 'a'.repeat(64)
  assert.equal(HASH_RE.test(hash), true)
  assert.equal(isValidHash(hash), true)
  assert.equal(isValidHash(hash.toUpperCase()), false)
  assert.equal(isValidHash('a'.repeat(63)), false)
  assert.equal(isValidHash(`${'a'.repeat(63)}z`), false)
  assert.equal(isValidHash(null), false)

  assert.equal(contentAddressedRelPath(hash, '.OGG'), `aa/${hash}.ogg`)
  assert.equal(soundPath('/sounds', hash, '.MP3'), path.join('/sounds', 'aa', `${hash}.mp3`))
  assert.throws(() => soundPath('/sounds', hash.toUpperCase(), 'ogg'), /hash/i)
  assert.throws(() => soundPath('/sounds', hash, 'flac'), /extension/i)
  assert.throws(() => contentAddressedRelPath(hash, 'flac'), /extension/i)

  assert.throws(() => scenePath('/data', '../escape'), /scene id/i)
  assert.equal(scenePath('/data', 'scene-1'), path.join('/data', 'scenes', 'scene-1.json'))
})

test('extensionOf accepts only lowercased ogg/mp3/wav', () => {
  assert.equal(extensionOf('Loop.OGG'), 'ogg')
  assert.equal(extensionOf('rain.Mp3'), 'mp3')
  assert.equal(extensionOf('hit.wav'), 'wav')
  assert.equal(extensionOf('voice.flac'), null)
  assert.equal(extensionOf('no-extension'), null)
  assert.equal(extensionOf('.ogg'), 'ogg')
  assert.equal(extensionOf(42), null)
})

test('hashFile streams SHA-256 and fileInfo reports size', async (t) => {
  const dir = await tempDir('olea-storage-')
  t.after(() => cleanup(dir))

  const file = path.join(dir, 'fixture.bin')
  const bytes = Buffer.from('the quick brown fox jumps over the lazy dog')
  await fs.writeFile(file, bytes)

  assert.equal(await hashFile(file), sha256(bytes))
  const info = await fileInfo(file)
  assert.equal(info.exists, true)
  assert.equal(info.size, bytes.length)
  assert.equal((await fileInfo(path.join(dir, 'missing'))).exists, false)
})

test('ensureDirs creates every supplied directory', async (t) => {
  const dir = await tempDir('olea-storage-')
  t.after(() => cleanup(dir))

  const a = path.join(dir, 'a')
  const b = path.join(dir, 'b', 'c')
  await ensureDirs(a, b)
  assert.equal((await fs.stat(a)).isDirectory(), true)
  assert.equal((await fs.stat(b)).isDirectory(), true)
})
