import { createRouter, createWebHistory } from 'vue-router'
import CharacterSelectionView from './views/CharacterSelectionView.vue'
import CharacterOverviewView from './views/CharacterOverviewView.vue'
import GameCharactersView from './views/GameCharactersView.vue'
import GamesView from './views/GamesView.vue'
import CatalogView from './views/CatalogView.vue'
import CatalogDetailView from './views/CatalogDetailView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/games' },
    { path: '/games', name: 'games', component: GamesView, meta: { title: 'Games' } },
    { path: '/catalog', name: 'catalog', component: CatalogView, meta: { title: 'Catalog' } },
    { path: '/catalog/:recordId', name: 'catalog-detail', component: CatalogDetailView, meta: { title: 'Catalog entry' } },
    { path: '/games/:gameId/characters', name: 'game-characters', component: GameCharactersView, meta: { title: 'Game characters' } },
    { path: '/characters/:characterId', name: 'character-overview', component: CharacterOverviewView, meta: { title: 'Character overview' } },
    { path: '/characters', name: 'characters', component: CharacterSelectionView, meta: { title: 'Choose a character' } },
    { path: '/:pathMatch(.*)*', redirect: '/games' },
  ],
})
