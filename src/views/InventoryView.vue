<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import CatalogPicker from '../components/CatalogPicker.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { guardedUpdate, isConflict } from '../lib/records'
import { systemForGame } from '../lib/systems'
import { coinWeight as calculateCoinWeight, totalBalances, type Balances } from '../lib/currency'

type Character = { id: string; name: string; game: string }
type Inventory = { id: string; updated: string; game: string; character: string; capacity: number; capacity_known: boolean; balances: Record<string, number> | null }
type Stash = { id: string; updated: string; game: string; kind: 'party' | 'personal' | 'location'; name: string; location: string; notes: string; owner: string; balances: Record<string, number> | null }
type InventoryItem = { id: string; updated: string; inventory: string; stash: string; catalog_item: string; container: string; name: string; quantity: number; weight: number; weight_known: boolean; is_container: boolean; notes: string; expand?: { catalog_item?: CatalogRecord } }
const route = useRoute()
const character = ref<Character | null>(null)
const inventory = ref<Inventory | null>(null)
const items = ref<InventoryItem[]>([])
const stashes = ref<Stash[]>([])
const otherCharacters = ref<Character[]>([])
const selectedStashId = ref('')
const stashName = ref('')
const stashKind = ref<'personal' | 'location'>('personal')
const stashLocation = ref('')
const stashNotes = ref('')
const stashFormOpen = ref(false)
const editingStash = ref(false)
const movingItemId = ref('')
const transferQuantity = ref(1)
const transferTarget = ref('')
const coinTransferAmount = ref(1)
const coinTransferDenomination = ref('')
const coinTransferTarget = ref('')
const loading = ref(true)
const error = ref('')
const pickerOpen = ref(false)
const customOpen = ref(false)
const customName = ref('')
const customWeight = ref('')
const customNotes = ref('')
const customContainer = ref(false)
const editing = ref('')
const editingSnapshot = ref<InventoryItem | null>(null)
const coinSnapshot = ref<Inventory | Stash | null>(null)
const quantityDraft = ref(1)
const notesDraft = ref('')
const weightDraft = ref('')
const weightKnownDraft = ref(false)
const containerDraft = ref(false)
const parentDraft = ref('')
const capacityDraft = ref('')
const coins = ref<Balances>({})
const game = ref<{ system: string; expand?: { system?: { key: string } } } | null>(null)
const systemId = computed(() => game.value?.system ?? '')
const currency = computed(() => systemForGame(game.value).currency)
const denominations = computed(() => currency.value.denominations)
const unsupportedBalances = computed(() => Object.entries(coins.value).filter(([key, value]) => value !== 0 && !denominations.value.some((entry) => entry.key === key)))
const weightUnit = computed(() => currency.value.weightUnit ?? 'units')
const activeStash = computed(() => stashes.value.find((entry) => entry.id === selectedStashId.value) ?? null)
const activeStoreLabel = computed(() => activeStash.value?.name ?? 'Carried inventory')
const displayedCoinWeight = computed(() => calculateCoinWeight(coins.value, currency.value))
const partyTotal = ref<Balances>({})
const transferTargets = computed(() => [
  ...(inventory.value && !activeStash.value ? [] : inventory.value ? [{ key: `inventory:${inventory.value.id}`, name: `${character.value?.name}’s inventory` }] : []),
  ...otherCharacters.value.map((entry) => ({ key: `character:${entry.id}`, name: `${entry.name}’s inventory` })),
  ...stashes.value.filter((stash) => stash.id !== activeStash.value?.id).map((stash) => ({ key: `stash:${stash.id}`, name: `${stash.name} (${stash.kind})` })),
])

const subscriptions = ref<Array<() => Promise<void>>>([])
let inventoryGeneration = 0
let subscriptionGeneration = 0
onMounted(async () => {
  await load()
  await subscribe()
  window.addEventListener('olea-reconnected', refreshAfterReconnect)
  window.addEventListener('focus', refreshAfterReconnect)
})
onUnmounted(() => {
  subscriptionGeneration++
  window.removeEventListener('olea-reconnected', refreshAfterReconnect)
  window.removeEventListener('focus', refreshAfterReconnect)
  for (const stop of subscriptions.value) void stop()
})
async function subscribe() {
  const generation = ++subscriptionGeneration
  for (const stop of subscriptions.value) void stop()
  subscriptions.value = []
  if (!character.value) return
  try {
    const stops = await Promise.all(['inventory_items', 'inventories', 'stashes'].map((collection) => pb.collection(collection).subscribe('*', () => {
      void refreshLiveInventory()
    })))
    if (generation !== subscriptionGeneration) { for (const stop of stops) void stop(); return }
    subscriptions.value = stops
  } catch { error.value = 'Live updates are unavailable. Refresh to see current inventory data.' }
}
async function refreshAfterReconnect() { await refreshLiveInventory(); await subscribe() }
async function refreshLiveInventory() {
  if (!character.value || !inventory.value) return
  try {
    inventory.value = await pb.collection('inventories').getOne<Inventory>(inventory.value.id, { requestKey: null })
    await loadStashes()
    await loadItems()
    if (!coinSnapshot.value) {
      const store = activeStash.value ?? inventory.value
      coins.value = storeBalances(store)
    }
  } catch { error.value = 'Live inventory could not be refreshed. Check the connection.' }
}
watch(selectedStashId, () => {
  const store = activeStash.value ?? inventory.value
  coins.value = storeBalances(store)
  editing.value = ''; editingSnapshot.value = null; coinSnapshot.value = null; movingItemId.value = ''; coinTransferTarget.value = ''; editingStash.value = false
  void loadItems().catch(() => { error.value = 'Items could not be loaded.' })
})

async function load() {
  const generation = ++inventoryGeneration
  loading.value = true
  error.value = ''
  try {
    character.value = await pb.collection('characters').getOne<Character>(String(route.params.characterId))
    if (generation !== inventoryGeneration) return
    game.value = await pb.collection('games').getOne<{ system: string; expand?: { system?: { key: string } } }>(character.value.game, { expand: 'system' })
    if (!denominations.value.some((entry) => entry.key === coinTransferDenomination.value)) coinTransferDenomination.value = denominations.value[0]?.key ?? ''
    otherCharacters.value = await pb.collection('characters').getFullList<Character>({ filter: pb.filter('game = {:game} && id != {:id}', { game: character.value.game, id: character.value.id }), sort: 'name' })
    const found = await pb.collection('inventories').getFullList<Inventory>({ filter: pb.filter('character = {:character}', { character: character.value.id }), perPage: 2 })
    inventory.value = found[0] ?? await ensureInventory(character.value.id)
    if (generation !== inventoryGeneration) return
    capacityDraft.value = inventory.value.capacity_known ? String(inventory.value.capacity) : ''
    coins.value = storeBalances(inventory.value)
    await loadStashes()
    const activeStore = activeStash.value ?? inventory.value
    coins.value = storeBalances(activeStore)
    await loadItems()
  } catch {
    error.value = 'Inventory could not be loaded. Check the local server and try again.'
  } finally { if (generation === inventoryGeneration) loading.value = false }
}

let itemLoadToken = 0
async function loadItems() {
  if (!inventory.value) return
  const token = ++itemLoadToken
  const result = await pb.collection('inventory_items').getFullList<InventoryItem>({
    filter: activeStash.value
      ? pb.filter('stash = {:stash}', { stash: activeStash.value.id })
      : pb.filter('inventory = {:inventory}', { inventory: inventory.value.id }), sort: 'name', expand: 'catalog_item', requestKey: null,
  })
  if (token === itemLoadToken) items.value = result
}

async function ensureInventory(characterId: string): Promise<Inventory> {
  const find = () => pb.collection('inventories').getFirstListItem<Inventory>(pb.filter('character = {:id}', { id: characterId }))
  try { return await find() } catch (cause) {
    if ((cause as { status?: number }).status !== 404) throw cause
  }
  try { return await pb.collection('inventories').create<Inventory>({ game: character.value!.game, character: characterId }) }
  catch (cause) {
    try { return await find() } catch { throw cause }
  }
}

async function loadStashes() {
  if (!character.value) return
  stashes.value = await pb.collection('stashes').getFullList<Stash>({ filter: pb.filter('game = {:game}', { game: character.value.game }), sort: 'kind,name' })
  if (!stashes.value.some((entry) => entry.kind === 'party')) {
    try { await pb.collection('stashes').create({ game: character.value.game, kind: 'party', name: 'Party stash' }) } catch { /* Another client may have created it. */ }
    stashes.value = await pb.collection('stashes').getFullList<Stash>({ filter: pb.filter('game = {:game}', { game: character.value.game }), sort: 'kind,name' })
  }
  stashes.value = stashes.value.filter((entry) => entry.kind !== 'personal' || entry.owner === character.value?.id)
  await refreshPartyTotal()
}

async function refreshPartyTotal() {
  if (!character.value) return
  try {
    const [inventories, party] = await Promise.all([
      pb.collection('inventories').getFullList<Inventory>({ filter: pb.filter('game = {:game} && character != ""', { game: character.value.game }), fields: 'balances' }),
      pb.collection('stashes').getFirstListItem<Stash>(pb.filter('game = {:game} && kind = "party"', { game: character.value.game }), { fields: 'balances' }),
    ])
    partyTotal.value = totalBalances([party.balances, ...inventories.map((entry) => entry.balances)])
  } catch { /* Party total is secondary to the active inventory view. */ }
}

async function createStash() {
  if (!character.value || !stashName.value.trim()) return
  try {
    const data: Record<string, string> = { game: character.value.game, kind: stashKind.value, name: stashName.value.trim(), location: stashLocation.value.trim(), notes: stashNotes.value }
    if (stashKind.value === 'personal') data.owner = character.value.id
    const record = await pb.collection('stashes').create<Stash>(data)
    stashes.value.push(record)
    selectedStashId.value = record.id
    stashName.value = ''; stashLocation.value = ''; stashNotes.value = ''; stashFormOpen.value = false
    await loadItems()
  } catch { error.value = 'The stash could not be created.' }
}

function beginEditStash() {
  if (!activeStash.value) return
  stashName.value = activeStash.value.name
  stashLocation.value = activeStash.value.location ?? ''
  stashNotes.value = activeStash.value.notes ?? ''
  editingStash.value = true
}

async function saveStash() {
  if (!activeStash.value || !stashName.value.trim()) return
  try {
    const updated = await pb.collection('stashes').update<Stash>(activeStash.value.id, { name: stashName.value.trim(), location: stashLocation.value.trim(), notes: stashNotes.value })
    stashes.value = stashes.value.map((stash) => stash.id === updated.id ? updated : stash)
    editingStash.value = false
  } catch { error.value = 'The stash could not be updated.' }
}

async function deleteStash() {
  const stash = activeStash.value
  if (!stash || stash.kind === 'party' || !window.confirm(`Delete “${stash.name}” and all its items and coins? This cannot be undone.`)) return
  try {
    await pb.collection('stashes').delete(stash.id)
    selectedStashId.value = ''
    await loadStashes()
  } catch { error.value = 'The stash could not be deleted.' }
}

async function addCatalogItem(record: CatalogRecord) {
  if (!inventory.value) return
  try {
    const systemWeight = systemForGame(game.value).inventory.catalogWeight(record)
    const weight = { value: systemWeight ?? 0, known: systemWeight !== null }
    await pb.collection('inventory_items').create(activeStash.value ? { stash: activeStash.value.id, catalog_item: record.id, name: record.name, quantity: 1, weight: weight.value, weight_known: weight.known, is_container: false, notes: '' } : { inventory: inventory.value.id, catalog_item: record.id, name: record.name, quantity: 1, weight: weight.value, weight_known: weight.known, is_container: false, notes: '' })
    pickerOpen.value = false
    await loadItems()
  } catch { error.value = 'The item could not be added.' }
}

async function addCustomItem() {
  if (!inventory.value || !customName.value.trim()) return
  const weight = customWeight.value.trim() ? Number(customWeight.value) : 0
  if (!Number.isFinite(weight) || weight < 0) { error.value = 'Weight must be zero or a positive number.'; return }
  try {
    const itemData = { name: customName.value.trim(), quantity: 1, weight, weight_known: customWeight.value.trim() !== '', is_container: customContainer.value, notes: customNotes.value }
    await pb.collection('inventory_items').create(activeStash.value ? { ...itemData, stash: activeStash.value.id } : { ...itemData, inventory: inventory.value.id })
    customName.value = ''; customWeight.value = ''; customNotes.value = ''; customOpen.value = false; customContainer.value = false
    await loadItems()
  } catch { error.value = 'The custom item could not be added.' }
}

function startEdit(item: InventoryItem) { editing.value = item.id; editingSnapshot.value = { ...item }; quantityDraft.value = item.quantity; notesDraft.value = item.notes ?? ''; weightDraft.value = item.weight_known ? String(item.weight) : ''; weightKnownDraft.value = item.weight_known; containerDraft.value = item.is_container; parentDraft.value = item.container ?? '' }
async function saveEdit(item: InventoryItem) {
  if (!Number.isInteger(quantityDraft.value) || quantityDraft.value < 1) { error.value = 'Quantity must be a whole number greater than zero.'; return }
  if ((containerDraft.value || childCount(item) > 0) && quantityDraft.value !== 1) { error.value = 'Containers and items holding contents must have quantity one.'; return }
  if (!containerDraft.value && childCount(item) > 0) { error.value = 'Move the contents out before changing this container into an ordinary item.'; return }
  const weight = weightDraft.value.trim() ? Number(weightDraft.value) : 0
  if (!Number.isFinite(weight) || weight < 0) { error.value = 'Weight must be zero or a positive number.'; return }
  if (parentDraft.value && (parentDraft.value === item.id || isDescendant(parentDraft.value, item.id))) { error.value = 'A container cannot be moved inside itself or one of its contents.'; return }
  if (parentDraft.value && !items.value.find((entry) => entry.id === parentDraft.value)?.is_container) { error.value = 'Choose a container as the destination.'; return }
  try { await guardedUpdate('inventory_items', editingSnapshot.value ?? item, { quantity: quantityDraft.value, notes: notesDraft.value, weight, weight_known: weightKnownDraft.value, is_container: containerDraft.value, container: parentDraft.value }); editing.value = ''; editingSnapshot.value = null; await loadItems() }
  catch (cause) { await loadItems(); error.value = isConflict(cause) ? 'This item changed or moved elsewhere. Current contents were refreshed; review before editing again.' : 'The item could not be updated.' }
}
async function drop(item: InventoryItem) {
  if (childCount(item) > 0) { error.value = 'Move the contents out before dropping this container.'; return }
  try { await pb.collection('inventory_items').delete(item.id); await loadItems() }
  catch { error.value = 'The item could not be dropped.' }
}
function beginMove(item: InventoryItem) {
  movingItemId.value = item.id
  transferQuantity.value = item.quantity
  transferTarget.value = transferTargets.value[0]?.key ?? ''
}
async function endpoint(value: string) {
  const [kind, id] = value.split(':', 2)
  if (kind === 'character') return { inventory: (await ensureInventory(id)).id }
  return kind === 'inventory' ? { inventory: id } : { stash: id }
}
function currentEndpoint() { return activeStash.value ? { stash: activeStash.value.id } : { inventory: inventory.value?.id ?? '' } }
async function transferItem(item: InventoryItem) {
  if (!transferTarget.value || !Number.isInteger(transferQuantity.value) || transferQuantity.value < 1) { error.value = 'Choose a destination and a positive whole quantity.'; return }
  if (transferQuantity.value > item.quantity) { error.value = 'Transfer quantity exceeds the available stack.'; return }
  if (item.is_container && transferQuantity.value !== 1) { error.value = 'Containers cannot be split.'; return }
  try {
    await pb.send('/api/olea/transfers/item', { method: 'POST', body: { itemId: item.id, quantity: transferQuantity.value, destination: await endpoint(transferTarget.value) } })
    movingItemId.value = ''; await loadItems(); await refreshPartyTotal()
  } catch (cause) { error.value = transferError(cause, 'The item could not be transferred.') }
}
async function transferCoins() {
  if (!coinTransferTarget.value || !Number.isInteger(coinTransferAmount.value) || coinTransferAmount.value < 1) { error.value = 'Choose a destination and a positive whole coin amount.'; return }
  try {
    await pb.send('/api/olea/transfers/coins', { method: 'POST', body: { source: currentEndpoint(), destination: await endpoint(coinTransferTarget.value), denomination: coinTransferDenomination.value, amount: coinTransferAmount.value } })
    await load(); await refreshPartyTotal()
  } catch (cause) { error.value = transferError(cause, 'Coins could not be transferred.') }
}
function transferError(cause: unknown, fallback: string): string {
  if (cause && typeof cause === 'object' && 'response' in cause) {
    const response = (cause as { response?: { message?: string } }).response
    if (response?.message) return response.message
  }
  return fallback
}
function itemWeight(item: InventoryItem, seen = new Set<string>()): number | null {
  if (seen.has(item.id)) return null
  if (!item.weight_known) return null
  const nested = new Set(seen).add(item.id)
  const children = items.value.filter((entry) => entry.container === item.id)
  const childWeights = children.map((child) => itemWeight(child, nested))
  if (childWeights.some((value) => value === null)) return null
  return item.weight * item.quantity + childWeights.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}
const carriedWeight = computed(() => {
  if (activeStash.value) return 0
  const roots = items.value.filter((item) => !item.container)
  const weights = roots.map((item) => itemWeight(item))
  return weights.some((value) => value === null) || displayedCoinWeight.value === null ? null : weights.reduce<number>((sum, value) => sum + (value ?? 0), 0) + displayedCoinWeight.value
})
function isDescendant(candidateId: string, ancestorId: string): boolean {
  let current = items.value.find((entry) => entry.id === candidateId)
  const visited = new Set<string>()
  while (current?.container && !visited.has(current.id)) {
    if (current.container === ancestorId) return true
    visited.add(current.id)
    current = items.value.find((entry) => entry.id === current?.container)
  }
  return false
}
async function saveCapacity() {
  if (!inventory.value) return
  const value = capacityDraft.value.trim() ? Number(capacityDraft.value) : 0
  if (!Number.isFinite(value) || value < 0) { error.value = 'Capacity must be zero or a positive number.'; return }
  try { await guardedUpdate('inventories', inventory.value, { capacity: value, capacity_known: capacityDraft.value.trim() !== '' }); await load() }
  catch (cause) { await load(); error.value = isConflict(cause) ? 'Inventory changed elsewhere. Current values were refreshed.' : 'Capacity could not be saved.' }
}
async function saveCoins(denomination: string) {
  if (!inventory.value) return
  if (!Number.isSafeInteger(coins.value[denomination]) || coins.value[denomination] < 0) { error.value = 'Coin balances must be nonnegative whole numbers.'; return }
  try {
    const snapshot = coinSnapshot.value ?? activeStash.value ?? inventory.value
    const update = { balances: { ...(snapshot.balances ?? {}), [denomination]: coins.value[denomination] } }
    if (coinSnapshot.value && coinSnapshot.value.id !== (activeStash.value ?? inventory.value).id) throw new Error('The active store changed.')
    if (activeStash.value) {
      await guardedUpdate('stashes', coinSnapshot.value?.id === activeStash.value.id ? coinSnapshot.value : activeStash.value, update)
      await load()
      await refreshPartyTotal()
    }
    else { await guardedUpdate('inventories', coinSnapshot.value?.id === inventory.value.id ? coinSnapshot.value : inventory.value, update); await load() }
    if (!activeStash.value) await refreshPartyTotal()
  }
  catch (cause) { await load(); error.value = isConflict(cause) ? 'Coin balance changed elsewhere. Current balances were refreshed.' : 'Coin balances could not be saved.' }
  finally { coinSnapshot.value = null }
}
function beginCoinEdit() { const store = activeStash.value ?? inventory.value; coinSnapshot.value = store ? { ...store } : null }
function storeBalances(store: Inventory | Stash | null): Balances { return { ...(store?.balances ?? {}), ...Object.fromEntries(denominations.value.filter((entry) => store?.balances?.[entry.key] === undefined).map((entry) => [entry.key, 0])) } }
function childCount(item: InventoryItem): number { return items.value.filter((entry) => entry.container === item.id).length }
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading inventory…</div>
    <template v-else-if="character">
      <RouterLink class="text-link" :to="{ name: 'character-overview', params: { characterId: character.id } }">← {{ character.name }}</RouterLink>
      <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> CHARACTER INVENTORY</p><h1 id="page-title">{{ character.name }}’s items</h1><p class="screen-description">Items and quantities carried by this character.</p></div><div class="heading-actions"><button class="primary-button" type="button" @click="pickerOpen = !pickerOpen">＋ Add catalog item</button><button class="secondary-button" type="button" @click="customOpen = !customOpen">Custom item</button></div></div>
      <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
      <section v-if="!activeStash" class="weight-summary" aria-label="Carried weight"><div><strong>Carried weight</strong><small>{{ carriedWeight === null ? 'Unknown — an item or coin weight is unknown' : `${carriedWeight.toFixed(2)} ${weightUnit}` }}</small></div><div v-if="inventory" class="capacity-editor"><label class="filter-field" for="carrying-capacity">Capacity ({{ weightUnit }})<input id="carrying-capacity" v-model="capacityDraft" class="text-input" type="number" min="0" step="any" placeholder="Not set" @change="saveCapacity" /></label><strong v-if="inventory.capacity_known && carriedWeight !== null" :class="carriedWeight > inventory.capacity ? 'over-capacity' : 'within-capacity'">{{ carriedWeight > inventory.capacity ? 'Over capacity' : 'Within capacity' }}</strong></div></section>
      <section class="store-switcher"><label class="filter-field" for="inventory-store">View contents<select id="inventory-store" v-model="selectedStashId" class="select-input"><option value="">{{ character.name }}’s inventory</option><option v-for="stash in stashes" :key="stash.id" :value="stash.id">{{ stash.name }} ({{ stash.kind }})</option></select></label><button class="secondary-button" type="button" @click="stashKind = 'personal'; stashFormOpen = !stashFormOpen">＋ Personal stash</button><button class="secondary-button" type="button" @click="stashKind = 'location'; stashFormOpen = !stashFormOpen">＋ GM location stash</button></section>
      <p v-if="activeStash?.location || activeStash?.notes" class="stash-notes"><strong v-if="activeStash.location">{{ activeStash.location }}</strong>{{ activeStash.notes }}</p>
      <div v-if="activeStash && !editingStash" class="row-actions"><button class="secondary-button" type="button" @click="beginEditStash">Edit stash</button><button v-if="activeStash.kind !== 'party'" class="danger-button" type="button" @click="deleteStash">Delete stash</button></div>
      <form v-if="editingStash" class="editor-panel" @submit.prevent="saveStash"><h2>Edit stash</h2><label class="field-label" for="edit-stash-name">Name</label><input id="edit-stash-name" v-model="stashName" class="text-input" required maxlength="160" /><label class="field-label" for="edit-stash-location">Location (optional)</label><input id="edit-stash-location" v-model="stashLocation" class="text-input" maxlength="500" /><label class="field-label" for="edit-stash-notes">Notes (optional)</label><textarea id="edit-stash-notes" v-model="stashNotes" class="text-area" /><div class="form-actions"><button class="secondary-button" type="button" @click="editingStash = false">Cancel</button><button class="primary-button" type="submit">Save stash</button></div></form>
      <form v-if="stashFormOpen" class="editor-panel" @submit.prevent="createStash"><h2>{{ stashKind === 'personal' ? 'Personal stash' : 'GM location stash' }}</h2><label class="field-label" for="stash-name">Name</label><input id="stash-name" v-model="stashName" class="text-input" required maxlength="160" :placeholder="stashKind === 'personal' ? 'My pack at the inn' : 'Town armory'" /><label class="field-label" for="stash-location">Location (optional)</label><input id="stash-location" v-model="stashLocation" class="text-input" maxlength="500" /><label class="field-label" for="stash-notes">Notes (optional)</label><textarea id="stash-notes" v-model="stashNotes" class="text-area" /><div class="form-actions"><button class="secondary-button" type="button" @click="stashFormOpen = false">Cancel</button><button class="primary-button" type="submit">Create stash</button></div></form>
      <section class="currency-panel"><div><h2>{{ activeStoreLabel }} · Currency</h2><p>Coin weight: {{ displayedCoinWeight === null ? 'Unknown; enter or track manually' : `${displayedCoinWeight.toFixed(2)} ${weightUnit}` }}</p><p v-if="!denominations.length">Currency rules are not configured for this system.</p><p v-if="!activeStash && Object.keys(partyTotal).length">Party total (characters + party stash): <span v-for="(amount, key) in partyTotal" :key="key">{{ amount }} {{ denominations.find((entry) => entry.key === key)?.label ?? key }} · </span></p><p v-if="unsupportedBalances.length">Retained unsupported balances: <span v-for="[key, amount] in unsupportedBalances" :key="key">{{ amount }} {{ key }} · </span></p></div><div class="coin-fields"><label v-for="denomination in denominations" :key="denomination.key" class="filter-field">{{ denomination.label }}<input v-model.number="coins[denomination.key]" class="text-input" type="number" min="0" step="1" @focus="beginCoinEdit" @change="saveCoins(denomination.key)" /></label></div><div v-if="transferTargets.length && denominations.length" class="coin-transfer"><label class="filter-field">Transfer denomination<select v-model="coinTransferDenomination" class="select-input"><option v-for="denomination in denominations" :key="denomination.key" :value="denomination.key">{{ denomination.label }}</option></select></label><label class="filter-field">Amount<input v-model.number="coinTransferAmount" class="text-input" type="number" min="1" step="1" /></label><label class="filter-field">To<select v-model="coinTransferTarget" class="select-input"><option value="">Choose a store</option><option v-for="target in transferTargets" :key="target.key" :value="target.key">{{ target.name }}</option></select></label><button class="secondary-button" type="button" @click="transferCoins">Transfer coins</button></div></section>
      <p class="muted-hint">Carried weight includes container and contents once, plus coins. Container weights are per container; items with unknown weight make the total unknown.</p>
      <div v-if="pickerOpen" class="editor-panel"><div class="catalog-panel-heading"><h2>Choose an item</h2><button class="secondary-button" type="button" @click="pickerOpen = false">Close</button></div><CatalogPicker :system-id="systemId" @select="addCatalogItem" /></div>
      <form v-if="customOpen" class="editor-panel" @submit.prevent="addCustomItem"><h2>Custom item</h2><label class="field-label" for="custom-item-name">Name</label><input id="custom-item-name" v-model="customName" class="text-input" required maxlength="240" /><label class="field-label" for="custom-item-weight">Weight per item (optional)</label><input id="custom-item-weight" v-model="customWeight" class="text-input" type="number" min="0" step="any" placeholder="Unknown" /><label class="field-label" for="custom-item-notes">Notes</label><textarea id="custom-item-notes" v-model="customNotes" class="text-area" /><label class="check-field"><input v-model="customContainer" type="checkbox" /> This item is a container</label><div class="form-actions"><button class="secondary-button" type="button" @click="customOpen = false">Cancel</button><button class="primary-button" type="submit">Add item</button></div></form>
      <div v-if="items.length" class="inventory-list"><article v-for="item in items" :key="item.id" class="inventory-row"><div class="inventory-item-copy"><strong>{{ item.container ? '↳ ' : '' }}{{ item.name }} <span v-if="item.is_container" class="container-label">Container · {{ childCount(item) }} {{ childCount(item) === 1 ? 'item' : 'items' }}</span></strong><small>{{ item.weight_known ? `${item.weight} ${weightUnit} each` : 'Weight unknown' }}<template v-if="item.expand?.catalog_item"> · {{ item.expand.catalog_item.source }}</template></small><p v-if="item.notes && editing !== item.id" class="inventory-notes">{{ item.notes }}</p></div><template v-if="editing === item.id"><div class="inventory-edit"><label class="filter-field">Quantity<input v-model.number="quantityDraft" class="text-input" type="number" min="1" step="1" /></label><label class="filter-field">Weight per item ({{ weightUnit }})<input v-model="weightDraft" class="text-input" type="number" min="0" step="any" placeholder="Unknown" @input="weightKnownDraft = weightDraft.trim() !== ''" /></label><label class="filter-field">Place inside<select v-model="parentDraft" class="select-input"><option value="">Carried outside</option><option v-for="container in items.filter((entry) => entry.is_container && entry.id !== item.id && !isDescendant(entry.id, item.id))" :key="container.id" :value="container.id">{{ container.name }}</option></select></label><label class="check-field"><input v-model="containerDraft" type="checkbox" /> This item is a container</label><label class="filter-field">Item notes<textarea v-model="notesDraft" class="text-area" /></label><div class="row-actions"><button class="primary-button" type="button" @click="saveEdit(item)">Save</button><button class="secondary-button" type="button" @click="editing = ''">Cancel</button></div></div></template><template v-else-if="movingItemId === item.id"><div class="inventory-edit transfer-form"><label class="filter-field">Quantity<input v-model.number="transferQuantity" class="text-input" type="number" min="1" :max="item.quantity" step="1" /></label><label class="filter-field">Move to<select v-model="transferTarget" class="select-input"><option value="">Choose a store</option><option v-for="target in transferTargets" :key="target.key" :value="target.key">{{ target.name }}</option></select></label><div class="row-actions"><button class="primary-button" type="button" @click="transferItem(item)">Move item</button><button class="secondary-button" type="button" @click="movingItemId = ''">Cancel</button></div></div></template><template v-else><span class="quantity-pill">× {{ item.quantity }}</span><div class="row-actions"><button class="secondary-button" type="button" @click="startEdit(item)">Edit</button><button class="secondary-button" type="button" :disabled="!transferTargets.length" @click="beginMove(item)">Move</button><button class="danger-button" type="button" @click="drop(item)">Drop</button></div></template></article></div>
      <div v-else-if="!pickerOpen" class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">◇</div><h2>No items yet</h2><p>Add an item from the system catalog or create a custom item. Dropping an item removes it from this inventory.</p><button class="primary-button empty-action" type="button" @click="pickerOpen = true">＋ Add catalog item</button></div>
    </template>
    <p v-else-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
  </section>
</template>
