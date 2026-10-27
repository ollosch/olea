<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '../stores/game'
import { currencyLabel } from '../utils/money'

const route = useRoute()
const router = useRouter()
const game = useGameStore()

const playerId = route.params.playerId

onMounted(async () => {
  await game.openGame(route.params.id)
})
onBeforeUnmount(() => game.closeGame())

const playerName = computed(() => {
  const m = game.members.find((x) => x.player === playerId)
  return m?.expand?.player?.name || 'Unknown player'
})

const gameName = computed(() => game.activeGame?.name || '')

const wallet = computed(() => game.walletFor(playerId))
const inventory = computed(() => game.inventoryFor(playerId))

const currencies = computed(() => [...game.currencies].sort((a, b) => a.sort - b.sort))

const optimizedLabel = computed(() =>
  wallet.value.optimized
    .map(({ currency, amount }) => `${amount} ${currencyLabel(currency)}`)
    .join(' ')
)

function qtyLabel(e) {
  const item = e.expand?.item
  if (!item) return ''
  if (item.kind === 'stack') return String(e.quantity)
  if (item.kind === 'charges') return `${e.charges_current}/${item.max_charges}`
  return ''
}

function weightLabel(e) {
  const item = e.expand?.item
  return item && item.weight > 0 ? String(item.weight) : ''
}

function valueLabel(e) {
  const item = e.expand?.item
  if (!item || !(item.value > 0)) return ''
  const symbol = game.currencyMap[item.value_currency]
    ? currencyLabel(game.currencyMap[item.value_currency])
    : ''
  return symbol ? `${item.value} ${symbol}` : String(item.value)
}

function print() {
  window.print()
}
</script>

<template>
  <div class="print-sheet">
    <div class="no-print" style="margin-bottom: 1rem">
      <button class="primary" @click="print">Print</button>
      <button @click="router.back()">Back</button>
    </div>

    <h1>{{ playerName }}</h1>
    <p class="muted" style="margin-top: 0">{{ gameName }}</p>

    <section v-if="currencies.length" style="margin-bottom: 1.5rem">
      <h2>Money</h2>
      <table>
        <tbody>
          <tr v-for="c in currencies" :key="c.id">
            <td>{{ c.name }}</td>
            <td>{{ wallet.amounts[c.id] || 0 }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="optimizedLabel"><strong>Optimized total:</strong> {{ optimizedLabel }}</p>
    </section>

    <section>
      <h2>Items</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Qty/Charges</th>
            <th>Weight</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in inventory" :key="e.id">
            <td>{{ e.expand?.item?.name || 'Unknown' }}</td>
            <td>{{ qtyLabel(e) }}</td>
            <td>{{ weightLabel(e) }}</td>
            <td>{{ valueLabel(e) }}</td>
          </tr>
          <tr v-if="!inventory.length">
            <td colspan="4" class="muted">No items</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}

th,
td {
  text-align: left;
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid var(--border);
  color: inherit;
}

th {
  font-weight: 600;
}
</style>
