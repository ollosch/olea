import { e2eApiBase, expect, test } from './fixtures'

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
}

test('games screen uses the shared header, feedback region and keyboard action menu', async ({ page, ids }) => {
  await page.goto('/games')
  await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible()
  await expect(page.locator('.page-header')).toBeVisible()
  await expect(page.getByRole('button', { name: /Create a game/ })).toBeVisible()

  const heading = page.getByRole('heading', { name: 'Your games' })
  const headingBox = await heading.boundingBox()
  expect(headingBox?.height ?? 0).toBeLessThan(60)

  const row = page.locator('.game-row').filter({ hasText: 'E2E table' }).first()
  await expect(row).toBeVisible()
  const trigger = row.getByRole('button', { name: /^Game actions for E2E table/ })
  const menu = page.getByRole('menu')

  await trigger.focus()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Edit game' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Delete game' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Edit game' }).click()
  await expect(menu).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Edit game' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('loading and error feedback reserve space without moving the toolbar', async ({ page, ids }) => {
  let releaseGames: () => void = () => {}
  const gamesGate = new Promise<void>((resolve) => { releaseGames = resolve })
  const delayedGames = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    await gamesGate
    await route.continue()
  }
  await page.route('**/api/collections/games/records**', delayedGames)

  await page.goto('/games')
  await expect(page.getByText('Loading games…')).toBeVisible()
  const loadingButton = await page.getByRole('button', { name: /Create a game/ }).boundingBox()
  const loadingFeedback = await page.locator('.feedback-region').boundingBox()
  expect(loadingFeedback?.height ?? 0).toBeGreaterThanOrEqual(44)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.locator('.feedback-mark').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  releaseGames()
  await expect(page.locator('.game-row').first()).toBeVisible()
  await page.unroute('**/api/collections/games/records**', delayedGames)

  const failedGames = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 500, message: 'E2E synthetic failure' }),
    })
  }
  await page.route('**/api/collections/games/records**', failedGames)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Games could not be loaded')
  const errorButton = await page.getByRole('button', { name: /Create a game/ }).boundingBox()
  const errorFeedback = await page.locator('.feedback-region').boundingBox()
  expect(errorFeedback?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(Math.abs((errorButton?.y ?? 0) - (loadingButton?.y ?? 0))).toBeLessThanOrEqual(1)
  await page.unroute('**/api/collections/games/records**', failedGames)
})

test('long game names wrap at phone and desktop widths without horizontal overflow', async ({ page, request }) => {
  const systems = await request.get(`${e2eApiBase}/api/collections/systems/records?filter=(key='dnd5e')`)
  const system = (await systems.json() as { items: Array<{ id: string }> }).items[0]!
  const longName = `E2E Long ${'Unbroken'.repeat(16)}`
  const created = await request.post(`${e2eApiBase}/api/collections/games/records`, {
    data: { name: longName, system: system.id },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const game = await created.json() as { id: string }

  try {
    for (const width of [320, 390, 640, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/games')
      const row = page.locator('.game-row').filter({ hasText: 'E2E Long' }).first()
      await expect(row).toBeVisible()
      await expect(row.getByRole('button', { name: /^Game actions for E2E Long/ })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      const wrap = await row.locator('.game-copy h2').evaluate((el) => getComputedStyle(el).overflowWrap)
      expect(['anywhere', 'break-word']).toContain(wrap)
    }
  } finally {
    await request.delete(`${e2eApiBase}/api/collections/games/records/${game.id}`)
  }
})

test('appearance dialog is labelled and returns focus to its trigger', async ({ page }) => {
  await page.goto('/games')
  const trigger = page.getByRole('button', { name: 'Open appearance settings' })
  await trigger.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Appearance' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})
