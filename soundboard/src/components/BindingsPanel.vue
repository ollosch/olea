<script setup>
import { computed, ref, watch } from 'vue'
import {
  store,
  paletteEntries,
  bindingRows,
  bindingConflicts,
  beginLearn,
  cancelLearn,
  isLearning,
  removeBinding,
  keyLabel,
  actionLabel,
  closeMidiPanel,
} from '../store.js'
import Modal from './Modal.vue'

const globalType = ref('stopAll')
const globalBus = ref('loop')
const globalPaletteId = ref('')
const globalSceneId = ref('')

watch(
  () => paletteEntries.value,
  (entries) => {
    if (!globalPaletteId.value && entries.length) globalPaletteId.value = entries[0].id
  },
  { immediate: true }
)

watch(
  () => store.scenes,
  (scenes) => {
    if (!globalSceneId.value && scenes.length) globalSceneId.value = scenes[0].id
  },
  { immediate: true }
)

const globalAction = computed(() => {
  switch (globalType.value) {
    case 'stopAll':
      return { type: 'stopAll' }
    case 'masterVolume':
      return { type: 'masterVolume' }
    case 'busVolume':
      return { type: 'busVolume', bus: globalBus.value }
    case 'sceneToggle':
      return { type: 'sceneToggle' }
    case 'paletteTrigger':
      return globalPaletteId.value
        ? { type: 'paletteTrigger', paletteId: globalPaletteId.value }
        : null
    case 'paletteVolume':
      return globalPaletteId.value
        ? { type: 'paletteVolume', paletteId: globalPaletteId.value }
        : null
    case 'openScene':
      return globalSceneId.value ? { type: 'openScene', sceneId: globalSceneId.value } : null
    default:
      return null
  }
})

const globalRows = computed(() => bindingRows('global'))

function learnGlobal() {
  if (globalAction.value) beginLearn('global', globalAction.value)
}
</script>

<template>
  <Modal title="Global MIDI bindings" wide @close="closeMidiPanel">
    <p class="small muted">
      Global bindings work in every scene. Track bindings are set in the selected track's
      inspector; mood keys are set in the mood bar. A key may not silently shadow another binding.
    </p>

    <div v-if="bindingConflicts.length" class="conflict-box">
      <strong>Conflicts on the open scene</strong>
      <div v-for="conflict in bindingConflicts" :key="conflict.key" class="conflict-row">
        <span class="badge danger-badge">{{ keyLabel(conflict.key) }}</span>
        <span class="small">
          global: {{ actionLabel(conflict.globalAction) }} / local:
          {{ actionLabel(conflict.localAction) }}
        </span>
        <div class="row gap-xs">
          <button class="btn-xs" @click="removeBinding('global', conflict.key)">
            Remove global
          </button>
          <button class="btn-xs" @click="removeBinding('local', conflict.key)">
            Remove local
          </button>
        </div>
      </div>
    </div>

    <div class="binding-group">
      <h3>Active global bindings</h3>
      <div v-for="row in globalRows" :key="`g-${row.key}`" class="binding-row">
        <span class="badge">{{ keyLabel(row.key) }}</span>
        <span class="grow small">{{ row.label }}</span>
        <button
          class="btn-xs"
          :class="{ learning: isLearning('global', row.action) }"
          title="Learn a new key for this action"
          @click="beginLearn('global', row.action)"
        >
          Learn
        </button>
        <button class="btn-xs danger" title="Remove binding" @click="removeBinding('global', row.key)">
          ×
        </button>
      </div>
      <div v-if="!globalRows.length" class="small muted">No global bindings yet.</div>

      <div class="binding-form">
        <label class="field">
          <span>Action</span>
          <select v-model="globalType">
            <option value="sceneToggle">Play/stop active scene (note)</option>
            <option value="stopAll">Stop all (note)</option>
            <option value="masterVolume">Master volume (CC)</option>
            <option value="busVolume">Bus volume (CC)</option>
            <option value="paletteTrigger">Palette trigger (note)</option>
            <option value="paletteVolume">Palette volume (CC)</option>
            <option value="openScene">Open scene (note)</option>
          </select>
        </label>
        <label v-if="globalType === 'busVolume'" class="field">
          <span>Bus</span>
          <select v-model="globalBus">
            <option value="loop">Loops</option>
            <option value="random">Random</option>
            <option value="oneshot">One-shots</option>
          </select>
        </label>
        <label
          v-if="globalType === 'paletteTrigger' || globalType === 'paletteVolume'"
          class="field"
        >
          <span>Palette item</span>
          <select v-model="globalPaletteId">
            <option v-for="entry in paletteEntries" :key="entry.id" :value="entry.id">
              {{ entry.label || entry.groupName }}
            </option>
          </select>
        </label>
        <label v-if="globalType === 'openScene'" class="field">
          <span>Scene</span>
          <select v-model="globalSceneId">
            <option v-for="scene in store.scenes" :key="scene.id" :value="scene.id">
              {{ scene.name }}
            </option>
          </select>
        </label>
        <button
          class="btn-sm"
          :disabled="!globalAction"
          :class="{ learning: globalAction && isLearning('global', globalAction) }"
          @click="learnGlobal"
        >
          Learn global
        </button>
        <button v-if="store.learning" class="btn-sm" @click="cancelLearn">Cancel learn</button>
      </div>
    </div>
  </Modal>
</template>
