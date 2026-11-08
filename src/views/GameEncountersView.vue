<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import CatalogPicker from '../components/CatalogPicker.vue'
import EncounterLivePanel from '../components/encounters/EncounterLivePanel.vue'
import EncounterPreparation from '../components/encounters/EncounterPreparation.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { evaluateDice } from '../lib/dice'
import { systemForGame } from '../lib/systems'
import { activeParticipant, orderParticipants } from '../lib/encounterOrder'
import { guardedUpdate, isConflict, isDefiniteWriteRejection } from '../lib/records'
import type {
  Character,
  Combat,
  Combatant,
  CombatDraft,
  DisplaySettingField,
  Encounter,
  Entry,
  EntryDraft,
  Game,
  HPPreview,
  HPMode,
  PickerFeedback,
} from '../lib/encounterModel'
import { prepareEncounterPrintReturn, rememberEncounterPrintReturn } from '../composables/useEncounterPrintReturn'
import type { EncounterPrintRestore } from '../composables/useEncounterPrintReturn'

const route = useRoute()
const router = useRouter()
const gameId = computed(() => String(route.params.gameId))
const game = ref<Game | null>(null)
const encounters = ref<Encounter[]>([])
const entries = ref<Entry[]>([])
const selectedId = ref('')
const selected = computed(() => encounters.value.find((entry) => entry.id === selectedId.value) ?? null)
const loading = ref(true)
const switching = ref(false)
const error = ref('')
const formOpen = ref(false)
const editingId = ref('')
const name = ref('')
const pickerOpen = ref(false)
const pickerPending = ref(false)
const pickerFeedback = ref<PickerFeedback | null>(null)
const customOpen = ref(false)
const customName = ref('')
const customQuantity = ref(1)
const customNotes = ref('')
const entryDrafts = ref<Record<string, EntryDraft>>({})
const combat = ref<Combat | null>(null)
const combatants = ref<Combatant[]>([])
const gameCharacters = ref<Character[]>([])
const newParticipantName = ref('')
const combatDrafts = ref<Record<string, CombatDraft>>({})
const hpPreview = ref<Record<string, HPPreview>>({})
const initiativeModifiers = ref<Record<string, number | ''>>({})
const combatSnapshots = ref<Record<string, Combatant>>({})
const selectedForGroup = ref<string[]>([])
const diceError = ref('')
const system = computed(() => systemForGame(game.value))
const rules = computed(() => system.value.encounter)
const orderedCombatants = computed(() => orderParticipants(combatants.value, combat.value?.tie_order ?? '', rules.value))
const activeCombatant = computed(() => activeParticipant(orderedCombatants.value, combat.value?.active_participant ?? '', combat.value?.turn ?? 0))
const printTarget = computed<RouteLocationRaw>(() => ({
  name: 'print-monsters',
  params: { gameId: gameId.value },
  query: selectedId.value ? { encounter: selectedId.value, returnEncounter: selectedId.value } : {},
}))
let loadGeneration = 0
let selectionGeneration = 0
let printRestore: EncounterPrintRestore | null = null

const unsubscribe = ref<Array<() => Promise<void>>>([])
let realtimeGeneration = 0
onMounted(async () => {
  const returnEncounterId = String(route.query.encounter ?? '')
  if (returnEncounterId) printRestore = prepareEncounterPrintReturn(gameId.value, returnEncounterId)
  await load()
  await subscribe()
  await nextTick()
  printRestore?.restore()
  printRestore = null
  window.addEventListener('olea-reconnected', refreshAfterReconnect)
  window.addEventListener('focus', refreshAfterReconnect)
})
onUnmounted(() => {
  printRestore?.cancel()
  printRestore = null
  realtimeGeneration++
  window.removeEventListener('olea-reconnected', refreshAfterReconnect)
  window.removeEventListener('focus', refreshAfterReconnect)
  for (const stop of unsubscribe.value) void stop()
})
watch(() => String(route.query.encounter ?? ''), () => { void syncSelectedFromRoute() })

async function subscribe() {
  const selection = selectionGeneration
  const generation = ++realtimeGeneration
  for (const stop of unsubscribe.value) void stop()
  unsubscribe.value = []
  if (!selectedId.value) return
  const collections = ['games', 'encounters', 'encounter_creatures', 'combats', 'combatants']
  try {
    const stops = await Promise.all(collections.map((collection) => pb.collection(collection).subscribe('*', () => { void refreshLiveCombat() })))
    if (generation !== realtimeGeneration || selection !== selectionGeneration) { for (const stop of stops) void stop(); return }
    unsubscribe.value = stops
  } catch {
    if (generation === realtimeGeneration && selection === selectionGeneration) error.value = 'Live updates are unavailable. Refresh to see current data.'
  }
}
async function refreshAfterReconnect() { await refreshLiveCombat(); await subscribe() }
async function refreshLiveCombat() {
  const generation = selectionGeneration
  const encounterId = selectedId.value
  try {
    const drafts = combatDrafts.value
    const modifiers = initiativeModifiers.value
    const snapshots = combatSnapshots.value
    const gameRecord = await pb.collection('games').getOne<Game>(gameId.value, { expand: 'system', requestKey: null })
    const encounterRecords = await pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:game}', { game: gameId.value }), sort: 'name', requestKey: null })
    if (generation !== selectionGeneration || encounterId !== selectedId.value) return
    game.value = gameRecord
    encounters.value = encounterRecords
    if (!await loadEntries(generation) || !await loadCombat(generation)) return
    if (generation !== selectionGeneration || encounterId !== selectedId.value) return
    for (const participant of combatants.value) {
      if (drafts[participant.id]) combatDrafts.value[participant.id] = drafts[participant.id]
      if (modifiers[participant.id] !== undefined) initiativeModifiers.value[participant.id] = modifiers[participant.id]
      if (snapshots[participant.id]) combatSnapshots.value[participant.id] = snapshots[participant.id]
    }
  } catch {
    if (generation === selectionGeneration) error.value = 'Live encounter could not be refreshed. Check the connection.'
  }
}

async function load() {
  const generation = ++loadGeneration
  const selection = selectionGeneration
  loading.value = true
  error.value = ''
  try {
    const gameRecord = await pb.collection('games').getOne<Game>(gameId.value, { expand: 'system' })
    if (generation !== loadGeneration) return
    game.value = gameRecord
    const encounterRecords = await pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:game}', { game: gameId.value }), sort: 'name', requestKey: null })
    if (generation !== loadGeneration) return
    encounters.value = encounterRecords
    if (!encounterRecords.some((entry) => entry.id === selectedId.value)) {
      const requested = String(route.query.encounter ?? '')
      const requestedEntry = encounterRecords.find((entry) => entry.id === requested)
      selectedId.value = requestedEntry?.id ?? encounterRecords[0]?.id ?? ''
      if (requested && !requestedEntry) replaceEncounterQuery(selectedId.value)
    }
    if (!await loadEntries(selection)) return
    if (generation !== loadGeneration) return
    if (!await loadCombat(selection)) return
    pickerPending.value = false
    pickerFeedback.value = null
  } catch {
    if (generation === loadGeneration && selection === selectionGeneration) error.value = 'Encounters could not be loaded. Check the connection and try again.'
  }
  finally {
    if (generation === loadGeneration) {
      loading.value = false
      void syncSelectedFromRoute()
    }
  }
}

async function loadEntries(generation = selectionGeneration) {
  if (generation !== selectionGeneration) return false
  if (!selectedId.value) { entries.value = []; entryDrafts.value = {}; return true }
  const encounterId = selectedId.value
  const result = await pb.collection('encounter_creatures').getFullList<Entry>({
    filter: pb.filter('encounter = {:encounter}', { encounter: encounterId }), sort: 'name', expand: 'creature', requestKey: null,
  })
  if (generation !== selectionGeneration || encounterId !== selectedId.value) return false
  entries.value = result
  entryDrafts.value = Object.fromEntries(entries.value.map((entry) => [entry.id, { quantity: entry.quantity, notes: entry.notes ?? '' }]))
  return true
}

async function loadCombat(generation = selectionGeneration) {
  if (generation !== selectionGeneration) return false
  if (!selectedId.value) { combat.value = null; combatants.value = []; return true }
  const encounterId = selectedId.value
  const active = await pb.collection('combats').getList<Combat>(1, 1, { filter: pb.filter('encounter = {:encounter} && active = true', { encounter: encounterId }), sort: 'id', requestKey: null })
  if (generation !== selectionGeneration || encounterId !== selectedId.value) return false
  const activeCombat = active.items[0] ?? null
  let result: Combatant[] = []
  if (activeCombat) {
    result = await pb.collection('combatants').getFullList<Combatant>({ filter: pb.filter('combat = {:combat}', { combat: activeCombat.id }), sort: 'sort_order,name', expand: 'character,prepared', requestKey: null })
    if (generation !== selectionGeneration || encounterId !== selectedId.value) return false
  }
  const characters = game.value ? await pb.collection('characters').getFullList<Character>({ filter: pb.filter('game = {:game}', { game: game.value.id }), sort: 'name', requestKey: null }) : []
  if (generation !== selectionGeneration || encounterId !== selectedId.value) return false
  combat.value = activeCombat
  if (activeCombat) {
    combatants.value = result
    syncCombatDrafts()
  } else combatants.value = []
  gameCharacters.value = characters
  return true
}

function syncCombatDrafts() {
  combatDrafts.value = Object.fromEntries(combatants.value.map((entry) => [entry.id, { initiative: entry.initiative_known ? entry.initiative : '', current_hp: entry.hp_known ? entry.current_hp : '', max_hp: entry.hp_known ? entry.max_hp : '', conditions: entry.conditions ?? '', notes: entry.notes ?? '' }]))
  combatSnapshots.value = Object.fromEntries(combatants.value.map((entry) => [entry.id, { ...entry }]))
  initiativeModifiers.value = Object.fromEntries(combatants.value.map((entry) => [entry.id, entry.initiative_modifier_override ? entry.initiative_modifier : entry.dexterity_known ? entry.dexterity_modifier : '']))
}

function hpFromSource(participant: Combatant) {
  if (!participant.enemy || !participant.prepared) return { average: null, formula: null }
  const prepared = entries.value.find((entry) => entry.id === participant.prepared)
  const source = prepared?.expand?.creature?.original_json
  return rules.value.creatureHP(source)
}

function previewHP(participant: Combatant, mode: HPMode) {
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
        const hp = rules.value.creatureHP(source)
        const modifier = rules.value.initiative?.modifier(source) ?? null
        await pb.collection('combatants').create({ combat: created.id, prepared: entry.id, name: label, enemy: true, notes: entry.notes ?? '', sort_order: index * 100 + count, hp_formula: hp.formula ?? '', ...(modifier === null ? {} : { dexterity_modifier: modifier, dexterity_known: true }) })
      }
    }
    await loadCombat()
    if (combat.value && activeCombatant.value) await updateCombat({ active_participant: activeCombatant.value.id })
  } catch {
    if (created) { try { await pb.collection('combats').delete(created.id) } catch { /* Report the partially started combat below. */ } }
    error.value = 'Combat could not be started. Refresh to check whether a partial combat remains.'
  }
}

async function addCharacter(characterId: string) {
  const character = gameCharacters.value.find((entry) => entry.id === characterId)
  if (!combat.value || !character || combatants.value.some((entry) => entry.character === character.id)) return
  try {
    await pb.collection('combatants').create({ combat: combat.value.id, character: character.id, name: character.name, enemy: false, sort_order: combatants.value.length })
    await loadCombat()
    if (combat.value && !combat.value.active_participant && activeCombatant.value) await updateCombat({ active_participant: activeCombatant.value.id })
  } catch { error.value = 'The character could not be added to combat.' }
}

async function addCustomCombatant() {
  if (!combat.value || !newParticipantName.value.trim()) return
  try {
    await pb.collection('combatants').create({ combat: combat.value.id, name: newParticipantName.value.trim(), enemy: false, sort_order: combatants.value.length })
    newParticipantName.value = ''; await loadCombat()
    if (combat.value && !combat.value.active_participant && activeCombatant.value) await updateCombat({ active_participant: activeCombatant.value.id })
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
  const rawModifier = rules.value.initiative ? initiativeModifiers.value[participant.id] : undefined
  const modifierOverride = rawModifier !== '' && rawModifier !== undefined && rawModifier !== (participant.dexterity_known ? participant.dexterity_modifier : '')
  if (rules.value.initiative && rawModifier !== '' && rawModifier !== undefined && (!Number.isInteger(rawModifier) || rawModifier < rules.value.initiative.modifierMin || rawModifier > rules.value.initiative.modifierMax)) { error.value = `Initiative modifier must be a whole number from ${rules.value.initiative.modifierMin} to ${rules.value.initiative.modifierMax}.`; return }
  try {
    await guardedUpdate('combatants', combatSnapshots.value[participant.id] ?? participant, { initiative: draft.initiative === '' ? 0 : Number(draft.initiative), initiative_known: draft.initiative !== '', ...(rules.value.initiative ? { initiative_modifier: rawModifier === '' || rawModifier === undefined ? 0 : Number(rawModifier), initiative_modifier_override: modifierOverride } : {}), current_hp: currentHP, max_hp: maxHP, hp_known: hpKnown, conditions: draft.conditions, notes: draft.notes })
    await loadCombat()
  } catch (cause) { error.value = isConflict(cause) ? 'This combatant changed elsewhere. Current values have been refreshed; review before saving again.' : 'The combatant could not be saved.'; await loadCombat() }
}

async function rollOneInitiative(participant: Combatant) {
  if (!rules.value.initiative) return
  try {
    const raw = initiativeModifiers.value[participant.id]
    const modifier = raw === '' || raw === undefined ? participant.dexterity_known ? participant.dexterity_modifier : 0 : Number(raw)
    const result = rules.value.initiative.roll(modifier)
    await guardedUpdate('combatants', participant, { initiative: result, initiative_known: true, initiative_modifier: modifier, initiative_modifier_override: raw !== '' && raw !== undefined && (!participant.dexterity_known || modifier !== participant.dexterity_modifier) })
    await loadCombat()
  } catch (cause) { diceError.value = isConflict(cause) ? 'Combatant changed elsewhere. Current values have been refreshed.' : cause instanceof Error ? cause.message : 'Initiative could not be rolled.'; await loadCombat() }
}

async function rollGroupInitiative() {
  if (!rules.value.initiative) return
  const targets = orderedCombatants.value.filter((participant) => selectedForGroup.value.includes(participant.id))
  if (!targets.length) { diceError.value = 'Select one or more participants to roll.'; return }
  diceError.value = ''
  try {
    const modifiers = targets.map((participant) => {
      const raw = initiativeModifiers.value[participant.id]
      return raw === '' || raw === undefined ? participant.dexterity_known ? participant.dexterity_modifier : 0 : Number(raw)
    })
    const results = rules.value.initiative.rollGroup(modifiers)
    for (const [index, participant] of targets.entries()) {
      const modifier = modifiers[index]
      await guardedUpdate('combatants', participant, { initiative: results[index], initiative_known: true, initiative_modifier: modifier, initiative_modifier_override: !participant.dexterity_known || modifier !== participant.dexterity_modifier })
    }
    await loadCombat()
    selectedForGroup.value = []
  } catch (cause) { diceError.value = isConflict(cause) ? 'A selected combatant changed elsewhere. Current values were refreshed.' : 'Selected initiative rolls could not be saved.'; await loadCombat() }
}

async function removeCombatant(participant: Combatant) {
  try {
    const remaining = orderedCombatants.value.filter((entry) => entry.id !== participant.id)
    const active = activeCombatant.value
    const replacement = active?.id === participant.id ? remaining[Math.min(orderedCombatants.value.indexOf(participant), remaining.length - 1)] : active
    if (combat.value && replacement) await guardedUpdate('combats', combat.value, { active_participant: replacement.id })
    await pb.collection('combatants').delete(participant.id); await loadCombat()
  }
  catch { error.value = 'The combatant could not be removed.' }
}

async function updateCombat(fields: Partial<Combat>) {
  if (!combat.value) return
  try { await guardedUpdate('combats', combat.value, fields); await loadCombat() }
  catch (cause) { error.value = isConflict(cause) ? 'Combat changed elsewhere. Current values have been refreshed.' : 'Combat tracker could not be updated.'; await loadCombat() }
}

async function saveDisplaySetting(field: DisplaySettingField, value: boolean) {
  if (!game.value) return
  try { await guardedUpdate('games', game.value, { [field]: value }); game.value = await pb.collection('games').getOne<Game>(game.value.id, { expand: 'system' }) }
  catch (cause) { error.value = isConflict(cause) ? 'Game settings changed elsewhere. Current values were refreshed.' : 'The player display setting could not be saved.'; await load() }
}

async function moveTurn(direction: number) {
  if (!combat.value || !orderedCombatants.value.length) return
  let turn = orderedCombatants.value.findIndex((entry) => entry.id === activeCombatant.value?.id) + direction
  let round = combat.value.round
  if (turn >= orderedCombatants.value.length) { turn = 0; round += 1 }
  if (turn < 0) { if (round <= 1) return; turn = orderedCombatants.value.length - 1; round -= 1 }
  await updateCombat({ turn, round, active_participant: orderedCombatants.value[turn]?.id ?? '' })
}

async function resetCombat() {
  if (!combat.value) return
  try {
    for (const participant of combatants.value) await guardedUpdate('combatants', participant, { initiative: 0, initiative_known: false, current_hp: 0, max_hp: 0, hp_known: false, conditions: '' })
    await updateCombat({ active: true, round: 1, turn: 0, active_participant: '', tie_order: '[]' })
    if (combat.value && activeCombatant.value) await updateCombat({ active_participant: activeCombatant.value.id })
  } catch { error.value = 'Combat could not be reset.' }
}

async function endCombat() { if (combat.value) await updateCombat({ active: false }) }

async function setTieOrder(participant: Combatant, direction: number) {
  if (!combat.value) return
  const tied = orderedCombatants.value.filter((entry) => rules.value.compare(entry, participant) === 0)
  const tieOrder = orderedCombatants.value.map((entry) => entry.id)
  const index = tieOrder.indexOf(participant.id)
  const swap = index + direction
  if (swap < 0 || swap >= tieOrder.length || !tied.some((entry) => entry.id === tieOrder[swap])) return
  ;[tieOrder[index], tieOrder[swap]] = [tieOrder[swap], tieOrder[index]]
  await updateCombat({ tie_order: JSON.stringify(tieOrder), active_participant: activeCombatant.value?.id ?? '' })
}

function replaceEncounterQuery(id: string) {
  if (String(route.query.encounter ?? '') === id) return
  const query: LocationQueryRaw = { ...route.query }
  if (id) query.encounter = id
  else delete query.encounter
  void router.replace({ query })
}

function clearSelectionData() {
  entries.value = []
  entryDrafts.value = {}
  combat.value = null
  combatants.value = []
  combatDrafts.value = {}
  combatSnapshots.value = {}
  hpPreview.value = {}
  initiativeModifiers.value = {}
  selectedForGroup.value = []
  diceError.value = ''
}

async function applyEncounterSelection(id: string) {
  const generation = ++selectionGeneration
  selectedId.value = id
  switching.value = true
  if (!pickerPending.value) error.value = ''
  clearSelectionData()
  try {
    if (!await loadEntries(generation)) return
    if (!await loadCombat(generation)) return
    if (generation !== selectionGeneration) return
    await subscribe()
  } catch {
    if (generation === selectionGeneration) error.value = 'Encounter entries could not be loaded.'
  } finally {
    if (generation === selectionGeneration) switching.value = false
  }
}

async function syncSelectedFromRoute() {
  if (!game.value || loading.value) return
  const requested = String(route.query.encounter ?? '')
  if (!encounters.value.length) {
    if (requested) replaceEncounterQuery('')
    if (selectedId.value) {
      selectedId.value = ''
      entries.value = []
      entryDrafts.value = {}
      combat.value = null
      combatants.value = []
    }
    return
  }
  const requestedEntry = encounters.value.find((entry) => entry.id === requested)
  const next = requestedEntry?.id ?? encounters.value[0]?.id ?? ''
  if (requested && !requestedEntry) replaceEncounterQuery(next)
  if (!next || next === selectedId.value) return
  await applyEncounterSelection(next)
}

async function selectEncounter(id: string) {
  replaceEncounterQuery(id)
  await applyEncounterSelection(id)
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
      replaceEncounterQuery(created.id)
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
    replaceEncounterQuery(copy.id)
    await load()
  } catch { error.value = 'The encounter could not be duplicated.' }
}

async function deleteEncounter(encounter: Encounter) {
  if (!window.confirm(`Delete “${encounter.name}” and its prepared creatures? This cannot be undone.`)) return
  try {
    await pb.collection('encounters').delete(encounter.id)
    if (selectedId.value === encounter.id) {
      selectedId.value = ''
      replaceEncounterQuery('')
    }
    await load()
  }
  catch { error.value = 'The encounter could not be deleted.' }
}

function openPicker() {
  if (!pickerPending.value) pickerFeedback.value = null
  pickerOpen.value = true
}

async function addCreature(creature: CatalogRecord) {
  if (!selected.value || pickerPending.value) return
  pickerPending.value = true
  pickerFeedback.value = { tone: 'status', message: `Adding ${creature.name}…` }
  try {
    await pb.collection('encounter_creatures').create({ encounter: selected.value.id, creature: creature.id, name: creature.name, quantity: 1, notes: '', custom: false })
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      pickerFeedback.value = { tone: 'error', message: `Could not confirm whether ${creature.name} was added because the connection failed. Refresh this screen before trying again; it may already be saved.` }
      error.value = `Could not confirm whether ${creature.name} was added. Refresh before trying again.`
      return
    }
    pickerPending.value = false
    pickerFeedback.value = { tone: 'error', message: `${creature.name} was not added. Check the connection and try again.` }
    error.value = 'The creature could not be added.'
    return
  }
  pickerFeedback.value = { tone: 'status', message: `Added ${creature.name}. Refreshing the encounter list…` }
  try { await loadEntries() }
  catch {
    pickerFeedback.value = { tone: 'error', message: `${creature.name} was added, but the encounter list could not refresh. Refresh this screen before adding another.` }
    error.value = `${creature.name} was added, but the encounter list could not refresh. Refresh before adding another.`
    return
  }
  pickerPending.value = false
  pickerFeedback.value = { tone: 'status', message: `Added ${creature.name}. Search stays open so you can add another.` }
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

function rememberPrintPosition() {
  if (selectedId.value) rememberEncounterPrintReturn(gameId.value, selectedId.value)
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading encounters…</div>
    <template v-else-if="game">
      <RouterLink class="text-link" :to="{ name: 'game-characters', params: { gameId: game.id } }">← {{ game.name }}</RouterLink>
      <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> {{ game.expand?.system?.name ?? 'GAME' }}</p><h1 id="page-title">Encounters</h1><p class="screen-description">Prepare reusable creature groupings for {{ game.name }}. Preparation stays separate from live combat.</p></div><div class="row-actions"><button class="primary-button" type="button" @click="beginCreate">＋ New encounter</button></div></div>
      <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Refresh</button></p>
      <form v-if="formOpen" class="editor-panel" @submit.prevent="saveEncounter"><h2>{{ editingId ? 'Rename encounter' : 'New encounter' }}</h2><label class="field-label" for="encounter-name">Name</label><input id="encounter-name" v-model="name" class="text-input" maxlength="160" required /><div class="form-actions"><button class="secondary-button" type="button" @click="formOpen = false">Cancel</button><button class="primary-button" type="submit">Save encounter</button></div></form>
      <div v-if="encounters.length" class="encounter-layout">
        <aside class="encounter-sidebar" aria-label="Prepared encounters"><button v-for="encounter in encounters" :key="encounter.id" class="spellbook-tab" :class="{ selected: encounter.id === selectedId }" type="button" @click="selectEncounter(encounter.id)">{{ encounter.name }}<small>{{ encounter.id === selectedId ? entries.length + ' creature types' : '' }}</small></button></aside>
        <section v-if="selected" class="encounter-content">
          <div v-if="switching" class="encounter-switching" role="status" aria-live="polite">
            <p class="eyebrow">PREPARATION · REUSABLE</p>
            <h2>{{ selected.name }}</h2>
            <p class="muted-hint">Loading this encounter’s preparation and live state…</p>
          </div>
          <template v-else>
          <EncounterPreparation
            v-model:drafts="entryDrafts"
            v-model:custom-open="customOpen"
            v-model:custom-name="customName"
            v-model:custom-quantity="customQuantity"
            v-model:custom-notes="customNotes"
            :encounter="selected"
            :entries="entries"
            :system="system"
            :print-target="printTarget"
            :combat-active="Boolean(combat?.active)"
            @add-catalog="openPicker"
            @add-custom="addCustom"
            @save-entry="saveEntry"
            @remove-entry="removeEntry"
            @rename="beginRename(selected)"
            @duplicate="duplicateEncounter(selected)"
            @delete="deleteEncounter(selected)"
            @print="rememberPrintPosition"
          />
          <EncounterLivePanel
            v-model:drafts="combatDrafts"
            v-model:selected-for-group="selectedForGroup"
            v-model:initiative-modifiers="initiativeModifiers"
            v-model:custom-participant-name="newParticipantName"
            :game="game"
            :combat="combat"
            :rules="rules"
            :game-characters="gameCharacters"
            :combatants="orderedCombatants"
            :active-combatant="activeCombatant"
            :hp-preview="hpPreview"
            :dice-error="diceError"
            :can-start="entries.length > 0"
            :hp-source-for="hpFromSource"
            @start="startCombat"
            @reset="resetCombat"
            @end="endCombat"
            @previous="moveTurn(-1)"
            @next="moveTurn(1)"
            @roll-group="rollGroupInitiative"
            @add-character="addCharacter"
            @add-custom="addCustomCombatant"
            @save-combatant="saveCombatant"
            @preview-hp="previewHP"
            @confirm-hp="confirmHP"
            @remove-combatant="removeCombatant"
            @roll-one="rollOneInitiative"
            @set-tie-order="setTieOrder"
            @save-display-setting="saveDisplaySetting"
          />
          </template>
        </section>
      </div>
      <div v-else-if="!formOpen" class="empty-state"><div class="empty-state-icon" aria-hidden="true">⚔</div><h2>No encounters yet</h2><p>Create an encounter as a reusable preparation or print grouping.</p><button class="primary-button empty-action" type="button" @click="beginCreate">＋ Create encounter</button></div>
      <CatalogPicker v-model:open="pickerOpen" :system-id="game.system" type="creature" title="Choose a creature" :pending="pickerPending" :feedback="pickerFeedback" @select="addCreature" />
    </template>
    <p v-else class="alert-message" role="alert">This game could not be found.</p>
  </section>
</template>
