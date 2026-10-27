<script setup>
import { reactive, watch } from 'vue'
import {
  store,
  groupById,
  updateGroup,
  closeGroupEditor,
} from '../store.js'
import { REVERB_PRESETS, coerceReverb, sanitizeTrigger } from '../../lib/v3/schema.js'
import Modal from './Modal.vue'
import TriggerEditor from './TriggerEditor.vue'

const form = reactive({
  name: '',
  category: '',
  tags: '',
  notes: '',
  selection: 'random',
  defaultKind: '',
  gain: 0.8,
  reverb: '',
  pan: 0,
  trigger: { min: 10, max: 30, startMin: 2, startMax: 10 },
})

watch(
  () => store.editingGroupId,
  (id) => {
    const group = id ? groupById(id) : null
    if (!group) return
    form.name = group.name
    form.category = group.category
    form.tags = (group.tags || []).join(', ')
    form.notes = group.notes || ''
    form.selection = group.selection
    form.defaultKind = group.defaultKind || ''
    form.gain = group.defaults?.gain ?? 0.8
    form.reverb = group.defaults?.reverb || ''
    form.pan = group.defaults?.pan ?? 0
    form.trigger = sanitizeTrigger(group.defaults?.trigger)
  },
  { immediate: true }
)

async function save() {
  const id = store.editingGroupId
  if (!id) return
  const group = await updateGroup(id, {
    name: form.name,
    category: form.category,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    notes: form.notes,
    selection: form.selection,
    defaultKind: form.defaultKind || null,
    defaults: {
      gain: Number(form.gain),
      reverb: coerceReverb(form.reverb),
      pan: Number(form.pan),
      trigger: sanitizeTrigger(form.trigger),
    },
  })
  if (group) closeGroupEditor()
}
</script>

<template>
  <Modal :title="`Group: ${form.name || 'Untitled'}`" wide @close="closeGroupEditor">
    <div class="form-grid">
      <label class="field span-2">
        <span>Name</span>
        <input v-model="form.name" class="text-input" type="text" />
      </label>
      <label class="field">
        <span>Category</span>
        <input v-model="form.category" class="text-input" type="text" placeholder="Creatures/Dogs" />
      </label>
      <label class="field">
        <span>Tags (comma separated)</span>
        <input v-model="form.tags" class="text-input" type="text" placeholder="animal, night" />
      </label>
      <label class="field">
        <span>Selection</span>
        <select v-model="form.selection">
          <option value="random">Random (avoid repeat)</option>
          <option value="ordered">Ordered (advance, wrap)</option>
        </select>
      </label>
      <label class="field">
        <span>Default kind hint</span>
        <select v-model="form.defaultKind">
          <option value="">No hint</option>
          <option value="loop">Loop</option>
          <option value="random">Random</option>
          <option value="oneshot">One-shot</option>
        </select>
      </label>
      <label class="field span-2">
        <span>Notes</span>
        <textarea v-model="form.notes" class="text-input" rows="2"></textarea>
      </label>

      <label class="field">
        <span>Default gain</span>
        <input v-model.number="form.gain" type="range" min="0" max="1" step="0.01" />
        <span class="small muted">{{ Math.round(form.gain * 100) }}</span>
      </label>
      <label class="field">
        <span>Default pan</span>
        <input v-model.number="form.pan" type="range" min="-1" max="1" step="0.01" />
        <span class="small muted">{{ Math.round(form.pan * 100) }}</span>
      </label>
      <label class="field span-2">
        <span>Default reverb</span>
        <select v-model="form.reverb">
          <option value="">Dry (no send)</option>
          <option v-for="preset in REVERB_PRESETS" :key="preset" :value="preset">
            {{ preset }}
          </option>
        </select>
      </label>
      <div class="span-2">
        <span class="field-label">Default random trigger (seconds)</span>
        <TriggerEditor v-model="form.trigger" />
      </div>
    </div>

    <template #actions>
      <button class="btn-sm" @click="closeGroupEditor">Cancel</button>
      <button class="btn-primary" @click="save">Save group</button>
    </template>
  </Modal>
</template>
