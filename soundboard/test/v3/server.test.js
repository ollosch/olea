import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { createApp } from '../../server.js'
import { createStore } from '../../lib/v3/store.js'
import { soundPath, writeJsonAtomic } from '../../lib/v3/storage.js'
import { cleanup, tempDir } from './helpers.js'

async function setup(t, fixtures) {
  const dir = await tempDir('olea-server-')
  const dataDir = path.join(dir, 'data')
  const soundsDir = path.join(dir, 'sounds')
  await fs.mkdir(dataDir, { recursive: true })
  await fs.mkdir(soundsDir, { recursive: true })

  const sounds = []
  const audio = new Map()
  for (const fixture of fixtures) {
    const bytes = Buffer.from(fixture.data ?? `audio-${fixture.id}`)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const ext = fixture.ext ?? 'ogg'
    const file = soundPath(soundsDir, hash, ext)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, bytes)
    sounds.push({
      id: fixture.id,
      hash,
      ext,
      size: bytes.length,
      duration: null,
      originalName: fixture.name ?? `${fixture.id}.${ext}`,
      addedAt: '2026-01-01T00:00:00.000Z',
    })
    audio.set(fixture.id, { file, bytes, hash })
  }

  await writeJsonAtomic(path.join(dataDir, 'catalog.json'), { version: 3, sounds })
  const store = createStore({ dataDir, soundsDir })
  await store.init()

  const app = createApp(store, { distDir: path.join(dir, 'dist') })
  const server = app.listen(0)
  await once(server, 'listening')
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections?.()
    })
    await cleanup(dir)
  })

  return { base, dir, dataDir, soundsDir, store, sounds, audio }
}

function jsonPost(url, body, method = 'POST') {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('bootstrap and paged catalog search', async (t) => {
  const { base } = await setup(t, [
    { id: 's1', name: 'Barking Dog.ogg' },
    { id: 's2', name: 'City Rain.mp3', ext: 'mp3' },
    { id: 's3', name: 'Thunder.wav', ext: 'wav' },
  ])

  const bootstrapResponse = await fetch(`${base}/api/bootstrap`)
  assert.equal(bootstrapResponse.status, 200)
  const bootstrap = await bootstrapResponse.json()
  assert.deepEqual(bootstrap.catalog, { version: 3, count: 3 })
  assert.deepEqual(bootstrap.scenes, [])
  assert.equal(bootstrap.library.version, 3)
  assert.equal(bootstrap.global.version, 3)
  assert.equal(bootstrap.stats.total, 3)
  assert.equal(bootstrap.stats.importDone, false)

  const page = await fetch(`${base}/api/catalog?limit=1&offset=1`).then((res) => res.json())
  assert.equal(page.total, 3)
  assert.equal(page.offset, 1)
  assert.equal(page.limit, 1)
  assert.equal(page.sounds.length, 1)

  const search = await fetch(`${base}/api/catalog?q=CITY`).then((res) => res.json())
  assert.deepEqual(
    search.sounds.map((sound) => sound.id),
    ['s2']
  )

  const stats = await fetch(`${base}/api/catalog/stats`).then((res) => res.json())
  assert.equal(stats.total, 3)
  assert.equal(stats.unassigned, 3)

  const sound = await fetch(`${base}/api/sounds/s1`).then((res) => res.json())
  assert.equal(sound.id, 's1')
  assert.equal((await fetch(`${base}/api/sounds/missing`)).status, 404)
})

test('library endpoint pages and bulk group lookup', async (t) => {
  const { base } = await setup(t, [{ id: 's1' }, { id: 's2' }])

  for (const [index, name] of ['Dogs', 'Wolves', 'Cats'].entries()) {
    const response = await jsonPost(`${base}/api/groups`, {
      name,
      category: index === 2 ? 'Creatures/Cats' : 'Creatures/Dogs',
      tags: [index === 0 ? 'bark' : 'animal'],
      sounds: [index === 1 ? 's2' : 's1'],
    })
    assert.equal(response.status, 200)
  }

  const bootstrap = await fetch(`${base}/api/bootstrap`).then((res) => res.json())
  assert.deepEqual(bootstrap.library, { version: 3, count: 3 })
  assert.equal(bootstrap.library.groups, undefined)

  const page = await fetch(`${base}/api/library?limit=2&offset=1`).then((res) => res.json())
  assert.equal(page.total, 3)
  assert.equal(page.offset, 1)
  assert.equal(page.limit, 2)
  assert.equal(page.groups.length, 2)
  assert.deepEqual(page.facets.categories, ['Creatures/Cats', 'Creatures/Dogs'])

  const search = await fetch(`${base}/api/library?query=cat&tag=animal`).then((res) =>
    res.json()
  )
  assert.equal(search.total, 1)
  assert.equal(search.groups[0].name, 'Cats')

  const ids = page.groups.map((group) => group.id).join(',')
  const lookup = await fetch(`${base}/api/groups?ids=${ids}`).then((res) => res.json())
  assert.equal(lookup.groups.length, 2)
  assert.deepEqual(
    lookup.groups.map((group) => group.id).sort(),
    page.groups.map((group) => group.id).sort()
  )
})

test('group creation and scene save/reject through HTTP', async (t) => {
  const { base } = await setup(t, [{ id: 's1' }, { id: 's2' }])

  const createResponse = await jsonPost(`${base}/api/groups`, {
    name: 'Dogs',
    category: 'Creatures/Dogs',
    tags: ['animal'],
    sounds: ['s1'],
  })
  assert.equal(createResponse.status, 200)
  const { group } = await createResponse.json()
  assert.equal(group.name, 'Dogs')

  const library = await fetch(`${base}/api/library`).then((res) => res.json())
  assert.equal(library.groups.length, 1)

  const sceneResponse = await jsonPost(`${base}/api/scenes`, { name: 'Station' })
  assert.equal(sceneResponse.status, 200)
  const { scene } = await sceneResponse.json()
  assert.equal(scene.moods.length, 1)
  assert.equal(scene.defaultMoodId, scene.moods[0].id)

  const valid = await jsonPost(
    `${base}/api/scenes/${scene.id}`,
    { ...scene, tracks: [{ id: 't1', groupId: group.id, kind: 'loop', order: 0 }] },
    'PUT'
  )
  assert.equal(valid.status, 200)
  const saved = (await valid.json()).scene
  assert.equal(saved.tracks.length, 1)
  assert.equal(saved.tracks[0].groupId, group.id)

  const invalid = await jsonPost(
    `${base}/api/scenes/${scene.id}`,
    { ...saved, tracks: [{ id: 't2', groupId: 'missing', kind: 'loop', order: 0 }] },
    'PUT'
  )
  assert.equal(invalid.status, 400)
  const error = await invalid.json()
  assert.ok(error.error)
  assert.ok(error.errors.some((item) => item.type === 'missing-group'))

  const scenes = await fetch(`${base}/api/scenes`).then((res) => res.json())
  assert.equal(scenes.length, 1)
  assert.equal(scenes[0].trackCount, 1)
  assert.equal(scenes[0].moodCount, 1)

  const full = await fetch(`${base}/api/scenes/${scene.id}`).then((res) => res.json())
  assert.equal(full.id, scene.id)
  assert.equal((await fetch(`${base}/api/scenes/missing`)).status, 404)
})

test('GET /api/bindings returns global MIDI, scene MIDI, and conflicts', async (t) => {
  const { base, store } = await setup(t, [{ id: 's1' }])
  const group = await store.createGroup({ name: 'Group', sounds: ['s1'] })
  const scene = await store.createScene({ name: 'Alpha' })

  await store.saveScene(scene.id, {
    ...scene,
    tracks: [{ id: 't1', groupId: group.id, kind: 'loop', order: 0 }],
    midi: { notes: { '0:note:60': { type: 'trackTrigger', trackId: 't1' } }, ccs: {} },
  })
  await store.saveGlobal({
    palette: [{ id: 'p1', groupId: group.id }],
    midi: { notes: { '0:note:60': { type: 'paletteTrigger', paletteId: 'p1' } } },
  })

  const response = await fetch(`${base}/api/bindings`)
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.deepEqual(body.global, store.global().midi)
  assert.equal(body.scenes.length, 1)
  assert.equal(body.scenes[0].sceneId, scene.id)
  assert.equal(body.scenes[0].name, 'Alpha')
  assert.deepEqual(body.scenes[0].midi, store.scene(scene.id).midi)
  assert.equal(body.conflicts.length, 1)
  assert.equal(body.conflicts[0].sceneId, scene.id)
  assert.equal(body.conflicts[0].key, '0:note:60')
  assert.deepEqual(body.conflicts[0].globalAction, {
    type: 'paletteTrigger',
    paletteId: 'p1',
  })
  assert.deepEqual(body.conflicts[0].localAction, { type: 'trackTrigger', trackId: 't1' })
})

test('audio is served by hash with immutable caching and Range support', async (t) => {
  const { base, audio } = await setup(t, [{ id: 'a1', data: 'abcdefghij' }])
  const fixture = audio.get('a1')

  const response = await fetch(`${base}/audio/${fixture.hash}`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'abcdefghij')
  assert.match(response.headers.get('cache-control'), /max-age=31536000/)
  assert.match(response.headers.get('cache-control'), /immutable/)

  const ranged = await fetch(`${base}/audio/${fixture.hash}`, { headers: { Range: 'bytes=0-3' } })
  assert.equal(ranged.status, 206)
  assert.equal(await ranged.text(), 'abcd')
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-3/10')

  assert.equal((await fetch(`${base}/audio/${fixture.hash.toUpperCase()}`)).status, 400)
  assert.equal((await fetch(`${base}/audio/not-a-hash`)).status, 400)
  assert.equal((await fetch(`${base}/audio/..%2F..%2Fetc%2Fpasswd`)).status, 400)
  assert.equal((await fetch(`${base}/audio/${'a'.repeat(64)}`)).status, 404)

  await fs.unlink(fixture.file)
  assert.equal((await fetch(`${base}/audio/${fixture.hash}`)).status, 404)
})

test('duration updates and the import marker', async (t) => {
  const { base } = await setup(t, [{ id: 's1', data: 'x' }])

  const ok = await jsonPost(`${base}/api/sounds/s1/duration`, { duration: 12.5 })
  assert.equal(ok.status, 200)
  const { sound } = await ok.json()
  assert.equal(sound.duration, 12.5)

  assert.equal((await jsonPost(`${base}/api/sounds/s1/duration`, { duration: 0 })).status, 400)
  assert.equal((await jsonPost(`${base}/api/sounds/s1/duration`, { duration: -1 })).status, 400)
  assert.equal(
    (await jsonPost(`${base}/api/sounds/s1/duration`, { duration: 'nope' })).status,
    400
  )
  assert.equal(
    (await jsonPost(`${base}/api/sounds/missing/duration`, { duration: 1 })).status,
    404
  )

  const done = await jsonPost(`${base}/api/import/done`, { done: true })
  assert.deepEqual(await done.json(), { done: true })
  const bootstrap = await fetch(`${base}/api/bootstrap`).then((res) => res.json())
  assert.equal(bootstrap.stats.importDone, true)

  const undone = await jsonPost(`${base}/api/import/done`, { done: false })
  assert.deepEqual(await undone.json(), { done: false })
  assert.equal((await jsonPost(`${base}/api/import/done`, { done: 'yes' })).status, 400)
})
