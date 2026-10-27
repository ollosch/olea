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

const wallet = computed(() => game.walletFor(props.playerId))
const isSelf = computed(() => props.playerId === game.myPlayerId)

const sortedCurrencies = computed(() =>
  [...game.currencies].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
)

const recipients = computed(() =>
  game.players.filter((m) => m.player !== props.playerId)
)

function optimizedLabel(part) {
  const parts = part.optimized
    .filter((x) => x.amount > 0)
    .map((x) => `${x.amount} ${currencyLabel(x.currency)}`)
  return parts.length ? parts.join(' ') : '0'
}

const giveOpen = ref(false)
const giveFrom = ref('person')
const giveTo = ref('')
const giveCurrency = ref('')
const giveAmount = ref(1)
const giveError = ref('')
const giveBusy = ref(false)

const moveOpen = ref(false)
const moveFrom = ref('person')
const moveCurrency = ref('')
const moveAmount = ref(1)
const moveError = ref('')
const moveBusy = ref(false)

const adjOpen = ref(false)
const adjLocation = ref('person')
const adjCurrency = ref('')
const adjAmount = ref(0)
const adjError = ref('')
const adjBusy = ref(false)

function openGive(from) {
  giveFrom.value = from
  giveTo.value = ''
  giveCurrency.value = game.currencies[0]?.id || ''
  giveAmount.value = 1
  giveError.value = ''
  giveOpen.value = true
}

function openMove(from = 'person') {
  moveFrom.value = from
  moveCurrency.value = game.currencies[0]?.id || ''
  moveAmount.value = 1
  moveError.value = ''
  moveOpen.value = true
}

function openAdjust(location = 'person') {
  adjLocation.value = location
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
    await game.giveMoney(giveTo.value, giveCurrency.value, amount, giveFrom.value)
    giveOpen.value = false
    show('Money sent')
  } catch (err) {
    giveError.value = errorMessage(err)
  } finally {
    giveBusy.value = false
  }
}

async function confirmMove() {
  const amount = Number(moveAmount.value)
  if (!amount || amount < 1) {
    moveError.value = 'Amount must be at least 1'
    return
  }
  moveBusy.value = true
  moveError.value = ''
  try {
    await game.moveMoney(
      moveCurrency.value,
      amount,
      moveFrom.value,
      moveFrom.value === 'person' ? 'stash' : 'person'
    )
    moveOpen.value = false
    show('Money moved')
  } catch (err) {
    moveError.value = errorMessage(err)
  } finally {
    moveBusy.value = false
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
    await game.gmMoney(props.playerId, adjCurrency.value, amount, adjLocation.value)
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
    <section v-for="location in ['person', 'stash']" :key="location" style="margin-bottom: 1.5rem">
      <div class="row" style="margin-bottom: 0.5rem">
        <h2 class="grow" style="margin: 0">
          {{ location === 'person' ? 'On person' : 'Stash' }}
        </h2>
        <span class="small muted">{{ optimizedLabel(wallet[location]) }}</span>
      </div>

      <div class="list">
        <div v-for="currency in sortedCurrencies" :key="currency.id" class="list-item">
          <span class="grow">{{ currencyLabel(currency) }}</span>
          <strong>{{ wallet[location].amounts[currency.id] || 0 }}</strong>
        </div>
      </div>

      <div v-if="isSelf" class="row" style="margin-top: 0.5rem">
        <button class="primary grow" @click="openGive(location)">
          Give from {{ location === 'person' ? 'pocket' : 'stash' }}
        </button>
        <button class="grow" @click="openMove(location)">
          Move {{ location === 'person' ? 'to stash' : 'to pocket' }}
        </button>
      </div>
      <div v-if="game.isGM" class="row" style="margin-top: 0.5rem">
        <button class="grow" @click="openAdjust(location)">
          Adjust {{ location === 'person' ? 'pocket' : 'stash' }}
        </button>
      </div>
    </section>

    <div v-if="giveOpen" class="modal-backdrop" @click.self="giveOpen = false">
      <div class="modal">
        <h3>Give money</h3>
        <div class="field">
          <label for="give-to">To</label>
          <select id="give-to" v-model="giveTo">
            <option value="" disabled>Choose recipient…</option>
            <option v-for="m in recipients" :key="m.id" :value="m.player">
              {{ m.expand?.player?.name || m.player }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="give-currency">Currency</label>
          <select id="give-currency" v-model="giveCurrency">
            <option v-for="c in game.currencies" :key="c.id" :value="c.id">
              {{ currencyLabel(c) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="give-amount">Amount</label>
          <input id="give-amount" v-model.number="giveAmount" type="number" min="1" />
        </div>
        <p class="small muted">Sending from {{ giveFrom === 'person' ? 'pocket' : 'stash' }}.</p>
        <div v-if="!recipients.length" class="small muted">There are no other players to give to.</div>
        <div v-if="giveError" class="error">{{ giveError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="giveBusy || !recipients.length" @click="confirmGive">
            Send
          </button>
          <button :disabled="giveBusy" @click="giveOpen = false">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="moveOpen" class="modal-backdrop" @click.self="moveOpen = false">
      <div class="modal">
        <h3>Move money</h3>
        <div class="field">
          <label for="move-currency">Currency</label>
          <select id="move-currency" v-model="moveCurrency">
            <option v-for="c in game.currencies" :key="c.id" :value="c.id">
              {{ currencyLabel(c) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="move-amount">Amount</label>
          <input id="move-amount" v-model.number="moveAmount" type="number" min="1" />
        </div>
        <p class="small muted">
          From {{ moveFrom === 'person' ? 'pocket' : 'stash' }} to
          {{ moveFrom === 'person' ? 'stash' : 'pocket' }}.
        </p>
        <div v-if="moveError" class="error">{{ moveError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="moveBusy" @click="confirmMove">Move</button>
          <button :disabled="moveBusy" @click="moveOpen = false">Cancel</button>
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
        <p class="small muted">
          Applying to {{ adjLocation === 'person' ? 'pocket' : 'stash' }}.
        </p>
        <div v-if="adjError" class="error">{{ adjError }}</div>
        <div class="row" style="margin-top: 1rem">
          <button class="primary grow" :disabled="adjBusy" @click="confirmAdjust">Apply</button>
          <button :disabled="adjBusy" @click="adjOpen = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
