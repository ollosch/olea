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
    <header class="topbar">
      <a class="brand" href="#main" aria-label="Olea, skip to main content">
        <span class="brand-mark" aria-hidden="true">✳</span>
        <span>olea<span class="brand-dot">.</span></span>
      </a>
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

    <main id="main" class="page">
      <section class="intro" aria-labelledby="page-title">
        <div class="intro-copy">
          <p class="eyebrow"><span class="eyebrow-line" /> A LITTLE MORE ROOM FOR ADVENTURE</p>
          <h1 id="page-title">Your table,<br /><em>ready when you are.</em></h1>
          <p class="intro-text">A quiet place to prepare your games, keep track of the details, and get back to the story.</p>
          <div class="foundation-note"><span aria-hidden="true">✦</span> The foundation is ready. Game features are coming next.</div>
        </div>
        <div class="illustration" aria-hidden="true">
          <div class="illustration-ring ring-outer" />
          <div class="illustration-ring ring-inner" />
          <div class="illustration-center"><span>✳</span></div>
          <span class="star star-one">✦</span><span class="star star-two">✧</span><span class="star star-three">✦</span>
        </div>
      </section>

      <section class="workspace" aria-labelledby="workspace-title">
        <div class="section-heading">
          <div><p class="eyebrow">YOUR WORKSPACE</p><h2 id="workspace-title">Made for the table</h2></div>
          <span class="section-note">A companion for game nights</span>
        </div>
        <div class="workspace-grid">
          <article class="workspace-card"><div class="card-icon" aria-hidden="true">◇</div><div><h3>For the GM</h3><p>Prepare encounters, explore your library, and keep the game moving.</p></div><span class="coming-soon">COMING SOON</span></article>
          <article class="workspace-card"><div class="card-icon" aria-hidden="true">✧</div><div><h3>For the players</h3><p>Keep inventories, coins, and spellbooks close at hand.</p></div><span class="coming-soon">COMING SOON</span></article>
          <article class="workspace-card"><div class="card-icon" aria-hidden="true">▤</div><div><h3>For the table</h3><p>Bring your favorite spells and creatures to paper.</p></div><span class="coming-soon">COMING SOON</span></article>
        </div>
      </section>
    </main>
    <footer class="footer"><span>OLEA <span class="footer-divider">/</span> A TTRPG COMPANION</span><span>Made for stories shared around a table.</span></footer>
  </div>
</template>
