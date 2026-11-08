const RETURN_STATE_KEY = 'oleaSpellbookReturn'
const SCROLL_PREFIX = 'olea.spellbook.scroll'
const INTERACTION_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown', 'input'] as const
const INTERACTION_OPTIONS: AddEventListenerOptions = { passive: true }

export type SpellbookPrintRestore = {
  restore: () => boolean
  cancel: () => void
}

function scrollKey(characterId: string, bookId: string) {
  return `${SCROLL_PREFIX}.${characterId}.${bookId}`
}

function readState(): Record<string, unknown> {
  return window.history.state && typeof window.history.state === 'object'
    ? window.history.state as Record<string, unknown>
    : {}
}

export function rememberSpellbookPrintReturn(characterId: string, bookId: string) {
  if (!characterId || !bookId) return
  try {
    sessionStorage.setItem(scrollKey(characterId, bookId), String(Math.round(window.scrollY)))
    window.history.replaceState({ ...readState(), [RETURN_STATE_KEY]: true }, '')
  } catch {}
}

export function prepareSpellbookPrintReturn(characterId: string, bookId: string): SpellbookPrintRestore | null {
  if (!characterId || !bookId) return null
  try {
    if (!readState()[RETURN_STATE_KEY]) return null
    window.history.replaceState({ ...readState(), [RETURN_STATE_KEY]: false }, '')
  } catch {
    return null
  }

  const key = scrollKey(characterId, bookId)
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
