<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { filterChoices } from '../lib/catalogFilters'
import type { CatalogRecord } from '../lib/catalog'
import type { CatalogFilter } from '../lib/systems'

const props = withDefaults(defineProps<{
  records: CatalogRecord[]
  filters: readonly CatalogFilter[]
  modelValue: Record<string, string>
  expanded?: boolean
}>(), {
  expanded: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>()
const open = ref(props.expanded)
const choices = computed(() => Object.fromEntries(props.filters.map((filter) => [filter.key, filterChoices(props.records, filter)])))
const appliedCount = computed(() => props.filters.filter((filter) => Boolean(props.modelValue[filter.key])).length)
const summary = computed(() => appliedCount.value ? `${appliedCount.value} applied` : 'Optional filters')

watch(() => props.expanded, (expanded) => {
  if (expanded) open.value = true
})

function update(filter: CatalogFilter, value: string) {
  emit('update:modelValue', { ...props.modelValue, [filter.key]: value })
}
</script>
<template>
  <div class="catalog-filters">
    <details class="catalog-filter-disclosure" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open">
      <summary class="catalog-filter-summary">
        <span>Advanced filters</span>
        <span class="catalog-filter-summary-count">{{ summary }}</span>
      </summary>
      <div v-if="filters.length" class="catalog-filter-grid">
        <label v-for="filter in filters" :key="filter.key" class="filter-field">
          <span>{{ filter.label }}</span>
          <select class="select-input" :value="modelValue[filter.key] || ''" @change="update(filter, ($event.target as HTMLSelectElement).value)">
            <option value="">Any</option>
            <option v-for="value in choices[filter.key]" :key="value" :value="value">{{ filter.labelValue?.(value) || value }}</option>
          </select>
        </label>
      </div>
      <p v-else class="muted-hint catalog-filter-empty">This catalog type has no additional filters.</p>
    </details>
  </div>
</template>
