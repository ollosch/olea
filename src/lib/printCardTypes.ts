export type PrintCardFace = {
  title?: string
  subtitle?: string
  fields?: Array<{ label: string; value: string }>
  content?: unknown
  note?: string
  nameOnly?: boolean
}

export type PrintCard = {
  id: string
  name: string
  front: PrintCardFace
  back: PrintCardFace
  warnings?: string[]
}
