<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import CatalogPicker from '../components/CatalogPicker.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { evaluateDice, parseHPFormula } from '../lib/dice'
import { abilityModifier, rollGroupInitiative as rollGroupDice, rollInitiative } from '../lib/dnd5e'
import { adndHitDice } from '../lib/adnd'
import { guardedUpdate, isConflict } from '../lib/records'

type Game = { id: string; updated: string; name: string; system: string; encounter_visible: boolean; encounter_show_initiative: boolean; encounter_show_enemy_names: boolean; encounter_show_hp: boolean; encounter_show_conditions: boolean; expand?: { system?: { key: string; name: string } } }
type Encounter = { id: string; game: string; name: string }
type Entry = { id: string; encounter: string; creature: string; name: string; quantity: number; notes: string; custom: boolean; expand?: { creature?: CatalogRecord } }
type Character = { id: string; name: string; game: string }
type Combat = { id: string; updated: string; encounter: string; active: boolean; round: number; turn: number; tie_order: string; name: string; visible: boolean; show_initiative: boolean; show_enemy_names: boolean; show_hp: boolean; show_conditions: boolean }
type Combatant = { id: string; updated: string; combat: string; character: string; prepared: string; name: string; enemy: boolean; current_hp: number; max_hp: number; hp_known: boolean; initiative: number; initiative_known: boolean; initiative_modifier: number; initiative_modifier_override: boolean; dexterity_modifier: number; dexterity_known: boolean; hp_formula: string; conditions: string; notes: string; sort_order: number; expand?: { character?: Character; prepared?: Entry } }

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
const combat = ref<Combat | null>(null)
const combatants = ref<Combatant[]>([])
const gameCharacters = ref<Character[]>([])
const newParticipantName = ref('')
const combatDrafts = ref<Record<string, { initiative: number | ''; current_hp: number | ''; max_hp: number | ''; conditions: string; notes: string }>>({})
const hpPreview = ref<Record<string, { current: number; max: number }>>({})
const initiativeModifiers = ref<Record<string, number | ''>>({})
const combatSnapshots = ref<Record<string, Combatant>>({})
const selectedForGroup = ref<string[]>([])
const diceError = ref('')
const orderedCombatants = computed(() => {
  const tieOrder = combat.value?.tie_order ? JSON.parse(combat.value.tie_order) as string[] : []
  return [...combatants.value].sort((a, b) => {
    if (a.initiative_known !== b.initiative_known) return a.initiative_known ? -1 : 1
    if (a.initiative_known && b.initiative_known && a.initiative !== b.initiative) return b.initiative - a.initiative
    const ai = tieOrder.indexOf(a.id), bi = tieOrder.indexOf(b.id)
    if (ai >= 0 || bi >= 0) return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi)
    return a.sort_order - b.sort_order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
})
const activeCombatant = computed(() => orderedCombatants.value[combat.value?.turn ?? 0] ?? null)
let loadGeneration = 0

const unsubscribe = ref<Array<() => Promise<void>>>([])
let realtimeGeneration = 0
onMounted(async () => {
  await load()
  await subscribe()
  window.addEventListener('olea-reconnected', refreshAfterReconnect)
  window.addEventListener('focus', refreshAfterReconnect)
})
onUnmounted(() => {
  realtimeGeneration++
  window.removeEventListener('olea-reconnected', refreshAfterReconnect)
  window.removeEventListener('focus', refreshAfterReconnect)
  for (const stop of unsubscribe.value) void stop()
})

async function subscribe() {
  const generation = ++realtimeGeneration
  for (const stop of unsubscribe.value) void stop()
  unsubscribe.value = []
  if (!selectedId.value) return
  const collections = ['games', 'encounters', 'encounter_creatures', 'combats', 'combatants']
  try {
    const stops = await Promise.all(collections.map((collection) => pb.collection(collection).subscribe('*', () => { void refreshLiveCombat() })))
    if (generation !== realtimeGeneration) { for (const stop of stops) void stop(); return }
    unsubscribe.value = stops
  } catch { error.value = 'Live updates are unavailable. Refresh to see current data.' }
}
async function refreshAfterReconnect() { await refreshLiveCombat(); await subscribe() }
async function refreshLiveCombat() {
  try {
    const encounterId = selectedId.value
    const drafts = combatDrafts.value
    const modifiers = initiativeModifiers.value
    const snapshots = combatSnapshots.value
    const gameRecord = await pb.collection('games').getOne<Game>(gameId.value, { expand: 'system', requestKey: null })
    const encounterRecords = await pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:game}', { game: gameId.value }), sort: 'name', requestKey: null })
    if (encounterId !== selectedId.value) return
    game.value = gameRecord
    encounters.value = encounterRecords
    await loadEntries()
    await loadCombat()
    if (encounterId !== selectedId.value) return
    for (const participant of combatants.value) {
      if (drafts[participant.id]) combatDrafts.value[participant.id] = drafts[participant.id]
      if (modifiers[participant.id] !== undefined) initiativeModifiers.value[participant.id] = modifiers[participant.id]
      if (snapshots[participant.id]) combatSnapshots.value[participant.id] = snapshots[participant.id]
    }
  } catch { error.value = 'Live encounter could not be refreshed. Check the connection.' }
}

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  error.value = ''
  try {
    const [gameRecord, encounterRecords] = await Promise.all([
      pb.collection('games').getOne<Game>(gameId.value, { expand: 'system' }),
      pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:game}', { game: gameId.value }), sort: 'name', requestKey: null }),
    ])
    if (generation !== loadGeneration) return
    game.value = gameRecord
    encounters.value = encounterRecords
    if (!encounterRecords.some((entry) => entry.id === selectedId.value)) {
      const requested = String(route.query.encounter ?? '')
      selectedId.value = encounterRecords.find((entry) => entry.id === requested)?.id ?? encounterRecords[0]?.id ?? ''
    }
    await loadEntries()
    if (generation !== loadGeneration) return
    await loadCombat()
  } catch { error.value = 'Encounters could not be loaded. Check the connection and try again.' }
  finally { if (generation === loadGeneration) loading.value = false }
}

async function loadEntries() {
  if (!selectedId.value) { entries.value = []; return }
  const encounterId = selectedId.value
  const result = await pb.collection('encounter_creatures').getFullList<Entry>({
    filter: pb.filter('encounter = {:encounter}', { encounter: encounterId }), sort: 'name', expand: 'creature', requestKey: null,
  })
  if (encounterId !== selectedId.value) return
  entries.value = result
  entryDrafts.value = Object.fromEntries(entries.value.map((entry) => [entry.id, { quantity: entry.quantity, notes: entry.notes ?? '' }]))
}

async function loadCombat() {
  if (!selectedId.value) { combat.value = null; combatants.value = []; return }
  const encounterId = selectedId.value
  const active = await pb.collection('combats').getList<Combat>(1, 1, { filter: pb.filter('encounter = {:encounter} && active = true', { encounter: encounterId }), sort: 'id', requestKey: null })
  if (encounterId !== selectedId.value) return
  combat.value = active.items[0] ?? null
  if (combat.value) {
    const combatId = combat.value.id
    const result = await pb.collection('combatants').getFullList<Combatant>({ filter: pb.filter('combat = {:combat}', { combat: combatId }), sort: 'sort_order,name', expand: 'character,prepared', requestKey: null })
    if (encounterId !== selectedId.value || combat.value?.id !== combatId) return
    combatants.value = result
    syncCombatDrafts()
  } else combatants.value = []
  gameCharacters.value = game.value ? await pb.collection('characters').getFullList<Character>({ filter: pb.filter('game = {:game}', { game: game.value.id }), sort: 'name', requestKey: null }) : []
}

function syncCombatDrafts() {
  combatDrafts.value = Object.fromEntries(combatants.value.map((entry) => [entry.id, { initiative: entry.initiative_known ? entry.initiative : '', current_hp: entry.hp_known ? entry.current_hp : '', max_hp: entry.hp_known ? entry.max_hp : '', conditions: entry.conditions ?? '', notes: entry.notes ?? '' }]))
  combatSnapshots.value = Object.fromEntries(combatants.value.map((entry) => [entry.id, { ...entry }]))
  initiativeModifiers.value = Object.fromEntries(combatants.value.map((entry) => [entry.id, entry.initiative_modifier_override ? entry.initiative_modifier : entry.dexterity_known ? entry.dexterity_modifier : '']))
}

function hpFromSource(participant: Combatant): { average: number | null; formula: string | null } {
  if (!participant.enemy || !participant.prepared) return { average: null, formula: null }
  const prepared = entries.value.find((entry) => entry.id === participant.prepared)
  const source = prepared?.expand?.creature?.original_json
  if (!source || typeof source !== 'object') return { average: null, formula: null }
  if ((source as Record<string, unknown>).format === 'adnd2e-html') return { average: null, formula: adndHitDice(source) }
  const hp = (source as Record<string, unknown>).hp
  if (!hp || typeof hp !== 'object') return { average: null, formula: null }
  const average = (hp as Record<string, unknown>).average
  return { average: typeof average === 'number' && Number.isFinite(average) && average >= 0 ? average : null, formula: parseHPFormula((hp as Record<string, unknown>).formula) }
}

function previewHP(participant: Combatant, mode: 'average' | 'roll' | 'manual') {
  diceError.value = ''
  if (mode === 'manual') {
    const draft = combatDrafts.value[participant.id]!
    const current = Number(draft.current_hp), max = Number(draft.max_hp)
    if (draft.current_hp === '' || draft.max_hp === '' || !Number.isFinite(current) || !Number.isFinite(max) || current < 0 || max < 0) { diceError.value = 'Enter nonnegative current and max HP first.'; return }
    hpPreview.value[participant.id] = { current, max }
    return
  }
  const source = hpFromSource(participant)
  if (mode === 'average') {
    if (source.average === null) { diceError.value = 'This creature has no imported HP average. Enter HP manually or use a supported formula.'; return }
    hpPreview.value[participant.id] = { current: source.average, max: source.average }
    return
  }
  if (!source.formula) { diceError.value = 'This HP formula is missing or unsupported. Enter HP manually.'; return }
  try { const result = Math.max(0, evaluateDice(source.formula)); hpPreview.value[participant.id] = { current: result, max: result } }
  catch (cause) { diceError.value = cause instanceof Error ? cause.message : 'HP formula could not be rolled.' }
}

async function confirmHP(participant: Combatant) {
  const preview = hpPreview.value[participant.id]
  if (!preview) return
  try {
    await guardedUpdate('combatants', participant, { current_hp: preview.current, max_hp: preview.max, hp_known: true })
    delete hpPreview.value[participant.id]
    await loadCombat()
  } catch (cause) { diceError.value = isConflict(cause) ? 'Combatant changed elsewhere; current values were refreshed.' : 'HP could not be saved.'; await loadCombat() }
}

async function startCombat() {
  if (!selected.value || !entries.value.length) return
  let created: Combat | null = null
  try {
    const active = await pb.collection('combats').getList<Combat>(1, 1, { filter: pb.filter('active = true && encounter.game = {:game}', { game: gameId.value }), requestKey: null })
    if (active.totalItems) { error.value = 'End the active combat in this game before starting another.'; return }
    created = await pb.collection('combats').create<Combat>({ encounter: selected.value.id, active: true, round: 1, turn: 0, tie_order: '[]', name: selected.value.name })
    combat.value = created
    for (const [index, entry] of entries.value.entries()) {
      for (let count = 0; count < entry.quantity; count++) {
        const label = entry.quantity > 1 ? `${entry.name} ${count + 1}` : entry.name
        const creature = entry.expand?.creature
        const source = creature?.original_json && typeof creature.original_json === 'object' ? creature.original_json as Record<string, unknown> : {}
        const hp = source.hp && typeof source.hp === 'object' ? source.hp as Record<string, unknown> : {}
        const dexterity = typeof source.dex === 'number' && Number.isInteger(source.dex) && source.dex >= 0 && source.dex <= 30 ? source.dex : null
        await pb.collection('combatants').create({ combat: created.id, prepared: entry.id, name: label, enemy: true, notes: entry.notes ?? '', sort_order: index * 100 + count, hp_formula: typeof hp.formula === 'string' ? hp.formula : '', ...(dexterity === null ? {} : { dexterity_modifier: abilityModifier(dexterity), dexterity_known: true }) })
      }
    }
    await loadCombat()
  } catch {
    if (created) { try { await pb.collection('combats').delete(created.id) } catch { /* Report the partially started combat below. */ } }
    error.value = 'Combat could not be started. Refresh to check whether a partial combat remains.'
  }
}

async function addCharacter(character: Character) {
  if (!combat.value || combatants.value.some((entry) => entry.character === character.id)) return
  try {
    await pb.collection('combatants').create({ combat: combat.value.id, character: character.id, name: character.name, enemy: false, sort_order: combatants.value.length })
    await loadCombat()
  } catch { error.value = 'The character could not be added to combat.' }
}

async function addCustomCombatant() {
  if (!combat.value || !newParticipantName.value.trim()) return
  try {
    await pb.collection('combatants').create({ combat: combat.value.id, name: newParticipantName.value.trim(), enemy: false, sort_order: combatants.value.length })
    newParticipantName.value = ''; await loadCombat()
  } catch { error.value = 'The participant could not be added.' }
}

async function saveCombatant(participant: Combatant) {
  const draft = combatDrafts.value[participant.id]
  if (!draft) return
  if (draft.initiative !== '' && !Number.isFinite(Number(draft.initiative))) { error.value = 'Initiative must be a number.'; return }
  const hpKnown = draft.current_hp !== '' || draft.max_hp !== ''
  const currentHP = draft.current_hp === '' ? 0 : Number(draft.current_hp)
  const maxHP = draft.max_hp === '' ? 0 : Number(draft.max_hp)
  if (hpKnown && (!Number.isFinite(currentHP) || !Number.isFinite(maxHP) || currentHP < 0 || maxHP < 0)) { error.value = 'HP values must be nonnegative numbers.'; return }
  const rawModifier = initiativeModifiers.value[participant.id]
  const modifierOverride = rawModifier !== '' && rawModifier !== undefined && rawModifier !== (participant.dexterity_known ? participant.dexterity_modifier : '')
  if (rawModifier !== '' && rawModifier !== undefined && (!Number.isInteger(rawModifier) || rawModifier < -20 || rawModifier > 20)) { error.value = 'Initiative modifier must be a whole number from −20 to +20.'; return }
  try {
    await guardedUpdate('combatants', combatSnapshots.value[participant.id] ?? participant, { initiative: draft.initiative === '' ? 0 : Number(draft.initiative), initiative_known: draft.initiative !== '', initiative_modifier: rawModifier === '' || rawModifier === undefined ? 0 : Number(rawModifier), initiative_modifier_override: modifierOverride, current_hp: currentHP, max_hp: maxHP, hp_known: hpKnown, conditions: draft.conditions, notes: draft.notes })
    await loadCombat()
  } catch (cause) { error.value = isConflict(cause) ? 'This combatant changed elsewhere. Current values have been refreshed; review before saving again.' : 'The combatant could not be saved.'; await loadCombat() }
}

async function rollOneInitiative(participant: Combatant) {
  try {
    const raw = initiativeModifiers.value[participant.id]
    const modifier = raw === '' || raw === undefined ? participant.dexterity_known ? participant.dexterity_modifier : 0 : Number(raw)
    const result = rollInitiative(modifier)
    await guardedUpdate('combatants', participant, { initiative: result, initiative_known: true, initiative_modifier: modifier, initiative_modifier_override: raw !== '' && raw !== undefined && (!participant.dexterity_known || modifier !== participant.dexterity_modifier) })
    await loadCombat()
  } catch (cause) { diceError.value = isConflict(cause) ? 'Combatant changed elsewhere. Current values have been refreshed.' : cause instanceof Error ? cause.message : 'Initiative could not be rolled.'; await loadCombat() }
}

async function rollGroupInitiative() {
  const targets = orderedCombatants.value.filter((participant) => selectedForGroup.value.includes(participant.id))
  if (!targets.length) { diceError.value = 'Select one or more participants to roll.'; return }
  diceError.value = ''
  try {
    const modifiers = targets.map((participant) => {
      const raw = initiativeModifiers.value[participant.id]
      return raw === '' || raw === undefined ? participant.dexterity_known ? participant.dexterity_modifier : 0 : Number(raw)
    })
    const results = rollGroupDice(modifiers)
    for (const [index, participant] of targets.entries()) {
      const modifier = modifiers[index]
      await guardedUpdate('combatants', participant, { initiative: results[index], initiative_known: true, initiative_modifier: modifier, initiative_modifier_override: !participant.dexterity_known || modifier !== participant.dexterity_modifier })
    }
    await loadCombat()
    selectedForGroup.value = []
  } catch (cause) { diceError.value = isConflict(cause) ? 'A selected combatant changed elsewhere. Current values were refreshed.' : 'Selected initiative rolls could not be saved.'; await loadCombat() }
}

async function removeCombatant(participant: Combatant) {
  try { await pb.collection('combatants').delete(participant.id); await loadCombat() }
  catch { error.value = 'The combatant could not be removed.' }
}

async function updateCombat(fields: Partial<Combat>) {
  if (!combat.value) return
  try { await guardedUpdate('combats', combat.value, fields); await loadCombat() }
  catch (cause) { error.value = isConflict(cause) ? 'Combat changed elsewhere. Current values have been refreshed.' : 'Combat tracker could not be updated.'; await loadCombat() }
}

async function saveDisplaySetting(field: 'encounter_visible' | 'encounter_show_initiative' | 'encounter_show_enemy_names' | 'encounter_show_hp' | 'encounter_show_conditions', value: boolean) {
  if (!game.value) return
  try { await guardedUpdate('games', game.value, { [field]: value }); game.value = await pb.collection('games').getOne<Game>(game.value.id, { expand: 'system' }) }
  catch (cause) { error.value = isConflict(cause) ? 'Game settings changed elsewhere. Current values were refreshed.' : 'The player display setting could not be saved.'; await load() }
}

async function moveTurn(direction: number) {
  if (!combat.value || !orderedCombatants.value.length) return
  let turn = combat.value.turn + direction
  let round = combat.value.round
  if (turn >= orderedCombatants.value.length) { turn = 0; round += 1 }
  if (turn < 0) { if (round <= 1) return; turn = orderedCombatants.value.length - 1; round -= 1 }
  await updateCombat({ turn, round })
}

async function resetCombat() {
  if (!combat.value) return
  try {
    for (const participant of combatants.value) await guardedUpdate('combatants', participant, { initiative: 0, initiative_known: false, current_hp: 0, max_hp: 0, hp_known: false, conditions: '' })
    await updateCombat({ active: true, round: 1, turn: 0, tie_order: '[]' })
  } catch { error.value = 'Combat could not be reset.' }
}

async function endCombat() { if (combat.value) await updateCombat({ active: false }) }

async function setTieOrder(participant: Combatant, direction: number) {
  if (!combat.value) return
  const tied = orderedCombatants.value.filter((entry) => entry.initiative_known === participant.initiative_known && (!entry.initiative_known || entry.initiative === participant.initiative))
  const tieOrder = orderedCombatants.value.map((entry) => entry.id)
  const index = tieOrder.indexOf(participant.id)
  const swap = index + direction
  if (swap < 0 || swap >= tieOrder.length || !tied.some((entry) => entry.id === tieOrder[swap])) return
  ;[tieOrder[index], tieOrder[swap]] = [tieOrder[swap], tieOrder[index]]
  await updateCombat({ tie_order: JSON.stringify(tieOrder) })
}

async function selectEncounter(id: string) {
  selectedId.value = id
  try { await loadEntries(); await loadCombat(); await subscribe() } catch { error.value = 'Encounter entries could not be loaded.' }
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
      <section class="combat-panel">
            <div class="spellbook-heading"><div><p class="eyebrow">LIVE PLAY</p><h2>{{ combat?.active ? 'Combat in progress' : 'Manual tracker' }}</h2></div><div class="row-actions"><RouterLink v-if="combat?.active && game.encounter_visible" class="secondary-link" :to="{ name: 'player-encounter', params: { gameId: game.id } }">Player view</RouterLink><button v-if="!combat?.active" class="primary-button" type="button" :disabled="!entries.length" @click="startCombat">Start combat</button><template v-else><span class="round-pill">Round {{ combat.round }}</span><button class="secondary-button" type="button" @click="resetCombat">Reset</button><button class="danger-button" type="button" @click="endCombat">End combat</button></template></div></div>
            <template v-if="combat?.active">
              <details class="player-display-settings"><summary>Player display settings</summary><p>These settings hide details in the player-facing UI only; they are not access controls on this trusted LAN.</p><label class="check-field"><input type="checkbox" :checked="game.encounter_visible" @change="saveDisplaySetting('encounter_visible', ($event.target as HTMLInputElement).checked)" /> Show active encounter</label><label class="check-field"><input type="checkbox" :checked="game.encounter_show_initiative" @change="saveDisplaySetting('encounter_show_initiative', ($event.target as HTMLInputElement).checked)" /> Show initiative</label><label class="check-field"><input type="checkbox" :checked="game.encounter_show_enemy_names" @change="saveDisplaySetting('encounter_show_enemy_names', ($event.target as HTMLInputElement).checked)" /> Show enemy names</label><label class="check-field"><input type="checkbox" :checked="game.encounter_show_hp" @change="saveDisplaySetting('encounter_show_hp', ($event.target as HTMLInputElement).checked)" /> Show enemy HP</label><label class="check-field"><input type="checkbox" :checked="game.encounter_show_conditions" @change="saveDisplaySetting('encounter_show_conditions', ($event.target as HTMLInputElement).checked)" /> Show conditions</label></details>
              <p v-if="diceError" class="field-error" role="alert">{{ diceError }}</p>
              <div class="turn-controls"><button class="secondary-button" type="button" :disabled="!orderedCombatants.length" @click="moveTurn(-1)">← Previous</button><p v-if="activeCombatant"><strong>Active:</strong> {{ activeCombatant.name }}</p><p v-else>No participants yet</p><button class="secondary-button" type="button" :disabled="!orderedCombatants.length" @click="moveTurn(1)">Next →</button></div>
              <div class="group-roll"><span>Roll selected initiative with one shared d20</span><button class="secondary-button" type="button" :disabled="!selectedForGroup.length" @click="rollGroupInitiative">Roll group</button></div>
              <div class="participant-add"><label class="filter-field">Add character<select class="select-input" :disabled="gameCharacters.every((character) => combatants.some((entry) => entry.character === character.id))" @change="addCharacter(gameCharacters.find((character) => character.id === ($event.target as HTMLSelectElement).value)!); ($event.target as HTMLSelectElement).value = ''"><option value="">Choose a character</option><option v-for="character in gameCharacters.filter((entry) => !combatants.some((participant) => participant.character === entry.id))" :key="character.id" :value="character.id">{{ character.name }}</option></select></label><form class="custom-participant-form" @submit.prevent="addCustomCombatant"><label class="filter-field">Add custom participant<input v-model="newParticipantName" class="text-input" maxlength="255" placeholder="Name" /></label><button class="secondary-button" type="submit">Add</button></form></div>
              <div v-if="orderedCombatants.length" class="combatant-list"><article v-for="participant in orderedCombatants" :key="participant.id" class="combatant-card" :class="{ active: activeCombatant?.id === participant.id }"><div class="combatant-title"><div><strong>{{ participant.name }}</strong><small>{{ participant.enemy ? 'Enemy' : participant.character ? 'Character' : 'Participant' }}<template v-if="participant.prepared && participant.expand?.prepared?.expand?.creature"> · {{ participant.expand.prepared.expand.creature.source }}</template></small></div><div class="row-actions"><label class="select-combatant"><input v-model="selectedForGroup" type="checkbox" :value="participant.id" /> Select</label><span class="initiative-pill">{{ participant.initiative_known ? `Init ${participant.initiative}` : 'No initiative' }}</span><button class="icon-button tie-button" type="button" aria-label="Move up within initiative tie" title="Move up within tie" @click="setTieOrder(participant, -1)">↑</button><button class="icon-button tie-button" type="button" aria-label="Move down within initiative tie" title="Move down within tie" @click="setTieOrder(participant, 1)">↓</button><button class="secondary-button" type="button" @click="rollOneInitiative(participant)">Roll</button><button class="danger-button" type="button" @click="removeCombatant(participant)">Remove</button></div></div><div class="combatant-fields"><label class="filter-field">Initiative<input v-model.number="combatDrafts[participant.id]!.initiative" class="text-input" type="number" step="any" placeholder="—" /></label><label class="filter-field">Initiative modifier<input v-model.number="initiativeModifiers[participant.id]" class="text-input" type="number" min="-20" max="20" step="1" :placeholder="participant.dexterity_known ? String(participant.dexterity_modifier) : 'Manual or unset'" /></label><label class="filter-field">Current HP<input v-model.number="combatDrafts[participant.id]!.current_hp" class="text-input" type="number" min="0" step="any" placeholder="—" /></label><label class="filter-field">Max HP<input v-model.number="combatDrafts[participant.id]!.max_hp" class="text-input" type="number" min="0" step="any" placeholder="—" /></label><label class="filter-field">Conditions<input v-model="combatDrafts[participant.id]!.conditions" class="text-input" placeholder="e.g. prone" /></label><label class="filter-field">Notes<input v-model="combatDrafts[participant.id]!.notes" class="text-input" placeholder="Notes" /></label><button class="secondary-button" type="button" @click="saveCombatant(participant)">Save</button></div><div v-if="participant.enemy" class="hp-roll-controls"><span>HP {{ participant.hp_known ? `${participant.current_hp}/${participant.max_hp}` : 'not set' }}</span><button class="inline-button" type="button" @click="previewHP(participant, 'average')">Use average</button><button class="inline-button" type="button" @click="previewHP(participant, 'roll')">Roll HP</button><button class="inline-button" type="button" @click="previewHP(participant, 'manual')">Preview manual</button><span v-if="hpPreview[participant.id]" class="preview-confirm">Preview: {{ hpPreview[participant.id]!.current }}/{{ hpPreview[participant.id]!.max }} <button class="secondary-button" type="button" @click="confirmHP(participant)">Confirm HP</button></span></div></article></div>
              <p v-else class="muted-hint">No live participants. Add game characters or custom participants.</p>
            </template>
          </section>
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
