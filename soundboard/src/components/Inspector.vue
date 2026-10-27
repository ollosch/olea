<script setup>
import { computed, watch } from 'vue'
import {
  store,
  selectedTrack,
  currentPlan,
  trackById,
  groupById,
  updateGroup,
  removeGroupSounds,
  setTrackDefaultTrigger,
  setTrackMoodEnabled,
  setTrackMoodGain,
  setTrackMoodReverb,
  setTrackMoodPan,
  setTrackMoodTrigger,
  clearTrackMoodField,
  resetTrackMoodOverride,
  removeTrack,
  beginLearn,
  openGroupEditor,
  ensureGroupSounds,
  previewSound,
  trackHasMidi,
  trackVolumeHasMidi,
} from '../store.js'
import { REVERB_PRESETS, coerceReverb } from '../../lib/v3/schema.js'
import TriggerEditor from './TriggerEditor.vue'
import BindingsPanel from './BindingsPanel.vue'

const rawTrack = computed(() =>
  store.selectedTrackId ? trackById(store.selectedTrackId) : null
)
const group = computed(() =>
  rawTrack.value ? groupById(rawTrack.value.groupId) : null
)
const moodParam = computed(() => {
  if (!rawTrack.value) return {}
  const mood = store.activeScene?.moods.find((item) => item.id === store.selectedMoodId)
  return mood?.params?.[rawTrack.value.id] || {}
})
const hasMoodReverb = computed(() =>
  Object.prototype.hasOwnProperty.call(moodParam.value, 'reverb')
)

watch(
  () => group.value?.id,
  (id) => {
    if (id) ensureGroupSounds(id)
  },
  { immediate: true }
)

const groupSounds = computed(() => {
  if (!group.value) return []
  return group.value.sounds.map((id) => {
    const sound = store.soundsById[id]
    return {
      id,
      label: sound?.originalName || id,
      duration: sound?.duration,
      sound,
    }
  })
})

function patchGroup(patch) {
  if (group.value) updateGroup(group.value.id, patch)
}

function onGroupName(event) {
  const name = event.target.value.trim()
  if (name) patchGroup({ name })
}

function onTags(event) {
  patchGroup({
    tags: event.target.value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  })
}

function moveSound(index, delta) {
  if (!group.value) return
  const sounds = [...group.value.sounds]
  const target = index + delta
  if (target < 0 || target >= sounds.length) return
  ;[sounds[index], sounds[target]] = [sounds[target], sounds[index]]
  patchGroup({ sounds })
}

function removeSound(soundId) {
  if (!group.value) return
  removeGroupSounds(group.value.id, [soundId])
}

function onReverbOverride(event) {
  const value = event.target.value
  if (!rawTrack.value) return
  if (value === 'inherit') clearTrackMoodField(rawTrack.value.id, 'reverb')
  else setTrackMoodReverb(rawTrack.value.id, coerceReverb(value))
}

function learnTrigger() {
  if (rawTrack.value) {
    beginLearn('local', { type: 'trackTrigger', trackId: rawTrack.value.id })
  }
}

function learnVolume() {
  if (rawTrack.value) {
    beginLearn('local', { type: 'trackVolume', trackId: rawTrack.value.id })
  }
}
</script>

<template>
  <aside class="inspector">
    <div v-if="!store.activeScene" class="empty-mini">Open a scene to inspect tracks.</div>

    <template v-else-if="!selectedTrack">
      <div class="inspector-placeholder">
        <h2>Inspector</h2>
        <p class="small muted">
          Select a track to edit its group, sound order, defaults, mood override and MIDI binding.
        </p>
        <dl class="scene-facts">
          <div><dt>Tracks</dt><dd>{{ store.activeScene.tracks.length }}</dd></div>
          <div><dt>Moods</dt><dd>{{ store.activeScene.moods.length }}</dd></div>
          <div><dt>Scene default</dt><dd>{{ store.activeScene.defaultMoodId === store.selectedMoodId ? 'yes' : 'no' }}</dd></div>
        </dl>
      </div>
      <BindingsPanel />
    </template>

    <template v-else>
      <header class="inspector-head">
        <div>
          <h2>{{ selectedTrack.groupName }}</h2>
          <p class="small muted">
            Track {{ rawTrack?.kind }} · scene-wide order {{ selectedTrack.order + 1 }}
          </p>
        </div>
        <button v-if="group" class="btn-sm" title="Edit group metadata" @click="openGroupEditor(group.id)">
          Edit group
        </button>
      </header>

      <section v-if="group" class="inspector-section">
        <h3>Group metadata</h3>
        <label class="field">
          <span>Name</span>
          <input class="text-input" :value="group.name" @change="onGroupName" />
        </label>
        <label class="field">
          <span>Category</span>
          <input
            class="text-input"
            :value="group.category"
            placeholder="Creatures/Dogs"
            @change="patchGroup({ category: $event.target.value })"
          />
        </label>
        <label class="field">
          <span>Tags (comma separated)</span>
          <input class="text-input" :value="group.tags.join(', ')" @change="onTags" />
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea
            class="text-input"
            rows="2"
            :value="group.notes"
            @change="patchGroup({ notes: $event.target.value })"
          ></textarea>
        </label>
        <div class="form-grid">
          <label class="field">
            <span>Selection</span>
            <select
              :value="group.selection"
              @change="patchGroup({ selection: $event.target.value })"
            >
              <option value="random">Random (avoid repeat)</option>
              <option value="ordered">Ordered</option>
            </select>
          </label>
          <label class="field">
            <span>Default kind hint</span>
            <select
              :value="group.defaultKind || ''"
              @change="patchGroup({ defaultKind: $event.target.value || null })"
            >
              <option value="">No hint</option>
              <option value="loop">Loop</option>
              <option value="random">Random</option>
              <option value="oneshot">One-shot</option>
            </select>
          </label>
        </div>
      </section>

      <section v-if="group" class="inspector-section">
        <h3>Sounds <span class="small muted">({{ groupSounds.length }})</span></h3>
        <ol class="sound-list">
          <li v-for="(item, index) in groupSounds" :key="item.id" class="sound-item">
            <span class="sound-index">{{ index + 1 }}</span>
            <span class="sound-name" :title="item.id">{{ item.label }}</span>
            <span v-if="item.duration" class="small muted">{{ item.duration.toFixed(1) }}s</span>
            <div class="row gap-xs">
              <button class="btn-xs" title="Preview" @click="previewSound(item.sound)">▶</button>
              <button class="btn-xs" title="Move up" :disabled="index === 0" @click="moveSound(index, -1)">
                ↑
              </button>
              <button
                class="btn-xs"
                title="Move down"
                :disabled="index === groupSounds.length - 1"
                @click="moveSound(index, 1)"
              >
                ↓
              </button>
              <button class="btn-xs danger" title="Remove sound from group" @click="removeSound(item.id)">
                ×
              </button>
            </div>
          </li>
          <li v-if="!groupSounds.length" class="empty-mini">This group has no sounds yet.</li>
        </ol>
      </section>

      <section v-if="group" class="inspector-section">
        <h3>Group defaults <span class="small muted">(inherited)</span></h3>
        <label class="field">
          <span>Gain</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="group.defaults.gain"
            @input="patchGroup({ defaults: { gain: Number($event.target.value) } })"
          />
          <span class="small muted">{{ Math.round(group.defaults.gain * 100) }}</span>
        </label>
        <label class="field">
          <span>Pan</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            :value="group.defaults.pan"
            @input="patchGroup({ defaults: { pan: Number($event.target.value) } })"
          />
          <span class="small muted">{{ Math.round(group.defaults.pan * 100) }}</span>
        </label>
        <label class="field">
          <span>Reverb</span>
          <select
            :value="group.defaults.reverb || ''"
            @change="patchGroup({ defaults: { reverb: coerceReverb($event.target.value) } })"
          >
            <option value="">Dry (Off)</option>
            <option v-for="preset in REVERB_PRESETS" :key="preset" :value="preset">
              {{ preset }}
            </option>
          </select>
        </label>
        <span class="field-label">Default random trigger (seconds)</span>
        <TriggerEditor
          :model-value="group.defaults.trigger"
          @update:model-value="patchGroup({ defaults: { trigger: $event } })"
        />
      </section>

      <section v-if="rawTrack" class="inspector-section">
        <h3>Track</h3>
        <p class="small muted">
          Kind is set by the scene section and drag/drop. Track order is shared by every mood.
        </p>
        <span class="field-label">Track default random trigger</span>
        <TriggerEditor
          :model-value="rawTrack.trigger"
          @update:model-value="setTrackDefaultTrigger(rawTrack.id, $event)"
        />
        <div class="row gap-sm wrap">
          <button class="btn-sm" :class="{ learning: trackHasMidi(rawTrack.id) }" @click="learnTrigger">
            Learn trigger (note)
          </button>
          <button
            class="btn-sm"
            :class="{ learning: trackVolumeHasMidi(rawTrack.id) }"
            @click="learnVolume"
          >
            Learn volume (CC)
          </button>
          <button class="btn-sm danger" title="Remove this track from the scene" @click="removeTrack(rawTrack.id)">
            Delete track
          </button>
        </div>
      </section>

      <section v-if="selectedTrack" class="inspector-section mood-override">
        <h3>Mood override <span class="small muted">({{ selectedTrack.kind }})</span></h3>
        <label class="checkbox-field">
          <input
            type="checkbox"
            :checked="selectedTrack.enabled"
            @change="setTrackMoodEnabled(selectedTrack.trackId, $event.target.checked)"
          />
          <span>Enabled in this mood</span>
        </label>

        <label class="field">
          <span>Gain</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="selectedTrack.gain"
            @input="setTrackMoodGain(selectedTrack.trackId, Number($event.target.value))"
          />
          <span class="small muted">{{ Math.round(selectedTrack.gain * 100) }}</span>
        </label>
        <label class="field">
          <span>Pan</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            :value="selectedTrack.pan"
            @input="setTrackMoodPan(selectedTrack.trackId, Number($event.target.value))"
          />
          <span class="small muted">{{ Math.round(selectedTrack.pan * 100) }}</span>
        </label>
        <label class="field">
          <span>Reverb</span>
          <select
            :value="hasMoodReverb ? selectedTrack.reverb || 'Off' : 'inherit'"
            @change="onReverbOverride"
          >
            <option v-if="!hasMoodReverb" value="inherit">Inherit group</option>
            <option value="Off">Dry (Off)</option>
            <option v-for="preset in REVERB_PRESETS" :key="preset" :value="preset">
              {{ preset }}
            </option>
          </select>
        </label>

        <span class="field-label">Random trigger override</span>
        <TriggerEditor
          :model-value="selectedTrack.trigger"
          @update:model-value="setTrackMoodTrigger(selectedTrack.trackId, $event)"
        />

        <button class="btn-sm danger" title="Clear all overrides for this track in this mood" @click="resetTrackMoodOverride(selectedTrack.trackId)">
          Reset mood override
        </button>
      </section>

      <BindingsPanel />
    </template>
  </aside>
</template>
