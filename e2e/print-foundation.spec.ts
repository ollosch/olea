import { expect, test } from '@playwright/test'
import { e2eApiBase } from './fixtures'

test('print calibration preview shows four positions, duplex pages, and overflow warnings', async ({ page }) => {
  await page.goto('/print/calibration')
  await expect(page.getByRole('heading', { name: 'Print calibration' })).toBeVisible()
  await expect(page.locator('.print-sheet[aria-label="Sheet 1 fronts"] .print-card')).toHaveCount(4)
  await expect(page.locator('.print-sheet[aria-label="Sheet 1 backs"] .print-card')).toHaveCount(4)
  await expect(page.locator('.print-sheet[aria-label="Sheet 2 fronts"] .print-card')).toHaveCount(4)
  await expect(page.locator('.print-sheet[aria-label="Sheet 2 backs"] .print-card')).toHaveCount(4)
  await expect(page.locator('.print-warning')).toContainText('Overflow example')

  await page.getByLabel('Duplex flip edge').selectOption('short-edge')
  const backNames = await page.locator('.print-sheet[aria-label="Sheet 1 backs"] .card-name').allTextContents()
  expect(backNames).toEqual(['Calibration card 3', 'Calibration card 4', 'Calibration card 1', 'Calibration card 2'])

  await page.getByLabel('Include calibration page').check()
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
  const pages = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)]
  expect(pages).toHaveLength(5)
})

test('spellbook selection prints preferred text with matched name-only backs', async ({ page, request }) => {
  const systemResponse = await request.get(`${e2eApiBase}/api/collections/systems/records?filter=(key='dnd5e')`)
  const system = (await systemResponse.json() as { items: Array<{ id: string }> }).items[0]!
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const gameResponse = await request.post(`${e2eApiBase}/api/collections/games/records`, { data: { name: `Print fixture ${suffix}`, system: system.id } })
  const game = await gameResponse.json() as { id: string }
  const characterResponse = await request.post(`${e2eApiBase}/api/collections/characters/records`, { data: { game: game.id, name: 'Print Mage' } })
  const character = await characterResponse.json() as { id: string }
  const bookResponse = await request.post(`${e2eApiBase}/api/collections/spellbooks/records`, { data: { character: character.id, name: 'Prepared Spells' } })
  const book = await bookResponse.json() as { id: string }
  const spellResponse = await request.post(`${e2eApiBase}/api/collections/catalog/records`, { data: {
    system: system.id, type: 'spell', source: 'SYNTHETIC', source_id: `print-${suffix}`, name: 'Print Spark', level: '1', school: 'Evocation',
    original_json: { time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { amount: 30, type: 'feet' } }, duration: [{ type: 'instant' }], components: { v: true }, entries: ['Original description.'] },
    alternate_description: 'Preferred description.',
  } })
  const spell = await spellResponse.json() as { id: string }
  await request.post(`${e2eApiBase}/api/collections/spellbook_spells/records`, { data: { spellbook: book.id, spell: spell.id } })
  try {
    await page.goto(`/characters/${character.id}/spellbooks/${book.id}/print`)
    await expect(page.getByText('Print Spark', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.physical-page .card-face-front')).toContainText('Preferred description.')
    await expect(page.locator('.physical-page .card-face-front')).not.toContainText('Original description.')
    await expect(page.locator('.physical-page .card-face-back')).toContainText('Print Spark')
    await expect(page.locator('.physical-page .card-face-back .card-eyebrow, .physical-page .card-face-back .card-fields, .physical-page .card-face-back .entry-text')).toHaveCount(0)
    await page.getByLabel('Print Spark', { exact: false }).uncheck()
    await expect(page.locator('.physical-page')).toHaveCount(0)
  } finally {
    await request.delete(`${e2eApiBase}/api/collections/games/records/${game.id}`)
    await request.delete(`${e2eApiBase}/api/collections/catalog/records/${spell.id}`)
  }
})
