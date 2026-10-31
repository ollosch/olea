<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { pb } from '../lib/pocketbase'

type SystemRecord = { id: string; key: string; name: string }
type GameRecord = { id: string; name: string; system: string; expand?: { system?: SystemRecord } }

const games = ref<GameRecord[]>([])
const systems = ref<SystemRecord[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const formError = ref('')
const editingId = ref('')
const formOpen = ref(false)
const name = ref('')
const systemId = ref('')

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [gameRecords, systemRecords] = await Promise.all([
      pb.collection('games').getFullList<GameRecord>({ sort: 'name', expand: 'system' }),
      pb.collection('systems').getFullList<SystemRecord>({ sort: 'name' }),
    ])
    games.value = gameRecords
    systems.value = systemRecords
    if (!systemId.value && systemRecords.length) systemId.value = systemRecords[0].id
  } catch {
    error.value = 'Games could not be loaded. Check that the local server is available and try again.'
  } finally {
    loading.value = false
  }
}

function beginCreate() {
  editingId.value = ''
  name.value = ''
  systemId.value = systems.value[0]?.id ?? ''
  formError.value = ''
  formOpen.value = true
}

function beginEdit(game: GameRecord) {
  editingId.value = game.id
  name.value = game.name
  systemId.value = game.system
  formError.value = ''
  formOpen.value = true
}

async function saveGame() {
  const cleanName = name.value.trim()
  if (!cleanName || !systemId.value) {
    formError.value = 'Enter a game name and choose a system.'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    const data = { name: cleanName, system: systemId.value }
    if (editingId.value) await pb.collection('games').update(editingId.value, data)
    else await pb.collection('games').create(data)
    formOpen.value = false
    await load()
  } catch {
    formError.value = 'The game could not be saved. Check the connection and try again.'
  } finally {
    saving.value = false
  }
}

async function deleteGame(game: GameRecord) {
  if (!window.confirm(`Delete “${game.name}”? This cannot be undone.`)) return
  try {
    const characters = await pb.collection('characters').getList(1, 1, { filter: pb.filter('game = {:gameId}', { gameId: game.id }) })
    if (characters.totalItems > 0) {
      window.alert('This game contains characters. Move or delete its characters before deleting the game.')
      return
    }
    await pb.collection('games').delete(game.id)
    await load()
  } catch {
    error.value = 'The game could not be deleted. Check the connection and try again.'
  }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div class="screen-heading">
      <div>
        <p class="eyebrow"><span class="eyebrow-line" /> GAME MASTER</p>
        <h1 id="page-title">Your games</h1>
        <p class="screen-description">Set up a home for your campaign and everything you bring to the table.</p>
      </div>
      <button class="primary-button" type="button" :disabled="systems.length === 0" @click="beginCreate">
        <span aria-hidden="true">＋</span> Create a game
      </button>
    </div>

    <p v-if="error" class="alert-message" role="alert">
      {{ error }} <button class="inline-button" type="button" @click="load">Try again</button>
    </p>

    <form v-if="formOpen" class="editor-panel" @submit.prevent="saveGame">
      <h2>{{ editingId ? 'Edit game' : 'Create a game' }}</h2>
      <label class="field-label" for="game-name">Game name</label>
      <input id="game-name" v-model="name" class="text-input" maxlength="160" required autocomplete="off" placeholder="e.g. The Sunken Crown" />
      <label class="field-label" for="game-system">System</label>
      <select id="game-system" v-model="systemId" class="select-input" required>
        <option v-for="system in systems" :key="system.id" :value="system.id">{{ system.name }}</option>
      </select>
      <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
      <div class="form-actions">
        <button class="secondary-button" type="button" @click="formOpen = false">Cancel</button>
        <button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save game' }}</button>
      </div>
    </form>

    <div v-if="loading" class="loading-state" role="status">Loading games…</div>
    <div v-else-if="games.length" class="game-list" aria-label="Games">
      <article v-for="game in games" :key="game.id" class="game-row">
        <div class="game-icon" aria-hidden="true">◇</div>
        <div class="game-copy">
          <h2>{{ game.name }}</h2>
          <p>{{ game.expand?.system?.name ?? 'Unknown system' }}</p>
        </div>
        <div class="row-actions">
          <button class="secondary-button" type="button" @click="beginEdit(game)">Edit</button>
          <button class="danger-button" type="button" @click="deleteGame(game)">Delete</button>
        </div>
      </article>
    </div>
    <div v-else-if="!formOpen" class="empty-state">
      <div class="empty-state-icon" aria-hidden="true">◇</div>
      <p class="eyebrow">A NEW ADVENTURE STARTS HERE</p>
      <h2>No games yet</h2>
      <p>Create a game to keep its characters and table notes together.</p>
      <button class="primary-button empty-action" type="button" :disabled="!systems.length" @click="beginCreate">Create your first game</button>
      <p v-if="!systems.length" class="muted-hint">No game systems are available yet.</p>
    </div>

    <aside v-if="!games.length" class="upcoming-panel" aria-labelledby="upcoming-title">
      <div class="upcoming-icon" aria-hidden="true">✧</div>
      <div><h2 id="upcoming-title">A place for your whole campaign</h2><p>Games bring characters, encounters, and shared resources together.</p></div>
      <span class="coming-soon">YOUR TABLE</span>
    </aside>
  </section>
</template>
