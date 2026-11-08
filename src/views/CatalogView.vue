<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter, type LocationQueryRaw, type RouteLocationNamedRaw } from 'vue-router'
import CatalogFilters from '../components/CatalogFilters.vue'
import { pb } from '../lib/pocketbase'
import { filterChoices, matchesCatalog } from '../lib/catalogFilters'
import type { CatalogRecord, CatalogType } from '../lib/catalog'
import { systemByKey } from '../lib/systems'
import { catalogPage, isCatalogType, normalizedCatalogType, queryString, readCatalogFilters } from '../lib/catalogRoute'
import { readCatalogEntrySnapshot, saveCatalogEntrySnapshot } from '../lib/catalogHistory'

type SystemRecord = { id: string; key: string; name: string }
const route = useRoute()
const router = useRouter()
const systems = ref<SystemRecord[]>([])
const systemsLoaded = ref(false)
const resolvedSystem = ref<SystemRecord | null>(null)
const records = ref<CatalogRecord[]>([])
const loading = ref(true)
const error = ref('')
const perPage = 30
let loadToken = 0
let contextToken = 0
let scrollFrame = 0
let restoreScheduled = false
let restoreCancelled = false
let disposed = false
let activatedRecordId = ''
let previousScrollRestoration: History['scrollRestoration'] | null = null

const selectedType = computed(() => normalizedCatalogType(route.query.type))
const systemId = computed({
  get: () => resolvedSystem.value?.id ?? '',
  set: (id: string) => {
    const next = systems.value.find((entry) => entry.id === id)
    if (!next) return
    try { localStorage.setItem('olea.catalogSystem', next.key) } catch { /* Optional preference. */ }
    void updateQuery((query) => {
      query.system = next.key
      delete query.page
      for (const filter of filters.value) delete query[filter.key]
    })
  },
})
const systemRecord = computed(() => resolvedSystem.value)
const system = computed(() => systemByKey(systemRecord.value?.key))
const filters = computed(() => system.value.catalog.filters[selectedType.value] ?? [])
const routeFilterState = computed(() => readCatalogFilters(route.query, filters.value))
const searchQuery = computed({
  get: () => queryString(route.query.q),
  set: (value: string) => {
    void updateQuery((query) => {
      if (value) query.q = value
      else delete query.q
      delete query.page
    })
  },
})
const selected = computed<Record<string, string>>({
  get: () => {
    if (routeFilterState.value.explicit) return routeFilterState.value.values
    if (loading.value || !records.value.length) return {}
    return system.value.catalog.defaultFilters(selectedType.value, records.value)
  },
  set: (value: Record<string, string>) => {
    void updateQuery((query) => {
      for (const filter of filters.value) {
        const next = value[filter.key]
        if (next === undefined) delete query[filter.key]
        else query[filter.key] = next
      }
      delete query.page
    })
  },
})
const matches = computed(() => records.value.filter((record) => matchesCatalog(record, filters.value, selected.value, searchQuery.value)).sort(system.value.catalog.compare))
const pages = computed(() => Math.max(1, Math.ceil(matches.value.length / perPage)))
const requestedPage = computed(() => catalogPage(route.query.page))
const effectivePage = computed(() => Math.min(requestedPage.value.page, pages.value))
const page = computed({
  get: () => effectivePage.value,
  set: (value: number) => {
    void updateQuery((query) => {
      if (value > 1) query.page = String(value)
      else delete query.page
    })
  },
})
const displayed = computed(() => matches.value.slice((effectivePage.value - 1) * perPage, effectivePage.value * perPage))

watch(() => route.query.type, (value) => {
  if (value !== undefined && !isCatalogType(queryString(value))) void updateQuery((query) => { delete query.type })
}, { immediate: true })

watch([() => route.query.system, selectedType], () => {
  if (systemsLoaded.value) void syncContext()
})

onMounted(async () => {
  previousScrollRestoration = 'scrollRestoration' in history ? history.scrollRestoration : null
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.addEventListener('wheel', cancelPendingRestore, { passive: true })
  window.addEventListener('touchstart', cancelPendingRestore, { passive: true })
  window.addEventListener('pointerdown', cancelPendingRestore, { passive: true })
  window.addEventListener('keydown', cancelPendingRestore)
  window.addEventListener('input', cancelPendingRestore)
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('focusin', saveEntryNow)
  window.addEventListener('pagehide', saveEntryNow)
  if (await loadSystems()) await syncContext()
})

onBeforeRouteLeave(() => {
  saveEntryNow()
  activatedRecordId = ''
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('wheel', cancelPendingRestore)
  window.removeEventListener('touchstart', cancelPendingRestore)
  window.removeEventListener('pointerdown', cancelPendingRestore)
  window.removeEventListener('keydown', cancelPendingRestore)
  window.removeEventListener('input', cancelPendingRestore)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('focusin', saveEntryNow)
  window.removeEventListener('pagehide', saveEntryNow)
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  if (previousScrollRestoration) history.scrollRestoration = previousScrollRestoration
})

async function updateQuery(change: (query: LocationQueryRaw) => void, mode: 'replace' | 'push' = 'replace') {
  const query: LocationQueryRaw = { ...route.query }
  change(query)
  const target = { path: route.path, query }
  if (router.resolve(target).fullPath === route.fullPath) return
  await (mode === 'push' ? router.push(target) : router.replace(target))
}

async function syncContext() {
  const token = ++contextToken
  if (!(await resolveSystem(token)) || token !== contextToken) return
  await load(token)
}

async function resolveSystem(token: number): Promise<boolean> {
  const explicit = queryString(route.query.system)
  if (explicit) {
    const found = systems.value.find((entry) => entry.key === explicit)
    if (found) {
      resolvedSystem.value = found
      return true
    }
    await updateQuery((query) => { delete query.system })
    return false
  }
  let saved = ''
  try { saved = localStorage.getItem('olea.catalogSystem') ?? '' } catch { /* Optional preference. */ }
  const preferred = systems.value.find((entry) => entry.key === saved)
  if (preferred) {
    resolvedSystem.value = preferred
    return true
  }
  const fallbackId = await defaultSystemId(saved, token)
  if (token !== contextToken) return false
  resolvedSystem.value = systems.value.find((entry) => entry.id === fallbackId) ?? null
  return true
}

async function defaultSystemId(savedKey: string, token: number): Promise<string> {
  const saved = systems.value.find((entry) => entry.key === savedKey)
  if (saved) return saved.id
  for (const entry of systems.value) {
    try {
      const result = await pb.collection('catalog').getList(1, 1, {
        filter: pb.filter('system = {:system} && type = {:type}', { system: entry.id, type: selectedType.value }),
        fields: 'id',
        requestKey: null,
      })
      if (token !== contextToken) return ''
      if (result.totalItems > 0) return entry.id
    } catch { /* Try the next system. */ }
  }
  return systems.value[0]?.id ?? ''
}

async function loadSystems(): Promise<boolean> {
  try {
    systems.value = await pb.collection('systems').getFullList<SystemRecord>({ sort: 'name' })
    systemsLoaded.value = true
    return true
  } catch {
    error.value = 'Systems could not be loaded. Check the local server and try again.'
    loading.value = false
    return false
  }
}

async function load(context: number) {
  const current = ++loadToken
  const selectedSystem = resolvedSystem.value
  records.value = []
  if (!selectedSystem) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  let loaded = false
  try {
    const result = await pb.collection('catalog').getFullList<CatalogRecord>({
      filter: pb.filter('system = {:system} && type = {:type}', { system: selectedSystem.id, type: selectedType.value }),
      sort: 'name',
      requestKey: null,
    })
    if (current !== loadToken || context !== contextToken) return
    records.value = result
    loaded = true
  } catch {
    if (current !== loadToken || context !== contextToken) return
    error.value = 'Catalog entries could not be loaded. Check the connection and try again.'
  } finally {
    if (current === loadToken && context === contextToken && !disposed) {
      loading.value = false
      if (loaded) {
        await nextTick()
        await sanitizeState()
        scheduleRestore()
      }
    }
  }
}

async function retry() {
  error.value = ''
  if (!systemsLoaded.value) {
    if (!(await loadSystems())) return
  }
  await syncContext()
}

function chooseType(type: CatalogType) {
  if (type === selectedType.value) return
  void updateQuery((query) => {
    query.type = type
    delete query.page
    for (const filter of filters.value) delete query[filter.key]
  })
}

function detailLink(record: CatalogRecord): RouteLocationNamedRaw {
  return {
    name: 'catalog-detail',
    params: { recordId: record.id },
    query: { from: route.fullPath },
    state: { catalogReturn: true },
  }
}

function activateRecord(recordId: string) { activatedRecordId = recordId }

async function sanitizeState() {
  if (disposed || loading.value) return
  const query: LocationQueryRaw = { ...route.query }
  let structuralChanged = false
  const type = queryString(route.query.type)
  if (type && !isCatalogType(type)) { delete query.type; structuralChanged = true }
  const explicitSystem = queryString(route.query.system)
  if (explicitSystem && !systems.value.some((entry) => entry.key === explicitSystem)) { delete query.system; structuralChanged = true }
  const choices = Object.fromEntries(filters.value.map((filter) => [filter.key, filterChoices(records.value, filter)]))
  for (const filter of filters.value) {
    const value = query[filter.key]
    if (typeof value !== 'string') continue
    if (value !== '' && !choices[filter.key]?.includes(value)) { delete query[filter.key]; structuralChanged = true }
  }
  if (structuralChanged) {
    const target = { path: route.path, query }
    if (router.resolve(target).fullPath === route.fullPath) return
    await router.replace(target)
    await nextTick()
    // Recompute matches with the sanitized filters before clamping the page.
    return sanitizeState()
  }
  const requested = catalogPage(route.query.page)
  let pageChanged = false
  if (!requested.valid) {
    if ('page' in query) { delete query.page; pageChanged = true }
  } else if (requested.page > pages.value) {
    if (pages.value <= 1) {
      if ('page' in query) { delete query.page; pageChanged = true }
    } else if (query.page !== String(pages.value)) {
      query.page = String(pages.value)
      pageChanged = true
    }
  }
  if (!pageChanged) return
  const target = { path: route.path, query }
  if (router.resolve(target).fullPath !== route.fullPath) await router.replace(target)
}

function saveEntryNow() {
  const active = document.activeElement as HTMLElement | null
  const focusId = activatedRecordId ? `catalog-record-${activatedRecordId}` : active?.id || null
  saveCatalogEntrySnapshot({ scrollY: Math.max(0, Math.round(window.scrollY)), focusId, savedAt: Date.now() })
}

function onScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; saveEntryNow() })
}

function cancelPendingRestore() { restoreCancelled = true }

function scheduleRestore() {
  if (restoreScheduled) return
  restoreScheduled = true
  requestAnimationFrame(() => {
    if (disposed || restoreCancelled) return
    const snapshot = readCatalogEntrySnapshot()
    if (!snapshot) {
      window.scrollTo({ top: 0, left: 0 })
      return
    }
    window.scrollTo({ top: snapshot.scrollY, left: 0 })
    if (snapshot.focusId) {
      const target = document.getElementById(snapshot.focusId) ?? document.getElementById('catalog-search')
      target?.focus({ preventScroll: true })
    }
  })
}
</script>
<template>
  <section class="screen" aria-labelledby="page-title">
    <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> TABLE REFERENCE</p><h1 id="page-title">Catalog</h1><p class="screen-description">Browse imported spells, creatures, and items for your game system.</p></div></div>
    <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="retry">Try again</button></p>
    <div class="catalog-controls"><label class="field-label" for="catalog-system">System</label><select id="catalog-system" v-model="systemId" class="select-input"><option v-for="entry in systems" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select><div class="catalog-type-tabs" aria-label="Catalog type"><button v-for="entry in (['spell', 'creature', 'item'] as CatalogType[])" :key="entry" type="button" :aria-pressed="selectedType === entry" :class="{ selected: selectedType === entry }" @click="chooseType(entry)">{{ entry === 'creature' ? 'Creatures' : `${entry[0].toUpperCase()}${entry.slice(1)}s` }}</button></div><label class="field-label" for="catalog-search">Search by name</label><input id="catalog-search" v-model="searchQuery" class="text-input" type="search" placeholder="Search catalog…" autocomplete="off" /><CatalogFilters v-model="selected" :filters="filters" :records="records" /></div>
    <div v-if="loading" class="loading-state" role="status">Loading catalog…</div><p v-else class="catalog-count" role="status">{{ matches.length }} {{ matches.length === 1 ? 'entry' : 'entries' }}</p>
    <div v-if="!loading && displayed.length" class="catalog-list"><RouterLink v-for="record in displayed" :id="`catalog-record-${record.id}`" :key="record.id" class="catalog-row" :data-catalog-record-id="record.id" :to="detailLink(record)" @click="activateRecord(record.id)"><span class="catalog-kind-icon" aria-hidden="true">{{ selectedType === 'spell' ? '✧' : selectedType === 'creature' ? '♜' : '◇' }}</span><span class="catalog-row-copy"><strong>{{ record.name }}</strong><small>{{ system.catalog.resultLabel(record) }}</small></span><span class="catalog-open" aria-hidden="true">→</span></RouterLink></div>
    <div v-else-if="!loading && !error" class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">⌕</div><h2>No matching entries</h2><p>Try a different search or clear one or more filters.</p></div><nav v-if="pages > 1" class="catalog-pagination" aria-label="Catalog pages"><button class="secondary-button" type="button" :disabled="page <= 1" @click="page--">Previous</button><span>Page {{ page }} of {{ pages }}</span><button class="secondary-button" type="button" :disabled="page >= pages" @click="page++">Next</button></nav>
  </section>
</template>
