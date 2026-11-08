import { e2eApiBase, expect, test } from './fixtures'
import type { Page } from '@playwright/test'

const api = `${e2eApiBase}/api/collections`
const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const prefix = `Inventory ${key}`
let gameId = ''
let characterId = ''
let inventoryId = ''
let stashId = ''
const itemIds: Record<string, string> = {}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  const systems = await request.get(`${api}/systems/records?filter=${encodeURIComponent("(key='dnd5e')")}`)
  expect(systems.ok(), await systems.text()).toBeTruthy()
  const systemId = (await systems.json()).items[0].id as string
  const create = async (collection: string, data: Record<string, unknown>) => {
    const response = await request.post(`${api}/${collection}/records`, { data })
    expect(response.ok(), `${collection} fixture: ${await response.text()}`).toBeTruthy()
    return (await response.json()).id as string
  }

  gameId = await create('games', { name: `${prefix} Game`, system: systemId })
  characterId = await create('characters', { game: gameId, name: `${prefix} Ranger` })
  inventoryId = await create('inventories', { game: gameId, character: characterId })
  stashId = await create('stashes', { game: gameId, kind: 'party', name: 'E2E Party Stash' })

  const item = async (name: string, fields: Record<string, unknown>) => {
    const id = await create('inventory_items', {
      inventory: inventoryId,
      name,
      quantity: 1,
      weight: 1,
      weight_known: true,
      is_container: false,
      ...fields,
    })
    itemIds[name] = id
    return id
  }

  const backpack = await item('E2E Backpack', { is_container: true })
  const pouch = await item('E2E Pouch', { container: backpack, is_container: true, weight: 0.5 })
  await item('E2E Ration', { container: pouch, quantity: 2, weight: 0.5, notes: 'Salted and wrapped.' })
  await item('E2E Arrows', { quantity: 5, weight: 0.1 })
  await item('E2E Bundle', { quantity: 4, weight: 0.2 })
  await item('E2E Single Torch', { weight: 1 })
  await item('E2E Relic', { weight: 0, weight_known: false, notes: 'Its weight cannot be read.' })
  const crate = await item('E2E Crate', { is_container: true, weight: 2 })
  await item('E2E Gem', { container: crate, quantity: 3, weight: 0.1 })
  await item('E2E Ledger', { quantity: 3, weight: 0.2 })
  await item('E2E Compass', { quantity: 2, weight: 0.1 })
  await item('E2E Spool', { quantity: 2, weight: 0.1 })
  await item('E2E Dispatch Bundle', { quantity: 4, weight: 0.2 })
  await item('E2E Waylaid Parcel', { quantity: 4, weight: 0.2 })
})

test.afterAll(async ({ request }) => {
  if (!gameId) return
  const response = await request.delete(`${api}/games/records/${gameId}`)
  expect(response.ok(), `inventory fixture cleanup: ${await response.text()}`).toBeTruthy()
})

async function openInventory(page: Page) {
  await page.goto(`/characters/${characterId}/inventory`)
  await expect(page.getByRole('heading', { name: `${prefix} Ranger’s items` })).toBeVisible()
}

function itemRow(page: Page, name: string) {
  return page.locator(`.inventory-row[data-item-id="${itemIds[name]}"]`)
}

test('shows nested containers with locations, collapses, searches and surfaces unknown weight', async ({ page }) => {
  await openInventory(page)

  await expect(itemRow(page, 'E2E Backpack')).toContainText('Container · 1 item')
  await expect(itemRow(page, 'E2E Pouch')).toContainText('Inside E2E Backpack')
  await expect(itemRow(page, 'E2E Ration')).toContainText('Inside E2E Backpack › E2E Pouch')
  await expect(page.locator('.inventory-row')).toHaveCount(14)

  await page.getByRole('button', { name: 'Collapse E2E Backpack' }).click()
  await expect(itemRow(page, 'E2E Backpack')).toBeVisible()
  await expect(itemRow(page, 'E2E Pouch')).toHaveCount(0)
  await expect(itemRow(page, 'E2E Ration')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand E2E Backpack' }).click()
  await expect(itemRow(page, 'E2E Ration')).toBeVisible()

  const search = page.getByLabel('Search inventory items')
  await search.fill('ration')
  await expect(page.locator('.inventory-row')).toHaveCount(3)
  await expect(itemRow(page, 'E2E Backpack')).toBeVisible()
  await expect(itemRow(page, 'E2E Pouch')).toBeVisible()
  await expect(itemRow(page, 'E2E Ration')).toBeVisible()
  await expect(itemRow(page, 'E2E Arrows')).toHaveCount(0)
  await expect(page.getByText(/1 of 14 items match/)).toBeVisible()

  await search.fill('pouch')
  await expect(page.locator('.inventory-row')).toHaveCount(3)
  await expect(itemRow(page, 'E2E Ration')).toBeVisible()

  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.locator('.inventory-row')).toHaveCount(14)
  await expect(itemRow(page, 'E2E Relic')).toContainText('Weight unknown')
  await expect(page.getByText('Unknown — an item or coin weight is unknown')).toBeVisible()

  const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport)
})

test('steps ordinary stacks, keeps direct entry and enforces container and minimum constraints', async ({ page }) => {
  await openInventory(page)
  const arrows = itemRow(page, 'E2E Arrows')
  const quantity = arrows.getByRole('group', { name: 'Quantity for E2E Arrows' })

  await quantity.getByRole('button', { name: 'Increase E2E Arrows quantity' }).click()
  await expect(arrows).toContainText('× 6')
  await quantity.getByRole('button', { name: 'Decrease E2E Arrows quantity' }).click()
  await expect(arrows).toContainText('× 5')

  await arrows.getByRole('button', { name: 'Edit' }).click()
  await arrows.getByLabel('Quantity').fill('7')
  await arrows.getByRole('button', { name: 'Save' }).click()
  await expect(arrows).toContainText('× 7')

  const torch = itemRow(page, 'E2E Single Torch')
  await expect(torch.getByRole('button', { name: 'Decrease E2E Single Torch quantity' })).toBeDisabled()
  await expect(itemRow(page, 'E2E Backpack').getByRole('group', { name: 'Quantity for E2E Backpack' })).toHaveCount(0)

  const backpack = itemRow(page, 'E2E Backpack')
  await backpack.getByRole('button', { name: 'Edit' }).click()
  await backpack.getByLabel('Quantity').fill('2')
  await backpack.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('alert')).toContainText('Containers and items holding contents must have quantity one')
  await backpack.getByRole('button', { name: 'Cancel' }).click()

  const saved = await page.request.get(`${api}/inventory_items/records/${itemIds['E2E Arrows']}`)
  expect((await saved.json()).quantity).toBe(7)
})

test('moves split quantities and whole containers with their descendants, and blocks dropping contents', async ({ page }) => {
  await openInventory(page)
  const bundle = itemRow(page, 'E2E Bundle')
  await bundle.getByRole('button', { name: 'Move' }).click()
  await bundle.getByLabel('Quantity').fill('2')
  await bundle.getByLabel('Move to').selectOption({ label: 'E2E Party Stash (party)' })
  await bundle.getByRole('button', { name: 'Move item' }).click()
  await expect(bundle).toContainText('× 2')

  const crate = itemRow(page, 'E2E Crate')
  await crate.getByRole('button', { name: 'Drop' }).click()
  await expect(page.getByRole('alert')).toContainText('Move the contents out before dropping this container')
  await crate.getByRole('button', { name: 'Move' }).click()
  await crate.getByRole('button', { name: 'Move item' }).click()
  await expect(crate).toHaveCount(0)

  for (const name of ['E2E Crate', 'E2E Gem']) {
    const record = await (await page.request.get(`${api}/inventory_items/records/${itemIds[name]}`)).json()
    expect(record.stash, `${name} should move with its container`).toBe(stashId)
    expect(record.inventory).toBe('')
  }

  await page.getByLabel('View contents').selectOption({ label: 'E2E Party Stash (party)' })
  await expect(page.getByRole('heading', { name: 'E2E Party Stash', exact: true })).toBeVisible()
  await expect(page.locator('.inventory-row').filter({ hasText: 'E2E Bundle' })).toContainText('× 2')
  await expect(itemRow(page, 'E2E Crate')).toBeVisible()
  await expect(itemRow(page, 'E2E Gem')).toContainText('Inside E2E Crate')

  const gem = await (await page.request.get(`${api}/inventory_items/records/${itemIds['E2E Gem']}`)).json()
  expect(gem.container).toBe(itemIds['E2E Crate'])
  expect(gem.quantity).toBe(3)
})

test('retains a stale second-client edit draft through live refreshes and rebases it explicitly', async ({ browser, page }) => {
  await openInventory(page)
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  const torchId = itemIds['E2E Single Torch']
  try {
    await openInventory(secondPage)
    const first = itemRow(page, 'E2E Ledger')
    const second = itemRow(secondPage, 'E2E Ledger')
    await first.getByRole('button', { name: 'Edit' }).click()
    await second.getByRole('button', { name: 'Edit' }).click()
    await second.getByLabel('Quantity').fill('9')
    await second.getByLabel('Item notes').fill('Draft survives a live refresh.')

    await first.getByLabel('Quantity').fill('6')
    await first.getByRole('button', { name: 'Save' }).click()
    await expect(second.getByLabel('Quantity')).toHaveValue('9')
    await expect(second.getByLabel('Item notes')).toHaveValue('Draft survives a live refresh.')

    await page.request.patch(`${api}/inventory_items/records/${torchId}`, { data: { quantity: 2 } })
    await expect(itemRow(secondPage, 'E2E Single Torch')).toContainText('× 2')
    await expect(second.getByLabel('Quantity')).toHaveValue('9')
    await expect(second.getByLabel('Item notes')).toHaveValue('Draft survives a live refresh.')

    await second.getByRole('button', { name: 'Save' }).click()
    const conflict = secondPage.getByRole('alert')
    await expect(conflict).toContainText('This item changed or moved elsewhere')
    await expect(conflict).toContainText('Quantity 6')
    await expect(second.getByLabel('Quantity')).toHaveValue('9')
    await expect(second.getByRole('button', { name: 'Discard draft' })).toBeVisible()

    await second.getByRole('button', { name: 'Keep my draft' }).click()
    await second.getByRole('button', { name: 'Save' }).click()
    await expect(second).toContainText('× 9')
    await expect(second).toContainText('Draft survives a live refresh.')

    const saved = await (await page.request.get(`${api}/inventory_items/records/${itemIds['E2E Ledger']}`)).json()
    expect(saved.quantity).toBe(9)
    expect(saved.notes).toBe('Draft survives a live refresh.')
  } finally {
    await secondContext.close()
  }
})

test('adds a custom item, edits its unknown weight and drops it', async ({ page }) => {
  await openInventory(page)
  await page.getByRole('button', { name: 'Custom item' }).click()
  await page.getByLabel('Name').fill('E2E Field Journal')
  await page.getByLabel('Weight per item (optional)').fill('0.5')
  await page.getByLabel('Notes').fill('Found in the rain.')
  await page.getByRole('button', { name: 'Add item' }).click()

  const journal = page.locator('.inventory-row').filter({ hasText: 'E2E Field Journal' })
  await expect(journal).toBeVisible()
  await expect(journal).toContainText('0.5 lb. each')

  await journal.getByRole('button', { name: 'Edit' }).click()
  await journal.getByLabel('Weight per item (lb.)').fill('')
  await journal.getByLabel('Item notes').fill('Found in the rain. Dried by the fire.')
  await journal.getByRole('button', { name: 'Save' }).click()
  await expect(journal).toContainText('Weight unknown')
  await expect(journal).toContainText('Dried by the fire.')

  await journal.getByRole('button', { name: 'Drop' }).click()
  await expect(journal).toHaveCount(0)
})

test('keeps a lost quantity write locked through live refreshes and blocks edit or move until explicit reconciliation', async ({ page }) => {
  await openInventory(page)
  const compass = itemRow(page, 'E2E Compass')
  const torchId = itemIds['E2E Single Torch']
  let writes = 0
  await page.route('**/api/olea/records/inventory_items/**', async (route) => {
    if (route.request().method() !== 'POST' || !route.request().url().endsWith('/update')) {
      await route.continue()
      return
    }
    writes++
    await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.abort('failed')
  })

  await compass.getByRole('button', { name: 'Increase E2E Compass quantity' }).click()
  await expect(compass.getByRole('alert')).toContainText('Could not confirm whether E2E Compass’s quantity changed')
  await expect(compass.getByRole('button', { name: 'Increase E2E Compass quantity' })).toBeDisabled()

  await page.request.patch(`${api}/inventory_items/records/${torchId}`, { data: { quantity: 3 } })
  await expect(itemRow(page, 'E2E Single Torch')).toContainText('× 3')
  await expect(compass.getByRole('button', { name: 'Increase E2E Compass quantity' })).toBeDisabled()
  await expect(compass.getByRole('button', { name: 'Edit' })).toBeDisabled()
  await expect(compass.getByRole('button', { name: 'Move' })).toBeDisabled()
  await expect(compass.getByRole('button', { name: 'Drop' })).toBeDisabled()

  await compass.getByRole('button', { name: 'Edit' }).click({ force: true }).catch(() => undefined)
  await expect(compass.getByRole('button', { name: 'Save' })).toHaveCount(0)
  await compass.getByRole('button', { name: 'Move' }).click({ force: true }).catch(() => undefined)
  await expect(compass.getByRole('button', { name: 'Move item' })).toHaveCount(0)
  expect(writes).toBe(1)

  await page.unroute('**/api/olea/records/inventory_items/**')
  const refresh = page.locator('.alert-message').getByRole('button', { name: 'Refresh inventory' })
  await expect(refresh).toBeVisible()
  await refresh.click()
  await expect(compass).toContainText('× 3')
  await expect(compass.getByRole('button', { name: 'Increase E2E Compass quantity' })).toBeEnabled()
  await expect(compass.getByRole('button', { name: 'Edit' })).toBeEnabled()
  await expect(page.getByText(/a delayed write may still arrive/)).toBeVisible()
  expect(writes).toBe(1)

  const record = await (await page.request.get(`${api}/inventory_items/records/${itemIds['E2E Compass']}`)).json()
  expect(record.quantity).toBe(3)
})

test('guards double transfers and reconciles a committed transfer whose response was lost', async ({ page }) => {
  await openInventory(page)
  const stashItems = async (name: string) => {
    const response = await page.request.get(`${api}/inventory_items/records?filter=${encodeURIComponent(`stash='${stashId}' && name='${name}'`)}&perPage=50`)
    expect(response.ok(), await response.text()).toBeTruthy()
    return (await response.json()).items as Array<{ id: string; quantity: number }>
  }

  const dispatch = itemRow(page, 'E2E Dispatch Bundle')
  await dispatch.getByRole('button', { name: 'Move' }).click()
  await dispatch.getByLabel('Quantity').fill('1')
  await dispatch.getByLabel('Move to').selectOption({ label: 'E2E Party Stash (party)' })
  let transferWrites = 0
  await page.route('**/api/olea/transfers/item', async (route) => {
    transferWrites++
    await new Promise((resolve) => setTimeout(resolve, 300))
    await route.continue()
  })
  const move = dispatch.getByRole('button', { name: 'Move item' })
  await move.evaluate((element) => { const button = element as HTMLButtonElement; button.click(); button.click() })
  await expect(dispatch).toContainText('× 3')
  expect(transferWrites).toBe(1)
  await page.unroute('**/api/olea/transfers/item')
  expect(await stashItems('E2E Dispatch Bundle')).toHaveLength(1)

  const torchId = itemIds['E2E Single Torch']
  const parcel = itemRow(page, 'E2E Waylaid Parcel')
  await parcel.getByRole('button', { name: 'Move' }).click()
  await parcel.getByLabel('Quantity').fill('2')
  await parcel.getByLabel('Move to').selectOption({ label: 'E2E Party Stash (party)' })
  let lostWrites = 0
  await page.route('**/api/olea/transfers/item', async (route) => {
    lostWrites++
    await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.abort('failed')
  })
  await parcel.getByRole('button', { name: 'Move item' }).click()
  await expect(parcel.getByRole('alert')).toContainText('Could not confirm whether E2E Waylaid Parcel was moved')
  await expect(parcel.getByRole('button', { name: 'Move' })).toBeDisabled()

  await page.request.patch(`${api}/inventory_items/records/${torchId}`, { data: { quantity: 4 } })
  await expect(itemRow(page, 'E2E Single Torch')).toContainText('× 4')
  await expect(parcel.getByRole('button', { name: 'Move' })).toBeDisabled()
  expect(lostWrites).toBe(1)

  await page.unroute('**/api/olea/transfers/item')
  await page.locator('.alert-message').getByRole('button', { name: 'Refresh inventory' }).click()
  await expect(parcel).toContainText('× 2')
  await expect(parcel.getByRole('button', { name: 'Move' })).toBeEnabled()
  await expect(page.getByText(/a delayed write may still arrive/)).toBeVisible()
  expect(lostWrites).toBe(1)
  const parcels = await stashItems('E2E Waylaid Parcel')
  expect(parcels).toHaveLength(1)
  expect(parcels[0].quantity).toBe(2)
})

test('keeps hierarchy search and touch quantity controls usable on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch coverage runs in the mobile Chromium project.')
  await page.setViewportSize({ width: 320, height: 800 })
  await openInventory(page)

  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)

  const spool = itemRow(page, 'E2E Spool')
  const increase = spool.getByRole('button', { name: 'Increase E2E Spool quantity' })
  const box = await increase.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await increase.tap()
  await expect(spool).toContainText('× 3')

  await page.getByLabel('Search inventory items').fill('E2E Ration')
  await expect(itemRow(page, 'E2E Ration')).toBeVisible()
  await expect(spool).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear search' }).tap()
  await page.getByRole('button', { name: 'Collapse E2E Backpack' }).tap()
  await expect(itemRow(page, 'E2E Pouch')).toHaveCount(0)
})
