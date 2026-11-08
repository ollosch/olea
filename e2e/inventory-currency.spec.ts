import { e2eApiBase, expect, test } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

const api = `${e2eApiBase}/api/collections`
const records = `${e2eApiBase}/api/olea/records`
const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const prefix = `Step13 ${key}`

type GameFixture = { gameId: string; characterId: string; inventoryId: string; stashId: string; name: string; stashName: string }
let five: GameFixture
let adnd: GameFixture
let unknown: GameFixture

test.describe.configure({ mode: 'serial' })

async function create(request: APIRequestContext, collection: string, data: Record<string, unknown>) {
  const response = await request.post(`${api}/${collection}/records`, { data })
  expect(response.ok(), `${collection} fixture: ${await response.text()}`).toBeTruthy()
  return (await response.json()).id as string
}

async function setBalances(request: APIRequestContext, collection: string, id: string, balances: Record<string, number>) {
  const response = await request.post(`${records}/${collection}/${id}/update`, { data: { expected: { balances: {} }, fields: { balances } } })
  expect(response.ok(), `${collection} balances fixture: ${await response.text()}`).toBeTruthy()
}

async function makeGame(request: APIRequestContext, systemId: string, label: string): Promise<GameFixture> {
  const name = `${prefix} ${label}`
  const stashName = `${prefix} ${label} Party`
  const gameId = await create(request, 'games', { name: `${name} game`, system: systemId })
  const characterId = await create(request, 'characters', { game: gameId, name })
  const inventoryId = await create(request, 'inventories', { game: gameId, character: characterId })
  const stashId = await create(request, 'stashes', { game: gameId, kind: 'party', name: stashName })
  return { gameId, characterId, inventoryId, stashId, name, stashName }
}

test.beforeAll(async ({ request }) => {
  const system = async (keyName: string) => {
    const response = await request.get(`${api}/systems/records?filter=${encodeURIComponent(`(key='${keyName}')`)}`)
    expect(response.ok(), await response.text()).toBeTruthy()
    return (await response.json()).items[0]?.id as string
  }
  const dndSystemId = await system('dnd5e')
  const adndSystemId = await system('adnd2e')

  five = await makeGame(request, dndSystemId, 'Five')
  adnd = await makeGame(request, dndSystemId, 'Adnd')
  unknown = await makeGame(request, dndSystemId, 'Unknown')

  await setBalances(request, 'inventories', five.inventoryId, { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 })
  await setBalances(request, 'stashes', five.stashId, { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 })
  await setBalances(request, 'inventories', adnd.inventoryId, { gp: 4 })
  await setBalances(request, 'stashes', adnd.stashId, { gp: 1 })
  await setBalances(request, 'inventories', unknown.inventoryId, { gp: 9 })
  await setBalances(request, 'stashes', unknown.stashId, { gp: 2 })

  const capacity = await request.post(`${records}/inventories/${five.inventoryId}/update`, {
    data: { expected: { capacity: 0, capacity_known: false }, fields: { capacity: 10, capacity_known: true } },
  })
  expect(capacity.ok(), `capacity fixture: ${await capacity.text()}`).toBeTruthy()
  await create(request, 'inventory_items', { inventory: five.inventoryId, name: `${prefix} Weighted crate`, quantity: 1, weight: 20, weight_known: true, is_container: false })

  const changed = await request.patch(`${api}/games/records/${adnd.gameId}`, { data: { system: adndSystemId } })
  expect(changed.ok(), `system change fixture: ${await changed.text()}`).toBeTruthy()
})

test.afterAll(async ({ request }) => {
  for (const fixture of [five, adnd, unknown]) {
    if (!fixture?.gameId) continue
    const response = await request.delete(`${api}/games/records/${fixture.gameId}`)
    expect(response.ok(), `step 13 fixture cleanup: ${await response.text()}`).toBeTruthy()
  }
})

async function openInventory(page: Page, fixture: GameFixture) {
  await page.goto(`/characters/${fixture.characterId}/inventory`)
  await expect(page.getByRole('heading', { name: `${fixture.name}’s items` })).toBeVisible()
}

async function balances(page: Page, collection: string, id: string) {
  const response = await page.request.get(`${api}/${collection}/records/${id}`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).balances as Record<string, number>
}

test('summarizes 5e balances and keeps balance edits and coin transfers on demand', async ({ page }) => {
  await openInventory(page, five)
  await expect(page.locator('.coin-summary')).toContainText('12 GP')
  await expect(page.getByLabel('GP', { exact: true })).toHaveCount(0)
  await expect(page.locator('.coin-transfer')).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit balances' }).click()
  const gp = page.getByLabel('GP', { exact: true })
  await expect(gp).toHaveValue('12')
  await expect(page.locator('.currency-edit')).toContainText(/Direct entry/)
  await gp.fill('15')
  await page.getByLabel('SP', { exact: true }).fill('2')
  let balanceWrites = 0
  await page.route('**/api/olea/records/inventories/**', async (route) => {
    if (route.request().method() !== 'POST' || !route.request().url().endsWith('/update')) {
      await route.continue()
      return
    }
    balanceWrites++
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.continue()
  })
  const save = page.getByRole('button', { name: 'Save balances' })
  await save.evaluate((element) => { const button = element as HTMLButtonElement; button.click(); button.click() })
  await expect(page.locator('.coin-summary')).toContainText('15 GP')
  await expect(page.locator('.coin-summary')).toContainText('2 SP')
  await expect(page.getByLabel('GP', { exact: true })).toHaveCount(0)
  expect(balanceWrites).toBe(1)
  await page.unroute('**/api/olea/records/inventories/**')
  expect(await balances(page, 'inventories', five.inventoryId)).toMatchObject({ gp: 15, sp: 2 })

  await page.getByRole('button', { name: 'Transfer coins' }).click()
  await page.getByLabel('Denomination').selectOption('gp')
  await page.getByLabel('Transfer amount').fill('4')
  await page.locator('#coin-transfer-target').selectOption({ label: `${five.stashName} (party)` })
  let transferWrites = 0
  await page.route('**/api/olea/transfers/coins', async (route) => {
    transferWrites++
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.continue()
  })
  const transfer = page.getByRole('button', { name: 'Transfer coins' })
  await transfer.evaluate((element) => { const button = element as HTMLButtonElement; button.click(); button.click() })
  await expect(page.locator('.coin-summary')).toContainText('11 GP')
  await expect(page.locator('.coin-transfer')).toHaveCount(0)
  expect(transferWrites).toBe(1)
  await page.unroute('**/api/olea/transfers/coins')
  expect(await balances(page, 'inventories', five.inventoryId)).toMatchObject({ gp: 11 })
  expect(await balances(page, 'stashes', five.stashId)).toMatchObject({ gp: 7 })

  await page.getByLabel('View contents').selectOption({ label: `${five.stashName} (party)` })
  await expect(page.locator('.coin-summary')).toContainText('7 GP')
  await expect(page.locator('.currency-panel')).toContainText('Party total (characters + party stash)')
})

test('keeps a dirty balance draft through another client’s transfer and resolves the stale edit explicitly', async ({ browser, page }) => {
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  try {
    await openInventory(page, five)
    await openInventory(secondPage, five)

    await page.getByRole('button', { name: 'Edit balances' }).click()
    const draft = page.getByLabel('GP', { exact: true })
    await draft.fill('20')

    await secondPage.getByRole('button', { name: 'Transfer coins' }).click()
    await secondPage.getByLabel('Denomination').selectOption('gp')
    await secondPage.getByLabel('Transfer amount').fill('2')
    await secondPage.locator('#coin-transfer-target').selectOption({ label: `${five.stashName} (party)` })
    await secondPage.getByRole('button', { name: 'Transfer coins' }).click()
    await expect(secondPage.locator('.coin-summary')).toContainText('9 GP')

    await expect(draft).toHaveValue('20')
    await expect(page.locator('.coin-summary')).toContainText('9 GP')
    await page.getByRole('button', { name: 'Save balances' }).click()
    const conflict = page.getByRole('alert').filter({ hasText: 'Balances changed elsewhere' })
    await expect(conflict).toContainText('Current saved balances: 2 SP · 9 GP')
    await expect(draft).toHaveValue('20')

    await page.getByRole('button', { name: 'Keep my draft' }).click()
    await page.getByRole('button', { name: 'Save balances' }).click()
    await expect(page.locator('.coin-summary')).toContainText('20 GP')
    expect(await balances(page, 'inventories', five.inventoryId)).toMatchObject({ gp: 20 })
    expect(await balances(page, 'stashes', five.stashId)).toMatchObject({ gp: 9 })
  } finally {
    await secondContext.close()
  }
})

test('reconciles an uncertain balance save after reconnect without replaying the write', async ({ page }) => {
  await openInventory(page, five)
  let writes = 0
  await page.route('**/api/olea/records/inventories/**', async (route) => {
    if (route.request().method() !== 'POST' || !route.request().url().endsWith('/update')) {
      await route.continue()
      return
    }
    writes++
    await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.abort('failed')
  })

  await page.getByRole('button', { name: 'Edit balances' }).click()
  const gp = page.getByLabel('GP', { exact: true })
  await gp.fill('30')
  await page.getByRole('button', { name: 'Save balances' }).click()
  await expect(page.locator('.currency-panel')).toContainText('Could not confirm whether the balances were saved')
  await expect(page.getByRole('button', { name: 'Save balances' })).toBeDisabled()
  await expect(gp).toHaveValue('30')
  expect(writes).toBe(1)

  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('status')).toContainText('Server unavailable')
  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('status')).toContainText('Local server ready')
  await expect(page.getByRole('button', { name: 'Save balances' })).toBeDisabled()
  expect(writes).toBe(1)

  await page.unroute('**/api/olea/records/inventories/**')
  await page.locator('.alert-message').getByRole('button', { name: 'Refresh inventory' }).click()
  await expect(page.getByLabel('GP', { exact: true })).toHaveCount(0)
  await expect(page.locator('.coin-summary')).toContainText('30 GP')
  await expect(page.getByText(/a delayed write may still arrive/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit balances' })).toBeEnabled()
  expect(writes).toBe(1)
  expect(await balances(page, 'inventories', five.inventoryId)).toMatchObject({ gp: 30 })
})

test('reconciles an uncertain coin transfer after reconnect without duplicating it', async ({ page }) => {
  await openInventory(page, five)
  let writes = 0
  await page.route('**/api/olea/transfers/coins', async (route) => {
    writes++
    await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.abort('failed')
  })

  await page.getByRole('button', { name: 'Transfer coins' }).click()
  await page.getByLabel('Denomination').selectOption('gp')
  await page.getByLabel('Transfer amount').fill('3')
  await page.locator('#coin-transfer-target').selectOption({ label: `${five.stashName} (party)` })
  await page.getByRole('button', { name: 'Transfer coins' }).click()
  await expect(page.locator('.currency-panel')).toContainText('Could not confirm whether the coins were transferred')
  await expect(page.locator('.coin-transfer button[type="submit"]')).toBeDisabled()
  expect(writes).toBe(1)

  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('status')).toContainText('Server unavailable')
  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('status')).toContainText('Local server ready')
  await expect(page.locator('.coin-transfer button[type="submit"]')).toBeDisabled()
  expect(writes).toBe(1)

  await page.unroute('**/api/olea/transfers/coins')
  await page.locator('.alert-message').getByRole('button', { name: 'Refresh inventory' }).click()
  await expect(page.locator('.coin-transfer')).toHaveCount(0)
  await expect(page.locator('.coin-summary')).toContainText('27 GP')
  await expect(page.getByRole('button', { name: 'Transfer coins' })).toBeEnabled()
  expect(writes).toBe(1)
  expect(await balances(page, 'inventories', five.inventoryId)).toMatchObject({ gp: 27 })
  expect(await balances(page, 'stashes', five.stashId)).toMatchObject({ gp: 12 })
})

test('keeps a dirty draft when a conflict refresh fails, blocks saving until review, then recovers for explicit keep or discard', async ({ browser, page }) => {
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  try {
    await openInventory(page, five)
    await openInventory(secondPage, five)
    await page.getByRole('button', { name: 'Edit balances' }).click()
    const draft = page.getByLabel('GP', { exact: true })
    await draft.fill('31')

    await secondPage.getByRole('button', { name: 'Edit balances' }).click()
    await secondPage.getByLabel('GP', { exact: true }).fill('25')
    await secondPage.getByRole('button', { name: 'Save balances' }).click()
    await expect(secondPage.locator('.coin-summary')).toContainText('25 GP')
    await expect(page.locator('.coin-summary')).toContainText('25 GP')
    await expect(draft).toHaveValue('31')

    await page.route(`**/api/collections/inventories/records/${five.inventoryId}**`, async (route) => {
      if (route.request().method() === 'GET') { await route.abort('failed'); return }
      await route.continue()
    })
    await page.getByRole('button', { name: 'Save balances' }).click()
    const conflict = page.locator('.inventory-conflict')
    await expect(conflict).toContainText('Current saved balances could not be loaded')
    await expect(page.getByRole('button', { name: 'Save balances' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Keep my draft' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Discard draft' })).toBeEnabled()
    await expect(draft).toHaveValue('31')
    await expect(page.locator('.alert-message')).toContainText('Your draft and guard are still here')

    await page.unroute(`**/api/collections/inventories/records/${five.inventoryId}**`)
    await page.locator('.alert-message').getByRole('button', { name: 'Refresh inventory' }).click()
    await expect(conflict).toContainText('Current saved balances: 2 SP · 25 GP')
    await expect(page.getByRole('button', { name: 'Save balances' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Keep my draft' })).toBeEnabled()
    await expect(draft).toHaveValue('31')

    await page.getByRole('button', { name: 'Keep my draft' }).click()
    await expect(page.getByRole('button', { name: 'Save balances' })).toBeEnabled()
    await page.getByRole('button', { name: 'Save balances' }).click()
    await expect(page.locator('.coin-summary')).toContainText('31 GP')
    expect(await balances(page, 'inventories', five.inventoryId)).toMatchObject({ gp: 31 })
  } finally {
    await secondContext.close()
  }
})

test('blocks store switching and cross-operation edits while a store write is pending', async ({ page }) => {
  await openInventory(page, five)
  const store = page.getByLabel('View contents')
  await expect(store).toBeEnabled()

  await page.getByRole('button', { name: 'Transfer coins' }).click()
  await expect(store).toBeDisabled()
  await page.getByLabel('Denomination').selectOption('gp')
  await page.getByLabel('Transfer amount').fill('2')
  await page.locator('#coin-transfer-target').selectOption({ label: `${five.stashName} (party)` })
  let releaseTransfer!: () => void
  const transferGate = new Promise<void>((resolve) => { releaseTransfer = resolve })
  await page.route('**/api/olea/transfers/coins', async (route) => {
    await transferGate
    await route.continue()
  })
  await page.locator('.coin-transfer button[type="submit"]').click()
  await expect(page.getByLabel('View contents')).toBeDisabled()
  await expect(page.locator('.coin-transfer button[type="submit"]')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Edit capacity' })).toBeDisabled()
  releaseTransfer()
  await expect(page.locator('.coin-summary')).toContainText('29 GP')
  await expect(page.getByLabel('View contents')).toBeEnabled()
  await page.unroute('**/api/olea/transfers/coins')

  await page.getByRole('button', { name: 'Edit balances' }).click()
  await page.getByLabel('GP', { exact: true }).fill('32')
  let releaseSave!: () => void
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
  await page.route('**/api/olea/records/inventories/**', async (route) => {
    if (route.request().method() !== 'POST' || !route.request().url().endsWith('/update')) { await route.continue(); return }
    await saveGate
    await route.continue()
  })
  await page.getByRole('button', { name: 'Save balances' }).click()
  await expect(page.getByLabel('View contents')).toBeDisabled()
  await expect(page.locator('.currency-edit button[type="submit"]')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Edit capacity' })).toBeDisabled()
  releaseSave()
  await expect(page.locator('.coin-summary')).toContainText('32 GP')
  await expect(page.getByLabel('View contents')).toBeEnabled()
  await page.unroute('**/api/olea/records/inventories/**')
})

test('edits capacity directly, shows over/within state, and can clear an unknown capacity', async ({ page }) => {
  await openInventory(page, five)
  const weight = page.locator('.weight-summary')
  await expect(weight).toContainText('Over capacity')
  await expect(page.getByLabel('Capacity (lb.)')).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit capacity' }).click()
  const capacity = page.getByLabel('Capacity (lb.)')
  await expect(capacity).toHaveValue('10')
  await expect(capacity).toHaveAttribute('type', 'number')
  await capacity.fill('30')
  await page.getByRole('button', { name: 'Save capacity' }).click()
  await expect(weight).toContainText('Capacity: 30 lb.')
  await expect(weight).toContainText('Within capacity')
  let saved = await (await page.request.get(`${api}/inventories/records/${five.inventoryId}`)).json()
  expect(saved.capacity).toBe(30)
  expect(saved.capacity_known).toBe(true)

  await page.getByRole('button', { name: 'Edit capacity' }).click()
  await page.getByLabel('Capacity (lb.)').fill('')
  await page.getByRole('button', { name: 'Save capacity' }).click()
  await expect(weight).toContainText('Capacity not set.')
  saved = await (await page.request.get(`${api}/inventories/records/${five.inventoryId}`)).json()
  expect(saved.capacity_known).toBe(false)

  const setKnown = await page.request.post(`${records}/inventories/${five.inventoryId}/update`, {
    data: { expected: { capacity: 0, capacity_known: false }, fields: { capacity: 10, capacity_known: true } },
  })
  expect(setKnown.ok(), await setKnown.text()).toBeTruthy()
  await openInventory(page, five)
  await expect(weight).toContainText('Capacity: 10 lb.')
  await page.getByRole('button', { name: 'Edit capacity' }).click()
  const draft = page.getByLabel('Capacity (lb.)')
  await draft.fill('40')
  const secondWrite = await page.request.post(`${records}/inventories/${five.inventoryId}/update`, {
    data: { expected: { capacity: 10, capacity_known: true }, fields: { capacity: 15, capacity_known: true } },
  })
  expect(secondWrite.ok(), await secondWrite.text()).toBeTruthy()
  await expect(draft).toHaveValue('40')
  await page.getByRole('button', { name: 'Save capacity' }).click()
  const conflict = page.locator('.inventory-conflict')
  await expect(conflict).toContainText('Current saved capacity: 15 lb.')
  await expect(page.getByRole('button', { name: 'Save capacity' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await expect(draft).toHaveValue('40')
  await page.getByRole('button', { name: 'Keep my draft' }).click()
  await page.getByRole('button', { name: 'Save capacity' }).click()
  await expect(weight).toContainText('Capacity: 40 lb.')
  saved = await (await page.request.get(`${api}/inventories/records/${five.inventoryId}`)).json()
  expect(saved.capacity).toBe(40)
})

test('keeps unsupported balances visible without conversion for AD&D and unknown systems', async ({ page }) => {
  await openInventory(page, adnd)
  let panel = page.locator('.currency-panel')
  await expect(panel).toContainText('Currency rules are not configured for this system.')
  await expect(panel).toContainText('Unknown for this system; retained balances are not converted.')
  await expect(page.locator('.unsupported-balances')).toContainText('Retained unsupported balances: 4 gp')
  await expect(page.getByRole('button', { name: 'Edit balances' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Transfer coins' })).toHaveCount(0)
  expect((await (await page.request.get(`${api}/inventories/records/${adnd.inventoryId}`)).json()).balances).toMatchObject({ gp: 4 })

  await page.route(`**/api/collections/games/records/${unknown.gameId}**`, async (route) => {
    const response = await route.fetch()
    const game = await response.json()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...game, system: 'e2e-unknown-system', expand: { system: { id: 'e2e-unknown-system', key: 'e2e-unknown-system' } } }) })
  })
  await openInventory(page, unknown)
  panel = page.locator('.currency-panel')
  await expect(panel).toContainText('Currency rules are not configured for this system.')
  await expect(panel).toContainText('Unknown for this system; retained balances are not converted.')
  await expect(page.locator('.unsupported-balances')).toContainText('Retained unsupported balances: 9 gp')
  await expect(page.getByRole('button', { name: 'Edit balances' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Transfer coins' })).toHaveCount(0)
  expect((await (await page.request.get(`${api}/inventories/records/${unknown.inventoryId}`)).json()).balances).toMatchObject({ gp: 9 })
})

test('keeps the on-demand currency controls usable on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch coverage runs in the mobile Chromium project.')
  await page.setViewportSize({ width: 320, height: 800 })
  await openInventory(page, five)
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)

  const edit = page.getByRole('button', { name: 'Edit balances' })
  const editBox = await edit.boundingBox()
  expect(editBox).not.toBeNull()
  expect(editBox!.width).toBeGreaterThanOrEqual(44)
  expect(editBox!.height).toBeGreaterThanOrEqual(44)
  await edit.tap()
  const gp = page.getByLabel('GP', { exact: true })
  const gpBox = await gp.boundingBox()
  expect(gpBox).not.toBeNull()
  expect(gpBox!.width).toBeGreaterThanOrEqual(44)
  expect(gpBox!.height).toBeGreaterThanOrEqual(42)
  await page.getByRole('button', { name: 'Cancel' }).tap()

  const transfer = page.getByRole('button', { name: 'Transfer coins' })
  const transferBox = await transfer.boundingBox()
  expect(transferBox).not.toBeNull()
  expect(transferBox!.width).toBeGreaterThanOrEqual(44)
  expect(transferBox!.height).toBeGreaterThanOrEqual(44)
  await transfer.tap()
  await expect(page.getByLabel('Transfer amount')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).tap()
})
