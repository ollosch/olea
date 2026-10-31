<script setup lang="ts">
import { computed } from 'vue'
import { filterChoices } from '../lib/catalogFilters'
import type { CatalogRecord } from '../lib/catalog'
import type { CatalogFilter } from '../lib/systems'

const props = defineProps<{ records: CatalogRecord[]; filters: readonly CatalogFilter[]; modelValue: Record<string, string> }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>()
const choices = computed(() => Object.fromEntries(props.filters.map((filter) => [filter.key, filterChoices(props.records, filter)])))
</script>
<template>
  <div class="catalog-filters">
    <label v-for="filter in filters" :key="filter.key" class="filter-field"><span>{{ filter.label }}</span><select class="select-input" :value="modelValue[filter.key] || ''" @change="emit('update:modelValue', { ...modelValue, [filter.key]: ($event.target as HTMLSelectElement).value })"><option value="">Any</option><option v-for="value in choices[filter.key]" :key="value" :value="value">{{ filter.labelValue?.(value) || value }}</option></select></label>
  </div>
</template>
