<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  store,
  activeSoundset,
  setMaster,
  stopEverything,
  connectMidi,
  loadLibrary,
  loadFiles,
  startSoundset,
  leaveSoundset,
} from './store'
import ScenesPanel from './components/ScenesPanel.vue'
import LibraryBrowser from './components/LibraryBrowser.vue'
import PalettePanel from './components/PalettePanel.vue'
import ReviewPanel from './components/ReviewPanel.vue'
import SoundsetPanel from './components/SoundsetPanel.vue'

const view = ref('scenes')

const activeView = computed(() =>
  view.value === 'scene' && !activeSoundset.value ? 'scenes' : view.value
)

watch(activeSoundset, (ss) => {
  if (!ss && view.value === 'scene') view.value = 'scenes'
})

function setView(next) {
  view.value = next
}

function openScene(id) {
  if (id && store.activeId !== id) startSoundset(id)
  view.value = 'scene'
}

function leaveScene() {
  leaveSoundset()
  view.value = 'scenes'
}

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
        <button class="btn-sm" @click="connectMidi()">Connect MIDI</button>
      </div>
    </header>

    <nav class="nav-tabs" aria-label="Main views">
      <button class="nav-tab" :class="{ active: activeView === 'scenes' }" @click="setView('scenes')">
        Scenes
      </button>
      <button class="nav-tab" :class="{ active: activeView === 'library' }" @click="setView('library')">
        Library
      </button>
      <button class="nav-tab" :class="{ active: activeView === 'review' }" @click="setView('review')">
        Review
      </button>
      <button
        v-if="activeSoundset"
        class="nav-tab scene-tab"
        :class="{ active: activeView === 'scene' }"
        :title="activeSoundset.name"
        @click="setView('scene')"
      >
        ● {{ activeSoundset.name }}
      </button>

      <div class="grow"></div>

      <button v-if="activeView === 'scene'" class="btn-sm" @click="leaveScene">
        ← Scenes
      </button>
    </nav>

    <div class="workspace">
      <main class="body">
        <template v-if="activeView === 'scene' && activeSoundset">
          <SoundsetPanel :soundset="activeSoundset" />
        </template>
        <ScenesPanel v-else-if="activeView === 'scenes'" @open="openScene" />
        <LibraryBrowser v-else-if="activeView === 'library'" />
        <ReviewPanel v-else-if="activeView === 'review'" />
      </main>

      <aside v-if="activeView !== 'review'" class="palette-slot">
        <PalettePanel @open-library="setView('library')" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.app {
  max-width: 1320px;
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
  margin-bottom: 0.6rem;
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

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 330px);
  gap: 1rem;
  align-items: start;
}

.body {
  min-width: 0;
}

.palette-slot {
  position: sticky;
  top: 0.75rem;
  min-width: 0;
}

.scene-tab {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .palette-slot {
    position: static;
    order: 2;
  }

  .scene-tab {
    max-width: 100%;
  }
}
</style>
