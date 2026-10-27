import { defineStore } from 'pinia'
import { pb } from '../pb'
import { api } from '../api'
import { useAuthStore } from './auth'
import { walletTotal, optimizeAmounts } from '../utils/money'

let unsubscribers = []

export const useGameStore = defineStore('game', {
  state: () => ({
    games: [],
    activeGame: null,
    currencies: [],
    members: [],
    items: [],
    inventory: [],
    wallets: [],
    loading: false,
  }),

  getters: {
    myPlayerId() {
      return useAuthStore().player?.id || null
    },
    myMembership(state) {
      const pid = this.myPlayerId
      return state.members.find((m) => m.player === pid) || null
    },
    role() {
      return this.myMembership ? this.myMembership.role : null
    },
    isGM() {
      return this.role === 'gm'
    },
    currencyMap(state) {
      const map = {}
      state.currencies.forEach((c) => (map[c.id] = c))
      return map
    },
    itemMap(state) {
      const map = {}
      state.items.forEach((i) => (map[i.id] = i))
      return map
    },
    categories(state) {
      const set = new Set()
      state.items.forEach((i) => {
        if (i.category) set.add(i.category)
      })
      return [...set].sort()
    },
    // functions (returned from getters) for per-player views
    inventoryFor(state) {
      return (playerId) => state.inventory.filter((e) => e.owner === playerId)
    },
    walletFor(state) {
      return (playerId) => {
        const m = state.members.find((x) => x.player === playerId)
        const raw = m ? state.wallets.filter((w) => w.membership === m.id) : []
        const amounts = {}
        raw.forEach((w) => (amounts[w.currency] = w.amount))
        const currencies = state.currencies
        return {
          raw,
          amounts,
          total: walletTotal(amounts, currencies),
          optimized: optimizeAmounts(amounts, currencies),
        }
      }
    },
  },

  actions: {
    async loadGames() {
      const pid = this.myPlayerId
      if (!pid) return
      const res = await pb.collection('memberships').getList(1, 200, {
        filter: `player = '${pid}'`,
        expand: 'game',
        sort: '-created',
      })
      this.games = res.items.map((m) => m.expand?.game).filter(Boolean)
    },

    async createGame(data) {
      await api.createGame(data)
      await this.loadGames()
    },

    async openGame(gameId) {
      this.closeGame()
      this.activeGame = await pb.collection('games').getOne(gameId)
      this.loading = true
      try {
        await this._fetchAll()
        this._subscribe()
      } finally {
        this.loading = false
      }
    },

    closeGame() {
      this._unsubscribe()
      this.activeGame = null
      this.currencies = []
      this.members = []
      this.items = []
      this.inventory = []
      this.wallets = []
    },

    async _fetchAll() {
      const g = this.activeGame?.id
      if (!g) return
      const [cur, mem, it, inv, wal] = await Promise.all([
        pb.collection('currencies').getList(1, 200, { filter: `game = '${g}'`, sort: 'sort' }),
        pb.collection('memberships').getList(1, 200, { filter: `game = '${g}'`, expand: 'player', sort: 'created' }),
        pb.collection('items').getList(1, 500, { filter: `game = '${g}'`, sort: 'category,name' }),
        pb.collection('inventory').getList(1, 1000, { filter: `game = '${g}'`, expand: 'item' }),
        pb.collection('wallets').getList(1, 1000, { filter: `game = '${g}'`, expand: 'currency' }),
      ])
      this.currencies = cur.items
      this.members = mem.items
      this.items = it.items
      this.inventory = inv.items
      this.wallets = wal.items
    },

    async _refetch(name) {
      const g = this.activeGame?.id
      if (!g) return
      const table = pb.collection(name)
      let res
      if (name === 'currencies') {
        res = await table.getList(1, 200, { filter: `game = '${g}'`, sort: 'sort' })
      } else if (name === 'memberships') {
        res = await table.getList(1, 200, { filter: `game = '${g}'`, expand: 'player', sort: 'created' })
      } else if (name === 'items') {
        res = await table.getList(1, 500, { filter: `game = '${g}'`, sort: 'category,name' })
      } else if (name === 'inventory') {
        res = await table.getList(1, 1000, { filter: `game = '${g}'`, expand: 'item' })
      } else if (name === 'wallets') {
        res = await table.getList(1, 1000, { filter: `game = '${g}'`, expand: 'currency' })
      }
      if (res) {
        if (name === 'currencies') this.currencies = res.items
        else if (name === 'memberships') this.members = res.items
        else if (name === 'items') this.items = res.items
        else if (name === 'inventory') this.inventory = res.items
        else if (name === 'wallets') this.wallets = res.items
      }
    },

    async _subscribe() {
      const g = this.activeGame?.id
      if (!g) return
      const names = ['currencies', 'memberships', 'items', 'inventory', 'wallets']
      for (const name of names) {
        try {
          const unsub = await pb.collection(name).subscribe('*', () => this._refetch(name), {
            filter: `game = '${g}'`,
          })
          unsubscribers.push(unsub)
        } catch (e) {
          /* ignore */
        }
      }
    },

    _unsubscribe() {
      unsubscribers.forEach((fn) => {
        try {
          fn()
        } catch (e) {
          /* ignore */
        }
      })
      unsubscribers = []
    },

    // ---- members ----
    async addMember(playerName, role = 'player') {
      await api.addMember({ game: this.activeGame.id, playerName, role })
    },
    async removeMember(membershipId) {
      await api.removeMember(membershipId)
    },
    async setRole(membershipId, role) {
      await api.setRole(membershipId, role)
    },

    // ---- items (catalog) — standard record API so file upload works ----
    async createItem(data) {
      await pb.collection('items').create({ game: this.activeGame.id, ...data })
    },
    async updateItem(id, data) {
      await pb.collection('items').update(id, data)
    },
    async deleteItem(id) {
      await pb.collection('items').delete(id)
    },

    // ---- inventory ----
    async giveItem(payload) {
      await api.giveItem({ game: this.activeGame.id, ...payload })
    },
    async useItem(inventoryId) {
      await api.useItem(inventoryId)
    },
    async dropItem(inventoryId) {
      await api.dropItem(inventoryId)
    },

    // ---- money ----
    async giveMoney(toPlayerId, currencyId, amount) {
      await api.giveMoney({ game: this.activeGame.id, toPlayerId, currencyId, amount })
    },
    async gmMoney(playerId, currencyId, amount) {
      await api.gmMoney({ game: this.activeGame.id, playerId, currencyId, amount })
    },
  },
})
