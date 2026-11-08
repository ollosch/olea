import type { Locator, Page } from '@playwright/test'
import { e2eApiBase, expect, test } from './fixtures'

const api = `${e2eApiBase}/api/collections`
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })

async function activateWithKeyboard(page: Page, locator: Locator) {
  await locator.focus()
  await expect(locator).toBeFocused()
  await page.keyboard.press('Enter')
}

test('choosing a character opens its workspace and supports resume and switch', async ({ page, ids, isMobile }) => {
  await page.goto('/characters')
  await expect(page.getByRole('heading', { name: 'Choose your character' })).toBeVisible()

  const card = page.getByRole('button', { name: /E2E Ranger/ })
  await expect(card).toBeVisible()
  if (isMobile) await card.tap()
  else await activateWithKeyboard(page, card)

  await expect(page).toHaveURL(new RegExp(`/characters/${ids.characterId}$`))
  await expect(page.getByRole('heading', { name: 'E2E Ranger' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('olea.selectedCharacter'))).toBe(ids.characterId)

  const nav = mainNav(page)
  await expect(nav.getByRole('link', { name: /^Overview/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Inventory/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Spellbooks/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Active encounter/ })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/characters$/)
  await expect(page.getByRole('heading', { name: 'E2E Ranger' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume character' })).toBeVisible()

  await page.getByRole('button', { name: 'Switch character' }).click()
  expect(await page.evaluate(() => localStorage.getItem('olea.selectedCharacter'))).toBeNull()
  await expect(page.getByRole('button', { name: /E2E Ranger/ })).toContainText('Open character')
})

test('character workspace reaches inventory, spellbooks, and the shared encounter', async ({ page, ids }) => {
  await page.goto(`/characters/${ids.characterId}`)
  await expect(page.getByRole('heading', { name: 'E2E Ranger' })).toBeVisible()

  const tools = page.locator('.character-tool-list')
  await expect(tools.getByRole('link', { name: /Inventory/ })).toHaveAttribute('href', `/characters/${ids.characterId}/inventory`)
  await expect(tools.getByRole('link', { name: /Spellbooks/ })).toHaveAttribute('href', `/characters/${ids.characterId}/spellbooks`)
  await expect(tools.getByRole('link', { name: /Active encounter/ })).toHaveAttribute('href', `/games/${ids.gameId}/encounter`)

  await tools.getByRole('link', { name: /Inventory/ }).click()
  await expect(page).toHaveURL(new RegExp(`/characters/${ids.characterId}/inventory$`))
  await expect(page.getByRole('heading', { name: /items$/ })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Where to next' })).toBeVisible()

  await tools.getByRole('link', { name: /Spellbooks/ }).click()
  await expect(page).toHaveURL(new RegExp(`/characters/${ids.characterId}/spellbooks$`))
  await expect(page.getByRole('heading', { name: /books$/ })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Where to next' })).toBeVisible()

  await tools.getByRole('link', { name: /Active encounter/ }).click()
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/encounter$`))
  await expect(page.getByRole('heading', { name: 'E2E Bridge Encounter' })).toBeVisible()
  await expect(mainNav(page).getByRole('link', { name: /^Encounters/ })).toHaveCount(0)
})

test('a game entry exposes characters, encounters, and tables with working back navigation', async ({ page, ids }) => {
  await page.goto('/games')
  const row = page.locator('.game-row').filter({ hasText: 'E2E table' }).first()
  await expect(row.getByRole('link', { name: 'Open game' })).toHaveAttribute('href', `/games/${ids.gameId}/characters`)
  await expect(row.getByRole('link', { name: 'Encounters' })).toHaveAttribute('href', `/games/${ids.gameId}/encounters`)
  await expect(row.getByRole('link', { name: 'Tables' })).toHaveAttribute('href', `/games/${ids.gameId}/tables`)

  await row.getByRole('link', { name: 'Open game' }).click()
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/characters$`))
  await expect(page.getByRole('heading', { name: 'E2E table' })).toBeVisible()

  const nav = mainNav(page)
  await expect(nav.getByRole('link', { name: /^Encounters/ })).toHaveAttribute('href', `/games/${ids.gameId}/encounters`)
  await expect(nav.getByRole('link', { name: /^Tables/ })).toHaveAttribute('href', `/games/${ids.gameId}/tables`)

  await page.getByRole('link', { name: 'Random tables' }).click()
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/tables$`))
  await expect(page.getByRole('heading', { name: 'Random tables' })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/characters$`))
  await expect(page.getByRole('heading', { name: 'E2E table' })).toBeVisible()

  await page.goto(`/games/${ids.gameId}/encounters`)
  await expect(page.getByRole('heading', { name: 'Encounters' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'E2E table' })).toBeVisible()
})

test('game management keeps GM, ownership, rename, and delete discoverable', async ({ page, request, ids }) => {
  const profileName = `E2E Owner ${Date.now()}`
  const profileResponse = await request.post(`${api}/profiles/records`, { data: { name: profileName } })
  expect(profileResponse.ok(), await profileResponse.text()).toBeTruthy()
  const profile = await profileResponse.json() as { id: string }
  let temporaryCharacterId = ''

  try {
    await page.goto(`/games/${ids.gameId}/characters`)
    await expect(page.getByRole('heading', { name: 'E2E table' })).toBeVisible()

    const management = page.locator('details.game-management')
    await expect(page.getByLabel('Assign GM')).toBeHidden()
    await management.locator('summary').click()
    await expect(page.getByLabel('Assign GM')).toBeVisible()
    await page.getByLabel('Assign GM').selectOption(profile.id)
    await expect(management.locator('.management-summary')).toContainText(profileName)
    await expect.poll(async () => {
      const response = await request.get(`${api}/games/records/${ids.gameId}`)
      return (await response.json() as { gm_profile: string }).gm_profile
    }).toBe(profile.id)

    const rangerRow = page.locator('.character-management-row').filter({ hasText: 'E2E Ranger' })
    await expect(rangerRow.getByLabel('Owner')).toBeHidden()
    await rangerRow.locator('details.row-management summary').click()
    await rangerRow.getByLabel('Owner').selectOption(profile.id)
    await expect(rangerRow).toContainText(`Owned by ${profileName}`)
    await expect.poll(async () => {
      const response = await request.get(`${api}/characters/records/${ids.characterId}`)
      return (await response.json() as { owner: string }).owner
    }).toBe(profile.id)

    await page.getByRole('button', { name: /Add character/ }).first().click()
    await page.getByLabel('Character name').fill('E2E Temp Hero')
    await page.getByRole('button', { name: 'Save character' }).click()
    const temporaryRow = page.locator('.character-management-row').filter({ hasText: 'E2E Temp Hero' })
    await expect(temporaryRow).toBeVisible()

    const charactersResponse = await request.get(`${api}/characters/records?filter=${encodeURIComponent(`game='${ids.gameId}' && name='E2E Temp Hero'`)}`)
    expect(charactersResponse.ok(), await charactersResponse.text()).toBeTruthy()
    temporaryCharacterId = (await charactersResponse.json() as { items: Array<{ id: string }> }).items[0].id

    await temporaryRow.getByRole('button', { name: /^Character actions for E2E Temp Hero/ }).click()
    await page.getByRole('menuitem', { name: 'Rename character' }).click()
    await expect(page.getByRole('heading', { name: 'Rename character' })).toBeVisible()
    await page.getByLabel('Character name').fill('E2E Renamed Hero')
    await page.getByRole('button', { name: 'Save character' }).click()

    const renamedRow = page.locator('.character-management-row').filter({ hasText: 'E2E Renamed Hero' })
    await expect(renamedRow).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await renamedRow.getByRole('button', { name: /^Character actions for E2E Renamed Hero/ }).click()
    await page.getByRole('menuitem', { name: 'Delete character' }).click()
    await expect(renamedRow).toHaveCount(0)
  } finally {
    await request.patch(`${api}/games/records/${ids.gameId}`, { data: { gm_profile: '' } })
    await request.patch(`${api}/characters/records/${ids.characterId}`, { data: { owner: '' } })
    if (temporaryCharacterId) await request.delete(`${api}/characters/records/${temporaryCharacterId}`)
    await request.delete(`${api}/profiles/records/${profile.id}`)
  }
})

test('an empty game offers a clear next action and can be deleted from management', async ({ page, request, ids }) => {
  const gameResponse = await request.get(`${api}/games/records/${ids.gameId}`)
  expect(gameResponse.ok(), await gameResponse.text()).toBeTruthy()
  const systemId = (await gameResponse.json() as { system: string }).system
  const emptyName = `E2E Empty Game ${Date.now()}`
  const created = await request.post(`${api}/games/records`, { data: { name: emptyName, system: systemId } })
  expect(created.ok(), await created.text()).toBeTruthy()
  const emptyGame = await created.json() as { id: string }

  try {
    await page.goto(`/games/${emptyGame.id}/characters`)
    await expect(page.getByRole('heading', { name: emptyName })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No characters yet' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add the first character' })).toBeVisible()

    await page.locator('details.game-management summary').click()
    const deleteButton = page.getByRole('button', { name: 'Delete empty game' })
    await expect(deleteButton).toBeEnabled()
    page.once('dialog', (dialog) => dialog.accept())
    await deleteButton.click()

    await expect(page).toHaveURL(/\/games$/)
    await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible()
    await expect.poll(async () => (await request.get(`${api}/games/records/${emptyGame.id}`)).status()).toBe(404)
  } finally {
    await request.delete(`${api}/games/records/${emptyGame.id}`)
  }
})

test('character selection shows an empty state that points back to games', async ({ page }) => {
  await page.route(/\/api\/collections\/characters\/records(?:\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ page: 1, perPage: 200, totalItems: 0, totalPages: 0, items: [] }),
    })
  })

  await page.goto('/characters')
  await expect(page.getByRole('heading', { name: 'No characters to choose from' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Go to games/ })).toHaveAttribute('href', '/games')
})
