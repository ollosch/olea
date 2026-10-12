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
  createMood,
  updateMood,
  deleteMood,
  learnNote,
  learnCC,
  cancelLearn,
  addElement,
  updateElement,
  unhideElement,
  renameSoundset,
  resetSectionVolume,
} from '../store'
import ElementRow from './ElementRow.vue'
import GroupEditor from './GroupEditor.vue'
import MoodEditor from './MoodEditor.vue'

const props = defineProps({
  soundset: { type: Object, required: true },
})

const editing = ref(false)
const showGroupEditor = ref(false)
const groupBeingEdited = ref(null)
const showMoodEditor = ref(false)
const moodBeingEdited = ref(null)
const renamingSoundset = ref(null)

const loops = computed(() => soundsetElements(props.soundset).loops)
const oneshots = computed(() => soundsetElements(props.soundset).oneshots)
const randoms = computed(() => soundsetElements(props.soundset).randoms)
const moods = computed(() => props.soundset.moods || [])

const hiddenElements = computed(() => {
  const hiddenIds = new Set(props.soundset.hidden || [])
  return (props.soundset.elements || []).filter((el) => hiddenIds.has(el.id))
})

function sameAction(a, b) {
  return (
    a.type === b.type &&
    (a.elementId ?? null) === (b.elementId ?? null) &&
    (a.scope ?? null) === (b.scope ?? null)
  )
}

function isLearningNote(action) {
  const l = store.learning
  return !!l && l.mode === 'note' && sameAction(l.action, action)
}

function isLearningCC(action) {
  const l = store.learning
  return !!l && l.mode === 'cc' && sameAction(l.action, action)
}

function soundsetAction() {
  return { type: 'soundset', scope: 'local' }
}

function masterAction() {
  return { type: 'master', scope: 'global' }
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

function openNewMood() {
  moodBeingEdited.value = null
  showMoodEditor.value = true
}

function openEditMood(m) {
  moodBeingEdited.value = m
  showMoodEditor.value = true
}

function saveMood(def) {
  if (moodBeingEdited.value) {
    updateMood(props.soundset.id, moodBeingEdited.value.id, def)
  } else {
    createMood(props.soundset.id, def.name, def.params)
  }
  showMoodEditor.value = false
  moodBeingEdited.value = null
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
      <h2 v-else class="soundset-name">{{ soundset.name }}</h2>

      <button
        v-if="!renamingSoundset"
        class="learn"
        title="Rename soundscape"
        @click="beginRenameSoundset"
      >
        rename
      </button>

      <button
        class="learn"
        :class="{ active: isLearningNote(soundsetAction()) }"
        title="Assign pad/key to toggle this soundscape"
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
      <button class="primary" @click="openNewMood">+ New mood</button>
      <span class="small muted">Rename, hide, add or remove elements. Hiding keeps the original files.</span>
    </div>

    <section v-if="moods.length || editing" class="block">
      <h3>Moods</h3>
      <div class="row wrap">
        <template v-for="m in moods" :key="m.id">
          <button
            class="mood"
            :class="{ active: store.activeMoodId === m.id }"
            @click="applyMood(soundset.id, m.id)"
          >
            {{ m.name }}
          </button>
          <button v-if="editing" class="learn" title="Edit mood" @click="openEditMood(m)">edit</button>
          <button v-if="editing" class="learn danger" title="Delete mood" @click="deleteMood(soundset.id, m.id)">delete</button>
        </template>
        <span v-if="!moods.length" class="small muted">No moods yet</span>
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
            :value="store.global.buses.loop"
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
            :value="store.global.buses.random"
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
      <p v-if="!randoms.length" class="muted small">No random elements</p>
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
            :value="store.global.buses.effects"
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
          :class="{ active: isLearningCC(masterAction()) }"
          title="Assign knob"
          @click="learnCC(masterAction())"
        >
          learn master
        </button>
      </div>
    </section>

    <GroupEditor
      v-if="showGroupEditor"
      :soundset="soundset"
      :element="groupBeingEdited"
      @save="saveGroup"
      @cancel="showGroupEditor = false; groupBeingEdited = null"
    />

    <MoodEditor
      v-if="showMoodEditor"
      :soundset="soundset"
      :mood="moodBeingEdited"
      @save="saveMood"
      @cancel="showMoodEditor = false; moodBeingEdited = null"
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

.learn.danger {
  color: var(--danger);
  border-color: var(--danger);
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
