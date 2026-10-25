<script setup>
import { reactive, computed, watch, onUnmounted } from 'vue'
import {
  store,
  resolvedSceneElements,
  sceneWarnings,
  reclassifyElements,
  mergeSceneElements,
  promoteToLibrary,
  markReviewed,
  toggleReviewPreview,
  isReviewPreviewPlaying,
  stopReviewPreviews,
} from '../store'
import { REVERB_PRESETS } from '../../lib/schema.js'

const selected = reactive(new Set())
const messages = reactive({})
const bulkState = reactive({})

function defaultBulk() {
  return {
    kind: 'loop',
    min: 10,
    max: 30,
    startMin: 2,
    startMax: 10,
    reverb: '',
    category: '',
  }
}

const allScenes = computed(() =>
  store.soundsets.map((ss) => {
    const elements = resolvedSceneElements(ss)
    const counts = { loops: 0, randoms: 0, effects: 0 }
    for (const el of elements) {
      if (el.kind === 'loop') counts.loops++
      else if (el.kind === 'random') counts.randoms++
      else counts.effects++
    }
    return { ss, elements, counts, warnings: sceneWarnings(ss) }
  })
)

const reviewScenes = computed(() =>
  allScenes.value.filter(
    (entry) =>
      entry.ss.reviewed === false || (!entry.counts.loops && !entry.counts.randoms)
  )
)

watch(
  () => reviewScenes.value.map((entry) => entry.ss.id).join('|'),
  () => {
    for (const entry of reviewScenes.value) {
      if (!bulkState[entry.ss.id]) bulkState[entry.ss.id] = defaultBulk()
    }
  },
  { immediate: true }
)

onUnmounted(stopReviewPreviews)

const sizeIndex = computed(() => {
  const byPath = new Map()
  const byName = new Map()
  for (const folder of store.files || []) {
    for (const file of folder.files || []) {
      const rel = String(file.file || '')
      if (!rel) continue
      const size = Number(file.size) || 0
      byPath.set(`${folder.dir}/${rel}`.replace(/\/+/g, '/'), size)
      const base = rel.split('/').pop()
      if (base && !byName.has(base)) byName.set(base, size)
    }
  }
  return { byPath, byName }
})

const selectedCount = computed(() => selected.size)

function keyOf(ssId, elId) {
  return `${ssId}::${elId}`
}

function isSelected(ssId, elId) {
  return selected.has(keyOf(ssId, elId))
}

function toggleSelect(ssId, elId, checked) {
  const key = keyOf(ssId, elId)
  if (checked) selected.add(key)
  else selected.delete(key)
}

function selectedIds(ss) {
  const prefix = `${ss.id}::`
  return [...selected]
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
}

function clearSelected(ss) {
  const prefix = `${ss.id}::`
  for (const key of [...selected]) {
    if (key.startsWith(prefix)) selected.delete(key)
  }
}

function selectAllLocal(entry) {
  for (const el of entry.elements) {
    if (el.source === 'scene') selected.add(keyOf(entry.ss.id, el.id))
  }
}

function selectedLocalElements(entry) {
  const ids = new Set(selectedIds(entry.ss))
  return entry.elements.filter((el) => el.source === 'scene' && ids.has(el.id))
}

function setMessage(ssId, text) {
  messages[ssId] = text
}

function kindLabel(kind) {
  if (kind === 'loop') return 'Loop'
  if (kind === 'random') return 'Random'
  return 'Effect'
}

function formatSize(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function elementSize(el) {
  let total = 0
  let known = 0
  for (const file of el.files || []) {
    const rel = String(file).replace(/^\.\//, '')
    const pathKey = `${el.baseDir || ''}/${rel}`.replace(/\/+/g, '/')
    const base = rel.split('/').pop()
    const size = sizeIndex.value.byPath.get(pathKey) ?? sizeIndex.value.byName.get(base)
    if (size != null) {
      total += size
      known++
    }
  }
  return known ? total : null
}

function triggerText(el) {
  if (el.kind !== 'random') return '—'
  const t = el.trigger || {}
  const empty =
    !t.min && !t.max && !t.startMin && !t.startMax
  if (empty) return '—'
  return `${t.min ?? 0}–${t.max ?? 0}s · start ${t.startMin ?? 0}–${t.startMax ?? 0}s`
}

function applyKind(entry) {
  const local = selectedLocalElements(entry)
  const ids = local.map((el) => el.id)
  if (!ids.length) return setMessage(entry.ss.id, 'Select at least one scene-local element first.')
  const state = bulkState[entry.ss.id]
  const label = kindLabel(state.kind)
  const ok = window.confirm(
    `Set ${ids.length} selected element${ids.length === 1 ? '' : 's'} to ${label}?`
  )
  if (!ok) return
  stopReviewPreviews()
  reclassifyElements(entry.ss.id, ids, { kind: state.kind })
  setMessage(entry.ss.id, `Set ${ids.length} element${ids.length === 1 ? '' : 's'} to ${label}.`)
}

function applyInterval(entry) {
  const state = bulkState[entry.ss.id]
  const randoms = selectedLocalElements(entry).filter((el) => el.kind === 'random')
  if (!randoms.length) {
    return setMessage(entry.ss.id, 'Select at least one scene-local random element first.')
  }
  const ok = window.confirm(
    `Set the random interval for ${randoms.length} selected random` +
      `${randoms.length === 1 ? '' : 's'}?\n\n` +
      `Wait ${state.min}–${state.max}s, start ${state.startMin}–${state.startMax}s.`
  )
  if (!ok) return
  reclassifyElements(
    entry.ss.id,
    randoms.map((el) => el.id),
    {
      trigger: {
        min: Number(state.min) || 0,
        max: Number(state.max) || 0,
        startMin: Number(state.startMin) || 0,
        startMax: Number(state.startMax) || 0,
      },
    }
  )
  setMessage(
    entry.ss.id,
    `Updated the interval for ${randoms.length} random${randoms.length === 1 ? '' : 's'}.`
  )
}

function applyReverb(entry) {
  const local = selectedLocalElements(entry)
  const ids = local.map((el) => el.id)
  if (!ids.length) return setMessage(entry.ss.id, 'Select at least one scene-local element first.')
  const state = bulkState[entry.ss.id]
  const label = state.reverb || 'no reverb'
  const ok = window.confirm(
    `Set reverb to ${label} for ${ids.length} selected element${ids.length === 1 ? '' : 's'}?`
  )
  if (!ok) return
  stopReviewPreviews()
  reclassifyElements(entry.ss.id, ids, { reverb: state.reverb || null })
  setMessage(entry.ss.id, `Updated reverb for ${ids.length} element${ids.length === 1 ? '' : 's'}.`)
}

function mergeSelected(entry) {
  const local = selectedLocalElements(entry)
  if (!local.length) return setMessage(entry.ss.id, 'Select at least one scene-local element first.')
  const ok = window.confirm(
    `Merge ${local.length} selected element${local.length === 1 ? '' : 's'} into one loop playlist?\n\n` +
      'The original elements are removed and their files are combined in order. ' +
      'Library includes are never merged.'
  )
  if (!ok) return
  stopReviewPreviews()
  const result = mergeSceneElements(
    entry.ss.id,
    local.map((el) => el.id),
    'loop'
  )
  let text = result.element
    ? `Merged ${local.length} element${local.length === 1 ? '' : 's'} into “${result.element.name}”.`
    : 'Merge finished.'
  if (result.warnings?.length) text += ` ${result.warnings.join(' ')}`
  setMessage(entry.ss.id, text)
  clearSelected(entry.ss)
}

async function promoteSelected(entry) {
  const local = selectedLocalElements(entry)
  if (!local.length) return setMessage(entry.ss.id, 'Select at least one scene-local element first.')

  const state = bulkState[entry.ss.id]
  const input = window.prompt(
    `Promote ${local.length} selected element${local.length === 1 ? '' : 's'} to the library.\n` +
      'Category (e.g. Monsters/Carrion Crawler):',
    state.category || ''
  )
  if (input == null) return
  const category = input.trim()
  if (!category) return setMessage(entry.ss.id, 'A library category is required.')

  const ok = window.confirm(
    `Promote ${local.length} element${local.length === 1 ? '' : 's'} to the library?\n\n` +
      `Category: ${category}\n\n` +
      'Audio files will be moved into the shared library. The scene keeps working via includes.'
  )
  if (!ok) return

  state.category = category
  stopReviewPreviews()
  let promoted = 0
  const failures = []

  for (const el of local) {
    const result = await promoteToLibrary(entry.ss.id, el.id, category)
    if (result && result.ok) {
      promoted++
      selected.delete(keyOf(entry.ss.id, el.id))
    } else {
      failures.push(`${el.name || el.id}: ${result?.error || 'failed'}`)
    }
  }

  let text = `Promoted ${promoted} of ${local.length} element${local.length === 1 ? '' : 's'}.`
  if (failures.length) text += ` Failed: ${failures.join('; ')}`
  setMessage(entry.ss.id, text)
}

function markSceneReviewed(entry) {
  const ok = window.confirm(`Mark “${entry.ss.name}” as reviewed?\n\nIt will leave the review list.`)
  if (!ok) return
  clearSelected(entry.ss)
  stopReviewPreviews()
  markReviewed(entry.ss.id)
}
</script>

<template>
  <section class="review-panel">
    <div class="row panel-head">
      <h2>Review</h2>
      <span class="small muted">{{ reviewScenes.length }} scene{{ reviewScenes.length === 1 ? '' : 's' }} need attention</span>
      <div class="grow"></div>
      <span v-if="selectedCount" class="badge selected-badge">{{ selectedCount }} selected</span>
    </div>

    <div v-if="!reviewScenes.length" class="empty-state">
      <h3>Nothing to review</h3>
      <p class="muted">Every scene is marked reviewed and has loops or randoms.</p>
    </div>

    <article v-for="entry in reviewScenes" :key="entry.ss.id" class="card review-scene">
      <div class="row review-head">
        <h3 class="grow">{{ entry.ss.name }}</h3>
        <span v-if="entry.ss.reviewed === false" class="badge needs-review">
          needs review
        </span>
        <span class="small muted counts">
          {{ entry.counts.loops }} loops · {{ entry.counts.randoms }} randoms ·
          {{ entry.counts.effects }} effects
        </span>
        <button class="btn-sm" @click="markSceneReviewed(entry)">Mark reviewed</button>
      </div>

      <p v-if="entry.ss.reviewed === false" class="review-warning">
        heuristic import — no authoritative XML
      </p>
      <p v-else-if="!entry.counts.loops && !entry.counts.randoms" class="review-warning">
        This scene has no resolved loops or randoms. Reclassify some effects or merge tracks.
      </p>

      <p v-for="warning in entry.warnings" :key="warning.includeId || warning.libraryId" class="review-warning">
        Missing library group{{ warning.name ? ` “${warning.name}”` : '' }} — it was skipped.
      </p>

      <div class="bulk-bar">
        <div class="row bulk-row">
          <span class="small muted">{{ selectedIds(entry.ss).length }} selected</span>
          <button class="btn-sm" @click="selectAllLocal(entry)">select all local</button>
          <button class="btn-sm" @click="clearSelected(entry.ss)">clear</button>
          <div class="grow"></div>
          <span class="small muted">Library includes are edited in the Library tab.</span>
        </div>

        <template v-if="bulkState[entry.ss.id]">
          <div class="row bulk-row">
            <label class="small muted">Set kind</label>
            <select v-model="bulkState[entry.ss.id].kind" class="text-input compact">
              <option value="loop">Loop</option>
              <option value="random">Random</option>
              <option value="oneshot">Effect</option>
            </select>
            <button class="btn-sm" @click="applyKind(entry)">Apply kind</button>
          </div>

          <div class="row bulk-row">
            <label class="small muted">Random interval</label>
            <input v-model.number="bulkState[entry.ss.id].min" class="text-input num" type="number" min="0" step="1" title="Min wait (s)" />
            <span class="muted">–</span>
            <input v-model.number="bulkState[entry.ss.id].max" class="text-input num" type="number" min="0" step="1" title="Max wait (s)" />
            <label class="small muted">start</label>
            <input v-model.number="bulkState[entry.ss.id].startMin" class="text-input num" type="number" min="0" step="1" title="Start min (s)" />
            <span class="muted">–</span>
            <input v-model.number="bulkState[entry.ss.id].startMax" class="text-input num" type="number" min="0" step="1" title="Start max (s)" />
            <button class="btn-sm" @click="applyInterval(entry)">Apply interval</button>
          </div>

          <div class="row bulk-row">
            <label class="small muted">Set reverb</label>
            <select v-model="bulkState[entry.ss.id].reverb" class="text-input compact">
              <option value="">Off</option>
              <option v-for="preset in REVERB_PRESETS" :key="preset" :value="preset">
                {{ preset }}
              </option>
            </select>
            <button class="btn-sm" @click="applyReverb(entry)">Apply reverb</button>
          </div>

          <div class="row bulk-row bulk-destructive">
            <button class="btn-sm" @click="mergeSelected(entry)">Merge selected into loop playlist</button>
            <button class="btn-sm primary" @click="promoteSelected(entry)">Promote selected to library</button>
          </div>
        </template>
      </div>

      <p v-if="messages[entry.ss.id]" class="review-feedback">{{ messages[entry.ss.id] }}</p>

      <div class="review-table-wrap">
        <table class="review-table">
          <thead>
            <tr>
              <th class="check-col"><span class="sr-only">Select</span></th>
              <th class="preview-col"><span class="sr-only">Preview</span></th>
              <th>Name</th>
              <th>Kind</th>
              <th>Files</th>
              <th>Size</th>
              <th>Interval</th>
              <th>Reverb</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="el in entry.elements" :key="el.id" :class="{ 'is-selected': isSelected(entry.ss.id, el.id) }">
              <td class="check-col">
                <input
                  type="checkbox"
                  :checked="isSelected(entry.ss.id, el.id)"
                  :disabled="el.source !== 'scene'"
                  :title="el.source !== 'scene' ? 'Library includes are edited in the Library tab' : 'Select this element'"
                  :aria-label="`Select ${el.name}`"
                  @change="toggleSelect(entry.ss.id, el.id, $event.target.checked)"
                />
              </td>
              <td class="preview-col">
                <button
                  class="btn-sm preview-btn"
                  :class="{ active: isReviewPreviewPlaying(entry.ss.id, el.id) }"
                  :disabled="!(el.files || []).length"
                  :title="
                    !(el.files || []).length
                      ? 'No audio files'
                      : isReviewPreviewPlaying(entry.ss.id, el.id)
                        ? 'Stop preview'
                        : 'Preview this sound'
                  "
                  :aria-label="`${isReviewPreviewPlaying(entry.ss.id, el.id) ? 'Stop' : 'Play'} preview of ${el.name}`"
                  @click="toggleReviewPreview(entry.ss.id, el.id)"
                >
                  {{ isReviewPreviewPlaying(entry.ss.id, el.id) ? 'Stop' : 'Play' }}
                </button>
              </td>
              <td>
                <div class="element-name">
                  <span class="name">{{ el.name || '(unnamed)' }}</span>
                  <span class="badge origin-badge" :class="`origin-${el.source}`">
                    {{ el.source === 'library' ? 'Library' : 'Scene' }}
                  </span>
                </div>
              </td>
              <td>
                <span class="badge kind-badge" :class="`kind-${el.kind}`">{{ kindLabel(el.kind) }}</span>
              </td>
              <td>{{ (el.files || []).length }}</td>
              <td>{{ formatSize(elementSize(el)) }}</td>
              <td class="small">{{ triggerText(el) }}</td>
              <td class="small">{{ el.reverb || '—' }}</td>
            </tr>
            <tr v-if="!entry.elements.length">
              <td colspan="8" class="muted empty-row">No resolved elements in this scene.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>

<style scoped>
.panel-head {
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.panel-head h2 {
  margin: 0;
}

.review-scene {
  margin-bottom: 1rem;
}

.review-head {
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.review-head h3 {
  margin: 0;
  overflow-wrap: anywhere;
}

.counts {
  white-space: nowrap;
}

.review-warning {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.35);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.55rem;
  margin: 0.4rem 0;
  font-size: 0.82rem;
}

.bulk-bar {
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 0.55rem 0.65rem;
  margin: 0.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.bulk-row {
  flex-wrap: wrap;
  gap: 0.4rem;
}

.bulk-destructive {
  border-top: 1px solid var(--border);
  padding-top: 0.45rem;
}

.compact {
  width: auto;
  min-width: 6.5rem;
}

.num {
  width: 4.2rem;
}

.review-feedback {
  margin: 0.4rem 0;
  padding: 0.4rem 0.55rem;
  border-left: 3px solid var(--accent);
  background: rgba(56, 189, 248, 0.08);
  font-size: 0.84rem;
}

.review-table-wrap {
  overflow-x: auto;
  margin-top: 0.4rem;
}

.review-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}

.review-table th,
.review-table td {
  text-align: left;
  padding: 0.35rem 0.45rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.review-table th {
  color: var(--text-dim);
  font-weight: 600;
  font-size: 0.78rem;
  white-space: nowrap;
}

.review-table tbody tr:hover {
  background: rgba(148, 163, 184, 0.06);
}

.review-table tbody tr.is-selected {
  background: rgba(56, 189, 248, 0.1);
}

.check-col {
  width: 2rem;
  text-align: center;
}

.preview-col {
  width: 3.8rem;
  text-align: center;
}

.preview-btn {
  min-width: 3.2rem;
}

.preview-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}

.element-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.name {
  overflow-wrap: anywhere;
}

.empty-row {
  text-align: center;
  padding: 0.7rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
