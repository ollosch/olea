import { adndSpellFields, htmlContent } from './adnd.ts'
import { addCardField, neutralCardPresentation, sourceObject, type CardField, type CardPresentation } from './cardPresentation.ts'

export const adndCardPresentation: CardPresentation = {
  ...neutralCardPresentation,
  spell: (record) => {
    const fields: CardField[] = []
    addCardField(fields, 'Level', record.level)
    addCardField(fields, 'School', record.school)
    addCardField(fields, 'Sphere', record.sphere)
    for (const field of adndSpellFields(record.original_json)) addCardField(fields, field.name, field.value)
    const required = ['Level', 'Casting time', 'Range', 'Duration', 'Components']
    return { fields, missingFields: required.filter((label) => !fields.some((field) => field.label === label)) }
  },
  creature: (record) => {
    const source = sourceObject(record.original_json)
    const fields: CardField[] = []
    if (source.format !== 'adnd2e-html') return { fields, actions: [], flavour: '' }
    for (const [label, value] of Object.entries(sourceObject(source.stats))) {
      if (typeof value === 'string') addCardField(fields, label, value)
    }
    const flavour = typeof source.html === 'string' ? htmlContent(source.html) : []
    return { fields, actions: [], flavour }
  },
}
