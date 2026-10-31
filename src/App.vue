<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
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
const connection = ref<'checking' | 'connected' | 'unavailable'>('checking')

try {
  const saved = localStorage.getItem('olea.accent')
  if (saved && /^#[0-9a-f]{6}$/i.test(saved)) accent.value = saved
} catch {
  // The app still works if browser storage is disabled.
}

onMounted(async () => {
  try {
    await pb.health.check()
    connection.value = 'connected'
  } catch {
    connection.value = 'unavailable'
  }
})

watch(accent, (value) => {
  document.documentElement.style.setProperty('--accent', value)
  try {
    localStorage.setItem('olea.accent', value)
  } catch {
    // Preferences are optional when browser storage is unavailable.
  }
}, { immediate: true })
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
                Choose an accent for this browser. Your choice stays on this device.
              </DialogDescription>
              <label class="color-setting" for="accent-color">
                <span><strong>Accent color</strong><small>Green is the default.</small></span>
                <input id="accent-color" v-model="accent" type="color" aria-label="Accent color" />
              </label>
              <button class="secondary-button" type="button" @click="accent = defaultAccent">Reset to green</button>
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
        <div class="nav-note">
          <span aria-hidden="true">✦</span>
          <p>More tools for your table are on their way.</p>
        </div>
      </nav>
      <main id="main" class="page" tabindex="-1">
        <RouterView />
      </main>
    </div>
    <footer class="footer"><span>OLEA <span class="footer-divider">/</span> A TTRPG COMPANION</span><span>Made for stories shared around a table.</span></footer>
  </div>
</template>
