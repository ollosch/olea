<script setup>
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import { useToast } from '../composables/useToast'
import { errorMessage } from '../utils/errors'

const props = defineProps({
  playerId: { type: String, required: true },
})

const game = useGameStore()
const { show } = useToast()

const entries = computed(() => game.inventoryFor(props.playerId))

const giving = ref(null)
const giveTo = ref('')
const giveQty = ref(1)
const giveError = ref('')
const busy = ref(false)

const recipients = computed(() =>
  game.members.filter((m) => m.player !== props.playerId)
)

const valueCurrency = (item) => {
  const c = game.currencyMap[item.value_currency]
  return c ? c.symbol : ''
}

async function onUse(e) {
  try {
    await game.useItem(e.id)
  } catch (err) {
    show(errorMessage(err))
  }
}

async function onDrop(e) {
  if (!confirm('Drop this item?')) return
  try {
    await game.dropItem(e.id)
  } catch (err) {
    show(errorMessage(err))
  }
}

function openGive(e) {
  giving.value = e
  giveTo.value = ''
  giveQty.value = 1
  giveError.value = ''
}

function closeGive() {
  giving.value = null
  giveError.value = ''
}

async function confirmGive() {
  const e = giving.value
  if (!e) return
  if (!giveTo.value) {
    giveError.value = 'Choose a recipient'
    return
  }
  const item = e.expand?.item
  const payload = { inventoryId: e.id, toPlayerId: giveTo.value }
  if (item?.kind === 'stack') {
    const q = Number(giveQty.value)
    if (!q || q < 1 || q > e.quantity) {
      giveError.value = 'Invalid quantity'
      return
    }
    payload.quantity = q
  }
  busy.value = true
  giveError.value = ''
  try {
    await game.giveItem(payload)
    closeGive()
    show('Item given')
  } catch (err) {
    giveError.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="!entries.length" class="muted">No items yet.</div>
    <div v-else class="list">
      <div v-for="e in entries" :key="e.id" class="list-item">
        <div class="grow">
          <div>
            <strong>{{ e.expand?.item?.name }}</strong>
            <span v-if="e.expand?.item?.category" class="small muted">
              · {{ e.expand.item.category }}</span
            >
          </div>
          <div class="small muted">
            <span v-if="e.expand?.item?.kind === 'stack'">× {{ e.quantity }}</span>
            <span v-else-if="e.expand?.item?.kind === 'charges'"
              >{{ e.charges_current }} / {{ e.expand?.item?.max_charges }} charges</span
            >
            <span v-if="e.expand?.item?.weight > 0">{{ e.expand.item.weight }} lb</span>
            <span v-if="e.expand?.item?.value > 0">
              {{ e.expand.item.value }} {{ valueCurrency(e.expand.item) }}</span
            >
          </div>
        </div>
        <div class="row">
          <button
            v-if="e.expand?.item?.kind === 'charges' && e.charges_current > 0"
            class="primary"
            @click="onUse(e)"
          >
            Use
          </button>
          <button @click="openGive(e)">Give</button>
          <button
            v-if="e.owner === game.myPlayerId || game.isGM"
            class="danger"
            @click="onDrop(e)"
          >
            Drop
          </button>
        </div>
      </div>
    </div>

    <div v-if="giving" class="modal-backdrop" @click.self="closeGive">
      <div class="modal">
        <h3>Give "{{ giving.expand?.item?.name }}"</h3>
        <div class="field">
          <label for="give-to">To</label>
          <select id="give-to" v-model="giveTo">
            <option value="" disabled>Choose recipient…</option>
            <option v-for="m in recipients" :key="m.id" :value="m.player">
              {{ m.expand?.player?.name || m.player }}
            </option>
          </select>
        </div>
        <div v-if="giving.expand?.item?.kind === 'stack'" class="field">
          <label for="give-qty">Quantity</label>
          <input
            id="give-qty"
            v-model.number="giveQty"
            type="number"
            min="1"
            :max="giving.quantity"
          />
        </div>
        <div v-if="giveError" class="error">{{ giveError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="busy" @click="confirmGive">Give</button>
          <button :disabled="busy" @click="closeGive">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
