<script setup>
import { ref, computed } from 'vue'
import {
  store,
  paletteElements,
  playPaletteItem,
  setPaletteVolume,
  bindingLabel,
  learnPaletteNote,
  learnPaletteCC,
  unpinFromPalette,
  isPaletteLoopPlaying,
  isPaletteRandomActive,
  isPaletteOneshotPlaying,
  isBindingShadowed,
} from '../store'

const emit = defineEmits(['open-library'])

const collapsed = ref(false)
const rows = computed(() => paletteElements())

function kindLabel(kind) {
  if (kind === 'loop') return 'Loop'
  if (kind === 'random') return 'Random'
  return 'Effect'
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`
}

function noteAction(row) {
  return { type: 'palette', paletteId: row.paletteId }
}

function ccAction(row) {
  return { type: 'paletteVolume', paletteId: row.paletteId }
}

function noteText(row) {
  return bindingLabel(noteAction(row), 'note') || 'learn note'
}

function ccText(row) {
  return bindingLabel(ccAction(row), 'cc') || 'learn knob'
}

function hasNote(row) {
  return !!bindingLabel(noteAction(row), 'note')
}

function hasCC(row) {
  return !!bindingLabel(ccAction(row), 'cc')
}

function isLearning(row, mode) {
  const l = store.learning
  if (!l || l.mode !== mode || !l.action) return false
  const type = mode === 'note' ? 'palette' : 'paletteVolume'
  return l.action.type === type && l.action.paletteId === row.paletteId
}

function isPlaying(row) {
  if (row.kind === 'loop') return isPaletteLoopPlaying(row.paletteId)
  if (row.kind === 'random') return isPaletteRandomActive(row.paletteId)
  return isPaletteOneshotPlaying(row.paletteId)
}

function playLabel(row) {
  if (row.kind === 'oneshot') return isPlaying(row) ? 'Retrigger' : 'Trigger'
  return isPlaying(row) ? 'Stop' : 'Play'
}

function canPlay(row) {
  return !row.missing && (row.files || []).length > 0
}

function isShadowed(row) {
  return (
    isBindingShadowed(noteAction(row), 'note') ||
    isBindingShadowed(ccAction(row), 'cc')
  )
}
</script>

<template>
  <section class="palette-panel" :class="{ collapsed }">
    <div class="row palette-head">
      <button
        class="collapse-btn"
        :aria-expanded="!collapsed"
        :title="collapsed ? 'Expand palette' : 'Collapse palette'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '▸' : '▾' }}
      </button>
      <h2>Palette</h2>
      <span class="small muted">{{ rows.length }}</span>
      <div class="grow"></div>
      <span v-if="!collapsed" class="small muted palette-hint">always available</span>
    </div>

    <div v-if="!collapsed" class="palette-body">
      <div v-if="!rows.length" class="palette-empty">
        <p class="small muted">Pin sounds from the Library.</p>
        <button class="btn-sm" @click="emit('open-library')">Browse library</button>
      </div>

      <div v-for="row in rows" :key="row.paletteId" class="palette-row" :class="{ missing: row.missing }">
        <div class="row palette-row-head">
          <button
            class="btn-sm play-btn"
            :class="{ active: isPlaying(row) }"
            :disabled="!canPlay(row)"
            :title="row.missing ? 'The library group no longer exists' : 'Play or stop this palette item'"
            @click="playPaletteItem(row.paletteId)"
          >
            {{ playLabel(row) }}
          </button>

          <div class="palette-title grow">
            <span class="palette-label">{{ row.label || row.name }}</span>
            <div class="row palette-tags">
              <span class="badge kind-badge" :class="`kind-${row.kind}`">{{ kindLabel(row.kind) }}</span>
              <span v-if="isPlaying(row)" class="badge playing-badge">playing</span>
              <span v-if="row.missing" class="badge danger-badge" title="Missing library group">missing</span>
            </div>
          </div>

          <button class="btn-sm danger" title="Unpin from palette" @click="unpinFromPalette(row.paletteId)">
            unpin
          </button>
        </div>

        <p v-if="row.missing" class="small danger-text">
          The library group for this pin is missing. Remove the pin or restore the library item.
        </p>

        <label class="palette-vol">
          <span class="small muted">vol {{ percent(row.gain) }}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="row.gain"
            :disabled="row.missing"
            @input="setPaletteVolume(row.paletteId, Number($event.target.value))"
          />
        </label>

        <div class="row palette-midi">
          <button
            class="btn-sm learn-btn"
            :class="{ assigned: hasNote(row), learning: isLearning(row, 'note') }"
            :disabled="row.missing"
            title="Assign a MIDI note to this palette item"
            @click="learnPaletteNote(row.paletteId)"
          >
            {{ isLearning(row, 'note') ? 'press note…' : noteText(row) }}
          </button>
          <button
            class="btn-sm learn-btn"
            :class="{ assigned: hasCC(row), learning: isLearning(row, 'cc') }"
            :disabled="row.missing"
            title="Assign a MIDI knob to this palette item's volume"
            @click="learnPaletteCC(row.paletteId)"
          >
            {{ isLearning(row, 'cc') ? 'turn knob…' : ccText(row) }}
          </button>
        </div>

        <p v-if="isShadowed(row)" class="small shadow-warning">
          The active scene overrides this mapping on the same MIDI key.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.palette-panel {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
}

.palette-head {
  flex-wrap: wrap;
  gap: 0.4rem;
}

.palette-head h2 {
  margin: 0;
  font-size: 1.05rem;
}

.collapse-btn {
  padding: 0.2rem 0.45rem;
  font-size: 0.8rem;
  line-height: 1;
}

.palette-hint {
  font-size: 0.72rem;
}

.palette-body {
  margin-top: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.palette-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.4rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 0.6rem;
}

.palette-empty p {
  margin: 0;
}

.palette-row {
  border-top: 1px solid var(--border);
  padding-top: 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.palette-row.missing {
  opacity: 0.85;
}

.palette-row-head {
  align-items: flex-start;
  flex-wrap: wrap;
}

.play-btn {
  min-width: 4.4rem;
}

.palette-title {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.palette-label {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.palette-tags {
  flex-wrap: wrap;
  gap: 0.25rem;
}

.palette-vol {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.palette-midi {
  flex-wrap: wrap;
}

.danger-text {
  color: var(--danger);
  margin: 0;
}

.shadow-warning {
  color: #fbbf24;
  margin: 0;
}
</style>
