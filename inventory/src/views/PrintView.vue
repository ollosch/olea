<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '../stores/game'
import { currencyLabel } from '../utils/money'
import { entryWeight, totalWeight, formatWeight } from '../utils/weight'

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
const unit = computed(() => game.system?.weight_unit || 'lb')

const wallet = computed(() => game.walletFor(playerId))
const personItems = computed(() => game.inventoryFor(playerId, 'person'))
const stashItems = computed(() => game.inventoryFor(playerId, 'stash'))

const currencies = computed(() => [...game.currencies].sort((a, b) => a.sort - b.sort))

function optimizedLabel(part) {
  const parts = part.optimized
    .filter((x) => x.amount > 0)
    .map((x) => `${x.amount} ${currencyLabel(x.currency)}`)
  return parts.length ? parts.join(' ') : '0'
}

function qtyLabel(entry) {
  const item = entry.expand?.item
  if (!item) return ''
  if (item.kind === 'stack') return String(entry.quantity)
  if (item.kind === 'charges') return `${entry.charges_current}/${item.max_charges}`
  return ''
}

function weightLabel(entry) {
  return formatWeight(entryWeight(entry), unit.value)
}

function valueLabel(entry) {
  const item = entry.expand?.item
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
        <thead>
          <tr>
            <th>Currency</th>
            <th>On person</th>
            <th>Stash</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in currencies" :key="c.id">
            <td>{{ c.name }}</td>
            <td>{{ wallet.person.amounts[c.id] || 0 }}</td>
            <td>{{ wallet.stash.amounts[c.id] || 0 }}</td>
          </tr>
        </tbody>
      </table>
      <p><strong>On person optimized:</strong> {{ optimizedLabel(wallet.person) }}</p>
      <p><strong>Stash optimized:</strong> {{ optimizedLabel(wallet.stash) }}</p>
    </section>

    <section style="margin-bottom: 1.5rem">
      <h2>Items on person</h2>
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
          <tr v-for="e in personItems" :key="e.id">
            <td>{{ e.expand?.item?.name || 'Unknown' }}</td>
            <td>{{ qtyLabel(e) }}</td>
            <td>{{ weightLabel(e) }}</td>
            <td>{{ valueLabel(e) }}</td>
          </tr>
          <tr v-if="!personItems.length">
            <td colspan="4" class="muted">No items</td>
          </tr>
        </tbody>
      </table>
      <p><strong>Total carried:</strong> {{ formatWeight(totalWeight(personItems), unit) }}</p>
    </section>

    <section>
      <h2>Stash</h2>
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
          <tr v-for="e in stashItems" :key="e.id">
            <td>{{ e.expand?.item?.name || 'Unknown' }}</td>
            <td>{{ qtyLabel(e) }}</td>
            <td>{{ weightLabel(e) }}</td>
            <td>{{ valueLabel(e) }}</td>
          </tr>
          <tr v-if="!stashItems.length">
            <td colspan="4" class="muted">No items</td>
          </tr>
        </tbody>
      </table>
      <p><strong>Stash total:</strong> {{ formatWeight(totalWeight(stashItems), unit) }}</p>
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
