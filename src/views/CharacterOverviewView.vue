<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { pb } from '../lib/pocketbase'

type CharacterRecord = { id: string; name: string; game: string; expand?: { game?: { id: string; name: string; system: string; encounter_visible: boolean; expand?: { system?: { name: string } } } } }

const route = useRoute()
const character = ref<CharacterRecord | null>(null)
const loading = ref(true)
const error = ref('')
const activeCharacter = ref('')

try { activeCharacter.value = localStorage.getItem('olea.selectedCharacter') ?? '' } catch { /* Optional device preference. */ }

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
      character.value = await pb.collection('characters').getOne<CharacterRecord>(String(route.params.characterId), { expand: 'game,game.system' })
  } catch {
    error.value = 'This character could not be loaded.'
  } finally {
    loading.value = false
  }
}

function selectOnDevice() {
  if (!character.value) return
  activeCharacter.value = character.value.id
  try { localStorage.setItem('olea.selectedCharacter', character.value.id) } catch { /* Keep selection usable for this visit. */ }
  window.dispatchEvent(new Event('olea-character-selected'))
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading character…</div>
    <p v-else-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Try again</button></p>
    <template v-else-if="character">
      <p class="eyebrow"><span class="eyebrow-line" /> {{ character.expand?.game?.expand?.system?.name ?? 'CHARACTER' }}</p>
      <h1 id="page-title">{{ character.name }}</h1>
      <p class="screen-description">A character in {{ character.expand?.game?.name ?? 'your game' }}.</p>
      <div class="character-overview-card">
        <div class="empty-state-icon" aria-hidden="true">✧</div>
        <p class="eyebrow">CHARACTER OVERVIEW</p>
        <h2>{{ character.name }}</h2>
        <p>{{ character.expand?.game?.name }}</p>
        <button class="primary-button empty-action" type="button" :aria-pressed="activeCharacter === character.id" @click="selectOnDevice">
          {{ activeCharacter === character.id ? 'Selected on this device' : 'Use this character on this device' }}
        </button>
      </div>
      <RouterLink class="tool-link" :to="{ name: 'character-inventory', params: { characterId: character.id } }"><span class="upcoming-icon" aria-hidden="true">◇</span><span><strong>Inventory</strong><small>Manage carried items and quantities</small></span><span aria-hidden="true">→</span></RouterLink>
      <RouterLink class="tool-link" :to="{ name: 'character-spellbooks', params: { characterId: character.id } }"><span class="upcoming-icon" aria-hidden="true">✧</span><span><strong>Spellbooks</strong><small>Collect system spells in named books</small></span><span aria-hidden="true">→</span></RouterLink>
      <RouterLink v-if="character.expand?.game?.encounter_visible" class="tool-link" :to="{ name: 'player-encounter', params: { gameId: character.game } }"><span class="upcoming-icon" aria-hidden="true">⚔</span><span><strong>Active encounter</strong><small>View the encounter shared by the Game Master</small></span><span aria-hidden="true">→</span></RouterLink>
      <RouterLink class="text-link" to="/characters">← Switch character</RouterLink>
    </template>
  </section>
</template>
