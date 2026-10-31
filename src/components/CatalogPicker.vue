<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { pb } from '../lib/pocketbase'
import { compareChallengeRating, itemTypeLabel, type CatalogRecord } from '../lib/catalog'

const props = withDefaults(defineProps<{ systemId: string; type?: 'item' | 'spell' | 'creature' }>(), { type: 'item' })
const emit = defineEmits<{ select: [record: CatalogRecord] }>()
const query = ref('')
const source = ref('')
const itemType = ref('')
const rarity = ref('')
const level = ref('')
const school = ref('')
const creatureType = ref('')
const minCR = ref('')
const maxCR = ref('')
const records = ref<CatalogRecord[]>([])
const sources = ref<string[]>([])
const types = ref<string[]>([])
const rarities = ref<string[]>([])
const schools = ref<string[]>([])
const creatureTypes = ref<string[]>([])
const challengeRatings = ref<string[]>([])
const loading = ref(false)
const error = ref('')
const limit = ref(100)
const matchCount = ref(0)
let token = 0

const system = ref<{ key: string } | null>(null)
const showDndFilters = computed(() => system.value?.key === 'dnd5e')

onMounted(async () => {
  try {
    system.value = await pb.collection('systems').getOne<{ key: string }>(props.systemId)
    await loadChoices()
  } catch { error.value = 'Catalog filters could not be loaded.' }
})
watch(() => props.systemId, async () => {
  system.value = null
  source.value = ''; itemType.value = ''; rarity.value = ''; level.value = ''; school.value = ''; creatureType.value = ''; minCR.value = ''; maxCR.value = ''
  try {
    if (props.systemId) system.value = await pb.collection('systems').getOne<{ key: string }>(props.systemId)
    await loadChoices()
  } catch { error.value = 'Catalog filters could not be loaded.' }
})
watch([query, source, itemType, rarity, level, school, creatureType, minCR, maxCR], () => { limit.value = 100; void loadRecords() })
watch(limit, loadRecords)

async function loadChoices() {
  if (!props.systemId) return
  try {
    const all = await pb.collection('catalog').getFullList<CatalogRecord>({
      filter: pb.filter('system = {:system} && type = {:type}', { system: props.systemId, type: props.type }),
      fields: 'source,item_type,rarity,school,level,creature_type,challenge_rating', sort: 'source,name', requestKey: null,
    })
    sources.value = unique(all.map((entry) => entry.source))
    types.value = unique(all.map((entry) => typeof entry.item_type === 'string' ? entry.item_type.split('|')[0] : '').filter(Boolean))
    rarities.value = unique(all.map((entry) => entry.rarity ?? '').filter(Boolean))
    schools.value = unique(all.map((entry) => entry.school ?? '').filter(Boolean))
    creatureTypes.value = unique(all.map((entry) => entry.creature_type ?? '').filter(Boolean))
    challengeRatings.value = unique(all.map((entry) => entry.challenge_rating ?? '').filter(Boolean)).sort(compareChallengeRating)
    if (showDndFilters.value && !source.value && sources.value.includes('PHB')) source.value = 'PHB'
  } catch { error.value = 'Catalog filters could not be loaded.' }
  await loadRecords()
}

async function loadRecords() {
  const current = ++token
  if (!props.systemId) return
  loading.value = true
  error.value = ''
  const terms = ['system = {:system}', 'type = {:type}']
  const params: Record<string, string> = { system: props.systemId, type: props.type }
  if (query.value.trim()) { terms.push('name ~ {:query}'); params.query = query.value.trim() }
  if (source.value) { terms.push('source = {:source}'); params.source = source.value }
  if (level.value) { terms.push('level = {:level}'); params.level = level.value }
  if (school.value) { terms.push('school = {:school}'); params.school = school.value }
  if (creatureType.value) { terms.push('creature_type = {:creatureType}'); params.creatureType = creatureType.value }
  try {
    const result = await pb.collection('catalog').getFullList<CatalogRecord>({ filter: pb.filter(terms.join(' && '), params), sort: 'name', requestKey: null })
    if (current !== token) return
    const matches = result.filter((entry) => props.type === 'item'
      ? (!itemType.value || entry.item_type === itemType.value || (typeof entry.item_type === 'string' && entry.item_type.split('|')[0] === itemType.value)) && (!rarity.value || entry.rarity === rarity.value)
      : props.type !== 'creature' || ((!minCR.value && !maxCR.value) || !!entry.challenge_rating && (!minCR.value || compareChallengeRating(entry.challenge_rating, minCR.value) >= 0) && (!maxCR.value || compareChallengeRating(entry.challenge_rating, maxCR.value) <= 0)))
    matchCount.value = matches.length
    records.value = matches.slice(0, limit.value)
  } catch {
    if (current === token) error.value = 'Catalog entries could not be loaded. Check the connection and try again.'
  } finally { if (current === token) loading.value = false }
}

function unique(values: string[]) { return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }
</script>

<template>
  <div class="picker-panel">
    <label class="field-label" for="item-search">Search {{ props.type === 'spell' ? 'spells' : props.type === 'creature' ? 'creatures' : 'items' }}</label>
    <input id="item-search" v-model="query" class="text-input" type="search" :placeholder="`Search catalog ${props.type === 'spell' ? 'spells' : props.type === 'creature' ? 'creatures' : 'items'}…`" />
    <div v-if="showDndFilters" class="catalog-filters">
      <label class="filter-field"><span>Source</span><select v-model="source" class="select-input"><option value="">All sources</option><option v-for="entry in sources" :key="entry" :value="entry">{{ entry }}</option></select></label>
      <template v-if="props.type === 'item'"><label class="filter-field"><span>Type</span><select v-model="itemType" class="select-input"><option value="">All types</option><option v-for="entry in types" :key="entry" :value="entry">{{ itemTypeLabel(entry) || entry }}</option></select></label><label class="filter-field"><span>Rarity</span><select v-model="rarity" class="select-input"><option value="">All rarities</option><option v-for="entry in rarities" :key="entry" :value="entry">{{ entry }}</option></select></label></template>
      <template v-else-if="props.type === 'spell'"><label class="filter-field"><span>Level</span><select v-model="level" class="select-input"><option value="">All levels</option><option v-for="entry in 10" :key="entry - 1" :value="String(entry - 1)">{{ entry === 1 ? 'Cantrip' : `Level ${entry - 1}` }}</option></select></label><label class="filter-field"><span>School</span><select v-model="school" class="select-input"><option value="">All schools</option><option v-for="entry in schools" :key="entry" :value="entry">{{ entry }}</option></select></label></template>
      <template v-else><label class="filter-field"><span>Creature type</span><select v-model="creatureType" class="select-input"><option value="">All types</option><option v-for="entry in creatureTypes" :key="entry" :value="entry">{{ entry }}</option></select></label><label class="filter-field"><span>Minimum CR</span><select v-model="minCR" class="select-input"><option value="">Any</option><option v-for="entry in challengeRatings" :key="entry" :value="entry">{{ entry }}</option></select></label><label class="filter-field"><span>Maximum CR</span><select v-model="maxCR" class="select-input"><option value="">Any</option><option v-for="entry in challengeRatings" :key="entry" :value="entry">{{ entry }}</option></select></label></template>
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }} <button class="inline-button" type="button" @click="loadRecords">Retry</button></p>
    <p v-else-if="loading" class="muted-hint" role="status">Searching catalog…</p>
    <p v-else-if="!records.length" class="muted-hint">No matching catalog entries.</p>
    <div v-else class="picker-results"><button v-for="record in records" :key="record.id" class="picker-result" type="button" @click="emit('select', record)"><span><strong>{{ record.name }}</strong><small>{{ record.source }}<template v-if="props.type === 'spell'"> · {{ record.level === '0' ? 'Cantrip' : `Level ${record.level}` }} · {{ record.school }}</template><template v-else-if="props.type === 'creature'"> · {{ record.creature_type || 'Unknown type' }} · CR {{ record.challenge_rating || '—' }}</template><template v-else-if="record.rarity"> · {{ record.rarity }}</template></small></span><span aria-hidden="true">＋</span></button></div>
    <button v-if="!loading && records.length < matchCount" class="secondary-button" type="button" @click="limit += 100">Show more ({{ matchCount - records.length }} remaining)</button>
  </div>
</template>
