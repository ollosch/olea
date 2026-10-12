<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { store, fileLocation } from '../store'
import { REVERB_PRESETS } from '../../lib/schema.js'

const props = defineProps({
  soundset: { type: Object, required: true },
  element: { type: Object, default: null },
})

const emit = defineEmits(['save', 'cancel'])

const name = ref('')
const kind = ref('oneshot')
const gain = ref(1)
const min = ref(10)
const max = ref(30)
const reverb = ref('')
const search = ref('')
const expanded = ref(null)
const selected = reactive(new Map()) // "dir::file" -> { dir, file, name }

watch(
  () => props.element,
  (el) => {
    selected.clear()
    name.value = el?.name || ''
    kind.value = el?.kind || 'oneshot'
    gain.value = el?.gain ?? 1
    min.value = el?.trigger?.min ?? 10
    max.value = el?.trigger?.max ?? 30
    reverb.value = el?.reverb || ''
    if (el?.files) {
      for (const f of el.files) {
        const loc = fileLocation(props.soundset, f)
        selected.set(key(loc), loc)
      }
    }
  },
  { immediate: true }
)

const searching = computed(() => search.value.trim().length > 0)
const q = computed(() => search.value.trim().toLowerCase())

function key(f) {
  return `${f.dir}::${f.file}`
}

function folderFiles(folder) {
  if (!searching.value) return folder.files
  return folder.files.filter((f) => f.name.toLowerCase().includes(q.value))
}

const visibleFolders = computed(() => {
  const folders = store.files
  if (!searching.value) return folders
  return folders
    .map((f) => ({ ...f, files: folderFiles(f) }))
    .filter((f) => f.files.length)
})

function isSelected(f) {
  return selected.has(key(f))
}

function toggleFile(f) {
  const k = key(f)
  if (selected.has(k)) selected.delete(k)
  else selected.set(k, { dir: f.dir, file: f.file, name: f.name })
}

function toggleFolder(folder) {
  expanded.value = expanded.value === folder.dir ? null : folder.dir
}

function toggleAllInFolder(folder) {
  const files = folderFiles(folder)
  const allOn = files.every((f) => isSelected(f))
  for (const f of files) {
    const k = key(f)
    if (allOn) selected.delete(k)
    else if (!selected.has(k)) selected.set(k, { dir: f.dir, file: f.file, name: f.name })
  }
}

const selectedList = computed(() => Array.from(selected.values()))

function save() {
  if (!name.value.trim() || !selected.size) return
  emit('save', {
    name: name.value.trim(),
    kind: kind.value,
    gain: Number(gain.value) || 1,
    randomise: 'random',
    reverb: reverb.value || null,
    trigger: { min: Number(min.value) || 0, max: Number(max.value) || 0, startMin: 0, startMax: 0 },
    files: Array.from(selected.values()).map((f) => ({ dir: f.dir, file: f.file })),
  })
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <div class="modal">
      <h3>{{ element ? 'Edit group' : 'New group' }}</h3>

      <div class="field">
        <label>Name</label>
        <input v-model="name" class="text-input" placeholder="e.g. Barking dogs" />
      </div>

      <div class="row field">
        <div class="field grow">
          <label>Type</label>
          <select v-model="kind" class="text-input">
            <option value="oneshot">One-shot (button → random sound)</option>
            <option value="random">Random (auto-plays at an interval)</option>
            <option value="loop">Loop (continuous)</option>
          </select>
        </div>
        <div class="field grow">
          <label>Volume</label>
          <input v-model.number="gain" type="range" min="0" max="2" step="0.01" />
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
      </div>

      <div class="field">
        <label>Reverb</label>
        <select v-model="reverb" class="text-input">
          <option value="">None</option>
          <option v-for="p in REVERB_PRESETS" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>

      <div class="field">
        <label>Files ({{ selectedList.length }} selected)</label>
        <input v-model="search" class="text-input" placeholder="Search files…" />
      </div>

      <div class="picker">
        <div v-for="folder in visibleFolders" :key="folder.dir" class="folder">
          <div class="folder-head" @click="toggleFolder(folder)">
            <button class="twist" tabindex="-1">{{ expanded === folder.dir ? '▾' : '▸' }}</button>
            <span class="folder-name">{{ folder.name }}</span>
            <span class="small muted">{{ folder.files.length }}</span>
            <span class="grow"></span>
            <button
              class="mini"
              tabindex="-1"
              @click.stop="toggleAllInFolder(folder)"
            >
              all
            </button>
          </div>
          <div v-if="expanded === folder.dir || searching" class="folder-files">
            <label
              v-for="f in folder.files"
              :key="folder.dir + '::' + f.file"
              class="file"
              :class="{ on: isSelected(f) }"
            >
              <input
                type="checkbox"
                :checked="isSelected(f)"
                @change="toggleFile(f)"
              />
              <span class="file-name">{{ f.name }}</span>
            </label>
          </div>
        </div>
        <p v-if="!visibleFolders.length" class="muted small">No files match</p>
      </div>

      <div v-if="selectedList.length" class="selected">
        <span class="small muted">Selected:</span>
        <span v-for="f in selectedList" :key="key(f)" class="chip">
          {{ f.name }}
          <button class="chip-x" @click="selected.delete(key(f))">✕</button>
        </span>
      </div>

      <div class="row actions">
        <div class="grow"></div>
        <button @click="emit('cancel')">Cancel</button>
        <button class="primary" :disabled="!name.trim() || !selected.size" @click="save">Save</button>
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
