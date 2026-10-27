<script setup>
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import { useToast } from '../composables/useToast'
import { errorMessage } from '../utils/errors'
import { currencyLabel } from '../utils/money'

const props = defineProps({
  playerId: { type: String, required: true },
})

const game = useGameStore()
const { show } = useToast()

const w = computed(() => game.walletFor(props.playerId))

const sortedCurrencies = computed(() =>
  [...game.currencies].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
)

const optimizedTotal = computed(() => {
  const parts = w.value.optimized
    .filter((x) => x.amount > 0)
    .map((x) => `${x.amount} ${currencyLabel(x.currency)}`)
  return parts.length ? parts.join(' ') : '0'
})

const giveOpen = ref(false)
const giveTo = ref('')
const giveCurrency = ref('')
const giveAmount = ref(1)
const giveError = ref('')
const giveBusy = ref(false)

const adjOpen = ref(false)
const adjCurrency = ref('')
const adjAmount = ref(0)
const adjError = ref('')
const adjBusy = ref(false)

const giveRecipients = computed(() =>
  game.members.filter((m) => m.player !== props.playerId)
)

function openGive() {
  giveTo.value = ''
  giveCurrency.value = game.currencies[0]?.id || ''
  giveAmount.value = 1
  giveError.value = ''
  giveOpen.value = true
}

function openAdjust() {
  adjCurrency.value = game.currencies[0]?.id || ''
  adjAmount.value = 0
  adjError.value = ''
  adjOpen.value = true
}

async function confirmGive() {
  if (!giveTo.value) {
    giveError.value = 'Choose a recipient'
    return
  }
  const amount = Number(giveAmount.value)
  if (!amount || amount < 1) {
    giveError.value = 'Amount must be at least 1'
    return
  }
  giveBusy.value = true
  giveError.value = ''
  try {
    await game.giveMoney(giveTo.value, giveCurrency.value, amount)
    giveOpen.value = false
    show('Money sent')
  } catch (err) {
    giveError.value = errorMessage(err)
  } finally {
    giveBusy.value = false
  }
}

async function confirmAdjust() {
  const amount = Number(adjAmount.value)
  if (!amount) {
    adjError.value = 'Enter a non-zero amount'
    return
  }
  adjBusy.value = true
  adjError.value = ''
  try {
    await game.gmMoney(props.playerId, adjCurrency.value, amount)
    adjOpen.value = false
    show('Money adjusted')
  } catch (err) {
    adjError.value = errorMessage(err)
  } finally {
    adjBusy.value = false
  }
}
</script>

<template>
  <div>
    <div class="list">
      <div
        v-for="currency in sortedCurrencies"
        :key="currency.id"
        class="list-item"
      >
        <span class="grow">{{ currencyLabel(currency) }}</span>
        <strong>{{ w.amounts[currency.id] || 0 }}</strong>
      </div>
    </div>

    <div class="row" style="margin-top: 0.75rem">
      <span class="small muted grow">Total: {{ optimizedTotal }}</span>
    </div>

    <div class="row" style="margin-top: 0.75rem">
      <button
        v-if="playerId === game.myPlayerId"
        class="primary grow"
        @click="openGive"
      >
        Give money
      </button>
      <button v-if="game.isGM" class="grow" @click="openAdjust">Adjust money</button>
    </div>

    <div v-if="giveOpen" class="modal-backdrop" @click.self="giveOpen = false">
      <div class="modal">
        <h3>Give money</h3>
        <div class="field">
          <label for="gm-to">To</label>
          <select id="gm-to" v-model="giveTo">
            <option value="" disabled>Choose recipient…</option>
            <option v-for="m in giveRecipients" :key="m.id" :value="m.player">
              {{ m.expand?.player?.name || m.player }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="gm-currency">Currency</label>
          <select id="gm-currency" v-model="giveCurrency">
            <option v-for="c in game.currencies" :key="c.id" :value="c.id">
              {{ currencyLabel(c) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="gm-amount">Amount</label>
          <input id="gm-amount" v-model.number="giveAmount" type="number" min="1" />
        </div>
        <div v-if="giveError" class="error">{{ giveError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="giveBusy" @click="confirmGive">
            Send
          </button>
          <button :disabled="giveBusy" @click="giveOpen = false">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="adjOpen" class="modal-backdrop" @click.self="adjOpen = false">
      <div class="modal">
        <h3>Adjust money</h3>
        <div class="field">
          <label for="adj-currency">Currency</label>
          <select id="adj-currency" v-model="adjCurrency">
            <option v-for="c in game.currencies" :key="c.id" :value="c.id">
              {{ currencyLabel(c) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="adj-amount">Amount (positive to give, negative to take)</label>
          <input id="adj-amount" v-model.number="adjAmount" type="number" />
        </div>
        <div v-if="adjError" class="error">{{ adjError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="adjBusy" @click="confirmAdjust">
            Apply
          </button>
          <button :disabled="adjBusy" @click="adjOpen = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
