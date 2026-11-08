import { expect, test } from '@playwright/test'
import { e2eApiBase } from './fixtures'
import { openEncounters, test as fixtureTest } from './fixtures'

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
    await expect(page.getByText('1 of 1 card selected')).toBeVisible()
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

fixtureTest('monster cards use explicit multi-selection and union encounters by catalog identity', async ({ page, ids }) => {
  await openEncounters(page, ids.gameId)
  await page.getByRole('link', { name: 'Print monster cards' }).click()
  await expect(page.getByRole('heading', { name: 'Choose encounters and creatures' })).toBeVisible()
  await expect(page.locator('select[multiple]')).toHaveCount(0)
  const encounterGroup = page.getByRole('group', { name: 'Encounters' })
  await expect(encounterGroup.getByRole('checkbox')).toHaveCount(2)
  await expect(encounterGroup.getByRole('checkbox', { name: /E2E Bridge Encounter/ })).toBeChecked()
  await encounterGroup.getByRole('checkbox', { name: /E2E Forest Encounter/ }).check()
  await expect(page.getByText('2 of 2 encounters selected')).toBeVisible()
  const cardGroup = page.locator('[data-selection="creature-cards"]')
  await expect(cardGroup.locator('.print-choice')).toHaveCount(3)
  await expect(cardGroup.locator('.print-choice').filter({ hasText: 'E2E Shared Name' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Select all cards' }).click()
  await expect(page.getByText('3 of 3 cards selected')).toBeVisible()
  await expect(page.locator('.physical-page')).toHaveCount(2)
  await expect(page.locator('.physical-page .card-face-front').filter({ hasText: 'SYNTHETIC · beast' })).toContainText('Claw')
  const backs = await page.locator('.physical-page .card-face-back').allTextContents()
  expect(backs.join(' ')).toContain('By the old bridge.')
  expect(backs.join(' ')).toContain('At dusk.')

  await encounterGroup.getByRole('checkbox', { name: /E2E Forest Encounter/ }).uncheck()
  await expect(page.getByText('1 of 2 encounters selected')).toBeVisible()
  await expect(cardGroup.locator('.print-choice')).toHaveCount(2)
  await expect(cardGroup.locator('.print-choice').filter({ hasText: 'E2E Custom Wisp' })).toContainText('Custom participant')
  await expect(page.getByText('0 of 2 cards selected')).toBeVisible()
})

fixtureTest('inventory item cards include weapon fields, custom items, and partial A7 sheets', async ({ page, ids }) => {
  await page.goto(`/characters/${ids.characterId}/inventory`)
  await page.getByRole('link', { name: 'Print item cards' }).click()
  await expect(page.getByRole('heading', { name: 'Choose item cards' })).toBeVisible()
  await expect(page.locator('.print-sheet[aria-label="Sheet 1 fronts"] .print-card')).toHaveCount(8)
  await expect(page.locator('.print-sheet[aria-label="Sheet 1 fronts"] .card-name')).toHaveCount(5)
  await expect(page.getByText('Only root carried items are printed: items inside containers and stash contents are not included.', { exact: false })).toBeVisible()
  await expect(page.getByText('5 of 5 cards selected')).toBeVisible()
  await expect(page.locator('[data-selection="items"] .print-choice')).toHaveCount(5)
  await expect(page.locator('.physical-page .card-face-front').filter({ hasText: 'E2E Practice sword' })).toContainText('Damage')
  await expect(page.locator('.physical-page .card-face-front').filter({ hasText: 'E2E Practice sword' })).toContainText('1d6')
  await expect(page.locator('.physical-page .card-face-back').filter({ hasText: 'E2E Practice sword' })).toContainText('Painted blue.')
  await page.getByLabel('E2E Practice sword', { exact: false }).uncheck()
  await expect(page.locator('.physical-page')).toHaveCount(2)
  await expect(page.locator('.print-sheet[aria-label="Sheet 1 fronts"] .print-card')).toHaveCount(8)
})

test('AD&D creature cards render imported stats and sanitized source content', async ({ page, request }) => {
  const api = `${e2eApiBase}/api/collections`
  const systems = await request.get(`${api}/systems/records?filter=(key='adnd2e')`)
  const system = (await systems.json() as { items: Array<{ id: string }> }).items[0]!
  const create = async (collection: string, data: object) => {
    const response = await request.post(`${api}/${collection}/records`, { data })
    expect(response.ok(), `${collection}: ${await response.text()}`).toBeTruthy()
    return await response.json() as { id: string }
  }
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const game = await create('games', { name: `AD&D print ${suffix}`, system: system.id })
  const creature = await create('catalog', { system: system.id, type: 'creature', source: 'TEST', source_id: suffix, name: 'Invented Wisp', original_json: { format: 'adnd2e-html', stats: { 'Hit Dice': '3+1', Movement: '12' }, html: '<span><p>A gentle invented wisp.</p><script>window.cardScriptRan = true</script><table><tr><td>Frequency</td><td>Rare</td></tr></table></span>' } })
  try {
    const encounter = await create('encounters', { game: game.id, name: 'An invented encounter' })
    await create('encounter_creatures', { encounter: encounter.id, creature: creature.id, name: 'Invented Wisp', quantity: 1 })
    await page.goto(`/games/${game.id}/monsters/print?encounter=${encounter.id}`)
    await page.getByRole('button', { name: 'Select all cards' }).click()
    const front = page.locator('.physical-page .card-face-front')
    await expect(front).toContainText('Hit Dice')
    await expect(front).toContainText('3+1')
    await expect(front).toContainText('A gentle invented wisp.')
    await expect(front.locator('table')).toContainText('Rare')
    expect(await page.evaluate(() => (window as unknown as { cardScriptRan?: boolean }).cardScriptRan)).toBeUndefined()
  } finally {
    await request.delete(`${api}/games/records/${game.id}`)
    await request.delete(`${api}/catalog/records/${creature.id}`)
  }
})
