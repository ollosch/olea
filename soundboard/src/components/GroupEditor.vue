<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { store, fileLocation } from '../store'
import { REVERB_PRESETS } from '../../lib/schema.js'

const props = defineProps({
  soundset: { type: Object, required: true },
  element: { type: Object, default: null },
})

const emit = defineEmits(['save', 'cancel'])

const DEFAULTS = { min: 10, max: 30, startMin: 2, startMax: 10 }

const name = ref('')
const kind = ref('oneshot')
const gain = ref(1)
const randomise = ref('')
const reverb = ref('')
const min = ref(DEFAULTS.min)
const max = ref(DEFAULTS.max)
const startMin = ref(DEFAULTS.startMin)
const startMax = ref(DEFAULTS.startMax)
const search = ref('')
const expanded = ref(null)
const selected = reactive(new Map()) // "dir::file" -> { dir, file, name, size }

const isInclude = computed(() => props.element?.source === 'library')

const kindHelp = computed(() => {
  if (kind.value === 'loop') return 'Continuous playlist — one track at a time, crossfaded.'
  if (kind.value === 'random') return 'Auto-triggered one-shot at random intervals while the scene plays.'
  return 'Manual effect — triggered by a pad/button or MIDI note.'
})

const searching = computed(() => search.value.trim().length > 0)
const q = computed(() => search.value.trim().toLowerCase())

function clamp01(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

function triggerIsZero(t) {
  return [t?.min, t?.max, t?.startMin, t?.startMax].every((v) => !Number(v))
}

function key(f) {
  return `${f.dir}::${f.file}`
}

function loadFrom(el) {
  selected.clear()
  name.value = el?.name || ''
  kind.value = el?.kind || 'oneshot'
  gain.value = el?.gain ?? 1
  randomise.value = el?.randomise || ''
  reverb.value = el?.reverb || ''

  const t = el?.trigger
  const zero = !t || triggerIsZero(t)
  if (kind.value === 'random' && zero) {
    min.value = DEFAULTS.min
    max.value = DEFAULTS.max
    startMin.value = DEFAULTS.startMin
    startMax.value = DEFAULTS.startMax
  } else {
    min.value = t?.min ?? DEFAULTS.min
    max.value = t?.max ?? DEFAULTS.max
    startMin.value = t?.startMin ?? DEFAULTS.startMin
    startMax.value = t?.startMax ?? DEFAULTS.startMax
  }

  const baseDir = el?.baseDir || props.soundset?.dir || ''
  for (const f of el?.files || []) {
    const loc = fileLocation({ dir: baseDir }, f)
    selected.set(key(loc), loc)
  }
}

watch(() => props.element, loadFrom, { immediate: true })

watch(kind, (next) => {
  if (next !== 'random') return
  if (![min.value, max.value, startMin.value, startMax.value].some((v) => Number(v))) {
    min.value = DEFAULTS.min
    max.value = DEFAULTS.max
    startMin.value = DEFAULTS.startMin
    startMax.value = DEFAULTS.startMax
  }
})

function folderFiles(folder) {
  const files = folder.files || []
  if (!searching.value) return files
  return files.filter((f) => (f.name || f.file || '').toLowerCase().includes(q.value))
}

const visibleFolders = computed(() => {
  const folders = Array.isArray(store.files) ? store.files : []
  if (!searching.value) return folders
  return folders
    .map((f) => ({ ...f, files: folderFiles(f) }))
    .filter((f) => f.files.length)
})

function isSelected(f) {
  return selected.has(key(f))
}

function toggleFile(f) {
  if (isInclude.value) return
  const k = key(f)
  if (selected.has(k)) {
    selected.delete(k)
  } else {
    selected.set(k, { dir: f.dir, file: f.file, name: f.name, size: f.size })
  }
}

function toggleFolder(folder) {
  expanded.value = expanded.value === folder.dir ? null : folder.dir
}

function toggleAllInFolder(folder) {
  if (isInclude.value) return
  const files = folderFiles(folder)
  const allOn = files.length > 0 && files.every((f) => isSelected(f))
  for (const f of files) {
    const k = key(f)
    if (allOn) selected.delete(k)
    else if (!selected.has(k)) {
      selected.set(k, { dir: f.dir, file: f.file, name: f.name, size: f.size })
    }
  }
}

function removeSelected(f) {
  if (isInclude.value) return
  selected.delete(key(f))
}

function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const selectedList = computed(() => Array.from(selected.values()))

function save() {
  if (!name.value.trim() || !selected.size) return

  let trigger = {
    min: Number(min.value) || 0,
    max: Number(max.value) || 0,
    startMin: Number(startMin.value) || 0,
    startMax: Number(startMax.value) || 0,
  }
  if (kind.value === 'random' && triggerIsZero(trigger)) {
    trigger = { ...DEFAULTS }
  }

  emit('save', {
    name: name.value.trim(),
    kind: kind.value,
    gain: clamp01(gain.value),
    randomise: randomise.value || null,
    reverb: reverb.value || null,
    trigger,
    files: selectedList.value.map((f) => ({ dir: f.dir, file: f.file })),
  })
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <div class="modal">
      <h3>{{ element ? (isInclude ? 'Edit included group' : 'Edit group') : 'New group' }}</h3>

      <div class="field">
        <label>Name</label>
        <input v-model="name" class="text-input" placeholder="e.g. Barking dogs" />
      </div>

      <div class="row field">
        <div class="field grow">
          <label>Type</label>
          <select v-model="kind" class="text-input">
            <option value="loop">Loop — continuous playlist</option>
            <option value="random">Random — auto-triggered at an interval</option>
            <option value="oneshot">Effect — manual one-shot</option>
          </select>
          <span class="small muted">{{ kindHelp }}</span>
        </div>
        <div class="field volume-field">
          <label>Volume <span class="muted">{{ Math.round(clamp01(gain) * 100) }}%</span></label>
          <input v-model.number="gain" type="range" min="0" max="1" step="0.01" />
        </div>
      </div>

      <div class="row field">
        <div class="field grow">
          <label>Playlist cycling</label>
          <select v-model="randomise" class="text-input">
            <option value="">In order</option>
            <option value="shuffle">Shuffle</option>
            <option value="random">Random</option>
          </select>
        </div>
        <div class="field grow">
          <label>Reverb</label>
          <select v-model="reverb" class="text-input">
            <option value="">None</option>
            <option v-for="p in REVERB_PRESETS" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
      </div>

      <div v-if="kind === 'random'" class="row field">
        <div class="field grow">
          <label>Every (min s)</label>
          <input v-model.number="min" type="number" min="0" step="1" class="text-input" />
        </div>
        <div class="field grow">
          <label>Every (max s)</label>
          <input v-model.number="max" type="number" min="0" step="1" class="text-input" />
        </div>
        <div class="field grow">
          <label>First (min s)</label>
          <input v-model.number="startMin" type="number" min="0" step="1" class="text-input" />
        </div>
        <div class="field grow">
          <label>First (max s)</label>
          <input v-model.number="startMax" type="number" min="0" step="1" class="text-input" />
        </div>
      </div>

      <div class="field">
        <label>Files ({{ selectedList.length }} selected)</label>
        <input v-model="search" class="text-input" placeholder="Search files…" />
        <span v-if="isInclude" class="small muted">
          Files belong to the library group. Edit the library group to change them.
        </span>
        <span v-else-if="kind === 'loop'" class="small muted">
          Loops play one track at a time, crossfaded, in the selected order.
        </span>
      </div>

      <div class="picker" :class="{ readonly: isInclude }">
        <div v-for="folder in visibleFolders" :key="folder.dir" class="folder">
          <div class="folder-head" @click="toggleFolder(folder)">
            <button class="twist" tabindex="-1">{{ expanded === folder.dir ? '▾' : '▸' }}</button>
            <span class="folder-name">{{ folder.name }}</span>
            <span class="small muted">{{ folderFiles(folder).length }}</span>
            <span class="grow"></span>
            <button
              class="mini"
              tabindex="-1"
              :disabled="isInclude"
              @click.stop="toggleAllInFolder(folder)"
            >
              all
            </button>
          </div>
          <div v-if="expanded === folder.dir || searching" class="folder-files">
            <label
              v-for="f in folderFiles(folder)"
              :key="folder.dir + '::' + f.file"
              class="file"
              :class="{ on: isSelected(f) }"
            >
              <input
                type="checkbox"
                :checked="isSelected(f)"
                :disabled="isInclude"
                @change="toggleFile(f)"
              />
              <span class="file-name">{{ f.name }}</span>
              <span v-if="formatSize(f.size)" class="small muted size">{{ formatSize(f.size) }}</span>
            </label>
          </div>
        </div>
        <p v-if="!visibleFolders.length" class="muted small">No files match</p>
      </div>

      <div v-if="selectedList.length" class="selected">
        <span class="small muted">Selected:</span>
        <span v-for="f in selectedList" :key="key(f)" class="chip">
          {{ f.name }}
          <span v-if="formatSize(f.size)" class="chip-size">{{ formatSize(f.size) }}</span>
          <button v-if="!isInclude" class="chip-x" @click="removeSelected(f)">✕</button>
        </span>
      </div>

      <div class="row actions">
        <div class="grow"></div>
        <button @click="emit('cancel')">Cancel</button>
        <button class="primary" :disabled="!name.trim() || !selected.size" @click="save">
          Save
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.field label {
  font-size: 0.8rem;
  color: var(--text-dim);
}

.volume-field {
  min-width: 180px;
}

.text-input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 0.45rem 0.6rem;
  font: inherit;
}

.picker {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  max-height: 40vh;
  overflow-y: auto;
  background: var(--bg);
}

.picker.readonly {
  opacity: 0.85;
}

.folder-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-2);
}

.twist {
  background: transparent;
  border: none;
  padding: 0;
  width: 1.2rem;
}

.folder-name {
  font-weight: 600;
}

.mini {
  padding: 0.1rem 0.4rem;
  font-size: 0.7rem;
}

.folder-files {
  padding: 0.25rem 0.5rem;
}

.file {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0;
  font-size: 0.85rem;
  cursor: pointer;
}

.file.on .file-name {
  color: var(--accent);
}

.file-name {
  overflow-wrap: anywhere;
}

.size {
  margin-left: auto;
  white-space: nowrap;
}

.selected {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
  margin-top: 0.75rem;
}

.chip {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  font-size: 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.chip-size {
  color: var(--text-dim);
  font-size: 0.68rem;
}

.chip-x {
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 0;
  font-size: 0.75rem;
}

.actions {
  margin-top: 1rem;
}
</style>
