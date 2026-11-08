<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import FeedbackRegion from '../components/FeedbackRegion.vue'
import { useLiveConnection } from '../composables/useLiveConnection'
import { pb } from '../lib/pocketbase'
import { orderPlayerParticipants, participantDisplay } from '../lib/playerEncounter'
import { subscribeAll } from '../lib/liveSubscriptions'
import { systemForGame } from '../lib/systems'
import { activeParticipant, orderParticipants } from '../lib/encounterOrder'

type Combat = { id: string; updated: string; encounter: string; active: boolean; round: number; turn: number; active_participant: string; tie_order: string; visible: boolean; show_initiative: boolean; show_enemy_names: boolean; show_hp: boolean; show_conditions: boolean; expand?: { encounter?: { name: string } } }
type Game = { id: string; system: string; expand?: { system?: { key: string } }; encounter_visible: boolean; encounter_show_initiative: boolean; encounter_show_enemy_names: boolean; encounter_show_hp: boolean; encounter_show_conditions: boolean }
type Combatant = { id: string; name: string; enemy: boolean; initiative: number; initiative_known: boolean; current_hp: number; max_hp: number; hp_known: boolean; conditions: string; sort_order: number }
type RealtimeEvent = { action: string; record: Record<string, unknown> }

const route = useRoute()
const gameId = computed(() => String(route.params.gameId))
const combat = ref<Combat | null>(null)
const participants = ref<Combatant[]>([])
const error = ref('')
const loading = ref(true)
const game = ref<Game | null>(null)
const visibilityUnresolved = ref(false)
const unsubscribers = ref<Array<() => Promise<void>>>([])
let initialized = false
let mountedGeneration = 0
let refreshVersion = 0
let refreshRequested = false
let refreshLoop: Promise<boolean> | null = null
let subscriptionGeneration = 0
let subscriptionActive = false
const live = useLiveConnection({ refresh: requestRefresh, resubscribe: subscribe })
const liveTone = computed(() => live.state.value === 'unavailable' || live.state.value === 'offline' ? 'error' : 'status')
const liveText = computed(() => live.notice.value || live.message.value)
const liveAction = computed(() => liveTone.value === 'error' ? 'Retry live updates' : '')

const ordered = computed(() => orderParticipants(participants.value, combat.value?.tie_order ?? '', systemForGame(game.value).encounter))
const activeId = computed(() => activeParticipant(ordered.value, combat.value?.active_participant ?? '', combat.value?.turn ?? 0)?.id)
const visibleParticipants = computed(() => orderPlayerParticipants(participants.value, combat.value?.tie_order ?? '', systemForGame(game.value).encounter, !!game.value?.encounter_show_initiative))
const displaySettings = computed(() => ({ showInitiative: !!game.value?.encounter_show_initiative, showEnemyNames: !!game.value?.encounter_show_enemy_names, showHP: !!game.value?.encounter_show_hp, showConditions: !!game.value?.encounter_show_conditions }))
function displayFor(participant: Combatant) { return participantDisplay({ name: participant.name, enemy: participant.enemy, initiative: participant.initiative, initiativeKnown: participant.initiative_known, currentHP: participant.current_hp, maxHP: participant.max_hp, hpKnown: participant.hp_known, conditions: participant.conditions }, displaySettings.value) }

onMounted(async () => {
  const subscribed = await subscribe()
  const loaded = await loadInitial()
  if (subscribed && loaded) live.markLive()
  else if (!subscribed) live.markUnavailable('Live updates are unavailable. Showing the last update; retry live updates.')
  else live.markUnavailable((game.value ? 'The latest live changes could not be loaded.' : 'The active encounter could not be loaded.') + ' Retry live updates.')
})
onUnmounted(() => {
  mountedGeneration++
  refreshVersion++
  refreshRequested = false
  subscriptionGeneration++
  subscriptionActive = false
  for (const stop of unsubscribers.value) void stop()
})

async function loadInitial(): Promise<boolean> {
  loading.value = true
  error.value = ''
  const ok = await requestRefresh()
  if (!ok && !initialized) error.value = 'The active encounter could not be loaded.'
  loading.value = false
  return ok && initialized
}

function requestRefresh(): Promise<boolean> {
  refreshVersion++
  refreshRequested = true
  return ensureRefreshLoop()
}

function ensureRefreshLoop(): Promise<boolean> {
  if (!refreshLoop) {
    refreshLoop = runRefreshLoop().finally(() => { refreshLoop = null })
  }
  return refreshLoop
}

async function runRefreshLoop(): Promise<boolean> {
  const mount = mountedGeneration
  do {
    refreshRequested = false
    const version = refreshVersion
    try {
      const result = await refreshLiveData(version, mount)
      if (mount !== mountedGeneration) return true
      if (result === 'stale') { refreshRequested = true; continue }
      visibilityUnresolved.value = false
    } catch {
      if (mount !== mountedGeneration) return true
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        live.markOffline()
        return false
      }
      visibilityUnresolved.value = true
      live.markUnavailable('The latest live changes could not be loaded. Showing the last update; retry live updates.')
      return false
    }
  } while (refreshRequested)
  if (subscriptionActive && live.state.value !== 'live') live.markLive()
  return true
}

async function refreshLiveData(version: number, mount: number): Promise<'ok' | 'stale'> {
  const gameRecord = await pb.collection('games').getOne<Game>(gameId.value, { expand: 'system', requestKey: null })
  let activeCombat: Combat | null = null
  let nextParticipants: Combatant[] = []
  if (gameRecord.encounter_visible) {
    const active = await pb.collection('combats').getList<Combat>(1, 1, { filter: pb.filter('active = true && encounter.game = {:game}', { game: gameId.value }), sort: 'id', expand: 'encounter', requestKey: null })
    activeCombat = active.items[0] ?? null
    if (activeCombat) {
      nextParticipants = await pb.collection('combatants').getFullList<Combatant>({ filter: pb.filter('combat = {:combat}', { combat: activeCombat.id }), sort: 'sort_order', requestKey: null })
    }
  }
  if (mount !== mountedGeneration || version !== refreshVersion) return 'stale'
  game.value = gameRecord
  combat.value = activeCombat
  participants.value = nextParticipants
  error.value = ''
  initialized = true
  return 'ok'
}

function realtimeIsRelevant(collection: string, event: RealtimeEvent) {
  const record = event.record
  if (collection === 'games') return String(record.id) === gameId.value
  if (collection === 'combats') return true
  if (collection === 'combatants') return !combat.value || String(record.combat) === combat.value.id
  return false
}

function handleRealtimeEvent(collection: string, event: RealtimeEvent) {
  if (!realtimeIsRelevant(collection, event)) return
  if (collection === 'games') {
    const record = event.record
    if (record.encounter_visible === false && game.value) {
      game.value = { ...game.value, ...record } as Game
      combat.value = null
      participants.value = []
    }
  }
  void requestRefresh()
}

async function subscribe(): Promise<boolean> {
  const generation = ++subscriptionGeneration
  subscriptionActive = false
  const previous = unsubscribers.value
  unsubscribers.value = []
  await Promise.all(previous.map((stop) => stop().catch(() => {})))
  try {
    const stops = await subscribeAll(['games', 'combats', 'combatants'], (collection) => pb.collection(collection).subscribe('*', (event) => {
      if (generation !== subscriptionGeneration) return
      handleRealtimeEvent(collection, event as RealtimeEvent)
    }))
    if (generation !== subscriptionGeneration) {
      await Promise.all(stops.map((stop) => stop().catch(() => {})))
      return false
    }
    unsubscribers.value = stops
    subscriptionActive = true
    return true
  } catch {
    subscriptionActive = false
    if (generation === subscriptionGeneration) live.markUnavailable('Live updates are unavailable. Showing the last update; retry live updates.')
    return false
  }
}

async function retryDisplay() {
  if (initialized) {
    live.retry()
    return
  }
  const subscribed = await subscribe()
  const loaded = await loadInitial()
  if (subscribed && loaded) live.markLive()
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title" :data-live-state="live.state.value">
    <div v-if="loading" class="loading-state" role="status">Loading active encounter…</div>
    <template v-else>
      <div class="feedback-slot">
        <FeedbackRegion v-if="liveText" :tone="liveTone" :action-label="liveAction" @action="live.retry">
          {{ liveText }}
        </FeedbackRegion>
      </div>
      <template v-if="combat && game?.encounter_visible && !visibilityUnresolved">
        <p class="eyebrow"><span class="eyebrow-line" /> ACTIVE ENCOUNTER</p>
        <h1 id="page-title">{{ combat.expand?.encounter?.name ?? 'Encounter' }}</h1>
        <p v-if="game?.encounter_show_initiative" class="screen-description">Round {{ combat.round }}</p>
        <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="retryDisplay">Refresh</button></p>
        <div v-if="visibleParticipants.length" class="combatant-list player-combatant-list"><article v-for="participant in visibleParticipants" :key="participant.id" class="combatant-card" :class="{ active: activeId === participant.id }"><div class="combatant-title"><div><strong>{{ displayFor(participant).name }}</strong></div><span v-if="displayFor(participant).initiative !== null" class="initiative-pill">Init {{ displayFor(participant).initiative }}</span></div><p v-if="displayFor(participant).hp" class="player-combatant-stat">HP {{ displayFor(participant).hp?.current }}/{{ displayFor(participant).hp?.max }}</p><p v-if="displayFor(participant).conditions" class="player-combatant-stat">{{ displayFor(participant).conditions }}</p></article></div>
        <p v-else class="muted-hint">No participants are currently listed.</p>
        <p class="player-privacy-note">Encounter details are shared according to the game’s display settings. These UI settings are not security controls on the trusted LAN.</p>
      </template>
      <div v-else class="empty-state"><div class="empty-state-icon" aria-hidden="true">⚔</div><h2>{{ visibilityUnresolved ? 'Live encounter unavailable' : 'No player encounter is visible' }}</h2><p v-if="visibilityUnresolved" class="field-error" role="alert">Live visibility could not be confirmed. <button class="inline-button" type="button" @click="live.retry">Retry live updates</button></p><p v-else-if="error" class="field-error" role="alert">{{ error }} <button class="inline-button" type="button" @click="retryDisplay">Retry</button></p><p v-else>The Game Master has not enabled the player-facing encounter display.</p><RouterLink class="text-link" to="/characters">← Choose character</RouterLink></div>
    </template>
  </section>
</template>
