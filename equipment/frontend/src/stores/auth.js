import { defineStore } from 'pinia'
import { pb } from '../pb'
import { api } from '../api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    player: null,
    ready: false,
  }),
  getters: {
    isAuthed: (s) => !!s.player,
  },
  actions: {
    init() {
      if (pb.authStore.model && pb.authStore.isValid) {
        this.player = pb.authStore.model
      }
      this.ready = true
    },
    async login(name) {
      const res = await api.login(name)
      pb.authStore.save(res.token, res.record)
      this.player = res.record
      return res.record
    },
    logout() {
      pb.authStore.clear()
      this.player = null
    },
  },
})
