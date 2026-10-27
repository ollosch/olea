<script setup>
import { ref } from 'vue'
import {
  store,
  createScene,
  openScene,
  deleteScene,
  setSceneDisabled,
} from '../store.js'

const newName = ref('')

async function create() {
  const name = newName.value.trim()
  if (!name) return
  await createScene(name)
  newName.value = ''
}

function remove(scene) {
  if (!window.confirm(`Delete scene "${scene.name}"? This cannot be undone.`)) return
  deleteScene(scene.id)
}
</script>

<template>
  <div class="browser-pane">
    <form class="stack" @submit.prevent="create">
      <label class="field">
        <span>New scene</span>
        <input v-model="newName" type="text" class="text-input" placeholder="Scene name" />
      </label>
      <button class="btn-primary" type="submit" :disabled="!newName.trim()">Create scene</button>
    </form>

    <ul class="scene-list">
      <li
        v-for="scene in store.scenes"
        :key="scene.id"
        class="scene-item"
        :class="{ active: store.activeScene?.id === scene.id, disabled: scene.disabled }"
      >
        <button class="scene-open" :title="`Open ${scene.name}`" @click="openScene(scene.id)">
          <span class="scene-name">{{ scene.name }}</span>
          <span class="small muted">{{ scene.trackCount }} tracks · {{ scene.moodCount }} moods</span>
          <span v-if="scene.disabled" class="badge">disabled</span>
        </button>
        <div class="scene-item-actions">
          <button
            class="btn-xs"
            :title="scene.disabled ? 'Enable scene' : 'Disable scene'"
            @click="setSceneDisabled(scene.id, !scene.disabled)"
          >
            {{ scene.disabled ? 'Enable' : 'Disable' }}
          </button>
          <button class="btn-xs danger" title="Delete scene" @click="remove(scene)">×</button>
        </div>
      </li>
      <li v-if="!store.scenes.length" class="empty-mini">No scenes yet. Create one above.</li>
    </ul>
  </div>
</template>
