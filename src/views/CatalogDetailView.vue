<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import EntryContent from '../components/EntryContent.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { systemByKey } from '../lib/systems'
import { queryString } from '../lib/catalogRoute'

const route = useRoute()
const router = useRouter()
const record = ref<CatalogRecord | null>(null)
const system = computed(() => systemByKey(record.value?.expand?.system?.key))
const loading = ref(true)
const error = ref('')
const saveError = ref('')
const saving = ref(false)
const editingDescription = ref(false)
const editingNotes = ref(false)
const alternateDraft = ref('')
const notesDraft = ref('')
const canReturnToHistory = ref(false)
const returnTarget = computed<RouteLocationRaw>(() => {
  const from = queryString(route.query.from)
  if (/^\/catalog(?:[?#]|$)/.test(from)) return from
  const query: Record<string, string> = {}
  if (record.value?.expand?.system?.key) query.system = record.value.expand.system.key
  if (record.value?.type) query.type = record.value.type
  return { name: 'catalog', query }
})
const returnHref = computed(() => router.resolve(returnTarget.value).href)

onMounted(() => {
  canReturnToHistory.value = window.history.state?.catalogReturn === true
  void load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    record.value = await pb.collection('catalog').getOne<CatalogRecord>(String(route.params.recordId), { expand: 'system' })
    alternateDraft.value = record.value.alternate_description ?? ''
    notesDraft.value = record.value.notes ?? ''
  } catch {
    error.value = 'This catalog entry could not be loaded. It may have been removed or the local server is unavailable.'
  } finally {
    loading.value = false
  }
}

async function saveDescription() {
  if (!record.value) return
  saving.value = true
  saveError.value = ''
  try {
    await pb.collection('catalog').update<CatalogRecord>(record.value.id, {
      alternate_description: alternateDraft.value,
    })
    await load()
    editingDescription.value = false
  } catch {
    saveError.value = 'The alternate description could not be saved. Check the connection and try again.'
  } finally {
    saving.value = false
  }
}

async function saveNotes() {
  if (!record.value || record.value.type !== 'creature') return
  saving.value = true
  saveError.value = ''
  try {
    await pb.collection('catalog').update<CatalogRecord>(record.value.id, { notes: notesDraft.value })
    await load()
    editingNotes.value = false
  } catch {
    saveError.value = 'At-table notes could not be saved. Check the connection and try again.'
  } finally {
    saving.value = false
  }
}

function cancelDescription() {
  alternateDraft.value = record.value?.alternate_description ?? ''
  editingDescription.value = false
}

function cancelNotes() {
  notesDraft.value = record.value?.notes ?? ''
  editingNotes.value = false
}

function returnToCatalog() {
  if (canReturnToHistory.value) router.back()
  else void router.push(returnTarget.value)
}

function handleReturnClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  returnToCatalog()
}

</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <a class="text-link" :href="returnHref" @click="handleReturnClick">← Back to catalog</a>
    <div v-if="loading" class="loading-state" role="status">Loading catalog entry…</div>
    <p v-else-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Try again</button></p>
    <template v-else-if="record">
      <header class="catalog-detail-heading">
        <p class="eyebrow"><span class="eyebrow-line" /> {{ record.type.toUpperCase() }}</p>
        <h1 id="page-title">{{ record.name }}</h1>
        <p class="catalog-source">{{ system.catalog.resultLabel(record) }}<template v-if="record.expand?.system"> · {{ record.expand.system.name }}</template></p>
      </header>
      <dl class="catalog-stats">
        <div v-for="field in system.catalog.detailFields(record)" :key="field.name"><dt>{{ field.name }}</dt><dd>{{ field.value }}</dd></div>
      </dl>
      <p v-if="saveError" class="alert-message" role="alert">{{ saveError }}</p>
      <section v-if="record.type === 'creature'" class="catalog-content-panel">
        <div class="catalog-panel-heading">
          <div><h2>At-table notes</h2><span class="content-label">GM notes</span></div>
          <button class="secondary-button" type="button" @click="editingNotes = !editingNotes">{{ editingNotes ? 'Cancel' : record.notes ? 'Edit notes' : 'Add notes' }}</button>
        </div>
        <form v-if="editingNotes" @submit.prevent="saveNotes">
          <label class="field-label" for="creature-notes">Notes</label>
          <textarea id="creature-notes" v-model="notesDraft" class="text-area" rows="6" maxlength="100000" placeholder="Table notes for this creature…" />
          <div class="form-actions"><button class="secondary-button" type="button" @click="cancelNotes">Cancel</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save notes' }}</button></div>
        </form>
        <p v-else-if="record.notes" class="catalog-notes">{{ record.notes }}</p>
        <p v-else class="muted-hint">No at-table notes yet.</p>
      </section>
      <section class="catalog-content-panel"><div class="catalog-panel-heading"><h2>Description</h2><span class="content-label">Source text</span></div><EntryContent :value="system.catalog.description(record, false)" /></section>
      <section class="catalog-content-panel">
        <div class="catalog-panel-heading">
          <div><h2>{{ record.alternate_description.trim() ? 'Alternate description' : 'Custom description' }}</h2><span class="content-label">{{ record.alternate_description.trim() ? 'Preferred at-table text' : 'Optional override' }}</span></div>
          <button class="secondary-button" type="button" @click="editingDescription = !editingDescription">{{ editingDescription ? 'Cancel' : record.alternate_description.trim() ? 'Edit' : 'Add description' }}</button>
        </div>
        <form v-if="editingDescription" @submit.prevent="saveDescription">
          <label class="field-label" for="alternate-description">Alternate description</label>
          <textarea id="alternate-description" v-model="alternateDraft" class="text-area" rows="8" maxlength="100000" placeholder="Write a table-friendly description. Clear this field to prefer source text." />
          <p class="muted-hint">Plain text and 5e inline tags are supported. Original source text remains available above.</p>
          <div class="form-actions"><button class="secondary-button" type="button" @click="cancelDescription">Cancel</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save description' }}</button></div>
        </form>
        <p v-else-if="record.alternate_description.trim()" class="catalog-notes">{{ record.alternate_description }}</p>
        <p v-else class="muted-hint">When provided, this description is preferred in place of source text.</p>
      </section>
      <details class="catalog-source-data"><summary>View original source data</summary><pre>{{ JSON.stringify(record.original_json, null, 2) }}</pre></details>
    </template>
  </section>
</template>
