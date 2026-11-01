export function getCardOverflowWarnings(content: readonly string[], availableCharacters: number): string[] {
  return content.some((part) => part.length > availableCharacters)
    ? ['Text may exceed the card. Use a larger format or edit the preferred text.']
    : []
}

export type SpellCardFields = {
  name: string
  level: string
  school: string
  time: string
  range: string
  duration: string
  components: string
  entries: string[]
}

export function getSpellCardWarnings(spell: SpellCardFields): string[] {
  const warnings = getCardOverflowWarnings(spell.entries, 520)
  for (const [label, value] of [
    ['Level', spell.level], ['Casting time', spell.time], ['Range', spell.range],
    ['Duration', spell.duration], ['Components', spell.components],
  ] as const) if (!value.trim()) warnings.push(`${label} is missing.`)
  return warnings
}
