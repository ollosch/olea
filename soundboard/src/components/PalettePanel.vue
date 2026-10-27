<script setup>
import {
  store,
  paletteEntries,
  addToPalette,
  removeFromPalette,
  setPaletteGain,
  setPaletteLabel,
  movePalette,
  triggerPalette,
} from '../store.js'
import { engine } from '../engine.js'

function addSelected() {
  const ids = store.librarySelection
  if (!ids.length) return
  for (const id of ids) addToPalette(id)
}

function progress(entry) {
  return engine.state.palettes[entry.id] || null
}
</script>

<template>
  <div class="browser-pane palette-pane">
    <div class="row gap-sm wrap">
      <button class="btn-sm" :disabled="!store.librarySelection.length" @click="addSelected">
        Add selected library groups
      </button>
    </div>

    <div class="palette-grid">
      <div
        v-for="entry in paletteEntries"
        :key="entry.id"
        class="palette-item"
        :class="{ invalid: !entry.valid, active: engine.state.palettes[entry.id] }"
      >
        <button
          class="pad"
          :title="`Trigger ${entry.label || entry.groupName}`"
          :disabled="!entry.valid"
          @click="triggerPalette(entry.id)"
        >
          <span class="pad-label">{{ entry.label || entry.groupName || 'Missing group' }}</span>
          <span class="small muted">{{ entry.kind }}</span>
        </button>
        <div v-if="progress(entry)" class="mini-progress">
          <span
            :style="{
              width: `${progress(entry).duration ? Math.min(100, (progress(entry).position / progress(entry).duration) * 100) : 0}%`,
            }"
          ></span>
        </div>
        <input
          class="text-input"
          :value="entry.label"
          placeholder="Pad label"
          title="Pad label"
          @change="setPaletteLabel(entry.id, $event.target.value)"
        />
        <label class="fader compact">
          <span>Gain</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="entry.gain"
            @input="setPaletteGain(entry.id, Number($event.target.value))"
          />
        </label>
        <div class="row gap-xs">
          <button class="btn-xs" title="Move up" @click="movePalette(entry.id, -1)">↑</button>
          <button class="btn-xs" title="Move down" @click="movePalette(entry.id, 1)">↓</button>
          <button class="btn-xs danger" title="Remove from palette" @click="removeFromPalette(entry.id)">
            ×
          </button>
        </div>
      </div>
      <div v-if="!paletteEntries.length" class="empty-mini">
        Palette is empty. Add groups from the Library tab or Import view.
      </div>
    </div>
  </div>
</template>
