<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { pb } from '../lib/pocketbase'

type CharacterRecord = { id: string; name: string; game: string; owner?: string; expand?: { game?: { id: string; name: string; system: string } } }

const router = useRouter()
const characters = ref<CharacterRecord[]>([])
const loading = ref(true)
const error = ref('')
const selectedId = ref('')
const selectedCharacter = computed(() => characters.value.find((character) => character.id === selectedId.value))

try {
  selectedId.value = localStorage.getItem('olea.selectedCharacter') ?? ''
} catch {
  // Device selection is optional when browser storage is unavailable.
}

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    characters.value = await pb.collection('characters').getFullList<CharacterRecord>({ sort: 'name', expand: 'game' })
    if (selectedId.value && !characters.value.some((character) => character.id === selectedId.value)) clearSelection()
  } catch {
    error.value = 'Characters could not be loaded. Check that the local server is available and try again.'
  } finally {
    loading.value = false
  }
}

function select(character: CharacterRecord) {
  selectedId.value = character.id
  try {
    localStorage.setItem('olea.selectedCharacter', character.id)
  } catch {
    // Keep selection usable for this visit even if storage is unavailable.
  }
  window.dispatchEvent(new Event('olea-character-selected'))
}

function clearSelection() {
  selectedId.value = ''
  try {
    localStorage.removeItem('olea.selectedCharacter')
  } catch {
    // Selection may still be cleared in memory.
  }
  window.dispatchEvent(new Event('olea-character-selected'))
}

function viewGame(character: CharacterRecord) {
  router.push({ name: 'game-characters', params: { gameId: character.game } })
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div class="screen-heading">
      <div>
        <p class="eyebrow"><span class="eyebrow-line" /> PLAYER SPACE</p>
        <h1 id="page-title">Choose your character</h1>
        <p class="screen-description">Choose a character on this device. No account or separate profile is needed.</p>
      </div>
    </div>

    <div v-if="selectedCharacter" class="selected-character" role="status">
      <div class="empty-state-icon" aria-hidden="true">✧</div>
      <p class="eyebrow">CURRENT CHARACTER</p>
      <h2>{{ selectedCharacter.name }}</h2>
      <p>{{ selectedCharacter.expand?.game?.name ?? 'Game' }}</p>
      <div class="selection-actions">
        <button class="primary-button" type="button" @click="viewGame(selectedCharacter)">Character overview</button>
        <button class="secondary-button" type="button" @click="clearSelection">Switch character</button>
      </div>
    </div>

    <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Try again</button></p>
    <div v-if="loading" class="loading-state" role="status">Loading characters…</div>
    <div v-else-if="characters.length" class="character-grid" aria-label="Available characters">
      <button v-for="character in characters" :key="character.id" class="character-card" :class="{ 'is-selected': character.id === selectedId }" type="button" @click="select(character)">
        <span class="character-avatar" aria-hidden="true">✧</span>
        <span class="character-name">{{ character.name }}</span>
        <span class="character-game">{{ character.expand?.game?.name ?? 'Game' }}</span>
        <span class="character-select-label">{{ character.id === selectedId ? 'Selected' : 'Select character' }}</span>
      </button>
    </div>
    <div v-else-if="!selectedCharacter" class="empty-state">
      <div class="empty-state-icon" aria-hidden="true">✧</div>
      <p class="eyebrow">READY WHEN YOU ARE</p>
      <h2>No characters to choose from</h2>
      <p>Characters appear here after a Game Master creates a game and adds characters to it.</p>
      <RouterLink class="text-link" to="/games">Go to games <span aria-hidden="true">→</span></RouterLink>
    </div>
    <aside v-if="!selectedCharacter" class="upcoming-panel" aria-labelledby="player-tools-title">
      <div class="upcoming-icon" aria-hidden="true">▤</div>
      <div><h2 id="player-tools-title">Your table tools</h2><p>Character sheets, inventories, coins, and spellbooks will be available from your character overview.</p></div>
      <span class="coming-soon">COMING SOON</span>
    </aside>
  </section>
</template>
