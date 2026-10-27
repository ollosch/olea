import { defineStore } from 'pinia'
import { pb } from '../pb'
import { api } from '../api'
import { useAuthStore } from './auth'
import { walletTotal, optimizeAmounts } from '../utils/money'

let unsubscribers = []

function gameFromMembership(m) {
  const g = m.expand?.game
  if (!g) return null
  return {
    ...g,
    role: m.role,
    membershipId: m.id,
    system: g.expand?.system || null,
  }
}

function walletPart(raw, currencies, location) {
  const rows = raw.filter((w) => w.location === location)
  const amounts = {}
  rows.forEach((w) => (amounts[w.currency] = w.amount))
  return {
    raw: rows,
    amounts,
    total: walletTotal(amounts, currencies),
    optimized: optimizeAmounts(amounts, currencies),
  }
}

export const useGameStore = defineStore('game', {
  state: () => ({
    games: [],
    activeGame: null,
    system: null,
    systems: [],
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
    isGlobalGM(state) {
      return state.games.some((g) => g.role === 'gm')
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
    players(state) {
      return state.members.filter((m) => m.role === 'player')
    },
    gms(state) {
      return state.members.filter((m) => m.role === 'gm')
    },
    inventoryFor(state) {
      return (playerId, location) =>
        state.inventory.filter(
          (e) => e.owner === playerId && (!location || e.location === location)
        )
    },
    walletFor(state) {
      return (playerId) => {
        const m = state.members.find((x) => x.player === playerId)
        const raw = m ? state.wallets.filter((w) => w.membership === m.id) : []
        return {
          person: walletPart(raw, state.currencies, 'person'),
          stash: walletPart(raw, state.currencies, 'stash'),
        }
      }
    },
  },

  actions: {
    // ---- games ----
    async loadGames() {
      const pid = this.myPlayerId
      if (!pid) {
        this.games = []
        return
      }
      const res = await pb.collection('memberships').getList(1, 200, {
        filter: `player = '${pid}'`,
        expand: 'game.system',
        sort: '-created',
      })
      this.games = res.items.map(gameFromMembership).filter(Boolean)
    },

    async createGame(data) {
      const record = await api.createGame(data)
      await this.loadGames()
      return record
    },

    async deleteGame(id) {
      await api.deleteGame(id)
      if (this.activeGame?.id === id) this.closeGame()
      await this.loadGames()
    },

    async openGame(gameId) {
      this.closeGame()
      this.activeGame = await pb.collection('games').getOne(gameId, { expand: 'system' })
      this.system =
        this.activeGame.expand?.system ||
        (await pb.collection('systems').getOne(this.activeGame.system))
      this.loading = true
      try {
        await this._fetchAll()
        await this._subscribe()
      } finally {
        this.loading = false
      }
    },

    closeGame() {
      this._unsubscribe()
      this.activeGame = null
      this.system = null
      this.currencies = []
      this.members = []
      this.items = []
      this.inventory = []
      this.wallets = []
    },

    // ---- systems ----
    async loadSystems() {
      const res = await pb.collection('systems').getList(1, 200, { sort: 'name' })
      this.systems = res.items
    },

    async openSystem(systemId) {
      this.closeGame()
      this.system = await pb.collection('systems').getOne(systemId)
      this.loading = true
      try {
        await this._fetchAll()
        await this._subscribe()
      } finally {
        this.loading = false
      }
    },

    closeSystem() {
      this._unsubscribe()
      this.system = null
      this.currencies = []
      this.items = []
    },

    async createSystem(data) {
      const record = await pb.collection('systems').create(data)
      await this.loadSystems()
      return record
    },

    async updateSystem(id, data) {
      const record = await pb.collection('systems').update(id, data)
      if (this.system?.id === id) this.system = record
      await this.loadSystems()
      return record
    },

    async deleteSystem(id) {
      await pb.collection('systems').delete(id)
      if (this.system?.id === id) this.closeSystem()
      await this.loadSystems()
    },

    async importSystem(id, data) {
      const result = await api.importSystem(id, data)
      if (this.system?.id === id) await this._fetchAll()
      return result
    },

    async createCurrency(data) {
      return pb.collection('currencies').create({ system: this.system.id, ...data })
    },
    async updateCurrency(id, data) {
      return pb.collection('currencies').update(id, data)
    },
    async deleteCurrency(id) {
      return pb.collection('currencies').delete(id)
    },

    // ---- catalog items ----
    async createItem(data) {
      if (!this.system?.id) throw new Error('No system selected')
      if (data instanceof FormData) {
        if (!data.has('system')) data.append('system', this.system.id)
        return pb.collection('items').create(data)
      }
      return pb.collection('items').create({ system: this.system.id, ...data })
    },
    async updateItem(id, data) {
      return pb.collection('items').update(id, data)
    },
    async deleteItem(id) {
      return pb.collection('items').delete(id)
    },

    // ---- fetching / realtime ----
    async _fetchAll() {
      const s = this.system?.id
      const g = this.activeGame?.id
      const tasks = []
      if (s) {
        tasks.push(
          pb
            .collection('currencies')
            .getList(1, 500, { filter: `system = '${s}'`, sort: 'sort,base_value' })
            .then((r) => (this.currencies = r.items))
        )
        tasks.push(
          pb
            .collection('items')
            .getList(1, 1000, { filter: `system = '${s}'`, sort: 'category,name' })
            .then((r) => (this.items = r.items))
        )
      }
      if (g) {
        tasks.push(
          pb
            .collection('memberships')
            .getList(1, 500, { filter: `game = '${g}'`, expand: 'player', sort: 'created' })
            .then((r) => (this.members = r.items))
        )
        tasks.push(
          pb
            .collection('inventory')
            .getList(1, 2000, { filter: `game = '${g}'`, expand: 'item' })
            .then((r) => (this.inventory = r.items))
        )
        tasks.push(
          pb
            .collection('wallets')
            .getList(1, 2000, { filter: `game = '${g}'`, expand: 'currency' })
            .then((r) => (this.wallets = r.items))
        )
      }
      await Promise.all(tasks)
    },

    async _refetch(name) {
      const s = this.system?.id
      const g = this.activeGame?.id
      const table = pb.collection(name)
      if (name === 'currencies') {
        if (!s) return
        const res = await table.getList(1, 500, {
          filter: `system = '${s}'`,
          sort: 'sort,base_value',
        })
        this.currencies = res.items
      } else if (name === 'items') {
        if (!s) return
        const res = await table.getList(1, 1000, {
          filter: `system = '${s}'`,
          sort: 'category,name',
        })
        this.items = res.items
      } else if (name === 'memberships') {
        if (!g) return
        const res = await table.getList(1, 500, {
          filter: `game = '${g}'`,
          expand: 'player',
          sort: 'created',
        })
        this.members = res.items
      } else if (name === 'inventory') {
        if (!g) return
        const res = await table.getList(1, 2000, { filter: `game = '${g}'`, expand: 'item' })
        this.inventory = res.items
      } else if (name === 'wallets') {
        if (!g) return
        const res = await table.getList(1, 2000, { filter: `game = '${g}'`, expand: 'currency' })
        this.wallets = res.items
      }
    },

    async _subscribe() {
      const s = this.system?.id
      const g = this.activeGame?.id
      const subscriptions = []
      if (s) {
        subscriptions.push(['currencies', `system = '${s}'`])
        subscriptions.push(['items', `system = '${s}'`])
      }
      if (g) {
        subscriptions.push(['memberships', `game = '${g}'`])
        subscriptions.push(['inventory', `game = '${g}'`])
        subscriptions.push(['wallets', `game = '${g}'`])
      }
      for (const [name, filter] of subscriptions) {
        try {
          const unsub = await pb.collection(name).subscribe('*', () => this._refetch(name), {
            filter,
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
    async moveItem(inventoryId, location) {
      await api.moveItem(inventoryId, location)
    },

    // ---- money ----
    async giveMoney(toPlayerId, currencyId, amount, location = 'person') {
      await api.giveMoney({
        game: this.activeGame.id,
        toPlayerId,
        currencyId,
        amount,
        location,
      })
    },
    async gmMoney(playerId, currencyId, amount, location = 'person') {
      await api.gmMoney({
        game: this.activeGame.id,
        playerId,
        currencyId,
        amount,
        location,
      })
    },
    async moveMoney(currencyId, amount, from, to) {
      await api.moveMoney({
        game: this.activeGame.id,
        currencyId,
        amount,
        from,
        to,
      })
    },
  },
})
