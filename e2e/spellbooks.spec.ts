import { e2eApiBase, expect, test } from './fixtures'
import type { APIRequestContext, Locator, Page } from '@playwright/test'

const api = `${e2eApiBase}/api/collections`
const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
let sequence = 0

function uniqueName(label: string) {
  sequence += 1
  return `${label} ${key}-${sequence}`
}

async function create(request: APIRequestContext, collection: string, data: Record<string, unknown>) {
  const response = await request.post(`${api}/${collection}/records`, { data })
  expect(response.ok(), `${collection}: ${await response.text()}`).toBeTruthy()
  return await response.json() as { id: string }
}

async function dnd5eSystem(request: APIRequestContext) {
  const response = await request.get(`${api}/systems/records?filter=${encodeURIComponent("(key='dnd5e')")}`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json() as { items: Array<{ id: string }> }).items[0]!.id
}

async function createSpell(request: APIRequestContext, systemId: string, name: string, description = 'An invented spell.') {
  return await create(request, 'catalog', {
    system: systemId,
    type: 'spell',
    source: 'SYNTHETIC',
    source_id: `${key}-${name.replace(/\W+/g, '-').toLowerCase()}`,
    name,
    level: '1',
    school: 'Evocation',
    original_json: { entries: [description] },
    alternate_description: '',
    notes: '',
  })
}

async function scrollY(page: Page) {
  return page.evaluate(() => Math.round(window.scrollY))
}

async function doubleClick(locator: Locator) {
  await locator.evaluate((element) => {
    const button = element as HTMLButtonElement
    button.click()
    button.click()
  })
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

test('compact spell list searches and expands preferred details with the keyboard', async ({ page, ids, isMobile }) => {
  await page.goto(`/characters/${ids.characterId}/spellbooks?book=${ids.spellbookId}`)
  await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
  await expect(page.locator('.spell-entry')).toHaveCount(2)
  await expect(page.locator('.spell-entry-details')).toHaveCount(0)

  const longRow = page.locator('.spell-entry').filter({ hasText: 'E2E Long Verse' })
  await expect(longRow).toContainText('SYNTHETIC')
  const search = page.getByLabel('Search this book')
  await search.fill('illusion')
  await expect(page.locator('.spell-entry')).toHaveCount(1)
  await expect(page.locator('.spell-entry')).toContainText('E2E Long Verse')

  await search.fill('long verse')
  const toggle = longRow.locator('.spell-entry-toggle')
  await toggle.focus()
  await page.keyboard.press('Enter')
  const details = longRow.locator('.spell-entry-details')
  await expect(details).toBeVisible()
  await expect(details).toContainText('Level')
  await expect(details).toContainText('Illusion')
  await expect(details.locator('.entry-text').first()).toHaveText(/^A A A/)
  await expect(details).not.toContainText('An invented phrase.')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(details).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await page.getByRole('button', { name: 'Clear spell search' }).click()
  await expect(page.locator('.spell-entry')).toHaveCount(2)
  await expect(search).toBeFocused()

  const spark = page.locator('.spell-entry').filter({ hasText: 'E2E Spark' })
  await spark.locator('.spell-entry-toggle').click()
  await expect(spark).toContainText('A table-friendly invented spark.')
  await expect(spark).not.toContainText('A bright invented spark.')

  await page.setViewportSize({ width: 320, height: 800 })
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport)
  if (isMobile) await expect(page.locator('.spell-entry-toggle').first()).toBeVisible()
})

test('spell picker blocks duplicates, repeated adds and uncertain writes', async ({ page, request, ids }) => {
  const systemId = await dnd5eSystem(request)
  const alphaName = uniqueName('Repeated Alpha')
  const betaName = uniqueName('Repeated Beta')
  const gammaName = uniqueName('Uncertain Gamma')
  const catalogIds = [
    (await createSpell(request, systemId, alphaName)).id,
    (await createSpell(request, systemId, betaName)).id,
    (await createSpell(request, systemId, gammaName)).id,
  ]
  try {
    await page.goto(`/characters/${ids.characterId}/spellbooks?book=${ids.spellbookId}`)
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
    const invoker = page.getByRole('button', { name: '＋ Add spell' })

    let createRequests = 0
    await page.route('**/api/collections/spellbook_spells/records**', async (route) => {
      if (route.request().method() === 'POST') {
        createRequests++
        await wait(400)
      }
      await route.continue()
    })
    await invoker.click()
    let dialog = page.getByRole('dialog', { name: 'Choose a spell' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox').fill(alphaName)
    const result = dialog.locator('.picker-result')
    await expect(result).toHaveCount(1)
    await doubleClick(result)
    await expect(dialog).toBeHidden()
    await expect(page.locator('.spell-entry').filter({ hasText: alphaName })).toHaveCount(1)
    expect(createRequests).toBe(1)
    await page.unroute('**/api/collections/spellbook_spells/records**')

    await invoker.click()
    dialog = page.getByRole('dialog', { name: 'Choose a spell' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox').fill(alphaName)
    const duplicate = dialog.locator('.picker-result')
    await expect(duplicate).toBeDisabled()
    await expect(duplicate).toContainText('Already in this book')
    await dialog.getByRole('searchbox').fill(betaName)
    await expect(dialog.locator('.picker-result')).toBeEnabled()
    await dialog.locator('.picker-result').click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.spell-entry').filter({ hasText: betaName })).toHaveCount(1)
    await expect(page.locator('.spell-entry').filter({ hasText: alphaName })).toHaveCount(1)

    let uncertainRequests = 0
    await page.route('**/api/collections/spellbook_spells/records**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      uncertainRequests++
      await route.fetch()
      await route.abort('failed')
    })
    await invoker.click()
    dialog = page.getByRole('dialog', { name: 'Choose a spell' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox').fill(gammaName)
    const uncertain = dialog.locator('.picker-result')
    await expect(uncertain).toHaveCount(1)
    await uncertain.click()
    await expect(dialog.getByText(`Could not confirm whether ${gammaName} was added because the connection failed.`)).toBeVisible()
    await expect(uncertain).toBeDisabled()
    await doubleClick(uncertain)
    expect(uncertainRequests).toBe(1)
    await dialog.getByRole('button', { name: 'Close catalog picker' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText(`Could not confirm whether ${gammaName} was added. Refresh before trying again.`)).toBeVisible()

    await page.locator('.alert-message').getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.spell-entry').filter({ hasText: gammaName })).toHaveCount(1)
    await invoker.click()
    dialog = page.getByRole('dialog', { name: 'Choose a spell' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox').fill(gammaName)
    await expect(dialog.locator('.picker-result')).toBeDisabled()
    await expect(dialog.locator('.picker-result')).toContainText('Already in this book')
    await page.unroute('**/api/collections/spellbook_spells/records**')
  } finally {
    for (const id of catalogIds) await request.delete(`${api}/catalog/records/${id}`)
  }
})

test('keeps the selected book and scroll position through print and browser history', async ({ page, request, ids }) => {
  const systemId = await dnd5eSystem(request)
  const bookName = uniqueName('Scroll Book')
  const book = await create(request, 'spellbooks', { character: ids.characterId, name: bookName })
  const catalogIds: string[] = []
  try {
    for (let index = 1; index <= 18; index++) {
      const spell = await createSpell(request, systemId, `Scroll Marker ${String(index).padStart(2, '0')}`, `Invented scroll spell ${index}.`)
      catalogIds.push(spell.id)
      await create(request, 'spellbook_spells', { spellbook: book.id, spell: spell.id })
    }

    await page.goto(`/characters/${ids.characterId}/spellbooks?book=${book.id}`)
    await expect(page.getByRole('heading', { name: bookName, exact: true })).toBeVisible()
    await expect(page.locator('.spellbook-tab.selected')).toContainText(bookName)
    await expect(page.locator('.spell-entry')).toHaveCount(18)

    await page.reload()
    await expect(page.getByRole('heading', { name: bookName, exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`book=${book.id}`))

    await page.locator('.spellbook-tab').filter({ hasText: 'E2E Spellbook' }).click()
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`book=${ids.spellbookId}`))
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()

    await page.locator('.spellbook-tab').filter({ hasText: bookName }).click()
    await expect(page.getByRole('heading', { name: bookName, exact: true })).toBeVisible()
    await expect(page.locator('.spell-entry')).toHaveCount(18)
    await page.evaluate(() => window.scrollTo(0, 420))
    const savedPosition = await scrollY(page)
    expect(savedPosition).toBeGreaterThan(100)

    await page.locator('a').filter({ hasText: 'Print cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
    await expect(page.getByRole('heading', { name: bookName, exact: true })).toBeVisible()
    await page.getByRole('link', { name: `← ${bookName}` }).click()
    await expect(page.getByRole('heading', { name: bookName, exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/spellbooks\\?book=${book.id}$`))
    await expect(page.locator('.spellbook-tab.selected')).toContainText(bookName)
    await expect(page.locator('.spell-entry')).toHaveCount(18)
    await expect.poll(async () => Math.abs((await scrollY(page)) - savedPosition)).toBeLessThanOrEqual(12)

    await page.evaluate(() => window.scrollTo(0, 260))
    const browserBackPosition = await scrollY(page)
    expect(browserBackPosition).toBeGreaterThan(100)
    await page.locator('a').filter({ hasText: 'Print cards' }).evaluate((element) => (element as HTMLAnchorElement).click())
    await expect(page.getByRole('heading', { name: bookName, exact: true })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { name: bookName, exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/spellbooks\\?book=${book.id}$`))
    await expect(page.locator('.spellbook-tab.selected')).toContainText(bookName)
    await expect(page.locator('.spell-entry')).toHaveCount(18)
    await expect.poll(async () => Math.abs((await scrollY(page)) - browserBackPosition)).toBeLessThanOrEqual(12)
  } finally {
    await request.delete(`${api}/spellbooks/records/${book.id}`)
    for (const id of catalogIds) await request.delete(`${api}/catalog/records/${id}`)
  }
})

test('book administration menu renames, deletes and protects an unsaved name', async ({ page, request, ids }) => {
  const book = await create(request, 'spellbooks', { character: ids.characterId, name: uniqueName('Menu Temp Book') })
  try {
    await page.goto(`/characters/${ids.characterId}/spellbooks?book=${book.id}`)
    await expect(page.getByRole('heading', { name: /Menu Temp Book/ })).toBeVisible()

    await page.getByRole('button', { name: 'Book administration for Menu Temp Book' }).click()
    await page.getByRole('menuitem', { name: 'Rename book' }).click()
    const nameInput = page.getByLabel('Book name')
    await nameInput.fill('Menu Renamed Book')
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('heading', { name: 'Menu Renamed Book' })).toBeVisible()
    await expect(page.locator('.spellbook-tab.selected')).toContainText('Menu Renamed Book')

    await page.getByRole('button', { name: 'Book administration for Menu Renamed Book' }).click()
    await page.getByRole('menuitem', { name: 'Rename book' }).click()
    await nameInput.fill('Unsaved Menu Name')
    const otherTab = page.locator('.spellbook-tab').filter({ hasText: 'E2E Spellbook' })
    await expect(otherTab).toBeDisabled()
    await expect(page.getByText('Save or cancel the book name before switching books.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Menu Renamed Book' })).toBeVisible()
    await expect(nameInput).toHaveValue('Unsaved Menu Name')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(otherTab).toBeEnabled()
    await otherTab.click()
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()

    await page.locator('.spellbook-tab').filter({ hasText: 'Menu Renamed Book' }).click()
    await expect(page.getByRole('heading', { name: 'Menu Renamed Book' })).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Book administration for Menu Renamed Book' }).click()
    await page.getByRole('menuitem', { name: 'Delete book' }).click()
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
    await expect(page.locator('.spellbook-tab').filter({ hasText: 'Menu Renamed Book' })).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`book=${ids.spellbookId}`))
  } finally {
    await request.delete(`${api}/spellbooks/records/${book.id}`)
  }
})

test('missing catalog spell references stay understandable and removable', async ({ page, request, ids }) => {
  const systemId = await dnd5eSystem(request)
  const book = await create(request, 'spellbooks', { character: ids.characterId, name: uniqueName('Missing Book') })
  const spell = await createSpell(request, systemId, uniqueName('Removed Source Spell'), 'Original source text.')
  try {
    await create(request, 'spellbook_spells', { spellbook: book.id, spell: spell.id })
    // A relation can outlive a catalog record after an import/restore mismatch. Simulate the
    // expanded relation disappearing without trying to delete a record PocketBase protects.
    await page.route('**/api/collections/spellbook_spells/records**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      const data = await response.json() as { items: Array<{ expand?: unknown }> }
      for (const item of data.items) delete item.expand
      await route.fulfill({ response, json: data })
    })

    await page.goto(`/characters/${ids.characterId}/spellbooks?book=${book.id}`)
    await expect(page.getByRole('heading', { name: /Missing Book/ })).toBeVisible()
    const row = page.locator('.spell-entry').filter({ hasText: 'Unknown spell' })
    await expect(row).toContainText('Missing catalog reference')
    await page.getByLabel('Search this book').fill('missing')
    await expect(row).toHaveCount(1)

    await row.locator('.spell-entry-toggle').click()
    await expect(row.locator('.spell-entry-details')).toContainText('points to a catalog record that is missing')
    await expect(row.locator('.spell-entry-details')).not.toContainText('Original source text.')
    await row.getByRole('button', { name: 'Remove from book' }).click()
    await expect(page.getByRole('heading', { name: 'No spells in this book' })).toBeVisible()
  } finally {
    await page.unroute('**/api/collections/spellbook_spells/records**')
    await request.delete(`${api}/spellbooks/records/${book.id}`)
    await request.delete(`${api}/catalog/records/${spell.id}`)
  }
})

test('a delayed book load cannot replace a newer selection with stale rows', async ({ page, request, ids }) => {
  const systemId = await dnd5eSystem(request)
  const slowBookName = uniqueName('Slow Book')
  const slowBook = await create(request, 'spellbooks', { character: ids.characterId, name: slowBookName })
  const catalogIds: string[] = []
  try {
    for (let index = 1; index <= 3; index++) {
      const spell = await createSpell(request, systemId, `Slow Marker ${index}`, `Slow invented spell ${index}.`)
      catalogIds.push(spell.id)
      await create(request, 'spellbook_spells', { spellbook: slowBook.id, spell: spell.id })
    }

    await page.goto(`/characters/${ids.characterId}/spellbooks?book=${ids.spellbookId}`)
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
    await expect(page.locator('.spell-entry')).toHaveCount(2)

    await page.route('**/api/collections/spellbook_spells/records**', async (route) => {
      if (route.request().method() === 'GET' && route.request().url().includes(slowBook.id)) await wait(700)
      await route.continue()
    })
    await page.locator('.spellbook-tab').filter({ hasText: slowBookName }).click()
    await expect(page.getByRole('heading', { name: slowBookName, exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Loading spells…' })).toBeVisible()
    await expect(page.locator('.spell-entry')).toHaveCount(0)

    await page.locator('.spellbook-tab').filter({ hasText: 'E2E Spellbook' }).click()
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
    await expect(page.locator('.spell-entry')).toHaveCount(2)
    await page.waitForTimeout(900)
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
    await expect(page.locator('.spell-entry')).toHaveCount(2)
    await expect(page.locator('.spell-entry').filter({ hasText: 'Slow Marker' })).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`book=${ids.spellbookId}`))
  } finally {
    await request.delete(`${api}/spellbooks/records/${slowBook.id}`)
    for (const id of catalogIds) await request.delete(`${api}/catalog/records/${id}`)
  }
})

test('a pending add stays scoped to its book and blocks tab or same-route switching', async ({ page, request, ids }) => {
  const systemId = await dnd5eSystem(request)
  const targetName = uniqueName('Zulu Switch Book')
  const target = await create(request, 'spellbooks', { character: ids.characterId, name: targetName })
  const spellName = uniqueName('Scoped Add Spell')
  const spell = await createSpell(request, systemId, spellName)
  try {
    await page.goto(`/characters/${ids.characterId}/spellbooks?book=${target.id}`)
    await expect(page.getByRole('heading', { name: targetName, exact: true })).toBeVisible()
    const otherTab = page.locator('.spellbook-tab').filter({ hasText: 'E2E Spellbook' })
    await expect(otherTab).toBeEnabled()

    let createRequests = 0
    await page.route('**/api/collections/spellbook_spells/records**', async (route) => {
      if (route.request().method() === 'POST') {
        createRequests++
        await wait(700)
      }
      await route.continue()
    })
    await page.getByRole('button', { name: '＋ Add spell' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Choose a spell' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox').fill(spellName)
    await expect(dialog.locator('.picker-result')).toHaveCount(1)
    await dialog.locator('.picker-result').click()
    await expect(dialog.getByText(`Adding ${spellName}…`)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await expect(otherTab).toBeDisabled()
    await expect(page.getByText('Wait for the current add attempt to finish before switching books.', { exact: true })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    await nav.getByRole('link', { name: /^Spellbooks/ }).click()
    await expect(page.getByRole('heading', { name: targetName, exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`book=${target.id}`))
    await expect(page.getByText('Wait for the current add attempt to finish before switching books.', { exact: true })).toBeVisible()

    await expect(page.locator('.spell-entry').filter({ hasText: spellName })).toHaveCount(1)
    expect(createRequests).toBe(1)
    await expect(otherTab).toBeEnabled()
    await otherTab.click()
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
    await expect(page.locator('.spell-entry').filter({ hasText: spellName })).toHaveCount(0)
  } finally {
    await request.delete(`${api}/spellbooks/records/${target.id}`)
    await request.delete(`${api}/catalog/records/${spell.id}`)
  }
})

test('failed add reconciliation keeps guards and a successful retry does not duplicate', async ({ page, request, ids }) => {
  const systemId = await dnd5eSystem(request)
  const spellName = uniqueName('Reconcile Spell')
  const spell = await createSpell(request, systemId, spellName)
  const otherBookName = uniqueName('Reconcile Other Book')
  const otherBook = await create(request, 'spellbooks', { character: ids.characterId, name: otherBookName })
  try {
    await page.goto(`/characters/${ids.characterId}/spellbooks?book=${ids.spellbookId}`)
    await expect(page.getByRole('heading', { name: 'E2E Spellbook' })).toBeVisible()
    const otherTab = page.locator('.spellbook-tab').filter({ hasText: otherBookName })
    let created = false
    let refreshFailures = 2
    await page.route('**/api/collections/spellbook_spells/records**', async (route) => {
      if (route.request().method() === 'POST') {
        created = true
        await route.continue()
        return
      }
      if (created && refreshFailures > 0) {
        refreshFailures--
        await route.abort('failed')
        return
      }
      await route.continue()
    })

    await page.getByRole('button', { name: '＋ Add spell' }).first().click()
    let dialog = page.getByRole('dialog', { name: 'Choose a spell' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox').fill(spellName)
    await expect(dialog.locator('.picker-result')).toHaveCount(1)
    await dialog.locator('.picker-result').click()
    await expect(dialog.getByText(`${spellName} was added, but the spell list could not refresh. Refresh this screen before adding anything else.`)).toBeVisible()
    await dialog.getByRole('button', { name: 'Close catalog picker' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText(`${spellName} was added, but the spell list could not refresh. Refresh to see it.`)).toBeVisible()
    await expect(page.getByRole('button', { name: '＋ Add spell' }).first()).toBeDisabled()
    await expect(otherTab).toBeDisabled()

    await page.locator('.alert-message').getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Spells in this book could not be loaded.')).toBeVisible()
    await expect(page.getByRole('button', { name: '＋ Add spell' }).first()).toBeDisabled()
    await expect(otherTab).toBeDisabled()
    await expect(page.locator('.spell-entry').filter({ hasText: spellName })).toHaveCount(0)

    await page.locator('.alert-message').getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.spell-entry').filter({ hasText: spellName })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '＋ Add spell' }).first()).toBeEnabled()
    await expect(otherTab).toBeEnabled()
    const list = await request.get(`${api}/spellbook_spells/records?filter=${encodeURIComponent(`spellbook='${ids.spellbookId}' && spell='${spell.id}'`)}&perPage=200`)
    expect(list.ok(), await list.text()).toBeTruthy()
    expect((await list.json() as { items: unknown[] }).items).toHaveLength(1)

    await page.getByRole('button', { name: '＋ Add spell' }).first().click()
    dialog = page.getByRole('dialog', { name: 'Choose a spell' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox').fill(spellName)
    await expect(dialog.locator('.picker-result')).toBeDisabled()
    await expect(dialog.locator('.picker-result')).toContainText('Already in this book')
  } finally {
    await request.delete(`${api}/spellbooks/records/${otherBook.id}`)
    await request.delete(`${api}/catalog/records/${spell.id}`)
  }
})
