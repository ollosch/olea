<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { errorMessage } from '../utils/errors'

const router = useRouter()
const auth = useAuthStore()

const name = ref('')
const error = ref('')
const submitting = ref(false)

async function submit() {
  if (!name.value.trim() || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    await auth.login(name.value.trim())
    router.push('/games')
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page">
    <form class="card" style="max-width: 360px; margin: 15vh auto 0" @submit.prevent="submit">
      <h1>Olea</h1>
      <p class="muted">Pick a name to join your table</p>
      <div class="field">
        <label for="name">Name</label>
        <input
          id="name"
          v-model="name"
          type="text"
          placeholder="Your name"
          autocomplete="off"
          @keydown.enter="submit"
        />
      </div>
      <button type="submit" class="primary" style="width: 100%" :disabled="submitting || !name.trim()">
        {{ submitting ? 'Entering…' : 'Enter' }}
      </button>
      <div v-if="error" class="error">{{ error }}</div>
    </form>
  </div>
</template>
