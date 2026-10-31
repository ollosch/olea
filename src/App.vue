<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'
import { pb } from './lib/pocketbase'

const defaultAccent = '#a6d68d'
const accent = ref(defaultAccent)
const browserAccent = ref(defaultAccent)
const connection = ref<'checking' | 'connected' | 'unavailable'>('checking')
const route = useRoute()
const activeProfileId = ref('')
let profileLookup = 0

try {
  const saved = localStorage.getItem('olea.accent')
  if (saved && /^#[0-9a-f]{6}$/i.test(saved)) {
    accent.value = saved
    browserAccent.value = saved
  }
} catch {
  // The app still works if browser storage is disabled.
}

onMounted(async () => {
  window.addEventListener('olea-character-selected', refreshActiveProfile)
  window.addEventListener('olea-profile-changed', refreshActiveProfile)
  try {
    await pb.health.check()
    connection.value = 'connected'
  } catch {
    connection.value = 'unavailable'
  }
})

watch(() => route.fullPath, refreshActiveProfile, { immediate: true })

async function refreshActiveProfile() {
  const token = ++profileLookup
  activeProfileId.value = ''

  const characterId = String(route.params.characterId ?? '')
  const isPlayerRoute = route.name === 'characters' || route.name === 'character-overview'
  const selectedCharacterId = characterId || (isPlayerRoute ? readStoredCharacter() : '')
  try {
    if (selectedCharacterId) {
      const character = await pb.collection('characters').getOne<{ id: string; game: string; owner: string }>(selectedCharacterId)
      if (token !== profileLookup) return
      activeProfileId.value = character.owner || ''
    } else {
      const gameId = String(route.params.gameId ?? '')
      if (gameId) {
        const game = await pb.collection('games').getOne<{ id: string; gm_profile: string }>(gameId)
        if (token !== profileLookup) return
        activeProfileId.value = game.gm_profile || ''
      } else {
        // On the GM workspace, the currently assigned game master is the active person.
        const games = await pb.collection('games').getFullList<{ gm_profile: string }>({ sort: '-updated', fields: 'gm_profile' })
        if (token !== profileLookup) return
        activeProfileId.value = games.find((game) => game.gm_profile)?.gm_profile ?? ''
      }
    }
    await applyProfileAccent(token)
  } catch {
    // Keep the browser-local choice if no active record is available.
    if (token === profileLookup) { activeProfileId.value = ''; accent.value = browserAccent.value; applyLocalAccent() }
  }
}

watch(accent, applyLocalAccent, { immediate: true })

function readStoredCharacter() {
  try { return localStorage.getItem('olea.selectedCharacter') ?? '' } catch { return '' }
}

function isValidAccent(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function applyLocalAccent() {
  document.documentElement.style.setProperty('--accent', accent.value)
}

async function applyProfileAccent(token: number) {
  if (!activeProfileId.value) {
    accent.value = browserAccent.value
    applyLocalAccent()
    return
  }
  const profile = await pb.collection('profiles').getOne<{ accent: string }>(activeProfileId.value)
  if (token !== profileLookup) return
  if (isValidAccent(profile.accent)) {
    accent.value = profile.accent
  } else {
    accent.value = browserAccent.value
    applyLocalAccent()
  }
}

async function saveAccent() {
  const value = accent.value
  applyLocalAccent()
  if (!activeProfileId.value) {
    browserAccent.value = value
    try { localStorage.setItem('olea.accent', value) } catch { /* Browser fallback preference is optional. */ }
    return
  }
  try {
    await pb.collection('profiles').update(activeProfileId.value, { accent: value })
  } catch {
    // Keep the selected accent locally if the profile preference could not be saved.
  }
}

function resetAccent() {
  accent.value = defaultAccent
  void saveAccent()
}
</script>

<template>
  <div class="min-h-screen">
    <a class="skip-link" href="#main">Skip to main content</a>
    <header class="topbar">
      <RouterLink class="brand" to="/games" aria-label="Olea home">
        <span class="brand-mark" aria-hidden="true">✳</span>
        <span>olea<span class="brand-dot">.</span></span>
      </RouterLink>
      <div class="header-actions">
        <span class="connection" role="status">
          <span class="status-dot" :class="{ online: connection === 'connected' }" />
          <span v-if="connection === 'checking'">Connecting</span>
          <span v-else-if="connection === 'connected'">Local server ready</span>
          <span v-else>Server unavailable</span>
        </span>
        <DialogRoot>
          <DialogTrigger class="icon-button" aria-label="Open appearance settings" title="Appearance">
            <span aria-hidden="true">◐</span>
          </DialogTrigger>
          <DialogPortal>
            <DialogOverlay class="dialog-overlay" />
            <DialogContent class="dialog-content">
              <div class="dialog-heading">
                <div>
                  <p class="eyebrow">MAKE IT YOURS</p>
                  <DialogTitle class="dialog-title">Appearance</DialogTitle>
                </div>
                <DialogClose class="icon-button" aria-label="Close appearance settings">×</DialogClose>
              </div>
              <DialogDescription class="dialog-description">
                Choose an accent for the active profile or this browser.
              </DialogDescription>
              <label class="color-setting" for="accent-color">
                <span><strong>Accent color</strong><small>{{ activeProfileId ? 'Saved to your local profile.' : 'Saved on this browser until a profile is active.' }}</small></span>
                <input id="accent-color" v-model="accent" type="color" aria-label="Accent color" @change="saveAccent" />
              </label>
              <button class="secondary-button" type="button" @click="resetAccent">Reset to green</button>
            </DialogContent>
          </DialogPortal>
        </DialogRoot>
      </div>
    </header>

    <div class="app-layout">
      <nav class="primary-nav" aria-label="Main navigation">
        <p class="nav-label">YOUR TABLE</p>
        <RouterLink class="nav-link" active-class="is-active" to="/games">
          <span class="nav-icon" aria-hidden="true">◇</span><span>Games</span>
          <span class="nav-context">GM</span>
        </RouterLink>
        <RouterLink class="nav-link" active-class="is-active" to="/characters">
          <span class="nav-icon" aria-hidden="true">✧</span><span>Choose character</span>
          <span class="nav-context">PLAYER</span>
        </RouterLink>
        <RouterLink class="nav-link" active-class="is-active" to="/catalog">
          <span class="nav-icon" aria-hidden="true">⌕</span><span>Catalog</span>
          <span class="nav-context">GM</span>
        </RouterLink>
        <div class="nav-note">
          <span aria-hidden="true">✦</span>
          <p>More tools for your table are on their way.</p>
        </div>
      </nav>
      <main id="main" class="page" tabindex="-1">
        <RouterView v-slot="{ Component, route: currentRoute }"><component :is="Component" :key="currentRoute.path" /></RouterView>
      </main>
    </div>
    <footer class="footer"><span>OLEA <span class="footer-divider">/</span> A TTRPG COMPANION</span><span>Made for stories shared around a table.</span></footer>
  </div>
</template>
