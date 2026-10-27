<script setup>
import { computed } from 'vue'
import {
  store,
  currentPlan,
  paletteEntries,
  openScene,
  selectMood,
  toggleTransport,
  stopAll,
  setMaster,
  setBus,
  toggleTrack,
  triggerPalette,
  setPaletteGain,
} from '../store.js'
import { engine } from '../engine.js'

const moods = computed(() => store.activeScene?.moods || [])
const showMood = computed(() => moods.value.length > 1)

function active(trackId) {
  return engine.isTrackActive(trackId)
}

function trackProgress(trackId) {
  return engine.state.tracks[trackId] || null
}

function paletteProgress(paletteId) {
  return engine.state.palettes[paletteId] || null
}

function percent(item) {
  if (!item || !item.duration) return 0
  return Math.min(100, Math.max(0, (item.position / item.duration) * 100))
}
</script>

<template>
  <section class="perform-view">
    <header class="perform-head">
      <label class="field wide">
        <span>Scene</span>
        <select
          :value="store.activeScene?.id || ''"
          @change="$event.target.value && openScene($event.target.value)"
        >
          <option v-for="scene in store.scenes" :key="scene.id" :value="scene.id">
            {{ scene.name }}{{ scene.disabled ? ' (disabled)' : '' }}
          </option>
        </select>
      </label>
      <label v-if="showMood" class="field wide">
        <span>Mood</span>
        <select :value="store.selectedMoodId || ''" @change="selectMood($event.target.value)">
          <option v-for="mood in moods" :key="mood.id" :value="mood.id">{{ mood.name }}</option>
        </select>
      </label>
    </header>

    <div class="perform-transport">
      <button
        class="perform-play"
        :class="{ playing: store.transportRunning }"
        :disabled="!store.activeScene"
        @click="toggleTransport"
      >
        {{ store.transportRunning ? '■ Stop' : '▶ Play' }}
      </button>
      <button class="perform-stop" @click="stopAll">Stop all</button>
    </div>

    <section class="perform-mix">
      <label class="perform-fader">
        <span>Master</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="store.master"
          @input="setMaster(Number($event.target.value))"
        />
        <strong>{{ Math.round(store.master * 100) }}</strong>
      </label>
      <label v-for="bus in ['loop', 'random', 'oneshot']" :key="bus" class="perform-fader">
        <span>{{ bus === 'loop' ? 'Loops' : bus === 'random' ? 'Random' : 'One-shots' }}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="store.buses[bus]"
          @input="setBus(bus, Number($event.target.value))"
        />
        <strong>{{ Math.round(store.buses[bus] * 100) }}</strong>
      </label>
    </section>

    <section class="perform-section">
      <h2>Palette</h2>
      <div class="perform-pads palette-pads">
        <div
          v-for="entry in paletteEntries"
          :key="entry.id"
          class="perform-pad-wrap"
          :class="{ active: engine.state.palettes[entry.id], invalid: !entry.valid }"
        >
          <button
            class="perform-pad"
            :disabled="!entry.valid"
            @click="triggerPalette(entry.id)"
          >
            <span class="pad-label">{{ entry.label || entry.groupName }}</span>
            <span class="small muted">{{ entry.kind }}</span>
          </button>
          <div v-if="paletteProgress(entry.id)" class="mini-progress">
            <span :style="{ width: `${percent(paletteProgress(entry.id))}%` }"></span>
          </div>
          <input
            class="pad-gain"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="entry.gain"
            title="Pad volume"
            @input="setPaletteGain(entry.id, Number($event.target.value))"
          />
        </div>
        <div v-if="!paletteEntries.length" class="empty-mini">
          No palette items. Add groups in edit mode.
        </div>
      </div>
    </section>

    <section class="perform-section">
      <h2>Tracks</h2>
      <div class="perform-pads track-pads">
        <div
          v-for="track in currentPlan.all"
          :key="track.trackId"
          class="perform-pad-wrap"
          :class="{ active: active(track.trackId), muted: !track.enabled, invalid: !track.valid }"
        >
          <button class="perform-pad" @click="toggleTrack(track.trackId)">
            <span class="pad-label">{{ track.groupName }}</span>
            <span class="small muted">{{ track.kind }} · {{ track.enabled ? 'on' : 'off' }}</span>
          </button>
          <div v-if="trackProgress(track.trackId)" class="mini-progress">
            <span :style="{ width: `${percent(trackProgress(track.trackId))}%` }"></span>
          </div>
        </div>
        <div v-if="!currentPlan.all.length" class="empty-mini">This scene has no tracks yet.</div>
      </div>
    </section>
  </section>
</template>
