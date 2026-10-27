<script setup>
import { ref, computed, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '../stores/game'
import { errorMessage } from '../utils/errors'
import { useToast } from '../composables/useToast'
import ItemsPanel from '../components/ItemsPanel.vue'

const route = useRoute()
const router = useRouter()
const game = useGameStore()
const { show } = useToast()

const tab = ref('currencies')
const systemForm = reactive({ name: '', description: '', weight_unit: 'lb' })
const systemError = ref('')
const systemBusy = ref(false)

const currencyOpen = ref(false)
const editingCurrency = ref(null)
const currencyForm = reactive({ name: '', symbol: '', base_value: 1, sort: 0 })
const currencyError = ref('')
const currencyBusy = ref(false)

const importText = ref('')
const importFile = ref(null)
const importError = ref('')
const importBusy = ref(false)

const system = computed(() => game.system)

onMounted(async () => {
  await game.openSystem(route.params.id)
  fillSystemForm()
})

onBeforeUnmount(() => game.closeSystem())

watch(
  () => game.system,
  () => fillSystemForm()
)

function fillSystemForm() {
  const s = game.system
  if (!s) return
  systemForm.name = s.name || ''
  systemForm.description = s.description || ''
  systemForm.weight_unit = s.weight_unit || 'lb'
}

async function saveSystem() {
  if (!systemForm.name.trim() || systemBusy.value) return
  systemBusy.value = true
  systemError.value = ''
  try {
    await game.updateSystem(game.system.id, {
      name: systemForm.name.trim(),
      description: systemForm.description.trim(),
      weight_unit: systemForm.weight_unit,
    })
    show('System saved')
  } catch (err) {
    systemError.value = errorMessage(err)
  } finally {
    systemBusy.value = false
  }
}

function openCurrency(currency = null) {
  editingCurrency.value = currency
  currencyForm.name = currency?.name || ''
  currencyForm.symbol = currency?.symbol || ''
  currencyForm.base_value = currency?.base_value || 1
  currencyForm.sort = currency?.sort ?? game.currencies.length
  currencyError.value = ''
  currencyOpen.value = true
}

function closeCurrency() {
  currencyOpen.value = false
  editingCurrency.value = null
}

async function saveCurrency() {
  if (!currencyForm.name.trim() || currencyBusy.value) return
  currencyBusy.value = true
  currencyError.value = ''
  const data = {
    name: currencyForm.name.trim(),
    symbol: currencyForm.symbol.trim(),
    base_value: Number(currencyForm.base_value) || 1,
    sort: Number(currencyForm.sort) || 0,
  }
  try {
    if (editingCurrency.value) {
      await game.updateCurrency(editingCurrency.value.id, data)
    } else {
      await game.createCurrency(data)
    }
    closeCurrency()
    show('Currency saved')
  } catch (err) {
    currencyError.value = errorMessage(err)
  } finally {
    currencyBusy.value = false
  }
}

async function deleteCurrency(currency) {
  if (!confirm(`Delete currency "${currency.name}"?`)) return
  try {
    await game.deleteCurrency(currency.id)
    show('Currency deleted')
  } catch (err) {
    show(errorMessage(err))
  }
}

function onImportFile(event) {
  const file = event.target.files?.[0]
  importFile.value = file || null
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    importText.value = String(reader.result || '')
  }
  reader.readAsText(file)
}

function importPayload() {
  const parsed = JSON.parse(importText.value)
  if (Array.isArray(parsed)) return { items: parsed }
  return parsed
}

async function runImport() {
  if (!importText.value.trim() || importBusy.value) return
  importBusy.value = true
  importError.value = ''
  try {
    const result = await game.importSystem(game.system.id, importPayload())
    show(`Imported ${result.currencies || 0} currencies and ${result.items || 0} items`)
  } catch (err) {
    importError.value = errorMessage(err)
  } finally {
    importBusy.value = false
  }
}
</script>

<template>
  <div class="page wide">
    <div class="row" style="margin-bottom: 0.75rem">
      <button class="ghost" @click="router.push('/systems')">← Systems</button>
      <h1 class="grow" style="margin: 0">{{ system?.name || 'System' }}</h1>
      <span v-if="system" class="small muted">{{ system.weight_unit || 'lb' }}</span>
    </div>

    <div v-if="game.loading" class="muted">Loading…</div>

    <template v-else-if="system">
      <div class="card" style="margin-bottom: 1rem">
        <div class="field">
          <label for="sys-name">Name</label>
          <input id="sys-name" v-model="systemForm.name" type="text" />
        </div>
        <div class="field">
          <label for="sys-desc">Description</label>
          <textarea id="sys-desc" v-model="systemForm.description" rows="2"></textarea>
        </div>
        <div class="row">
          <div class="field grow">
            <label for="sys-unit">Weight unit</label>
            <select id="sys-unit" v-model="systemForm.weight_unit">
              <option value="lb">Pounds (lb)</option>
              <option value="kg">Kilograms (kg)</option>
            </select>
          </div>
          <button class="primary" :disabled="systemBusy" @click="saveSystem">Save</button>
        </div>
        <div v-if="systemError" class="error">{{ systemError }}</div>
      </div>

      <div class="tabs">
        <button class="tab" :class="{ active: tab === 'currencies' }" @click="tab = 'currencies'">
          Currencies
        </button>
        <button class="tab" :class="{ active: tab === 'items' }" @click="tab = 'items'">Items</button>
        <button class="tab" :class="{ active: tab === 'import' }" @click="tab = 'import'">Import</button>
      </div>

      <div v-if="tab === 'currencies'">
        <div class="row" style="margin-bottom: 0.75rem">
          <span class="small muted grow">Shared by every game using this system.</span>
          <button class="primary" @click="openCurrency()">Add currency</button>
        </div>

        <div v-if="!game.currencies.length" class="muted">No currencies yet.</div>
        <div v-else class="list">
          <div v-for="currency in game.currencies" :key="currency.id" class="list-item">
            <div class="grow">
              <strong>{{ currency.symbol || currency.name }}</strong>
              <span v-if="currency.symbol && currency.symbol !== currency.name" class="small muted">
                · {{ currency.name }}</span
              >
            </div>
            <span class="small muted">base {{ currency.base_value }}</span>
            <button @click="openCurrency(currency)">Edit</button>
            <button class="danger" @click="deleteCurrency(currency)">Delete</button>
          </div>
        </div>
      </div>

      <ItemsPanel v-else-if="tab === 'items'" :show-give="false" />

      <div v-else-if="tab === 'import'" class="card">
        <h3>Import currencies and items</h3>
        <p class="small muted">
          Paste JSON or choose a file. Accepts an array of items or an object with
          <code>currencies</code> and <code>items</code>. Existing currencies are matched by name and
          items by name.
        </p>
        <div class="field">
          <label for="import-file">JSON file</label>
          <input id="import-file" type="file" accept=".json,application/json" @change="onImportFile" />
        </div>
        <div class="field">
          <label for="import-json">JSON</label>
          <textarea
            id="import-json"
            v-model="importText"
            rows="10"
            placeholder='[{ "name": "Rope", "category": "Gear", "kind": "single", "weight": 10, "value": 1, "value_currency": "gp" }]'
          ></textarea>
        </div>
        <div v-if="importError" class="error" style="margin-bottom: 0.75rem">{{ importError }}</div>
        <button class="primary" :disabled="importBusy || !importText.trim()" @click="runImport">
          {{ importBusy ? 'Importing…' : 'Import' }}
        </button>
      </div>
    </template>

    <div v-if="currencyOpen" class="modal-backdrop" @click.self="closeCurrency">
      <div class="modal">
        <h3>{{ editingCurrency ? 'Edit currency' : 'New currency' }}</h3>
        <div class="field">
          <label for="cur-name">Name</label>
          <input id="cur-name" v-model="currencyForm.name" type="text" placeholder="gold" />
        </div>
        <div class="field">
          <label for="cur-symbol">Symbol</label>
          <input id="cur-symbol" v-model="currencyForm.symbol" type="text" placeholder="gp" />
        </div>
        <div class="row">
          <div class="field grow">
            <label for="cur-base">Base value</label>
            <input id="cur-base" v-model.number="currencyForm.base_value" type="number" min="1" />
          </div>
          <div class="field grow">
            <label for="cur-sort">Sort</label>
            <input id="cur-sort" v-model.number="currencyForm.sort" type="number" />
          </div>
        </div>
        <div v-if="currencyError" class="error">{{ currencyError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="currencyBusy" @click="saveCurrency">Save</button>
          <button :disabled="currencyBusy" @click="closeCurrency">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
