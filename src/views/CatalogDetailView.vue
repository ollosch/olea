<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import EntryContent from '../components/EntryContent.vue'
import FeedbackRegion from '../components/FeedbackRegion.vue'
import { pb } from '../lib/pocketbase'
import { sourceIdentityLabel, type CatalogRecord } from '../lib/catalog'
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
const hasAlternate = computed(() => Boolean(record.value?.alternate_description.trim()))
const sourceDescription = computed(() => record.value ? system.value.catalog.description(record.value, false) : '')
const preferredDescription = computed(() => hasAlternate.value ? record.value?.alternate_description ?? '' : sourceDescription.value)
const detailFields = computed(() => record.value ? system.value.catalog.detailFields(record.value) : [])
const sourceName = computed(() => record.value ? sourceIdentityLabel(record.value) : '')
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
  window.scrollTo({ top: 0, left: 0 })
  void load()
})

async function load() {
  loading.value = true
  error.value = ''
  saveError.value = ''
  try {
    record.value = await pb.collection('catalog').getOne<CatalogRecord>(String(route.params.recordId), { expand: 'system', requestKey: null })
    alternateDraft.value = record.value.alternate_description ?? ''
    notesDraft.value = record.value.notes ?? ''
  } catch {
    error.value = 'This catalog entry could not be loaded. It may have been removed or the local server is unavailable.'
  } finally {
    loading.value = false
  }
}

function beginDescriptionEdit() {
  alternateDraft.value = record.value?.alternate_description ?? ''
  editingDescription.value = true
}

function toggleDescriptionEdit() {
  if (editingDescription.value) cancelDescription()
  else beginDescriptionEdit()
}

async function saveDescription() {
  if (!record.value) return
  saving.value = true
  saveError.value = ''
  try {
    const updated = await pb.collection('catalog').update<CatalogRecord>(record.value.id, {
      alternate_description: alternateDraft.value,
    })
    record.value = { ...record.value, alternate_description: updated.alternate_description ?? alternateDraft.value }
    editingDescription.value = false
  } catch {
    saveError.value = 'The alternate description could not be saved. Check the connection and try again.'
  } finally {
    saving.value = false
  }
}

function beginNotesEdit() {
  notesDraft.value = record.value?.notes ?? ''
  editingNotes.value = true
}

function toggleNotesEdit() {
  if (editingNotes.value) cancelNotes()
  else beginNotesEdit()
}

async function saveNotes() {
  if (!record.value || record.value.type !== 'creature') return
  saving.value = true
  saveError.value = ''
  try {
    const updated = await pb.collection('catalog').update<CatalogRecord>(record.value.id, { notes: notesDraft.value })
    record.value = { ...record.value, notes: updated.notes ?? notesDraft.value }
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
  <section class="screen catalog-detail-screen" aria-labelledby="page-title">
    <a class="text-link catalog-back-link" :href="returnHref" @click="handleReturnClick">← Back to catalog</a>

    <div class="feedback-slot catalog-detail-feedback">
      <FeedbackRegion v-if="loading">Loading catalog entry…</FeedbackRegion>
      <FeedbackRegion v-else-if="error" tone="error" action-label="Try again" @action="load">{{ error }}</FeedbackRegion>
    </div>

    <template v-if="!loading && !error && record">
      <header class="catalog-detail-heading">
        <p class="eyebrow"><span class="eyebrow-line" /> {{ record.type.toUpperCase() }}</p>
        <h1 id="page-title">{{ record.name }}</h1>
        <p class="catalog-source">
          <span class="catalog-source-chip">{{ sourceName }}</span>
          <span>{{ system.catalog.resultLabel(record) }}</span>
          <template v-if="record.expand?.system"> · {{ record.expand.system.name }}</template>
        </p>
      </header>

      <div v-if="saveError" class="feedback-slot catalog-save-feedback">
        <FeedbackRegion tone="error">{{ saveError }}</FeedbackRegion>
      </div>

      <div class="catalog-detail-layout">
        <div class="catalog-detail-main">
          <section class="catalog-content-panel catalog-preferred-panel">
            <div class="catalog-panel-heading">
              <div>
                <h2>{{ hasAlternate ? 'At-table description' : 'Description' }}</h2>
                <span class="content-label">{{ hasAlternate ? 'Preferred at-table text' : 'Source text' }}</span>
              </div>
              <button class="secondary-button" type="button" @click="toggleDescriptionEdit">{{ editingDescription ? 'Cancel' : hasAlternate ? 'Edit at-table description' : 'Add at-table description' }}</button>
            </div>
            <form v-if="editingDescription" @submit.prevent="saveDescription">
              <label class="field-label" for="alternate-description">At-table description</label>
              <textarea id="alternate-description" v-model="alternateDraft" class="text-area" rows="8" maxlength="100000" placeholder="Write a table-friendly description. Clear this field to prefer source text." />
              <p class="muted-hint">Plain text and 5e inline tags are supported. The original source text remains available below.</p>
              <div class="form-actions"><button class="secondary-button" type="button" @click="cancelDescription">Cancel</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save description' }}</button></div>
            </form>
            <template v-else>
              <EntryContent :value="preferredDescription" />
              <p v-if="!hasAlternate" class="muted-hint">Source text is shown until you add an at-table description.</p>
            </template>
          </section>

          <section v-if="record.type === 'creature'" class="catalog-content-panel">
            <div class="catalog-panel-heading">
              <div><h2>At-table notes</h2><span class="content-label">GM notes</span></div>
              <button class="secondary-button" type="button" @click="toggleNotesEdit">{{ editingNotes ? 'Cancel' : record.notes ? 'Edit notes' : 'Add notes' }}</button>
            </div>
            <form v-if="editingNotes" @submit.prevent="saveNotes">
              <label class="field-label" for="creature-notes">Notes</label>
              <textarea id="creature-notes" v-model="notesDraft" class="text-area" rows="6" maxlength="100000" placeholder="Table notes for this creature…" />
              <div class="form-actions"><button class="secondary-button" type="button" @click="cancelNotes">Cancel</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save notes' }}</button></div>
            </form>
            <p v-else-if="record.notes" class="catalog-notes">{{ record.notes }}</p>
            <p v-else class="muted-hint">No at-table notes yet.</p>
          </section>

          <details v-if="hasAlternate" class="catalog-content-panel catalog-original-panel">
            <summary>Original source text</summary>
            <div class="catalog-original-body"><EntryContent :value="sourceDescription" /></div>
          </details>

          <details class="catalog-source-data">
            <summary>View original source data</summary>
            <pre>{{ JSON.stringify(record.original_json, null, 2) }}</pre>
          </details>
        </div>

        <aside class="catalog-detail-aside">
          <dl v-if="detailFields.length" class="catalog-stats">
            <div v-for="field in detailFields" :key="field.name"><dt>{{ field.name }}</dt><dd>{{ field.value }}</dd></div>
          </dl>
          <section class="catalog-source-card">
            <p class="eyebrow">SOURCE</p>
            <p class="catalog-source-card-name">{{ sourceName }}</p>
            <p v-if="record.expand?.system" class="muted-hint">{{ record.expand.system.name }}</p>
            <p class="muted-hint">Alternate descriptions and notes are saved locally and preserved on reimport.</p>
          </section>
        </aside>
      </div>
    </template>
  </section>
</template>
