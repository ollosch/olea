<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  store,
  searchCatalogPage,
  setImportFilters,
  importPage,
  toggleImportSound,
  clearImportSoundSelection,
  toggleImportGroup,
  clearImportGroupSelection,
  createGroupFromSelection,
  addSelectedSoundsToGroup,
  bulkEditSelectedGroups,
  mergeSelectedGroups,
  splitSelectedGroupSounds,
  deleteGroup,
  setSplitGroup,
  toggleSplitSound,
  finishImport,
  closeImport,
  previewSound,
  stopPreview,
  groupById,
  setStatus,
  refreshLibraryPage,
} from '../store.js'
import { engine } from '../engine.js'
import { REVERB_PRESETS, coerceReverb } from '../../lib/v3/schema.js'
import TriggerEditor from './TriggerEditor.vue'

const groupFilter = ref('')
const targetGroupId = ref('')
const splitName = ref('')
const busy = ref(false)
let groupFilterTimer = null

const createForm = reactive({
  name: '',
  category: '',
  tags: '',
  selection: 'random',
  defaultKind: '',
  gain: 0.8,
  reverb: '',
  pan: 0,
  trigger: { min: 10, max: 30, startMin: 2, startMax: 10 },
})

const bulkForm = reactive({
  category: '',
  tags: '',
  selection: '',
  defaultKind: '',
  gain: 0.8,
  reverb: '',
  pan: 0,
  trigger: { min: 10, max: 30, startMin: 2, startMax: 10 },
  applyCategory: false,
  applyTags: false,
  applyDefaults: false,
})

const importState = computed(() => store.import)

const percentAssigned = computed(() => {
  const stats = store.stats
  if (!stats.total) return 0
  return Math.min(100, Math.round((stats.assigned / stats.total) * 100))
})

const pageStart = computed(() =>
  importState.value.total ? importState.value.offset + 1 : 0
)
const pageEnd = computed(() =>
  Math.min(
    importState.value.total,
    importState.value.offset + importState.value.sounds.length
  )
)
const canPrev = computed(() => importState.value.offset > 0)
const canNext = computed(
  () => importState.value.offset + importState.value.limit < importState.value.total
)

const filteredGroups = computed(() => store.libraryPage)
const groupPageStart = computed(() => (store.libraryTotal ? store.libraryOffset + 1 : 0))
const groupPageEnd = computed(() =>
  Math.min(store.libraryTotal, store.libraryOffset + store.libraryPage.length)
)
const groupCanPrev = computed(() => store.libraryOffset > 0)
const groupCanNext = computed(
  () => store.libraryOffset + store.libraryLimit < store.libraryTotal
)

function loadGroups(offset = 0) {
  refreshLibraryPage({ query: groupFilter.value, offset })
}

function prevGroupPage() {
  loadGroups(Math.max(0, store.libraryOffset - store.libraryLimit))
}

function nextGroupPage() {
  loadGroups(store.libraryOffset + store.libraryLimit)
}

watch(groupFilter, () => {
  if (groupFilterTimer) clearTimeout(groupFilterTimer)
  groupFilterTimer = setTimeout(() => loadGroups(0), 250)
})

const splitGroup = computed(() =>
  importState.value.splitGroupId ? groupById(importState.value.splitGroupId) : null
)
const splitSoundRows = computed(() => {
  if (!splitGroup.value) return []
  return splitGroup.value.sounds.map((id) => ({
    id,
    label: store.soundsById[id]?.originalName || id,
  }))
})

const preview = computed(() => engine.state.preview)

function allOnPageSelected() {
  const selected = new Set(importState.value.selectedSoundIds)
  return (
    importState.value.sounds.length > 0 &&
    importState.value.sounds.every((sound) => selected.has(sound.id))
  )
}

function togglePageSelection() {
  if (allOnPageSelected()) {
    const pageIds = new Set(importState.value.sounds.map((sound) => sound.id))
    store.import.selectedSoundIds = importState.value.selectedSoundIds.filter(
      (id) => !pageIds.has(id)
    )
  } else {
    const selected = new Set(importState.value.selectedSoundIds)
    for (const sound of importState.value.sounds) selected.add(sound.id)
    store.import.selectedSoundIds = [...selected]
  }
}

function submitFilters() {
  setImportFilters({
    query: importState.value.query,
    unassigned: importState.value.unassigned,
    kind: importState.value.kind,
    category: importState.value.category,
    tag: importState.value.tag,
  })
}

function parseTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

async function submitCreateGroup() {
  if (!createForm.name.trim()) {
    setStatus('Group name is required', 'error')
    return
  }
  busy.value = true
  await createGroupFromSelection({
    name: createForm.name.trim(),
    category: createForm.category,
    tags: parseTags(createForm.tags),
    selection: createForm.selection,
    defaultKind: createForm.defaultKind || null,
    defaults: {
      gain: Number(createForm.gain),
      reverb: coerceReverb(createForm.reverb),
      pan: Number(createForm.pan),
      trigger: createForm.trigger,
    },
  })
  busy.value = false
  createForm.name = ''
}

async function submitBulk() {
  const patch = {}
  if (bulkForm.applyCategory) patch.category = bulkForm.category
  if (bulkForm.applyTags) patch.tags = parseTags(bulkForm.tags)
  if (bulkForm.selection) patch.selection = bulkForm.selection
  if (bulkForm.defaultKind !== '') patch.defaultKind = bulkForm.defaultKind || null
  if (bulkForm.applyDefaults) {
    patch.defaults = {
      gain: Number(bulkForm.gain),
      reverb: coerceReverb(bulkForm.reverb),
      pan: Number(bulkForm.pan),
      trigger: bulkForm.trigger,
    }
  }
  if (!Object.keys(patch).length) {
    setStatus('Choose at least one bulk change first', 'error')
    return
  }
  busy.value = true
  const groups = await bulkEditSelectedGroups(patch)
  busy.value = false
  if (groups.length) {
    bulkForm.applyCategory = false
    bulkForm.applyTags = false
    bulkForm.applyDefaults = false
  }
}

async function mergeGroups() {
  busy.value = true
  await mergeSelectedGroups()
  busy.value = false
}

async function deleteSelectedGroups() {
  if (!importState.value.selectedGroupIds.length) return
  if (!window.confirm(`Delete ${importState.value.selectedGroupIds.length} selected group(s)?`)) {
    return
  }
  busy.value = true
  for (const id of [...importState.value.selectedGroupIds]) {
    await deleteGroup(id)
  }
  clearImportGroupSelection()
  busy.value = false
}

async function addToGroup() {
  if (!targetGroupId.value) return
  busy.value = true
  await addSelectedSoundsToGroup(targetGroupId.value)
  busy.value = false
}

async function doSplit() {
  busy.value = true
  await splitSelectedGroupSounds(splitName.value.trim())
  busy.value = false
  splitName.value = ''
}

async function finish() {
  if (
    !window.confirm(
      'Mark curation as complete? The Import view will be hidden afterwards.'
    )
  ) {
    return
  }
  await finishImport(true)
}

function chooseSplit(group) {
  setSplitGroup(group.id)
  splitName.value = `${group.name} (split)`
}

onMounted(() => {
  if (store.catalogCount > 0) searchCatalogPage()
  loadGroups(0)
})
</script>

<template>
  <section class="import-view">
    <header class="import-head">
      <div>
        <h1>Import &amp; curation</h1>
        <p class="small muted">
          One-off catalog tool. Everything is server-paged; the full catalog is never loaded.
        </p>
      </div>
      <div class="row gap-sm wrap">
        <button class="btn-sm" @click="closeImport">← Back to editor</button>
        <button class="btn-sm danger" :disabled="store.importDone" @click="finish">
          Finish migration
        </button>
      </div>
    </header>

    <section class="import-progress">
      <div class="progress-meta">
        <span>
          <strong>{{ store.stats.assigned }}</strong> / {{ store.stats.total }} sounds assigned
        </span>
        <span class="muted">{{ store.stats.groups }} groups · {{ store.stats.uncategorized }} uncategorized</span>
        <span v-if="store.importDone" class="badge ok-badge">migration complete</span>
      </div>
      <div class="progress-bar"><span :style="{ width: `${percentAssigned}%` }"></span></div>
    </section>

    <div v-if="store.catalogCount === 0" class="empty-state">
      <h3>The catalog is empty</h3>
      <p>Run the content-addressed importer from the soundboard directory first:</p>
      <pre class="cli-hint">npm run import-v3 -- --source "/path/to/syrinscape"</pre>
      <p class="small muted">
        Add <code>--dry-run</code> to preview, or <code>--no-duration</code> to skip ffprobe.
      </p>
    </div>

    <div v-else class="import-grid">
      <aside class="import-filters card">
        <h2>Filter catalog</h2>
        <label class="field">
          <span>Search</span>
          <input
            v-model="importState.query"
            class="text-input"
            type="search"
            placeholder="name, hash, id"
            @keyup.enter="submitFilters"
          />
        </label>
        <label class="field">
          <span>Category</span>
          <input
            v-model="importState.category"
            class="text-input"
            placeholder="Creatures/Dogs"
            @keyup.enter="submitFilters"
          />
        </label>
        <label class="field">
          <span>Tag</span>
          <input
            v-model="importState.tag"
            class="text-input"
            placeholder="bark"
            @keyup.enter="submitFilters"
          />
        </label>
        <label class="field">
          <span>Kind</span>
          <select v-model="importState.kind" @change="submitFilters">
            <option value="">Any</option>
            <option value="loop">Loop</option>
            <option value="random">Random</option>
            <option value="oneshot">One-shot</option>
          </select>
        </label>
        <label class="checkbox-field">
          <input
            v-model="importState.unassigned"
            type="checkbox"
            @change="submitFilters"
          />
          <span>Unassigned sounds only</span>
        </label>
        <button class="btn-primary" @click="submitFilters">Search</button>

        <h2 class="spaced">Add selected sounds</h2>
        <label class="field">
          <span>Target group</span>
          <select v-model="targetGroupId">
            <option value="">Choose a group…</option>
            <option v-for="group in filteredGroups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
        </label>
        <button class="btn-sm" :disabled="!targetGroupId || busy" @click="addToGroup">
          Add {{ importState.selectedSoundIds.length }} selected
        </button>

        <h2 class="spaced">Preview</h2>
        <div v-if="preview" class="preview-box">
          <span class="small">{{ preview.playing ? 'Playing preview' : 'Preview finished' }}</span>
          <div class="mini-progress">
            <span
              :style="{
                width: `${preview.duration ? Math.min(100, (preview.position / preview.duration) * 100) : 0}%`,
              }"
            ></span>
          </div>
          <button class="btn-xs" @click="stopPreview">Stop preview</button>
        </div>
        <div v-else class="small muted">Press ▶ on a sound to preview it.</div>
      </aside>

      <main class="import-catalog card">
        <div class="catalog-head">
          <div class="row gap-sm wrap">
            <strong>{{ importState.total }} result{{ importState.total === 1 ? '' : 's' }}</strong>
            <span class="small muted">Page {{ pageStart }}–{{ pageEnd }}</span>
          </div>
          <div class="row gap-sm wrap">
            <button class="btn-xs" @click="togglePageSelection">
              {{ allOnPageSelected() ? 'Clear page' : 'Select page' }}
            </button>
            <button
              class="btn-xs"
              :disabled="!importState.selectedSoundIds.length"
              @click="clearImportSoundSelection"
            >
              Clear selection ({{ importState.selectedSoundIds.length }})
            </button>
          </div>
        </div>

        <div v-if="importState.loading" class="small muted">Loading…</div>
        <ul class="catalog-list">
          <li
            v-for="sound in importState.sounds"
            :key="sound.id"
            class="catalog-item"
            :class="{ selected: importState.selectedSoundIds.includes(sound.id) }"
          >
            <input
              type="checkbox"
              :checked="importState.selectedSoundIds.includes(sound.id)"
              @change="toggleImportSound(sound.id)"
            />
            <div class="catalog-main">
              <span class="sound-name">{{ sound.originalName || sound.id }}</span>
              <span class="small muted">
                {{ sound.duration ? `${sound.duration.toFixed(1)}s · ` : '' }}{{
                  sound.hash.slice(0, 12)
                }}…
              </span>
            </div>
            <button class="btn-xs" title="Preview" @click="previewSound(sound)">▶</button>
          </li>
          <li v-if="!importState.sounds.length && !importState.loading" class="empty-mini">
            No sounds match these filters.
          </li>
        </ul>

        <div class="pager">
          <button class="btn-sm" :disabled="!canPrev || importState.loading" @click="importPage(-1)">
            ← Prev
          </button>
          <span class="small muted">
            {{ importState.offset + 1 }}–{{ importState.offset + importState.limit }} of
            {{ importState.total }}
          </span>
          <button class="btn-sm" :disabled="!canNext || importState.loading" @click="importPage(1)">
            Next →
          </button>
        </div>

        <form class="create-group card inset" @submit.prevent="submitCreateGroup">
          <h2>Create group from selection</h2>
          <div class="form-grid">
            <label class="field span-2">
              <span>Name</span>
              <input v-model="createForm.name" class="text-input" placeholder="Barking Dogs" />
            </label>
            <label class="field">
              <span>Category</span>
              <input v-model="createForm.category" class="text-input" placeholder="Creatures/Dogs" />
            </label>
            <label class="field">
              <span>Tags</span>
              <input v-model="createForm.tags" class="text-input" placeholder="animal, bark" />
            </label>
            <label class="field">
              <span>Selection</span>
              <select v-model="createForm.selection">
                <option value="random">Random</option>
                <option value="ordered">Ordered</option>
              </select>
            </label>
            <label class="field">
              <span>Default kind</span>
              <select v-model="createForm.defaultKind">
                <option value="">No hint</option>
                <option value="loop">Loop</option>
                <option value="random">Random</option>
                <option value="oneshot">One-shot</option>
              </select>
            </label>
            <label class="field">
              <span>Gain</span>
              <input v-model.number="createForm.gain" type="range" min="0" max="1" step="0.01" />
            </label>
            <label class="field">
              <span>Pan</span>
              <input v-model.number="createForm.pan" type="range" min="-1" max="1" step="0.01" />
            </label>
            <label class="field span-2">
              <span>Reverb</span>
              <select v-model="createForm.reverb">
                <option value="">Dry (Off)</option>
                <option v-for="preset in REVERB_PRESETS" :key="preset" :value="preset">
                  {{ preset }}
                </option>
              </select>
            </label>
            <div class="span-2">
              <span class="field-label">Default random trigger (seconds)</span>
              <TriggerEditor v-model="createForm.trigger" />
            </div>
          </div>
          <button
            class="btn-primary"
            type="submit"
            :disabled="busy || !importState.selectedSoundIds.length || !createForm.name.trim()"
          >
            Create group ({{ importState.selectedSoundIds.length }} sounds)
          </button>
        </form>
      </main>

      <aside class="import-groups card">
        <h2>Groups</h2>
        <input v-model="groupFilter" class="text-input" type="search" placeholder="Filter groups…" />

        <div class="library-pager row gap-sm wrap">
          <button class="btn-xs" :disabled="!groupCanPrev || store.libraryLoading" @click="prevGroupPage">
            ← Previous
          </button>
          <span class="small muted">
            {{ groupPageStart }}–{{ groupPageEnd }} of {{ store.libraryTotal }}
          </span>
          <button class="btn-xs" :disabled="!groupCanNext || store.libraryLoading" @click="nextGroupPage">
            Next →
          </button>
        </div>

        <div class="row gap-sm wrap group-select-actions">
          <button class="btn-xs" @click="clearImportGroupSelection">
            Clear ({{ importState.selectedGroupIds.length }})
          </button>
          <button class="btn-xs" :disabled="importState.selectedGroupIds.length < 2" @click="mergeGroups">
            Merge
          </button>
          <button
            class="btn-xs danger"
            :disabled="!importState.selectedGroupIds.length"
            @click="deleteSelectedGroups"
          >
            Delete
          </button>
        </div>

        <ul class="group-pick-list">
          <li v-for="group in filteredGroups" :key="group.id" class="group-pick">
            <input
              type="checkbox"
              :checked="importState.selectedGroupIds.includes(group.id)"
              @change="toggleImportGroup(group.id)"
            />
            <button class="group-pick-name" :title="group.category || 'No category'" @click="chooseSplit(group)">
              {{ group.name }}
            </button>
            <span class="small muted">{{ group.sounds.length }}</span>
          </li>
        </ul>

        <form v-if="splitGroup" class="split-box" @submit.prevent="doSplit">
          <h3>Split “{{ splitGroup.name }}”</h3>
          <p class="small muted">Pick the sounds that should move into a new group.</p>
          <ul class="split-sound-list">
            <li v-for="sound in splitSoundRows" :key="sound.id">
              <label class="checkbox-field">
                <input
                  type="checkbox"
                  :checked="importState.splitSoundIds.includes(sound.id)"
                  @change="toggleSplitSound(sound.id)"
                />
                <span class="small">{{ sound.label }}</span>
              </label>
            </li>
          </ul>
          <input v-model="splitName" class="text-input" placeholder="New group name" />
          <button
            class="btn-sm"
            type="submit"
            :disabled="!importState.splitSoundIds.length || busy"
          >
            Split selected sounds
          </button>
        </form>

        <form class="bulk-box" @submit.prevent="submitBulk">
          <h3>Bulk edit selected groups</h3>
          <label class="checkbox-field">
            <input v-model="bulkForm.applyCategory" type="checkbox" />
            <span>Set category</span>
          </label>
          <input
            v-model="bulkForm.category"
            class="text-input"
            :disabled="!bulkForm.applyCategory"
            placeholder="Creatures"
          />
          <label class="checkbox-field">
            <input v-model="bulkForm.applyTags" type="checkbox" />
            <span>Set tags</span>
          </label>
          <input
            v-model="bulkForm.tags"
            class="text-input"
            :disabled="!bulkForm.applyTags"
            placeholder="animal, night"
          />
          <div class="form-grid">
            <label class="field">
              <span>Selection</span>
              <select v-model="bulkForm.selection">
                <option value="">Keep</option>
                <option value="random">Random</option>
                <option value="ordered">Ordered</option>
              </select>
            </label>
            <label class="field">
              <span>Default kind</span>
              <select v-model="bulkForm.defaultKind">
                <option value="">Keep</option>
                <option value="loop">Loop</option>
                <option value="random">Random</option>
                <option value="oneshot">One-shot</option>
              </select>
            </label>
            <label class="field">
              <span>Gain</span>
              <input
                v-model.number="bulkForm.gain"
                type="range"
                min="0"
                max="1"
                step="0.01"
                :disabled="!bulkForm.applyDefaults"
              />
            </label>
            <label class="field">
              <span>Pan</span>
              <input
                v-model.number="bulkForm.pan"
                type="range"
                min="-1"
                max="1"
                step="0.01"
                :disabled="!bulkForm.applyDefaults"
              />
            </label>
            <label class="field span-2">
              <span>Reverb</span>
              <select v-model="bulkForm.reverb" :disabled="!bulkForm.applyDefaults">
                <option value="">Dry (Off)</option>
                <option v-for="preset in REVERB_PRESETS" :key="preset" :value="preset">
                  {{ preset }}
                </option>
              </select>
            </label>
          </div>
          <label class="checkbox-field">
            <input v-model="bulkForm.applyDefaults" type="checkbox" />
            <span>Apply default gain, pan, reverb and trigger</span>
          </label>
          <TriggerEditor v-model="bulkForm.trigger" :disabled="!bulkForm.applyDefaults" />
          <button
            class="btn-sm"
            type="submit"
            :disabled="busy || !importState.selectedGroupIds.length"
          >
            Apply to {{ importState.selectedGroupIds.length }} group(s)
          </button>
        </form>
      </aside>
    </div>
  </section>
</template>
