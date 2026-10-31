<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import CatalogPicker from '../components/CatalogPicker.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'

type Game = { id: string; name: string; system: string; expand?: { system?: { key: string; name: string } } }
type Encounter = { id: string; game: string; name: string }
type Entry = { id: string; encounter: string; creature: string; name: string; quantity: number; notes: string; custom: boolean; expand?: { creature?: CatalogRecord } }

const route = useRoute()
const gameId = computed(() => String(route.params.gameId))
const game = ref<Game | null>(null)
const encounters = ref<Encounter[]>([])
const entries = ref<Entry[]>([])
const selectedId = ref('')
const selected = computed(() => encounters.value.find((entry) => entry.id === selectedId.value) ?? null)
const loading = ref(true)
const error = ref('')
const formOpen = ref(false)
const editingId = ref('')
const name = ref('')
const pickerOpen = ref(false)
const customOpen = ref(false)
const customName = ref('')
const customQuantity = ref(1)
const customNotes = ref('')
const entryDrafts = ref<Record<string, { quantity: number; notes: string }>>({})

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [gameRecord, encounterRecords] = await Promise.all([
      pb.collection('games').getOne<Game>(gameId.value, { expand: 'system' }),
      pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:game}', { game: gameId.value }), sort: 'name', requestKey: null }),
    ])
    game.value = gameRecord
    encounters.value = encounterRecords
    if (!encounterRecords.some((entry) => entry.id === selectedId.value)) selectedId.value = encounterRecords[0]?.id ?? ''
    await loadEntries()
  } catch { error.value = 'Encounters could not be loaded. Check the connection and try again.' }
  finally { loading.value = false }
}

async function loadEntries() {
  if (!selectedId.value) { entries.value = []; return }
  entries.value = await pb.collection('encounter_creatures').getFullList<Entry>({
    filter: pb.filter('encounter = {:encounter}', { encounter: selectedId.value }), sort: 'name', expand: 'creature', requestKey: null,
  })
  entryDrafts.value = Object.fromEntries(entries.value.map((entry) => [entry.id, { quantity: entry.quantity, notes: entry.notes ?? '' }]))
}

async function selectEncounter(id: string) {
  selectedId.value = id
  try { await loadEntries() } catch { error.value = 'Encounter entries could not be loaded.' }
}

function beginCreate() { editingId.value = ''; name.value = ''; formOpen.value = true }
function beginRename(encounter: Encounter) { editingId.value = encounter.id; name.value = encounter.name; formOpen.value = true }

async function saveEncounter() {
  if (!name.value.trim()) return
  try {
    if (editingId.value) await pb.collection('encounters').update(editingId.value, { name: name.value.trim() })
    else {
      const created = await pb.collection('encounters').create<Encounter>({ game: gameId.value, name: name.value.trim() })
      selectedId.value = created.id
    }
    formOpen.value = false
    await load()
  } catch { error.value = 'The encounter could not be saved.' }
}

async function duplicateEncounter(encounter: Encounter) {
  try {
    const copy = await pb.collection('encounters').create<Encounter>({ game: gameId.value, name: `${encounter.name} (copy)` })
    const sourceEntries = await pb.collection('encounter_creatures').getFullList<Entry>({ filter: pb.filter('encounter = {:id}', { id: encounter.id }), requestKey: null })
    for (const entry of sourceEntries) {
      await pb.collection('encounter_creatures').create({ encounter: copy.id, creature: entry.creature || '', name: entry.name, quantity: entry.quantity, notes: entry.notes ?? '', custom: entry.custom })
    }
    selectedId.value = copy.id
    await load()
  } catch { error.value = 'The encounter could not be duplicated.' }
}

async function deleteEncounter(encounter: Encounter) {
  if (!window.confirm(`Delete “${encounter.name}” and its prepared creatures? This cannot be undone.`)) return
  try { await pb.collection('encounters').delete(encounter.id); selectedId.value = ''; await load() }
  catch { error.value = 'The encounter could not be deleted.' }
}

async function addCreature(creature: CatalogRecord) {
  if (!selected.value) return
  try {
    await pb.collection('encounter_creatures').create({ encounter: selected.value.id, creature: creature.id, name: creature.name, quantity: 1, notes: '', custom: false })
    await loadEntries()
  } catch { error.value = 'The creature could not be added.' }
}

async function addCustom() {
  if (!selected.value || !customName.value.trim() || !Number.isInteger(customQuantity.value) || customQuantity.value < 1 || customQuantity.value > 100) return
  try {
    await pb.collection('encounter_creatures').create({ encounter: selected.value.id, name: customName.value.trim(), quantity: customQuantity.value, notes: customNotes.value, custom: true })
    customName.value = ''; customQuantity.value = 1; customNotes.value = ''; customOpen.value = false
    await loadEntries()
  } catch { error.value = 'The custom participant could not be added.' }
}

async function saveEntry(entry: Entry) {
  const draft = entryDrafts.value[entry.id]
  if (!draft || !Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 100) { error.value = 'Quantity must be a whole number from 1 to 100.'; return }
  try {
    await pb.collection('encounter_creatures').update(entry.id, { quantity: draft.quantity, notes: draft.notes })
    await loadEntries()
  } catch { error.value = 'The creature entry could not be updated.' }
}

async function removeEntry(entry: Entry) {
  try { await pb.collection('encounter_creatures').delete(entry.id); await loadEntries() }
  catch { error.value = 'The creature entry could not be removed.' }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading encounters…</div>
    <template v-else-if="game">
      <RouterLink class="text-link" :to="{ name: 'game-characters', params: { gameId: game.id } }">← {{ game.name }}</RouterLink>
      <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> {{ game.expand?.system?.name ?? 'GAME' }}</p><h1 id="page-title">Encounters</h1><p class="screen-description">Prepare reusable creature groupings for {{ game.name }}. Preparation stays separate from live combat.</p></div><button class="primary-button" type="button" @click="beginCreate">＋ New encounter</button></div>
      <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Refresh</button></p>
      <form v-if="formOpen" class="editor-panel" @submit.prevent="saveEncounter"><h2>{{ editingId ? 'Rename encounter' : 'New encounter' }}</h2><label class="field-label" for="encounter-name">Name</label><input id="encounter-name" v-model="name" class="text-input" maxlength="160" required /><div class="form-actions"><button class="secondary-button" type="button" @click="formOpen = false">Cancel</button><button class="primary-button" type="submit">Save encounter</button></div></form>
      <div v-if="encounters.length" class="encounter-layout">
        <aside class="encounter-sidebar" aria-label="Prepared encounters"><button v-for="encounter in encounters" :key="encounter.id" class="spellbook-tab" :class="{ selected: encounter.id === selectedId }" type="button" @click="selectEncounter(encounter.id)">{{ encounter.name }}<small>{{ encounter.id === selectedId ? entries.length + ' creature types' : '' }}</small></button></aside>
        <section v-if="selected" class="encounter-content">
          <div class="spellbook-heading"><div><p class="eyebrow">PREPARATION</p><h2>{{ selected.name }}</h2></div><div class="row-actions"><button class="secondary-button" type="button" @click="beginRename(selected)">Rename</button><button class="secondary-button" type="button" @click="duplicateEncounter(selected)">Duplicate</button><button class="danger-button" type="button" @click="deleteEncounter(selected)">Delete</button></div></div>
          <div class="heading-actions"><button class="primary-button" type="button" @click="pickerOpen = !pickerOpen">＋ Add catalog creature</button><button class="secondary-button" type="button" @click="customOpen = !customOpen">＋ Add custom participant</button></div>
          <div v-if="pickerOpen" class="editor-panel"><div class="catalog-panel-heading"><h2>Choose a creature</h2><button class="secondary-button" type="button" @click="pickerOpen = false">Close</button></div><CatalogPicker :system-id="game.system" type="creature" @select="addCreature" /></div>
          <form v-if="customOpen" class="editor-panel" @submit.prevent="addCustom"><h2>Custom participant</h2><label class="field-label" for="custom-creature-name">Name</label><input id="custom-creature-name" v-model="customName" class="text-input" maxlength="255" required /><label class="field-label" for="custom-creature-quantity">Quantity</label><input id="custom-creature-quantity" v-model.number="customQuantity" class="text-input" type="number" min="1" max="100" step="1" required /><label class="field-label" for="custom-creature-notes">Notes</label><textarea id="custom-creature-notes" v-model="customNotes" class="text-area" /><div class="form-actions"><button class="secondary-button" type="button" @click="customOpen = false">Cancel</button><button class="primary-button" type="submit">Add participant</button></div></form>
          <div v-if="entries.length" class="encounter-entry-list"><article v-for="entry in entries" :key="entry.id" class="inventory-row"><div class="inventory-item-copy"><strong>{{ entry.name }}</strong><small>{{ entry.custom ? 'Custom participant' : `${entry.expand?.creature?.source ?? 'Catalog'}${entry.expand?.creature?.creature_type ? ` · ${entry.expand.creature.creature_type}` : ''}${entry.expand?.creature?.challenge_rating ? ` · CR ${entry.expand.creature.challenge_rating}` : ''}` }}</small></div><div class="encounter-entry-edit"><label class="filter-field">Quantity<input v-model.number="entryDrafts[entry.id]!.quantity" class="text-input" type="number" min="1" max="100" step="1" /></label><label class="filter-field">Notes<input v-model="entryDrafts[entry.id]!.notes" class="text-input" maxlength="100000" /></label></div><div class="row-actions"><button class="secondary-button" type="button" @click="saveEntry(entry)">Save</button><button class="danger-button" type="button" @click="removeEntry(entry)">Remove</button></div></article></div>
          <div v-else-if="!pickerOpen" class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">⚔</div><h2>No creatures prepared</h2><p>Add catalog creatures or custom participants. This grouping can be kept for reuse or deleted after printing.</p><button class="primary-button empty-action" type="button" @click="pickerOpen = true">＋ Add catalog creature</button></div>
        </section>
      </div>
      <div v-else-if="!formOpen" class="empty-state"><div class="empty-state-icon" aria-hidden="true">⚔</div><h2>No encounters yet</h2><p>Create an encounter as a reusable preparation or print grouping.</p><button class="primary-button empty-action" type="button" @click="beginCreate">＋ Create encounter</button></div>
    </template>
    <p v-else class="alert-message" role="alert">This game could not be found.</p>
  </section>
</template>
