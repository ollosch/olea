<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '../stores/game'
import { useAuthStore } from '../stores/auth'
import { errorMessage } from '../utils/errors'
import { useToast } from '../composables/useToast'
import InventoryPanel from '../components/InventoryPanel.vue'
import WalletPanel from '../components/WalletPanel.vue'
import MembersPanel from '../components/MembersPanel.vue'
import ItemsPanel from '../components/ItemsPanel.vue'

const route = useRoute()
const router = useRouter()
const game = useGameStore()
const auth = useAuthStore()
const { show } = useToast()

const tab = ref('inventory')
const selectedPlayerId = ref(null)
const deleteBusy = ref(false)

onMounted(async () => {
  await game.openGame(route.params.id)
  selectInitialPlayer()
})

onBeforeUnmount(() => game.closeGame())

watch(
  () => game.players,
  () => selectInitialPlayer()
)

function selectInitialPlayer() {
  if (game.isGM) {
    if (!game.players.some((m) => m.player === selectedPlayerId.value)) {
      selectedPlayerId.value = game.players[0]?.player || null
    }
  } else {
    selectedPlayerId.value = game.myPlayerId
  }
}

const playerOptions = computed(() =>
  game.players.map((m) => ({
    id: m.player,
    name: m.expand?.player?.name || 'Unknown',
  }))
)

const gameName = computed(() => game.activeGame?.name || '')
const isGM = computed(() => game.isGM)

async function onDeleteGame() {
  if (deleteBusy.value) return
  if (!confirm(`Delete "${gameName.value}"? This removes all memberships, wallets and items.`)) {
    return
  }
  deleteBusy.value = true
  try {
    await game.deleteGame(game.activeGame.id)
    show('Game deleted')
    router.push('/games')
  } catch (err) {
    show(errorMessage(err))
  } finally {
    deleteBusy.value = false
  }
}
</script>

<template>
  <div class="page wide">
    <div class="row" style="margin-bottom: 0.75rem">
      <button class="ghost" @click="router.push('/games')">← Back</button>
      <h1 class="grow" style="margin: 0">{{ gameName }}</h1>
      <span class="small muted">{{ game.system?.name }}</span>
      <span v-if="isGM" class="small muted">GM</span>
      <button class="ghost" @click="auth.logout(); router.push('/')">Logout</button>
    </div>

    <div v-if="isGM" class="field" style="max-width: 300px">
      <label for="player-select">Viewing player</label>
      <select v-if="playerOptions.length" id="player-select" v-model="selectedPlayerId">
        <option v-for="m in playerOptions" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
      <p v-else class="small muted">No players yet.</p>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'inventory' }" @click="tab = 'inventory'">
        Inventory
      </button>
      <button class="tab" :class="{ active: tab === 'money' }" @click="tab = 'money'">Money</button>
      <button class="tab" :class="{ active: tab === 'members' }" @click="tab = 'members'">
        Members
      </button>
      <button
        v-if="isGM"
        class="tab"
        :class="{ active: tab === 'catalog' }"
        @click="tab = 'catalog'"
      >
        Catalog
      </button>
    </div>

    <div v-if="game.loading" class="muted">Loading…</div>

    <template v-else>
      <p v-if="!selectedPlayerId && (tab === 'inventory' || tab === 'money')" class="muted">
        No players yet. Add players in the Members tab.
      </p>

      <InventoryPanel
        v-else-if="tab === 'inventory'"
        :player-id="selectedPlayerId"
      />
      <WalletPanel
        v-else-if="tab === 'money'"
        :player-id="selectedPlayerId"
      />
      <MembersPanel v-else-if="tab === 'members'" />
      <ItemsPanel v-else-if="tab === 'catalog' && isGM" />

      <div v-if="isGM && tab === 'members'" class="row" style="margin-top: 1.5rem">
        <div class="grow"></div>
        <button class="danger" :disabled="deleteBusy" @click="onDeleteGame">
          {{ deleteBusy ? 'Deleting…' : 'Delete game' }}
        </button>
      </div>
    </template>
  </div>
</template>
