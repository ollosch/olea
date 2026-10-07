<script setup>
import { computed, ref } from 'vue'
import {
  store,
  startLoops,
  stopLoops,
  startRandoms,
  stopRandoms,
  stopEffects,
  setLoopsVolume,
  setRandomsVolume,
  setEffectsVolume,
  leaveSoundset,
  soundsetElements,
  applyMood,
  learnNote,
  learnCC,
  cancelLearn,
  clearMapping,
  addElement,
  updateElement,
  unhideElement,
  isCustomSoundset,
  renameSoundset,
  resetSectionVolume,
} from '../store'
import ElementRow from './ElementRow.vue'
import GroupEditor from './GroupEditor.vue'

const props = defineProps({
  soundset: { type: Object, required: true },
})

const editing = ref(false)
const showGroupEditor = ref(false)
const groupBeingEdited = ref(null)
const renamingSoundset = ref(null)

const loops = computed(() => soundsetElements(props.soundset).loops)
const oneshots = computed(() => soundsetElements(props.soundset).oneshots)
const randoms = computed(() => soundsetElements(props.soundset).randoms)
const moods = computed(() => props.soundset.moods || [])
const custom = computed(() => isCustomSoundset(props.soundset.id))

const hiddenElements = computed(() => {
  const raw = store.rawSoundsets.find((s) => s.id === props.soundset.id)
  if (!raw) return []
  const hiddenIds = new Set(store.overlay.hidden[props.soundset.id] || [])
  return raw.elements.filter((el) => hiddenIds.has(el.id))
})

function soundsetAction() {
  return { type: 'soundset', soundsetId: props.soundset.id }
}

function isLearningNote(action) {
  const l = store.learning
  return !!l && l.mode === 'note' && l.action.type === action.type && l.action.soundsetId === action.soundsetId
}

function isLearningCC(action) {
  const l = store.learning
  return !!l && l.mode === 'cc' && l.action.type === action.type
}

function openNewGroup() {
  groupBeingEdited.value = null
  showGroupEditor.value = true
}

function openEditGroup(el) {
  groupBeingEdited.value = el
  showGroupEditor.value = true
}

function saveGroup(def) {
  if (groupBeingEdited.value) updateElement(props.soundset.id, groupBeingEdited.value.id, def)
  else addElement(props.soundset.id, def)
  showGroupEditor.value = false
  groupBeingEdited.value = null
}

function beginRenameSoundset() {
  renamingSoundset.value = { value: props.soundset.name }
}

function commitRenameSoundset() {
  if (renamingSoundset.value && renamingSoundset.value.value.trim()) {
    renameSoundset(props.soundset.id, renamingSoundset.value.value.trim())
  }
  renamingSoundset.value = null
}
</script>

<template>
  <section>
    <div class="row header">
      <input
        v-if="renamingSoundset"
        v-model="renamingSoundset.value"
        class="rename-input"
        autofocus
        @keydown.enter="commitRenameSoundset"
        @keydown.esc="renamingSoundset = null"
        @blur="commitRenameSoundset"
      />
      <h2 v-else class="soundset-name">
        {{ soundset.name }}
        <span v-if="custom" class="tag">custom</span>
      </h2>

      <button
        v-if="custom && editing"
        class="learn"
        title="Rename soundscape"
        @click="beginRenameSoundset"
      >
        rename
      </button>

      <button
        class="learn"
        :class="{ active: isLearningNote(soundsetAction()) }"
        title="Assign pad/key"
        @click="learnNote(soundsetAction())"
      >
        learn
      </button>
      <div class="grow"></div>

      <div class="transport">
        <template v-if="loops.length">
          <button class="primary" :disabled="store.loopsPlaying" @click="startLoops()">Start loops</button>
          <button class="danger" :disabled="!store.loopsPlaying" @click="stopLoops()">Stop loops</button>
        </template>
        <template v-if="randoms.length">
          <button class="primary" :disabled="store.randomsPlaying" @click="startRandoms()">Start random</button>
          <button class="danger" :disabled="!store.randomsPlaying" @click="stopRandoms()">Stop random</button>
        </template>
        <button class="danger" @click="stopEffects()">Stop effects</button>
      </div>

      <button :class="{ active: editing }" @click="editing = !editing">Edit</button>
      <button @click="leaveSoundset()">← Library</button>
    </div>

    <div v-if="store.learning" class="banner">
      <span>Learning — press a pad/key (or turn a knob)…</span>
      <button class="danger" @click="cancelLearn()">Cancel</button>
    </div>

    <div v-if="editing" class="editbar">
      <button class="primary" @click="openNewGroup">+ Add group</button>
      <span class="small muted">Rename, hide, add or remove elements. Hiding keeps the original files.</span>
    </div>

    <section v-if="moods.length" class="block">
      <h3>Moods</h3>
      <div class="row wrap">
        <button v-for="(m, i) in moods" :key="m.name" class="mood" @click="applyMood(soundset.id, i)">
          {{ m.name }}
        </button>
      </div>
    </section>

    <section class="block">
      <div class="row section-head">
        <h3>Loops</h3>
        <label class="bus">
          <span class="small muted">vol</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            :value="store.loopsVolume"
            @input="setLoopsVolume(Number($event.target.value))"
          />
        </label>
        <span class="small muted">{{ loops.length }} element{{ loops.length === 1 ? '' : 's' }}</span>
        <div class="grow"></div>
        <button class="learn" title="Reset all loop volumes to defaults" @click="resetSectionVolume(soundset.id, 'loop')">
          reset volumes
        </button>
      </div>
      <ElementRow
        v-for="el in loops"
        :key="el.id"
        :soundset="soundset"
        :element="el"
        :editing="editing"
        @edit="openEditGroup"
      />
      <p v-if="!loops.length" class="muted small">No loop elements</p>
    </section>

    <section class="block">
      <div class="row section-head">
        <h3>Random</h3>
        <label class="bus">
          <span class="small muted">vol</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            :value="store.randomsVolume"
            @input="setRandomsVolume(Number($event.target.value))"
          />
        </label>
        <span class="small muted">auto-triggered while the soundset plays</span>
        <div class="grow"></div>
        <button class="learn" title="Reset all random volumes to defaults" @click="resetSectionVolume(soundset.id, 'random')">
          reset volumes
        </button>
      </div>
      <ElementRow
        v-for="el in randoms"
        :key="el.id"
        :soundset="soundset"
        :element="el"
        :editing="editing"
        @edit="openEditGroup"
      />
    </section>

    <section class="block">
      <div class="row section-head">
        <h3>Effects</h3>
        <label class="bus">
          <span class="small muted">vol</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            :value="store.effectsVolume"
            @input="setEffectsVolume(Number($event.target.value))"
          />
        </label>
        <span class="small muted">{{ oneshots.length }} element{{ oneshots.length === 1 ? '' : 's' }}</span>
        <div class="grow"></div>
        <button class="learn" title="Reset all effect volumes to defaults" @click="resetSectionVolume(soundset.id, 'oneshot')">
          reset volumes
        </button>
        <button class="danger" @click="stopEffects()">Stop effects</button>
      </div>
      <ElementRow
        v-for="el in oneshots"
        :key="el.id"
        :soundset="soundset"
        :element="el"
        :editing="editing"
        @edit="openEditGroup"
      />
      <p v-if="!oneshots.length" class="muted small">No effect elements</p>
    </section>

    <section v-if="editing && hiddenElements.length" class="block">
      <h3>Hidden</h3>
      <div v-for="el in hiddenElements" :key="el.id" class="row hidden-row">
        <span class="muted grow">{{ el.name }}</span>
        <button class="learn" @click="unhideElement(soundset.id, el.id)">unhide</button>
      </div>
    </section>

    <section class="block">
      <div class="row midi-row">
        <h3 class="midi-title">MIDI</h3>
        <div class="grow"></div>
        <button
          class="learn"
          :class="{ active: isLearningCC({ type: 'master' }) }"
          title="Assign knob"
          @click="learnCC({ type: 'master' })"
        >
          learn master
        </button>
        <button class="danger" @click="clearMapping()">Clear mapping</button>
      </div>
    </section>

    <GroupEditor
      v-if="showGroupEditor"
      :element="groupBeingEdited"
      @save="saveGroup"
      @cancel="showGroupEditor = false; groupBeingEdited = null"
    />
  </section>
</template>

<style scoped>
.header {
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.transport {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.soundset-name {
  margin: 0;
}

.tag {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 0 0.3rem;
  vertical-align: middle;
}

.rename-input {
  background: var(--bg-2);
  border: 1px solid var(--accent);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.5rem;
  font-size: 1rem;
  font-weight: 650;
}

.block {
  margin-top: 1.25rem;
}

.section-head {
  gap: 0.5rem;
  flex-wrap: wrap;
}

.bus {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 160px;
}

.bus input {
  flex: 1;
}

.banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  background: var(--bg-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 0.6rem 0.9rem;
  margin-bottom: 1rem;
}

.editbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 0.5rem;
}

.learn {
  padding: 0.3rem 0.5rem;
  font-size: 0.75rem;
  white-space: nowrap;
}

.hidden-row {
  padding: 0.2rem 0;
}

.midi-row {
  gap: 0.75rem;
}

.midi-title {
  margin: 0;
}

.wrap {
  flex-wrap: wrap;
}

.mood {
  font-size: 0.85rem;
}
</style>
