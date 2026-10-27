<script setup>
import {
  store,
  selectedMood,
  selectMood,
  createMood,
  duplicateMood,
  renameMood,
  deleteMood,
  setDefaultMood,
} from '../store.js'

function rename(event) {
  if (!selectedMood.value) return
  const name = event.target.value.trim()
  if (name) renameMood(selectedMood.value.id, name)
  event.target.value = selectedMood.value.name
}

function removeSelected() {
  if (!selectedMood.value) return
  if (!window.confirm(`Delete mood "${selectedMood.value.name}"?`)) return
  deleteMood(selectedMood.value.id)
}
</script>

<template>
  <section v-if="store.activeScene" class="mood-bar">
    <div class="mood-chips">
      <button
        v-for="mood in store.activeScene.moods"
        :key="mood.id"
        class="mood-chip"
        :class="{ active: mood.id === store.selectedMoodId }"
        :title="mood.id === store.activeScene.defaultMoodId ? 'Default mood' : 'Select mood'"
        @click="selectMood(mood.id)"
      >
        <span v-if="mood.id === store.activeScene.defaultMoodId" class="default-star">★</span>
        {{ mood.name }}
      </button>
    </div>

    <div class="mood-edit row gap-sm wrap">
      <input
        v-if="selectedMood"
        class="text-input mood-name"
        :value="selectedMood.name"
        title="Rename selected mood"
        @change="rename"
      />
      <button class="btn-sm" title="Create an empty mood" @click="createMood">+ New mood</button>
      <button
        class="btn-sm"
        title="Duplicate the selected mood (params and name)"
        :disabled="!selectedMood"
        @click="duplicateMood()"
      >
        Duplicate
      </button>
      <button
        class="btn-sm"
        :disabled="!selectedMood || selectedMood.id === store.activeScene.defaultMoodId"
        title="Use as the scene default mood"
        @click="selectedMood && setDefaultMood(selectedMood.id)"
      >
        Set default
      </button>
      <button
        class="btn-sm danger"
        :disabled="store.activeScene.moods.length <= 1"
        title="Delete the selected mood"
        @click="removeSelected"
      >
        Delete mood
      </button>
    </div>
  </section>
</template>
