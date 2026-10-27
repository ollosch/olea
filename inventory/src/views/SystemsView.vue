<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game'
import { useAuthStore } from '../stores/auth'
import { errorMessage } from '../utils/errors'
import { useToast } from '../composables/useToast'

const router = useRouter()
const game = useGameStore()
const auth = useAuthStore()
const { show } = useToast()

const showModal = ref(false)
const submitting = ref(false)
const error = ref('')
const name = ref('')
const description = ref('')
const weightUnit = ref('lb')

onMounted(async () => {
  await Promise.all([game.loadGames(), game.loadSystems()])
})

function openModal() {
  name.value = ''
  description.value = ''
  weightUnit.value = 'lb'
  error.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

async function create() {
  if (!name.value.trim() || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const record = await game.createSystem({
      name: name.value.trim(),
      description: description.value.trim(),
      weight_unit: weightUnit.value,
    })
    showModal.value = false
    show('System created')
    router.push('/systems/' + record.id)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    submitting.value = false
  }
}

async function onDelete(system) {
  if (!confirm(`Delete system "${system.name}"?`)) return
  try {
    await game.deleteSystem(system.id)
    show('System deleted')
  } catch (err) {
    show(errorMessage(err))
  }
}
</script>

<template>
  <div class="page wide">
    <div class="row" style="margin-bottom: 0.75rem">
      <button class="ghost" @click="router.push('/games')">← Games</button>
      <h1 class="grow" style="margin: 0">Systems</h1>
      <span class="small muted">{{ auth.player?.name }}</span>
      <button class="ghost" @click="auth.logout(); router.push('/')">Logout</button>
    </div>

    <div v-if="game.isGlobalGM" class="row" style="margin-bottom: 1rem">
      <button class="primary" @click="openModal">+ New system</button>
    </div>

    <p v-if="!game.isGlobalGM" class="muted">
      Systems are shared by all GMs. Become a GM in at least one game to create or edit them.
    </p>

    <p v-if="!game.systems.length" class="muted">No systems yet.</p>

    <div v-else class="list">
      <div v-for="system in game.systems" :key="system.id" class="list-item">
        <div class="grow" style="cursor: pointer" @click="router.push('/systems/' + system.id)">
          <div>
            <strong>{{ system.name }}</strong>
            <span class="small muted"> · {{ system.weight_unit || 'lb' }}</span>
          </div>
          <div v-if="system.description" class="small muted">{{ system.description }}</div>
        </div>
        <button @click="router.push('/systems/' + system.id)">Open</button>
        <button v-if="game.isGlobalGM" class="danger" @click="onDelete(system)">Delete</button>
      </div>
    </div>

    <div v-if="showModal" class="modal-backdrop" @click.self="closeModal">
      <div class="modal">
        <div class="row" style="margin-bottom: 1rem">
          <h2 class="grow" style="margin: 0">New system</h2>
          <button class="ghost" @click="closeModal">✕</button>
        </div>

        <div class="field">
          <label for="system-name">Name</label>
          <input id="system-name" v-model="name" type="text" placeholder="D&D 5e" />
        </div>

        <div class="field">
          <label for="system-description">Description</label>
          <textarea id="system-description" v-model="description" rows="2"></textarea>
        </div>

        <div class="field">
          <label for="system-unit">Weight unit</label>
          <select id="system-unit" v-model="weightUnit">
            <option value="lb">Pounds (lb)</option>
            <option value="kg">Kilograms (kg)</option>
          </select>
        </div>

        <div v-if="error" class="error" style="margin-bottom: 0.75rem">{{ error }}</div>

        <div class="row">
          <button class="ghost grow" @click="closeModal">Cancel</button>
          <button class="primary grow" :disabled="submitting || !name.trim()" @click="create">
            {{ submitting ? 'Creating…' : 'Create system' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
