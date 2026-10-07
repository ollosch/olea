<script setup>
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import { useToast } from '../composables/useToast'
import { errorMessage } from '../utils/errors'
import ItemEditorModal from './ItemEditorModal.vue'

const game = useGameStore()
const { show } = useToast()

const editorOpen = ref(false)
const editingItem = ref(null)

const grouped = computed(() => {
  const groups = {}
  for (const item of game.items) {
    const cat = item.category || 'Uncategorized'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(item)
  }
  return Object.entries(groups)
    .map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
})

const valueCurrency = (item) => {
  const c = game.currencyMap[item.value_currency]
  return c ? c.symbol : ''
}

const kindLabel = (kind) => ({ single: 'single', stack: 'stack', charges: 'charges' }[kind] || kind)

function openCreate() {
  editingItem.value = null
  editorOpen.value = true
}

function openEdit(item) {
  editingItem.value = item
  editorOpen.value = true
}

async function onDelete(item) {
  if (!confirm(`Delete "${item.name}"?`)) return
  try {
    await game.deleteItem(item.id)
  } catch (err) {
    show(errorMessage(err))
  }
}

const giving = ref(null)
const giveTo = ref('')
const giveQty = ref(1)
const giveError = ref('')
const giveBusy = ref(false)

const recipients = computed(() => game.members)

function openGive(item) {
  giving.value = item
  giveTo.value = ''
  giveQty.value = 1
  giveError.value = ''
}

function closeGive() {
  giving.value = null
  giveError.value = ''
}

async function confirmGive() {
  const item = giving.value
  if (!item) return
  if (!giveTo.value) {
    giveError.value = 'Choose a recipient'
    return
  }
  const payload = { itemId: item.id, toPlayerId: giveTo.value }
  if (item.kind === 'stack') {
    const q = Number(giveQty.value)
    if (!q || q < 1) {
      giveError.value = 'Invalid quantity'
      return
    }
    payload.quantity = q
  }
  giveBusy.value = true
  giveError.value = ''
  try {
    await game.giveItem(payload)
    closeGive()
    show('Item given')
  } catch (err) {
    giveError.value = errorMessage(err)
  } finally {
    giveBusy.value = false
  }
}
</script>

<template>
  <div>
    <div class="row" style="margin-bottom: 0.75rem">
      <div class="grow"></div>
      <button class="primary" @click="openCreate">Add item</button>
    </div>

    <div v-if="!game.items.length" class="muted">No items yet.</div>

    <div v-for="group in grouped" :key="group.category" style="margin-bottom: 1rem">
      <h3>{{ group.category }}</h3>
      <div class="list">
        <div
          v-for="item in group.items"
          :key="item.id"
          class="list-item"
          style="cursor: pointer"
          @click="openEdit(item)"
        >
          <div class="grow">
            <div><strong>{{ item.name }}</strong></div>
            <div class="small muted">
              <span>{{ kindLabel(item.kind) }}</span>
              <span v-if="item.value > 0"> · {{ item.value }} {{ valueCurrency(item) }}</span>
            </div>
          </div>
          <button @click.stop="openGive(item)">Give</button>
          <button class="danger" @click.stop="onDelete(item)">Delete</button>
        </div>
      </div>
    </div>

    <ItemEditorModal
      :item="editingItem"
      :open="editorOpen"
      @close="editorOpen = false"
      @saved="editorOpen = false"
    />

    <div v-if="giving" class="modal-backdrop" @click.self="closeGive">
      <div class="modal">
        <h3>Give "{{ giving.name }}"</h3>
        <div class="field">
          <label for="give-to">To</label>
          <select id="give-to" v-model="giveTo">
            <option value="" disabled>Choose recipient…</option>
            <option v-for="m in recipients" :key="m.id" :value="m.player">
              {{ m.expand?.player?.name || m.player }}
            </option>
          </select>
        </div>
        <div v-if="giving.kind === 'stack'" class="field">
          <label for="give-qty">Quantity</label>
          <input id="give-qty" v-model.number="giveQty" type="number" min="1" />
        </div>
        <div v-if="giveError" class="error">{{ giveError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="giveBusy" @click="confirmGive">Give</button>
          <button :disabled="giveBusy" @click="closeGive">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
