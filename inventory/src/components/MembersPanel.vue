<script setup>
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../composables/useToast'
import { errorMessage } from '../utils/errors'

const game = useGameStore()
const auth = useAuthStore()
const { show } = useToast()

const myPlayerId = computed(() => auth.player?.id || null)
const gms = computed(() => game.gms)
const players = computed(() => game.players)

const newName = ref('')
const newRole = ref('player')
const adding = ref(false)

const memberName = (m) => m.expand?.player?.name || m.player

async function onAdd() {
  const name = newName.value.trim()
  if (!name) return
  adding.value = true
  try {
    await game.addMember(name, newRole.value)
    newName.value = ''
    show('Member added')
  } catch (err) {
    show(errorMessage(err))
  } finally {
    adding.value = false
  }
}

async function onToggleRole(m) {
  const role = m.role === 'gm' ? 'player' : 'gm'
  try {
    await game.setRole(m.id, role)
  } catch (err) {
    show(errorMessage(err))
  }
}

async function onRemove(m) {
  if (!confirm(`Remove ${memberName(m)}?`)) return
  try {
    await game.removeMember(m.id)
  } catch (err) {
    show(errorMessage(err))
  }
}
</script>

<template>
  <div>
    <div v-if="game.isGM" class="card" style="margin-bottom: 1rem">
      <h3>Add member</h3>
      <div class="row">
        <input v-model="newName" class="grow" type="text" placeholder="Player name" />
        <select v-model="newRole">
          <option value="player">Player</option>
          <option value="gm">GM</option>
        </select>
        <button class="primary" :disabled="adding || !newName.trim()" @click="onAdd">Add</button>
      </div>
    </div>

    <section style="margin-bottom: 1.5rem">
      <h2>GMs</h2>
      <div v-if="!gms.length" class="muted small">No GMs.</div>
      <div v-else class="list">
        <div v-for="m in gms" :key="m.id" class="list-item">
          <div class="grow">
            <strong>{{ memberName(m) }}</strong>
            <span v-if="m.player === myPlayerId" class="small muted"> · you</span>
          </div>
          <span class="badge gm">GM</span>
          <template v-if="game.isGM">
            <button @click="onToggleRole(m)">Make Player</button>
            <button class="danger" :disabled="m.player === myPlayerId" @click="onRemove(m)">
              Remove
            </button>
          </template>
        </div>
      </div>
    </section>

    <section>
      <h2>Players</h2>
      <div v-if="!players.length" class="muted small">No players yet.</div>
      <div v-else class="list">
        <div v-for="m in players" :key="m.id" class="list-item">
          <div class="grow">
            <strong>{{ memberName(m) }}</strong>
            <span v-if="m.player === myPlayerId" class="small muted"> · you</span>
          </div>
          <span class="badge">Player</span>
          <template v-if="game.isGM">
            <button @click="onToggleRole(m)">Make GM</button>
            <button class="danger" :disabled="m.player === myPlayerId" @click="onRemove(m)">
              Remove
            </button>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--bg-3);
  color: var(--text-dim);
  white-space: nowrap;
}
.badge.gm {
  background: rgba(56, 189, 248, 0.16);
  color: var(--accent);
}
</style>
