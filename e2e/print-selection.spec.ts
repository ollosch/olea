import type { APIRequestContext } from '@playwright/test'
import { expect, test, e2eApiBase } from './fixtures'

async function createRecord(request: APIRequestContext, collection: string, data: object) {
  const response = await request.post(`${e2eApiBase}/api/collections/${collection}/records`, { data })
  expect(response.ok(), `${collection}: ${await response.text()}`).toBeTruthy()
  return await response.json() as { id: string; name?: string }
}

test('encounter and card selection stay explicit, counted and warned', async ({ page, ids }, testInfo) => {
  await page.goto(`/games/${ids.gameId}/monsters/print?encounter=${ids.encounterId}`)
  await expect(page.getByRole('heading', { name: 'Choose encounters and creatures' })).toBeVisible()
  await expect(page.locator('select[multiple]')).toHaveCount(0)

  const encounters = page.getByRole('group', { name: 'Encounters' })
  await expect(encounters.getByRole('checkbox')).toHaveCount(2)
  const bridge = encounters.getByRole('checkbox', { name: /E2E Bridge Encounter/ })
  const forest = encounters.getByRole('checkbox', { name: /E2E Forest Encounter/ })
  await expect(bridge).toBeChecked()
  await expect(forest).not.toBeChecked()

  await forest.focus()
  await page.keyboard.press('Space')
  await expect(forest).toBeChecked()
  await expect(page.getByText('2 of 2 encounters selected')).toBeVisible()

  const cards = page.locator('[data-selection="creature-cards"]')
  await expect(cards.locator('.print-choice')).toHaveCount(3)
  await expect(page.getByText('0 of 3 cards selected')).toBeVisible()
  await page.getByRole('button', { name: 'Select all cards' }).click()
  await expect(page.getByText('3 of 3 cards selected')).toBeVisible()
  await expect(page.getByText(/1 selected card has a warning/)).toBeVisible()
  const custom = cards.locator('.print-choice').filter({ hasText: 'E2E Custom Wisp' })
  await expect(custom).toContainText('Custom participant · manual card')
  await expect(custom.locator('.print-choice-warning')).toContainText('no imported stats')

  if (testInfo.project.name === 'mobile-chromium') await forest.tap()
  else await forest.click()
  await expect(forest).not.toBeChecked()
  await expect(page.getByText('1 of 2 encounters selected')).toBeVisible()
  await expect(cards.locator('.print-choice')).toHaveCount(2)
  await expect(page.getByText('0 of 2 cards selected')).toBeVisible()

  await page.getByRole('button', { name: 'Select all cards' }).click()
  await page.getByRole('button', { name: 'Clear cards' }).click()
  await expect(page.getByText('0 of 2 cards selected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Print / Save PDF' })).toBeDisabled()
  await expect(page.getByText('No cards are selected. Choose at least one card above to preview and print.')).toBeVisible()

  await page.locator('a').filter({ hasText: 'Back to E2E Bridge Encounter' }).click()
  await expect(page).toHaveURL(new RegExp(`encounter=${ids.encounterId}`))
  await expect(page.getByRole('heading', { name: 'E2E Bridge Encounter' })).toBeVisible()
})

test('item print explains root carried scope and restores inventory scroll', async ({ page, ids, request }) => {
  const api = `${e2eApiBase}/api/collections`
  const create = async (collection: string, data: object) => {
    const response = await request.post(`${api}/${collection}/records`, { data })
    expect(response.ok(), `${collection}: ${await response.text()}`).toBeTruthy()
    return await response.json() as { id: string }
  }
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  for (let index = 1; index <= 18; index++) {
    await create('inventory_items', { inventory: ids.inventoryId, name: `Print marker ${String(index).padStart(2, '0')}`, quantity: 1, weight: 1, weight_known: true, is_container: false })
  }
  await create('inventory_items', { inventory: ids.inventoryId, container: ids.containerId, name: `Nested print marker ${suffix}`, quantity: 1, weight: 0, weight_known: true, is_container: false })
  await create('inventory_items', { stash: ids.stashId, name: `Stash print marker ${suffix}`, quantity: 1, weight: 0, weight_known: true, is_container: false })

  await page.goto(`/characters/${ids.characterId}/inventory`)
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(page.locator('.inventory-row').filter({ hasText: 'Print marker 18' })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 420))
  const savedPosition = await page.evaluate(() => Math.round(window.scrollY))
  expect(savedPosition).toBeGreaterThan(100)
  await page.locator('a').filter({ hasText: 'Print item cards' }).evaluate((element) => (element as HTMLAnchorElement).click())

  await expect(page.getByRole('heading', { name: 'Choose item cards' })).toBeVisible()
  await expect(page.getByText('Only root carried items are printed: items inside containers and stash contents are not included.', { exact: false })).toBeVisible()
  const choices = page.locator('[data-selection="items"] .print-choice')
  await expect(choices).toHaveCount(23)
  await expect(choices.filter({ hasText: `Nested print marker ${suffix}` })).toHaveCount(0)
  await expect(choices.filter({ hasText: `Stash print marker ${suffix}` })).toHaveCount(0)
  await expect(page.getByText('23 of 23 cards selected')).toBeVisible()

  await page.getByRole('button', { name: 'Clear cards' }).click()
  await expect(page.getByText('0 of 23 cards selected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Print / Save PDF' })).toBeDisabled()
  await page.getByRole('button', { name: 'Select all cards' }).click()
  await expect(page.getByText('23 of 23 cards selected')).toBeVisible()

  await page.locator('a.text-link').filter({ hasText: 'inventory' }).click()
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(page.locator('#inventory-store-title')).toHaveText('Carried inventory')
  await expect.poll(async () => Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - savedPosition)).toBeLessThanOrEqual(12)
})

test('spellbook selection counts warnings and returns to the originating book', async ({ page, ids }) => {
  await page.goto(`/characters/${ids.characterId}/spellbooks/${ids.spellbookId}/print`)
  await expect(page.getByRole('heading', { name: 'E2E Spellbook', exact: true })).toBeVisible()
  await expect(page.getByText('2 of 2 cards selected')).toBeVisible()
  await expect(page.getByText(/1 selected card has a warning/)).toBeVisible()

  const longSpell = page.getByRole('checkbox', { name: /E2E Long Verse/ })
  await expect(longSpell).toBeChecked()
  await longSpell.uncheck()
  await expect(page.getByText('1 of 2 cards selected')).toBeVisible()
  await expect(page.getByText(/selected cards? (?:has|have) a warning/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Clear cards' }).click()
  await expect(page.getByText('0 of 2 cards selected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Print / Save PDF' })).toBeDisabled()
  await page.getByRole('button', { name: 'Select all cards' }).click()
  await expect(page.getByText('2 of 2 cards selected')).toBeVisible()

  await page.getByRole('link', { name: '← E2E Spellbook' }).click()
  await expect(page).toHaveURL(new RegExp(`book=${ids.spellbookId}`))
  await expect(page.getByRole('heading', { name: 'E2E Spellbook', exact: true })).toBeVisible()
})

test('inventory print return restores the selected stash, nested search and collapsed containers', async ({ page, ids, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const pack = await createRecord(request, 'inventory_items', { stash: ids.stashId, name: `Stash Pack ${suffix}`, quantity: 1, weight: 1, weight_known: true, is_container: true })
  const ropeIds: string[] = []
  for (let index = 1; index <= 18; index++) {
    const name = `Hidden Rope ${String(index).padStart(2, '0')} ${suffix}`
    const rope = await createRecord(request, 'inventory_items', { stash: ids.stashId, container: pack.id, name, quantity: 1, weight: 1, weight_known: true, is_container: false, notes: 'Nested stash marker' })
    ropeIds.push(rope.id)
  }

  await page.goto(`/characters/${ids.characterId}/inventory`)
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  const storeSelect = page.getByLabel('View contents')
  const search = page.getByLabel('Search inventory items')
  await storeSelect.selectOption(ids.stashId)
  await expect(page.locator('#inventory-store-title')).toHaveText('E2E Party Stash')
  const packRow = page.locator(`.inventory-row[data-item-id="${pack.id}"]`)
  const firstRopeRow = page.locator(`.inventory-row[data-item-id="${ropeIds[0]}"]`)
  const lastRopeRow = page.locator(`.inventory-row[data-item-id="${ropeIds[17]}"]`)
  await expect(packRow).toBeVisible()
  await page.getByRole('button', { name: `Collapse Stash Pack ${suffix}` }).click()
  await expect(page.getByRole('button', { name: `Expand Stash Pack ${suffix}` })).toBeVisible()
  await search.fill(`Hidden Rope 01 ${suffix}`)
  await expect(firstRopeRow).toContainText(`Inside Stash Pack ${suffix}`)
  await search.fill(`Hidden Rope`)
  await expect(lastRopeRow).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 420))
  const savedPosition = await page.evaluate(() => Math.round(window.scrollY))
  expect(savedPosition).toBeGreaterThan(100)

  await page.locator('a').filter({ hasText: 'Print item cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
  await expect(page.getByRole('heading', { name: 'Choose item cards' })).toBeVisible()
  await expect(page.getByText('Only root carried items are printed: items inside containers and stash contents are not included.', { exact: false })).toBeVisible()
  await expect(page.locator('[data-selection="items"] .print-choice').filter({ hasText: `Hidden Rope 01 ${suffix}` })).toHaveCount(0)

  await page.locator('a.text-link').filter({ hasText: 'inventory' }).click()
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(storeSelect).toHaveValue(ids.stashId)
  await expect(page.locator('#inventory-store-title')).toHaveText('E2E Party Stash')
  await expect(search).toHaveValue('Hidden Rope')
  await expect(firstRopeRow).toContainText(`Inside Stash Pack ${suffix}`)
  await expect.poll(async () => Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - savedPosition)).toBeLessThanOrEqual(12)
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('button', { name: `Expand Stash Pack ${suffix}` })).toBeVisible()
  await expect(firstRopeRow).toHaveCount(0)

  await search.fill('Hidden Rope')
  await expect(lastRopeRow).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 360))
  const browserBackPosition = await page.evaluate(() => Math.round(window.scrollY))
  expect(browserBackPosition).toBeGreaterThan(100)
  await page.locator('a').filter({ hasText: 'Print item cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
  await expect(page.getByRole('heading', { name: 'Choose item cards' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(storeSelect).toHaveValue(ids.stashId)
  await expect(page.locator('#inventory-store-title')).toHaveText('E2E Party Stash')
  await expect(search).toHaveValue('Hidden Rope')
  await expect(firstRopeRow).toContainText(`Inside Stash Pack ${suffix}`)
  await expect.poll(async () => Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - browserBackPosition)).toBeLessThanOrEqual(12)
})

test('direct inventory print returns to the root carried inventory without stale context', async ({ page, ids }) => {
  await page.goto(`/characters/${ids.characterId}/inventory/print`)
  await expect(page.getByRole('heading', { name: 'Choose item cards' })).toBeVisible()
  await expect(page.getByText('Only root carried items are printed: items inside containers and stash contents are not included.', { exact: false })).toBeVisible()
  await page.locator('a.text-link').filter({ hasText: 'inventory' }).click()
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(page.getByLabel('View contents')).toHaveValue('')
  await expect(page.locator('#inventory-store-title')).toHaveText('Carried inventory')
  await expect(page.getByLabel('Search inventory items')).toHaveValue('')
})

test('inventory print return skips stale context when the user interacts during loading', async ({ page, ids, request }) => {
  await createRecord(request, 'inventory_items', { stash: ids.stashId, name: `Delayed Stash Item ${Date.now()}`, quantity: 1, weight: 1, weight_known: true, is_container: false })
  await page.goto(`/characters/${ids.characterId}/inventory`)
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await page.getByLabel('View contents').selectOption(ids.stashId)
  await expect(page.locator('#inventory-store-title')).toHaveText('E2E Party Stash')
  await page.getByLabel('Search inventory items').fill('Delayed Stash Item')
  await page.locator('a').filter({ hasText: 'Print item cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
  await expect(page.getByRole('heading', { name: 'Choose item cards' })).toBeVisible()

  await page.route('**/api/collections/inventory_items/records**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.continue()
  })
  await page.locator('a.text-link').filter({ hasText: 'inventory' }).click()
  await page.mouse.wheel(0, 500)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(page.getByLabel('View contents')).toHaveValue('')
  await expect(page.locator('#inventory-store-title')).toHaveText('Carried inventory')
  await expect(page.getByLabel('Search inventory items')).toHaveValue('')
  await page.unroute('**/api/collections/inventory_items/records**')
})

test('inventory print return falls back with a notice when the saved stash was deleted', async ({ page, ids, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const stash = await createRecord(request, 'stashes', { game: ids.gameId, kind: 'location', name: `Deleted Print Stash ${suffix}` })
  await createRecord(request, 'inventory_items', { stash: stash.id, name: `Deleted Stash Item ${suffix}`, quantity: 1, weight: 1, weight_known: true, is_container: false })

  await page.goto(`/characters/${ids.characterId}/inventory`)
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await page.getByLabel('View contents').selectOption(stash.id)
  await expect(page.locator('#inventory-store-title')).toHaveText(`Deleted Print Stash ${suffix}`)
  await page.getByLabel('Search inventory items').fill(`Deleted Stash Item ${suffix}`)
  await page.locator('a').filter({ hasText: 'Print item cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
  await expect(page.getByRole('heading', { name: 'Choose item cards' })).toBeVisible()

  const removed = await request.delete(`${e2eApiBase}/api/collections/stashes/records/${stash.id}`)
  expect(removed.ok(), `stash deletion should succeed: ${await removed.text()}`).toBeTruthy()
  await page.locator('a.text-link').filter({ hasText: 'inventory' }).click()
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(page.getByText('The stash that was open when you printed is no longer available. Showing the carried inventory instead.')).toBeVisible()
  await expect(page.getByLabel('View contents')).toHaveValue('')
  await expect(page.locator('#inventory-store-title')).toHaveText('Carried inventory')
})
