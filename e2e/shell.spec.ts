import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
}

test('desktop game shell exposes context tools, selected character, and useful width', async ({ page, ids, isMobile }) => {
  test.skip(isMobile, 'Desktop workspace width is covered in the desktop project.')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/games')
  await page.evaluate((characterId) => localStorage.setItem('olea.selectedCharacter', characterId), ids.characterId)
  await page.goto(`/games/${ids.gameId}/characters`)

  const nav = mainNav(page)
  await expect(nav.getByRole('link', { name: /^Games/ })).toHaveClass(/is-active/)
  await expect(nav.getByRole('link', { name: /^Characters/ })).toHaveClass(/is-active/)
  await expect(nav.getByRole('link', { name: /^Encounters/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Tables/ })).toBeVisible()
  await expect(nav.locator('.nav-context-title')).toContainText('E2E table')
  await expect(nav.getByRole('link', { name: /E2E Ranger/ })).toHaveAttribute('href', `/characters/${ids.characterId}`)
  await expect(nav.getByText('GM and player labels describe views, not access control.')).toBeVisible()

  const at1280 = await page.locator('.screen').boundingBox()
  expect(at1280?.width ?? 0).toBeGreaterThan(880)
  await expectNoHorizontalOverflow(page)

  await page.setViewportSize({ width: 1920, height: 1080 })
  const atLarge = await page.locator('.screen').boundingBox()
  expect(atLarge?.width ?? 0).toBeGreaterThan(1000)
  expect(atLarge?.width ?? 0).toBeLessThanOrEqual(1120)
  await expectNoHorizontalOverflow(page)
})

test('character shell exposes character tools and a stored selected character', async ({ page, ids }) => {
  await page.goto(`/characters/${ids.characterId}/inventory`)

  const nav = mainNav(page)
  await expect(nav.getByRole('link', { name: /^Choose character/ })).toHaveClass(/is-active/)
  await expect(nav.getByRole('link', { name: /^Inventory/ })).toHaveClass(/is-active/)
  await expect(nav.getByRole('link', { name: /^Overview/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Spellbooks/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Active encounter/ })).toBeVisible()
  await expect(nav.locator('.nav-context-title')).toContainText('E2E Ranger')
  await expect(nav.getByRole('link', { name: /^Encounters/ })).toHaveCount(0)

  await page.evaluate((characterId) => localStorage.setItem('olea.selectedCharacter', characterId), ids.otherCharacterId)
  await page.reload()
  await expect(mainNav(page).getByRole('link', { name: /E2E Bard/ })).toHaveAttribute('href', `/characters/${ids.otherCharacterId}`)
})

test('back, forward, and a bookmarked player view preserve their context', async ({ page, ids }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/games/${ids.gameId}/characters`)

  await mainNav(page).getByRole('link', { name: /^Encounters/ }).click()
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/encounters$`))
  await expect(page.getByRole('heading', { name: 'Encounters' })).toBeVisible()
  await expect(mainNav(page).getByRole('link', { name: /^Encounters/ })).toHaveClass(/is-active/)

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/characters$`))
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/encounters$`))

  await page.goto(`/games/${ids.gameId}/encounter`)
  await expect(page.getByRole('heading', { name: 'E2E Bridge Encounter' })).toBeVisible()
  await expect(page.getByText('E2E Goblin Scout')).toBeVisible()

  const nav = mainNav(page)
  await expect(nav.getByRole('link', { name: /^Choose character/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Games/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /^Catalog/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /^Encounters/ })).toHaveCount(0)
  await expect(nav.getByText('GM and player labels describe views, not access control.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open appearance settings' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Olea home' })).toHaveAttribute('href', '/characters')
})

test('mobile navigation wraps without overflow and reaches game and character tools by touch', async ({ page, ids, isMobile }) => {
  test.skip(!isMobile, 'Touch navigation runs in the mobile Chromium project.')

  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(`/games/${ids.gameId}/characters`)
    const nav = mainNav(page)
    await expect(nav.getByRole('link', { name: /^Encounters/ })).toBeVisible()
    await expect(nav.getByRole('link', { name: /^Tables/ })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const links = nav.getByRole('link')
    for (let index = 0; index < await links.count(); index++) {
      const box = await links.nth(index).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(-0.5)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  }

  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(`/games/${ids.gameId}/characters`)
  await mainNav(page).getByRole('link', { name: /^Encounters/ }).tap()
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/encounters$`))

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/characters/${ids.characterId}/spellbooks`)
  await expect(mainNav(page).getByRole('link', { name: /^Inventory/ })).toBeVisible()
  await mainNav(page).getByRole('link', { name: /^Inventory/ }).tap()
  await expect(page).toHaveURL(new RegExp(`/characters/${ids.characterId}/inventory$`))
  await expectNoHorizontalOverflow(page)
})

test('print media hides the workspace shell and keeps the print output', async ({ page, ids }) => {
  await page.goto(`/characters/${ids.characterId}/inventory/print`)
  await expect(mainNav(page)).toBeVisible()
  await expect(page.locator('.card-print-workspace')).toBeVisible()

  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.topbar')).toBeHidden()
  await expect(mainNav(page)).toBeHidden()
  await expect(page.locator('.footer')).toBeHidden()
  await expect(page.locator('.physical-page').first()).toBeVisible()
})

test('context navigation is reachable and usable from the keyboard', async ({ page, ids }) => {
  await page.goto(`/games/${ids.gameId}/characters`)

  const encounters = mainNav(page).getByRole('link', { name: /^Encounters/ })
  await encounters.focus()
  await expect(encounters).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/games/${ids.gameId}/encounters$`))
  await expect(page.getByRole('heading', { name: 'Encounters' })).toBeVisible()
})
