import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'

const routes = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/games', name: 'games', component: () => import('./views/GamesView.vue') },
  { path: '/systems', name: 'systems', component: () => import('./views/SystemsView.vue') },
  { path: '/systems/:id', name: 'system', component: () => import('./views/SystemView.vue') },
  { path: '/game/:id', name: 'game', component: () => import('./views/GameView.vue') },
  { path: '/game/:id/print/:playerId', name: 'print', component: () => import('./views/PrintView.vue') },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!auth.ready) auth.init()
  if (to.name !== 'home' && !auth.isAuthed) return { name: 'home' }
  if (to.name === 'home' && auth.isAuthed) return { name: 'games' }
  return true
})
