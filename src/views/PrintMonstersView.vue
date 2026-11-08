<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { RouteLocationNamedRaw } from 'vue-router'
import CardPrintPreview, { type PrintCard } from '../components/CardPrintPreview.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { systemForGame, systemByKey } from '../lib/systems'
import { CARD_LAYOUTS } from '../lib/cardPrint'
import { monsterPrintCard } from '../lib/printCards'

type Game = { id: string; name: string; system: string; expand?: { system?: { key: string; name: string } } }
type Encounter = { id: string; game: string; name: string }
type EncounterEntry = { id: string; encounter: string; creature: string; name: string; notes: string; custom: boolean; expand?: { creature?: CatalogRecord } }
type SourceCard = { id: string; identity: string; name: string; encounterNames: string[]; notes: string[]; record?: CatalogRecord; custom: boolean; missing: boolean }

const route = useRoute()
const game = ref<Game | null>(null)
const encounters = ref<Encounter[]>([])
const entries = ref<EncounterEntry[]>([])
const selectedEncounters = ref<string[]>([])
const selectedCards = ref<string[]>([])
const originEncounterId = ref('')
const loading = ref(true)
const error = ref('')
const system = computed(() => systemForGame(game.value))
const returnTarget = computed<RouteLocationNamedRaw>(() => {
  const encounterId = returnEncounterId()
  return {
    name: 'game-encounters',
    params: { gameId: game.value?.id ?? '' },
    query: encounterId ? { encounter: encounterId } : {},
    ...(encounterId ? { state: { oleaEncounterReturn: true } } : {}),
  }
})

function returnEncounterId() {
  const valid = (id: string) => Boolean(id) && encounters.value.some((encounter) => encounter.id === id)
  if (valid(originEncounterId.value)) return originEncounterId.value
  const requested = String(route.query.encounter ?? '')
  if (valid(requested)) return requested
  return selectedEncounters.value[0] ?? encounters.value[0]?.id ?? ''
}
const choiceMap = computed(() => {
  const encounterNames = new Map(encounters.value.map((encounter) => [encounter.id, encounter.name]))
  const grouped = new Map<string, SourceCard>()
  for (const entry of entries.value) {
    if (!selectedEncounters.value.includes(entry.encounter)) continue
    const record = entry.expand?.creature
    const identity = record ? `catalog:${record.id}` : entry.custom ? `custom:${entry.encounter}:${entry.id}` : `missing:${entry.encounter}:${entry.id}`
    const existing = grouped.get(identity)
    if (existing) {
      if (!existing.encounterNames.includes(encounterNames.get(entry.encounter) ?? 'Encounter')) existing.encounterNames.push(encounterNames.get(entry.encounter) ?? 'Encounter')
      if (entry.notes.trim() && !existing.notes.includes(entry.notes.trim())) existing.notes.push(entry.notes.trim())
    } else {
      grouped.set(identity, {
        id: identity,
        identity,
        name: record?.name ?? entry.name,
        encounterNames: [encounterNames.get(entry.encounter) ?? 'Encounter'],
        notes: entry.notes.trim() ? [entry.notes.trim()] : [],
        record,
        custom: entry.custom,
        missing: !record && !entry.custom,
      })
    }
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name) || a.identity.localeCompare(b.identity))
})
const cards = computed<PrintCard[]>(() => choiceMap.value.filter((choice) => selectedCards.value.includes(choice.id)).map((choice) => choice.record
  ? monsterPrintCard({ record: choice.record, encounterNotes: choice.notes }, system.value)
  : {
      id: choice.id,
      name: choice.name,
      front: { title: choice.custom ? 'Custom participant · manual stats' : 'Missing catalog creature', content: choice.custom ? 'This encounter participant was entered as a custom entry. Its stats and actions must be supplied manually.' : 'The original catalog record is missing. This card contains only the saved encounter entry.' },
      back: { title: choice.custom ? 'Custom creature' : 'Missing source', note: choice.encounterNames.join(' · '), content: choice.notes.length ? choice.notes.join('\n') : 'No additional notes or flavour text are available.' },
      warnings: choice.custom ? ['Custom participants have no imported stats; add manual notes before printing.'] : ['Catalog creature is missing.'],
    }))

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    game.value = await pb.collection('games').getOne<Game>(String(route.params.gameId), { expand: 'system' })
    const [encounterRows, catalogRows] = await Promise.all([
      pb.collection('encounters').getFullList<Encounter>({ filter: pb.filter('game = {:game}', { game: game.value.id }), sort: 'name', requestKey: null }),
      pb.collection('catalog').getFullList<CatalogRecord>({ filter: pb.filter('system = {:system} && type = {:type}', { system: game.value.system, type: 'creature' }), expand: 'system', requestKey: null }),
    ])
    encounters.value = encounterRows
    const requested = String(route.query.encounter ?? '')
    const origin = String(route.query.returnEncounter ?? '')
    selectedEncounters.value = encounterRows.some((encounter) => encounter.id === requested) ? [requested] : encounterRows[0] ? [encounterRows[0].id] : []
    originEncounterId.value = encounterRows.some((encounter) => encounter.id === origin) ? origin : ''
    const rows = await pb.collection('encounter_creatures').getFullList<EncounterEntry>({ filter: pb.filter('encounter.game = {:game}', { game: game.value.id }), sort: 'name', requestKey: null })
    const catalogById = new Map(catalogRows.map((record) => [record.id, record]))
    entries.value = rows.map((entry) => ({ ...entry, expand: { creature: catalogById.get(entry.creature) } }))
    selectedCards.value = []
  } catch { error.value = 'Monster-card data could not be loaded. Check the game and local server.' }
  finally { loading.value = false }
}

function updateEncounterSelection(event: Event) {
  const select = event.target as HTMLSelectElement
  selectedEncounters.value = Array.from(select.selectedOptions).map((option) => option.value)
  selectedCards.value = []
}

function toggleCard(id: string) {
  selectedCards.value = selectedCards.value.includes(id) ? selectedCards.value.filter((entry) => entry !== id) : [...selectedCards.value, id]
}

function selectAll() { selectedCards.value = choiceMap.value.map((choice) => choice.id) }
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading monster cards…</div>
    <template v-else-if="game">
      <RouterLink class="text-link screen-only" :to="returnTarget">← {{ game.name }} encounters</RouterLink>
      <div class="card-selection screen-only">
        <div><p class="eyebrow">{{ game.expand?.system?.name ?? 'GAME' }}</p><h2>Choose encounters and creatures</h2><p>Select one encounter or several from this game. Catalog creature types are deduplicated by catalog record; custom participants remain separate.</p></div>
        <label class="filter-field">Encounters (select multiple)<select class="select-input" multiple size="5" :value="selectedEncounters" @change="updateEncounterSelection"><option v-for="encounter in encounters" :key="encounter.id" :value="encounter.id">{{ encounter.name }}</option></select></label>
        <div class="row-actions"><button class="secondary-button" type="button" @click="selectAll">Select all cards</button><button class="secondary-button" type="button" @click="selectedCards = []">Clear cards</button></div>
        <p v-if="!choiceMap.length" class="muted-hint">No creature entries in the selected encounters.</p>
        <label v-for="choice in choiceMap" :key="choice.id" class="card-choice"><input type="checkbox" :checked="selectedCards.includes(choice.id)" @change="toggleCard(choice.id)" /><span><strong>{{ choice.name }}<small v-if="choice.record">{{ system.catalog.resultLabel(choice.record) }}</small><small v-else>{{ choice.custom ? 'Custom participant · manual card' : 'Catalog record missing' }}</small></strong><small>{{ choice.encounterNames.join(' · ') }} · {{ choice.notes.length ? `${choice.notes.length} note${choice.notes.length === 1 ? '' : 's'}` : 'no encounter notes' }}</small></span></label>
      </div>
      <CardPrintPreview :title="`${game.name} · Monster cards`" :cards="cards" :layout="CARD_LAYOUTS.a6Four" :calibration-href="'/print/calibration'" />
    </template>
    <p v-else class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
  </section>
</template>
