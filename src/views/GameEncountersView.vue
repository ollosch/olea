<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import CatalogPicker from '../components/CatalogPicker.vue'
import EncounterCombatSetup from '../components/encounters/EncounterCombatSetup.vue'
import EncounterLivePanel from '../components/encounters/EncounterLivePanel.vue'
import EncounterPreparation from '../components/encounters/EncounterPreparation.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { evaluateDice } from '../lib/dice'
import { systemForGame } from '../lib/systems'
import { activeParticipant, orderParticipants } from '../lib/encounterOrder'
import { applyLiveHPAdjustment, liveDraftDiffers, validateLiveHPInput } from '../lib/liveCombat'
import { guardedUpdate, isConflict, isDefiniteWriteRejection } from '../lib/records'
import type {
  Character,
  Combat,
  Combatant,
  CombatDraft,
  CombatSetupDraft,
  DisplaySettingField,
  Encounter,
  Entry,
  EntryDraft,
  Game,
  HPPreview,
  HPMode,
  PickerFeedback,
  PlannedCombatant,
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
const setupDrafts = ref<Record<string, CombatSetupDraft>>({})
const setupSelectedForGroup = ref<string[]>([])
const setupCharacters = ref<string[]>([])
const setupCustoms = ref<Array<{ key: string; name: string }>>([])
const setupStarting = ref(false)
const startRecoveryRequired = ref(false)
const startUncertain = ref(false)
const uncertainReconciled = ref(false)
let setupCustomSequence = 0
let startInFlight = false
let pendingRouteSync = false
let combatMutationGeneration = 0
const combatMutationByParticipant = new Map<string, number>()
const diceError = ref('')
const combatWritePending = ref<Record<string, boolean>>({})
const combatWriteUncertain = ref<Record<string, boolean>>({})
const participantErrors = ref<Record<string, string>>({})
const participantConflicts = ref<Record<string, Combatant | null>>({})
const liveRefreshRequired = ref(false)
const combatTrackerPending = ref(false)
const combatTrackerUncertain = ref(false)
const combatTrackerError = ref('')
const groupRollError = ref('')
const addParticipantPending = ref(false)
const addParticipantUncertain = ref(false)
const addParticipantError = ref('')
type LiveDraftField = 'initiative' | 'current_hp' | 'max_hp' | 'conditions' | 'notes' | 'initiative_modifier'
type LiveWriteOutcome = 'ok' | 'conflict' | 'rejected' | 'uncertain' | 'refresh-failed' | 'blocked'
type LoadCombatOptions = { preserveDirtyDrafts?: boolean; rebaseIds?: ReadonlySet<string>; shouldSkip?: (id: string) => boolean }
function markCombatantMutation(id: string) {
  combatMutationByParticipant.set(id, ++combatMutationGeneration)
}
function setParticipantError(id: string, message: string) {
  participantErrors.value = { ...participantErrors.value, [id]: message }
}
function clearParticipantError(id: string) {
  if (!participantErrors.value[id]) return
  const next = { ...participantErrors.value }
  delete next[id]
  participantErrors.value = next
}
function hasParticipantConflict(id: string) {
  return Object.prototype.hasOwnProperty.call(participantConflicts.value, id)
}

function conflictSummary(record: Combatant) {
  const initiative = record.initiative_known ? `Init ${record.initiative}` : 'Initiative unknown'
  const hp = record.hp_known ? `HP ${record.current_hp}/${record.max_hp}` : 'HP unknown'
  return `${initiative} · ${hp}${record.conditions ? ` · ${record.conditions}` : ''}`
}

function conflictMessage(record: Combatant | null) {
  return record
    ? `Draft conflicts with another change. Server now: ${conflictSummary(record)}. Keep your draft only after reviewing it, or discard it and use the server values.`
    : 'Draft conflicts with another change, but the latest values could not be refreshed. Refresh live state, then review before retrying.'
}

function participantWriteBlocked(id: string) {
  return Boolean(combatWritePending.value[id] || combatWriteUncertain.value[id] || liveRefreshRequired.value || hasParticipantConflict(id))
}
const system = computed(() => systemForGame(game.value))
const rules = computed(() => system.value.encounter)
const orderedCombatants = computed(() => orderParticipants(combatants.value, combat.value?.tie_order ?? '', rules.value))
const activeCombatant = computed(() => activeParticipant(orderedCombatants.value, combat.value?.active_participant ?? '', combat.value?.turn ?? 0))
const plannedCombatants = computed<PlannedCombatant[]>(() => {
  const planned: PlannedCombatant[] = []
  let sortOrder = 0
  for (const entry of entries.value) {
    for (let count = 0; count < entry.quantity; count++) {
      planned.push({
        key: `prepared:${entry.id}:${count}`,
        prepared: entry.id,
        character: '',
        name: entry.quantity > 1 ? `${entry.name} ${count + 1}` : entry.name,
        enemy: true,
        notes: entry.notes ?? '',
        sortOrder: sortOrder++,
      })
    }
  }
  for (const id of setupCharacters.value) {
    const character = gameCharacters.value.find((entry) => entry.id === id)
    if (!character) continue
    planned.push({ key: `character:${character.id}`, prepared: '', character: character.id, name: character.name, enemy: false, notes: '', sortOrder: sortOrder++ })
  }
  for (const custom of setupCustoms.value) {
    planned.push({ key: custom.key, prepared: '', character: '', name: custom.name, enemy: false, notes: '', sortOrder: sortOrder++ })
  }
  return planned
})
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
  if (startInFlight) return
  const generation = selectionGeneration
  const encounterId = selectedId.value
  try {
    const mutations = new Map(combatMutationByParticipant)
    const pendingAtStart = { ...combatWritePending.value }
    const gameRecord = await pb.collection('games').getOne<Game>(gameId.value, { expand: 'system', requestKey: null })
    const encounterRecords = await pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:game}', { game: gameId.value }), sort: 'name', requestKey: null })
    if (generation !== selectionGeneration || encounterId !== selectedId.value) return
    game.value = gameRecord
    encounters.value = encounterRecords
    const shouldSkip = (id: string) => Boolean(pendingAtStart[id]) || (combatMutationByParticipant.get(id) ?? 0) !== (mutations.get(id) ?? 0)
    if (!await loadEntries(generation) || !await loadCombat(generation, { preserveDirtyDrafts: true, shouldSkip })) return
  } catch {
    if (generation === selectionGeneration) error.value = 'Live encounter could not be refreshed. Check the connection.'
  }
}

async function load() {
  if (startInFlight) return
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
    if (!await loadCombat(selection, { preserveDirtyDrafts: true })) return
    if (startUncertain.value) {
      uncertainReconciled.value = true
      startRecoveryRequired.value = true
      error.value = 'No active combat was found on recheck, but the earlier start was not confirmed and may still complete. Confirm below only after checking the table, or wait and recheck before retrying.'
    } else {
      startRecoveryRequired.value = false
    }
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

async function refreshAll() {
  await load()
  if (loading.value || error.value) return
  combatWriteUncertain.value = {}
  liveRefreshRequired.value = false
  combatTrackerUncertain.value = false
  addParticipantUncertain.value = false
  const nextConflicts: Record<string, Combatant | null> = {}
  const nextErrors: Record<string, string> = {}
  for (const id of Object.keys(participantConflicts.value)) {
    const latest = combatants.value.find((entry) => entry.id === id)
    if (!latest) continue
    nextConflicts[id] = { ...latest }
    nextErrors[id] = conflictMessage(latest)
  }
  participantConflicts.value = nextConflicts
  participantErrors.value = nextErrors
  combatTrackerError.value = ''
  groupRollError.value = ''
  addParticipantError.value = ''
}

function resolveParticipantConflict(participant: Combatant, mode: 'keep' | 'discard') {
  const id = participant.id
  if (!hasParticipantConflict(id)) return
  const latest = participantConflicts.value[id]
  if (!latest) return
  combatSnapshots.value = { ...combatSnapshots.value, [id]: { ...latest } }
  if (mode === 'discard') {
    combatDrafts.value[id] = draftFromParticipant(latest)
    initiativeModifiers.value[id] = modifierFromParticipant(latest)
  }
  const conflicts = { ...participantConflicts.value }
  delete conflicts[id]
  participantConflicts.value = conflicts
  clearParticipantError(id)
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

async function loadCombat(generation = selectionGeneration, options: LoadCombatOptions = {}) {
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
    syncCombatDrafts(options)
    if (!startInFlight) {
      setupCharacters.value = []
      setupCustoms.value = []
      setupSelectedForGroup.value = []
    }
    if (startUncertain.value) {
      startUncertain.value = false
      uncertainReconciled.value = false
      startRecoveryRequired.value = false
      error.value = 'An active combat was found during reconciliation; review it before starting again.'
    }
  } else combatants.value = []
  gameCharacters.value = characters
  return true
}

function draftFromParticipant(entry: Combatant): CombatDraft {
  return { initiative: entry.initiative_known ? entry.initiative : '', current_hp: entry.hp_known ? entry.current_hp : '', max_hp: entry.hp_known ? entry.max_hp : '', conditions: entry.conditions ?? '', notes: entry.notes ?? '' }
}

function modifierFromParticipant(entry: Combatant): number | '' {
  return entry.initiative_modifier_override ? entry.initiative_modifier : entry.dexterity_known ? entry.dexterity_modifier : ''
}

function draftDiffersFromBaseline(id: string) {
  const baseline = combatSnapshots.value[id]
  const draft = combatDrafts.value[id]
  if (!baseline || !draft) return false
  const modifier = initiativeModifiers.value[id]
  return liveDraftDiffers(draftFromParticipant(baseline), draft, modifierFromParticipant(baseline), modifier === undefined ? modifierFromParticipant(baseline) : modifier)
}

function syncCombatDrafts(options: LoadCombatOptions = {}) {
  const previousDrafts = combatDrafts.value
  const previousSnapshots = combatSnapshots.value
  const previousModifiers = initiativeModifiers.value
  const nextDrafts: Record<string, CombatDraft> = {}
  const nextSnapshots: Record<string, Combatant> = {}
  const nextModifiers: Record<string, number | ''> = {}
  for (const entry of combatants.value) {
    const id = entry.id
    const draft = previousDrafts[id]
    const baseline = previousSnapshots[id]
    const modifier = previousModifiers[id]
    if (options.shouldSkip?.(id) && draft && baseline) {
      nextDrafts[id] = draft
      nextSnapshots[id] = baseline
      nextModifiers[id] = modifier === undefined ? modifierFromParticipant(baseline) : modifier
      continue
    }
    if (options.rebaseIds?.has(id)) {
      nextSnapshots[id] = { ...entry }
      nextDrafts[id] = draft ?? draftFromParticipant(entry)
      nextModifiers[id] = modifier === undefined ? modifierFromParticipant(entry) : modifier
      continue
    }
    if (options.preserveDirtyDrafts && draft && baseline && draftDiffersFromBaseline(id)) {
      nextSnapshots[id] = baseline
      nextDrafts[id] = draft
      nextModifiers[id] = modifier === undefined ? modifierFromParticipant(baseline) : modifier
      continue
    }
    nextSnapshots[id] = { ...entry }
    nextDrafts[id] = draftFromParticipant(entry)
    nextModifiers[id] = modifierFromParticipant(entry)
  }
  combatDrafts.value = nextDrafts
  combatSnapshots.value = nextSnapshots
  initiativeModifiers.value = nextModifiers
}

function syncDraftFieldsFromRecord(record: Combatant, fields: readonly LiveDraftField[]) {
  const draft = combatDrafts.value[record.id]
  if (!draft) return
  if (fields.includes('initiative')) draft.initiative = record.initiative_known ? record.initiative : ''
  if (fields.includes('current_hp')) draft.current_hp = record.hp_known ? record.current_hp : ''
  if (fields.includes('max_hp')) draft.max_hp = record.hp_known ? record.max_hp : ''
  if (fields.includes('conditions')) draft.conditions = record.conditions ?? ''
  if (fields.includes('notes')) draft.notes = record.notes ?? ''
  if (fields.includes('initiative_modifier')) initiativeModifiers.value[record.id] = modifierFromParticipant(record)
}

function syncDraftFields(id: string, fields: readonly LiveDraftField[]) {
  const record = combatants.value.find((entry) => entry.id === id)
  if (record) syncDraftFieldsFromRecord(record, fields)
}

async function refreshCombatPreservingDrafts() {
  try {
    return await loadCombat(selectionGeneration, { preserveDirtyDrafts: true, shouldSkip: (id) => Boolean(combatWritePending.value[id]) })
  } catch {
    liveRefreshRequired.value = true
    combatTrackerError.value = 'Live values could not be refreshed. Use Refresh live state before another change.'
    return false
  }
}

async function writeCombatant(participant: Combatant, fields: Record<string, unknown>, draftFields: readonly LiveDraftField[], actionLabel: string): Promise<LiveWriteOutcome> {
  const id = participant.id
  if (participantWriteBlocked(id)) return 'blocked'
  clearParticipantError(id)
  const snapshot = combatSnapshots.value[id] ?? participant
  combatWritePending.value = { ...combatWritePending.value, [id]: true }
  try {
    try {
      await guardedUpdate('combatants', snapshot, fields)
    } catch (cause) {
      if (isConflict(cause)) {
        const refreshed = await refreshCombatPreservingDrafts()
        const latest = refreshed ? combatants.value.find((entry) => entry.id === id) ?? null : null
        participantConflicts.value = { ...participantConflicts.value, [id]: latest ? { ...latest } : null }
        setParticipantError(id, conflictMessage(latest))
        return 'conflict'
      }
      if (isDefiniteWriteRejection(cause)) {
        setParticipantError(id, `${actionLabel} was not saved. Your values are kept; check the connection and try again.`)
        await refreshCombatPreservingDrafts()
        return 'rejected'
      }
      combatWriteUncertain.value = { ...combatWriteUncertain.value, [id]: true }
      setParticipantError(id, `${actionLabel} could not be confirmed. Refresh live state before trying again so a delayed write is not repeated.`)
      return 'uncertain'
    }
    const mergedSnapshot = { ...snapshot, ...fields } as Combatant
    combatSnapshots.value = { ...combatSnapshots.value, [id]: mergedSnapshot }
    syncDraftFieldsFromRecord(mergedSnapshot, draftFields)
    markCombatantMutation(id)
    try {
      const refreshed = await loadCombat(selectionGeneration, { preserveDirtyDrafts: true, rebaseIds: new Set([id]), shouldSkip: (otherId) => otherId !== id && Boolean(combatWritePending.value[otherId]) })
      if (refreshed) syncDraftFields(id, draftFields)
      return 'ok'
    } catch {
      liveRefreshRequired.value = true
      setParticipantError(id, `${actionLabel} was saved, but the live tracker could not refresh. Refresh live state before another change.`)
      return 'refresh-failed'
    }
  } finally {
    const pending = { ...combatWritePending.value }
    delete pending[id]
    combatWritePending.value = pending
  }
}

async function writeCombatTracker(fields: Partial<Combat>, actionLabel: string): Promise<LiveWriteOutcome> {
  if (!combat.value || combatTrackerPending.value || combatTrackerUncertain.value || liveRefreshRequired.value) return 'blocked'
  combatTrackerError.value = ''
  const snapshot = combat.value
  combatTrackerPending.value = true
  try {
    try {
      await guardedUpdate('combats', snapshot, fields)
    } catch (cause) {
      if (isConflict(cause)) {
        combatTrackerError.value = `${actionLabel} was not saved because the combat changed elsewhere. Current values were refreshed; review and try again.`
        await refreshCombatPreservingDrafts()
        return 'conflict'
      }
      if (isDefiniteWriteRejection(cause)) {
        combatTrackerError.value = `${actionLabel} was not saved. Check the connection and try again.`
        await refreshCombatPreservingDrafts()
        return 'rejected'
      }
      combatTrackerUncertain.value = true
      combatTrackerError.value = `${actionLabel} could not be confirmed. Refresh live state before another turn or reset so a delayed write is not repeated.`
      return 'uncertain'
    }
    try {
      const refreshed = await loadCombat(selectionGeneration, { preserveDirtyDrafts: true })
      return refreshed ? 'ok' : 'blocked'
    } catch {
      liveRefreshRequired.value = true
      combatTrackerError.value = `${actionLabel} was saved, but the live tracker could not refresh. Refresh live state before continuing.`
      return 'refresh-failed'
    }
  } finally {
    combatTrackerPending.value = false
  }
}

async function addLiveParticipant(create: () => Promise<unknown>, label: string, onAdded?: () => void) {
  if (addParticipantPending.value || addParticipantUncertain.value || liveRefreshRequired.value) return false
  addParticipantError.value = ''
  addParticipantPending.value = true
  try {
    try {
      await create()
    } catch (cause) {
      if (isDefiniteWriteRejection(cause)) {
        addParticipantError.value = `${label} was not added. Check the connection and try again.`
      } else {
        addParticipantUncertain.value = true
        addParticipantError.value = `${label} could not be confirmed. Refresh live state before adding again so a delayed write is not repeated.`
      }
      return false
    }
    onAdded?.()
    try {
      const refreshed = await loadCombat(selectionGeneration, { preserveDirtyDrafts: true })
      if (!refreshed) return true
    } catch {
      liveRefreshRequired.value = true
      addParticipantError.value = `${label} was added, but the live tracker could not refresh. Refresh live state before adding another.`
      return true
    }
    if (combat.value && !combat.value.active_participant && activeCombatant.value) await writeCombatTracker({ active_participant: activeCombatant.value.id }, 'Set active participant')
    return true
  } finally {
    addParticipantPending.value = false
  }
}

function hpFromSource(participant: Combatant) {
  if (!participant.enemy || !participant.prepared) return { average: null, formula: null }
  const prepared = entries.value.find((entry) => entry.id === participant.prepared)
  const source = prepared?.expand?.creature?.original_json
  return rules.value.creatureHP(source)
}

function sourceForPlanned(participant: PlannedCombatant) {
  if (!participant.enemy || !participant.prepared) return {}
  const prepared = entries.value.find((entry) => entry.id === participant.prepared)
  const source = prepared?.expand?.creature?.original_json
  return source && typeof source === 'object' ? source as Record<string, unknown> : {}
}

function hpSourceForPlanned(participant: PlannedCombatant) {
  if (!participant.enemy || !participant.prepared) return { average: null, formula: null }
  return rules.value.creatureHP(sourceForPlanned(participant))
}

function modifierForPlanned(participant: PlannedCombatant) {
  if (!participant.enemy || !participant.prepared) return null
  return rules.value.initiative?.modifier(sourceForPlanned(participant)) ?? null
}

function initialSetupDraft(participant: PlannedCombatant): CombatSetupDraft {
  return {
    initiative: '',
    initiativeModifier: rules.value.initiative ? modifierForPlanned(participant) ?? '' : '',
    currentHp: '',
    maxHp: '',
  }
}

function syncSetupDrafts() {
  if (startInFlight) return
  if (combat.value?.active) {
    setupDrafts.value = {}
    setupSelectedForGroup.value = []
    return
  }
  const keys = new Set(plannedCombatants.value.map((participant) => participant.key))
  setupDrafts.value = Object.fromEntries(plannedCombatants.value.map((participant) => [participant.key, setupDrafts.value[participant.key] ?? initialSetupDraft(participant)]))
  setupSelectedForGroup.value = setupSelectedForGroup.value.filter((key) => keys.has(key))
}

watch([plannedCombatants, () => combat.value?.active], syncSetupDrafts, { immediate: true })

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
  const outcome = await writeCombatant(participant, { current_hp: preview.current, max_hp: preview.max, hp_known: true }, ['current_hp', 'max_hp'], 'Confirm HP')
  if (outcome === 'ok' || outcome === 'refresh-failed') delete hpPreview.value[participant.id]
}

async function activeCombatExists(encounterId: string) {
  try {
    const active = await pb.collection('combats').getList<Combat>(1, 1, { filter: pb.filter('encounter = {:encounter} && active = true', { encounter: encounterId }), sort: 'id', requestKey: null })
    return { ok: true, active: active.totalItems > 0 }
  } catch {
    return { ok: false, active: false }
  }
}

async function combatantsFor(combatId: string) {
  return await pb.collection('combatants').getFullList<Combatant>({ filter: pb.filter('combat = {:combat}', { combat: combatId }), sort: 'sort_order,name', requestKey: null })
}

async function presentActiveCombat(encounter: Encounter, startGameId: string, message: string) {
  let activeShown = false
  if (startGameId === gameId.value && encounter.id === selectedId.value) {
    try { activeShown = await loadCombat() } catch { /* The message below still requires review. */ }
  }
  startUncertain.value = false
  uncertainReconciled.value = false
  startRecoveryRequired.value = !activeShown
  error.value = message + (activeShown ? '' : ' Refresh this game to review it.')
}

async function handleUncertainCreate(encounter: Encounter, startGameId: string) {
  const reconciled = await activeCombatExists(encounter.id)
  if (reconciled.ok && reconciled.active) {
    await presentActiveCombat(encounter, startGameId, `Combat creation could not be confirmed, but an active combat now exists for ${encounter.name}; review it and end or reset it before trying again.`)
    return
  }
  startUncertain.value = true
  uncertainReconciled.value = false
  startRecoveryRequired.value = true
  error.value = reconciled.ok
    ? 'Combat creation could not be confirmed. The server may still complete the write, so retry is blocked. Wait for the connection to recover, then Refresh; confirm no combat was created only after checking.'
    : 'Combat start could not be confirmed or reconciled. Refresh this game to check for an active or partial combat before trying again.'
}

function validateSetup(planned: PlannedCombatant[]) {
  for (const participant of planned) {
    const draft = setupDrafts.value[participant.key]
    if (!draft) continue
    if (draft.initiative !== '' && !Number.isFinite(Number(draft.initiative))) return `Initiative for ${participant.name} must be a number.`
    const currentBlank = draft.currentHp === ''
    const maxBlank = draft.maxHp === ''
    if (currentBlank !== maxBlank) return `HP for ${participant.name} needs both current and max values, or leave both unset.`
    if (!currentBlank) {
      const currentHP = Number(draft.currentHp)
      const maxHP = Number(draft.maxHp)
      if (!Number.isFinite(currentHP) || !Number.isFinite(maxHP) || currentHP < 0 || maxHP < 0) return `HP for ${participant.name} must use nonnegative numbers.`
    }
    const initiative = rules.value.initiative
    if (initiative && draft.initiativeModifier !== '' && (!Number.isInteger(Number(draft.initiativeModifier)) || Number(draft.initiativeModifier) < initiative.modifierMin || Number(draft.initiativeModifier) > initiative.modifierMax)) {
      return `Initiative modifier for ${participant.name} must be a whole number from ${initiative.modifierMin} to ${initiative.modifierMax}.`
    }
  }
  return ''
}

function confirmNoActiveCombat() {
  if (!startUncertain.value || !uncertainReconciled.value) return
  startUncertain.value = false
  uncertainReconciled.value = false
  startRecoveryRequired.value = false
  error.value = ''
}

async function startCombat() {
  if (startInFlight || startRecoveryRequired.value || !selected.value) return
  const startRules = rules.value
  const startGameId = gameId.value
  const encounter = selected.value
  const startSelection = selectionGeneration
  const planned = plannedCombatants.value
  const drafts = setupDrafts.value
  if (!planned.length) return
  const validation = validateSetup(planned)
  if (validation) { error.value = validation; return }
  error.value = ''

  const participants = planned.map((participant) => {
    const draft = drafts[participant.key] ?? initialSetupDraft(participant)
    const source = sourceForPlanned(participant)
    const hp = startRules.creatureHP(source)
    const dexterity = startRules.initiative?.modifier(source) ?? null
    const modifier = draft.initiativeModifier === '' ? dexterity : Number(draft.initiativeModifier)
    const useModifier = startRules.initiative && modifier !== null
    return {
      prepared: participant.prepared,
      character: participant.character,
      name: participant.name,
      enemy: participant.enemy,
      notes: participant.notes,
      sortOrder: participant.sortOrder,
      hpFormula: hp.formula ?? '',
      dexterity,
      modifier: useModifier ? modifier : null,
      modifierOverride: useModifier ? (dexterity === null || modifier !== dexterity) : false,
      initiative: draft.initiative === '' ? 0 : Number(draft.initiative),
      initiativeKnown: draft.initiative !== '',
      currentHp: draft.currentHp === '' ? 0 : Number(draft.currentHp),
      maxHp: draft.maxHp === '' ? 0 : Number(draft.maxHp),
      hpKnown: draft.currentHp !== '' && draft.maxHp !== '',
    }
  })

  startInFlight = true
  setupStarting.value = true
  try {
  let created: Combat | null = null
  let written: Combatant[] = []
  let createdCount = 0
  let allParticipantsPresent = false
  try {
    const active = await pb.collection('combats').getList<Combat>(1, 1, { filter: pb.filter('active = true && encounter.game = {:game}', { game: startGameId }), requestKey: null })
    if (active.totalItems) { error.value = 'End the active combat in this game before starting another.'; return }
    created = await pb.collection('combats').create<Combat>({ encounter: encounter.id, active: true, round: 1, turn: 0, tie_order: '[]', name: encounter.name })
    for (const participant of participants) {
      const createdCombatant = await pb.collection('combatants').create<Combatant>({
        combat: created.id,
        ...(participant.prepared ? { prepared: participant.prepared } : {}),
        ...(participant.character ? { character: participant.character } : {}),
        name: participant.name,
        enemy: participant.enemy,
        notes: participant.notes,
        sort_order: participant.sortOrder,
        hp_formula: participant.hpFormula,
        ...(participant.dexterity === null ? {} : { dexterity_modifier: participant.dexterity, dexterity_known: true }),
        ...(participant.modifier === null ? {} : { initiative_modifier: participant.modifier, initiative_modifier_override: participant.modifierOverride }),
        initiative: participant.initiative,
        initiative_known: participant.initiativeKnown,
        current_hp: participant.currentHp,
        max_hp: participant.maxHp,
        hp_known: participant.hpKnown,
      })
      written.push(createdCombatant)
      createdCount++
    }
    allParticipantsPresent = true
  } catch {
    if (!created) {
      await handleUncertainCreate(encounter, startGameId)
      return
    }
    let actual: Combatant[] | null = null
    try { actual = await combatantsFor(created.id) } catch { actual = null }
    if (actual) {
      written = actual
      createdCount = actual.length
      allParticipantsPresent = actual.length >= participants.length
    }
    if (!allParticipantsPresent) {
      if (!actual) {
        startUncertain.value = false
        uncertainReconciled.value = false
        startRecoveryRequired.value = true
        error.value = `Combat setup could not be reconciled after ${createdCount} of ${participants.length} participants. Refresh this game and check for a partial combat before trying again.`
        return
      }
      let cleanupFailed = false
      try { await pb.collection('combats').delete(created.id) } catch { cleanupFailed = true }
      const reconciled = await activeCombatExists(encounter.id)
      if (!reconciled.ok) {
        startUncertain.value = false
        uncertainReconciled.value = false
        startRecoveryRequired.value = true
        error.value = `Combat setup stopped after ${createdCount} of ${participants.length} participants and could not be reconciled. Refresh this game before trying again.`
      } else if (reconciled.active) {
        await presentActiveCombat(encounter, startGameId, `Combat setup stopped after ${createdCount} of ${participants.length} participants. An active combat now exists for ${encounter.name}; review it and end or reset it before trying again.`)
      } else {
        startUncertain.value = false
        uncertainReconciled.value = false
        startRecoveryRequired.value = false
        if (cleanupFailed) error.value = `Combat setup stopped after ${createdCount} of ${participants.length} participants. Cleanup reported an error, but the authoritative state shows no active combat. Review setup and try again.`
        else error.value = `Combat setup stopped after ${createdCount} of ${participants.length} participants. The authoritative state shows no active combat. Review setup and try again.`
      }
      return
    }
  }

  let activeUpdateFailed = false
  try {
    const first = orderParticipants(written, '[]', startRules)[0]
    if (first) await guardedUpdate('combats', created!, { active_participant: first.id })
  } catch {
    activeUpdateFailed = true
  }

  const sameSelection = startGameId === gameId.value && startSelection === selectionGeneration && encounter.id === selectedId.value
  const routeStillHere = !route.query.encounter || String(route.query.encounter) === encounter.id
  let liveLoaded = false
  if (sameSelection && routeStillHere) {
    try { liveLoaded = await loadCombat() } catch { liveLoaded = false }
  }
  setupCharacters.value = []
  setupCustoms.value = []
  setupSelectedForGroup.value = []
  setupDrafts.value = {}
  combatWritePending.value = {}
  combatWriteUncertain.value = {}
  startUncertain.value = false
  uncertainReconciled.value = false
  if (activeUpdateFailed) {
    startRecoveryRequired.value = !liveLoaded
    error.value = `Combat and all ${participants.length} participants were created, but the active turn could not be confirmed.${liveLoaded ? ' Review the active combat and choose the turn if needed.' : ' Refresh this game to review the active combat before continuing.'}`
  } else if (sameSelection && routeStillHere && !liveLoaded) {
    startRecoveryRequired.value = true
    error.value = `Combat and all ${participants.length} participants were created, but the live state could not be refreshed. Refresh this game before continuing.`
  } else {
    startRecoveryRequired.value = false
  }
  } finally {
    startInFlight = false
    setupStarting.value = false
    if (pendingRouteSync) {
      pendingRouteSync = false
      await syncSelectedFromRoute()
    }
  }
}

function addSetupCharacter(characterId: string) {
  if (startInFlight || !characterId || setupCharacters.value.includes(characterId) || combatants.value.some((entry) => entry.character === characterId)) return
  setupCharacters.value = [...setupCharacters.value, characterId]
}

function addSetupCustom(name: string) {
  if (startInFlight) return
  const trimmed = name.trim()
  if (!trimmed) return
  setupCustoms.value = [...setupCustoms.value, { key: `custom:${++setupCustomSequence}`, name: trimmed }]
}

function removeSetupParticipant(participant: PlannedCombatant) {
  if (startInFlight) return
  if (participant.character) {
    setupCharacters.value = setupCharacters.value.filter((id) => id !== participant.character)
    return
  }
  setupCustoms.value = setupCustoms.value.filter((custom) => custom.key !== participant.key)
}

async function addCharacter(characterId: string) {
  const character = gameCharacters.value.find((entry) => entry.id === characterId)
  if (!combat.value || !character || combatants.value.some((entry) => entry.character === character.id)) return
  await addLiveParticipant(() => pb.collection('combatants').create({ combat: combat.value!.id, character: character.id, name: character.name, enemy: false, sort_order: combatants.value.length }), 'Character')
}

async function addCustomCombatant() {
  if (!combat.value || !newParticipantName.value.trim()) return
  await addLiveParticipant(() => pb.collection('combatants').create({ combat: combat.value!.id, name: newParticipantName.value.trim(), enemy: false, sort_order: combatants.value.length }), 'Participant', () => { newParticipantName.value = '' })
}

async function saveCombatant(participant: Combatant) {
  const id = participant.id
  const draft = combatDrafts.value[id]
  if (!draft) return
  if (draft.initiative !== '' && !Number.isFinite(Number(draft.initiative))) { setParticipantError(id, 'Initiative must be a number.'); return }
  const hp = validateLiveHPInput(draft.current_hp, draft.max_hp)
  if (!hp.valid) { setParticipantError(id, hp.error); return }
  const rawModifier = rules.value.initiative ? initiativeModifiers.value[id] : undefined
  const modifierOverride = rawModifier !== '' && rawModifier !== undefined && rawModifier !== (participant.dexterity_known ? participant.dexterity_modifier : '')
  if (rules.value.initiative && rawModifier !== '' && rawModifier !== undefined && (!Number.isInteger(rawModifier) || rawModifier < rules.value.initiative.modifierMin || rawModifier > rules.value.initiative.modifierMax)) { setParticipantError(id, `Initiative modifier must be a whole number from ${rules.value.initiative.modifierMin} to ${rules.value.initiative.modifierMax}.`); return }
  const fields = { initiative: draft.initiative === '' ? 0 : Number(draft.initiative), initiative_known: draft.initiative !== '', ...(rules.value.initiative ? { initiative_modifier: rawModifier === '' || rawModifier === undefined ? 0 : Number(rawModifier), initiative_modifier_override: modifierOverride } : {}), current_hp: hp.current, max_hp: hp.max, hp_known: hp.known, conditions: draft.conditions, notes: draft.notes }
  await writeCombatant(participant, fields, ['initiative', 'current_hp', 'max_hp', 'conditions', 'notes', 'initiative_modifier'], 'Participant change')
}

async function adjustCombatantHP(participant: Combatant, amount: number) {
  const id = participant.id
  if (!combat.value) return
  const snapshot = combatSnapshots.value[id] ?? participant
  const result = applyLiveHPAdjustment({ current: snapshot.current_hp, max: snapshot.max_hp, known: snapshot.hp_known }, amount)
  if (result.next === null) { setParticipantError(id, result.error); return }
  await writeCombatant(participant, { current_hp: result.next }, ['current_hp'], 'HP change')
}

async function rollOneInitiative(participant: Combatant) {
  if (!rules.value.initiative) return
  const raw = initiativeModifiers.value[participant.id]
  const modifier = raw === '' || raw === undefined ? participant.dexterity_known ? participant.dexterity_modifier : 0 : Number(raw)
  let result: number
  try { result = rules.value.initiative.roll(modifier) }
  catch (cause) { setParticipantError(participant.id, cause instanceof Error ? cause.message : 'Initiative could not be rolled.'); return }
  await writeCombatant(participant, { initiative: result, initiative_known: true, initiative_modifier: modifier, initiative_modifier_override: raw !== '' && raw !== undefined && (!participant.dexterity_known || modifier !== participant.dexterity_modifier) }, ['initiative', 'initiative_modifier'], 'Initiative roll')
}

async function rollGroupInitiative() {
  if (!rules.value.initiative) return
  const targets = orderedCombatants.value.filter((participant) => selectedForGroup.value.includes(participant.id))
  if (!targets.length) { groupRollError.value = 'Select one or more participants to roll.'; return }
  groupRollError.value = ''
  let results: number[]
  const modifiers = targets.map((participant) => {
    const raw = initiativeModifiers.value[participant.id]
    return raw === '' || raw === undefined ? participant.dexterity_known ? participant.dexterity_modifier : 0 : Number(raw)
  })
  try { results = rules.value.initiative.rollGroup(modifiers) }
  catch (cause) { groupRollError.value = cause instanceof Error ? cause.message : 'Selected initiative rolls could not be completed.'; return }
  const failed: string[] = []
  const successful: string[] = []
  for (const [index, participant] of targets.entries()) {
    const modifier = modifiers[index]
    const outcome = await writeCombatant(participant, { initiative: results[index], initiative_known: true, initiative_modifier: modifier, initiative_modifier_override: !participant.dexterity_known || modifier !== participant.dexterity_modifier }, ['initiative', 'initiative_modifier'], 'Initiative roll')
    if (outcome === 'ok') successful.push(participant.id)
    else failed.push(participant.name)
  }
  if (successful.length) selectedForGroup.value = selectedForGroup.value.filter((id) => !successful.includes(id))
  if (failed.length) groupRollError.value = `${failed.length} of ${targets.length} initiative rolls were not confirmed (${failed.join(', ')}). Review the highlighted participants and refresh live state if needed.`
}

async function removeCombatant(participant: Combatant) {
  const id = participant.id
  if (participantWriteBlocked(id)) return
  clearParticipantError(id)
  combatWritePending.value = { ...combatWritePending.value, [id]: true }
  try {
    const remaining = orderedCombatants.value.filter((entry) => entry.id !== id)
    const active = activeCombatant.value
    const replacement = active?.id === id ? remaining[Math.min(orderedCombatants.value.indexOf(participant), remaining.length - 1)] : active
    if (combat.value && replacement) {
      const activeOutcome = await writeCombatTracker({ active_participant: replacement.id }, 'Replace active participant')
      if (activeOutcome !== 'ok') {
        setParticipantError(id, 'Removal was not completed because the active participant could not be updated. Refresh live state and try again.')
        return
      }
    }
    try {
      await pb.collection('combatants').delete(id)
    } catch (cause) {
      if (isDefiniteWriteRejection(cause)) {
        setParticipantError(id, 'The participant could not be removed. Refresh live state and try again.')
        await refreshCombatPreservingDrafts()
      } else {
        combatWriteUncertain.value = { ...combatWriteUncertain.value, [id]: true }
        setParticipantError(id, 'Removal could not be confirmed. Refresh live state before removing again so a delayed write is not repeated.')
      }
      return
    }
    try {
      await loadCombat(selectionGeneration, { preserveDirtyDrafts: true })
    } catch {
      liveRefreshRequired.value = true
      combatTrackerError.value = 'The participant was removed, but the live tracker could not refresh. Refresh live state before continuing.'
    }
  } finally {
    const pending = { ...combatWritePending.value }
    delete pending[id]
    combatWritePending.value = pending
  }
}

async function updateCombat(fields: Partial<Combat>) {
  await writeCombatTracker(fields, 'Combat tracker update')
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
  if (!combat.value || combatTrackerPending.value || combatTrackerUncertain.value || liveRefreshRequired.value) return
  combatTrackerError.value = ''
  combatTrackerPending.value = true
  const combatSnapshot = combat.value
  const firstAfterReset = orderParticipants(combatants.value.map((participant) => ({ ...participant, initiative: 0, initiative_known: false })), '[]', rules.value)[0]
  try {
    for (const participant of combatants.value) {
      try {
        await guardedUpdate('combatants', combatSnapshots.value[participant.id] ?? participant, { initiative: 0, initiative_known: false, current_hp: 0, max_hp: 0, hp_known: false, conditions: '' })
      } catch (cause) {
        if (isConflict(cause) || isDefiniteWriteRejection(cause)) {
          combatTrackerError.value = 'Reset stopped because a participant changed elsewhere. Current values were refreshed; review and try again.'
          await refreshCombatPreservingDrafts()
          return
        }
        combatTrackerUncertain.value = true
        combatTrackerError.value = 'Reset could not be confirmed for every participant. Refresh live state before another turn or reset so a delayed write is not repeated.'
        return
      }
      markCombatantMutation(participant.id)
    }
    try {
      await guardedUpdate('combats', combatSnapshot, { active: true, round: 1, turn: 0, active_participant: firstAfterReset?.id ?? '', tie_order: '[]' })
    } catch (cause) {
      if (isConflict(cause) || isDefiniteWriteRejection(cause)) {
        combatTrackerError.value = 'Reset stopped because the combat changed elsewhere. Current values were refreshed; review and try again.'
        await refreshCombatPreservingDrafts()
        return
      }
      combatTrackerUncertain.value = true
      combatTrackerError.value = 'Reset could not be confirmed. Refresh live state before another turn or reset so a delayed write is not repeated.'
      return
    }
    try {
      const refreshed = await loadCombat(selectionGeneration, { preserveDirtyDrafts: true, rebaseIds: new Set(combatants.value.map((participant) => participant.id)) })
      if (refreshed) {
        for (const participant of combatants.value) syncDraftFields(participant.id, ['initiative', 'current_hp', 'max_hp', 'conditions'])
      }
    } catch {
      liveRefreshRequired.value = true
      combatTrackerError.value = 'Reset was saved, but the live tracker could not refresh. Refresh live state before continuing.'
    }
  } finally {
    combatTrackerPending.value = false
  }
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
  setupDrafts.value = {}
  setupSelectedForGroup.value = []
  setupCharacters.value = []
  setupCustoms.value = []
  diceError.value = ''
  combatWritePending.value = {}
  combatWriteUncertain.value = {}
  participantErrors.value = {}
  participantConflicts.value = {}
  liveRefreshRequired.value = false
  combatTrackerPending.value = false
  combatTrackerUncertain.value = false
  combatTrackerError.value = ''
  groupRollError.value = ''
  addParticipantPending.value = false
  addParticipantUncertain.value = false
  addParticipantError.value = ''
  combatMutationByParticipant.clear()
}

async function applyEncounterSelection(id: string) {
  if (startInFlight) { pendingRouteSync = true; return }
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
  if (startInFlight) return
  replaceEncounterQuery(id)
  await applyEncounterSelection(id)
}

function beginCreate() {
  if (startInFlight) return
  editingId.value = ''
  name.value = ''
  formOpen.value = true
}
function beginRename(encounter: Encounter) {
  if (startInFlight) return
  editingId.value = encounter.id
  name.value = encounter.name
  formOpen.value = true
}

async function saveEncounter() {
  if (startInFlight || !name.value.trim()) return
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
  if (startInFlight) return
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
  if (startInFlight) return
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
  if (startInFlight) return
  if (!pickerPending.value) pickerFeedback.value = null
  pickerOpen.value = true
}

async function addCreature(creature: CatalogRecord) {
  if (startInFlight || !selected.value || pickerPending.value) return
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
  if (startInFlight || !selected.value || !customName.value.trim() || !Number.isInteger(customQuantity.value) || customQuantity.value < 1 || customQuantity.value > 100) return
  try {
    await pb.collection('encounter_creatures').create({ encounter: selected.value.id, name: customName.value.trim(), quantity: customQuantity.value, notes: customNotes.value, custom: true })
    customName.value = ''; customQuantity.value = 1; customNotes.value = ''; customOpen.value = false
    await loadEntries()
  } catch { error.value = 'The custom participant could not be added.' }
}

async function saveEntry(entry: Entry) {
  if (startInFlight) return
  const draft = entryDrafts.value[entry.id]
  if (!draft || !Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 100) { error.value = 'Quantity must be a whole number from 1 to 100.'; return }
  try {
    await pb.collection('encounter_creatures').update(entry.id, { quantity: draft.quantity, notes: draft.notes })
    await loadEntries()
  } catch { error.value = 'The creature entry could not be updated.' }
}

async function removeEntry(entry: Entry) {
  if (startInFlight) return
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
      <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> {{ game.expand?.system?.name ?? 'GAME' }}</p><h1 id="page-title">Encounters</h1><p class="screen-description">Prepare reusable creature groupings for {{ game.name }}. Preparation stays separate from live combat.</p></div><div class="row-actions"><button class="primary-button" type="button" :disabled="setupStarting" @click="beginCreate">＋ New encounter</button></div></div>
      <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" :disabled="setupStarting" @click="refreshAll">Refresh</button> <button v-if="startUncertain && uncertainReconciled" class="inline-button" type="button" @click="confirmNoActiveCombat">Confirm no combat was created</button></p>
      <form v-if="formOpen" class="editor-panel" @submit.prevent="saveEncounter"><h2>{{ editingId ? 'Rename encounter' : 'New encounter' }}</h2><label class="field-label" for="encounter-name">Name</label><input id="encounter-name" v-model="name" class="text-input" maxlength="160" required /><div class="form-actions"><button class="secondary-button" type="button" @click="formOpen = false">Cancel</button><button class="primary-button" type="submit">Save encounter</button></div></form>
      <div v-if="encounters.length" class="encounter-layout">
        <aside class="encounter-sidebar" aria-label="Prepared encounters"><button v-for="encounter in encounters" :key="encounter.id" class="spellbook-tab" :class="{ selected: encounter.id === selectedId }" type="button" :disabled="setupStarting" @click="selectEncounter(encounter.id)">{{ encounter.name }}<small>{{ encounter.id === selectedId ? entries.length + ' creature types' : '' }}</small></button></aside>
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
            :busy="setupStarting"
            @add-catalog="openPicker"
            @add-custom="addCustom"
            @save-entry="saveEntry"
            @remove-entry="removeEntry"
            @rename="beginRename(selected)"
            @duplicate="duplicateEncounter(selected)"
            @delete="deleteEncounter(selected)"
            @print="rememberPrintPosition"
          />
          <EncounterCombatSetup
            v-if="!combat?.active"
            v-model:drafts="setupDrafts"
            v-model:selected-for-group="setupSelectedForGroup"
            :planned="plannedCombatants"
            :rules="rules"
            :characters="gameCharacters"
            :hp-source-for="hpSourceForPlanned"
            :modifier-for="modifierForPlanned"
            :can-start="plannedCombatants.length > 0 && !startRecoveryRequired"
            :starting="setupStarting"
            :recovery-required="startRecoveryRequired"
            @start="startCombat"
            @add-character="addSetupCharacter"
            @add-custom="addSetupCustom"
            @remove-planned="removeSetupParticipant"
          />
          <EncounterLivePanel
            v-else
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
            :can-start="plannedCombatants.length > 0"
            :hp-source-for="hpFromSource"
            :pending="combatWritePending"
            :uncertain="combatWriteUncertain"
            :participant-errors="participantErrors"
            :participant-conflicts="participantConflicts"
            :group-error="groupRollError"
            :tracker-error="combatTrackerError"
            :add-error="addParticipantError"
            :tracker-pending="combatTrackerPending"
            :tracker-uncertain="combatTrackerUncertain"
            :refresh-required="liveRefreshRequired"
            :add-pending="addParticipantPending"
            :add-uncertain="addParticipantUncertain"
            @start="startCombat"
            @reset="resetCombat"
            @end="endCombat"
            @previous="moveTurn(-1)"
            @next="moveTurn(1)"
            @roll-group="rollGroupInitiative"
            @add-character="addCharacter"
            @add-custom="addCustomCombatant"
            @save-combatant="saveCombatant"
            @adjust-hp="adjustCombatantHP"
            @preview-hp="previewHP"
            @confirm-hp="confirmHP"
            @remove-combatant="removeCombatant"
            @roll-one="rollOneInitiative"
            @set-tie-order="setTieOrder"
            @save-display-setting="saveDisplaySetting"
            @refresh-live="refreshAll"
            @resolve-conflict="resolveParticipantConflict"
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
