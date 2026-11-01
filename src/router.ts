import { createRouter, createWebHistory } from 'vue-router'
import CharacterSelectionView from './views/CharacterSelectionView.vue'
import CharacterOverviewView from './views/CharacterOverviewView.vue'
import GameCharactersView from './views/GameCharactersView.vue'
import GamesView from './views/GamesView.vue'
import CatalogView from './views/CatalogView.vue'
import CatalogDetailView from './views/CatalogDetailView.vue'
import InventoryView from './views/InventoryView.vue'
import SpellbooksView from './views/SpellbooksView.vue'
import GameEncountersView from './views/GameEncountersView.vue'
import PlayerEncounterView from './views/PlayerEncounterView.vue'
import GameTablesView from './views/GameTablesView.vue'
import PrintCalibrationView from './views/PrintCalibrationView.vue'
import PrintSpellbookView from './views/PrintSpellbookView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/games' },
    { path: '/games', name: 'games', component: GamesView, meta: { title: 'Games' } },
    { path: '/catalog', name: 'catalog', component: CatalogView, meta: { title: 'Catalog' } },
    { path: '/catalog/:recordId', name: 'catalog-detail', component: CatalogDetailView, meta: { title: 'Catalog entry' } },
    { path: '/games/:gameId/characters', name: 'game-characters', component: GameCharactersView, meta: { title: 'Game characters' } },
    { path: '/games/:gameId/encounters', name: 'game-encounters', component: GameEncountersView, meta: { title: 'Game encounters' } },
    { path: '/games/:gameId/tables', name: 'game-tables', component: GameTablesView, meta: { title: 'Random tables' } },
    { path: '/games/:gameId/encounter', name: 'player-encounter', component: PlayerEncounterView, meta: { title: 'Active encounter' } },
    { path: '/print/calibration', name: 'print-calibration', component: PrintCalibrationView, meta: { title: 'Print calibration' } },
    { path: '/characters/:characterId/spellbooks/:spellbookId/print', name: 'print-spellbook', component: PrintSpellbookView, meta: { title: 'Spellbook cards' } },
    { path: '/characters/:characterId', name: 'character-overview', component: CharacterOverviewView, meta: { title: 'Character overview' } },
    { path: '/characters/:characterId/inventory', name: 'character-inventory', component: InventoryView, meta: { title: 'Inventory' } },
    { path: '/characters/:characterId/spellbooks', name: 'character-spellbooks', component: SpellbooksView, meta: { title: 'Spellbooks' } },
    { path: '/characters', name: 'characters', component: CharacterSelectionView, meta: { title: 'Choose a character' } },
    { path: '/:pathMatch(.*)*', redirect: '/games' },
  ],
})
