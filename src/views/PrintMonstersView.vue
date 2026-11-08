<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { RouteLocationNamedRaw } from 'vue-router'
import CardPrintPreview, { type PrintCard } from '../components/CardPrintPreview.vue'
import PrintSelectionPanel, { type PrintSelectionOption } from '../components/PrintSelectionPanel.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { systemForGame } from '../lib/systems'
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
const returnLabel = computed(() => {
  const encounter = encounters.value.find((entry) => entry.id === returnEncounterId())
  return encounter && game.value ? `← Back to ${encounter.name} in ${game.value.name}` : `← ${game.value?.name ?? 'Game'} encounters`
})
const entryCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of entries.value) counts.set(entry.encounter, (counts.get(entry.encounter) ?? 0) + 1)
  return counts
})
const encounterOptions = computed<PrintSelectionOption[]>(() => encounters.value.map((encounter) => {
  const count = entryCounts.value.get(encounter.id) ?? 0
  return { id: encounter.id, name: encounter.name, meta: `${count} participant${count === 1 ? '' : 's'}` }
}))

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
const cardOptions = computed<PrintSelectionOption[]>(() => choiceMap.value.map((choice) => ({
  id: choice.id,
  name: choice.name,
  meta: choice.record ? system.value.catalog.resultLabel(choice.record) : choice.custom ? 'Custom participant · manual card' : 'Catalog record missing',
  detail: `${choice.encounterNames.join(' · ')} · ${choice.notes.length ? `${choice.notes.length} note${choice.notes.length === 1 ? '' : 's'}` : 'no encounter notes'}`,
  warning: choice.custom
    ? 'Custom participants have no imported stats; add manual notes before printing.'
    : choice.missing ? 'Catalog creature is missing; this card contains only the saved encounter entry.' : undefined,
})))

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

function setSelectedEncounters(ids: string[]) {
  selectedEncounters.value = ids
  selectedCards.value = []
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading monster cards…</div>
    <template v-else-if="game">
      <RouterLink class="text-link screen-only" :to="returnTarget">{{ returnLabel }}</RouterLink>
      <PrintSelectionPanel
        class="screen-only"
        :eyebrow="game.expand?.system?.name ?? 'GAME'"
        title="Choose encounters and creatures"
        description="Select one encounter or several from this game with the checkboxes. Catalog creature types are deduplicated by catalog record; custom participants remain separate."
        legend="Encounters"
        name="encounters"
        noun="encounter"
        :options="encounterOptions"
        :selected="selectedEncounters"
        empty-text="This game has no encounters yet. Create an encounter before printing creature cards."
        @update:selected="setSelectedEncounters"
      />
      <PrintSelectionPanel
        class="screen-only"
        eyebrow="CREATURE CARDS"
        title="Choose creature cards"
        description="Cards from the selected encounters appear here. Select the creatures you want on the sheet."
        legend="Creature cards"
        name="creature-cards"
        noun="card"
        :options="cardOptions"
        :selected="selectedCards"
        :empty-text="selectedEncounters.length ? 'No creature entries in the selected encounters.' : 'Choose at least one encounter to see its creature cards.'"
        @update:selected="selectedCards = $event"
      />
      <CardPrintPreview :title="`${game.name} · Monster cards`" :cards="cards" :layout="CARD_LAYOUTS.a6Four" :calibration-href="'/print/calibration'" />
    </template>
    <p v-else class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
  </section>
</template>
