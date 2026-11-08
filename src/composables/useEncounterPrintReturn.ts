import { preparePrintReturn, rememberPrintReturn, type PrintReturnRestore } from './usePrintReturn'

const RETURN_STATE_KEY = 'oleaEncounterReturn'
const SCROLL_PREFIX = 'olea.encounter.scroll'

export type EncounterPrintRestore = PrintReturnRestore

function scrollKey(gameId: string, encounterId: string) {
  return `${SCROLL_PREFIX}.${gameId}.${encounterId}`
}

export function rememberEncounterPrintReturn(gameId: string, encounterId: string) {
  if (!gameId || !encounterId) return
  rememberPrintReturn(RETURN_STATE_KEY, scrollKey(gameId, encounterId))
}

export function prepareEncounterPrintReturn(gameId: string, encounterId: string): EncounterPrintRestore | null {
  if (!gameId || !encounterId) return null
  return preparePrintReturn(RETURN_STATE_KEY, scrollKey(gameId, encounterId))
}
