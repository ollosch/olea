<script setup>
import { ref, computed } from 'vue'
import {
  store,
  elementGainOf,
  isLoopPlaying,
  isOneshotPlaying,
  isRandomActive,
  isLoadingElement,
  toggleLoopElement,
  playOneshotElement,
  stopOneshotElement,
  toggleRandomElement,
  playRandomOnce,
  setElementVolume,
  isVolumeOverridden,
  resetElementVolume,
  learnNote,
  learnCC,
  renameElement,
  hideElement,
  deleteElement,
  elementSource,
} from '../store'

const props = defineProps({
  soundset: { type: Object, required: true },
  element: { type: Object, required: true },
  editing: { type: Boolean, default: false },
})

const emit = defineEmits(['edit'])

const renaming = ref(null)

const source = computed(() => elementSource(props.soundset.id, props.element.id))
const isScanned = computed(() => source.value === 'scanned')
const isEditable = computed(() => source.value !== 'scanned')

const kind = computed(() => props.element.kind)

const displayName = computed(() => props.element.name)
const count = computed(() => props.element.files?.length || 0)
const interval = computed(() =>
  props.element.trigger ? `${props.element.trigger.min}–${props.element.trigger.max}s` : ''
)

const kindLabel = computed(() => (kind.value === 'loop' ? 'loop' : kind.value === 'random' ? 'random' : 'effect'))

function noteAction() {
  return { type: kind.value, soundsetId: props.soundset.id, elementId: props.element.id }
}
function volAction() {
  return { type: 'element', soundsetId: props.soundset.id, elementId: props.element.id }
}

function isLearningNote(action) {
  const l = store.learning
  return (
    !!l &&
    l.mode === 'note' &&
    l.action.type === action.type &&
    l.action.soundsetId === action.soundsetId &&
    (l.action.elementId ?? null) === (action.elementId ?? null)
  )
}
function isLearningCC(action) {
  const l = store.learning
  return (
    !!l &&
    l.mode === 'cc' &&
    l.action.type === action.type &&
    l.action.soundsetId === action.soundsetId &&
    (l.action.elementId ?? null) === (action.elementId ?? null)
  )
}

function beginRename() {
  renaming.value = { value: displayName.value }
}
function commitRename() {
  if (renaming.value && renaming.value.value.trim() && renaming.value.value.trim() !== displayName.value) {
    renameElement(props.soundset.id, props.element.id, renaming.value.value.trim())
  }
  renaming.value = null
}

function primary() {
  if (kind.value === 'loop') toggleLoopElement(props.soundset.id, props.element.id)
  else if (kind.value === 'random') toggleRandomElement(props.soundset.id, props.element.id)
  else playOneshotElement(props.soundset.id, props.element.id)
}

function primaryLabel() {
  if (kind.value === 'loop') return isLoopPlaying(props.soundset, props.element) ? 'Stop' : 'Play'
  if (kind.value === 'random') return isRandomActive(props.soundset, props.element) ? 'On' : 'Off'
  if (isLoadingElement(props.soundset, props.element)) return '…'
  return isOneshotPlaying(props.soundset, props.element) ? 'Playing' : 'Play'
}

const primaryActive = computed(() => {
  if (kind.value === 'loop') return isLoopPlaying(props.soundset, props.element)
  if (kind.value === 'random') return isRandomActive(props.soundset, props.element)
  return isOneshotPlaying(props.soundset, props.element)
})

const showStop = computed(() => kind.value === 'oneshot' && isOneshotPlaying(props.soundset, props.element))
</script>

<template>
  <div class="row el-row">
    <button class="play" :class="{ active: primaryActive }" @click="primary">
      {{ primaryLabel() }}
    </button>
    <button
      v-if="kind === 'random'"
      class="play once"
      title="Play one random sound now"
      @click="playRandomOnce(soundset.id, element.id)"
    >
      once
    </button>
    <button v-if="showStop" class="play stop" @click="stopOneshotElement(soundset.id, element.id)">
      Stop
    </button>

    <span v-if="!renaming" class="el-name grow">
      <span class="kind-tag">{{ kindLabel }}</span>
      {{ displayName }}
      <span v-if="count > 1" class="small muted">({{ count }})</span>
      <span v-if="kind === 'random'" class="small muted">· every {{ interval }}</span>
    </span>
    <input
      v-else
      v-model="renaming.value"
      class="rename-input grow"
      autofocus
      @keydown.enter="commitRename"
      @keydown.esc="renaming = null"
      @blur="commitRename"
    />

    <button
      class="learn reset"
      :class="{ invisible: !isVolumeOverridden(soundset, element) }"
      title="Reset volume to default"
      @click="resetElementVolume(soundset.id, element.id)"
    >
      reset
    </button>

    <input
      class="vol"
      type="range"
      min="0"
      max="2"
      step="0.01"
      :value="elementGainOf(soundset, element)"
      @input="setElementVolume(soundset.id, element.id, Number($event.target.value))"
    />

    <button
      v-if="editing"
      class="learn"
      title="Rename"
      @click="beginRename"
    >
      rename
    </button>

    <button
      class="learn"
      :class="{ active: isLearningNote(noteAction()) }"
      title="Assign pad/key"
      @click="learnNote(noteAction())"
    >
      learn
    </button>
    <button
      class="learn"
      :class="{ active: isLearningCC(volAction()) }"
      title="Assign knob to volume"
      @click="learnCC(volAction())"
    >
      vol
    </button>

    <template v-if="editing">
      <button v-if="isScanned" class="learn" title="Hide from this soundset" @click="hideElement(soundset.id, element.id)">
        hide
      </button>
      <template v-else>
        <button class="learn" title="Edit group" @click="emit('edit', element)">edit</button>
        <button class="learn danger" title="Delete group" @click="deleteElement(soundset.id, element.id)">delete</button>
      </template>
    </template>
  </div>
</template>

<style scoped>
.el-row {
  margin-bottom: 0.4rem;
  flex-wrap: wrap;
}

.el-name {
  overflow-wrap: anywhere;
  min-width: 12rem;
}

.kind-tag {
  font-size: 0.68rem;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0 0.3rem;
  margin-right: 0.35rem;
  vertical-align: middle;
}

.rename-input {
  background: var(--bg-2);
  border: 1px solid var(--accent);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.5rem;
}

.play {
  min-width: 4.5rem;
}

.play.stop {
  min-width: 3.5rem;
}

.play.once {
  min-width: 3.5rem;
  color: var(--accent);
  border-color: var(--accent);
}

.vol {
  width: 150px;
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

.learn.reset {
  color: var(--ok);
  border-color: var(--ok);
}

.learn.reset.invisible {
  visibility: hidden;
}
</style>
