<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import {
  store,
  bootstrap,
  cancelCollision,
  cancelLearn,
} from './store.js'
import { connectMidi } from './midi.js'
import TransportBar from './components/TransportBar.vue'
import BrowserPanel from './components/BrowserPanel.vue'
import SceneEditor from './components/SceneEditor.vue'
import Inspector from './components/Inspector.vue'
import PerformView from './components/PerformView.vue'
import ImportView from './components/ImportView.vue'
import CollisionDialog from './components/CollisionDialog.vue'
import GroupEditor from './components/GroupEditor.vue'
import StatusBar from './components/StatusBar.vue'

function onKeydown(event) {
  if (event.key !== 'Escape') return
  if (store.collision) cancelCollision()
  else if (store.editingGroupId) store.editingGroupId = null
  else if (store.learning) cancelLearn()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await bootstrap()
  connectMidi(store)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app" :class="store.mode === 'perform' ? 'mode-perform' : 'mode-edit'">
    <TransportBar />

    <main v-if="store.mode === 'perform'" class="perform-wrap">
      <PerformView />
    </main>

    <main v-else-if="store.view === 'import'" class="import-wrap">
      <ImportView />
    </main>

    <main v-else class="edit-layout">
      <aside class="left-pane">
        <BrowserPanel />
      </aside>
      <section class="center-pane">
        <SceneEditor />
      </section>
      <aside class="right-pane">
        <Inspector />
      </aside>
    </main>

    <StatusBar />
    <CollisionDialog v-if="store.collision" />
    <GroupEditor v-if="store.editingGroupId" />
  </div>
</template>
