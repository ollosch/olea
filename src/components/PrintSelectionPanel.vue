<script setup lang="ts">
import { computed, useId } from 'vue'

export type PrintSelectionOption = {
  id: string
  name: string
  meta?: string
  detail?: string
  warning?: string
}

const props = withDefaults(defineProps<{
  eyebrow?: string
  title: string
  description?: string
  legend: string
  options: readonly PrintSelectionOption[]
  selected: readonly string[]
  emptyText: string
  noun: string
  name: string
}>(), { eyebrow: '', description: '' })
const emit = defineEmits<{ 'update:selected': [value: string[]] }>()
const titleId = useId()

const selectedSet = computed(() => new Set(props.selected))
const selectedOptions = computed(() => props.options.filter((option) => selectedSet.value.has(option.id)))
const selectedCount = computed(() => selectedOptions.value.length)
const warningCount = computed(() => selectedOptions.value.filter((option) => option.warning).length)
const allSelected = computed(() => props.options.length > 0 && selectedCount.value === props.options.length)
const countLabel = computed(() => `${selectedCount.value} of ${props.options.length} ${props.noun}${props.options.length === 1 ? '' : 's'} selected`)

function update(next: Set<string>) {
  emit('update:selected', props.options.filter((option) => next.has(option.id)).map((option) => option.id))
}

function toggle(id: string, event: Event) {
  const next = new Set(props.selected)
  if ((event.target as HTMLInputElement).checked) next.add(id)
  else next.delete(id)
  update(next)
}

function selectAll() {
  update(new Set(props.options.map((option) => option.id)))
}

function clear() {
  update(new Set())
}
</script>

<template>
  <section class="card-selection" :data-selection="name" :aria-labelledby="titleId">
    <div class="card-selection-head">
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h2 :id="titleId">{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
      <p class="selection-status" role="status" aria-live="polite">
        {{ countLabel }}<template v-if="warningCount"> · {{ warningCount }} selected {{ noun }}{{ warningCount === 1 ? '' : 's' }} {{ warningCount === 1 ? 'has a warning' : 'have warnings' }}.</template>
      </p>
      <slot name="note" />
    </div>
    <div class="row-actions card-selection-actions">
      <button class="secondary-button" type="button" :disabled="allSelected || !options.length" @click="selectAll">Select all {{ noun }}s</button>
      <button class="secondary-button" type="button" :disabled="!selectedCount" @click="clear">Clear {{ noun }}s</button>
    </div>
    <fieldset class="selection-fieldset">
      <legend class="visually-hidden">{{ legend }}</legend>
      <label v-for="option in options" :key="option.id" class="print-choice">
        <input type="checkbox" :checked="selectedSet.has(option.id)" @change="toggle(option.id, $event)" />
        <span class="print-choice-copy">
          <strong>{{ option.name }}<small v-if="option.meta">{{ option.meta }}</small></strong>
          <small v-if="option.detail">{{ option.detail }}</small>
          <small v-if="option.warning" class="print-choice-warning">{{ option.warning }}</small>
        </span>
      </label>
    </fieldset>
    <p v-if="!options.length" class="muted-hint">{{ emptyText }}</p>
  </section>
</template>
