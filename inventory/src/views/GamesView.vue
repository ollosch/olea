<script setup>
import { ref, computed, onMounted } from 'vue'
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
const description = ref('')
const mode = ref('existing')
const existingSystemId = ref('')
const systemName = ref('')
const weightUnit = ref('lb')
const preset = ref('DnD (gold/silver/copper)')
const currencies = ref([])
const itemsText = ref('')

const gamesIRun = computed(() => game.games.filter((g) => g.role === 'gm'))
const gamesIPlay = computed(() => game.games.filter((g) => g.role === 'player'))

onMounted(async () => {
  await game.loadGames()
})

async function openModal() {
  await game.loadSystems()
  name.value = ''
  description.value = ''
  systemName.value = ''
  weightUnit.value = 'lb'
  preset.value = 'DnD (gold/silver/copper)'
  currencies.value = cloneCurrencies(presets[preset.value])
  itemsText.value = ''
  existingSystemId.value = game.systems[0]?.id || ''
  mode.value = game.systems.length ? 'existing' : 'new'
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

function parsedItems() {
  const text = itemsText.value.trim()
  if (!text) return []
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed.items)) return parsed.items
  throw new Error('Items JSON must be an array or an object with an items array')
}

async function create() {
  if (!name.value.trim() || submitting.value) return
  error.value = ''

  let payload
  if (mode.value === 'existing') {
    if (!existingSystemId.value) {
      error.value = 'Choose a system'
      return
    }
    payload = {
      name: name.value.trim(),
      description: description.value.trim(),
      systemId: existingSystemId.value,
    }
  } else {
    if (!systemName.value.trim()) {
      error.value = 'System name is required'
      return
    }
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
    if (list.some((c) => c.base_value < 1)) {
      error.value = 'Currency base values must be at least 1'
      return
    }
    let items
    try {
      items = parsedItems()
    } catch (err) {
      error.value = err.message || 'Invalid items JSON'
      return
    }
    payload = {
      name: name.value.trim(),
      description: description.value.trim(),
      newSystem: {
        name: systemName.value.trim(),
        weight_unit: weightUnit.value,
        currencies: list,
        items,
      },
    }
  }

  submitting.value = true
  try {
    const record = await game.createGame(payload)
    showModal.value = false
    show('Game created')
    router.push('/game/' + record.id)
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
      <button v-if="game.isGlobalGM" class="ghost" @click="router.push('/systems')">Systems</button>
      <button class="ghost" @click="auth.logout(); router.push('/')">Logout</button>
    </div>

    <div class="row" style="margin-bottom: 1rem">
      <button class="primary" @click="openModal">+ New game</button>
    </div>

    <p v-if="!game.games.length" class="muted">No games yet — create one to get started.</p>

    <template v-else>
      <section style="margin-bottom: 1.5rem">
        <h2>Games I run</h2>
        <p v-if="!gamesIRun.length" class="muted small">You are not a GM in any game.</p>
        <div v-else class="list">
          <button
            v-for="g in gamesIRun"
            :key="g.id"
            class="list-item"
            style="text-align: left; width: 100%"
            @click="router.push('/game/' + g.id)"
          >
            <span class="grow">
              <strong>{{ g.name }}</strong>
              <span class="small muted"> · {{ g.system?.name || 'Unknown system' }}</span>
            </span>
            <span class="badge gm">GM</span>
          </button>
        </div>
      </section>

      <section>
        <h2>Games I play</h2>
        <p v-if="!gamesIPlay.length" class="muted small">You are not a player in any game.</p>
        <div v-else class="list">
          <button
            v-for="g in gamesIPlay"
            :key="g.id"
            class="list-item"
            style="text-align: left; width: 100%"
            @click="router.push('/game/' + g.id)"
          >
            <span class="grow">
              <strong>{{ g.name }}</strong>
              <span class="small muted"> · {{ g.system?.name || 'Unknown system' }}</span>
            </span>
            <span class="badge">Player</span>
          </button>
        </div>
      </section>
    </template>

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
          <label for="game-description">Description</label>
          <textarea id="game-description" v-model="description" rows="2"></textarea>
        </div>

        <div class="field">
          <label for="game-mode">System</label>
          <select id="game-mode" v-model="mode">
            <option value="existing" :disabled="!game.systems.length">Use existing system</option>
            <option value="new">Create new system</option>
          </select>
        </div>

        <template v-if="mode === 'existing'">
          <div class="field">
            <label for="existing-system">System</label>
            <select id="existing-system" v-model="existingSystemId">
              <option v-for="s in game.systems" :key="s.id" :value="s.id">
                {{ s.name }} ({{ s.weight_unit || 'lb' }})
              </option>
            </select>
          </div>
        </template>

        <template v-else>
          <div class="field">
            <label for="system-name">System name</label>
            <input id="system-name" v-model="systemName" type="text" placeholder="D&D 5e" />
          </div>

          <div class="field">
            <label for="weight-unit">Weight unit</label>
            <select id="weight-unit" v-model="weightUnit">
              <option value="lb">Pounds (lb)</option>
              <option value="kg">Kilograms (kg)</option>
            </select>
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

          <div class="field">
            <label for="items-json">Initial items (optional JSON)</label>
            <textarea
              id="items-json"
              v-model="itemsText"
              rows="4"
              placeholder='[{ "name": "Rope", "kind": "single", "weight": 10 }]'
            ></textarea>
          </div>
        </template>

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

<style scoped>
.badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--bg-3);
  color: var(--text-dim);
  white-space: nowrap;
}
.badge.gm {
  background: rgba(56, 189, 248, 0.16);
  color: var(--accent);
}
</style>
