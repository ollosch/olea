<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { pb } from '../lib/pocketbase'
import { participantDisplay } from '../lib/playerEncounter'
import { systemForGame } from '../lib/systems'
import { activeParticipant, orderParticipants } from '../lib/encounterOrder'

type Combat = { id: string; updated: string; encounter: string; active: boolean; round: number; turn: number; active_participant: string; tie_order: string; visible: boolean; show_initiative: boolean; show_enemy_names: boolean; show_hp: boolean; show_conditions: boolean; expand?: { encounter?: { name: string } } }
type Game = { id: string; system: string; expand?: { system?: { key: string } }; encounter_visible: boolean; encounter_show_initiative: boolean; encounter_show_enemy_names: boolean; encounter_show_hp: boolean; encounter_show_conditions: boolean }
type Combatant = { id: string; name: string; enemy: boolean; initiative: number; initiative_known: boolean; current_hp: number; max_hp: number; hp_known: boolean; conditions: string; sort_order: number }
const route = useRoute()
const gameId = computed(() => String(route.params.gameId))
const combat = ref<Combat | null>(null)
const participants = ref<Combatant[]>([])
const error = ref('')
const loading = ref(true)
const game = ref<Game | null>(null)
const unsubscribers = ref<Array<() => Promise<void>>>([])
let generation = 0
const ordered = computed(() => orderParticipants(participants.value, combat.value?.tie_order ?? '', systemForGame(game.value).encounter))
const activeId = computed(() => activeParticipant(ordered.value, combat.value?.active_participant ?? '', combat.value?.turn ?? 0)?.id)
const visibleParticipants = computed(() => game.value?.encounter_show_initiative ? ordered.value : [...participants.value].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)))
const displaySettings = computed(() => ({ showInitiative: !!game.value?.encounter_show_initiative, showEnemyNames: !!game.value?.encounter_show_enemy_names, showHP: !!game.value?.encounter_show_hp, showConditions: !!game.value?.encounter_show_conditions }))
function displayFor(participant: Combatant) { return participantDisplay({ name: participant.name, enemy: participant.enemy, initiative: participant.initiative, initiativeKnown: participant.initiative_known, currentHP: participant.current_hp, maxHP: participant.max_hp, hpKnown: participant.hp_known, conditions: participant.conditions }, displaySettings.value) }

onMounted(async () => {
  await load()
  await subscribe()
  window.addEventListener('olea-reconnected', refresh)
  window.addEventListener('focus', refresh)
})
onUnmounted(() => {
  generation++
  window.removeEventListener('olea-reconnected', refresh)
  window.removeEventListener('focus', refresh)
  for (const stop of unsubscribers.value) void stop()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    game.value = await pb.collection('games').getOne<Game>(gameId.value, { expand: 'system' })
    const active = await pb.collection('combats').getList<Combat>(1, 1, { filter: pb.filter('active = true && encounter.game = {:game}', { game: gameId.value }), sort: 'id', expand: 'encounter', requestKey: null })
    combat.value = game.value.encounter_visible ? active.items[0] ?? null : null
    participants.value = combat.value ? await pb.collection('combatants').getFullList<Combatant>({ filter: pb.filter('combat = {:combat}', { combat: combat.value.id }), sort: 'sort_order', requestKey: null }) : []
  } catch { error.value = 'The active encounter could not be loaded.' }
  finally { loading.value = false }
}
async function subscribe() {
  const current = ++generation
  for (const stop of unsubscribers.value) void stop()
  try {
    const stops = await Promise.all(['games', 'combats', 'combatants'].map((collection) => pb.collection(collection).subscribe('*', () => { void load() })))
    if (current !== generation) { for (const stop of stops) void stop(); return }
    unsubscribers.value = stops
  } catch { error.value = 'Live updates are unavailable. Refresh to see the latest display.' }
}
async function refresh() { await load(); await subscribe() }
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading active encounter…</div>
    <template v-else-if="combat && game?.encounter_visible">
      <p class="eyebrow"><span class="eyebrow-line" /> ACTIVE ENCOUNTER</p>
      <h1 id="page-title">{{ combat.expand?.encounter?.name ?? 'Encounter' }}</h1>
      <p v-if="game?.encounter_show_initiative" class="screen-description">Round {{ combat.round }}</p>
      <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="refresh">Refresh</button></p>
      <div v-if="visibleParticipants.length" class="combatant-list player-combatant-list"><article v-for="participant in visibleParticipants" :key="participant.id" class="combatant-card" :class="{ active: activeId === participant.id }"><div class="combatant-title"><div><strong>{{ displayFor(participant).name }}</strong></div><span v-if="displayFor(participant).initiative !== null" class="initiative-pill">Init {{ displayFor(participant).initiative }}</span></div><p v-if="displayFor(participant).hp" class="player-combatant-stat">HP {{ displayFor(participant).hp?.current }}/{{ displayFor(participant).hp?.max }}</p><p v-if="displayFor(participant).conditions" class="player-combatant-stat">{{ displayFor(participant).conditions }}</p></article></div>
      <p v-else class="muted-hint">No participants are currently listed.</p>
      <p class="player-privacy-note">Encounter details are shared according to the game’s display settings. These UI settings are not security controls on the trusted LAN.</p>
    </template>
    <div v-else class="empty-state"><div class="empty-state-icon" aria-hidden="true">⚔</div><h2>No player encounter is visible</h2><p v-if="error" class="field-error" role="alert">{{ error }} <button class="inline-button" type="button" @click="refresh">Retry</button></p><p v-else>The Game Master has not enabled the player-facing encounter display.</p><RouterLink class="text-link" to="/characters">← Choose character</RouterLink></div>
  </section>
</template>
