<script setup>
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import { useToast } from '../composables/useToast'
import { errorMessage } from '../utils/errors'
import { currencyLabel } from '../utils/money'
import { entryWeight, totalWeight, formatWeight } from '../utils/weight'

const props = defineProps({
  playerId: { type: String, required: true },
})

const game = useGameStore()
const { show } = useToast()

const unit = computed(() => game.system?.weight_unit || 'lb')
const isSelf = computed(() => props.playerId === game.myPlayerId)

const personEntries = computed(() => game.inventoryFor(props.playerId, 'person'))
const stashEntries = computed(() => game.inventoryFor(props.playerId, 'stash'))

const giving = ref(null)
const giveTo = ref('')
const giveQty = ref(1)
const giveError = ref('')
const busy = ref(false)

const recipients = computed(() =>
  game.players.filter((m) => m.player !== props.playerId)
)

function valueLabel(item) {
  if (!item || !(item.value > 0)) return ''
  const currency = game.currencyMap[item.value_currency]
  return currency ? `${item.value} ${currencyLabel(currency)}` : String(item.value)
}

function qtyLabel(entry) {
  const item = entry.expand?.item
  if (!item) return ''
  if (item.kind === 'stack') return `× ${entry.quantity}`
  if (item.kind === 'charges') return `${entry.charges_current}/${item.max_charges} charges`
  return ''
}

async function onUse(entry) {
  try {
    await game.useItem(entry.id)
  } catch (err) {
    show(errorMessage(err))
  }
}

async function onMove(entry) {
  try {
    await game.moveItem(entry.id, entry.location === 'person' ? 'stash' : 'person')
  } catch (err) {
    show(errorMessage(err))
  }
}

async function onDrop(entry) {
  const label = game.isGM ? 'Take' : 'Drop'
  if (!confirm(`${label} "${entry.expand?.item?.name || 'this item'}"?`)) return
  try {
    await game.dropItem(entry.id)
    show(game.isGM ? 'Item taken' : 'Item dropped')
  } catch (err) {
    show(errorMessage(err))
  }
}

function openGive(entry) {
  giving.value = entry
  giveTo.value = ''
  giveQty.value = 1
  giveError.value = ''
}

function closeGive() {
  giving.value = null
  giveError.value = ''
}

async function confirmGive() {
  const entry = giving.value
  if (!entry) return
  if (!giveTo.value) {
    giveError.value = 'Choose a recipient'
    return
  }
  const item = entry.expand?.item
  const payload = { inventoryId: entry.id, toPlayerId: giveTo.value }
  if (item?.kind === 'stack') {
    const q = Number(giveQty.value)
    if (!q || q < 1 || q > entry.quantity) {
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
    <section v-for="section in ['person', 'stash']" :key="section" style="margin-bottom: 1.5rem">
      <div class="row" style="margin-bottom: 0.5rem">
        <h2 class="grow" style="margin: 0">
          {{ section === 'person' ? 'On person' : 'Stash' }}
        </h2>
        <span class="small muted">
          {{ formatWeight(totalWeight(section === 'person' ? personEntries : stashEntries), unit) }}
        </span>
      </div>

      <div
        v-if="!(section === 'person' ? personEntries : stashEntries).length"
        class="muted small"
      >
        No items.
      </div>

      <div v-else class="list">
        <div
          v-for="entry in section === 'person' ? personEntries : stashEntries"
          :key="entry.id"
          class="list-item"
        >
          <div class="grow">
            <div>
              <strong>{{ entry.expand?.item?.name || 'Unknown item' }}</strong>
              <span v-if="entry.expand?.item?.category" class="small muted">
                · {{ entry.expand.item.category }}
              </span>
            </div>
            <div class="small muted">
              <span v-if="qtyLabel(entry)">{{ qtyLabel(entry) }}</span>
              <span v-if="entry.expand?.item?.weight > 0">
                · {{ formatWeight(entryWeight(entry), unit) }}
              </span>
              <span v-if="valueLabel(entry.expand?.item)">
                · {{ valueLabel(entry.expand?.item) }}
              </span>
            </div>
          </div>

          <div class="row">
            <button
              v-if="isSelf && section === 'person' && entry.expand?.item?.kind === 'charges' && entry.charges_current > 0"
              class="primary"
              @click="onUse(entry)"
            >
              Use
            </button>
            <button v-if="isSelf" @click="openGive(entry)">Give</button>
            <button v-if="isSelf" @click="onMove(entry)">
              {{ section === 'person' ? 'Stash' : 'Pocket' }}
            </button>
            <button
              v-if="isSelf || game.isGM"
              class="danger"
              @click="onDrop(entry)"
            >
              {{ game.isGM ? 'Take' : 'Drop' }}
            </button>
          </div>
        </div>
      </div>
    </section>

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
        <div v-if="!recipients.length" class="small muted">There are no other players to give to.</div>
        <div v-if="giveError" class="error">{{ giveError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="busy || !recipients.length" @click="confirmGive">
            Give
          </button>
          <button :disabled="busy" @click="closeGive">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
