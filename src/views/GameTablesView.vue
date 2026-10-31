<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import CatalogPicker from '../components/CatalogPicker.vue'
import { pb } from '../lib/pocketbase'
import { evaluateDice } from '../lib/dice'
import type { CatalogRecord, CatalogType } from '../lib/catalog'
import { findResult, validateTable, type TableData, type TableEntry, type ResultType } from '../lib/randomTables'

type Game = { id: string; name: string; system: string }
type Table = TableData & { id: string; game: string }
type Template = TableData & { id: string; source: string; source_id: string }
type Encounter = { id: string; name: string; game: string }
type Reference = { id: string; name: string; type?: string; system?: string; game?: string; source?: string }
const route = useRoute()
const gameId = String(route.params.gameId)
const game = ref<Game | null>(null)
const tables = ref<Table[]>([])
const templates = ref<Template[]>([])
const encounters = ref<Encounter[]>([])
const selectedId = ref('')
const selected = computed(() => tables.value.find((table) => table.id === selectedId.value))
const editing = ref(false)
const draft = ref<TableData>({ name: '', dice: '', entries: [] })
const pickerIndex = ref(-1)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const manualRoll = ref<number | ''>('')
const rolled = ref<number | null>(null)
const result = ref<TableEntry | null>(null)
const resolved = ref<Reference | null>(null)
const missing = ref(false)
const targetEncounter = ref('')
const notice = ref('')
const referenceNames = ref<Record<string, string>>({})
let resolveGeneration = 0

onMounted(load)
async function load() {
  loading.value = true
  try {
    game.value = await pb.collection('games').getOne<Game>(gameId, { requestKey: null })
    const [ts, temps, es] = await Promise.all([
      pb.collection('random_tables').getFullList<Table>({ filter: pb.filter('game = {:id}', { id: gameId }), sort: 'name', requestKey: null }),
      pb.collection('table_templates').getFullList<Template>({ filter: pb.filter('system = {:id}', { id: game.value.system }), sort: 'name', requestKey: null }),
      pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:id}', { id: gameId }), sort: 'name', requestKey: null }),
    ])
    tables.value = ts; templates.value = temps; encounters.value = es
    if (!ts.some((t) => t.id === selectedId.value)) selectedId.value = ts[0]?.id ?? ''
    const refs = [...new Set([...ts, ...temps].flatMap((t) => t.entries.filter((entry) => entry.type && entry.type !== 'encounter' && entry.ref).map((entry) => entry.ref)))]
    const names = await Promise.all(refs.map(async (id) => {
      try { const record = await pb.collection('catalog').getOne<Reference>(id, { fields: 'id,name,source,system', requestKey: null }); return [id, record.system === game.value?.system ? `${record.name} · ${record.source}` : 'Wrong system'] }
      catch { return [id, 'Missing catalog entry'] }
    }))
    referenceNames.value = Object.fromEntries(names)
  } catch { error.value = 'Tables could not be loaded. Check the connection and try again.' }
  finally { loading.value = false }
}
function begin(table?: Table) {
  draft.value = table ? { name: table.name, dice: table.dice ?? '', entries: table.entries.map((entry) => ({ ...entry, type: entry.type ?? '', ref: entry.ref ?? '' })) } : { name: '', dice: '', entries: [{ min: 1, max: 1, text: '', type: '', ref: '' }] }
  editing.value = true; error.value = ''; pickerIndex.value = -1
}
function select(id: string) { selectedId.value = id; editing.value = false; clearResult() }
function clearResult() { resolveGeneration++; rolled.value = null; result.value = null; resolved.value = null; missing.value = false }
function apiError(cause: unknown, fallback: string) {
  const c = cause as { response?: { message?: string } }
  return c?.response?.message || fallback
}
async function save() {
  error.value = validateTable(draft.value)
  if (error.value) return
  saving.value = true
  try {
    const response = await pb.send<{ id: string }>('/api/olea/tables/save', { method: 'POST', body: { game: gameId, id: editing.value && selected.value && isEditingExisting.value ? selected.value.id : '', table: draft.value } })
    selectedId.value = response.id; editing.value = false; isEditingExisting.value = false; clearResult(); await load()
  } catch (cause) { error.value = apiError(cause, 'The table could not be saved.') }
  finally { saving.value = false }
}
const isEditingExisting = ref(false)
function create() { isEditingExisting.value = false; begin() }
function edit() { if (selected.value) { isEditingExisting.value = true; begin(selected.value) } }
async function remove() {
  if (!selected.value || !confirm(`Delete “${selected.value.name}”?`)) return
  try { await pb.send('/api/olea/tables/delete', { method: 'POST', body: { game: gameId, id: selected.value.id } }); selectedId.value = ''; clearResult(); await load() }
  catch (cause) { error.value = apiError(cause, 'The table could not be deleted.') }
}
async function copy(template: Template) {
  try { const response = await pb.send<{ id: string }>('/api/olea/tables/copy', { method: 'POST', body: { game: gameId, template: template.id } }); selectedId.value = response.id; editing.value = false; clearResult(); await load() }
  catch (cause) { error.value = apiError(cause, 'The template could not be copied.') }
}
function setType(entry: TableEntry, type: ResultType) { entry.type = type; entry.ref = ''; pickerIndex.value = -1 }
function chooseCatalog(record: CatalogRecord) { const entry = draft.value.entries[pickerIndex.value]; if (entry) { entry.ref = record.id; referenceNames.value[record.id] = `${record.name} · ${record.source}` }; pickerIndex.value = -1 }
async function roll(value?: number | '') {
  if (!selected.value) return
  error.value = ''; clearResult()
  let number: number
  try {
    if (value !== undefined) { if (value === '' || !Number.isInteger(value) || value < -100000 || value > 100000) throw new Error('Enter a whole-number roll from −100000 to 100000.'); number = value }
    else { if (!selected.value.dice) throw new Error('This table has no dice expression; enter a manual roll.'); number = evaluateDice(selected.value.dice) }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not roll.'; return }
  rolled.value = number; result.value = findResult(selected.value.entries, number) ?? null
  const entry = result.value
  if (!entry?.type || !entry.ref || !game.value) return
  const generation = resolveGeneration
  try {
    const record = await pb.collection(entry.type === 'encounter' ? 'encounters' : 'catalog').getOne<Reference>(entry.ref, { requestKey: null })
    if (generation !== resolveGeneration) return
    if (entry.type === 'encounter' ? record.game !== gameId : record.system !== game.value.system || record.type !== entry.type) { missing.value = true; return }
    resolved.value = record
  } catch { if (generation === resolveGeneration) missing.value = true }
}
async function addToEncounter() {
  const creature = resolved.value
  if (!creature || result.value?.type !== 'creature' || !encounters.value.some((encounter) => encounter.id === targetEncounter.value)) return
  try {
    const encounter = encounters.value.find((value) => value.id === targetEncounter.value)!
    await pb.send('/api/olea/tables/add-creature', { method: 'POST', body: { game: gameId, encounter: encounter.id, creature: creature.id } })
    error.value = ''; targetEncounter.value = ''; notice.value = `Added ${creature.name} to ${encounter.name}.`
  } catch { error.value = 'Could not add the creature. Check the encounter and reference still exist.' }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state">Loading tables…</div>
    <template v-else-if="game">
      <RouterLink class="text-link" :to="{ name: 'game-characters', params: { gameId } }">← {{ game.name }}</RouterLink>
      <div class="screen-heading"><div><p class="eyebrow">GAME MASTER</p><h1 id="page-title">Random tables</h1><p class="screen-description">Create tables, roll dice or enter a result from your own dice.</p></div><button class="primary-button" type="button" @click="create">＋ New table</button></div>
      <p v-if="error" class="alert-message" role="alert">{{ error }}</p>
      <p v-if="notice" class="muted-hint" role="status">{{ notice }}</p>
      <details class="editor-panel"><summary>System templates ({{ templates.length }})</summary><p class="muted-hint">Templates are read-only. Copy one to this game to edit it.</p><p v-if="!templates.length" class="muted-hint">No templates have been imported for this system.</p><article v-for="template in templates" :key="template.id" class="table-template"><div><strong>{{ template.name }}</strong><p class="muted-hint">{{ template.source }} · {{ template.dice || 'Manual rolls' }} · {{ template.entries.length }} entries</p><ul class="template-entries"><li v-for="(entry, i) in template.entries" :key="i">{{ entry.min }}–{{ entry.max }}: {{ entry.text }}<span v-if="entry.type"> ({{ entry.type }}: {{ referenceNames[entry.ref] || 'Missing catalog entry' }})</span></li></ul></div><button class="secondary-button" type="button" @click="copy(template)">Copy to game</button></article></details>
      <div v-if="tables.length" class="table-tabs" aria-label="Game tables"><button v-for="table in tables" :key="table.id" type="button" class="spellbook-tab" :class="{ selected: table.id === selectedId }" @click="select(table.id)">{{ table.name }}</button></div>
      <form v-if="editing" class="editor-panel" @submit.prevent="save">
        <h2>{{ isEditingExisting ? 'Edit table' : 'New table' }}</h2>
        <label class="field-label" for="table-name">Name</label><input id="table-name" v-model="draft.name" class="text-input" maxlength="160" required />
        <label class="field-label" for="table-dice">Dice expression (optional)</label><input id="table-dice" v-model="draft.dice" class="text-input" maxlength="120" placeholder="e.g. 1d20 or 2d6+1" /><p class="muted-hint">Leave empty to use manual rolls only. Gaps in ranges result in no match.</p>
        <fieldset v-for="(entry, index) in draft.entries" :key="index" class="table-entry"><legend>Entry {{ index + 1 }}</legend><div class="table-range"><label class="filter-field">From<input v-model.number="entry.min" class="text-input" type="number" min="-100000" max="100000" step="1" required /></label><label class="filter-field">To<input v-model.number="entry.max" class="text-input" type="number" min="-100000" max="100000" step="1" required /></label></div><label class="field-label" :for="`entry-text-${index}`">Result text</label><textarea :id="`entry-text-${index}`" v-model="entry.text" class="text-area" maxlength="10000" /><label class="field-label" :for="`entry-type-${index}`">Reference</label><select :id="`entry-type-${index}`" class="select-input" :value="entry.type" @change="setType(entry, ($event.target as HTMLSelectElement).value as ResultType)"><option value="">Text only</option><option value="item">Item</option><option value="spell">Spell</option><option value="creature">Creature</option><option value="encounter">Encounter</option></select>
          <template v-if="entry.type === 'encounter'"><label class="field-label" :for="`entry-encounter-${index}`">Game encounter</label><select :id="`entry-encounter-${index}`" v-model="entry.ref" class="select-input"><option value="">Choose an encounter</option><option v-if="entry.ref && !encounters.some((e) => e.id === entry.ref)" :value="entry.ref">Missing encounter</option><option v-for="encounter in encounters" :key="encounter.id" :value="encounter.id">{{ encounter.name }}</option></select></template>
          <template v-else-if="entry.type"><p class="muted-hint">{{ entry.ref ? `Selected: ${referenceNames[entry.ref] || 'Missing catalog entry'}` : 'No catalog entry selected.' }}</p><button class="secondary-button" type="button" @click="pickerIndex = pickerIndex === index ? -1 : index">Choose {{ entry.type }}</button><CatalogPicker v-if="pickerIndex === index" :key="`${index}-${entry.type}`" :system-id="game.system" :type="entry.type as CatalogType" @select="chooseCatalog" /></template>
          <div class="form-actions"><button class="danger-button" type="button" @click="draft.entries.splice(index, 1); pickerIndex = -1">Remove entry</button></div>
        </fieldset>
        <button class="secondary-button" type="button" @click="draft.entries.push({ min: '', max: '', text: '', type: '', ref: '' })">＋ Add entry</button><div class="form-actions"><button class="secondary-button" type="button" @click="editing = false">Cancel</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save table' }}</button></div>
      </form>
      <section v-else-if="selected" class="editor-panel"><div class="spellbook-heading"><div><h2>{{ selected.name }}</h2><p class="muted-hint">{{ selected.dice || 'Manual rolls' }}</p></div><div class="row-actions"><button class="secondary-button" type="button" @click="edit">Edit</button><button class="danger-button" type="button" @click="remove">Delete</button></div></div><ul class="table-results"><li v-for="(entry, i) in selected.entries" :key="i"><strong>{{ entry.min }}–{{ entry.max }}</strong> {{ entry.text }} <span v-if="entry.type" class="muted-hint">({{ entry.type }})</span></li></ul><div class="heading-actions"><button class="primary-button" type="button" :disabled="!selected.dice" @click="roll()">Roll {{ selected.dice }}</button><label class="filter-field">Manual roll<input v-model.number="manualRoll" class="text-input" type="number" min="-100000" max="100000" step="1" /></label><button class="secondary-button" type="button" @click="roll(manualRoll)">Use roll</button></div><div v-if="rolled !== null" class="table-outcome" role="status"><strong>Roll: {{ rolled }}</strong><p v-if="!result">No entry matches this roll.</p><template v-else><p>{{ result.text }}</p><p v-if="missing">The referenced {{ result.type }} is missing or belongs to another system or game.</p><template v-else-if="resolved"><p>{{ resolved.name }}<span v-if="resolved.source"> · {{ resolved.source }}</span></p><RouterLink v-if="result.type !== 'encounter'" class="secondary-link" :to="{ name: 'catalog-detail', params: { recordId: resolved.id } }">Open catalog entry</RouterLink><RouterLink v-else class="secondary-link" :to="{ name: 'game-encounters', params: { gameId }, query: { encounter: resolved.id } }">Open encounter</RouterLink><div v-if="result.type === 'creature'" class="heading-actions"><label class="filter-field">Add to encounter<select v-model="targetEncounter" class="select-input"><option value="">Choose encounter</option><option v-for="encounter in encounters" :key="encounter.id" :value="encounter.id">{{ encounter.name }}</option></select></label><button class="secondary-button" type="button" :disabled="!targetEncounter" @click="addToEncounter">Add creature</button></div></template><p v-else-if="result.type">Resolving reference…</p></template></div></section>
      <div v-else-if="!editing" class="empty-state"><h2>No tables yet</h2><p>Create a table or copy a system template.</p><button class="primary-button empty-action" type="button" @click="create">＋ New table</button></div>
    </template><p v-else class="alert-message">This game could not be found.</p>
  </section>
</template>
