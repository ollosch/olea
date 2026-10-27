<script setup>
import { reactive } from 'vue'
import {
  store,
  sceneSections,
  addGroupsToScene,
  reorderTracks,
} from '../store.js'
import MoodBar from './MoodBar.vue'
import TrackRow from './TrackRow.vue'

const dropTarget = reactive({ kind: '', index: null })

function tracksFor(kind) {
  return sceneSections.value.find((section) => section.kind === kind)?.tracks || []
}

function readPayload(event, type) {
  try {
    const raw = event.dataTransfer.getData(type)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function onDragOver(kind, event) {
  event.preventDefault()
  const types = event.dataTransfer?.types || []
  const isTrack = types.includes('application/x-olea-tracks')
  event.dataTransfer.dropEffect = isTrack ? 'move' : 'copy'
  const row = event.target.closest?.('.track-row')
  let index = tracksFor(kind).length
  if (row && row.dataset.trackKind === kind) index = Number(row.dataset.trackIndex)
  dropTarget.kind = kind
  dropTarget.index = Number.isFinite(index) ? index : 0
}

function onDragLeave(kind, event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (dropTarget.kind === kind) {
    dropTarget.kind = ''
    dropTarget.index = null
  }
}

function resetDrop() {
  dropTarget.kind = ''
  dropTarget.index = null
}

function onDrop(kind, event) {
  event.preventDefault()
  const index =
    dropTarget.kind === kind && dropTarget.index != null
      ? dropTarget.index
      : tracksFor(kind).length

  const groupIds = readPayload(event, 'application/x-olea-groups')
  if (groupIds && groupIds.length) {
    addGroupsToScene(groupIds, kind, index)
    resetDrop()
    return
  }

  const trackIds = readPayload(event, 'application/x-olea-tracks')
  if (trackIds && trackIds.length) {
    reorderTracks(trackIds, kind, index)
  }
  resetDrop()
}
</script>

<template>
  <section class="scene-editor">
    <div v-if="!store.activeScene" class="empty-state">
      <h3>No scene open</h3>
      <p>Open a scene from the browser or create a new one to start building tracks.</p>
    </div>

    <template v-else>
      <MoodBar />

      <div class="scene-sections">
        <section
          v-for="section in sceneSections"
          :key="section.kind"
          class="track-section"
          :class="`section-${section.kind}`"
          @dragover="onDragOver(section.kind, $event)"
          @dragleave="onDragLeave(section.kind, $event)"
          @drop="onDrop(section.kind, $event)"
        >
          <header class="section-head">
            <h2>{{ section.label }}</h2>
            <span class="small muted">{{ section.tracks.length }} tracks</span>
          </header>

          <div class="section-body">
            <template v-for="(track, index) in section.tracks" :key="track.trackId">
              <div
                v-if="dropTarget.kind === section.kind && dropTarget.index === index"
                class="drop-line"
              ></div>
              <TrackRow
                :track="track"
                :index="index"
                :selected="store.selectedTrackIds.includes(track.trackId)"
              />
            </template>
            <div
              v-if="dropTarget.kind === section.kind && dropTarget.index === section.tracks.length"
              class="drop-line"
            ></div>
            <div v-if="!section.tracks.length" class="section-empty">
              Drag groups here to add {{ section.label.toLowerCase() }}.
            </div>
          </div>
        </section>
      </div>
    </template>
  </section>
</template>
