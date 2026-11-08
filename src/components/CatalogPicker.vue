<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import CatalogFilters from './CatalogFilters.vue'
import { pb } from '../lib/pocketbase'
import { matchesCatalog } from '../lib/catalogFilters'
import { systemByKey } from '../lib/systems'
import type { CatalogRecord, CatalogType } from '../lib/catalog'

type PickerFeedback = { tone: 'status' | 'error'; message: string }

const props = withDefaults(defineProps<{
  open: boolean
  systemId: string
  type?: CatalogType
  title?: string
  description?: string
  /** Records the caller already holds, e.g. spells already in a book. */
  takenIds?: readonly string[]
  takenLabel?: string
  /** An asynchronous add is in flight; results cannot be selected again. */
  pending?: boolean
  /** Authoritative outcome from the caller's asynchronous add. */
  feedback?: PickerFeedback | null
}>(), {
  type: 'item',
  title: '',
  description: '',
  takenIds: () => [],
  takenLabel: 'Already added',
  pending: false,
  feedback: null,
})

const emit = defineEmits<{ select: [record: CatalogRecord]; 'update:open': [value: boolean] }>()
const instanceId = useId()
const searchId = `catalog-picker-search-${instanceId}`
const resultsId = `catalog-picker-results-${instanceId}`
const query = ref('')
const selected = ref<Record<string, string>>({})
const records = ref<CatalogRecord[]>([])
const key = ref('')
const loading = ref(false)
const error = ref('')
const limit = ref(100)
const filtersTouched = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
let token = 0
let scrollLocked = false
let lockedScroll = 0
let previousOverflow = ''
let previousPadding = ''

const system = computed(() => systemByKey(key.value))
const filters = computed(() => system.value.catalog.filters[props.type] ?? [])
const takenIds = computed(() => new Set(props.takenIds))
const appliedFilters = computed(() => filters.value.filter((filter) => Boolean(selected.value[filter.key])).length)
const matches = computed(() => records.value
  .filter((record) => matchesCatalog(record, filters.value, selected.value, query.value))
  .sort(system.value.catalog.compare))
const dialogTitle = computed(() => props.title || `Choose ${props.type === 'item' ? 'an item' : `a ${props.type}`}`)
const dialogDescription = computed(() => props.description ?? 'Search this game’s system catalog by name. Filters are optional, and selecting a result leaves this picker under the calling screen’s control.')

watch(() => [props.open, props.systemId, props.type] as const, ([open]) => {
  if (!open) {
    token++
    loading.value = false
    unlockScroll()
    return
  }
  lockScroll()
  resetControls()
  void load()
}, { immediate: true })

onBeforeUnmount(unlockScroll)

function lockScroll() {
  if (scrollLocked) return
  lockedScroll = window.scrollY
  previousOverflow = document.documentElement.style.overflow
  previousPadding = document.body.style.paddingRight
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
  document.documentElement.style.overflow = 'hidden'
  if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
  scrollLocked = true
}

function unlockScroll() {
  if (!scrollLocked) return
  const restoreTo = lockedScroll
  document.documentElement.style.overflow = previousOverflow
  document.body.style.paddingRight = previousPadding
  scrollLocked = false
  window.setTimeout(() => {
    if (!scrollLocked && Math.round(window.scrollY) !== restoreTo) window.scrollTo(0, restoreTo)
  }, 0)
}

function resetControls() {
  token++
  query.value = ''
  selected.value = {}
  records.value = []
  key.value = ''
  error.value = ''
  loading.value = false
  limit.value = 100
  filtersTouched.value = false
}

async function load() {
  const current = ++token
  records.value = []
  key.value = ''
  if (!props.systemId) return
  loading.value = true
  error.value = ''
  try {
    const [systemRecord, entries] = await Promise.all([
      pb.collection('systems').getOne<{ key: string }>(props.systemId, { requestKey: null }),
      pb.collection('catalog').getFullList<CatalogRecord>({ filter: pb.filter('system = {:system} && type = {:type}', { system: props.systemId, type: props.type }), sort: 'name', requestKey: null }),
    ])
    if (current !== token) return
    key.value = systemRecord.key
    records.value = entries
    if (!filtersTouched.value) selected.value = system.value.catalog.defaultFilters(props.type, entries)
  } catch {
    if (current === token) error.value = 'Catalog entries could not be loaded. Check the connection and try again.'
  } finally {
    if (current === token) loading.value = false
  }
}

async function retry() {
  await load()
  await nextTick()
  searchInput.value?.focus({ preventScroll: true })
}

function focusSearch(event: Event) {
  event.preventDefault()
  searchInput.value?.focus({ preventScroll: true })
}

function isTaken(record: CatalogRecord): boolean {
  return takenIds.value.has(record.id)
}

function updateSelected(value: Record<string, string>) {
  filtersTouched.value = true
  selected.value = value
}

function choose(record: CatalogRecord) {
  if (props.pending || isTaken(record)) return
  emit('select', record)
}

function clearSearchAndFilters() {
  query.value = ''
  filtersTouched.value = true
  selected.value = {}
  limit.value = 100
  void nextTick(() => searchInput.value?.focus({ preventScroll: true }))
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay picker-overlay" />
      <DialogContent class="picker-dialog" @open-auto-focus="focusSearch">
        <div class="picker-dialog-heading">
          <div>
            <p class="eyebrow">CATALOG</p>
            <DialogTitle class="picker-dialog-title">{{ dialogTitle }}</DialogTitle>
          </div>
          <DialogClose class="secondary-button" type="button" aria-label="Close catalog picker">Close</DialogClose>
        </div>
        <DialogDescription class="picker-dialog-description">{{ dialogDescription }}</DialogDescription>
        <div class="picker-panel">
          <label class="field-label" :for="searchId">Search {{ type }}s</label>
          <input :id="searchId" ref="searchInput" v-model="query" class="text-input" type="search" :placeholder="`Search catalog ${type}s…`" :aria-controls="resultsId" />
          <CatalogFilters :model-value="selected" :filters="filters" :records="records" @update:model-value="updateSelected" />
          <p v-if="feedback" :class="feedback.tone === 'error' ? 'field-error picker-feedback' : 'muted-hint picker-feedback'" :role="feedback.tone === 'error' ? 'alert' : 'status'">{{ feedback.message }}</p>
          <p v-if="error" class="field-error picker-feedback" role="alert">{{ error }} <button class="inline-button" type="button" @click="retry">Retry</button></p>
          <p v-else-if="loading" class="muted-hint picker-feedback" role="status">Searching catalog…</p>
          <p v-else-if="!matches.length" class="muted-hint picker-feedback">No matching catalog entries. <button v-if="query || appliedFilters" class="inline-button picker-clear" type="button" @click="clearSearchAndFilters">Clear search and filters</button></p>
          <div v-else :id="resultsId" class="picker-results" :aria-busy="pending">
            <button v-for="record in matches.slice(0, limit)" :key="record.id" class="picker-result" :class="{ 'is-taken': isTaken(record) }" type="button" :disabled="pending || isTaken(record)" @click="choose(record)">
              <span class="picker-result-copy">
                <strong>{{ record.name }}</strong>
                <small>{{ system.catalog.resultLabel(record) }}</small>
                <small v-if="isTaken(record)" class="picker-result-taken">{{ takenLabel }}</small>
              </span>
              <span class="picker-result-action" aria-hidden="true">{{ isTaken(record) ? '✓' : '＋' }}</span>
            </button>
          </div>
          <div class="picker-footer">
            <button v-if="!loading && limit < matches.length" class="secondary-button" type="button" @click="limit += 100">Show more ({{ matches.length - limit }} remaining)</button>
            <button v-if="(query || appliedFilters) && matches.length" class="secondary-button picker-clear-all" type="button" @click="clearSearchAndFilters">Clear search and filters</button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
