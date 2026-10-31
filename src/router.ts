import { createRouter, createWebHistory } from 'vue-router'
import CharacterSelectionView from './views/CharacterSelectionView.vue'
import CharacterOverviewView from './views/CharacterOverviewView.vue'
import GameCharactersView from './views/GameCharactersView.vue'
import GamesView from './views/GamesView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/games' },
    { path: '/games', name: 'games', component: GamesView, meta: { title: 'Games' } },
    { path: '/games/:gameId/characters', name: 'game-characters', component: GameCharactersView, meta: { title: 'Game characters' } },
    { path: '/characters/:characterId', name: 'character-overview', component: CharacterOverviewView, meta: { title: 'Character overview' } },
    { path: '/characters', name: 'characters', component: CharacterSelectionView, meta: { title: 'Choose a character' } },
    { path: '/:pathMatch(.*)*', redirect: '/games' },
  ],
})
