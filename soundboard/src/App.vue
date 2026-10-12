<script setup>
import { onMounted } from 'vue'
import {
  store,
  activeSoundset,
  setMaster,
  stopEverything,
  connectMidi,
  loadLibrary,
  loadFiles,
} from './store'
import LibraryPanel from './components/LibraryPanel.vue'
import SoundsetPanel from './components/SoundsetPanel.vue'

onMounted(async () => {
  await loadLibrary()
  loadFiles()
  connectMidi()
})
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1 class="app-title">Olea Sound</h1>

      <label class="main">
        <span class="small muted">Main</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="store.masterVolume"
          @input="setMaster(Number($event.target.value))"
        />
      </label>

      <button class="stop" @click="stopEverything()">STOP</button>

      <div class="row midi-status">
        <span class="small" :class="store.midiConnected ? 'midi-ok' : 'muted'">
          {{ store.midiConnected ? 'MIDI connected' : 'MIDI not connected' }}
        </span>
        <span v-if="store.midiError" class="small muted">{{ store.midiError }}</span>
        <button @click="connectMidi()">Connect MIDI</button>
      </div>
    </header>

    <main class="body">
      <LibraryPanel v-if="!activeSoundset" />
      <SoundsetPanel v-else :soundset="activeSoundset" />
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1rem;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.75rem;
  margin-bottom: 1rem;
}

.app-title {
  margin: 0;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  width: 150px;
}

.stop {
  background: var(--danger);
  border-color: var(--danger);
  color: #1a0b0b;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 0.55rem 1.1rem;
}

.midi-status {
  margin-left: auto;
  flex-wrap: wrap;
}

.midi-ok {
  color: var(--ok);
}
</style>
