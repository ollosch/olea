<script setup>
import { computed } from 'vue'
import {
  store,
  selectedMood,
  selectMood,
  createMood,
  duplicateMood,
  renameMood,
  deleteMood,
  setDefaultMood,
  beginLearn,
  moodBindingKey,
  isLearning,
  keyLabel,
  removeBinding,
} from '../store.js'

const moodAction = computed(() =>
  selectedMood.value ? { type: 'moodSelect', moodId: selectedMood.value.id } : null
)
const moodKey = computed(() =>
  selectedMood.value ? moodBindingKey(selectedMood.value.id) : ''
)

function learnMood() {
  if (moodAction.value) beginLearn('local', moodAction.value)
}

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
    <div v-if="store.activeScene.moods.length > 1" class="mood-chips">
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
      <span v-if="selectedMood" class="mood-midi row gap-xs">
        <span v-if="moodKey" class="badge">{{ keyLabel(moodKey) }}</span>
        <span v-else class="small muted">mood MIDI: unbound</span>
        <button
          class="btn-xs"
          :class="{ learning: moodAction && isLearning('local', moodAction) }"
          title="Learn a note for this mood"
          @click="learnMood"
        >
          Learn mood key
        </button>
        <button
          v-if="moodKey"
          class="btn-xs danger"
          title="Remove mood binding"
          @click="removeBinding('local', moodKey)"
        >
          ×
        </button>
      </span>
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
