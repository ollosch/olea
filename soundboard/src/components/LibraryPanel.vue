<script setup>
import { ref } from 'vue'
import {
  store,
  mergedSoundsets,
  startSoundset,
  createSoundset,
  deleteSoundset,
  isCustomSoundset,
} from '../store'

const creating = ref(false)
const newName = ref('')

function counts(ss) {
  let loops = 0
  let effects = 0
  for (const el of ss.elements) {
    if (el.kind === 'loop' || el.kind === 'random') loops++
    else effects++
  }
  return { loops, effects }
}

function beginCreate() {
  newName.value = ''
  creating.value = true
}

function confirmCreate() {
  const name = newName.value.trim() || 'New soundscape'
  const id = createSoundset(name)
  creating.value = false
  startSoundset(id)
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

    <p v-if="!mergedSoundsets.length" class="muted">No soundsets found</p>

    <div v-else class="grid">
      <div
        v-for="ss in mergedSoundsets"
        :key="ss.id"
        class="card soundset-card"
        role="button"
        tabindex="0"
        @click="startSoundset(ss.id)"
        @keydown.enter="startSoundset(ss.id)"
      >
        <span class="name">
          {{ ss.name }}
          <span v-if="isCustomSoundset(ss.id)" class="tag">custom</span>
        </span>
        <span class="small muted">
          {{ counts(ss).loops }} loops · {{ counts(ss).effects }} effects
        </span>
        <button
          v-if="isCustomSoundset(ss.id)"
          class="danger del"
          title="Delete soundscape"
          @click.stop="deleteSoundset(ss.id)"
        >
          delete
        </button>
      </div>
    </div>
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

.tag {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 0 0.3rem;
  margin-left: 0.4rem;
  vertical-align: middle;
}

.del {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  padding: 0.2rem 0.4rem;
  font-size: 0.7rem;
}
</style>
