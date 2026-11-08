const RETURN_STATE_KEY = 'oleaEncounterReturn'
const SCROLL_PREFIX = 'olea.encounter.scroll'
const INTERACTION_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown', 'input'] as const
const INTERACTION_OPTIONS: AddEventListenerOptions = { passive: true }

export type EncounterPrintRestore = {
  restore: () => boolean
  cancel: () => void
}

function scrollKey(gameId: string, encounterId: string) {
  return `${SCROLL_PREFIX}.${gameId}.${encounterId}`
}

function readState(): Record<string, unknown> {
  return window.history.state && typeof window.history.state === 'object'
    ? window.history.state as Record<string, unknown>
    : {}
}

export function rememberEncounterPrintReturn(gameId: string, encounterId: string) {
  if (!gameId || !encounterId) return
  try {
    sessionStorage.setItem(scrollKey(gameId, encounterId), String(Math.round(window.scrollY)))
    window.history.replaceState({ ...readState(), [RETURN_STATE_KEY]: true }, '')
  } catch {}
}

export function prepareEncounterPrintReturn(gameId: string, encounterId: string): EncounterPrintRestore | null {
  if (!gameId || !encounterId) return null
  try {
    if (!readState()[RETURN_STATE_KEY]) return null
    window.history.replaceState({ ...readState(), [RETURN_STATE_KEY]: false }, '')
  } catch {
    return null
  }

  const key = scrollKey(gameId, encounterId)
  let armed = true
  let scheduled = false

  function clearSaved() {
    try { sessionStorage.removeItem(key) } catch {}
  }

  function cleanup() {
    for (const event of INTERACTION_EVENTS) window.removeEventListener(event, cancel, INTERACTION_OPTIONS)
  }

  function cancel() {
    if (!armed) return
    armed = false
    cleanup()
    clearSaved()
  }

  for (const event of INTERACTION_EVENTS) window.addEventListener(event, cancel, INTERACTION_OPTIONS)

  return {
    cancel,
    restore() {
      if (scheduled || !armed) return false
      scheduled = true
      let saved: string | null = null
      try { saved = sessionStorage.getItem(key) } catch {}
      clearSaved()
      if (saved === null) {
        armed = false
        cleanup()
        return false
      }
      const position = Number(saved)
      if (!Number.isFinite(position)) {
        armed = false
        cleanup()
        return false
      }
      requestAnimationFrame(() => {
        cleanup()
        if (!armed) return
        armed = false
        window.scrollTo(0, position)
      })
      return true
    },
  }
}
