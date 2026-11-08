<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ActionMenu from '../components/ActionMenu.vue'
import ActionMenuItem from '../components/ActionMenuItem.vue'
import CatalogPicker from '../components/CatalogPicker.vue'
import FeedbackRegion from '../components/FeedbackRegion.vue'
import PageHeader from '../components/PageHeader.vue'
import { pb } from '../lib/pocketbase'
import { evaluateDice } from '../lib/dice'
import type { CatalogRecord, CatalogType } from '../lib/catalog'
import { isDefiniteWriteRejection } from '../lib/records'
import { findResult, validateTable, type TableData, type TableEntry, type ResultType } from '../lib/randomTables'

type Game = { id: string; name: string; system: string }
type Table = TableData & { id: string; game: string }
type Template = TableData & { id: string; system: string; source: string; source_id: string }
type Encounter = { id: string; name: string; game: string }
type Reference = { id: string; name: string; type?: string; system?: string; game?: string; source?: string }

const route = useRoute()
const router = useRouter()
const gameId = computed(() => String(route.params.gameId))
const game = ref<Game | null>(null)
const tables = ref<Table[]>([])
const templates = ref<Template[]>([])
const encounters = ref<Encounter[]>([])
const selectedId = ref('')
const selected = computed(() => tables.value.find((table) => table.id === selectedId.value) ?? null)
const formOpen = ref(false)
const editingId = ref('')
const draft = ref<TableData>({ name: '', dice: '', entries: [] })
const pickerIndex = ref(-1)
const pickerType = ref<CatalogType>('item')
const pickerOpen = computed({
  get: () => pickerIndex.value >= 0,
  set: (open: boolean) => { if (!open) pickerIndex.value = -1 },
})
const loading = ref(true)
const saving = ref(false)
const deleting = ref(false)
const copyingId = ref('')
const writeUncertain = ref(false)
const refreshRequired = ref(false)
const loadingError = ref('')
const error = ref('')
const notice = ref('')
const manualRoll = ref<number | ''>('')
const rolled = ref<number | null>(null)
const result = ref<TableEntry | null>(null)
const resolved = ref<Reference | null>(null)
const missing = ref(false)
const targetEncounter = ref('')
const addPending = ref(false)
const addUncertain = ref(false)
type UncertainAdd = { encounterId: string; encounterName: string; creatureId: string; creatureName: string; baselineIds: string[] }
type ObservedEncounterCreature = { id: string; name: string; quantity: number; notes: string; existedAtRequest: boolean }
const uncertainAdd = ref<UncertainAdd | null>(null)
const observedAddEntries = ref<ObservedEncounterCreature[]>([])
const addReviewChecked = ref(false)
const referenceNames = ref<Record<string, string>>({})
const entriesExpanded = ref(false)
let loadGeneration = 0
let resultGeneration = 0

const isEditingExisting = computed(() => Boolean(editingId.value))
const tableWritePending = computed(() => saving.value || deleting.value || copyingId.value !== '' || addPending.value)
const unsettledWrite = computed(() => tableWritePending.value || writeUncertain.value || refreshRequired.value || addUncertain.value)
const tableSwitchingBlocked = computed(() => unsettledWrite.value)
const switchMessage = computed(() => {
  if (writeUncertain.value) return 'Refresh this screen to confirm the last table change before switching tables.'
  if (refreshRequired.value) return 'Refresh this screen to reconcile the last saved change before switching tables.'
  if (addUncertain.value) return 'Check the target encounter before switching tables; a delayed creature add may still arrive.'
  if (saving.value) return 'Wait for the current table save to finish before switching tables.'
  if (deleting.value) return 'Wait for the current table delete to finish before switching tables.'
  if (copyingId.value) return 'Wait for the current template copy to finish before switching tables.'
  if (addPending.value) return 'Wait for the current creature add to finish before switching tables.'
  return ''
})
const feedbackTone = computed<'status' | 'error'>(() => error.value || writeUncertain.value || addUncertain.value ? 'error' : 'status')
const feedbackText = computed(() => error.value || notice.value)
const feedbackActionLabel = computed(() => {
  if (!feedbackText.value) return ''
  if (addUncertain.value) return 'Check encounter'
  if (writeUncertain.value || refreshRequired.value || loadingError.value) return 'Refresh'
  return ''
})

onMounted(load)
onUnmounted(() => {
  loadGeneration++
  resultGeneration++
})

watch(() => String(route.query.table ?? ''), (requested) => {
  if (loading.value || !game.value || String(route.name ?? '') !== 'game-tables') return
  if (requested === selectedId.value) return
  if (!requested) {
    const next = tables.value[0]?.id ?? ''
    if (!next) return
    applySelection(next, false)
    replaceTableQuery(next)
    return
  }
  if (!tables.value.some((table) => table.id === requested)) {
    replaceTableQuery(selectedId.value)
    return
  }
  if (tableSwitchingBlocked.value) {
    error.value = switchMessage.value
    replaceTableQuery(selectedId.value)
    return
  }
  applySelection(requested, false)
})

async function load(preferredId?: string): Promise<boolean> {
  const token = ++loadGeneration
  loading.value = !game.value
  loadingError.value = ''
  try {
    const loadedGame = await pb.collection('games').getOne<Game>(gameId.value, { requestKey: null })
    const [loadedTables, loadedTemplates, loadedEncounters] = await Promise.all([
      pb.collection('random_tables').getFullList<Table>({ filter: pb.filter('game = {:id}', { id: gameId.value }), sort: 'name', requestKey: null }),
      pb.collection('table_templates').getFullList<Template>({ filter: pb.filter('system = {:id}', { id: loadedGame.system }), sort: 'name', requestKey: null }),
      pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:id}', { id: gameId.value }), sort: 'name', requestKey: null }),
    ])
    if (token !== loadGeneration) return false
    game.value = loadedGame
    tables.value = loadedTables
    templates.value = loadedTemplates
    encounters.value = loadedEncounters
    await loadReferenceNames(loadedTables, loadedTemplates, token)
    if (token !== loadGeneration) return false
    const editingTableId = formOpen.value && editingId.value && loadedTables.some((table) => table.id === editingId.value) ? editingId.value : ''
    const requested = editingTableId || preferredId || String(route.query.table ?? '')
    const next = loadedTables.find((table) => table.id === requested)?.id
      ?? loadedTables.find((table) => table.id === selectedId.value)?.id
      ?? loadedTables[0]?.id
      ?? ''
    const changed = next !== selectedId.value
    applySelection(next, false, changed || Boolean(preferredId))
    if (String(route.query.table ?? '') !== next) replaceTableQuery(next)
    if (writeUncertain.value || refreshRequired.value) {
      const closeEditor = writeUncertain.value && formOpen.value
      writeUncertain.value = false
      refreshRequired.value = false
      if (closeEditor) {
        formOpen.value = false
        editingId.value = ''
      }
    }
    return true
  } catch {
    if (token === loadGeneration) {
      loadingError.value = 'Tables could not be loaded. Check the connection and try again.'
      if (!error.value) error.value = loadingError.value
    }
    return false
  } finally {
    if (token === loadGeneration) loading.value = false
  }
}

async function loadReferenceNames(loadedTables: Table[], loadedTemplates: Template[], token: number) {
  const references = [...new Set([...loadedTables, ...loadedTemplates]
    .flatMap((table) => table.entries.filter((entry) => entry.type && entry.type !== 'encounter' && entry.ref).map((entry) => entry.ref)))]
  if (!references.length) {
    if (token === loadGeneration) referenceNames.value = {}
    return
  }
  const names = await Promise.all(references.map(async (id) => {
    try {
      const record = await pb.collection('catalog').getOne<Reference>(id, { fields: 'id,name,source,system', requestKey: null })
      return [id, game.value && record.system === game.value.system ? `${record.name} · ${record.source}` : 'Wrong system'] as const
    } catch {
      return [id, 'Missing catalog entry'] as const
    }
  }))
  if (token === loadGeneration) referenceNames.value = Object.fromEntries(names)
}

function applySelection(id: string, updateUrl: boolean, restoreResult = false) {
  const next = id && tables.value.some((table) => table.id === id) ? id : ''
  if (next !== selectedId.value) {
    selectedId.value = next
    formOpen.value = false
    editingId.value = ''
    pickerIndex.value = -1
    manualRoll.value = ''
    targetEncounter.value = ''
    clearResult()
    entriesExpanded.value = (tables.value.find((table) => table.id === next)?.entries.length ?? 0) <= 12
  }
  if (updateUrl) replaceTableQuery(next)
  if (restoreResult && next) restoreSavedResult(next)
}

function selectTable(id: string) {
  if (id === selectedId.value) return
  if (tableSwitchingBlocked.value) {
    error.value = switchMessage.value
    return
  }
  error.value = ''
  notice.value = ''
  applySelection(id, true, true)
}

function replaceTableQuery(id: string) {
  if (String(route.query.table ?? '') === id) return
  const query = { ...route.query }
  if (id) query.table = id
  else delete query.table
  void router.replace({ query })
}

function clearResult() {
  resultGeneration++
  rolled.value = null
  result.value = null
  resolved.value = null
  missing.value = false
}

function resultStorageKey(tableId: string) {
  return `olea.tableResult.${gameId.value}.${tableId}`
}

function rememberSavedRoll(tableId: string, number: number) {
  try { sessionStorage.setItem(resultStorageKey(tableId), String(number)) } catch {}
}

function forgetSavedRoll(tableId: string) {
  try { sessionStorage.removeItem(resultStorageKey(tableId)) } catch {}
}

function readSavedRoll(tableId: string): number | null {
  try {
    const saved = sessionStorage.getItem(resultStorageKey(tableId))
    if (saved === null) return null
    const number = Number(saved)
    return Number.isInteger(number) && number >= -100000 && number <= 100000 ? number : null
  } catch {
    return null
  }
}

function restoreSavedResult(tableId: string) {
  const number = readSavedRoll(tableId)
  if (number === null) return
  clearResult()
  void applyRoll(tableId, number, false)
}

function begin(table?: Table) {
  editingId.value = table?.id ?? ''
  draft.value = table
    ? { name: table.name, dice: table.dice ?? '', entries: table.entries.map((entry) => ({ ...entry, type: entry.type ?? '', ref: entry.ref ?? '' })) }
    : { name: '', dice: '', entries: [{ min: 1, max: 1, text: '', type: '', ref: '' }] }
  formOpen.value = true
  pickerIndex.value = -1
  error.value = ''
  notice.value = ''
}

function create() {
  if (unsettledWrite.value || formOpen.value) return
  begin()
}

function edit() {
  if (!selected.value || unsettledWrite.value) return
  begin(selected.value)
}

function cancelEdit() {
  if (saving.value || writeUncertain.value) return
  formOpen.value = false
  editingId.value = ''
  pickerIndex.value = -1
  error.value = ''
}

function apiError(cause: unknown, fallback: string) {
  const value = cause as { response?: { message?: string } }
  return value?.response?.message || fallback
}

async function save() {
  if (saving.value || writeUncertain.value || deleting.value || copyingId.value || addPending.value) return
  const validation = validateTable(draft.value)
  if (validation) {
    error.value = validation
    return
  }
  const previousId = editingId.value
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const response = await pb.send<{ id: string }>('/api/olea/tables/save', {
      method: 'POST',
      body: { game: gameId.value, id: previousId, table: draft.value },
    })
    formOpen.value = false
    editingId.value = ''
    pickerIndex.value = -1
    clearResult()
    forgetSavedRoll(response.id)
    const loaded = await load(response.id)
    if (!loaded) {
      refreshRequired.value = true
      error.value = 'The table was saved, but the table list could not refresh. Refresh this screen before making another change so stale tables cannot be overwritten.'
      return
    }
    notice.value = previousId ? 'Table saved.' : 'Table created.'
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      writeUncertain.value = true
      error.value = 'Could not confirm whether the table was saved because the connection failed. Refresh this screen before trying again; it may already be saved.'
      return
    }
    error.value = apiError(cause, 'The table could not be saved.')
  } finally {
    saving.value = false
  }
}

async function remove() {
  const table = selected.value
  if (!table || deleting.value || writeUncertain.value || tableWritePending.value) return
  if (!window.confirm(`Delete “${table.name}”?`)) return
  deleting.value = true
  error.value = ''
  notice.value = ''
  try {
    await pb.send('/api/olea/tables/delete', { method: 'POST', body: { game: gameId.value, id: table.id } })
    forgetSavedRoll(table.id)
    formOpen.value = false
    editingId.value = ''
    pickerIndex.value = -1
    clearResult()
    const loaded = await load()
    if (!loaded) {
      refreshRequired.value = true
      error.value = 'The table was deleted, but the remaining tables could not refresh. Refresh this screen before making another change so stale tables cannot be overwritten.'
      return
    }
    notice.value = 'Table deleted.'
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      writeUncertain.value = true
      error.value = `Could not confirm whether “${table.name}” was deleted because the connection failed. Refresh this screen before trying again; it may already be gone.`
      return
    }
    error.value = apiError(cause, 'The table could not be deleted.')
  } finally {
    deleting.value = false
  }
}

async function copy(template: Template) {
  if (copyingId.value || unsettledWrite.value || formOpen.value) return
  copyingId.value = template.id
  error.value = ''
  notice.value = ''
  try {
    const response = await pb.send<{ id: string }>('/api/olea/tables/copy', { method: 'POST', body: { game: gameId.value, template: template.id } })
    formOpen.value = false
    editingId.value = ''
    pickerIndex.value = -1
    clearResult()
    const loaded = await load(response.id)
    if (!loaded) {
      refreshRequired.value = true
      error.value = 'The template was copied, but the table list could not refresh. Refresh this screen before making another change so stale tables cannot be overwritten.'
      return
    }
    notice.value = `Copied “${template.name}”.`
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      writeUncertain.value = true
      error.value = 'Could not confirm whether the template was copied because the connection failed. Refresh this screen before trying again; a copy may already exist.'
      return
    }
    error.value = apiError(cause, 'The template could not be copied.')
  } finally {
    copyingId.value = ''
  }
}

async function retryLoad() {
  const refresh = await load()
  if (!refresh) return
  error.value = ''
  notice.value = 'Screen refreshed from the server.'
}

function feedbackAction() {
  if (addUncertain.value) void reconcileAdd()
  else void retryLoad()
}

function setType(entry: TableEntry, type: ResultType) {
  entry.type = type
  entry.ref = ''
  pickerIndex.value = -1
}

function openPicker(index: number, type: CatalogType) {
  if (unsettledWrite.value) return
  pickerType.value = type
  pickerIndex.value = index
}

function chooseCatalog(record: CatalogRecord) {
  const entry = draft.value.entries[pickerIndex.value]
  if (entry) {
    entry.ref = record.id
    referenceNames.value[record.id] = `${record.name} · ${record.source}`
  }
  pickerIndex.value = -1
}

function referenceMatches(entry: TableEntry, record: Reference) {
  if (entry.type === 'encounter') return record.game === gameId.value
  return Boolean(game.value && record.system === game.value.system && record.type === entry.type)
}

function roll(value?: number | '') {
  const table = selected.value
  if (!table) return
  error.value = ''
  clearResult()
  let number: number
  try {
    if (value !== undefined) {
      if (value === '' || !Number.isInteger(value) || value < -100000 || value > 100000) {
        throw new Error('Enter a whole-number roll from −100000 to 100000.')
      }
      number = value
    } else {
      if (!table.dice) throw new Error('This table has no dice expression; enter a manual roll.')
      number = evaluateDice(table.dice)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not roll.'
    return
  }
  void applyRoll(table.id, number, true)
}

async function applyRoll(tableId: string, number: number, remember: boolean) {
  const table = tables.value.find((value) => value.id === tableId)
  const generation = resultGeneration
  rolled.value = number
  result.value = table ? findResult(table.entries, number) ?? null : null
  if (remember) {
    if (result.value) rememberSavedRoll(tableId, number)
    else forgetSavedRoll(tableId)
  }
  const entry = result.value
  if (!entry?.type || !entry.ref || !game.value) return
  try {
    const record = await pb.collection(entry.type === 'encounter' ? 'encounters' : 'catalog').getOne<Reference>(entry.ref, { requestKey: null })
    if (generation !== resultGeneration || selectedId.value !== tableId) return
    if (!referenceMatches(entry, record)) {
      missing.value = true
      return
    }
    resolved.value = record
  } catch {
    if (generation === resultGeneration && selectedId.value === tableId) missing.value = true
  }
}

async function encounterCreatureEntries(encounterId: string, creatureId: string): Promise<Array<{ id: string; name: string; quantity: number; notes: string }>> {
  return await pb.collection('encounter_creatures').getFullList<{ id: string; name: string; quantity: number; notes: string }>({
    filter: pb.filter('encounter = {:encounter} && creature = {:creature}', { encounter: encounterId, creature: creatureId }),
    fields: 'id,name,quantity,notes',
    sort: 'id',
    requestKey: null,
  })
}

async function addToEncounter() {
  const creature = resolved.value
  const encounter = encounters.value.find((value) => value.id === targetEncounter.value)
  if (!creature || result.value?.type !== 'creature' || !encounter || addPending.value || addUncertain.value) return
  addPending.value = true
  error.value = ''
  notice.value = ''
  let baselineIds: string[]
  try {
    baselineIds = (await encounterCreatureEntries(encounter.id, creature.id)).map((entry) => entry.id)
  } catch {
    error.value = 'Could not review the target encounter before adding. Refresh this screen and try again.'
    addPending.value = false
    return
  }
  try {
    await pb.send('/api/olea/tables/add-creature', { method: 'POST', body: { game: gameId.value, encounter: encounter.id, creature: creature.id } })
    targetEncounter.value = ''
    notice.value = `Added ${creature.name} to ${encounter.name}.`
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      addUncertain.value = true
      observedAddEntries.value = []
      addReviewChecked.value = false
      uncertainAdd.value = {
        encounterId: encounter.id,
        encounterName: encounter.name,
        creatureId: creature.id,
        creatureName: creature.name,
        baselineIds,
      }
      error.value = `Could not confirm whether ${creature.name} was added because the response was lost. A delayed write may still arrive. Use Check encounter to review ${encounter.name}; a matching entry may belong to another client.`
      return
    }
    error.value = apiError(cause, 'Could not add the creature. Check the encounter and reference still exist.')
  } finally {
    addPending.value = false
  }
}

async function reconcileAdd() {
  const pending = uncertainAdd.value
  if (!pending || addPending.value) return
  addPending.value = true
  error.value = ''
  try {
    const entries = await encounterCreatureEntries(pending.encounterId, pending.creatureId)
    const baseline = new Set(pending.baselineIds)
    observedAddEntries.value = entries.map((entry) => ({ ...entry, existedAtRequest: baseline.has(entry.id) }))
    addReviewChecked.value = true
    addUncertain.value = true
    targetEncounter.value = pending.encounterId
    const newCount = observedAddEntries.value.filter((entry) => !entry.existedAtRequest).length
    error.value = newCount
      ? `Review required: ${entries.length} matching ${entries.length === 1 ? 'entry is' : 'entries are'} visible in ${pending.encounterName}, including ${newCount} that appeared after the request started. A matching entry may be another client’s add or the delayed write. The add stays locked until you acknowledge the review.`
      : `Review required: no matching entry is visible in ${pending.encounterName} yet. A delayed write may still arrive and may not be observable here. The add stays locked until you acknowledge the review.`
  } catch {
    addUncertain.value = true
    targetEncounter.value = pending.encounterId
    error.value = `Could not check ${pending.encounterName} because the connection failed. Review the target encounter before deciding; a delayed write may still arrive.`
  } finally {
    addPending.value = false
  }
}

function acknowledgeAddReview() {
  const pending = uncertainAdd.value
  if (!pending || addPending.value || !addReviewChecked.value) return
  addUncertain.value = false
  uncertainAdd.value = null
  observedAddEntries.value = []
  addReviewChecked.value = false
  targetEncounter.value = ''
  error.value = ''
  notice.value = `Add lock cleared after reviewing ${pending.encounterName}. No retry was sent. Any observed entry may belong to another client, and a delayed write may still arrive later.`
}

function onEntriesToggle(event: Event) {
  entriesExpanded.value = (event.currentTarget as HTMLDetailsElement).open
}

function entryReferenceLabel(entry: TableEntry) {
  if (!entry.type) return ''
  if (entry.type === 'encounter') {
    return encounters.value.find((encounter) => encounter.id === entry.ref)?.name || 'Missing encounter'
  }
  return referenceNames.value[entry.ref] || 'Missing catalog entry'
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading tables…</div>
    <template v-else-if="game">
      <RouterLink class="text-link" :to="{ name: 'game-characters', params: { gameId } }">← {{ game.name }}</RouterLink>
      <PageHeader eyebrow="GAME MASTER" title="Random tables" description="Choose a table, roll or enter your own dice result, and act on the latest result before opening the full entry list.">
        <template #actions>
          <button class="primary-button" type="button" :disabled="unsettledWrite || formOpen" @click="create">＋ New table</button>
        </template>
      </PageHeader>
      <div class="feedback-slot">
        <FeedbackRegion v-if="feedbackText" :tone="feedbackTone" :action-label="feedbackActionLabel" @action="feedbackAction">{{ feedbackText }}</FeedbackRegion>
      </div>
      <div v-if="tables.length" class="table-tabs" role="group" aria-label="Game tables">
        <button
          v-for="table in tables"
          :key="table.id"
          type="button"
          class="spellbook-tab"
          :class="{ selected: table.id === selectedId }"
          :aria-pressed="table.id === selectedId"
          :disabled="tableSwitchingBlocked && table.id !== selectedId"
          @click="selectTable(table.id)"
        >
          {{ table.name }}
          <small>{{ table.entries.length }} {{ table.entries.length === 1 ? 'entry' : 'entries' }}</small>
        </button>
      </div>
      <p v-if="tableSwitchingBlocked" class="muted-hint">{{ switchMessage }}</p>

      <form v-if="formOpen" class="editor-panel table-editor" @submit.prevent="save">
        <h2>{{ isEditingExisting ? 'Edit table' : 'New table' }}</h2>
        <label class="field-label" for="table-name">Name</label>
        <input id="table-name" v-model="draft.name" class="text-input" maxlength="160" required />
        <label class="field-label" for="table-dice">Dice expression (optional)</label>
        <input id="table-dice" v-model="draft.dice" class="text-input" maxlength="120" placeholder="e.g. 1d20 or 2d6+1" />
        <p class="muted-hint">Leave empty to use manual rolls only. Gaps in ranges result in no match.</p>
        <fieldset v-for="(entry, index) in draft.entries" :key="index" class="table-entry">
          <legend>Entry {{ index + 1 }}</legend>
          <div class="table-range">
            <label class="filter-field">From<input v-model.number="entry.min" class="text-input" type="number" min="-100000" max="100000" step="1" required /></label>
            <label class="filter-field">To<input v-model.number="entry.max" class="text-input" type="number" min="-100000" max="100000" step="1" required /></label>
          </div>
          <label class="field-label" :for="`entry-text-${index}`">Result text</label>
          <textarea :id="`entry-text-${index}`" v-model="entry.text" class="text-area" maxlength="10000" />
          <label class="field-label" :for="`entry-type-${index}`">Reference</label>
          <select :id="`entry-type-${index}`" class="select-input" :value="entry.type" @change="setType(entry, ($event.target as HTMLSelectElement).value as ResultType)">
            <option value="">Text only</option>
            <option value="item">Item</option>
            <option value="spell">Spell</option>
            <option value="creature">Creature</option>
            <option value="encounter">Encounter</option>
          </select>
          <template v-if="entry.type === 'encounter'">
            <label class="field-label" :for="`entry-encounter-${index}`">Game encounter</label>
            <select :id="`entry-encounter-${index}`" v-model="entry.ref" class="select-input">
              <option value="">Choose an encounter</option>
              <option v-if="entry.ref && !encounters.some((encounter) => encounter.id === entry.ref)" :value="entry.ref">Missing encounter</option>
              <option v-for="encounter in encounters" :key="encounter.id" :value="encounter.id">{{ encounter.name }}</option>
            </select>
          </template>
          <template v-else-if="entry.type">
            <p class="muted-hint">{{ entry.ref ? `Selected: ${referenceNames[entry.ref] || 'Missing catalog entry'}` : 'No catalog entry selected.' }}</p>
            <button class="secondary-button" type="button" :disabled="unsettledWrite" @click="openPicker(index, entry.type as CatalogType)">Choose {{ entry.type }}</button>
          </template>
          <div class="form-actions">
            <button class="danger-button" type="button" :disabled="saving || writeUncertain" @click="draft.entries.splice(index, 1); pickerIndex = -1">Remove entry</button>
          </div>
        </fieldset>
        <button class="secondary-button" type="button" :disabled="saving || writeUncertain" @click="draft.entries.push({ min: '', max: '', text: '', type: '', ref: '' })">＋ Add entry</button>
        <div class="form-actions">
          <button class="secondary-button" type="button" :disabled="saving || writeUncertain" @click="cancelEdit">Cancel</button>
          <button class="primary-button" type="submit" :disabled="saving || writeUncertain">{{ saving ? 'Saving…' : 'Save table' }}</button>
        </div>
      </form>

      <section v-else-if="selected" class="editor-panel table-selected" :aria-labelledby="`table-heading-${selected.id}`">
        <div class="spellbook-heading">
          <div>
            <p class="eyebrow">SELECTED TABLE</p>
            <h2 :id="`table-heading-${selected.id}`">{{ selected.name }}</h2>
            <p class="muted-hint">{{ selected.dice || 'Manual rolls' }} · {{ selected.entries.length }} {{ selected.entries.length === 1 ? 'entry' : 'entries' }}</p>
          </div>
          <div class="row-actions">
            <ActionMenu :label="`Table actions for ${selected.name}`" :disabled="unsettledWrite">
              <ActionMenuItem @select="edit">Edit table</ActionMenuItem>
              <ActionMenuItem danger @select="remove">Delete table</ActionMenuItem>
            </ActionMenu>
          </div>
        </div>

        <div class="table-roll-panel">
          <div class="table-roll-controls">
            <button class="primary-button" type="button" :disabled="!selected.dice" @click="roll()">Roll {{ selected.dice || 'dice' }}</button>
            <label class="filter-field">Manual roll
              <input v-model.number="manualRoll" class="text-input" type="number" min="-100000" max="100000" step="1" />
            </label>
            <button class="secondary-button" type="button" @click="roll(manualRoll)">Use roll</button>
          </div>
          <p v-if="!selected.dice" class="muted-hint">This table has no dice expression. Enter the result of your physical roll.</p>
          <div v-if="rolled !== null" class="table-outcome" role="status" aria-live="polite">
            <strong>Roll: {{ rolled }}</strong>
            <p v-if="!result">No entry matches this roll.</p>
            <template v-else>
              <p class="table-outcome-text">{{ result.text }}</p>
              <p v-if="missing">The referenced {{ result.type }} is missing or belongs to another system or game.</p>
              <template v-else-if="resolved">
                <p class="table-outcome-reference">{{ resolved.name }}<span v-if="resolved.source"> · {{ resolved.source }}</span></p>
                <div class="table-result-links">
                  <RouterLink v-if="result.type !== 'encounter'" class="secondary-link" :to="{ name: 'catalog-detail', params: { recordId: resolved.id } }">Open catalog entry</RouterLink>
                  <RouterLink v-else class="secondary-link" :to="{ name: 'game-encounters', params: { gameId }, query: { encounter: resolved.id } }">Open encounter</RouterLink>
                  <div v-if="result.type === 'creature'" class="table-add-creature">
                    <label class="filter-field">Add to encounter
                      <select v-model="targetEncounter" class="select-input" :disabled="addPending || addUncertain">
                        <option value="">Choose encounter</option>
                        <option v-for="encounter in encounters" :key="encounter.id" :value="encounter.id">{{ encounter.name }}</option>
                      </select>
                    </label>
                    <button class="secondary-button" type="button" :disabled="!targetEncounter || addPending || addUncertain" @click="addToEncounter">{{ addPending ? 'Adding…' : 'Add creature' }}</button>
                  </div>
                  <div v-if="addUncertain && uncertainAdd" class="table-add-review" role="group" aria-label="Creature add review">
                    <p><strong>Add locked for review.</strong> A matching entry may belong to another client, and a delayed write may still arrive.</p>
                    <p v-if="addReviewChecked">{{ observedAddEntries.length }} matching {{ observedAddEntries.length === 1 ? 'entry' : 'entries' }} observed in {{ uncertainAdd.encounterName }}.</p>
                    <ul v-if="observedAddEntries.length" class="table-add-review-list">
                      <li v-for="entry in observedAddEntries" :key="entry.id">
                        {{ entry.name }} × {{ entry.quantity }}<span v-if="entry.notes"> — {{ entry.notes }}</span>
                        <span v-if="!entry.existedAtRequest" class="table-add-review-new"> · appeared after the request started; it may be another client’s entry or the delayed write.</span>
                      </li>
                    </ul>
                    <div class="table-add-review-actions">
                      <RouterLink class="secondary-link" :to="{ name: 'game-encounters', params: { gameId }, query: { encounter: uncertainAdd.encounterId } }">Review target encounter</RouterLink>
                      <button v-if="addReviewChecked" class="secondary-button" type="button" :disabled="addPending" @click="acknowledgeAddReview">Acknowledge review and unlock</button>
                    </div>
                  </div>
                </div>
              </template>
              <p v-else-if="result.type">Resolving reference…</p>
            </template>
          </div>
          <p v-else class="muted-hint table-roll-hint">Roll the dice or enter a physical roll. The latest result appears here before the full entry list.</p>
        </div>

        <details class="table-entries" :open="entriesExpanded" @toggle="onEntriesToggle">
          <summary>Show all {{ selected.entries.length }} {{ selected.entries.length === 1 ? 'entry' : 'entries' }}</summary>
          <ul class="table-results">
            <li v-for="(entry, index) in selected.entries" :key="index" class="table-entry-row">
              <strong>{{ entry.min }}–{{ entry.max }}</strong> {{ entry.text }}
              <span v-if="entry.type" class="muted-hint">({{ entry.type }}: {{ entryReferenceLabel(entry) }})</span>
            </li>
          </ul>
        </details>
      </section>

      <div v-else-if="!formOpen" class="empty-state">
        <h2>No tables yet</h2>
        <p>Create a table or copy a system template.</p>
        <button class="primary-button empty-action" type="button" :disabled="unsettledWrite" @click="create">＋ New table</button>
      </div>

      <details class="management-panel table-templates">
        <summary>System templates ({{ templates.length }})<span class="management-summary">Read-only starting points for this game’s system</span></summary>
        <div class="management-body">
          <p class="muted-hint">Templates are read-only. Copy one to this game to edit it.</p>
          <p v-if="!templates.length" class="muted-hint">No templates have been imported for this system.</p>
          <article v-for="template in templates" :key="template.id" class="table-template">
            <div>
              <strong>{{ template.name }}</strong>
              <p class="muted-hint">{{ template.source }} · {{ template.dice || 'Manual rolls' }} · {{ template.entries.length }} entries</p>
              <ul class="template-entries">
                <li v-for="(entry, index) in template.entries" :key="index">{{ entry.min }}–{{ entry.max }}: {{ entry.text }}<span v-if="entry.type"> ({{ entry.type }}: {{ referenceNames[entry.ref] || 'Missing catalog entry' }})</span></li>
              </ul>
            </div>
            <button class="secondary-button" type="button" :disabled="copyingId !== '' || unsettledWrite || formOpen" @click="copy(template)">{{ copyingId === template.id ? 'Copying…' : 'Copy to game' }}</button>
          </article>
        </div>
      </details>

      <CatalogPicker v-model:open="pickerOpen" :system-id="game.system" :type="pickerType" :title="`Choose ${pickerType}`" @select="chooseCatalog" />
    </template>
    <p v-else class="alert-message">This game could not be found.</p>
  </section>
</template>
