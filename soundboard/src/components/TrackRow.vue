<script setup>
import { computed, ref } from 'vue'
import {
  store,
  selectTrack,
  toggleTrack,
  setTrackMoodEnabled,
  setTrackMoodGain,
  removeTrack,
  trackHasMidi,
} from '../store.js'
import { engine } from '../engine.js'
import Modal from './Modal.vue'

const props = defineProps({
  track: { type: Object, required: true },
  index: { type: Number, default: 0 },
  selected: { type: Boolean, default: false },
})

const playback = computed(() => engine.state.tracks[props.track.trackId] || null)
const active = computed(() => Boolean(playback.value))
const hasMidi = computed(() => trackHasMidi(props.track.trackId))
const confirmingRemove = ref(false)

const percent = computed(() => {
  const item = playback.value
  if (!item || !item.duration) return 0
  return Math.min(100, Math.max(0, (item.position / item.duration) * 100))
})

function select(event) {
  selectTrack(props.track.trackId, event.ctrlKey || event.metaKey || event.shiftKey)
}

function dragStart(event) {
  const ids = store.selectedTrackIds.includes(props.track.trackId)
    ? [...store.selectedTrackIds]
    : [props.track.trackId]
  event.dataTransfer.setData('application/x-olea-tracks', JSON.stringify(ids))
  event.dataTransfer.effectAllowed = 'move'
}

function remove() {
  confirmingRemove.value = true
}

function confirmRemove() {
  confirmingRemove.value = false
  removeTrack(props.track.trackId)
}
</script>

<template>
  <div
    class="track-row"
    :class="{ selected, active, muted: !track.enabled, invalid: !track.valid }"
    :data-track-index="index"
    :data-track-kind="track.kind"
    @click="select"
  >
    <div
      class="drag-handle"
      draggable="true"
      title="Drag track (use Ctrl/⌘ to select several)"
      @dragstart.stop="dragStart"
      @click.stop
    >
      ⋮⋮
    </div>

    <label class="mood-toggle" title="Mood enable" @click.stop>
      <input
        type="checkbox"
        :checked="track.enabled"
        @change="setTrackMoodEnabled(track.trackId, $event.target.checked)"
      />
    </label>

    <div class="track-main">
      <div class="track-title">
        <span class="track-name">{{ track.groupName }}</span>
        <span v-if="!track.valid" class="badge danger-badge">missing group</span>
        <span v-if="hasMidi" class="badge midi-badge" title="Track trigger is MIDI-bound">MIDI</span>
        <span class="badge selection-badge" :title="`${track.selection} sound selection`">
          {{ track.selection === 'ordered' ? '↻ ordered' : '⤨ random' }}
        </span>
      </div>
      <div class="track-meta small muted">
        <span>{{ track.sounds.length }} sound{{ track.sounds.length === 1 ? '' : 's' }}</span>
        <span>·</span>
        <span>{{ track.reverb || 'dry' }}</span>
        <span v-if="track.kind === 'random'">
          · {{ track.trigger.min }}–{{ track.trigger.max }}s
        </span>
        <span v-if="!track.enabled" class="mood-off">· off in mood</span>
      </div>
      <div v-if="playback && active" class="track-progress" :title="playback.soundName">
        <span :style="{ width: `${percent}%` }"></span>
      </div>
    </div>

    <button
      class="track-play"
      :class="{ active }"
      :title="active ? 'Stop track' : 'Trigger track'"
      @click.stop="toggleTrack(track.trackId)"
    >
      {{ active ? '■' : '▶' }}
    </button>

    <label class="track-volume" title="Mood gain" @click.stop>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="track.gain"
        @input="setTrackMoodGain(track.trackId, Number($event.target.value))"
      />
    </label>

    <button class="btn-xs danger" title="Remove track from scene" @click.stop="remove">×</button>
  </div>

  <Modal v-if="confirmingRemove" title="Remove track" @close="confirmingRemove = false">
    <p>
      Remove “{{ track.groupName }}” from this scene? The library group itself is not deleted.
    </p>

    <template #actions>
      <button class="btn-sm" @click="confirmingRemove = false">Cancel</button>
      <button class="btn-primary danger" @click="confirmRemove">Remove track</button>
    </template>
  </Modal>
</template>
