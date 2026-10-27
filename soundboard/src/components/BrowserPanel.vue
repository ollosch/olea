<script setup>
import { computed } from 'vue'
import { store, openImport } from '../store.js'
import ScenesList from './ScenesList.vue'
import LibraryBrowser from './LibraryBrowser.vue'
import PalettePanel from './PalettePanel.vue'

const showImport = computed(() => !store.importDone)

function choose(tab) {
  if (tab === 'import') {
    openImport()
    return
  }
  store.browserTab = tab
}
</script>

<template>
  <nav class="browser-panel">
    <div class="browser-tabs" role="tablist" aria-label="Browser">
      <button
        v-for="tab in ['scenes', 'library', 'palette']"
        :key="tab"
        class="browser-tab"
        :class="{ active: store.browserTab === tab }"
        role="tab"
        @click="choose(tab)"
      >
        {{ tab === 'scenes' ? 'Scenes' : tab === 'library' ? 'Library' : 'Palette' }}
      </button>
      <button
        v-if="showImport"
        class="browser-tab"
        :class="{ active: store.browserTab === 'import' }"
        role="tab"
        @click="choose('import')"
      >
        Import
      </button>
    </div>

    <div class="browser-body">
      <ScenesList v-if="store.browserTab === 'scenes'" />
      <LibraryBrowser v-else-if="store.browserTab === 'library'" />
      <PalettePanel v-else-if="store.browserTab === 'palette'" />
    </div>
  </nav>
</template>
