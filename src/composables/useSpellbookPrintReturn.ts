import { preparePrintReturn, rememberPrintReturn, type PrintReturnRestore } from './usePrintReturn'

const RETURN_STATE_KEY = 'oleaSpellbookReturn'
const SCROLL_PREFIX = 'olea.spellbook.scroll'

export type SpellbookPrintRestore = PrintReturnRestore

function scrollKey(characterId: string, bookId: string) {
  return `${SCROLL_PREFIX}.${characterId}.${bookId}`
}

export function rememberSpellbookPrintReturn(characterId: string, bookId: string) {
  if (!characterId || !bookId) return
  rememberPrintReturn(RETURN_STATE_KEY, scrollKey(characterId, bookId))
}

export function prepareSpellbookPrintReturn(characterId: string, bookId: string): SpellbookPrintRestore | null {
  if (!characterId || !bookId) return null
  return preparePrintReturn(RETURN_STATE_KEY, scrollKey(characterId, bookId))
}
