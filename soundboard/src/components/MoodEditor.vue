<script setup>
import { ref, reactive, computed } from 'vue'
import { soundsetElements } from '../store'

const props = defineProps({
  soundset: { type: Object, required: true },
  mood: { type: Object, default: null },
})

const emit = defineEmits(['save', 'cancel'])

const elements = computed(() => {
  const { loops, randoms } = soundsetElements(props.soundset)
  return [...loops, ...randoms]
})

const name = ref(props.mood?.name || '')

const rows = reactive({})

for (const el of elements.value) {
  const p = props.mood?.params?.[el.id]
  rows[el.id] = {
    plays: p ? p.plays : true,
    volume: p ? p.volume : el.gain,
  }
}

function save() {
  if (!name.value.trim()) return
  const params = {}
  for (const el of elements.value) {
    const r = rows[el.id]
    if (r) params[el.id] = { plays: r.plays, volume: r.volume }
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
        <label>Elements</label>
        <div class="mood-elements">
          <div v-for="el in elements" :key="el.id" class="row mood-el">
            <label class="grow mood-el-name">
              <input type="checkbox" v-model="rows[el.id].plays" />
              <span>{{ el.name }}</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              v-model.number="rows[el.id].volume"
              class="mood-vol"
            />
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
  max-height: 40vh;
  overflow-y: auto;
}

.mood-el {
  padding: 0.2rem 0;
}

.mood-el-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.mood-vol {
  width: 150px;
}

.actions {
  margin-top: 1rem;
}
</style>
