<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import CardPrintPreview, { type PrintCard } from '../components/CardPrintPreview.vue'
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
const cards = computed<PrintCard[]>(() => items.value.map((item) => itemPrintCard({
  id: item.id,
  name: item.name,
  record: item.expand?.catalog_item,
  quantity: item.quantity,
  weight: item.weight_known ? `${item.weight} ${system.value.currency.weightUnit ?? 'units'}` : '',
  notes: item.notes ?? '',
}, system.value)))
const selectedCards = computed(() => cards.value.filter((card) => selected.value.includes(card.id)))

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

function toggle(id: string) { selected.value = selected.value.includes(id) ? selected.value.filter((entry) => entry !== id) : [...selected.value, id] }
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading item cards…</div>
    <template v-else-if="character && game">
      <RouterLink class="text-link screen-only" :to="{ name: 'character-inventory', params: { characterId: character.id } }">← {{ character.name }}’s inventory</RouterLink>
      <div class="card-selection screen-only"><div><p class="eyebrow">{{ game.expand?.system?.name ?? 'ITEMS' }}</p><h2>Choose item cards</h2><p>Cards use the confirmed A7 landscape format: eight positions per A4 sheet. Weapon damage and properties are highlighted when supplied by the catalog.</p></div><div class="row-actions"><button class="secondary-button" type="button" @click="selected = cards.map((card) => card.id)">Select all</button><button class="secondary-button" type="button" @click="selected = []">Clear</button></div><label v-for="(card, index) in cards" :key="card.id" class="card-choice"><input type="checkbox" :checked="selected.includes(card.id)" @change="toggle(card.id)" /><span><strong>{{ card.name }}<small>{{ items[index]?.expand?.catalog_item ? system.catalog.resultLabel(items[index]!.expand!.catalog_item!) : 'Custom item' }}</small></strong><small>Quantity {{ items[index]?.quantity }}<template v-if="items[index]?.notes"> · Notes available</template></small></span></label><p v-if="!cards.length" class="muted-hint">No carried items are available to print.</p></div>
      <CardPrintPreview :title="`${character.name} · Item cards`" :cards="selectedCards" :layout="CARD_LAYOUTS.a7Eight" :calibration-href="'/print/calibration'" />
    </template>
    <p v-else class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
  </section>
</template>
