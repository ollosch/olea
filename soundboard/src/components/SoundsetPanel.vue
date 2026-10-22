<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  store,
  startLoops,
  stopLoops,
  startRandoms,
  stopRandoms,
  stopEffects,
  setBusVolume,
  leaveSoundset,
  soundsetElements,
  resolvedSceneElements,
  sceneWarnings,
  applyMood,
  createMood,
  updateMood,
  deleteMood,
  learnNote,
  learnCC,
  cancelLearn,
  bindingLabel,
  addElement,
  updateElement,
  addIncludeToScene,
  mergeSceneElements,
  reclassifyElements,
  promoteToLibrary,
  findLibraryGroup,
  unhideElement,
  renameSoundset,
} from '../store'
import { sameAction } from '../../lib/bindings.js'
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
const libraryPick = ref('')
const reclassKind = ref('loop')
const reclassMin = ref(10)
const reclassMax = ref(30)
const reclassStartMin = ref(2)
const reclassStartMax = ref(10)
const actionWarnings = ref([])
const selected = reactive(new Set())

const loops = computed(() => soundsetElements(props.soundset).loops)
const oneshots = computed(() => soundsetElements(props.soundset).oneshots)
const randoms = computed(() => soundsetElements(props.soundset).randoms)
const moods = computed(() => props.soundset.moods || [])
const warnings = computed(() => sceneWarnings(props.soundset))
const libraryGroups = computed(() => store.library?.groups || [])

const sceneRows = computed(() =>
  resolvedSceneElements(props.soundset).filter((el) => el.source === 'scene')
)
const selectedIds = computed(() =>
  sceneRows.value.filter((el) => selected.has(el.id)).map((el) => el.id)
)
const selectedCount = computed(() => selectedIds.value.length)

watch(sceneRows, (rows) => {
  const live = new Set(rows.map((el) => el.id))
  for (const id of Array.from(selected)) {
    if (!live.has(id)) selected.delete(id)
  }
})

const hiddenElements = computed(() => {
  const ids = new Set(props.soundset.hidden || [])
  const rows = []
  for (const el of props.soundset.elements || []) {
    if (ids.has(el.id)) rows.push({ id: el.id, name: el.name || 'Unnamed' })
  }
  for (const include of props.soundset.includes || []) {
    if (!ids.has(include.id)) continue
    const group = findLibraryGroup(include.libraryId)
    rows.push({
      id: include.id,
      name: group ? group.name : `Missing library group (${include.libraryId})`,
    })
  }
  return rows
})

function pct(value) {
  const n = Number(value)
  return `${Math.round((Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0) * 100)}%`
}

function busVolume(bus) {
  return store.global?.buses?.[bus] ?? 1
}

function busAction(bus) {
  return { type: 'bus', bus, scope: 'global' }
}

function soundsetAction() {
  return { type: 'soundset', scope: 'local' }
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

function toggleSelected(element, value) {
  if (!element || element.source !== 'scene') return
  if (value) selected.add(element.id)
  else selected.delete(element.id)
}

function clearSelection() {
  selected.clear()
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

function openEditMood(mood) {
  moodBeingEdited.value = mood
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

function removeMood(mood) {
  if (window.confirm(`Delete mood "${mood.name}"?`)) deleteMood(props.soundset.id, mood.id)
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

function addFromLibrary() {
  if (!libraryPick.value) return
  addIncludeToScene(props.soundset.id, libraryPick.value)
  libraryPick.value = ''
}

function mergeSelected() {
  const ids = selectedIds.value
  if (ids.length < 2) return
  const result = mergeSceneElements(props.soundset.id, ids, 'loop')
  actionWarnings.value = result?.warnings || []
  selected.clear()
}

function applyReclassify() {
  const ids = selectedIds.value
  if (!ids.length) return
  const patch = { kind: reclassKind.value }
  if (reclassKind.value === 'random') {
    patch.trigger = {
      min: Number(reclassMin.value) || 0,
      max: Number(reclassMax.value) || 0,
      startMin: Number(reclassStartMin.value) || 0,
      startMax: Number(reclassStartMax.value) || 0,
    }
  }
  reclassifyElements(props.soundset.id, ids, patch)
  actionWarnings.value = []
}

async function promoteSelected() {
  const ids = selectedIds.value
  if (!ids.length) return
  const category = window.prompt('Library category for the promoted group(s):', 'Imported')
  if (category == null) return

  const errors = []
  for (const id of ids) {
    const row = sceneRows.value.find((el) => el.id === id)
    const result = await promoteToLibrary(props.soundset.id, id, category.trim())
    if (!result || result.ok === false) {
      errors.push(
        `${row?.name || id}: ${result?.error || result?.warnings?.join(', ') || 'promotion failed'}`
      )
    }
  }
  selected.clear()
  actionWarnings.value = errors
}

async function promoteOne(element) {
  const category = window.prompt(
    `Library category for "${element.name}":`,
    'Imported'
  )
  if (category == null) return
  const result = await promoteToLibrary(props.soundset.id, element.id, category.trim())
  if (!result || result.ok === false) {
    actionWarnings.value = [
      `${element.name}: ${result?.error || result?.warnings?.join(', ') || 'promotion failed'}`,
    ]
  } else {
    actionWarnings.value = []
  }
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
        {{ bindingLabel(soundsetAction(), 'note') || 'note' }}
      </button>

      <div class="grow"></div>

      <div class="transport">
        <template v-if="loops.length">
          <button class="primary" :disabled="store.loopsPlaying" @click="startLoops()">
            Start loops
          </button>
          <button class="danger" :disabled="!store.loopsPlaying" @click="stopLoops()">
            Stop loops
          </button>
        </template>
        <template v-if="randoms.length">
          <button class="primary" :disabled="store.randomsPlaying" @click="startRandoms()">
            Start random
          </button>
          <button class="danger" :disabled="!store.randomsPlaying" @click="stopRandoms()">
            Stop random
          </button>
        </template>
        <button
          v-if="oneshots.length"
          class="danger"
          title="Stop all effect one-shots"
          @click="stopEffects()"
        >
          Stop effects
        </button>
      </div>

      <button :class="{ active: editing }" @click="editing = !editing">Edit</button>
      <button @click="leaveSoundset()">← Scenes</button>
    </div>

    <div v-if="warnings.length" class="banner warning">
      <strong>Missing library groups</strong>
      <span v-for="(w, i) in warnings" :key="i">
        {{ w.name || 'Unnamed include' }} ({{ w.libraryId }})
      </span>
    </div>

    <div v-if="store.learning" class="banner">
      <span>Learning — press a pad/key (or turn a knob)…</span>
      <button class="danger" @click="cancelLearn()">Cancel</button>
    </div>

    <div v-if="actionWarnings.length" class="banner warning">
      <strong>Notice</strong>
      <span v-for="(w, i) in actionWarnings" :key="i">{{ w }}</span>
      <button class="learn" @click="actionWarnings = []">dismiss</button>
    </div>

    <div v-if="editing" class="editbar">
      <button class="primary" @click="openNewGroup">+ New group</button>
      <button class="primary" @click="openNewMood">+ New mood</button>

      <div class="inline">
        <select v-model="libraryPick" class="text-input" title="Add a library group to this scene">
          <option value="">Add from library…</option>
          <option v-for="group in libraryGroups" :key="group.id" :value="group.id">
            {{ group.name }} ({{ group.kind }})
          </option>
        </select>
        <button :disabled="!libraryPick" @click="addFromLibrary">Add</button>
      </div>

      <div class="grow"></div>

      <span class="small muted">{{ selectedCount }} selected</span>
      <button class="learn" :disabled="!selectedCount" @click="clearSelection">clear</button>
      <button
        class="learn"
        :disabled="selectedCount < 2"
        title="Merge selected scene elements into one loop playlist"
        @click="mergeSelected"
      >
        Merge → loop
      </button>

      <div class="inline">
        <select v-model="reclassKind" class="text-input" title="Set selected elements' kind">
          <option value="loop">Loop</option>
          <option value="random">Random</option>
          <option value="oneshot">Effect</option>
        </select>
        <template v-if="reclassKind === 'random'">
          <label class="mini-field">
            <span>every min</span>
            <input v-model.number="reclassMin" type="number" min="0" step="1" class="text-input" />
          </label>
          <label class="mini-field">
            <span>max</span>
            <input v-model.number="reclassMax" type="number" min="0" step="1" class="text-input" />
          </label>
          <label class="mini-field">
            <span>first min</span>
            <input
              v-model.number="reclassStartMin"
              type="number"
              min="0"
              step="1"
              class="text-input"
            />
          </label>
          <label class="mini-field">
            <span>max</span>
            <input
              v-model.number="reclassStartMax"
              type="number"
              min="0"
              step="1"
              class="text-input"
            />
          </label>
        </template>
        <button :disabled="!selectedCount" @click="applyReclassify">Reclassify</button>
      </div>

      <button :disabled="!selectedCount" @click="promoteSelected">Promote selected</button>
    </div>

    <section v-if="editing" class="block">
      <div class="row section-head">
        <h3>Moods</h3>
        <span v-if="store.activeMoodId && moods.some((m) => m.id === store.activeMoodId)" class="small muted">
          active: {{ moods.find((m) => m.id === store.activeMoodId)?.name }}
        </span>
        <div class="grow"></div>
        <button class="primary" @click="openNewMood">+ New mood</button>
      </div>
      <div class="row wrap">
        <template v-for="m in moods" :key="m.id">
          <button
            class="mood"
            :class="{ active: store.activeMoodId === m.id }"
            :title="`Apply mood ${m.name}`"
            @click="applyMood(soundset.id, m.id)"
          >
            {{ m.name }}
          </button>
          <button class="learn" title="Edit mood" @click="openEditMood(m)">edit</button>
          <button class="learn danger" title="Delete mood" @click="removeMood(m)">delete</button>
        </template>
        <span v-if="!moods.length" class="small muted">No moods yet</span>
      </div>
    </section>

    <section v-else-if="moods.length" class="block">
      <div class="row section-head">
        <h3>Moods</h3>
        <span v-if="store.activeMoodId && moods.some((m) => m.id === store.activeMoodId)" class="small muted">
          active: {{ moods.find((m) => m.id === store.activeMoodId)?.name }}
        </span>
      </div>
      <div class="row wrap">
        <button
          v-for="m in moods"
          :key="m.id"
          class="mood"
          :class="{ active: store.activeMoodId === m.id }"
          @click="applyMood(soundset.id, m.id)"
        >
          {{ m.name }}
        </button>
      </div>
    </section>

    <section class="block">
      <div class="row section-head">
        <h3>Loops</h3>
        <label class="bus">
          <span class="small muted">bus</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="busVolume('loop')"
            @input="setBusVolume('loop', Number($event.target.value))"
          />
          <span class="bus-pct">{{ pct(busVolume('loop')) }}</span>
        </label>
        <button
          class="learn"
          :class="{ active: isLearningCC(busAction('loop')) }"
          title="Assign a knob to the loop bus"
          @click="learnCC(busAction('loop'))"
        >
          {{ bindingLabel(busAction('loop'), 'cc') || 'LEARN' }}
        </button>
        <button class="learn" title="Reset loop bus to 100%" @click="setBusVolume('loop', 1)">
          100%
        </button>
        <span class="small muted">{{ loops.length }} element{{ loops.length === 1 ? '' : 's' }}</span>
        <div class="grow"></div>
      </div>
      <ElementRow
        v-for="el in loops"
        :key="el.id"
        :soundset="soundset"
        :element="el"
        :editing="editing"
        :selected="selected.has(el.id)"
        :selectable="el.source === 'scene'"
        @edit="openEditGroup"
        @update:selected="toggleSelected(el, $event)"
        @promote="promoteOne"
      />
      <p v-if="!loops.length" class="muted small">No loop elements</p>
    </section>

    <section class="block">
      <div class="row section-head">
        <h3>Random</h3>
        <label class="bus">
          <span class="small muted">bus</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="busVolume('random')"
            @input="setBusVolume('random', Number($event.target.value))"
          />
          <span class="bus-pct">{{ pct(busVolume('random')) }}</span>
        </label>
        <button
          class="learn"
          :class="{ active: isLearningCC(busAction('random')) }"
          title="Assign a knob to the random bus"
          @click="learnCC(busAction('random'))"
        >
          {{ bindingLabel(busAction('random'), 'cc') || 'LEARN' }}
        </button>
        <button class="learn" title="Reset random bus to 100%" @click="setBusVolume('random', 1)">
          100%
        </button>
        <span class="small muted">auto-triggered while the scene plays</span>
        <div class="grow"></div>
      </div>
      <ElementRow
        v-for="el in randoms"
        :key="el.id"
        :soundset="soundset"
        :element="el"
        :editing="editing"
        :selected="selected.has(el.id)"
        :selectable="el.source === 'scene'"
        @edit="openEditGroup"
        @update:selected="toggleSelected(el, $event)"
        @promote="promoteOne"
      />
      <p v-if="!randoms.length" class="muted small">No random elements</p>
    </section>

    <section class="block">
      <div class="row section-head">
        <h3>Effects</h3>
        <label class="bus">
          <span class="small muted">bus</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="busVolume('effects')"
            @input="setBusVolume('effects', Number($event.target.value))"
          />
          <span class="bus-pct">{{ pct(busVolume('effects')) }}</span>
        </label>
        <button
          class="learn"
          :class="{ active: isLearningCC(busAction('effects')) }"
          title="Assign a knob to the effects bus"
          @click="learnCC(busAction('effects'))"
        >
          {{ bindingLabel(busAction('effects'), 'cc') || 'LEARN' }}
        </button>
        <button class="learn" title="Reset effects bus to 100%" @click="setBusVolume('effects', 1)">
          100%
        </button>
        <span class="small muted">{{ oneshots.length }} element{{ oneshots.length === 1 ? '' : 's' }}</span>
        <div class="grow"></div>
        <button class="danger" :disabled="!oneshots.length" @click="stopEffects()">
          Stop effects
        </button>
      </div>
      <ElementRow
        v-for="el in oneshots"
        :key="el.id"
        :soundset="soundset"
        :element="el"
        :editing="editing"
        :selected="selected.has(el.id)"
        :selectable="el.source === 'scene'"
        @edit="openEditGroup"
        @update:selected="toggleSelected(el, $event)"
        @promote="promoteOne"
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
  min-width: 190px;
}

.bus input {
  flex: 1;
}

.bus-pct {
  font-size: 0.75rem;
  color: var(--text-dim);
  min-width: 2.7rem;
  text-align: right;
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

.banner.warning {
  border-color: var(--danger);
}

.banner.warning strong {
  color: var(--danger);
}

.editbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 0.5rem;
}

.editbar .inline {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.mini-field {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  color: var(--text-dim);
  white-space: nowrap;
}

.mini-field .text-input {
  width: 4.2rem;
}

.text-input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.5rem;
  font: inherit;
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

.wrap {
  flex-wrap: wrap;
}

.mood {
  font-size: 0.85rem;
}
</style>
