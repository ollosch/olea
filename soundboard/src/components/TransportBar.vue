<script setup>
import { computed } from 'vue'
import {
  store,
  renameScene,
  toggleTransport,
  stopAll,
  setMaster,
  setBus,
  setMode,
  cancelLearn,
  toggleMidiPanel,
} from '../store.js'
import { midi, connectMidi } from '../midi.js'

const learningLabel = computed(() => {
  if (!store.learning) return ''
  return `${store.learning.scope === 'local' ? 'Local' : 'Global'} · ${store.learning.action.type}`
})

function onRename(event) {
  const name = event.target.value.trim()
  if (name) renameScene(name)
  event.target.value = store.activeScene?.name || ''
  event.target.blur()
}
</script>

<template>
  <header class="transport-bar">
    <div class="transport-top">
      <div class="brand">
        <span class="brand-mark">O</span>
        <span class="brand-name">Olea Soundboard</span>
      </div>

      <div class="scene-identity">
        <input
          class="scene-title"
          :value="store.activeScene?.name || 'No scene'"
          :disabled="!store.activeScene"
          title="Scene name"
          @change="onRename"
        />
      </div>

      <div class="transport-actions">
        <button
          class="btn-play"
          :class="{ playing: store.transportRunning }"
          :disabled="!store.activeScene"
          :title="store.transportRunning ? 'Stop the scene' : 'Play the selected mood'"
          @click="toggleTransport"
        >
          {{ store.transportRunning ? '■ Stop' : '▶ Play' }}
        </button>
        <button class="btn-danger" title="Stop scene, palette and one-shots" @click="stopAll">
          Stop all
        </button>
      </div>

      <div class="mode-switch" role="group" aria-label="Interface mode">
        <button
          :class="{ active: store.mode === 'edit' }"
          title="Desktop editing layout"
          @click="setMode('edit')"
        >
          Edit
        </button>
        <button
          :class="{ active: store.mode === 'perform' }"
          title="Touch performance layout"
          @click="setMode('perform')"
        >
          Perform
        </button>
      </div>

      <div class="midi-chip">
        <span class="midi-dot" :class="{ on: midi.connected }"></span>
        <span class="small" :title="midi.error || 'Web MIDI status'">
          {{ midi.connected ? `${midi.inputs.length} MIDI` : 'MIDI off' }}
        </span>
        <button v-if="!midi.connected" class="btn-xs" @click="connectMidi(store)">Connect</button>
        <button class="btn-xs" title="Global MIDI bindings" @click="toggleMidiPanel">
          MIDI bindings
        </button>
        <button
          v-if="store.learning"
          class="btn-xs learning"
          title="Cancel MIDI learn"
          @click="cancelLearn"
        >
          {{ learningLabel }}…
        </button>
      </div>
    </div>

    <div class="mix-strip">
      <label class="fader" title="Master volume">
        <span>Master</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="store.master"
          @input="setMaster(Number($event.target.value))"
        />
        <span class="fader-value">{{ Math.round(store.master * 100) }}</span>
      </label>
      <label
        v-for="bus in ['loop', 'random', 'oneshot']"
        :key="bus"
        class="fader"
        :title="`${bus} bus volume`"
      >
        <span>{{ bus === 'oneshot' ? 'One-shots' : bus === 'loop' ? 'Loops' : 'Random' }}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="store.buses[bus]"
          @input="setBus(bus, Number($event.target.value))"
        />
        <span class="fader-value">{{ Math.round(store.buses[bus] * 100) }}</span>
      </label>
    </div>
  </header>
</template>
