const INTERACTION_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown', 'input'] as const
const INTERACTION_OPTIONS: AddEventListenerOptions = { passive: true }

export type PrintReturnRestore = {
  restore: () => boolean
  cancel: () => void
  active: () => boolean
}

function readState(): Record<string, unknown> {
  return window.history.state && typeof window.history.state === 'object'
    ? window.history.state as Record<string, unknown>
    : {}
}

export function rememberPrintReturn(stateKey: string, scrollKey: string) {
  try {
    sessionStorage.setItem(scrollKey, String(Math.round(window.scrollY)))
    window.history.replaceState({ ...readState(), [stateKey]: true }, '')
  } catch {}
}

export function preparePrintReturn(stateKey: string, scrollKey: string): PrintReturnRestore | null {
  try {
    if (!readState()[stateKey]) return null
    window.history.replaceState({ ...readState(), [stateKey]: false }, '')
  } catch {
    return null
  }

  let armed = true
  let scheduled = false

  function clearSaved() {
    try { sessionStorage.removeItem(scrollKey) } catch {}
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
    active: () => armed && !scheduled,
    restore() {
      if (scheduled || !armed) return false
      scheduled = true
      let saved: string | null = null
      try { saved = sessionStorage.getItem(scrollKey) } catch {}
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
