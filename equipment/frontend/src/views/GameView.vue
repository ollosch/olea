<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '../stores/game'
import { useAuthStore } from '../stores/auth'
import InventoryPanel from '../components/InventoryPanel.vue'
import WalletPanel from '../components/WalletPanel.vue'
import MembersPanel from '../components/MembersPanel.vue'
import ItemsPanel from '../components/ItemsPanel.vue'

const route = useRoute()
const router = useRouter()
const game = useGameStore()
const auth = useAuthStore()

const tab = ref('inventory')
const selectedPlayerId = ref(null)

onMounted(async () => {
  await game.openGame(route.params.id)
  selectedPlayerId.value = game.myPlayerId
})
onBeforeUnmount(() => game.closeGame())

const memberOptions = computed(() =>
  game.members.map((m) => ({ id: m.player, name: m.expand?.player?.name || 'Unknown' }))
)

watch(
  () => game.members,
  () => {
    if (!game.members.some((m) => m.player === selectedPlayerId.value)) {
      selectedPlayerId.value = game.myPlayerId
    }
  }
)

const gameName = computed(() => game.activeGame?.name || '')
const isGM = computed(() => game.isGM)
</script>

<template>
  <div class="page wide">
    <div class="row" style="margin-bottom: 0.75rem">
      <button class="ghost" @click="router.push('/games')">← Back</button>
      <h1 class="grow" style="margin: 0">{{ gameName }}</h1>
      <span v-if="isGM" class="small muted">GM</span>
      <button class="ghost" @click="auth.logout(); router.push('/')">Logout</button>
    </div>

    <div v-if="isGM" class="field" style="max-width: 260px">
      <label for="player-select">Viewing player</label>
      <select id="player-select" v-model="selectedPlayerId">
        <option v-for="m in memberOptions" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'inventory' }" @click="tab = 'inventory'">Inventory</button>
      <button class="tab" :class="{ active: tab === 'money' }" @click="tab = 'money'">Money</button>
      <button class="tab" :class="{ active: tab === 'members' }" @click="tab = 'members'">Members</button>
      <button v-if="isGM" class="tab" :class="{ active: tab === 'items' }" @click="tab = 'items'">Items</button>
    </div>

    <div v-if="game.loading" class="muted">Loading…</div>

    <InventoryPanel v-else-if="tab === 'inventory'" :player-id="selectedPlayerId" />
    <WalletPanel v-else-if="tab === 'money'" :player-id="selectedPlayerId" />
    <MembersPanel v-else-if="tab === 'members'" />
    <ItemsPanel v-else-if="tab === 'items' && isGM" />
  </div>
</template>
