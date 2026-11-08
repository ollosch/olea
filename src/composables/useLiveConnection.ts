import { onMounted, onUnmounted, ref } from 'vue'
import { pb } from '../lib/pocketbase'

export type LiveConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unavailable'

type LiveConnectionOptions = {
  refresh: () => Promise<boolean>
  resubscribe: () => Promise<boolean>
}

const OFFLINE_MESSAGE = 'You are offline. Showing the last update; live changes will resume after reconnection.'
const RECONNECTING_MESSAGE = 'Reconnecting and checking for the latest changes…'
const RECONNECTED_MESSAGE = 'Live updates reconnected. Showing the latest changes.'

export function useLiveConnection(options: LiveConnectionOptions) {
  const state = ref<LiveConnectionState>('connecting')
  const message = ref('')
  const notice = ref('')
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let reconnecting = false
  let installedDisconnect: ((activeSubscriptions: string[]) => void) | undefined
  let previousDisconnect: ((activeSubscriptions: string[]) => void) | undefined

  function clearNotice() {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = undefined
    notice.value = ''
  }

  function showNotice(text: string) {
    clearNotice()
    notice.value = text
    noticeTimer = setTimeout(clearNotice, 6000)
  }

  function markLive(announce = false) {
    state.value = 'live'
    message.value = ''
    if (announce) showNotice(RECONNECTED_MESSAGE)
  }

  function markUnavailable(text: string) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      markOffline()
      return
    }
    state.value = 'unavailable'
    message.value = text
    clearNotice()
  }

  function markOffline() {
    state.value = 'offline'
    message.value = OFFLINE_MESSAGE
    clearNotice()
  }

  function markReconnecting() {
    state.value = 'reconnecting'
    message.value = RECONNECTING_MESSAGE
    clearNotice()
  }

  function markDisconnected() {
    if (state.value === 'offline') return
    markUnavailable('Live updates disconnected. They should reconnect automatically; use Retry live updates if this continues.')
  }

  async function attemptReconnect(announce: boolean) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      markOffline()
      return
    }
    if (reconnecting) return
    reconnecting = true
    const wasLive = state.value === 'live'
    const shouldAnnounce = announce && !wasLive
    if (!wasLive) markReconnecting()
    try {
      if (!wasLive) {
        const subscribed = await runStep(options.resubscribe)
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          markOffline()
          return
        }
        if (!subscribed) {
          markUnavailable('Live updates could not be re-established. Retry live updates.')
          return
        }
      }
      const refreshed = await runStep(options.refresh)
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        markOffline()
        return
      }
      if (!refreshed) {
        markUnavailable('The latest live changes could not be loaded. Showing the last update; retry live updates.')
        return
      }
      markLive(shouldAnnounce)
    } finally {
      reconnecting = false
    }
  }

  async function runStep(step: () => Promise<boolean>): Promise<boolean> {
    try {
      return await step()
    } catch {
      return false
    }
  }

  function retry() {
    void attemptReconnect(true)
  }

  function handleOnline() {
    void attemptReconnect(true)
  }

  function handleOffline() {
    markOffline()
  }

  function handleReconnected() {
    if (state.value === 'connecting') return
    void attemptReconnect(true)
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('olea-reconnected', handleReconnected)
    previousDisconnect = pb.realtime.onDisconnect
    installedDisconnect = (activeSubscriptions) => {
      previousDisconnect?.(activeSubscriptions)
      if (activeSubscriptions.length) markDisconnected()
    }
    pb.realtime.onDisconnect = installedDisconnect
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    window.removeEventListener('olea-reconnected', handleReconnected)
    if (installedDisconnect && pb.realtime.onDisconnect === installedDisconnect) {
      pb.realtime.onDisconnect = previousDisconnect
    }
    installedDisconnect = undefined
    clearNotice()
  })

  return {
    state,
    message,
    notice,
    markLive,
    markUnavailable,
    markOffline,
    retry,
  }
}
