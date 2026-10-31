<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { pb } from '../lib/pocketbase'
import { itemTypeLabel, type CatalogRecord } from '../lib/catalog'

const props = defineProps<{ systemId: string }>()
const emit = defineEmits<{ select: [record: CatalogRecord] }>()
const query = ref('')
const source = ref('')
const itemType = ref('')
const rarity = ref('')
const records = ref<CatalogRecord[]>([])
const sources = ref<string[]>([])
const types = ref<string[]>([])
const rarities = ref<string[]>([])
const loading = ref(false)
const error = ref('')
let token = 0

const system = ref<{ key: string } | null>(null)
const showDndFilters = computed(() => system.value?.key === 'dnd5e')

onMounted(async () => {
  try {
    system.value = await pb.collection('systems').getOne<{ key: string }>(props.systemId)
    await loadChoices()
  } catch { error.value = 'Catalog filters could not be loaded.' }
})
watch(() => props.systemId, async () => { system.value = null; await loadChoices() })
watch([query, source, itemType, rarity], loadRecords)

async function loadChoices() {
  if (!props.systemId) return
  try {
    const all = await pb.collection('catalog').getFullList<CatalogRecord>({
      filter: pb.filter('system = {:system} && type = "item"', { system: props.systemId }),
      fields: 'source,item_type,rarity', sort: 'source,name',
    })
    sources.value = unique(all.map((entry) => entry.source))
    types.value = unique(all.map((entry) => typeof entry.item_type === 'string' ? entry.item_type.split('|')[0] : '').filter(Boolean))
    rarities.value = unique(all.map((entry) => entry.rarity ?? '').filter(Boolean))
    if (showDndFilters.value && !source.value && sources.value.includes('PHB')) source.value = 'PHB'
  } catch { error.value = 'Catalog filters could not be loaded.' }
  await loadRecords()
}

async function loadRecords() {
  const current = ++token
  if (!props.systemId) return
  loading.value = true
  error.value = ''
  const terms = ['system = {:system}', 'type = "item"']
  const params: Record<string, string> = { system: props.systemId }
  if (query.value.trim()) { terms.push('name ~ {:query}'); params.query = query.value.trim() }
  if (source.value) { terms.push('source = {:source}'); params.source = source.value }
  try {
    const result = await pb.collection('catalog').getFullList<CatalogRecord>({ filter: pb.filter(terms.join(' && '), params), sort: 'name' })
    if (current !== token) return
    records.value = result.filter((entry) => (!itemType.value || entry.item_type === itemType.value || (typeof entry.item_type === 'string' && entry.item_type.split('|')[0] === itemType.value)) && (!rarity.value || entry.rarity === rarity.value)).slice(0, 100)
  } catch {
    if (current === token) error.value = 'Items could not be loaded. Check the connection and try again.'
  } finally { if (current === token) loading.value = false }
}

function unique(values: string[]) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)) }
</script>

<template>
  <div class="picker-panel">
    <label class="field-label" for="item-search">Search items</label>
    <input id="item-search" v-model="query" class="text-input" type="search" placeholder="Search catalog items…" />
    <div v-if="showDndFilters" class="catalog-filters">
      <label class="filter-field"><span>Source</span><select v-model="source" class="select-input"><option value="">All sources</option><option v-for="entry in sources" :key="entry" :value="entry">{{ entry }}</option></select></label>
      <label class="filter-field"><span>Type</span><select v-model="itemType" class="select-input"><option value="">All types</option><option v-for="entry in types" :key="entry" :value="entry">{{ itemTypeLabel(entry) || entry }}</option></select></label>
      <label class="filter-field"><span>Rarity</span><select v-model="rarity" class="select-input"><option value="">All rarities</option><option v-for="entry in rarities" :key="entry" :value="entry">{{ entry }}</option></select></label>
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }} <button class="inline-button" type="button" @click="loadRecords">Retry</button></p>
    <p v-else-if="loading" class="muted-hint" role="status">Searching items…</p>
    <p v-else-if="!records.length" class="muted-hint">No matching catalog items.</p>
    <div v-else class="picker-results"><button v-for="record in records" :key="record.id" class="picker-result" type="button" @click="emit('select', record)"><span><strong>{{ record.name }}</strong><small>{{ record.source }}<template v-if="record.rarity"> · {{ record.rarity }}</template></small></span><span aria-hidden="true">＋</span></button></div>
  </div>
</template>
