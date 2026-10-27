<script setup>
import { computed, ref, watch } from 'vue'
import {
  store,
  currentPlan,
  paletteEntries,
  bindingRows,
  bindingConflicts,
  beginLearn,
  cancelLearn,
  isLearning,
  removeBinding,
  keyLabel,
  actionLabel,
} from '../store.js'

const globalType = ref('stopAll')
const globalBus = ref('loop')
const globalPaletteId = ref('')
const globalSceneId = ref('')

const localType = ref('trackTrigger')
const localTrackId = ref('')
const localMoodId = ref('')

watch(
  () => store.activeScene?.id,
  () => {
    localTrackId.value = currentPlan.value.all[0]?.trackId || ''
    localMoodId.value = store.selectedMoodId || ''
  },
  { immediate: true }
)

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

const localAction = computed(() => {
  switch (localType.value) {
    case 'trackTrigger':
      return localTrackId.value ? { type: 'trackTrigger', trackId: localTrackId.value } : null
    case 'trackVolume':
      return localTrackId.value ? { type: 'trackVolume', trackId: localTrackId.value } : null
    case 'moodSelect':
      return localMoodId.value ? { type: 'moodSelect', moodId: localMoodId.value } : null
    case 'sceneToggle':
      return { type: 'sceneToggle' }
    default:
      return null
  }
})

const globalRows = computed(() => bindingRows('global'))
const localRows = computed(() => bindingRows('local'))

function learnGlobal() {
  if (globalAction.value) beginLearn('global', globalAction.value)
}

function learnLocal() {
  if (localAction.value) beginLearn('local', localAction.value)
}
</script>

<template>
  <section class="bindings-panel">
    <header class="inspector-head">
      <h2>MIDI bindings</h2>
      <button
        v-if="store.learning"
        class="btn-xs"
        title="Cancel MIDI learn"
        @click="cancelLearn"
      >
        Cancel learn
      </button>
    </header>
    <p class="small muted">
      Global bindings work in every scene. Scene-local bindings only work while this scene is
      open. A key may not silently shadow another binding.
    </p>

    <div v-if="bindingConflicts.length" class="conflict-box">
      <strong>Conflicts on this scene</strong>
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
      <h3>Global</h3>
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
      <div v-if="!globalRows.length" class="small muted">No global bindings.</div>

      <div class="binding-form">
        <label class="field">
          <span>Action</span>
          <select v-model="globalType">
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
      </div>
    </div>

    <div class="binding-group">
      <h3>Scene-local</h3>
      <div v-for="row in localRows" :key="`l-${row.key}`" class="binding-row">
        <span class="badge">{{ keyLabel(row.key) }}</span>
        <span class="grow small">{{ row.label }}</span>
        <button
          class="btn-xs"
          :class="{ learning: isLearning('local', row.action) }"
          title="Learn a new key for this action"
          @click="beginLearn('local', row.action)"
        >
          Learn
        </button>
        <button class="btn-xs danger" title="Remove binding" @click="removeBinding('local', row.key)">
          ×
        </button>
      </div>
      <div v-if="!localRows.length" class="small muted">No local bindings.</div>

      <div v-if="store.activeScene" class="binding-form">
        <label class="field">
          <span>Action</span>
          <select v-model="localType">
            <option value="trackTrigger">Track trigger (note)</option>
            <option value="trackVolume">Track volume (CC)</option>
            <option value="moodSelect">Select mood (note)</option>
            <option value="sceneToggle">Play/stop scene (note)</option>
          </select>
        </label>
        <label
          v-if="localType === 'trackTrigger' || localType === 'trackVolume'"
          class="field"
        >
          <span>Track</span>
          <select v-model="localTrackId">
            <option v-for="track in currentPlan.all" :key="track.trackId" :value="track.trackId">
              {{ track.groupName }} ({{ track.kind }})
            </option>
          </select>
        </label>
        <label v-if="localType === 'moodSelect'" class="field">
          <span>Mood</span>
          <select v-model="localMoodId">
            <option v-for="mood in store.activeScene.moods" :key="mood.id" :value="mood.id">
              {{ mood.name }}
            </option>
          </select>
        </label>
        <button
          class="btn-sm"
          :disabled="!localAction"
          :class="{ learning: localAction && isLearning('local', localAction) }"
          @click="learnLocal"
        >
          Learn local
        </button>
      </div>
      <div v-else class="small muted">Open a scene to manage local bindings.</div>
    </div>
  </section>
</template>
