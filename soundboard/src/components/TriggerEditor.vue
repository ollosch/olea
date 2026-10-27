<script setup>
import { computed } from 'vue'
import { sanitizeTrigger } from '../../lib/v3/schema.js'

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const value = computed(() => sanitizeTrigger(props.modelValue))

function update(field, event) {
  const n = Number(event.target.value)
  emit('update:modelValue', sanitizeTrigger({ ...value.value, [field]: Number.isFinite(n) ? n : 0 }))
}
</script>

<template>
  <div class="trigger-editor">
    <label class="field">
      <span>Min</span>
      <input
        type="number"
        min="0"
        step="0.5"
        :value="value.min"
        :disabled="props.disabled"
        @change="update('min', $event)"
      />
    </label>
    <label class="field">
      <span>Max</span>
      <input
        type="number"
        min="0"
        step="0.5"
        :value="value.max"
        :disabled="props.disabled"
        @change="update('max', $event)"
      />
    </label>
    <label class="field">
      <span>Start min</span>
      <input
        type="number"
        min="0"
        step="0.5"
        :value="value.startMin"
        :disabled="props.disabled"
        @change="update('startMin', $event)"
      />
    </label>
    <label class="field">
      <span>Start max</span>
      <input
        type="number"
        min="0"
        step="0.5"
        :value="value.startMax"
        :disabled="props.disabled"
        @change="update('startMax', $event)"
      />
    </label>
  </div>
</template>
