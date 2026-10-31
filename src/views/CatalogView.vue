<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import CatalogFilters from '../components/CatalogFilters.vue'
import { pb } from '../lib/pocketbase'
import { matchesCatalog } from '../lib/catalogFilters'
import type { CatalogRecord, CatalogType } from '../lib/catalog'
import { systemByKey } from '../lib/systems'

type SystemRecord = { id: string; key: string; name: string }
const systems = ref<SystemRecord[]>([])
const systemId = ref('')
const selectedType = ref<CatalogType>('spell')
const query = ref('')
const selected = ref<Record<string, string>>({})
const records = ref<CatalogRecord[]>([])
const page = ref(1)
const perPage = 30
const loading = ref(false)
const error = ref('')
let token = 0
const systemRecord = computed(() => systems.value.find((entry) => entry.id === systemId.value))
const system = computed(() => systemByKey(systemRecord.value?.key))
const filters = computed(() => system.value.catalog.filters[selectedType.value] ?? [])
const matches = computed(() => records.value.filter((record) => matchesCatalog(record, filters.value, selected.value, query.value)).sort(system.value.catalog.compare))
const pages = computed(() => Math.max(1, Math.ceil(matches.value.length / perPage)))
const displayed = computed(() => matches.value.slice((page.value - 1) * perPage, page.value * perPage))
onMounted(async () => {
  try {
    systems.value = await pb.collection('systems').getFullList<SystemRecord>({ sort: 'name' })
    let saved = ''; try { saved = localStorage.getItem('olea.catalogSystem') ?? '' } catch { /* Optional preference. */ }
    systemId.value = systems.value.find((entry) => entry.key === saved)?.id ?? systems.value[0]?.id ?? ''
  } catch { error.value = 'Systems could not be loaded. Check the local server and try again.' }
})
watch([systemId, selectedType], () => { selected.value = {}; page.value = 1; void load() })
watch([query, selected], () => { page.value = 1 })
function saveSystem() { try { if (systemRecord.value) localStorage.setItem('olea.catalogSystem', systemRecord.value.key) } catch { /* Optional preference. */ } }
async function load() {
  const current = ++token
  records.value = []
  if (!systemId.value) return
  loading.value = true; error.value = ''
  try {
    const result = await pb.collection('catalog').getFullList<CatalogRecord>({ filter: pb.filter('system = {:system} && type = {:type}', { system: systemId.value, type: selectedType.value }), sort: 'name', requestKey: null })
    if (current === token) { records.value = result; selected.value = system.value.catalog.defaultFilters(selectedType.value, result) }
  } catch { if (current === token) error.value = 'Catalog entries could not be loaded. Check the connection and try again.' }
  finally { if (current === token) loading.value = false }
}
</script>
<template>
  <section class="screen" aria-labelledby="page-title">
    <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> TABLE REFERENCE</p><h1 id="page-title">Catalog</h1><p class="screen-description">Browse imported spells, creatures, and items for your game system.</p></div></div>
    <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Try again</button></p>
    <div class="catalog-controls"><label class="field-label" for="catalog-system">System</label><select id="catalog-system" v-model="systemId" class="select-input" @change="saveSystem"><option v-for="entry in systems" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select><div class="catalog-type-tabs" aria-label="Catalog type"><button v-for="entry in (['spell', 'creature', 'item'] as CatalogType[])" :key="entry" type="button" :aria-pressed="selectedType === entry" :class="{ selected: selectedType === entry }" @click="selectedType = entry">{{ entry === 'creature' ? 'Creatures' : `${entry[0].toUpperCase()}${entry.slice(1)}s` }}</button></div><label class="field-label" for="catalog-search">Search by name</label><input id="catalog-search" v-model="query" class="text-input" type="search" placeholder="Search catalog…" autocomplete="off" /><CatalogFilters v-model="selected" :filters="filters" :records="records" /></div>
    <div v-if="loading" class="loading-state" role="status">Loading catalog…</div><p v-else class="catalog-count" role="status">{{ matches.length }} {{ matches.length === 1 ? 'entry' : 'entries' }}</p>
    <div v-if="!loading && displayed.length" class="catalog-list"><RouterLink v-for="record in displayed" :key="record.id" class="catalog-row" :to="{ name: 'catalog-detail', params: { recordId: record.id } }"><span class="catalog-kind-icon" aria-hidden="true">{{ selectedType === 'spell' ? '✧' : selectedType === 'creature' ? '♜' : '◇' }}</span><span class="catalog-row-copy"><strong>{{ record.name }}</strong><small>{{ system.catalog.resultLabel(record) }}</small></span><span class="catalog-open" aria-hidden="true">→</span></RouterLink></div>
    <div v-else-if="!loading && !error" class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">⌕</div><h2>No matching entries</h2><p>Try a different search or clear one or more filters.</p></div><nav v-if="pages > 1" class="catalog-pagination" aria-label="Catalog pages"><button class="secondary-button" type="button" :disabled="page <= 1" @click="page--">Previous</button><span>Page {{ page }} of {{ pages }}</span><button class="secondary-button" type="button" :disabled="page >= pages" @click="page++">Next</button></nav>
  </section>
</template>
