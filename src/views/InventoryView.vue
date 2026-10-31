<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import CatalogPicker from '../components/CatalogPicker.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'

type Character = { id: string; name: string; game: string }
type Inventory = { id: string; game: string; character: string }
type InventoryItem = { id: string; inventory: string; catalog_item: string; name: string; quantity: number; weight: number; notes: string; expand?: { catalog_item?: CatalogRecord } }
const route = useRoute()
const character = ref<Character | null>(null)
const inventory = ref<Inventory | null>(null)
const items = ref<InventoryItem[]>([])
const loading = ref(true)
const error = ref('')
const pickerOpen = ref(false)
const customOpen = ref(false)
const customName = ref('')
const customWeight = ref('')
const customNotes = ref('')
const editing = ref('')
const quantityDraft = ref(1)
const notesDraft = ref('')
const game = ref<{ system: string } | null>(null)
const systemId = computed(() => game.value?.system ?? '')

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    character.value = await pb.collection('characters').getOne<Character>(String(route.params.characterId))
    game.value = await pb.collection('games').getOne<{ system: string }>(character.value.game)
    const found = await pb.collection('inventories').getFullList<Inventory>({ filter: pb.filter('character = {:character}', { character: character.value.id }), perPage: 2 })
    inventory.value = found[0] ?? await pb.collection('inventories').create<Inventory>({ game: character.value.game, character: character.value.id })
    await loadItems()
  } catch {
    error.value = 'Inventory could not be loaded. Check the local server and try again.'
  } finally { loading.value = false }
}

async function loadItems() {
  if (!inventory.value) return
  items.value = await pb.collection('inventory_items').getFullList<InventoryItem>({
    filter: pb.filter('inventory = {:inventory}', { inventory: inventory.value.id }), sort: 'name', expand: 'catalog_item',
  })
}

async function addCatalogItem(record: CatalogRecord) {
  if (!inventory.value) return
  try {
    await pb.collection('inventory_items').create({ inventory: inventory.value.id, catalog_item: record.id, name: record.name, quantity: 1, weight: parseWeight(record.item_weight), notes: '' })
    pickerOpen.value = false
    await loadItems()
  } catch { error.value = 'The item could not be added.' }
}

async function addCustomItem() {
  if (!inventory.value || !customName.value.trim()) return
  const weight = customWeight.value.trim() ? Number(customWeight.value) : 0
  if (!Number.isFinite(weight) || weight < 0) { error.value = 'Weight must be zero or a positive number.'; return }
  try {
    await pb.collection('inventory_items').create({ inventory: inventory.value.id, name: customName.value.trim(), quantity: 1, weight, notes: customNotes.value })
    customName.value = ''; customWeight.value = ''; customNotes.value = ''; customOpen.value = false
    await loadItems()
  } catch { error.value = 'The custom item could not be added.' }
}

function startEdit(item: InventoryItem) { editing.value = item.id; quantityDraft.value = item.quantity; notesDraft.value = item.notes ?? '' }
async function saveEdit(item: InventoryItem) {
  if (!Number.isInteger(quantityDraft.value) || quantityDraft.value < 1) { error.value = 'Quantity must be a whole number greater than zero.'; return }
  try { await pb.collection('inventory_items').update(item.id, { quantity: quantityDraft.value, notes: notesDraft.value }); editing.value = ''; await loadItems() }
  catch { error.value = 'The item could not be updated.' }
}
async function drop(item: InventoryItem) {
  try { await pb.collection('inventory_items').delete(item.id); await loadItems() }
  catch { error.value = 'The item could not be dropped.' }
}
function parseWeight(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value)
  if (value && typeof value === 'object' && 'value' in value) return parseWeight((value as { value: unknown }).value)
  return 0
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading inventory…</div>
    <template v-else-if="character">
      <RouterLink class="text-link" :to="{ name: 'character-overview', params: { characterId: character.id } }">← {{ character.name }}</RouterLink>
      <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> CHARACTER INVENTORY</p><h1 id="page-title">{{ character.name }}’s items</h1><p class="screen-description">Items and quantities carried by this character.</p></div><div class="heading-actions"><button class="primary-button" type="button" @click="pickerOpen = !pickerOpen">＋ Add catalog item</button><button class="secondary-button" type="button" @click="customOpen = !customOpen">Custom item</button></div></div>
      <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
      <div v-if="pickerOpen" class="editor-panel"><div class="catalog-panel-heading"><h2>Choose an item</h2><button class="secondary-button" type="button" @click="pickerOpen = false">Close</button></div><CatalogPicker :system-id="systemId" @select="addCatalogItem" /></div>
      <form v-if="customOpen" class="editor-panel" @submit.prevent="addCustomItem"><h2>Custom item</h2><label class="field-label" for="custom-item-name">Name</label><input id="custom-item-name" v-model="customName" class="text-input" required maxlength="240" /><label class="field-label" for="custom-item-weight">Weight per item (optional)</label><input id="custom-item-weight" v-model="customWeight" class="text-input" type="number" min="0" step="any" placeholder="Unknown" /><label class="field-label" for="custom-item-notes">Notes</label><textarea id="custom-item-notes" v-model="customNotes" class="text-area" /><div class="form-actions"><button class="secondary-button" type="button" @click="customOpen = false">Cancel</button><button class="primary-button" type="submit">Add item</button></div></form>
      <div v-if="items.length" class="inventory-list"><article v-for="item in items" :key="item.id" class="inventory-row"><div class="inventory-item-copy"><strong>{{ item.name }}</strong><small>{{ item.weight > 0 ? `${item.weight} lb each` : 'Weight unknown' }}<template v-if="item.expand?.catalog_item"> · {{ item.expand.catalog_item.source }}</template></small><p v-if="item.notes && editing !== item.id" class="inventory-notes">{{ item.notes }}</p></div><template v-if="editing === item.id"><div class="inventory-edit"><label class="filter-field">Quantity<input v-model.number="quantityDraft" class="text-input" type="number" min="1" step="1" /></label><label class="filter-field">Item notes<textarea v-model="notesDraft" class="text-area" /></label><div class="row-actions"><button class="primary-button" type="button" @click="saveEdit(item)">Save</button><button class="secondary-button" type="button" @click="editing = ''">Cancel</button></div></div></template><template v-else><span class="quantity-pill">× {{ item.quantity }}</span><div class="row-actions"><button class="secondary-button" type="button" @click="startEdit(item)">Edit</button><button class="danger-button" type="button" @click="drop(item)">Drop</button></div></template></article></div>
      <div v-else-if="!pickerOpen" class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">◇</div><h2>No items yet</h2><p>Add an item from the system catalog or create a custom item. Dropping an item removes it from this inventory.</p><button class="primary-button empty-action" type="button" @click="pickerOpen = true">＋ Add catalog item</button></div>
    </template>
    <p v-else-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
  </section>
</template>
