export type CardLayout = {
  key: string
  label: string
  columns: number
  rows: number
  cardWidthMm: number
  cardHeightMm: number
  gapMm: number
}

/** Physical dimensions are data so future formats (such as A8) need no new renderer. */
export const CARD_LAYOUTS = {
  a6Four: { key: 'a6-four', label: 'A4 · four cards (slightly smaller than A6)', columns: 2, rows: 2, cardWidthMm: 91, cardHeightMm: 131, gapMm: 2 },
  a7Eight: { key: 'a7-eight', label: 'A4 · eight landscape cards (approximately A7)', columns: 2, rows: 4, cardWidthMm: 91, cardHeightMm: 66, gapMm: 2 },
} as const satisfies Record<string, CardLayout>

export type DuplexFlip = 'long-edge' | 'short-edge'

export function cardsPerSheet(layout: CardLayout): number {
  return layout.columns * layout.rows
}

export function sheetCount(cardCount: number, layout: CardLayout): number {
  return Math.ceil(Math.max(0, cardCount) / cardsPerSheet(layout))
}

/** Return the back-face grid index that lands behind a front slot after duplex flipping. */
export function backSlotForFront(frontIndex: number, layout: CardLayout, flip: DuplexFlip): number {
  const row = Math.floor(frontIndex / layout.columns)
  const column = frontIndex % layout.columns
  const backRow = flip === 'short-edge' ? layout.rows - row - 1 : row
  const backColumn = flip === 'long-edge' ? layout.columns - column - 1 : column
  return backRow * layout.columns + backColumn
}

export function pageCards<T>(cards: readonly T[], layout: CardLayout, page: number): Array<T | null> {
  const capacity = cardsPerSheet(layout)
  return Array.from({ length: capacity }, (_, slot) => cards[page * capacity + slot] ?? null)
}
