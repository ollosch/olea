<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import CatalogPicker from '../components/CatalogPicker.vue'
import EntryContent from '../components/EntryContent.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { systemByKey } from '../lib/systems'
import { isDefiniteWriteRejection } from '../lib/records'

type Character = { id: string; name: string; game: string }
type Spellbook = { id: string; character: string; name: string }
type BookSpell = { id: string; spellbook: string; spell: string; expand?: { spell?: CatalogRecord } }
const route = useRoute()
const character = ref<Character | null>(null)
const books = ref<Spellbook[]>([])
const selectedBookId = ref('')
const spells = ref<BookSpell[]>([])
const systemId = ref('')
const systemKey = ref('')
const system = computed(() => systemByKey(systemKey.value))
const newName = ref('')
const renameId = ref('')
const renameDraft = ref('')
const pickerOpen = ref(false)
const pickerPending = ref(false)
const pickerFeedback = ref<{ tone: 'status' | 'error'; message: string } | null>(null)
const loading = ref(true)
const error = ref('')
const selectedBook = computed(() => books.value.find((book) => book.id === selectedBookId.value) ?? null)
const takenSpellIds = computed(() => spells.value.map((entry) => entry.spell).filter(Boolean))
let spellLoadToken = 0

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    character.value = await pb.collection('characters').getOne<Character>(String(route.params.characterId))
    const game = await pb.collection('games').getOne<{ system: string; expand?: { system?: { key: string } } }>(character.value.game, { expand: 'system' })
    systemId.value = game.system
    systemKey.value = game.expand?.system?.key ?? ''
    await loadBooks()
    pickerPending.value = false
    pickerFeedback.value = null
  } catch { error.value = 'Spellbooks could not be loaded. Check the local server and try again.' }
  finally { loading.value = false }
}

async function loadBooks() {
  if (!character.value) return
  books.value = await pb.collection('spellbooks').getFullList<Spellbook>({ filter: pb.filter('character = {:character}', { character: character.value.id }), sort: 'name' })
  if (!selectedBookId.value || !books.value.some((book) => book.id === selectedBookId.value)) selectedBookId.value = books.value[0]?.id ?? ''
  await loadSpells()
}

async function loadSpells() {
  const token = ++spellLoadToken
  if (!selectedBookId.value) { spells.value = []; return }
  spells.value = []
  try {
    const result = await pb.collection('spellbook_spells').getFullList<BookSpell>({ filter: pb.filter('spellbook = {:book}', { book: selectedBookId.value }), sort: 'spell.name', expand: 'spell', requestKey: null })
    if (token === spellLoadToken) spells.value = result
  } catch { if (token === spellLoadToken) error.value = 'Spells in this book could not be loaded.' }
}

async function createBook() {
  if (!character.value || !newName.value.trim()) return
  try {
    const book = await pb.collection('spellbooks').create<Spellbook>({ character: character.value.id, name: newName.value.trim() })
    newName.value = ''; books.value.push(book); selectedBookId.value = book.id; await loadSpells()
  } catch { error.value = 'The spellbook could not be created.' }
}

async function renameBook(book: Spellbook) {
  if (!renameDraft.value.trim()) return
  try {
    const updated = await pb.collection('spellbooks').update<Spellbook>(book.id, { name: renameDraft.value.trim() })
    books.value = books.value.map((entry) => entry.id === book.id ? updated : entry); renameId.value = ''
  } catch { error.value = 'The spellbook could not be renamed.' }
}

async function deleteBook(book: Spellbook) {
  if (!window.confirm(`Delete “${book.name}” and its spell list?`)) return
  try { await pb.collection('spellbooks').delete(book.id); await loadBooks() }
  catch { error.value = 'The spellbook could not be deleted.' }
}

function openPicker() {
  if (!pickerPending.value) pickerFeedback.value = null
  pickerOpen.value = true
}

async function addSpell(spell: CatalogRecord) {
  if (!selectedBook.value || pickerPending.value) return
  if (spells.value.some((entry) => entry.spell === spell.id)) {
    pickerFeedback.value = { tone: 'error', message: `${spell.name} is already in ${selectedBook.value.name}. Choose another spell.` }
    return
  }
  pickerPending.value = true
  pickerFeedback.value = { tone: 'status', message: `Adding ${spell.name}…` }
  try {
    await pb.collection('spellbook_spells').create({ spellbook: selectedBook.value.id, spell: spell.id })
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      pickerFeedback.value = { tone: 'error', message: `Could not confirm whether ${spell.name} was added because the connection failed. Refresh this screen before trying again; it may already be saved.` }
      error.value = `Could not confirm whether ${spell.name} was added. Refresh before trying again.`
      return
    }
    pickerPending.value = false
    pickerFeedback.value = { tone: 'error', message: `${spell.name} was not added. Check the connection and try again; a spell can only be added once per book.` }
    error.value = 'The spell could not be added.'
    return
  }
  pickerFeedback.value = { tone: 'status', message: `Added ${spell.name}. Refreshing the spell list…` }
  error.value = ''
  await loadSpells()
  if (error.value) {
    pickerFeedback.value = { tone: 'error', message: `${spell.name} was added, but the spell list could not refresh. Refresh this screen before adding anything else.` }
    error.value = `${spell.name} was added, but the spell list could not refresh. Refresh to see it.`
    return
  }
  pickerPending.value = false
  pickerFeedback.value = null
  pickerOpen.value = false
}

async function removeSpell(entry: BookSpell) {
  try { await pb.collection('spellbook_spells').delete(entry.id); await loadSpells() }
  catch { error.value = 'The spell could not be removed.' }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading spellbooks…</div>
    <template v-else-if="character">
      <RouterLink class="text-link" :to="{ name: 'character-overview', params: { characterId: character.id } }">← {{ character.name }}</RouterLink>
      <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> SPELLBOOKS</p><h1 id="page-title">{{ character.name }}’s books</h1><p class="screen-description">Keep multiple named spell collections for this character. Spell details use the game’s system catalog.</p></div></div>
      <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
      <div class="spellbook-layout">
        <aside class="spellbook-sidebar"><form class="spellbook-create" @submit.prevent="createBook"><label class="field-label" for="new-spellbook">New spellbook</label><input id="new-spellbook" v-model="newName" class="text-input" maxlength="160" placeholder="Name this book" required /><button class="primary-button" type="submit">＋ Create</button></form><button v-for="book in books" :key="book.id" class="spellbook-tab" :class="{ selected: book.id === selectedBookId }" type="button" @click="selectedBookId = book.id; loadSpells()">{{ book.name }}</button></aside>
         <div class="spellbook-content"><template v-if="selectedBook"><div class="spellbook-heading"><div><template v-if="renameId === selectedBook.id"><label class="field-label" :for="`rename-${selectedBook.id}`">Book name</label><input :id="`rename-${selectedBook.id}`" v-model="renameDraft" class="text-input" maxlength="160" /></template><h2 v-else>{{ selectedBook.name }}</h2></div><div class="row-actions"><template v-if="renameId === selectedBook.id"><button class="primary-button" type="button" @click="renameBook(selectedBook)">Save name</button><button class="secondary-button" type="button" @click="renameId = ''">Cancel</button></template><template v-else><button class="secondary-button" type="button" @click="renameId = selectedBook.id; renameDraft = selectedBook.name">Rename</button><button class="danger-button" type="button" @click="deleteBook(selectedBook)">Delete book</button></template><RouterLink v-if="spells.some((entry) => entry.expand?.spell)" class="secondary-link" :to="{ name: 'print-spellbook', params: { characterId: character.id, spellbookId: selectedBook.id } }">Print cards</RouterLink><button class="primary-button" type="button" @click="openPicker">＋ Add spell</button></div></div>
          <div v-if="spells.length" class="spell-list"><article v-for="entry in spells" :key="entry.id" class="spell-entry"><div class="spell-entry-heading"><div><h3>{{ entry.expand?.spell?.name ?? 'Unknown spell' }}</h3><small v-if="entry.expand?.spell">{{ system.catalog.resultLabel(entry.expand.spell) }}</small></div><button class="danger-button" type="button" @click="removeSpell(entry)">Remove</button></div><EntryContent v-if="entry.expand?.spell" :value="system.catalog.description(entry.expand.spell)" /></article></div>
          <div v-else class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">✧</div><h2>No spells in this book</h2><p>Add spells from the game’s filtered catalog.</p><button class="primary-button empty-action" type="button" @click="openPicker">＋ Add spell</button></div>
        </template><div v-else class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">✧</div><h2>Create a spellbook</h2><p>A character can keep any number of separate named spellbooks.</p></div></div>
      </div>
    </template>
    <p v-else-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
    <CatalogPicker v-model:open="pickerOpen" :system-id="systemId" type="spell" title="Choose a spell" :pending="pickerPending" :taken-ids="takenSpellIds" taken-label="Already in this book" :feedback="pickerFeedback" @select="addSpell" />
  </section>
</template>
