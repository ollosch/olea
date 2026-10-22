<script setup>
import { ref, computed } from 'vue'
import {
  store,
  enabledSoundsets,
  disabledSoundsets,
  createSoundset,
  deleteSoundset,
  disableSoundset,
  enableSoundset,
  soundsetElements,
} from '../store'

const emit = defineEmits(['open'])

const creating = ref(false)
const newName = ref('')
const query = ref('')

const q = computed(() => query.value.trim().toLowerCase())

function matches(ss) {
  return !q.value || (ss.name || '').toLowerCase().includes(q.value)
}

const visibleEnabled = computed(() => enabledSoundsets.value.filter(matches))
const visibleDisabled = computed(() => disabledSoundsets.value.filter(matches))

function counts(ss) {
  const { loops, randoms, oneshots } = soundsetElements(ss)
  return { loops: loops.length, randoms: randoms.length, effects: oneshots.length }
}

function openScene(ss) {
  emit('open', ss.id)
}

function beginCreate() {
  newName.value = ''
  creating.value = true
}

async function confirmCreate() {
  const name = newName.value.trim()
  if (!name) return
  creating.value = false
  const id = await createSoundset(name)
  if (id) emit('open', id)
}

function confirmDelete(ss) {
  const message =
    `Delete the scene “${ss.name}” and all of its audio files?\n\n` +
    'This cannot be undone. Library groups are not removed.'
  if (window.confirm(message)) deleteSoundset(ss.id)
}
</script>

<template>
  <section class="scenes-panel">
    <div class="row panel-head">
      <h2>Scenes</h2>
      <div class="grow"></div>
      <input
        v-model="query"
        class="search-input"
        type="search"
        placeholder="Search scenes…"
        aria-label="Search scenes"
      />
      <button v-if="!creating" class="primary" @click="beginCreate">+ New scene</button>
    </div>

    <form v-if="creating" class="create-form row" @submit.prevent="confirmCreate">
      <input
        v-model="newName"
        class="text-input grow"
        placeholder="Scene name"
        autofocus
        @keydown.esc="creating = false"
      />
      <button class="primary" type="submit" :disabled="!newName.trim()">Create</button>
      <button type="button" @click="creating = false">Cancel</button>
    </form>

    <div v-if="!store.soundsets.length" class="empty-state">
      <h3>No scenes yet</h3>
      <p class="muted">Create a scene, then add sounds from the library or promote imported sounds.</p>
      <button class="primary" @click="beginCreate">+ Create your first scene</button>
    </div>

    <p v-else-if="!visibleEnabled.length && !visibleDisabled.length" class="empty-state muted">
      No scenes match “{{ query }}”.
    </p>

    <div v-if="visibleEnabled.length" class="grid">
      <article v-for="ss in visibleEnabled" :key="ss.id" class="card soundset-card">
        <div class="row card-title-row">
          <span class="name grow">{{ ss.name }}</span>
          <span v-if="ss.reviewed === false" class="badge needs-review" title="Imported heuristically; classification needs review">
            needs review
          </span>
        </div>

        <span class="small muted counts">
          {{ counts(ss).loops }} loops · {{ counts(ss).randoms }} randoms ·
          {{ counts(ss).effects }} effects
        </span>

        <div class="row card-actions">
          <button class="primary" @click="openScene(ss)">
            {{ store.activeId === ss.id ? 'Open' : 'Start / open' }}
          </button>
          <div class="grow"></div>
          <button class="btn-sm" title="Hide from the active scene list" @click="disableSoundset(ss.id)">
            disable
          </button>
          <button class="btn-sm danger" title="Delete this scene permanently" @click="confirmDelete(ss)">
            delete
          </button>
        </div>
      </article>
    </div>

    <section v-if="visibleDisabled.length" class="disabled-section">
      <h3>Disabled</h3>
      <div v-for="ss in visibleDisabled" :key="ss.id" class="row disabled-row">
        <span class="grow">{{ ss.name }}</span>
        <span class="small muted">
          {{ counts(ss).loops }}L · {{ counts(ss).randoms }}R · {{ counts(ss).effects }}E
        </span>
        <button class="btn-sm" @click="enableSoundset(ss.id)">enable</button>
        <button class="btn-sm danger" @click="confirmDelete(ss)">delete</button>
      </div>
    </section>
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
  width: min(260px, 100%);
}

.create-form {
  margin-bottom: 0.9rem;
  flex-wrap: wrap;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 0.75rem;
}

.soundset-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 7rem;
}

.card-title-row {
  align-items: flex-start;
  flex-wrap: wrap;
}

.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.counts {
  line-height: 1.35;
}

.card-actions {
  margin-top: auto;
  flex-wrap: wrap;
  padding-top: 0.35rem;
}

.disabled-row {
  padding: 0.25rem 0;
  flex-wrap: wrap;
}
</style>
