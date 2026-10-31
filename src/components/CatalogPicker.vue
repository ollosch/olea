<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import CatalogFilters from './CatalogFilters.vue'
import { pb } from '../lib/pocketbase'
import { matchesCatalog } from '../lib/catalogFilters'
import { systemByKey } from '../lib/systems'
import type { CatalogRecord, CatalogType } from '../lib/catalog'

const props = withDefaults(defineProps<{ systemId: string; type?: CatalogType }>(), { type: 'item' })
const emit = defineEmits<{ select: [record: CatalogRecord] }>()
const query = ref('')
const selected = ref<Record<string, string>>({})
const records = ref<CatalogRecord[]>([])
const key = ref('')
const loading = ref(false)
const error = ref('')
const limit = ref(100)
let token = 0
const system = computed(() => systemByKey(key.value))
const filters = computed(() => system.value.catalog.filters[props.type] ?? [])
const matches = computed(() => records.value.filter((record) => matchesCatalog(record, filters.value, selected.value, query.value)).sort(system.value.catalog.compare))
onMounted(load)
watch(() => [props.systemId, props.type], () => { selected.value = {}; void load() })
watch([query, selected], () => { limit.value = 100 })
async function load() {
  const current = ++token
  records.value = []; key.value = ''
  if (!props.systemId) return
  loading.value = true; error.value = ''
  try {
    const [systemRecord, entries] = await Promise.all([
      pb.collection('systems').getOne<{ key: string }>(props.systemId, { requestKey: null }),
      pb.collection('catalog').getFullList<CatalogRecord>({ filter: pb.filter('system = {:system} && type = {:type}', { system: props.systemId, type: props.type }), sort: 'name', requestKey: null }),
    ])
    if (current !== token) return
    key.value = systemRecord.key; records.value = entries; selected.value = system.value.catalog.defaultFilters(props.type, entries)
  } catch { if (current === token) error.value = 'Catalog entries could not be loaded. Check the connection and try again.' }
  finally { if (current === token) loading.value = false }
}
</script>
<template>
  <div class="picker-panel">
    <label class="field-label" for="item-search">Search {{ props.type }}s</label>
    <input id="item-search" v-model="query" class="text-input" type="search" :placeholder="`Search catalog ${props.type}s…`" />
    <CatalogFilters v-model="selected" :filters="filters" :records="records" />
    <p v-if="error" class="field-error" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
    <p v-else-if="loading" class="muted-hint" role="status">Searching catalog…</p>
    <p v-else-if="!matches.length" class="muted-hint">No matching catalog entries.</p>
    <div v-else class="picker-results"><button v-for="record in matches.slice(0, limit)" :key="record.id" class="picker-result" type="button" @click="emit('select', record)"><span><strong>{{ record.name }}</strong><small>{{ system.catalog.resultLabel(record) }}</small></span><span aria-hidden="true">＋</span></button></div>
    <button v-if="!loading && limit < matches.length" class="secondary-button" type="button" @click="limit += 100">Show more ({{ matches.length - limit }} remaining)</button>
  </div>
</template>
