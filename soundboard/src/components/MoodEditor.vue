<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { soundsetElements } from '../store'

const props = defineProps({
  soundset: { type: Object, required: true },
  mood: { type: Object, default: null },
})

const emit = defineEmits(['save', 'cancel'])

const name = ref(props.mood?.name || '')
const rows = reactive({})

const elements = computed(() => {
  const { loops, randoms } = soundsetElements(props.soundset)
  return [...loops, ...randoms]
})

function clamp01(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

function pct(value) {
  return `${Math.round(clamp01(value) * 100)}%`
}

function defaultRow(el) {
  const p = props.mood?.params ? props.mood.params[el.id] : null
  return {
    plays: p ? p.plays !== false : !props.mood,
    volume: p && p.volume != null ? clamp01(p.volume) : clamp01(el.gain ?? 1),
  }
}

watch(
  elements,
  (list) => {
    const live = new Set(list.map((el) => el.id))
    for (const el of list) {
      if (!rows[el.id]) rows[el.id] = defaultRow(el)
    }
    for (const id of Object.keys(rows)) {
      if (!live.has(id)) delete rows[id]
    }
  },
  { immediate: true }
)

function save() {
  if (!name.value.trim()) return
  const params = {}
  for (const el of elements.value) {
    const row = rows[el.id]
    if (!row) continue
    params[el.id] = { plays: !!row.plays, volume: clamp01(row.volume) }
  }
  emit('save', { name: name.value.trim(), params })
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <div class="modal">
      <h3>{{ mood ? 'Edit mood' : 'New mood' }}</h3>

      <div class="field">
        <label>Name</label>
        <input v-model="name" class="text-input" placeholder="e.g. Quiet" />
      </div>

      <div class="field">
        <label>Loops &amp; randoms ({{ elements.length }})</label>
        <p class="small muted note">
          Elements that are unchecked — or missing from this mood — are not played while the mood
          is active. Volumes are shown as percentages.
        </p>
        <div class="mood-elements">
          <div v-for="el in elements" :key="el.id" class="mood-el">
            <label class="mood-el-name grow">
              <input type="checkbox" v-model="rows[el.id].plays" />
              <span class="tag kind">{{ el.kind === 'loop' ? 'Loop' : 'Random' }}</span>
              <span
                class="tag origin"
                :class="{ library: el.source === 'library' }"
              >
                {{ el.source === 'library' ? 'Library' : 'Scene' }}
              </span>
              <span class="name">{{ el.name || 'Unnamed' }}</span>
            </label>
            <div class="vol-wrap">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                v-model.number="rows[el.id].volume"
                class="mood-vol"
              />
              <span class="pct">{{ pct(rows[el.id].volume) }}</span>
            </div>
          </div>
          <p v-if="!elements.length" class="muted small">No loop or random elements</p>
        </div>
      </div>

      <div class="row actions">
        <div class="grow"></div>
        <button @click="emit('cancel')">Cancel</button>
        <button class="primary" :disabled="!name.trim()" @click="save">Save</button>
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

.note {
  margin: 0 0 0.35rem;
}

.text-input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 0.45rem 0.6rem;
  font: inherit;
}

.mood-elements {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.5rem;
  max-height: 45vh;
  overflow-y: auto;
}

.mood-el {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--border);
}

.mood-el:last-child {
  border-bottom: none;
}

.mood-el-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  overflow-wrap: anywhere;
  min-width: 14rem;
}

.name {
  font-weight: 550;
}

.tag {
  display: inline-block;
  font-size: 0.68rem;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0 0.3rem;
  white-space: nowrap;
}

.tag.kind {
  color: var(--accent);
  border-color: var(--accent);
}

.tag.origin.library {
  color: var(--ok);
  border-color: var(--ok);
}

.vol-wrap {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.mood-vol {
  width: 150px;
}

.pct {
  font-size: 0.72rem;
  color: var(--text-dim);
  min-width: 2.6rem;
  text-align: right;
}

.actions {
  margin-top: 1rem;
}

@media (max-width: 620px) {
  .mood-vol {
    width: 110px;
  }
}
</style>
