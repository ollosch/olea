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
import PrintMonstersView from './views/PrintMonstersView.vue'
import PrintItemsView from './views/PrintItemsView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/games' },
    { path: '/games', name: 'games', component: GamesView, meta: { title: 'Games', area: 'gm', context: 'games' } },
    { path: '/catalog', name: 'catalog', component: CatalogView, meta: { title: 'Catalog', area: 'gm', context: 'catalog' } },
    { path: '/catalog/:recordId', name: 'catalog-detail', component: CatalogDetailView, meta: { title: 'Catalog entry', area: 'gm', context: 'catalog' } },
    { path: '/games/:gameId/characters', name: 'game-characters', component: GameCharactersView, meta: { title: 'Game characters', area: 'gm', context: 'game' } },
    { path: '/games/:gameId/encounters', name: 'game-encounters', component: GameEncountersView, meta: { title: 'Game encounters', area: 'gm', context: 'game' } },
    { path: '/games/:gameId/monsters/print', name: 'print-monsters', component: PrintMonstersView, meta: { title: 'Monster cards', area: 'gm', context: 'game' } },
    { path: '/games/:gameId/tables', name: 'game-tables', component: GameTablesView, meta: { title: 'Random tables', area: 'gm', context: 'game' } },
    { path: '/games/:gameId/encounter', name: 'player-encounter', component: PlayerEncounterView, meta: { title: 'Active encounter', area: 'player', context: 'game', playerView: true } },
    { path: '/print/calibration', name: 'print-calibration', component: PrintCalibrationView, meta: { title: 'Print calibration', area: 'gm', context: 'print' } },
    { path: '/characters/:characterId/spellbooks/:spellbookId/print', name: 'print-spellbook', component: PrintSpellbookView, meta: { title: 'Spellbook cards', area: 'player', context: 'character' } },
    { path: '/characters/:characterId', name: 'character-overview', component: CharacterOverviewView, meta: { title: 'Character overview', area: 'player', context: 'character' } },
    { path: '/characters/:characterId/inventory', name: 'character-inventory', component: InventoryView, meta: { title: 'Inventory', area: 'player', context: 'character' } },
    { path: '/characters/:characterId/inventory/print', name: 'print-items', component: PrintItemsView, meta: { title: 'Item cards', area: 'player', context: 'character' } },
    { path: '/characters/:characterId/spellbooks', name: 'character-spellbooks', component: SpellbooksView, meta: { title: 'Spellbooks', area: 'player', context: 'character' } },
    { path: '/characters', name: 'characters', component: CharacterSelectionView, meta: { title: 'Choose a character', area: 'player', context: 'characters' } },
    { path: '/:pathMatch(.*)*', redirect: '/games' },
  ],
})
