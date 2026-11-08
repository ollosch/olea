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
import { itemPrintCard } from '../lib/printCards'

type Character = { id: string; name: string; game: string }
type Inventory = { id: string; character: string; game: string }
type InventoryItem = { id: string; catalog_item: string; name: string; quantity: number; weight: number; weight_known: boolean; notes: string; container: string; expand?: { catalog_item?: CatalogRecord } }
type Game = { id: string; name: string; system: string; expand?: { system?: { key: string; name: string } } }

const route = useRoute()
const character = ref<Character | null>(null)
const game = ref<Game | null>(null)
const items = ref<InventoryItem[]>([])
const selected = ref<string[]>([])
const loading = ref(true)
const error = ref('')
const system = computed(() => systemForGame(game.value))
const returnTarget = computed<RouteLocationNamedRaw>(() => ({
  name: 'character-inventory',
  params: { characterId: character.value?.id ?? '' },
  state: { oleaInventoryReturn: true },
}))
const cardEntries = computed(() => items.value.map((item) => ({
  item,
  card: itemPrintCard({
    id: item.id,
    name: item.name,
    record: item.expand?.catalog_item,
    quantity: item.quantity,
    weight: item.weight_known ? `${item.weight} ${system.value.currency.weightUnit ?? 'units'}` : '',
    notes: item.notes ?? '',
  }, system.value),
})))
const cards = computed(() => cardEntries.value.map((entry) => entry.card))
const selectedCards = computed(() => cardEntries.value.filter((entry) => selected.value.includes(entry.card.id)).map((entry) => entry.card))
const cardOptions = computed<PrintSelectionOption[]>(() => cardEntries.value.map(({ item, card }) => ({
  id: card.id,
  name: card.name,
  meta: item.expand?.catalog_item ? system.value.catalog.resultLabel(item.expand.catalog_item) : 'Custom item',
  detail: `Quantity ${item.quantity}${item.notes ? ' · Notes available' : ' · No notes'}`,
  warning: card.warnings?.length ? card.warnings.join(' ') : undefined,
})))

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    character.value = await pb.collection('characters').getOne<Character>(String(route.params.characterId))
    game.value = await pb.collection('games').getOne<Game>(character.value.game, { expand: 'system' })
    const inventory = await pb.collection('inventories').getFirstListItem<Inventory>(pb.filter('character = {:character}', { character: character.value.id }))
    items.value = await pb.collection('inventory_items').getFullList<InventoryItem>({ filter: pb.filter('inventory = {:inventory} && container = ""', { inventory: inventory.id }), sort: 'name', expand: 'catalog_item', requestKey: null })
    selected.value = items.value.map((item) => item.id)
  } catch { error.value = 'Inventory item cards could not be loaded.' }
  finally { loading.value = false }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading item cards…</div>
    <template v-else-if="character && game">
      <RouterLink class="text-link screen-only" :to="returnTarget">← {{ character.name }}’s inventory</RouterLink>
      <PrintSelectionPanel
        class="screen-only"
        :eyebrow="game.expand?.system?.name ?? 'ITEMS'"
        title="Choose item cards"
        description="Only root carried items are printed: items inside containers and stash contents are not included. Cards use the confirmed A7 landscape format, eight positions per A4 sheet. Weapon damage and properties are highlighted when supplied by the catalog."
        legend="Root carried item cards"
        name="items"
        noun="card"
        :options="cardOptions"
        :selected="selected"
        empty-text="No root carried items are available to print. Stash contents and items inside containers are not included."
        @update:selected="selected = $event"
      />
      <CardPrintPreview :title="`${character.name} · Item cards`" :cards="selectedCards" :layout="CARD_LAYOUTS.a7Eight" :calibration-href="'/print/calibration'" />
    </template>
    <p v-else class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
  </section>
</template>
