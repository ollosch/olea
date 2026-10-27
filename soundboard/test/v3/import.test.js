import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  SUPPORTED_EXTS,
  familyKey,
  ffprobeAvailable,
  importAudio,
  probeDuration,
  proposeGroups,
  scanSource,
} from '../../lib/v3/import.js'
import { soundPath } from '../../lib/v3/storage.js'
import { cleanup, makeStoreDirs, sha256, tempDir } from './helpers.js'

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function listTree(root) {
  const out = []
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (entry.isDirectory()) await walk(abs)
      else out.push(rel)
    }
  }
  await walk(root)
  return out.sort()
}

function proposalEntry(dirRel, name, soundId) {
  const rel = dirRel ? `${dirRel}/${name}` : name
  return {
    abs: path.join('/tmp/olea-proposal', rel),
    rel,
    dirRel,
    name,
    ext: name.split('.').pop().toLowerCase(),
    size: 1,
    soundId,
    hash: sha256(soundId),
    duration: null,
  }
}

test('scanSource finds supported audio, skips symlinks/hidden/default dirs, and sorts', async (t) => {
  const root = await tempDir('olea-scan-')
  t.after(() => cleanup(root))

  await writeFile(path.join(root, 'b.OGG'), 'b')
  await writeFile(path.join(root, 'a.ogg'), 'a')
  await writeFile(path.join(root, 'notes.txt'), 'n')
  await writeFile(path.join(root, 'nested', 'c.Mp3'), 'c')
  await writeFile(path.join(root, 'nested', 'deep', 'd.WAV'), 'd')
  await writeFile(path.join(root, '.hidden', 'hidden.ogg'), 'hidden')

  for (const dir of ['node_modules', '.git', 'dist', 'data', 'sounds', '.migration-backup']) {
    await writeFile(path.join(root, dir, 'skip.ogg'), 'skip')
  }

  await fs.symlink(path.join(root, 'a.ogg'), path.join(root, 'link.ogg'))
  await fs.symlink(path.join(root, 'nested'), path.join(root, 'linkdir'))

  const entries = await scanSource(root)
  assert.deepEqual(
    entries.map((entry) => entry.rel),
    ['a.ogg', 'b.OGG', 'nested/c.Mp3', 'nested/deep/d.WAV']
  )
  assert.deepEqual(SUPPORTED_EXTS, ['ogg', 'mp3', 'wav'])

  const byRel = new Map(entries.map((entry) => [entry.rel, entry]))
  assert.equal(byRel.get('b.OGG').ext, 'ogg')
  assert.equal(byRel.get('b.OGG').name, 'b.OGG')
  assert.equal(byRel.get('a.ogg').dirRel, '')
  assert.equal(byRel.get('nested/c.Mp3').dirRel, 'nested')
  assert.equal(byRel.get('nested/deep/d.WAV').dirRel, 'nested/deep')
  assert.equal(byRel.get('a.ogg').size, 1)

  const withoutNested = await scanSource(root, { skipDirs: ['nested'] })
  assert.deepEqual(withoutNested.map((entry) => entry.rel), ['a.ogg', 'b.OGG'])
})

test('importAudio dedupes content, writes CAS blobs, preserves sources, and is idempotent', async (t) => {
  const dirs = await makeStoreDirs(t)
  const source = path.join(dirs.dir, 'source')
  const alpha = 'identical alpha bytes'
  const beta = 'beta bytes'
  const gamma = 'gamma bytes'

  await writeFile(path.join(source, 'alpha.ogg'), alpha)
  await writeFile(path.join(source, 'copy-of-alpha.mp3'), alpha)
  await writeFile(path.join(source, 'beta.wav'), beta)
  await writeFile(path.join(source, 'sub', 'gamma.ogg'), gamma)

  const first = await importAudio({
    sourceDir: source,
    soundsDir: dirs.soundsDir,
    catalog: { version: 3, sounds: [] },
  })

  assert.equal(first.added, 3)
  assert.equal(first.duplicates, 1)
  assert.equal(first.skipped, 0)
  assert.equal(first.errors.length, 0)
  assert.equal(first.files.length, 4)
  assert.equal(first.catalog.version, 3)
  assert.equal(first.catalog.sounds.length, 3)

  const alphaHash = sha256(alpha)
  const alphaSound = first.catalog.sounds.find((sound) => sound.hash === alphaHash)
  assert.ok(alphaSound)
  assert.equal(alphaSound.ext, 'ogg')
  assert.equal(alphaSound.size, Buffer.byteLength(alpha))
  assert.equal(alphaSound.duration, null)
  assert.equal(alphaSound.originalName, 'alpha.ogg')
  assert.match(alphaSound.addedAt, /^\d{4}-\d{2}-\d{2}T/)

  const alphaBlob = soundPath(dirs.soundsDir, alphaHash, 'ogg')
  assert.equal(await fs.readFile(alphaBlob, 'utf8'), alpha)
  await assert.rejects(() => fs.access(soundPath(dirs.soundsDir, alphaHash, 'mp3')))

  const byRel = new Map(first.files.map((file) => [file.rel, file]))
  assert.equal(byRel.get('copy-of-alpha.mp3').soundId, alphaSound.id)
  assert.equal(byRel.get('copy-of-alpha.mp3').hash, alphaHash)

  for (const file of first.files) {
    const sound = first.catalog.sounds.find((candidate) => candidate.id === file.soundId)
    assert.ok(sound)
    assert.equal(await fs.readFile(soundPath(dirs.soundsDir, sound.hash, sound.ext), 'utf8'), await fs.readFile(file.abs, 'utf8'))
  }

  assert.equal(await fs.readFile(path.join(source, 'alpha.ogg'), 'utf8'), alpha)
  assert.deepEqual(await listTree(source), [
    'alpha.ogg',
    'beta.wav',
    'copy-of-alpha.mp3',
    'sub/gamma.ogg',
  ])

  const second = await importAudio({
    sourceDir: source,
    soundsDir: dirs.soundsDir,
    catalog: first.catalog,
  })
  assert.equal(second.added, 0)
  assert.equal(second.duplicates, 4)
  assert.equal(second.catalog.sounds.length, 3)
  assert.equal(second.files.length, 4)

  const third = await importAudio({
    sourceDir: source,
    soundsDir: dirs.soundsDir,
    catalog: second.catalog,
  })
  assert.equal(third.added, 0)
  assert.equal(third.catalog.sounds.length, 3)
})

test('importAudio ignores files inside target sounds/data directories', async (t) => {
  const root = await tempDir('olea-targets-')
  t.after(() => cleanup(root))

  const soundsDir = path.join(root, 'cas')
  const dataDir = path.join(root, 'meta')
  await writeFile(path.join(root, 'source.ogg'), 'source')
  await writeFile(path.join(soundsDir, 'already.ogg'), 'blob')
  await writeFile(path.join(dataDir, 'also.ogg'), 'data')

  const result = await importAudio({
    sourceDir: root,
    soundsDir,
    dataDir,
    catalog: { version: 3, sounds: [] },
  })

  assert.equal(result.added, 1)
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].rel, 'source.ogg')
  assert.ok(result.files.every((file) => !file.rel.startsWith('cas/')))
  assert.ok(result.files.every((file) => !file.rel.startsWith('meta/')))
})

test('importAudio reports copy/target mismatches without overwriting blobs', async (t) => {
  const dirs = await makeStoreDirs(t)
  const source = path.join(dirs.dir, 'source')
  const content = 'content that will already have a blob'
  await writeFile(path.join(source, 'track.ogg'), content)

  const hash = sha256(content)
  const target = soundPath(dirs.soundsDir, hash, 'ogg')
  await writeFile(target, 'wrong-size')

  const result = await importAudio({
    sourceDir: source,
    soundsDir: dirs.soundsDir,
    catalog: { version: 3, sounds: [] },
  })

  assert.equal(result.added, 0)
  assert.equal(result.skipped, 1)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].reason, 'target-size-mismatch')
  assert.equal(await fs.readFile(target, 'utf8'), 'wrong-size')
  assert.equal(result.catalog.sounds.length, 0)
})

test('proposeGroups uses directory names, family splitting, selection, and kind hints', () => {
  const spells = proposeGroups([
    proposalEntry('Syrinscape - D&D - Bard Spells', 'Cure Light Wounds 1.ogg', 's1'),
    proposalEntry('Syrinscape - D&D - Bard Spells', 'Cure Light Wounds 2.ogg', 's2'),
    proposalEntry('Syrinscape - D&D - Bard Spells', 'Cure Serious Wounds.ogg', 's3'),
  ])
  assert.equal(spells.length, 1)
  assert.equal(spells[0].name, 'Bard Spells')
  assert.equal(spells[0].category, '')
  assert.deepEqual(spells[0].tags, [])
  assert.deepEqual(spells[0].sounds, ['s1', 's2', 's3'])
  assert.equal(spells[0].selection, 'random')
  assert.equal(spells[0].defaultKind, 'oneshot')
  assert.ok(spells[0].id)
  assert.equal(spells[0].defaults.gain, 0.8)

  const single = proposeGroups([
    proposalEntry('Syrinscape - D&D - Soundtrack', 'Opening Theme.ogg', 'm1'),
  ])
  assert.equal(single[0].name, 'Soundtrack')
  assert.equal(single[0].selection, 'ordered')
  assert.equal(single[0].defaultKind, 'loop')

  const weatherDir = 'Syrinscape - D&D - Weather'
  const large = proposeGroups(
    [
      proposalEntry(weatherDir, 'Wind Loop 1.ogg', 'w1'),
      proposalEntry(weatherDir, 'Wind Loop 2.ogg', 'w2'),
      proposalEntry(weatherDir, 'Rain 1.ogg', 'r1'),
      proposalEntry(weatherDir, 'Rain 2.ogg', 'r2'),
      proposalEntry(weatherDir, 'Thunder 1.ogg', 't1'),
    ],
    { splitThreshold: 2 }
  )

  assert.deepEqual(large.map((group) => group.name), ['Rain #', 'Thunder #', 'Wind Loop #'])
  const byName = new Map(large.map((group) => [group.name, group]))
  assert.deepEqual(byName.get('Wind Loop #').sounds, ['w1', 'w2'])
  assert.equal(byName.get('Wind Loop #').defaultKind, 'loop')
  assert.equal(byName.get('Rain #').defaultKind, 'random')
  assert.equal(byName.get('Thunder #').defaultKind, 'oneshot')
  assert.equal(byName.get('Rain #').selection, 'random')
  assert.equal(byName.get('Thunder #').selection, 'ordered')

  assert.equal(proposeGroups([proposalEntry('', 'Bare 1.ogg', 'b1')])[0].name, 'Imported')
  assert.equal(proposeGroups([proposalEntry('', 'Bare 1.ogg', 'b1')])[0].selection, 'ordered')
})

test('familyKey is stable and cleans extensions, digits, brackets, and whitespace', () => {
  assert.equal(familyKey('Wind_Loop_01.ogg'), 'wind_loop_#')
  assert.equal(familyKey('Wind Loop [ogg] 2.mp3'), 'wind loop #')
  assert.equal(familyKey('Cure Light Wounds (1).WAV'), 'cure light wounds')
  assert.equal(familyKey('Ambience 123 456.ogg'), 'ambience # #')
  assert.equal(familyKey('plain.ogg'), 'plain')
})

test('probeDuration returns null for missing or invalid files instead of throwing', async (t) => {
  const dir = await tempDir('olea-probe-')
  t.after(() => cleanup(dir))

  assert.equal(typeof ffprobeAvailable(), 'boolean')
  assert.equal(await probeDuration(path.join(dir, 'missing.ogg')), null)

  const invalid = path.join(dir, 'invalid.ogg')
  await fs.writeFile(invalid, 'definitely not audio')
  assert.equal(await probeDuration(invalid), null)
  assert.equal(await probeDuration(''), null)
})
