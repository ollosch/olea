<script setup>
import { store, clearError } from '../store.js'
import { engine } from '../engine.js'
import { midi, connectMidi } from '../midi.js'

function enableAudio() {
  engine.unlock()
}
</script>

<template>
  <footer class="status-bar">
    <div class="status-left">
      <span v-if="store.loading || store.sceneLoading || store.soundsLoading" class="status-pill busy">
        Working…
      </span>
      <span v-if="store.transportRunning" class="status-pill playing">Scene playing</span>
      <span v-if="store.status" class="status-pill" :class="store.statusTone">{{ store.status }}</span>
      <span v-if="store.lastSavedAt" class="small muted">Saved</span>
      <span v-if="engine.state.suspended" class="status-pill warn">
        Audio suspended
        <button class="btn-xs" @click="enableAudio">Enable audio</button>
      </span>
    </div>

    <div class="status-right">
      <span
        class="small"
        :class="midi.connected ? 'midi-ok' : 'muted'"
        :title="midi.error || 'MIDI status'"
      >
        {{ midi.connected ? `MIDI: ${midi.inputs.length} input(s)` : 'MIDI not connected' }}
        <template v-if="midi.lastKey">· {{ midi.lastKey }}</template>
      </span>
      <button v-if="!midi.connected" class="btn-xs" @click="connectMidi(store)">Connect MIDI</button>
    </div>

    <div v-if="store.error" class="error-banner">
      <span>{{ store.error }}</span>
      <button class="btn-xs" title="Dismiss error" @click="clearError">×</button>
    </div>

    <div v-if="store.warnings.length" class="warnings">
      <span class="warn-label">Warnings</span>
      <span v-for="warning in store.warnings" :key="warning" class="warning">{{ warning }}</span>
    </div>
  </footer>
</template>
