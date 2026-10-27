<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game'
import { useAuthStore } from '../stores/auth'
import { errorMessage } from '../utils/errors'
import { useToast } from '../composables/useToast'

const router = useRouter()
const game = useGameStore()
const auth = useAuthStore()
const { show } = useToast()

const presets = {
  'DnD (gold/silver/copper)': [
    { name: 'copper', symbol: 'cp', base_value: 1 },
    { name: 'silver', symbol: 'sp', base_value: 10 },
    { name: 'gold', symbol: 'gp', base_value: 100 },
    { name: 'platinum', symbol: 'pp', base_value: 1000 },
  ],
  'Numenera (shin)': [{ name: 'shin', symbol: 'sh', base_value: 1 }],
  'Call of Cthulhu (dollars)': [
    { name: 'cent', symbol: '¢', base_value: 1 },
    { name: 'dollar', symbol: '$', base_value: 100 },
  ],
  Custom: [],
}

const showModal = ref(false)
const submitting = ref(false)
const error = ref('')
const name = ref('')
const preset = ref('DnD (gold/silver/copper)')
const currencies = ref([])

onMounted(async () => {
  await game.loadGames()
})

function openModal() {
  name.value = ''
  preset.value = 'DnD (gold/silver/copper)'
  currencies.value = cloneCurrencies(presets[preset.value])
  error.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function cloneCurrencies(list) {
  return list.map((c) => ({ name: c.name, symbol: c.symbol, base_value: c.base_value }))
}

function onPresetChange() {
  currencies.value = cloneCurrencies(presets[preset.value])
}

function addCurrency() {
  currencies.value.push({ name: '', symbol: '', base_value: 1 })
}

function removeCurrency(i) {
  currencies.value.splice(i, 1)
}

async function create() {
  if (!name.value.trim() || submitting.value) return
  const list = currencies.value
    .filter((c) => c.name.trim())
    .map((c, i) => ({
      name: c.name.trim(),
      symbol: c.symbol.trim(),
      base_value: Number(c.base_value) || 0,
      sort: i,
    }))
  if (!list.length) {
    error.value = 'Add at least one currency'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    await game.createGame({ name: name.value.trim(), currencies: list })
    showModal.value = false
    show('Game created')
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page wide">
    <div class="row" style="margin-bottom: 0.75rem">
      <h1 class="grow" style="margin: 0">Games</h1>
      <span class="small muted">{{ auth.player?.name }}</span>
      <button class="ghost" @click="auth.logout(); router.push('/')">Logout</button>
    </div>

    <div class="row" style="margin-bottom: 1rem">
      <button class="primary" @click="openModal">+ New game</button>
    </div>

    <p v-if="!game.games.length" class="muted">No games yet — create one to get started.</p>

    <div v-else class="list">
      <button
        v-for="g in game.games"
        :key="g.id"
        class="list-item"
        style="text-align: left; width: 100%"
        @click="router.push('/game/' + g.id)"
      >
        {{ g.name }}
      </button>
    </div>

    <div v-if="showModal" class="modal-backdrop" @click.self="closeModal">
      <div class="modal">
        <div class="row" style="margin-bottom: 1rem">
          <h2 class="grow" style="margin: 0">New game</h2>
          <button class="ghost" @click="closeModal">✕</button>
        </div>

        <div class="field">
          <label for="game-name">Game name</label>
          <input id="game-name" v-model="name" type="text" placeholder="Campaign name" />
        </div>

        <div class="field">
          <label for="preset">Currency preset</label>
          <select id="preset" v-model="preset" @change="onPresetChange">
            <option v-for="(_, key) in presets" :key="key" :value="key">{{ key }}</option>
          </select>
        </div>

        <div class="field">
          <label>Currencies</label>
          <div v-for="(c, i) in currencies" :key="i" class="row" style="margin-bottom: 0.4rem">
            <input v-model="c.name" type="text" placeholder="Name" style="flex: 2" />
            <input v-model="c.symbol" type="text" placeholder="Symbol" style="flex: 1" />
            <input
              v-model.number="c.base_value"
              type="number"
              min="1"
              placeholder="Value"
              style="flex: 1"
            />
            <button class="danger" @click="removeCurrency(i)">✕</button>
          </div>
          <button class="ghost" style="padding-left: 0" @click="addCurrency">+ Add currency</button>
        </div>

        <div v-if="error" class="error" style="margin-bottom: 0.75rem">{{ error }}</div>

        <div class="row">
          <button class="ghost grow" @click="closeModal">Cancel</button>
          <button class="primary grow" :disabled="submitting || !name.trim()" @click="create">
            {{ submitting ? 'Creating…' : 'Create game' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
