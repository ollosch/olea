<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import FeedbackRegion from '../components/FeedbackRegion.vue'
import PageHeader from '../components/PageHeader.vue'
import { pb } from '../lib/pocketbase'

type CharacterRecord = { id: string; name: string; game: string; owner?: string; expand?: { game?: { id: string; name: string; system: string; encounter_visible?: boolean } } }

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

function viewCharacter(character: CharacterRecord) {
  router.push({ name: 'character-overview', params: { characterId: character.id } })
}

function chooseCharacter(character: CharacterRecord) {
  select(character)
  viewCharacter(character)
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <PageHeader
      eyebrow="PLAYER SPACE"
      title="Choose your character"
      description="Select a character to open its workspace. No account or separate profile is needed."
    />

    <div class="feedback-slot">
      <FeedbackRegion v-if="error" tone="error" action-label="Try again" @action="load">{{ error }}</FeedbackRegion>
      <FeedbackRegion v-else-if="loading">Loading characters…</FeedbackRegion>
    </div>

    <div v-if="selectedCharacter" class="selected-character" role="status">
      <div class="empty-state-icon" aria-hidden="true">✧</div>
      <p class="eyebrow">CURRENT CHARACTER</p>
      <h2>{{ selectedCharacter.name }}</h2>
      <p>{{ selectedCharacter.expand?.game?.name ?? 'Game' }}</p>
      <div class="selection-actions">
        <button class="primary-button" type="button" @click="viewCharacter(selectedCharacter)">Resume character</button>
        <RouterLink class="secondary-link" :to="{ name: 'character-inventory', params: { characterId: selectedCharacter.id } }">Inventory</RouterLink>
        <RouterLink class="secondary-link" :to="{ name: 'character-spellbooks', params: { characterId: selectedCharacter.id } }">Spellbooks</RouterLink>
        <RouterLink v-if="selectedCharacter.expand?.game?.encounter_visible" class="secondary-link" :to="{ name: 'player-encounter', params: { gameId: selectedCharacter.game } }">Active encounter</RouterLink>
        <button class="secondary-button" type="button" @click="clearSelection">Switch character</button>
      </div>
    </div>

    <div v-if="!loading && characters.length" class="character-grid" aria-label="Available characters">
      <button v-for="character in characters" :key="character.id" class="character-card" :class="{ 'is-selected': character.id === selectedId }" type="button" @click="chooseCharacter(character)">
        <span class="character-avatar" aria-hidden="true">✧</span>
        <span class="character-name">{{ character.name }}</span>
        <span class="character-game">{{ character.expand?.game?.name ?? 'Game' }}</span>
        <span class="character-select-label">{{ character.id === selectedId ? 'Open selected character' : 'Open character' }}</span>
      </button>
    </div>
    <div v-else-if="!loading && !error && !selectedCharacter" class="empty-state">
      <div class="empty-state-icon" aria-hidden="true">✧</div>
      <p class="eyebrow">READY WHEN YOU ARE</p>
      <h2>No characters to choose from</h2>
      <p>Characters appear here after a Game Master creates a game and adds characters to it.</p>
      <RouterLink class="text-link" to="/games">Go to games <span aria-hidden="true">→</span></RouterLink>
    </div>
  </section>
</template>
