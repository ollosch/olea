<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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

type GameLookup = {
  id: string
  name: string
  gm_profile: string
  encounter_visible: boolean
}
type CharacterLookup = {
  id: string
  name: string
  game: string
  owner: string
  expand?: { game?: { id: string; name: string; encounter_visible: boolean } }
}
type GameContext = { id: string; name: string; encounterVisible: boolean }
type CharacterContext = { id: string; name: string; gameId: string; encounterVisible: boolean }
type SelectedCharacter = { id: string; name: string }

const defaultAccent = '#a6d68d'
const accent = ref(defaultAccent)
const browserAccent = ref(defaultAccent)
const connection = ref<'checking' | 'connected' | 'unavailable'>('checking')
const route = useRoute()
const activeProfileId = ref('')
const gameContext = ref<GameContext | null>(null)
const characterContext = ref<CharacterContext | null>(null)
const selectedCharacter = ref<SelectedCharacter | null>(null)
let profileLookup = 0

const isPlayerView = computed(() => route.meta.playerView === true)
const gameSectionActive = computed(() => ['games', 'game-characters', 'game-encounters', 'game-tables', 'print-monsters'].includes(String(route.name)))
const characterSectionActive = computed(() => ['characters', 'character-overview', 'character-inventory', 'character-spellbooks', 'print-items', 'print-spellbook'].includes(String(route.name)))
const catalogSectionActive = computed(() => ['catalog', 'catalog-detail'].includes(String(route.name)))

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
  window.addEventListener('online', refreshConnection)
  window.addEventListener('focus', refreshConnection)
  document.addEventListener('visibilitychange', refreshOnVisible)
  await refreshConnection()
})

onUnmounted(() => {
  window.removeEventListener('olea-character-selected', refreshActiveProfile)
  window.removeEventListener('olea-profile-changed', refreshActiveProfile)
  window.removeEventListener('online', refreshConnection)
  window.removeEventListener('focus', refreshConnection)
  document.removeEventListener('visibilitychange', refreshOnVisible)
})

async function refreshOnVisible() { if (document.visibilityState === 'visible') await refreshConnection() }
async function refreshConnection() {
  try {
    await pb.health.check()
    connection.value = 'connected'
    window.dispatchEvent(new Event('olea-reconnected'))
  } catch { connection.value = 'unavailable' }
}

watch(() => route.fullPath, refreshActiveProfile, { immediate: true })

async function refreshActiveProfile() {
  const token = ++profileLookup
  activeProfileId.value = ''

  const characterId = String(route.params.characterId ?? '')
  const gameId = String(route.params.gameId ?? '')
  const isPlayerRoot = route.name === 'characters' || route.name === 'character-overview'
  const storedCharacterId = readStoredCharacter()
  const selectedCharacterId = characterId || (isPlayerRoot ? storedCharacterId : '')

  try {
    let characterRecord: CharacterLookup | null = null
    let gameRecord: GameLookup | null = null

    if (selectedCharacterId) {
      characterRecord = await pb.collection('characters').getOne<CharacterLookup>(selectedCharacterId, { expand: 'game', requestKey: null })
      if (token !== profileLookup) return
      activeProfileId.value = characterRecord.owner || ''
    } else if (gameId) {
      gameRecord = await pb.collection('games').getOne<GameLookup>(gameId, { requestKey: null })
      if (token !== profileLookup) return
      activeProfileId.value = gameRecord.gm_profile || ''
    } else {
      // On the GM workspace, the currently assigned game master is the active person.
      const games = await pb.collection('games').getFullList<{ gm_profile: string }>({ sort: 'name', fields: 'gm_profile', requestKey: null })
      if (token !== profileLookup) return
      activeProfileId.value = games.find((game) => game.gm_profile)?.gm_profile ?? ''
    }

    setNavigationContext(characterRecord, gameRecord)
    await loadSelectedCharacter(token, storedCharacterId, characterRecord)
    if (token !== profileLookup) return
    await applyProfileAccent(token)
  } catch {
    // Keep the browser-local choice if no active record is available.
    if (token === profileLookup) {
      activeProfileId.value = ''
      accent.value = browserAccent.value
      applyLocalAccent()
      gameContext.value = null
      characterContext.value = null
      selectedCharacter.value = null
    }
  }
}

function setNavigationContext(characterRecord: CharacterLookup | null, gameRecord: GameLookup | null) {
  if (characterRecord) {
    characterContext.value = {
      id: characterRecord.id,
      name: characterRecord.name,
      gameId: characterRecord.game,
      encounterVisible: !!characterRecord.expand?.game?.encounter_visible,
    }
    gameContext.value = null
    return
  }
  if (gameRecord) {
    gameContext.value = {
      id: gameRecord.id,
      name: gameRecord.name,
      encounterVisible: !!gameRecord.encounter_visible,
    }
    characterContext.value = null
    return
  }
  gameContext.value = null
  characterContext.value = null
}

async function loadSelectedCharacter(token: number, storedCharacterId: string, current: CharacterLookup | null) {
  if (!storedCharacterId) {
    selectedCharacter.value = null
    return
  }
  if (current?.id === storedCharacterId) {
    selectedCharacter.value = { id: current.id, name: current.name }
    return
  }
  try {
    const character = await pb.collection('characters').getOne<{ id: string; name: string }>(storedCharacterId, { fields: 'id,name', requestKey: null })
    if (token === profileLookup) selectedCharacter.value = { id: character.id, name: character.name }
  } catch {
    if (token === profileLookup) selectedCharacter.value = null
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
  const profile = await pb.collection('profiles').getOne<{ accent: string }>(activeProfileId.value, { requestKey: null })
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
      <RouterLink class="brand" :to="isPlayerView ? '/characters' : '/games'" aria-label="Olea home">
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
        <div class="nav-group">
          <p class="nav-label">YOUR TABLE</p>
          <RouterLink v-if="!isPlayerView" class="nav-link" :class="{ 'is-active': gameSectionActive }" to="/games">
            <span class="nav-icon" aria-hidden="true">◇</span><span>Games</span>
            <span class="nav-context">GM</span>
          </RouterLink>
          <RouterLink class="nav-link" :class="{ 'is-active': characterSectionActive }" to="/characters">
            <span class="nav-icon" aria-hidden="true">✧</span><span>Choose character</span>
            <span class="nav-context">PLAYER</span>
          </RouterLink>
          <RouterLink v-if="!isPlayerView" class="nav-link" :class="{ 'is-active': catalogSectionActive }" to="/catalog">
            <span class="nav-icon" aria-hidden="true">⌕</span><span>Catalog</span>
            <span class="nav-context">GM</span>
          </RouterLink>
        </div>

        <div v-if="gameContext && !isPlayerView" class="nav-group nav-context-group" aria-label="Game tools">
          <p class="nav-label">
            <span class="nav-label-mark">GAME</span>
            <span class="nav-context-title">{{ gameContext.name }}</span>
          </p>
          <RouterLink class="nav-link nav-link-context" :class="{ 'is-active': route.name === 'game-characters' }" :to="{ name: 'game-characters', params: { gameId: gameContext.id } }">
            <span class="nav-icon" aria-hidden="true">✧</span><span>Characters</span>
          </RouterLink>
          <RouterLink class="nav-link nav-link-context" :class="{ 'is-active': ['game-encounters', 'print-monsters'].includes(String(route.name)) }" :to="{ name: 'game-encounters', params: { gameId: gameContext.id } }">
            <span class="nav-icon" aria-hidden="true">⚔</span><span>Encounters</span>
          </RouterLink>
          <RouterLink class="nav-link nav-link-context" :class="{ 'is-active': route.name === 'game-tables' }" :to="{ name: 'game-tables', params: { gameId: gameContext.id } }">
            <span class="nav-icon" aria-hidden="true">⚄</span><span>Tables</span>
          </RouterLink>
          <RouterLink v-if="gameContext.encounterVisible" class="nav-link nav-link-context" :class="{ 'is-active': route.name === 'player-encounter' }" :to="{ name: 'player-encounter', params: { gameId: gameContext.id } }">
            <span class="nav-icon" aria-hidden="true">◉</span><span>Player view</span>
            <span class="nav-context">PLAYER</span>
          </RouterLink>
        </div>

        <div v-if="characterContext" class="nav-group nav-context-group" aria-label="Character tools">
          <p class="nav-label">
            <span class="nav-label-mark">CHARACTER</span>
            <span class="nav-context-title">{{ characterContext.name }}</span>
          </p>
          <RouterLink class="nav-link nav-link-context" :class="{ 'is-active': route.name === 'character-overview' }" :to="{ name: 'character-overview', params: { characterId: characterContext.id } }">
            <span class="nav-icon" aria-hidden="true">✧</span><span>Overview</span>
          </RouterLink>
          <RouterLink class="nav-link nav-link-context" :class="{ 'is-active': ['character-inventory', 'print-items'].includes(String(route.name)) }" :to="{ name: 'character-inventory', params: { characterId: characterContext.id } }">
            <span class="nav-icon" aria-hidden="true">◇</span><span>Inventory</span>
          </RouterLink>
          <RouterLink class="nav-link nav-link-context" :class="{ 'is-active': ['character-spellbooks', 'print-spellbook'].includes(String(route.name)) }" :to="{ name: 'character-spellbooks', params: { characterId: characterContext.id } }">
            <span class="nav-icon" aria-hidden="true">✧</span><span>Spellbooks</span>
          </RouterLink>
          <RouterLink v-if="characterContext.encounterVisible" class="nav-link nav-link-context" :class="{ 'is-active': route.name === 'player-encounter' }" :to="{ name: 'player-encounter', params: { gameId: characterContext.gameId } }">
            <span class="nav-icon" aria-hidden="true">◉</span><span>Active encounter</span>
            <span class="nav-context">PLAYER</span>
          </RouterLink>
        </div>

        <div v-if="selectedCharacter && selectedCharacter.id !== characterContext?.id" class="nav-group nav-selected-group" aria-label="Selected character">
          <p class="nav-label">SELECTED CHARACTER</p>
          <RouterLink class="nav-link nav-link-context" :to="{ name: 'character-overview', params: { characterId: selectedCharacter.id } }">
            <span class="nav-icon" aria-hidden="true">✦</span><span>{{ selectedCharacter.name }}</span>
          </RouterLink>
        </div>

        <p class="nav-note"><span aria-hidden="true">✦</span><span>GM and player labels describe views, not access control.</span></p>
      </nav>
      <main id="main" class="page" tabindex="-1">
        <RouterView v-slot="{ Component, route: currentRoute }"><component :is="Component" :key="currentRoute.path" /></RouterView>
      </main>
    </div>
    <footer class="footer"><span>OLEA <span class="footer-divider">/</span> A TTRPG COMPANION</span><span>Made for stories shared around a table.</span></footer>
  </div>
</template>
