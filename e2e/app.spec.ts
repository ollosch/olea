import { expect, test } from './fixtures'
import { openEncounters, openInventory } from './fixtures'

test('opens the games screen', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('Olea — Your table, ready')
  await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
})

test('reflects inventory changes in a second browser and after reconnect', async ({ browser, page, ids }) => {
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  try {
    await openInventory(page, ids.characterId)
    await openInventory(secondPage, ids.characterId)

    const primaryItem = page.locator('.inventory-row').filter({ hasText: 'E2E Potion' })
    await primaryItem.getByRole('button', { name: 'Edit' }).click()
    await primaryItem.getByLabel('Quantity').fill('8')
    await primaryItem.getByRole('button', { name: 'Save' }).click()
    await expect(secondPage.locator('.inventory-row').filter({ hasText: 'E2E Potion' })).toContainText('× 8')

    await secondPage.getByLabel('GP', { exact: true }).fill('27')
    await secondPage.getByLabel('GP', { exact: true }).press('Tab')
    await expect(page.getByLabel('GP', { exact: true })).toHaveValue('27')

    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('status')).toContainText('Server unavailable')

    const secondItem = secondPage.locator('.inventory-row').filter({ hasText: 'E2E Potion' })
    await secondItem.getByRole('button', { name: 'Edit' }).click()
    await secondItem.getByLabel('Quantity').fill('10')
    await secondItem.getByRole('button', { name: 'Save' }).click()
    await expect(secondItem).toContainText('× 10')

    await expect(page.locator('.inventory-row').filter({ hasText: 'E2E Potion' })).toContainText('× 8')
    await page.context().setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('status')).toContainText('Local server ready')
    await expect(page.locator('.inventory-row').filter({ hasText: 'E2E Potion' })).toContainText('× 10')
  } finally {
    await secondContext.close()
  }
})

test('rejects stale quantity, container, and coin edits and refreshes authoritative values', async ({ browser, page, ids }) => {
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  try {
    await openInventory(page, ids.characterId)
    await openInventory(secondPage, ids.characterId)

    const primaryItem = page.locator('.inventory-row').filter({ hasText: 'E2E Potion' })
    const secondItem = secondPage.locator('.inventory-row').filter({ hasText: 'E2E Potion' })
    await primaryItem.getByRole('button', { name: 'Edit' }).click()
    await secondItem.getByRole('button', { name: 'Edit' }).click()

    await primaryItem.getByLabel('Quantity').fill('5')
    await primaryItem.getByRole('button', { name: 'Save' }).click()
    await expect(secondItem.getByLabel('Quantity')).toHaveValue('3')
    await secondItem.getByLabel('Quantity').fill('9')
    await secondItem.getByRole('button', { name: 'Save' }).click()

    await expect(secondPage.getByRole('alert')).toContainText('This item changed or moved elsewhere')
    await secondItem.getByRole('button', { name: 'Discard draft' }).click()
    await expect(secondItem).toContainText('× 5')

    await primaryItem.getByRole('button', { name: 'Edit' }).click()
    await secondItem.getByRole('button', { name: 'Edit' }).click()
    await primaryItem.getByLabel('Place inside').selectOption({ label: 'E2E Satchel' })
    await primaryItem.getByRole('button', { name: 'Save' }).click()
    await secondItem.getByLabel('Quantity').fill('11')
    await secondItem.getByRole('button', { name: 'Save' }).click()
    await expect(secondPage.getByRole('alert')).toContainText('This item changed or moved elsewhere')
    await secondItem.getByRole('button', { name: 'Discard draft' }).click()
    await expect(secondItem).toContainText('× 5')
    await expect(secondItem).toContainText('Inside E2E Satchel')

    const firstCoin = page.getByLabel('GP', { exact: true })
    const staleCoin = secondPage.getByLabel('GP', { exact: true })
    await staleCoin.focus()
    await staleCoin.fill('20')
    await firstCoin.fill('22')
    await firstCoin.press('Tab')
    await expect(staleCoin).toHaveValue('20')
    await staleCoin.press('Tab')
    await expect(secondPage.getByRole('alert')).toContainText('Coin balance changed elsewhere')
    await expect(staleCoin).toHaveValue('22')
  } finally {
    await secondContext.close()
  }
})

test('updates the player encounter and respects its visibility setting', async ({ browser, page, ids }) => {
  const playerContext = await browser.newContext()
  const playerPage = await playerContext.newPage()
  try {
    await openEncounters(page, ids.gameId)
    await playerPage.goto(`/games/${ids.gameId}/encounter`)
    await expect(playerPage.getByText('E2E Goblin Scout')).toBeVisible()
    await expect(playerPage.getByText('HP 7/7')).toBeVisible()

    const goblin = page.locator('.combatant-card').filter({ hasText: 'E2E Goblin Scout' })
    await goblin.locator('.combatant-summary').click()
    await goblin.getByLabel('Current HP').fill('4')
    await goblin.getByLabel('Conditions').fill('Prone')
    await goblin.getByRole('button', { name: 'Save participant' }).click()
    await expect(playerPage.getByText('HP 4/7')).toBeVisible()
    await expect(playerPage.getByText('Prone')).toBeVisible()

    await page.getByText('Player display settings').click()
    await page.getByLabel('Show active encounter').uncheck()
    await expect(playerPage.getByRole('heading', { name: 'No player encounter is visible' })).toBeVisible()
    await page.getByLabel('Show active encounter').check()
    await expect(playerPage.getByText('HP 4/7')).toBeVisible()
  } finally {
    await playerContext.close()
  }
})

test('transfers items and coins without losing or duplicating them', async ({ page, ids }) => {
  await openInventory(page, ids.characterId)
  const item = page.locator('.inventory-row').filter({ hasText: 'E2E Potion' })
  await item.getByRole('button', { name: 'Move' }).click()
  await item.getByLabel('Quantity').fill('2')
  await item.getByLabel('Move to').selectOption({ label: 'E2E Party Stash (party)' })
  await item.getByRole('button', { name: 'Move item' }).click()
  await expect(item).toContainText('× 1')

  await page.locator('.coin-transfer label').first().locator('select').selectOption('gp')
  await page.locator('.coin-transfer label').nth(2).locator('select').selectOption({ label: 'E2E Party Stash (party)' })
  await page.getByLabel('Amount', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Transfer coins' }).click()
  await expect(page.getByLabel('GP', { exact: true })).toHaveValue('7')

  await page.getByLabel('View contents').selectOption({ label: 'E2E Party Stash (party)' })
  await expect(page.locator('.inventory-row').filter({ hasText: 'E2E Potion' })).toContainText('× 2')
  await expect(page.getByLabel('GP', { exact: true })).toHaveValue('8')
})

test('touch viewport keeps controls within the screen and supports tap workflows', async ({ page, ids, isMobile }) => {
  test.skip(!isMobile, 'Mobile touch coverage runs in the mobile Chromium project.')
  await openInventory(page, ids.characterId)

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
  for (const locator of [page.getByRole('button', { name: 'Custom item' }), page.getByRole('button', { name: 'Move' }).first()]) {
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.width).toBeGreaterThanOrEqual(44)
  }

  await page.getByRole('button', { name: 'Custom item' }).tap()
  await expect(page.getByRole('heading', { name: 'Custom item' })).toBeVisible()
  await page.getByLabel('Name').fill('E2E Touch Lantern')
  await page.getByRole('button', { name: 'Add item' }).tap()
  await expect(page.locator('.inventory-row').filter({ hasText: 'E2E Touch Lantern' })).toBeVisible()
})

test('mouse viewport fits the workspace without horizontal overflow', async ({ page, ids, isMobile }) => {
  test.skip(isMobile, 'Desktop mouse coverage runs in the desktop Chromium project.')
  await openInventory(page, ids.characterId)
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
  await page.getByRole('button', { name: 'Custom item' }).click()
  await expect(page.getByRole('heading', { name: 'Custom item' })).toBeVisible()
})
