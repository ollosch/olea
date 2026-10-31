<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { pb } from '../lib/pocketbase'

type ProfileRecord = { id: string; name: string }
type CharacterRecord = { id: string; name: string; game: string; owner: string; expand?: { owner?: ProfileRecord } }
type GameRecord = { id: string; name: string; system: string; gm_profile: string; expand?: { system?: { name: string }; gm_profile?: ProfileRecord } }

const route = useRoute()
const gameId = computed(() => String(route.params.gameId))
const game = ref<GameRecord | null>(null)
const characters = ref<CharacterRecord[]>([])
const loading = ref(true)
const error = ref('')
const formOpen = ref(false)
const editingId = ref('')
const name = ref('')
const saving = ref(false)
const formError = ref('')
const canDeleteGame = ref(false)

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [gameRecord, characterRecords] = await Promise.all([
      pb.collection('games').getOne<GameRecord>(gameId.value, { expand: 'system,gm_profile' }),
      pb.collection('characters').getFullList<CharacterRecord>({ filter: pb.filter('game = {:gameId}', { gameId: gameId.value }), sort: 'name', expand: 'owner' }),
    ])
    game.value = gameRecord
    characters.value = characterRecords
  } catch {
    error.value = 'This game or its characters could not be loaded.'
  } finally {
    loading.value = false
  }
}

function beginCreate() {
  editingId.value = ''
  name.value = ''
  formError.value = ''
  formOpen.value = true
}

function beginEdit(character: CharacterRecord) {
  editingId.value = character.id
  name.value = character.name
  formError.value = ''
  formOpen.value = true
}

async function saveCharacter() {
  const cleanName = name.value.trim()
  if (!cleanName) {
    formError.value = 'Enter a character name.'
    return
  }
  saving.value = true
  try {
    if (editingId.value) await pb.collection('characters').update(editingId.value, { name: cleanName })
    else await pb.collection('characters').create({ name: cleanName, game: gameId.value })
    formOpen.value = false
    await load()
  } catch {
    formError.value = 'The character could not be saved. Check the connection and try again.'
  } finally {
    saving.value = false
  }
}

async function deleteCharacter(character: CharacterRecord) {
  if (!window.confirm(`Delete “${character.name}”? This cannot be undone.`)) return
  try {
    await pb.collection('characters').delete(character.id)
    await load()
  } catch {
    error.value = 'The character could not be deleted. Check the connection and try again.'
  }
}

async function deleteEmptyGame() {
  if (!game.value || characters.value.length) return
  if (!window.confirm(`Delete empty game “${game.value.name}”? This cannot be undone.`)) return
  try {
    await pb.collection('games').delete(game.value.id)
    window.location.assign('/games')
  } catch {
    error.value = 'The game could not be deleted. Check the connection and try again.'
  }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Try again</button></p>
    <div v-if="loading" class="loading-state" role="status">Loading game…</div>
    <template v-else-if="game">
      <div class="screen-heading">
        <div>
          <p class="eyebrow"><span class="eyebrow-line" /> {{ game.expand?.system?.name ?? 'GAME' }}</p>
          <h1 id="page-title">{{ game.name }}</h1>
          <p class="screen-description">Create and manage the characters in this game.</p>
        </div>
        <div class="heading-actions">
          <RouterLink class="secondary-link" to="/games">All games</RouterLink>
          <button class="primary-button" type="button" @click="beginCreate"><span aria-hidden="true">＋</span> Add character</button>
        </div>
      </div>

      <section class="gm-settings" aria-labelledby="gm-title">
        <div><p class="eyebrow">GAME MASTER</p><h2 id="gm-title">{{ game.expand?.gm_profile?.name ?? 'Not assigned' }}</h2></div>
        <span class="muted-hint">GM reassignment available in profiles below</span>
      </section>

      <form v-if="formOpen" class="editor-panel" @submit.prevent="saveCharacter">
        <h2>{{ editingId ? 'Rename character' : 'Add a character' }}</h2>
        <label class="field-label" for="character-name">Character name</label>
        <input id="character-name" v-model="name" class="text-input" maxlength="160" required autocomplete="off" placeholder="e.g. Rowan Ashford" />
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <div class="form-actions"><button class="secondary-button" type="button" @click="formOpen = false">Cancel</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save character' }}</button></div>
      </form>

      <div v-if="characters.length" class="character-list" aria-label="Game characters">
        <article v-for="character in characters" :key="character.id" class="character-management-row">
          <div class="game-icon" aria-hidden="true">✧</div>
          <div class="game-copy"><h2>{{ character.name }}</h2><p>{{ character.expand?.owner?.name ? `Owned by ${character.expand.owner.name}` : 'No owner assigned' }}</p></div>
          <div class="row-actions"><RouterLink class="secondary-link" :to="{ name: 'character-overview', params: { characterId: character.id } }">Overview</RouterLink><button class="secondary-button" type="button" @click="beginEdit(character)">Rename</button><button class="danger-button" type="button" @click="deleteCharacter(character)">Delete</button></div>
        </article>
      </div>
      <div v-else class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">✧</div><h2>No characters yet</h2><p>Add the characters who will play in {{ game.name }}.</p><button class="primary-button empty-action" type="button" @click="beginCreate">Add the first character</button></div>

      <div class="management-footer"><button class="danger-button" type="button" :disabled="characters.length > 0" :title="characters.length ? 'Delete the characters first' : 'Delete this empty game'" @click="deleteEmptyGame">Delete empty game</button><span v-if="characters.length" class="muted-hint">Delete characters before deleting this game.</span></div>
    </template>
  </section>
</template>
