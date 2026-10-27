// Olea Soundboard v3 HTTP API and audio server.
//
// `createApp(store)` builds the Express app. Running this file directly starts a
// server using OLEA_DATA_DIR / OLEA_SOUNDS_DIR / PORT.

import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findByHash, findSound } from './lib/v3/catalog.js'
import { createStore } from './lib/v3/store.js'
import { isValidHash, soundPath } from './lib/v3/storage.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function stringParam(value) {
  return typeof value === 'string' ? value : ''
}

function parseOffset(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function parseLimit(value, fallback = 50) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(200, Math.max(1, Math.floor(n)))
}

function parseBoolean(value) {
  return value === true || value === '1' || value === 'true' || value === 'yes'
}

function statusForError(err) {
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) return err.status
  if (err?.type === 'entity.parse.failed') return 400
  switch (err?.code) {
    case 'not-found':
      return 404
    case 'conflict':
      return 409
    case 'validation':
    case 'invalid-path':
    case 'invalid-extension':
    case 'bad-request':
      return 400
    default:
      return 500
  }
}

function errorBody(err) {
  const body = { error: err?.message || 'Internal server error' }
  if (Array.isArray(err?.errors)) body.errors = err.errors
  return body
}

export function createApp(store, options = {}) {
  if (!store) throw new Error('createApp requires a store')
  const app = express()
  const distDir = options.distDir || path.join(__dirname, 'dist')
  const soundsDir = options.soundsDir || store.soundsDir

  const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

  app.use(express.json({ limit: '8mb' }))

  app.get(
    '/api/bootstrap',
    handle(async (req, res) => {
      const catalog = store.catalog()
      res.json({
        catalog: { version: catalog.version, count: catalog.sounds.length },
        library: { version: store.library().version, count: store.library().groups.length },
        global: store.global(),
        scenes: store.listScenes(),
        stats: store.stats(),
      })
    })
  )

  app.get(
    '/api/library',
    handle(async (req, res) => {
      res.json(
        store.searchGroups({
          query: stringParam(req.query.query ?? req.query.q),
          offset: parseOffset(req.query.offset),
          limit: parseLimit(req.query.limit, 200),
          category: stringParam(req.query.category),
          tag: stringParam(req.query.tag),
          kind: stringParam(req.query.kind),
        })
      )
    })
  )

  app.get('/api/groups', (req, res) => {
    const raw = req.query.ids
    const ids = Array.isArray(raw)
      ? raw.flatMap((value) => String(value).split(','))
      : String(raw ?? '').split(',')
    const clean = ids.map((id) => id.trim()).filter(Boolean)
    if (clean.length > 2000) {
      return res.status(400).json({ error: 'At most 2000 group ids per request' })
    }
    res.json({ groups: store.lookupGroups(clean) })
  })

  app.get('/api/global', (req, res) => res.json(store.global()))

  app.get('/api/scenes', (req, res) => res.json(store.listScenes()))
  app.get('/api/bindings', (req, res) => res.json(store.bindingsOverview()))
  app.get('/api/scenes/:id', (req, res) => {
    const scene = store.scene(req.params.id)
    if (!scene) return res.status(404).json({ error: 'Scene not found' })
    res.json(scene)
  })

  app.get(
    '/api/catalog',
    handle(async (req, res) => {
      const result = store.searchSounds({
        query: stringParam(req.query.query ?? req.query.q),
        offset: parseOffset(req.query.offset),
        limit: parseLimit(req.query.limit),
        unassigned: parseBoolean(req.query.unassigned),
        kind: stringParam(req.query.kind),
        category: stringParam(req.query.category),
        tag: stringParam(req.query.tag),
        groupId: stringParam(req.query.groupId),
      })
      res.json(result)
    })
  )

  app.get('/api/catalog/stats', (req, res) => res.json(store.stats()))

  app.get('/api/sounds', (req, res) => {
    const raw = req.query.ids
    const ids = Array.isArray(raw)
      ? raw.flatMap((value) => String(value).split(','))
      : String(raw ?? '').split(',')
    const clean = ids.map((id) => id.trim()).filter(Boolean)
    if (clean.length > 1000) {
      return res.status(400).json({ error: 'At most 1000 sound ids per request' })
    }
    res.json({ sounds: store.lookupSounds(clean) })
  })

  app.get('/api/sounds/:id', (req, res) => {
    const sound = findSound(store.catalog(), req.params.id)
    if (!sound) return res.status(404).json({ error: 'Sound not found' })
    res.json(sound)
  })

  app.put(
    '/api/global',
    handle(async (req, res) => {
      const global = await store.saveGlobal(req.body ?? {})
      res.json({ global })
    })
  )

  app.post(
    '/api/groups',
    handle(async (req, res) => {
      const group = await store.createGroup(req.body ?? {})
      res.json({ group })
    })
  )

  app.patch(
    '/api/groups/:id',
    handle(async (req, res) => {
      const group = await store.updateGroup(req.params.id, req.body ?? {})
      res.json({ group })
    })
  )

  app.delete(
    '/api/groups/:id',
    handle(async (req, res) => {
      const { library, ...result } = await store.deleteGroup(req.params.id)
      res.json(result)
    })
  )

  app.post(
    '/api/groups/:id/sounds',
    handle(async (req, res) => {
      const group = await store.addGroupSounds(req.params.id, req.body?.soundIds)
      res.json({ group })
    })
  )

  app.post(
    '/api/groups/:id/sounds/remove',
    handle(async (req, res) => {
      const group = await store.removeGroupSounds(req.params.id, req.body?.soundIds)
      res.json({ group })
    })
  )

  app.post(
    '/api/groups/merge',
    handle(async (req, res) => {
      const { library, ...result } = await store.mergeGroups(req.body ?? {})
      res.json(result)
    })
  )

  app.post(
    '/api/groups/split',
    handle(async (req, res) => {
      const { library, ...result } = await store.splitGroup(req.body ?? {})
      res.json(result)
    })
  )

  app.post(
    '/api/groups/bulk',
    handle(async (req, res) => {
      const ids = req.body?.ids ?? req.body?.groupIds
      const { library, ...result } = await store.bulkUpdateGroups(ids, req.body?.patch ?? {})
      res.json(result)
    })
  )

  app.post(
    '/api/groups/from-sounds',
    handle(async (req, res) => {
      const group = await store.createGroupsFromSounds(req.body ?? {})
      res.json({ group })
    })
  )

  app.post(
    '/api/scenes',
    handle(async (req, res) => {
      const scene = await store.createScene(req.body ?? {})
      res.json({ scene })
    })
  )

  app.put(
    '/api/scenes/:id',
    handle(async (req, res) => {
      const scene = await store.saveScene(req.params.id, req.body ?? {})
      res.json({ scene })
    })
  )

  app.delete(
    '/api/scenes/:id',
    handle(async (req, res) => {
      const scene = await store.deleteScene(req.params.id)
      res.json({ ok: true, scene })
    })
  )

  app.post(
    '/api/sounds/:id/duration',
    handle(async (req, res) => {
      const raw = req.body?.duration
      const duration = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(duration) || duration <= 0) {
        return res.status(400).json({ error: 'duration must be a finite number greater than 0' })
      }
      const sound = await store.setSoundDuration(req.params.id, duration)
      if (!sound) return res.status(404).json({ error: 'Sound not found' })
      res.json({ sound })
    })
  )

  app.post(
    '/api/import/done',
    handle(async (req, res) => {
      const raw = req.body?.done
      const done = raw === undefined ? true : raw
      if (typeof done !== 'boolean') {
        return res.status(400).json({ error: 'done must be a boolean' })
      }
      res.json({ done: await store.markImportDone(done) })
    })
  )

  app.get(
    '/audio/:hash',
    handle(async (req, res) => {
      const hash = req.params.hash
      if (!isValidHash(hash)) return res.status(400).json({ error: 'Invalid audio hash' })

      const sound = findByHash(store.catalog(), hash)
      if (!sound) return res.status(404).json({ error: 'Sound not found' })

      let file
      try {
        file = soundPath(soundsDir, hash, sound.ext)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }

      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.sendFile(file, (err) => {
        if (!err || res.headersSent) return
        const status =
          err.code === 'ENOENT' || err.statusCode === 404
            ? 404
            : Number.isInteger(err.statusCode) && err.statusCode >= 400
              ? err.statusCode
              : 500
        res
          .status(status)
          .json({ error: status === 404 ? 'Audio file not found' : 'Failed to serve audio' })
      })
    })
  )

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))
  app.use('/audio', (req, res) => res.status(404).json({ error: 'Not found' }))

  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/audio')) {
      return next()
    }
    res.sendFile(path.join(distDir, 'index.html'), (err) => {
      if (err && !res.headersSent) res.status(404).end()
    })
  })

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    res.status(statusForError(err)).json(errorBody(err))
  })

  return app
}

export default createApp

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(__filename)

if (isMain) {
  const dataDir = path.resolve(process.env.OLEA_DATA_DIR || path.join(__dirname, 'data'))
  const soundsDir = path.resolve(process.env.OLEA_SOUNDS_DIR || path.join(__dirname, 'sounds'))
  const port = Number(process.env.PORT) || 8091

  const store = createStore({ dataDir, soundsDir })
  await store.init()
  const app = createApp(store)
  app.listen(port, () => {
    console.log(`Olea soundboard listening on http://localhost:${port}`)
  })
}
