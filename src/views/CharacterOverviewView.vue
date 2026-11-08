<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import FeedbackRegion from '../components/FeedbackRegion.vue'
import PageHeader from '../components/PageHeader.vue'
import { pb } from '../lib/pocketbase'

type CharacterRecord = { id: string; name: string; game: string; expand?: { game?: { id: string; name: string; system: string; encounter_visible: boolean; expand?: { system?: { name: string } } } } }

const route = useRoute()
const character = ref<CharacterRecord | null>(null)
const loading = ref(true)
const error = ref('')
const activeCharacter = ref('')
const isSelected = computed(() => !!character.value && character.value.id === activeCharacter.value)
const gameName = computed(() => character.value?.expand?.game?.name ?? 'your game')

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
    <PageHeader
      :eyebrow="character?.expand?.game?.expand?.system?.name ?? 'PLAYER SPACE'"
      :title="character?.name ?? 'Character overview'"
      :description="character ? `A character in ${gameName}.` : 'Loading this character…'"
    >
      <template v-if="character" #actions>
        <button class="primary-button" type="button" :aria-pressed="isSelected" @click="selectOnDevice">
          {{ isSelected ? 'Selected on this device' : 'Use this character on this device' }}
        </button>
        <RouterLink class="secondary-link" to="/characters">Switch character</RouterLink>
      </template>
    </PageHeader>

    <div class="feedback-slot">
      <FeedbackRegion v-if="error" tone="error" action-label="Try again" @action="load">{{ error }}</FeedbackRegion>
      <FeedbackRegion v-else-if="loading">Loading character…</FeedbackRegion>
    </div>

    <template v-if="character">
      <section class="character-workspace" aria-labelledby="character-tools-title">
        <div class="workspace-heading">
          <div>
            <p class="eyebrow">CHARACTER TOOLS</p>
            <h2 id="character-tools-title">Where to next</h2>
          </div>
          <p v-if="isSelected" class="selected-badge">Selected on this device</p>
        </div>
        <div class="character-tool-list">
          <RouterLink class="tool-link" :to="{ name: 'character-inventory', params: { characterId: character.id } }"><span class="upcoming-icon" aria-hidden="true">◇</span><span><strong>Inventory</strong><small>Manage carried items, containers, and quantities</small></span><span aria-hidden="true">→</span></RouterLink>
          <RouterLink class="tool-link" :to="{ name: 'character-spellbooks', params: { characterId: character.id } }"><span class="upcoming-icon" aria-hidden="true">✧</span><span><strong>Spellbooks</strong><small>Collect system spells in named books</small></span><span aria-hidden="true">→</span></RouterLink>
          <RouterLink v-if="character.expand?.game?.encounter_visible" class="tool-link" :to="{ name: 'player-encounter', params: { gameId: character.game } }"><span class="upcoming-icon" aria-hidden="true">⚔</span><span><strong>Active encounter</strong><small>View the encounter shared by the Game Master</small></span><span aria-hidden="true">→</span></RouterLink>
        </div>
      </section>
    </template>
  </section>
</template>
