<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ActionMenu from '../components/ActionMenu.vue'
import ActionMenuItem from '../components/ActionMenuItem.vue'
import CatalogPicker from '../components/CatalogPicker.vue'
import EntryContent from '../components/EntryContent.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { systemByKey } from '../lib/systems'
import { isDefiniteWriteRejection } from '../lib/records'
import { matchesSpellbookQuery, type SpellbookEntry } from '../lib/spellbook'
import { prepareSpellbookPrintReturn, rememberSpellbookPrintReturn, type SpellbookPrintRestore } from '../composables/useSpellbookPrintReturn'

type Character = { id: string; name: string; game: string }
type Spellbook = { id: string; character: string; name: string }
type BookSpell = SpellbookEntry & { spellbook: string }

const route = useRoute()
const router = useRouter()
const character = ref<Character | null>(null)
const books = ref<Spellbook[]>([])
const selectedBookId = ref('')
const loadedBookId = ref('')
const spells = ref<BookSpell[]>([])
const spellsLoading = ref(false)
const systemId = ref('')
const systemKey = ref('')
const system = computed(() => systemByKey(systemKey.value))
const newName = ref('')
const createPending = ref(false)
const renameId = ref('')
const renameDraft = ref('')
const renamePending = ref(false)
const deletePending = ref(false)
const bookWriteUncertain = ref(false)
const spellQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const expandedSpellId = ref('')
const removePendingIds = ref<Set<string>>(new Set())
const removeUncertainIds = ref<Set<string>>(new Set())
const pickerOpen = ref(false)
const pickerPending = ref(false)
const pickerFeedback = ref<{ tone: 'status' | 'error'; message: string } | null>(null)
const loading = ref(true)
const error = ref('')
const selectedBook = computed(() => books.value.find((book) => book.id === selectedBookId.value) ?? null)
const takenSpellIds = computed(() => spells.value.map((entry) => entry.spell).filter(Boolean))
const filteredSpells = computed(() => spells.value.filter((entry) => matchesSpellbookQuery(entry, system.value, spellQuery.value)))
const searchActive = computed(() => spellQuery.value.trim() !== '')
const currentSpellsReady = computed(() => Boolean(selectedBookId.value) && loadedBookId.value === selectedBookId.value && !spellsLoading.value)
const printAvailable = computed(() => currentSpellsReady.value && spells.value.some((entry) => entry.expand?.spell))
const renameDirty = computed(() => {
  const book = books.value.find((entry) => entry.id === renameId.value)
  return Boolean(book && renameDraft.value.trim() !== book.name)
})
const bookWritePending = computed(() => createPending.value || renamePending.value || deletePending.value)
const removeUncertain = computed(() => removeUncertainIds.value.size > 0)
const unsettledWrite = computed(() => pickerPending.value || removePendingIds.value.size > 0 || removeUncertain.value || bookWritePending.value || bookWriteUncertain.value)
const bookSwitchingBlocked = computed(() => unsettledWrite.value || (Boolean(renameId.value) && renameDirty.value))
const bookSwitchMessage = computed(() => {
  if (pickerPending.value) return 'Wait for the current add attempt to finish before switching books.'
  if (removePendingIds.value.size) return 'Wait for the current removal to finish before switching books.'
  if (removeUncertain.value) return 'Refresh this screen to confirm the last removal before switching books.'
  if (bookWriteUncertain.value) return 'Refresh this screen to confirm the last book change before switching books.'
  if (bookWritePending.value) return 'Wait for the current book change to finish before switching books.'
  if (bookSwitchingBlocked.value) return 'Save or cancel the book name before switching books.'
  return ''
})
const bookFormBlocked = computed(() => bookWritePending.value || bookWriteUncertain.value || bookSwitchingBlocked.value)
const spellActionsBlocked = computed(() => unsettledWrite.value || !currentSpellsReady.value)
let spellLoadToken = 0
let printRestore: SpellbookPrintRestore | null = null

onMounted(async () => {
  const characterId = String(route.params.characterId ?? '')
  const returnBookId = String(route.query.book ?? '')
  if (returnBookId) printRestore = prepareSpellbookPrintReturn(characterId, returnBookId)
  const loaded = await load()
  if (loaded) {
    await nextTick()
    printRestore?.restore()
  } else printRestore?.cancel()
  printRestore = null
})

onUnmounted(() => {
  spellLoadToken++
  printRestore?.cancel()
  printRestore = null
})

watch(() => [String(route.query.book ?? ''), String(route.name ?? '')] as const, ([requested, name]) => {
  if (name !== 'character-spellbooks' || !books.value.length) return
  if (!requested) {
    if (selectedBookId.value !== books.value[0]?.id) {
      if (bookSwitchingBlocked.value) {
        error.value = bookSwitchMessage.value
        replaceBookQuery(selectedBookId.value)
        return
      }
      applyBook(books.value[0]?.id ?? '', false)
    }
    return
  }
  if (requested === selectedBookId.value) return
  if (!books.value.some((book) => book.id === requested)) {
    replaceBookQuery(selectedBookId.value)
    return
  }
  if (bookSwitchingBlocked.value) {
    error.value = bookSwitchMessage.value
    replaceBookQuery(selectedBookId.value)
    return
  }
  applyBook(requested, false)
})

watch(spellQuery, () => {
  if (expandedSpellId.value && !filteredSpells.value.some((entry) => entry.id === expandedSpellId.value)) expandedSpellId.value = ''
})

async function load(): Promise<boolean> {
  loading.value = true
  error.value = ''
  try {
    character.value = await pb.collection('characters').getOne<Character>(String(route.params.characterId))
    const game = await pb.collection('games').getOne<{ system: string; expand?: { system?: { key: string } } }>(character.value.game, { expand: 'system' })
    systemId.value = game.system
    systemKey.value = game.expand?.system?.key ?? ''
    if (!await loadBooks()) return false
    pickerPending.value = false
    pickerOpen.value = false
    pickerFeedback.value = null
    bookWriteUncertain.value = false
    removeUncertainIds.value = new Set()
    removePendingIds.value = new Set()
    if (renameId.value) {
      const book = books.value.find((entry) => entry.id === renameId.value)
      if (!book || book.name === renameDraft.value.trim()) cancelRename()
    }
    return true
  } catch {
    error.value = 'Spellbooks could not be loaded. Check the local server and try again.'
    return false
  } finally { loading.value = false }
}

async function loadBooks(): Promise<boolean> {
  if (!character.value) return false
  try {
    books.value = await pb.collection('spellbooks').getFullList<Spellbook>({ filter: pb.filter('character = {:character}', { character: character.value.id }), sort: 'name' })
  } catch {
    error.value = 'Spellbooks could not be loaded. Check the local server and try again.'
    return false
  }
  const requested = String(route.query.book ?? '')
  if (!books.value.some((book) => book.id === selectedBookId.value)) {
    const requestedBook = books.value.find((book) => book.id === requested)
    selectedBookId.value = requestedBook?.id ?? books.value[0]?.id ?? ''
    spellQuery.value = ''
    expandedSpellId.value = ''
    loadedBookId.value = ''
    spells.value = []
  }
  if (requested && requested !== selectedBookId.value) replaceBookQuery(selectedBookId.value)
  return await loadSpells(selectedBookId.value)
}

async function loadSpells(bookId = selectedBookId.value): Promise<boolean> {
  const token = ++spellLoadToken
  const switching = bookId !== loadedBookId.value
  if (switching) {
    spells.value = []
    expandedSpellId.value = ''
  }
  spellsLoading.value = Boolean(bookId)
  if (!bookId) {
    loadedBookId.value = ''
    spellsLoading.value = false
    return true
  }
  try {
    const result = await pb.collection('spellbook_spells').getFullList<BookSpell>({ filter: pb.filter('spellbook = {:book}', { book: bookId }), sort: 'spell.name', expand: 'spell', requestKey: null })
    if (token !== spellLoadToken || selectedBookId.value !== bookId) return false
    spells.value = result
    loadedBookId.value = bookId
    if (expandedSpellId.value && !result.some((entry) => entry.id === expandedSpellId.value)) expandedSpellId.value = ''
    return true
  } catch {
    if (token === spellLoadToken && selectedBookId.value === bookId) {
      spells.value = []
      loadedBookId.value = ''
      error.value = 'Spells in this book could not be loaded.'
    }
    return false
  } finally {
    if (token === spellLoadToken) spellsLoading.value = false
  }
}

function applyBook(id: string, updateUrl: boolean) {
  const next = books.value.some((book) => book.id === id) ? id : books.value[0]?.id ?? ''
  if (next !== selectedBookId.value) {
    // Change the heading and clear the old rows in the same tick; a slow result for the
    // previous book is invalidated by the new load token and can never be committed here.
    selectedBookId.value = next
    loadedBookId.value = ''
    spells.value = []
    spellsLoading.value = Boolean(next)
    error.value = ''
    spellQuery.value = ''
    expandedSpellId.value = ''
    renameId.value = ''
    renameDraft.value = ''
    void loadSpells(next)
  }
  if (updateUrl) {
    if (next) replaceBookQuery(next)
    else clearBookQuery()
  }
}

function selectBook(id: string) {
  if (id === selectedBookId.value) return
  if (bookSwitchingBlocked.value) {
    error.value = bookSwitchMessage.value
    return
  }
  applyBook(id, true)
}

function replaceBookQuery(id: string) {
  if (String(route.query.book ?? '') === id) return
  const query = { ...route.query }
  if (id) query.book = id
  else delete query.book
  void router.replace({ query })
}

function clearBookQuery() {
  if (!route.query.book) return
  const query = { ...route.query }
  delete query.book
  void router.replace({ query })
}

function clearSpellSearch() {
  spellQuery.value = ''
  expandedSpellId.value = ''
  void nextTick(() => searchInput.value?.focus({ preventScroll: true }))
}

function detailId(entry: BookSpell) {
  return `spell-detail-${entry.id}`
}

function isExpanded(entry: BookSpell) {
  return expandedSpellId.value === entry.id
}

function toggleSpell(entry: BookSpell) {
  expandedSpellId.value = isExpanded(entry) ? '' : entry.id
}

function beginRename(book: Spellbook | null) {
  if (!book || bookWritePending.value || bookWriteUncertain.value) return
  renameId.value = book.id
  renameDraft.value = book.name
  error.value = ''
}

function cancelRename() {
  renameId.value = ''
  renameDraft.value = ''
}

async function createBook() {
  if (!character.value || !newName.value.trim() || bookWritePending.value || bookWriteUncertain.value || bookSwitchingBlocked.value) return
  createPending.value = true
  error.value = ''
  try {
    const book = await pb.collection('spellbooks').create<Spellbook>({ character: character.value.id, name: newName.value.trim() })
    newName.value = ''
    books.value = [...books.value, book].sort((left, right) => left.name.localeCompare(right.name))
    selectedBookId.value = book.id
    loadedBookId.value = ''
    spells.value = []
    spellQuery.value = ''
    expandedSpellId.value = ''
    renameId.value = ''
    renameDraft.value = ''
    const loaded = await loadSpells(book.id)
    replaceBookQuery(book.id)
    if (!loaded) error.value = 'The spellbook was created, but its spell list could not load. Refresh this screen.'
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      bookWriteUncertain.value = true
      error.value = 'Could not confirm whether the spellbook was created because the connection failed. Refresh this screen before trying again; it may already be saved.'
      return
    }
    error.value = 'The spellbook could not be created.'
  } finally { createPending.value = false }
}

async function renameBook() {
  const book = books.value.find((entry) => entry.id === renameId.value)
  const name = renameDraft.value.trim()
  if (!book || !name || renamePending.value || bookWriteUncertain.value) return
  if (name === book.name) { cancelRename(); return }
  renamePending.value = true
  error.value = ''
  try {
    const updated = await pb.collection('spellbooks').update<Spellbook>(book.id, { name })
    books.value = books.value.map((entry) => entry.id === book.id ? updated : entry).sort((left, right) => left.name.localeCompare(right.name))
    cancelRename()
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      bookWriteUncertain.value = true
      error.value = `Could not confirm whether “${book.name}” was renamed because the connection failed. Refresh this screen before trying again; the new name may already be saved.`
      return
    }
    error.value = 'The spellbook could not be renamed.'
  } finally { renamePending.value = false }
}

async function deleteBook(book: Spellbook | null) {
  if (!book || deletePending.value || bookWritePending.value || bookWriteUncertain.value || bookSwitchingBlocked.value) return
  if (!window.confirm(`Delete “${book.name}” and its spell list?`)) return
  deletePending.value = true
  error.value = ''
  try {
    await pb.collection('spellbooks').delete(book.id)
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      bookWriteUncertain.value = true
      error.value = `Could not confirm whether “${book.name}” was deleted because the connection failed. Refresh this screen before trying again.`
      return
    }
    error.value = 'The spellbook could not be deleted.'
    return
  } finally { deletePending.value = false }
  if (renameId.value === book.id) cancelRename()
  if (await loadBooks()) {
    replaceBookQuery(selectedBookId.value)
  } else {
    error.value = 'The spellbook was deleted, but the remaining books could not be refreshed. Refresh this screen.'
  }
}

function openPicker() {
  if (spellActionsBlocked.value || !selectedBook.value) return
  if (!pickerPending.value) pickerFeedback.value = null
  pickerOpen.value = true
}

async function addSpell(spell: CatalogRecord) {
  const book = selectedBook.value
  if (!book || pickerPending.value || unsettledWrite.value || !currentSpellsReady.value) return
  if (spells.value.some((entry) => entry.spell === spell.id)) {
    pickerFeedback.value = { tone: 'error', message: `${spell.name} is already in ${book.name}. Choose another spell.` }
    return
  }
  const bookId = book.id
  const bookName = book.name
  pickerPending.value = true
  pickerFeedback.value = { tone: 'status', message: `Adding ${spell.name}…` }
  try {
    await pb.collection('spellbook_spells').create({ spellbook: bookId, spell: spell.id })
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
  if (selectedBookId.value !== bookId) {
    pickerPending.value = false
    pickerFeedback.value = null
    pickerOpen.value = false
    error.value = `${spell.name} was added to ${bookName}.`
    return
  }
  spellQuery.value = ''
  if (!await loadSpells(bookId)) {
    pickerFeedback.value = { tone: 'error', message: `${spell.name} was added, but the spell list could not refresh. Refresh this screen before adding anything else.` }
    error.value = `${spell.name} was added, but the spell list could not refresh. Refresh to see it.`
    return
  }
  const added = spells.value.find((entry) => entry.spell === spell.id)
  if (added) expandedSpellId.value = added.id
  pickerPending.value = false
  pickerFeedback.value = null
  pickerOpen.value = false
}

async function removeSpell(entry: BookSpell) {
  if (removeUncertain.value || removePendingIds.value.size || unsettledWrite.value || !currentSpellsReady.value) return
  const bookId = selectedBookId.value
  removePendingIds.value = new Set([...removePendingIds.value, entry.id])
  error.value = ''
  try {
    await pb.collection('spellbook_spells').delete(entry.id)
    if (expandedSpellId.value === entry.id) expandedSpellId.value = ''
    if (selectedBookId.value === bookId && !await loadSpells(bookId)) {
      error.value = 'The spell was removed, but the book could not refresh. Refresh to see the current list.'
    }
  } catch (cause) {
    if (!isDefiniteWriteRejection(cause)) {
      removeUncertainIds.value = new Set([...removeUncertainIds.value, entry.id])
      error.value = 'Could not confirm whether the spell was removed because the connection failed. Refresh this screen before trying again; it may already be gone.'
      return
    }
    error.value = 'The spell could not be removed.'
  } finally {
    const next = new Set(removePendingIds.value)
    next.delete(entry.id)
    removePendingIds.value = next
  }
}

function rememberPrintPosition(event: MouseEvent) {
  if (!character.value || !selectedBook.value) return
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  rememberSpellbookPrintReturn(character.value.id, selectedBook.value.id)
}
</script>

<template>
  <section class="screen spellbooks-screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading spellbooks…</div>
    <template v-else-if="character">
      <RouterLink class="text-link" :to="{ name: 'character-overview', params: { characterId: character.id } }">← {{ character.name }}</RouterLink>
      <div class="screen-heading"><div><p class="eyebrow"><span class="eyebrow-line" /> SPELLBOOKS</p><h1 id="page-title">{{ character.name }}’s books</h1><p class="screen-description">Search this book, read one spell at a time, and keep separate named collections. Spell details use the game’s system catalog and preferred description.</p></div></div>
      <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
      <div class="spellbook-layout">
        <aside class="spellbook-sidebar" aria-label="Spellbooks">
          <form class="spellbook-create" @submit.prevent="createBook">
            <label class="field-label" for="new-spellbook">New spellbook</label>
            <input id="new-spellbook" v-model="newName" class="text-input" maxlength="160" placeholder="Name this book" required :disabled="bookFormBlocked" />
            <button class="primary-button" type="submit" :disabled="bookFormBlocked">＋ Create</button>
          </form>
          <button v-for="book in books" :key="book.id" class="spellbook-tab" :class="{ selected: book.id === selectedBookId }" type="button" :disabled="bookSwitchingBlocked && book.id !== selectedBookId" @click="selectBook(book.id)">{{ book.name }}<small v-if="book.id === selectedBookId">{{ spells.length }} {{ spells.length === 1 ? 'spell' : 'spells' }}<template v-if="searchActive"> · {{ filteredSpells.length }} matching</template></small></button>
          <p v-if="bookSwitchingBlocked" class="muted-hint">{{ bookSwitchMessage }}</p>
        </aside>
        <div class="spellbook-content">
          <template v-if="selectedBook">
            <div class="spellbook-heading">
              <div><p class="eyebrow">SELECTED BOOK</p><h2>{{ selectedBook.name }}</h2><p class="muted-hint">{{ spells.length }} {{ spells.length === 1 ? 'spell' : 'spells' }} · {{ printAvailable ? 'cards can be prepared for print' : 'add a spell before printing' }}</p></div>
              <div class="row-actions">
                <RouterLink v-if="printAvailable" class="secondary-link" :to="{ name: 'print-spellbook', params: { characterId: character.id, spellbookId: selectedBook.id } }" @click="rememberPrintPosition">Print cards</RouterLink>
                <button class="primary-button" type="button" :disabled="spellActionsBlocked" @click="openPicker">＋ Add spell</button>
                <ActionMenu :label="`Book administration for ${selectedBook.name}`" :disabled="bookFormBlocked">
                  <ActionMenuItem @select="beginRename(selectedBook)">Rename book</ActionMenuItem>
                  <ActionMenuItem danger @select="deleteBook(selectedBook)">Delete book</ActionMenuItem>
                </ActionMenu>
              </div>
            </div>
            <form v-if="renameId === selectedBook.id" class="spellbook-admin" @submit.prevent="renameBook">
              <label class="field-label" :for="`rename-${selectedBook.id}`">Book name</label>
              <input :id="`rename-${selectedBook.id}`" v-model="renameDraft" class="text-input" maxlength="160" :disabled="renamePending || bookWriteUncertain" />
              <div class="row-actions"><button class="primary-button" type="submit" :disabled="!renameDraft.trim() || renamePending || bookWriteUncertain">Save name</button><button class="secondary-button" type="button" :disabled="renamePending || bookWriteUncertain" @click="cancelRename">Cancel</button></div>
            </form>
            <p v-if="spellsLoading && !spells.length" class="muted-hint spell-loading" role="status">Loading spells…</p>
            <template v-if="spells.length">
              <div class="spellbook-search-row">
                <label class="filter-field" for="spellbook-search">Search this book<input id="spellbook-search" ref="searchInput" v-model="spellQuery" class="text-input" type="search" placeholder="Name, source, level or school" /></label>
                <p class="muted-hint" role="status" aria-live="polite">{{ filteredSpells.length }} of {{ spells.length }} {{ spells.length === 1 ? 'spell' : 'spells' }}</p>
                <button v-if="searchActive" class="secondary-button" type="button" @click="clearSpellSearch">Clear spell search</button>
              </div>
              <div v-if="filteredSpells.length" class="spell-list" :aria-busy="spellsLoading">
                <article v-for="entry in filteredSpells" :key="entry.id" class="spell-entry" :class="{ 'is-expanded': isExpanded(entry) }">
                  <button class="spell-entry-toggle" type="button" :aria-expanded="isExpanded(entry)" :aria-controls="detailId(entry)" @click="toggleSpell(entry)">
                    <span class="spell-entry-copy">
                      <strong class="spell-entry-name">{{ entry.expand?.spell?.name ?? 'Unknown spell' }}</strong>
                      <small v-if="entry.expand?.spell" class="spell-entry-source">{{ system.catalog.resultLabel(entry.expand.spell) }}</small>
                      <small v-else class="spell-entry-source spell-entry-missing">Missing catalog reference</small>
                    </span>
                    <span class="spell-entry-chevron" aria-hidden="true">{{ isExpanded(entry) ? '−' : '+' }}</span>
                  </button>
                  <div v-if="isExpanded(entry)" :id="detailId(entry)" class="spell-entry-details" role="region" :aria-label="`Details for ${entry.expand?.spell?.name ?? 'unknown spell'}`">
                    <template v-if="entry.expand?.spell">
                      <dl v-if="system.catalog.detailFields(entry.expand.spell).length" class="spell-detail-fields">
                        <div v-for="field in system.catalog.detailFields(entry.expand.spell)" :key="field.name"><dt>{{ field.name }}</dt><dd>{{ field.value }}</dd></div>
                      </dl>
                      <div class="spell-entry-description"><EntryContent :value="system.catalog.description(entry.expand.spell)" /></div>
                    </template>
                    <p v-else class="missing-reference">This saved spell points to a catalog record that is missing. The reference can still be removed from the book.</p>
                    <div class="spell-entry-actions">
                      <button class="danger-button" type="button" :disabled="spellActionsBlocked" @click="removeSpell(entry)">{{ removePendingIds.has(entry.id) ? 'Removing…' : 'Remove from book' }}</button>
                    </div>
                  </div>
                </article>
              </div>
              <div v-else class="empty-state compact-empty spell-search-empty">
                <div class="empty-state-icon" aria-hidden="true">⌕</div>
                <h2>No spells match</h2>
                <p>No spell in this book matches the current search.</p>
                <button class="secondary-button empty-action" type="button" @click="clearSpellSearch">Clear spell search</button>
              </div>
            </template>
            <div v-else-if="!spellsLoading" class="empty-state compact-empty">
              <div class="empty-state-icon" aria-hidden="true">✧</div>
              <h2>No spells in this book</h2>
              <p>Add spells from the game’s filtered catalog.</p>
              <button class="primary-button empty-action" type="button" :disabled="spellActionsBlocked" @click="openPicker">＋ Add spell</button>
            </div>
          </template>
          <div v-else class="empty-state compact-empty">
            <div class="empty-state-icon" aria-hidden="true">✧</div>
            <h2>Create a spellbook</h2>
            <p>A character can keep any number of separate named spellbooks.</p>
          </div>
        </div>
      </div>
    </template>
    <p v-else-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
    <CatalogPicker v-model:open="pickerOpen" :system-id="systemId" type="spell" title="Choose a spell" :pending="pickerPending" :taken-ids="takenSpellIds" taken-label="Already in this book" :feedback="pickerFeedback" @select="addSpell" />
  </section>
</template>
