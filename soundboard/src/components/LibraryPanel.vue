<script setup>
import { ref } from 'vue'
import {
  enabledSoundsets,
  disabledSoundsets,
  startSoundset,
  createSoundset,
  deleteSoundset,
  disableSoundset,
  enableSoundset,
} from '../store'

const creating = ref(false)
const newName = ref('')

function counts(ss) {
  let loops = 0
  let effects = 0
  for (const el of ss.elements || []) {
    if (el.kind === 'loop' || el.kind === 'random') loops++
    else effects++
  }
  return { loops, effects }
}

function beginCreate() {
  newName.value = ''
  creating.value = true
}

async function confirmCreate() {
  const name = newName.value.trim() || 'New soundscape'
  creating.value = false
  const id = await createSoundset(name)
  if (id) startSoundset(id)
}

function confirmDelete(ss) {
  if (window.confirm('Delete this soundscape and all its audio files?')) {
    deleteSoundset(ss.id)
  }
}
</script>

<template>
  <section>
    <div class="row head">
      <h2>Library</h2>
      <div class="grow"></div>
      <form v-if="creating" class="row" @submit.prevent="confirmCreate">
        <input
          v-model="newName"
          class="name-input"
          placeholder="Soundscape name"
          autofocus
          @keydown.esc="creating = false"
        />
        <button class="primary" type="submit">Create</button>
        <button type="button" @click="creating = false">Cancel</button>
      </form>
      <button v-else @click="beginCreate">+ New soundscape</button>
    </div>

    <p v-if="!enabledSoundsets.length && !disabledSoundsets.length" class="muted">No soundsets found</p>

    <div v-if="enabledSoundsets.length" class="grid">
      <div
        v-for="ss in enabledSoundsets"
        :key="ss.id"
        class="card soundset-card"
        role="button"
        tabindex="0"
        @click="startSoundset(ss.id)"
        @keydown.enter="startSoundset(ss.id)"
      >
        <span class="name">{{ ss.name }}</span>
        <span class="small muted">
          {{ counts(ss).loops }} loops · {{ counts(ss).effects }} effects
        </span>
        <div class="row card-actions">
          <button
            class="learn"
            title="Disable soundscape"
            @click.stop="disableSoundset(ss.id)"
          >
            disable
          </button>
          <button
            class="learn danger"
            title="Delete soundscape"
            @click.stop="confirmDelete(ss)"
          >
            delete
          </button>
        </div>
      </div>
    </div>

    <section v-if="disabledSoundsets.length" class="disabled-section">
      <h3>Disabled</h3>
      <div v-for="ss in disabledSoundsets" :key="ss.id" class="row disabled-row">
        <span class="grow">{{ ss.name }}</span>
        <button class="learn" @click="enableSoundset(ss.id)">enable</button>
        <button class="learn danger" @click="confirmDelete(ss)">delete</button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.head {
  margin-bottom: 0.75rem;
}

.head h2 {
  margin: 0;
}

.name-input {
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.6rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
}

.soundset-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  text-align: left;
  min-height: 4.5rem;
  cursor: pointer;
  position: relative;
}

.name {
  font-weight: 600;
}

.card-actions {
  margin-top: auto;
}

.learn {
  padding: 0.3rem 0.5rem;
  font-size: 0.75rem;
  white-space: nowrap;
}

.learn.danger {
  color: var(--danger);
  border-color: var(--danger);
}

.disabled-section {
  margin-top: 1.25rem;
}

.disabled-row {
  padding: 0.25rem 0;
}
</style>
