<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { pb } from '../lib/pocketbase'
import { compareChallengeRating, itemTypeLabel, type CatalogRecord, type CatalogType } from '../lib/catalog'

type SystemRecord = { id: string; key: string; name: string }
const systems = ref<SystemRecord[]>([])
const systemId = ref('')
const selectedType = ref<CatalogType>('spell')
const query = ref('')
const source = ref('')
const level = ref('')
const school = ref('')
const creatureType = ref('')
const minCR = ref('')
const maxCR = ref('')
const itemType = ref('')
const rarity = ref('')
const records = ref<CatalogRecord[]>([])
const sources = ref<string[]>([])
const schools = ref<string[]>([])
const creatureTypes = ref<string[]>([])
const itemTypes = ref<string[]>([])
const rarities = ref<string[]>([])
const totalItems = ref(0)
const page = ref(1)
const perPage = 30
const loading = ref(false)
const error = ref('')
let requestId = 0

const system = computed(() => systems.value.find((entry) => entry.id === systemId.value))
const isDnd5e = computed(() => system.value?.key === 'dnd5e')
const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / perPage)))
const sortedRecords = computed(() => selectedType.value === 'creature'
  ? [...records.value].sort((a, b) => compareChallengeRating(a.challenge_rating, b.challenge_rating) || a.name.localeCompare(b.name))
  : records.value)

onMounted(async () => {
  try {
    systems.value = await pb.collection('systems').getFullList<SystemRecord>({ sort: 'name' })
    const savedKey = readSystemKey()
    systemId.value = systems.value.find((entry) => entry.key === savedKey)?.id ?? systems.value[0]?.id ?? ''
  } catch {
    error.value = 'Systems could not be loaded. Check the local server and try again.'
  }
})

watch([systemId, selectedType], () => { page.value = 1; clearFilters(); void loadChoices() })
watch([systemId, selectedType, query, source, level, school, creatureType, minCR, maxCR, itemType, rarity, page], loadRecords)

function readSystemKey(): string {
  try { return localStorage.getItem('olea.catalogSystem') ?? '' } catch { return '' }
}
function saveSystemKey() {
  try { if (system.value) localStorage.setItem('olea.catalogSystem', system.value.key) } catch { /* Optional local preference. */ }
}
function clearFilters() {
  source.value = ''; level.value = ''; school.value = ''; creatureType.value = ''
  minCR.value = ''; maxCR.value = ''; itemType.value = ''; rarity.value = ''
}

async function loadChoices() {
  if (!systemId.value) return
  try {
    const all = await pb.collection('catalog').getFullList<CatalogRecord>({
      filter: pb.filter('system = {:system} && type = {:type}', { system: systemId.value, type: selectedType.value }),
      fields: 'source,school,creature_type,item_type,rarity', sort: 'source,name',
    })
    sources.value = unique(all.map((record) => record.source))
    schools.value = unique(all.map((record) => record.school).filter(Boolean))
    creatureTypes.value = unique(all.map((record) => record.creature_type).filter(Boolean))
    itemTypes.value = unique(all.map((record) => typeof record.item_type === 'string' ? record.item_type : '').filter(Boolean))
    rarities.value = unique(all.map((record) => record.rarity ?? '').filter(Boolean))
    const primarySource = selectedType.value === 'creature' ? 'MM' : 'PHB'
    if (!source.value && isDnd5e.value && sources.value.includes(primarySource)) source.value = primarySource
  } catch {
    // The main query displays the actionable error state.
  }
}

async function loadRecords() {
  const token = ++requestId
  if (!systemId.value) { records.value = []; totalItems.value = 0; return }
  if ((minCR.value && !validCR(minCR.value)) || (maxCR.value && !validCR(maxCR.value))) {
    error.value = 'Challenge rating filters must be a whole number or a fraction such as 1/4.'
    records.value = []
    totalItems.value = 0
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  const terms = ['system = {:system}', 'type = {:type}']
  const params: Record<string, string | number> = { system: systemId.value, type: selectedType.value }
  if (query.value.trim()) { terms.push('name ~ {:query}'); params.query = query.value.trim() }
  if (source.value) { terms.push('source = {:source}'); params.source = source.value }
  if (level.value) { terms.push('level = {:level}'); params.level = level.value }
  if (school.value) { terms.push('school = {:school}'); params.school = school.value }
  if (creatureType.value) { terms.push('creature_type = {:creatureType}'); params.creatureType = creatureType.value }
  try {
    const filter = pb.filter(terms.join(' && '), params)
    if (selectedType.value === 'creature' || (selectedType.value === 'item' && (itemType.value || rarity.value))) {
      const all = await pb.collection('catalog').getFullList<CatalogRecord>({ filter, sort: 'name', expand: 'system' })
      if (token !== requestId) return
      const filtered = all.filter((record) => {
        if (selectedType.value === 'creature') {
          const cr = record.challenge_rating
          return (!minCR.value || compareChallengeRating(cr, minCR.value) >= 0)
            && (!maxCR.value || compareChallengeRating(cr, maxCR.value) <= 0)
        }
        return (!itemType.value || record.item_type === itemType.value)
          && (!rarity.value || record.rarity === rarity.value)
      }).sort((a, b) => selectedType.value === 'creature'
        ? compareChallengeRating(a.challenge_rating, b.challenge_rating) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name))
      totalItems.value = filtered.length
      records.value = filtered.slice((page.value - 1) * perPage, page.value * perPage)
    } else {
      const result = await pb.collection('catalog').getList<CatalogRecord>(page.value, perPage, { filter, sort: 'name', expand: 'system' })
      if (token !== requestId) return
      records.value = result.items
      totalItems.value = result.totalItems
    }
  } catch {
    if (token === requestId) error.value = 'Catalog entries could not be loaded. Check the connection and try again.'
  } finally {
    if (token === requestId) loading.value = false
  }
}

function unique(values: string[]) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)) }
function validCR(value: string) {
  if (!/^(?:\d+(?:\.\d+)?|\d+\/\d+)$/.test(value.trim())) return false
  const [numerator, denominator] = value.split('/').map(Number)
  return !denominator || denominator > 0 && numerator >= 0
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div class="screen-heading">
      <div><p class="eyebrow"><span class="eyebrow-line" /> TABLE REFERENCE</p><h1 id="page-title">Catalog</h1><p class="screen-description">Browse imported spells, creatures, and items for your game system.</p></div>
    </div>

    <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="loadRecords">Try again</button></p>
    <div class="catalog-controls">
      <label class="field-label" for="catalog-system">System</label>
      <select id="catalog-system" v-model="systemId" class="select-input" @change="saveSystemKey"><option v-for="entry in systems" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select>
      <div class="catalog-type-tabs" aria-label="Catalog type">
        <button v-for="entry in (['spell', 'creature', 'item'] as CatalogType[])" :key="entry" type="button" :aria-pressed="selectedType === entry" :class="{ selected: selectedType === entry }" @click="selectedType = entry">{{ entry === 'creature' ? 'Creatures' : `${entry[0].toUpperCase()}${entry.slice(1)}s` }}</button>
      </div>
      <label class="field-label" for="catalog-search">Search by name</label>
      <input id="catalog-search" v-model="query" class="text-input" type="search" placeholder="Search catalog…" autocomplete="off" />
      <div class="catalog-filters">
        <label class="filter-field"><span>Source</span><select v-model="source" class="select-input"><option value="">All sources</option><option v-for="entry in sources" :key="entry" :value="entry">{{ entry }}</option></select></label>
        <template v-if="isDnd5e && selectedType === 'spell'">
          <label class="filter-field"><span>Level</span><select v-model="level" class="select-input"><option value="">All levels</option><option v-for="entry in 10" :key="entry - 1" :value="String(entry - 1)">{{ entry === 1 ? 'Cantrip' : `Level ${entry - 1}` }}</option></select></label>
          <label class="filter-field"><span>School</span><select v-model="school" class="select-input"><option value="">All schools</option><option v-for="entry in schools" :key="entry" :value="entry">{{ entry }}</option></select></label>
        </template>
        <template v-if="isDnd5e && selectedType === 'creature'">
          <label class="filter-field"><span>Creature type</span><select v-model="creatureType" class="select-input"><option value="">All types</option><option v-for="entry in creatureTypes" :key="entry" :value="entry">{{ entry }}</option></select></label>
          <label class="filter-field"><span>Minimum CR</span><input v-model="minCR" class="text-input" inputmode="decimal" placeholder="e.g. 1/4" /></label>
          <label class="filter-field"><span>Maximum CR</span><input v-model="maxCR" class="text-input" inputmode="decimal" placeholder="e.g. 5" /></label>
        </template>
        <template v-if="isDnd5e && selectedType === 'item'">
          <label class="filter-field"><span>Type</span><select v-model="itemType" class="select-input"><option value="">All types</option><option v-for="entry in itemTypes" :key="entry" :value="entry">{{ itemTypeLabel(entry) || entry }}</option></select></label>
          <label class="filter-field"><span>Rarity</span><select v-model="rarity" class="select-input"><option value="">All rarities</option><option v-for="entry in rarities" :key="entry" :value="entry">{{ entry }}</option></select></label>
        </template>
      </div>
    </div>

    <div v-if="loading" class="loading-state" role="status">Loading catalog…</div>
    <p v-else class="catalog-count" role="status">{{ totalItems }} {{ totalItems === 1 ? 'entry' : 'entries' }}</p>
    <div v-if="!loading && sortedRecords.length" class="catalog-list">
      <RouterLink v-for="record in sortedRecords" :key="record.id" class="catalog-row" :to="{ name: 'catalog-detail', params: { recordId: record.id } }">
        <span class="catalog-kind-icon" aria-hidden="true">{{ selectedType === 'spell' ? '✧' : selectedType === 'creature' ? '♜' : '◇' }}</span>
        <span class="catalog-row-copy"><strong>{{ record.name }}</strong><small>{{ record.source }}<template v-if="selectedType === 'spell'"> · {{ record.level === '0' ? 'Cantrip' : `Level ${record.level}` }} · {{ record.school }}</template><template v-else-if="selectedType === 'creature'"> · {{ record.creature_type || 'Unknown type' }} · CR {{ record.challenge_rating || '—' }}</template><template v-else> · {{ itemTypeLabel(record.item_type) || 'Item' }}<template v-if="record.rarity"> · {{ record.rarity }}</template></template></small></span>
        <span class="catalog-open" aria-hidden="true">→</span>
      </RouterLink>
    </div>
    <div v-else-if="!loading && !error" class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">⌕</div><h2>No matching entries</h2><p>Try a different search or clear one or more filters.</p></div>
    <nav v-if="totalPages > 1" class="catalog-pagination" aria-label="Catalog pages"><button class="secondary-button" type="button" :disabled="page <= 1" @click="page--">Previous</button><span>Page {{ page }} of {{ totalPages }}</span><button class="secondary-button" type="button" :disabled="page >= totalPages" @click="page++">Next</button></nav>
  </section>
</template>
