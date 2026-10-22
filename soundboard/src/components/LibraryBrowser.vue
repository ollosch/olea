<script setup>
import { ref, reactive, computed } from 'vue'
import {
  store,
  toggleLibraryPreview,
  isLibraryPreviewPlaying,
  addIncludeToScene,
  pinToPalette,
  updateLibraryGroup,
  deleteLibraryGroup,
} from '../store'
import { REVERB_PRESETS } from '../../lib/schema.js'

const query = ref('')
const kindFilter = ref('all')
const notice = ref('')
const editingId = ref(null)

const form = reactive({
  name: '',
  kind: 'oneshot',
  gain: 1,
  reverb: '',
  randomise: '',
  category: '',
  tags: '',
  min: 10,
  max: 30,
  startMin: 2,
  startMax: 10,
})

const kindOptions = [
  { value: 'all', label: 'All kinds' },
  { value: 'loop', label: 'Loops' },
  { value: 'random', label: 'Randoms' },
  { value: 'oneshot', label: 'Effects' },
]

const q = computed(() => query.value.trim().toLowerCase())
const hasFilters = computed(() => q.value.length > 0 || kindFilter.value !== 'all')

const groups = computed(() => {
  const list = (store.library.groups || []).filter((group) => {
    if (kindFilter.value !== 'all' && group.kind !== kindFilter.value) return false
    if (!q.value) return true
    const haystack = [group.name, group.category, ...(group.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q.value)
  })
  return list.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
})

const pinnedIds = computed(
  () => new Set((store.global.palette || []).map((entry) => entry.libraryId))
)

function kindLabel(kind) {
  if (kind === 'loop') return 'Loop'
  if (kind === 'random') return 'Random'
  return 'Effect'
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`
}

function addToScene(group) {
  if (!store.activeId) return
  addIncludeToScene(store.activeId, group.id)
  notice.value = `Added “${group.name}” to the active scene.`
}

function pin(group) {
  pinToPalette(group.id)
  notice.value = `Pinned “${group.name}” to the palette.`
}

function openEdit(group) {
  editingId.value = group.id
  Object.assign(form, {
    name: group.name || '',
    kind: group.kind || 'oneshot',
    gain: group.gain ?? 1,
    reverb: group.reverb || '',
    randomise: group.randomise || '',
    category: group.category || '',
    tags: (group.tags || []).join(', '),
    min: group.trigger?.min ?? 10,
    max: group.trigger?.max ?? 30,
    startMin: group.trigger?.startMin ?? 2,
    startMax: group.trigger?.startMax ?? 10,
  })
}

function closeEdit() {
  editingId.value = null
}

function saveEdit() {
  if (!editingId.value || !form.name.trim()) return
  updateLibraryGroup(editingId.value, {
    name: form.name.trim(),
    kind: form.kind,
    gain: Number(form.gain),
    reverb: form.reverb || null,
    randomise: form.randomise || null,
    category: form.category.trim(),
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    trigger: {
      min: Number(form.min) || 0,
      max: Number(form.max) || 0,
      startMin: Number(form.startMin) || 0,
      startMax: Number(form.startMax) || 0,
    },
  })
  notice.value = `Saved “${form.name.trim()}”.`
  closeEdit()
}

function confirmDelete(group) {
  const message =
    `Delete “${group.name}” from the library?\n\n` +
    'Scenes that include it will lose the group and its palette pins will be removed. ' +
    'Audio files are not deleted.'
  if (!window.confirm(message)) return
  if (editingId.value === group.id) closeEdit()
  deleteLibraryGroup(group.id)
  notice.value = `Removed “${group.name}” from the library.`
}

function clearFilters() {
  query.value = ''
  kindFilter.value = 'all'
}
</script>

<template>
  <section class="library-browser">
    <div class="row panel-head">
      <h2>Library</h2>
      <span class="small muted">{{ groups.length }} group{{ groups.length === 1 ? '' : 's' }}</span>
      <div class="grow"></div>
      <input
        v-model="query"
        class="search-input"
        type="search"
        placeholder="Search name, category, tags…"
        aria-label="Search library"
      />
      <select v-model="kindFilter" class="text-input kind-filter" aria-label="Filter by kind">
        <option v-for="option in kindOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <p v-if="notice" class="notice">{{ notice }}</p>

    <div v-if="!store.library.groups?.length" class="empty-state">
      <h3>The library is empty</h3>
      <p class="muted">
        Promote reusable sounds from a scene (Scene → Edit → promote, or the Review tab) and
        they will appear here. Pinned groups are always available from the palette.
      </p>
    </div>

    <div v-else-if="!groups.length" class="empty-state">
      <h3>No matching sounds</h3>
      <p class="muted">Try a different search or kind filter.</p>
      <button v-if="hasFilters" @click="clearFilters">Clear filters</button>
    </div>

    <div v-else class="library-grid">
      <article v-for="group in groups" :key="group.id" class="card library-card">
        <div class="row card-title-row">
          <span class="name grow">{{ group.name }}</span>
          <span class="badge kind-badge" :class="`kind-${group.kind}`">{{ kindLabel(group.kind) }}</span>
        </div>

        <p v-if="group.category" class="small muted category">{{ group.category }}</p>

        <div v-if="group.tags?.length" class="tag-row">
          <span v-for="tag in group.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>

        <div class="small muted meta">
          {{ (group.files || []).length }} file{{ (group.files || []).length === 1 ? '' : 's' }} ·
          gain {{ percent(group.gain) }} · reverb {{ group.reverb || 'off' }}
        </div>

        <div class="row card-actions">
          <button
            class="btn-sm"
            :class="{ active: isLibraryPreviewPlaying(group.id) }"
            :disabled="!(group.files || []).length"
            @click="toggleLibraryPreview(group.id)"
          >
            {{ isLibraryPreviewPlaying(group.id) ? 'Stop' : 'Preview' }}
          </button>
          <button
            class="btn-sm primary"
            :disabled="!store.activeId"
            :title="store.activeId ? 'Add an include to the active scene' : 'Open a scene first'"
            @click="addToScene(group)"
          >
            Add to scene
          </button>
          <button
            class="btn-sm"
            :disabled="pinnedIds.has(group.id)"
            :title="pinnedIds.has(group.id) ? 'Already pinned' : 'Pin this group to the palette'"
            @click="pin(group)"
          >
            {{ pinnedIds.has(group.id) ? 'Pinned' : 'Pin' }}
          </button>
          <div class="grow"></div>
          <button class="btn-sm" @click="openEdit(group)">edit</button>
          <button class="btn-sm danger" @click="confirmDelete(group)">delete</button>
        </div>
      </article>
    </div>

    <div v-if="editingId" class="modal-backdrop" @click.self="closeEdit">
      <form class="modal" @submit.prevent="saveEdit">
        <h3>Edit library group</h3>

        <div class="field">
          <label>Name</label>
          <input v-model="form.name" class="text-input" required />
        </div>

        <div class="row field-row">
          <div class="field grow">
            <label>Kind</label>
            <select v-model="form.kind" class="text-input">
              <option value="loop">Loop</option>
              <option value="random">Random</option>
              <option value="oneshot">Effect (one-shot)</option>
            </select>
          </div>
          <div class="field grow">
            <label>Category</label>
            <input v-model="form.category" class="text-input" placeholder="Monsters/Carrion Crawler" />
          </div>
        </div>

        <div class="field">
          <label>Tags <span class="small muted">(comma separated)</span></label>
          <input v-model="form.tags" class="text-input" placeholder="monster, crawl, noise" />
        </div>

        <div class="row field-row">
          <div class="field grow">
            <label>Gain — {{ percent(form.gain) }}</label>
            <input v-model.number="form.gain" type="range" min="0" max="1" step="0.01" />
          </div>
          <div class="field grow">
            <label>Reverb</label>
            <select v-model="form.reverb" class="text-input">
              <option value="">Off</option>
              <option v-for="preset in REVERB_PRESETS" :key="preset" :value="preset">
                {{ preset }}
              </option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Playlist randomisation (loops)</label>
          <select v-model="form.randomise" class="text-input">
            <option value="">In order</option>
            <option value="random">Random</option>
            <option value="shuffle">Shuffle</option>
          </select>
        </div>

        <fieldset class="trigger-fieldset">
          <legend>Random interval (seconds)</legend>
          <div class="row field-row">
            <label class="field grow">
              Min wait
              <input v-model.number="form.min" class="text-input" type="number" min="0" step="1" />
            </label>
            <label class="field grow">
              Max wait
              <input v-model.number="form.max" class="text-input" type="number" min="0" step="1" />
            </label>
            <label class="field grow">
              Start min
              <input v-model.number="form.startMin" class="text-input" type="number" min="0" step="1" />
            </label>
            <label class="field grow">
              Start max
              <input v-model.number="form.startMax" class="text-input" type="number" min="0" step="1" />
            </label>
          </div>
        </fieldset>

        <div class="row modal-actions">
          <div class="grow"></div>
          <button type="button" @click="closeEdit">Cancel</button>
          <button class="primary" type="submit" :disabled="!form.name.trim()">Save</button>
        </div>
      </form>
    </div>
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

.search-input {
  width: min(300px, 100%);
}

.kind-filter {
  width: auto;
}

.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
}

.library-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.card-title-row {
  align-items: flex-start;
  gap: 0.5rem;
}

.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.category {
  margin: 0;
}

.meta {
  line-height: 1.35;
}

.card-actions {
  margin-top: auto;
  padding-top: 0.45rem;
  flex-wrap: wrap;
}

.field-row {
  align-items: flex-start;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.modal-actions {
  margin-top: 1rem;
}

.trigger-fieldset {
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.75rem;
  margin: 0.5rem 0 0;
}

.trigger-fieldset legend {
  color: var(--text-dim);
  font-size: 0.82rem;
  padding: 0 0.25rem;
}
</style>
