import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
}

function gmRow(page: Page, name: string) {
  return page.locator('.combatant-card').filter({ hasText: name }).first()
}

function playerRow(page: Page, name: string) {
  return page.locator('.player-combatant-list .combatant-card').filter({ hasText: name }).first()
}

test('GM preparation, live combat and player display complete one coherent journey', async ({ browser, page, ids }) => {
  test.setTimeout(60_000)

  await page.goto(`/games/${ids.gameId}/encounters?encounter=${ids.encounterId}`)
  await expect(page.getByRole('heading', { name: 'Combat in progress' })).toBeVisible()
  await expect(page.locator('#main').getByRole('link', { name: 'Player view', exact: true })).toHaveAttribute('href', `/games/${ids.gameId}/encounter`)
  await expect(page.locator('.combatant-card')).toHaveCount(1)
  await expect(page.locator('.combatant-details')).toHaveCount(1)

  await page.getByRole('button', { name: 'End combat' }).click()
  await expect(page.getByRole('heading', { name: 'Combat in progress' })).toHaveCount(0)
  await expect(page.locator('.setup-row')).toHaveCount(6)
  await expect(page.locator('.setup-row').filter({ hasText: 'E2E Custom Wisp' }).first()).toContainText('enter HP manually')

  const useAverage = page.getByRole('button', { name: 'Use average' })
  await expect(useAverage).toHaveCount(3)
  for (let index = 0; index < 3; index++) await useAverage.nth(index).click()
  await expect(page.locator('.setup-summary')).toContainText('3 HP unset')

  await page.getByRole('button', { name: 'Start combat' }).click()
  await expect(page.getByRole('heading', { name: 'Combat in progress' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.setup-row')).toHaveCount(0)
  await expect(page.locator('.combatant-card')).toHaveCount(6)
  await expect(page.locator('.combatant-details')).toHaveCount(1)
  await expect(page.getByLabel('Current HP')).toHaveCount(1)
  await expect(page.locator('.turn-summary')).toContainText('Active:')

  const known = gmRow(page, 'E2E Shared Name 1')
  if (await known.locator('.combatant-details').count() === 0) await known.locator('.combatant-summary').click()
  await known.getByLabel('Damage or healing amount').fill('2')
  await known.getByRole('button', { name: 'Apply damage' }).click()
  await expect(known).toContainText('HP 6/8')

  const playerContext = await browser.newContext()
  const playerPage = await playerContext.newPage()

  try {
    await playerPage.goto(new URL(`/games/${ids.gameId}/encounter`, page.url()).toString())
    await expect(playerPage.getByRole('heading', { name: 'E2E Bridge Encounter' })).toBeVisible()
    await expect(playerPage.locator('.player-combatant-list .combatant-card')).toHaveCount(6)
    await expect(playerRow(playerPage, 'E2E Shared Name 1')).toContainText('HP 6/8')

    await known.getByLabel('Damage or healing amount').fill('1')
    await known.getByRole('button', { name: 'Apply damage' }).click()
    await expect(known).toContainText('HP 5/8')
    await expect(playerRow(playerPage, 'E2E Shared Name 1')).toContainText('HP 5/8')
    await expect(playerPage.getByText('Loading active encounter…')).toHaveCount(0)
    await expect(playerPage.locator('.player-combatant-list .combatant-card')).toHaveCount(6)

    const settings = page.locator('details.player-display-settings')
    await settings.locator('summary').click()
    await settings.getByLabel('Show enemy HP').uncheck()
    await expect(playerPage.locator('.player-combatant-list')).not.toContainText('HP 5/8')

    await settings.getByLabel('Show enemy HP').check()
    await expect(playerRow(playerPage, 'E2E Shared Name 1')).toContainText('HP 5/8')

    await settings.getByLabel('Show active encounter').uncheck()
    await expect(playerPage.getByRole('heading', { name: 'No player encounter is visible' })).toBeVisible()
    await settings.getByLabel('Show active encounter').check()
    await expect(playerPage.locator('.player-combatant-list .combatant-card')).toHaveCount(6)
  } finally {
    await playerContext.close()
  }
})

test('player inventory, spellbook and print journeys keep their context', async ({ page, ids }) => {
  test.setTimeout(30_000)

  await page.goto(`/characters/${ids.characterId}/inventory`)
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(page.locator('.inventory-row')).toHaveCount(5)

  const itemSearch = page.getByLabel('Search inventory items')
  await itemSearch.fill('Practice')
  await expect(page.getByText(/1 of 5 items match/)).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(itemSearch).toHaveValue('')

  await page.getByRole('link', { name: 'Print item cards' }).click()
  await expect(page.getByRole('heading', { name: 'Choose item cards' })).toBeVisible()
  await expect(page.getByText('5 of 5 cards selected')).toBeVisible()
  await expect(page.getByText('Only root carried items are printed')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/characters/${ids.characterId}/inventory/print$`))
  const itemPdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
  expect([...itemPdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)]).not.toHaveLength(0)

  await page.getByRole('link', { name: '← E2E Ranger’s inventory' }).click()
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()

  await page.getByRole('link', { name: '← E2E Ranger' }).click()
  await page.locator('.character-tool-list').getByRole('link', { name: /Spellbooks/ }).click()
  await expect(page.getByRole('heading', { name: 'E2E Ranger’s books' })).toBeVisible()

  const spellSearch = page.getByLabel('Search this book')
  await spellSearch.fill('Long Verse')
  await expect(page.locator('.spell-entry')).toHaveCount(1)
  const entryToggle = page.locator('.spell-entry-toggle').first()
  await entryToggle.focus()
  await expect(entryToggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Details for E2E Long Verse' })).toBeVisible()
  await expect(page.locator('.spell-entry').first()).toContainText('SYNTHETIC')
  await expect(page.getByRole('region', { name: 'Details for E2E Long Verse' })).toContainText('A A A')

  await spellSearch.fill('No such spell')
  await expect(page.getByRole('heading', { name: 'No spells match' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear spell search' }).first().click()
  await expect(page.locator('.spell-entry')).toHaveCount(2)

  await page.getByRole('link', { name: 'Print cards' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Spellbook', exact: true })).toBeVisible()
  await expect(page.getByText('2 of 2 cards selected')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/characters/${ids.characterId}/spellbooks/${ids.spellbookId}/print$`))
  const spellPdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
  expect([...spellPdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)]).not.toHaveLength(0)

  await page.getByRole('link', { name: '← E2E Spellbook' }).click()
  await expect(page).toHaveURL(new RegExp(`book=${ids.spellbookId}`))
  await expect(page.getByRole('heading', { name: 'E2E Spellbook', exact: true })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'E2E Spellbook', exact: true })).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`book=${ids.spellbookId}`))
  await expect(page.getByRole('heading', { name: 'E2E Spellbook', exact: true })).toBeVisible()
})

test('workspace screens stay usable from phone to large desktop widths', async ({ page, ids, isMobile }) => {
  test.skip(isMobile, 'This sweep sets explicit CSS widths; the Pixel 8 project covers touch layout separately.')
  test.setTimeout(60_000)

  for (const width of [320, 390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })

    await page.goto(`/games/${ids.gameId}/encounters?encounter=${ids.encounterId}`)
    await expect(page.getByRole('heading', { name: 'Combat in progress' })).toBeVisible()
    await expect(page.locator('.combatant-details')).toHaveCount(1)
    await expect(page.getByLabel('Current HP')).toHaveCount(1)
    await expectNoHorizontalOverflow(page)
    await expect(page.getByRole('button', { name: 'End combat' })).toBeVisible()

    await page.goto(`/characters/${ids.characterId}/inventory`)
    await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto(`/characters/${ids.characterId}/spellbooks?book=${ids.spellbookId}`)
    await expect(page.getByRole('heading', { name: 'E2E Ranger’s books' })).toBeVisible()
    await page.getByLabel('Search this book').fill('Long Verse')
    await page.locator('.spell-entry-toggle').first().click()
    await expect(page.getByRole('region', { name: 'Details for E2E Long Verse' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/catalog?system=dnd5e&type=spell&q=E2E')
    await expect(page.locator('.catalog-row').first()).toBeVisible()
    const catalogSearch = page.getByLabel('Search by name')
    await catalogSearch.focus()
    await catalogSearch.fill('Long Verse')
    await expect(page.locator('.catalog-row')).toHaveCount(1)
    await expect(catalogSearch).toBeFocused()
    await expect(page.getByText('1 entry', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  }
})

test('empty and error states recover without losing the journey', async ({ page, ids }) => {
  test.setTimeout(30_000)

  let failed = false
  await page.route('**/api/collections/inventories/records**', async (route) => {
    if (!failed) {
      failed = true
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.goto(`/characters/${ids.characterId}/inventory`)
  await expect(page.getByRole('alert').filter({ hasText: 'Inventory could not be loaded' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: /E2E Ranger’s items/ })).toBeVisible()
  await expect(page.locator('.inventory-row')).toHaveCount(5)
  await page.unroute('**/api/collections/inventories/records**')

  await page.goto(`/characters/${ids.characterId}/spellbooks?book=${ids.spellbookId}`)
  await page.getByLabel('Search this book').fill('Nothing matches this')
  await expect(page.getByRole('heading', { name: 'No spells match' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear spell search' }).first().click()
  await expect(page.locator('.spell-entry')).toHaveCount(2)
})
