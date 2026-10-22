<script setup>
import { computed, ref } from 'vue'
import {
  store,
  elementGainOf,
  isVolumeOverridden,
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
  resetElementVolume,
  learnNote,
  learnCC,
  bindingLabel,
  renameElement,
  hideElement,
  deleteElement,
  pinToPalette,
} from '../store'
import { sameAction } from '../../lib/bindings.js'

const props = defineProps({
  soundset: { type: Object, required: true },
  element: { type: Object, required: true },
  editing: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  selectable: { type: Boolean, default: true },
})

const emit = defineEmits(['edit', 'update:selected', 'promote'])

const renaming = ref(null)

const kind = computed(() => props.element.kind)
const displayName = computed(() => props.element.name || 'Unnamed')
const count = computed(() => props.element.files?.length || 0)
const gain = computed(() => elementGainOf(props.soundset, props.element))
const overridden = computed(() => isVolumeOverridden(props.soundset, props.element))
const origin = computed(() => (props.element.source === 'library' ? 'Library' : 'Scene'))
const isLibrary = computed(() => props.element.source === 'library')

const kindLabel = computed(() =>
  kind.value === 'loop' ? 'Loop' : kind.value === 'random' ? 'Random' : 'Effect'
)

const randomiseLabel = computed(() => {
  if (props.element.randomise === 'shuffle') return 'shuffle'
  if (props.element.randomise === 'random') return 'random'
  return 'in order'
})

const interval = computed(() => {
  const t = props.element.trigger
  if (!t) return ''
  const min = Number(t.min) || 0
  const max = Number(t.max) || 0
  if (!min && !max) return ''
  return `${min}–${max}s`
})

const hasInterval = computed(() => interval.value !== '')

const playing = computed(() => {
  if (kind.value === 'loop') return isLoopPlaying(props.soundset, props.element)
  if (kind.value === 'random') return isRandomActive(props.soundset, props.element)
  return isOneshotPlaying(props.soundset, props.element)
})

const loading = computed(() => isLoadingElement(props.soundset, props.element))
const showStop = computed(
  () => kind.value === 'oneshot' && isOneshotPlaying(props.soundset, props.element)
)

const primaryLabel = computed(() => {
  if (kind.value === 'loop') return playing.value ? 'Stop' : 'Play'
  if (kind.value === 'random') return playing.value ? 'On' : 'Off'
  if (loading.value) return '…'
  return playing.value ? 'Playing' : 'Play'
})

function pct(value) {
  const n = Number(value)
  return `${Math.round((Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0) * 100)}%`
}

function noteAction() {
  return { type: kind.value, elementId: props.element.id, scope: 'local' }
}

function volAction() {
  return { type: 'element', elementId: props.element.id, scope: 'local' }
}

function isLearningNote(action) {
  return (
    !!store.learning &&
    store.learning.mode === 'note' &&
    sameAction(store.learning.action, action)
  )
}

function isLearningCC(action) {
  return (
    !!store.learning &&
    store.learning.mode === 'cc' &&
    sameAction(store.learning.action, action)
  )
}

const noteLabel = computed(() => bindingLabel(noteAction(), 'note'))
const ccLabel = computed(() => bindingLabel(volAction(), 'cc'))

function primary() {
  if (kind.value === 'loop') toggleLoopElement(props.soundset.id, props.element.id)
  else if (kind.value === 'random') toggleRandomElement(props.soundset.id, props.element.id)
  else playOneshotElement(props.soundset.id, props.element.id)
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

function setSelected(event) {
  emit('update:selected', !!event.target.checked)
}

function hide() {
  hideElement(props.soundset.id, props.element.id)
}

function remove() {
  if (!window.confirm(`Delete "${displayName.value}" from this scene?`)) return
  deleteElement(props.soundset.id, props.element.id)
}

function pin() {
  if (props.element.libraryId) pinToPalette(props.element.libraryId)
}
</script>

<template>
  <div class="row el-row" :class="{ selected }">
    <label
      v-if="editing"
      class="select"
      :title="
        selectable
          ? 'Select for bulk actions'
          : 'Library includes cannot be merged, reclassified or promoted here'
      "
    >
      <input
        type="checkbox"
        :checked="selected"
        :disabled="!selectable"
        @change="setSelected"
      />
    </label>

    <button class="play" :class="{ active: playing }" @click="primary">
      {{ primaryLabel }}
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
      <span class="tag kind">{{ kindLabel }}</span>
      <span class="tag origin" :class="{ library: isLibrary }">{{ origin }}</span>
      <span v-if="element.reverb" class="tag reverb">{{ element.reverb }}</span>
      <span class="name-text">{{ displayName }}</span>
      <span v-if="kind === 'loop'" class="small muted">
        · {{ count }} track{{ count === 1 ? '' : 's' }} · {{ randomiseLabel }}
      </span>
      <span v-else-if="kind === 'random' && hasInterval" class="small muted">
        · every {{ interval }}
      </span>
      <span v-else-if="kind === 'oneshot' && count > 1" class="small muted">· {{ count }}</span>
      <span v-if="loading" class="small muted">· loading…</span>
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

    <div class="vol-wrap">
      <input
        class="vol"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="gain"
        :title="`Volume ${pct(gain)}`"
        @input="setElementVolume(soundset.id, element.id, Number($event.target.value))"
      />
      <span class="pct">{{ pct(gain) }}</span>
      <button
        class="learn reset"
        :disabled="!overridden"
        title="Reset volume to the scene/mood default"
        @click="resetElementVolume(soundset.id, element.id)"
      >
        reset
      </button>
    </div>

    <button
      class="learn"
      :class="{ active: isLearningNote(noteAction()) }"
      :title="noteLabel ? `Note ${noteLabel} — click to re-learn` : 'Assign a pad/key'"
      @click="learnNote(noteAction())"
    >
      {{ noteLabel || 'note' }}
    </button>
    <button
      class="learn"
      :class="{ active: isLearningCC(volAction()) }"
      :title="ccLabel ? `${ccLabel} — click to re-learn` : 'Assign a knob to volume'"
      @click="learnCC(volAction())"
    >
      {{ ccLabel || 'vol' }}
    </button>

    <template v-if="editing">
      <button
        v-if="!isLibrary"
        class="learn"
        title="Rename this scene element"
        @click="beginRename"
      >
        rename
      </button>
      <button class="learn" title="Edit group" @click="emit('edit', element)">edit</button>
      <button class="learn" title="Hide from this scene" @click="hide">hide</button>
      <button
        v-if="!isLibrary"
        class="learn"
        title="Move files to the library and replace this element with an include"
        @click="emit('promote', element)"
      >
        promote
      </button>
      <button
        v-if="isLibrary && element.libraryId"
        class="learn"
        title="Pin this library group to the global palette"
        @click="pin"
      >
        pin
      </button>
      <button class="learn danger" title="Delete from this scene" @click="remove">delete</button>
    </template>
  </div>
</template>

<style scoped>
.el-row {
  margin-bottom: 0.4rem;
  flex-wrap: wrap;
}

.el-row.selected {
  outline: 1px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

.select {
  display: flex;
  align-items: center;
}

.el-name {
  overflow-wrap: anywhere;
  min-width: 12rem;
}

.name-text {
  font-weight: 550;
}

.tag {
  display: inline-block;
  font-size: 0.68rem;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0 0.3rem;
  margin-right: 0.3rem;
  vertical-align: middle;
  white-space: nowrap;
}

.tag.kind {
  color: var(--accent);
  border-color: var(--accent);
}

.tag.origin.library {
  color: var(--ok);
  border-color: var(--ok);
}

.tag.reverb {
  font-style: italic;
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

.vol-wrap {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.vol {
  width: 140px;
}

.pct {
  font-size: 0.72rem;
  color: var(--text-dim);
  min-width: 2.6rem;
  text-align: right;
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

.learn.reset:disabled {
  opacity: 0.3;
}

@media (max-width: 720px) {
  .vol {
    width: 110px;
  }
}
</style>
