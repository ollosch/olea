// Exploratory measurements, not assertions that today's layout is desirable.
// Runs only against the disposable server configured in playwright.config.ts.
import { expect, test, e2eApiBase } from './fixtures'
import type { Page } from '@playwright/test'

test('measure synthetic usability journeys', async ({ page, request, ids, isMobile }) => {
  test.setTimeout(30_000)
  page.setDefaultTimeout(8_000)
  if (!isMobile) await page.setViewportSize({ width: 1920, height: 1080 })
  const api = `${e2eApiBase}/api/collections`
  const catalogIds: string[] = []
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const prefix = `Baseline ${key}`
  let creatureId = ''
  const create = async (collection: string, data: Record<string, unknown>) => {
    const response = await request.post(`${api}/${collection}/records`, { data })
    expect(response.ok(), `${collection}: ${await response.text()}`).toBeTruthy()
    return await response.json() as { id: string }
  }
  const measure = async (label: string, target?: string) => {
    const result = await page.evaluate((selector) => {
      const el = selector ? document.querySelector(selector) : null
      const rect = el?.getBoundingClientRect()
      const active = document.activeElement as HTMLElement | null
      return {
        viewport: [innerWidth, innerHeight], scrollY: Math.round(scrollY),
        height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
        focus: active?.id || active?.tagName, targetTop: rect ? Math.round(rect.top) : null,
        targetHeight: rect ? Math.round(rect.height) : null,
      }
    }, target)
    console.log(`${isMobile ? 'phone' : 'desktop'} ${label}: ${JSON.stringify(result)}`)
  }
  const pickerMetrics = (p: Page) => p.locator('.picker-results').evaluate((el) => ({
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop,
  }))

  try {
    const systems = await request.get(`${api}/systems/records?filter=(key='dnd5e')`)
    const system = (await systems.json()).items[0].id as string
    for (let i = 1; i <= 42; i++) {
      const num = String(i).padStart(2, '0')
      const spell = await create('catalog', { system, type: 'spell', source: 'SYNTHETIC', source_id: `${key}-spell-${num}`, name: `${prefix} Spell ${num}`, level: '1', school: 'Evocation', original_json: { entries: [`Invented spell ${num}. ${'Table text for testing. '.repeat(30)}`] } })
      catalogIds.push(spell.id)
      if (i <= 20) await create('spellbook_spells', { spellbook: ids.spellbookId, spell: spell.id })
      const item = await create('catalog', { system, type: 'item', source: 'SYNTHETIC', source_id: `${key}-item-${num}`, name: `${prefix} Item ${num}`, item_type: 'P', original_json: { entries: ['Invented item.'] } })
      catalogIds.push(item.id)
    }
    const creature = await create('catalog', { system, type: 'creature', source: 'SYNTHETIC', source_id: `${key}-creature`, name: `${prefix} Creature`, creature_type: 'beast', challenge_rating: '1', original_json: { entries: ['Invented creature.'] } })
    creatureId = creature.id
    catalogIds.push(creature.id)
    let lastCombatantId = ''
    for (let i = 1; i <= 14; i++) {
      const combatant = await create('combatants', { combat: ids.combatId, name: `Baseline Participant ${String(i).padStart(2, '0')}`, enemy: true, sort_order: i, initiative: 12 - i, initiative_known: true, current_hp: 10, max_hp: 10, hp_known: true })
      lastCombatantId = combatant.id
    }
    const pouch = await create('inventory_items', { inventory: ids.inventoryId, container: ids.containerId, name: 'Baseline Pouch', quantity: 1, is_container: true })
    await create('inventory_items', { inventory: ids.inventoryId, container: pouch.id, name: 'Baseline Token', quantity: 2, is_container: false })

    // Explicit preference avoids dependence on the order of seeded systems.
    await page.goto('/games')
    await page.evaluate(() => localStorage.setItem('olea.catalogSystem', 'dnd5e'))
    await page.route('**/api/collections/catalog/records?*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.continue()
    })
    await page.goto('/catalog')
    await expect(page.getByText('Loading catalog…')).toBeVisible()
    await measure('catalog loading', '#catalog-search')
    await expect(page.locator('.catalog-row')).toHaveCount(30)
    await measure('catalog loaded', '#catalog-search')
    await page.unroute('**/api/collections/catalog/records?*')

    await page.getByLabel('Search by name').fill(`${prefix} Spell`)
    await expect(page.getByText('42 entries')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await measure('catalog before shortening', '#catalog-search')
    // Fill while scrolled: keyboard input on the still-focused search, no scrollIntoView.
    await page.keyboard.press('Control+A')
    await page.keyboard.type(`${prefix} Spell 01`)
    await expect(page.getByText('1 entry', { exact: true })).toBeVisible()
    await measure('catalog shortened', '#catalog-search')
    await page.locator('.catalog-row').click()
    await expect(page.getByRole('heading', { name: `${prefix} Spell 01` })).toBeVisible()
    await page.goBack()
    // Step 4 restores the catalog URL and scroll/focus for this history entry.
    await expect(page.locator('.catalog-row')).toHaveCount(1)
    await expect(page.getByLabel('Search by name')).toHaveValue(`${prefix} Spell 01`)
    await measure('browser back restored', '#catalog-search')
    console.log(`browser back query: ${JSON.stringify(await page.getByLabel('Search by name').inputValue())}`)
    await page.getByLabel('Search by name').fill(`${prefix} Spell 01`)
    await page.locator('.catalog-row').click()
    await page.getByRole('link', { name: '← Back to catalog' }).click()
    await expect(page.locator('.catalog-row')).toHaveCount(1)
    await expect(page.getByLabel('Search by name')).toHaveValue(`${prefix} Spell 01`)
    await measure('explicit back restored', '#catalog-search')
    console.log(`explicit back query: ${JSON.stringify(await page.getByLabel('Search by name').inputValue())}`)

    await expect(page.getByText('Loading catalog…')).toHaveCount(0)
    const disclosures = page.locator('.catalog-filter-disclosure')
    if (!(await disclosures.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await disclosures.locator('summary').click()
    }
    await expect(page.locator('.catalog-filters select').nth(1).locator('option[value="1"]')).toHaveCount(1)
    await page.getByLabel('Search by name').fill(`${prefix} Spell`)
    await page.locator('.catalog-filters select').nth(1).selectOption('1')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByText('Page 2 of 2')).toBeVisible()
    await page.locator('.catalog-row').last().scrollIntoViewIfNeeded()
    await measure('catalog page 2 before detail', '.catalog-row:last-child')
    await page.locator('.catalog-row').last().click()
    await page.goBack()
    await expect(page.locator('.catalog-row')).toHaveCount(12)
    await expect(page.locator('.catalog-pagination')).toContainText('Page 2 of 2')
    await measure('browser back from page 2 restored', '#catalog-search')
    console.log(`page 2 back state: ${JSON.stringify({ query: await page.getByLabel('Search by name').inputValue(), level: await page.locator('.catalog-filters select').nth(1).inputValue(), pagination: await page.locator('.catalog-pagination').innerText() })}`)

    await page.goto(`/characters/${ids.characterId}/inventory`)
    await expect(page.locator('.inventory-row').filter({ hasText: 'Baseline Token' })).toBeVisible()
    await measure('inventory loaded', '.inventory-list')
    console.log(`inventory order: ${JSON.stringify(await page.locator('.inventory-row strong').allTextContents())}`)
    await page.getByRole('button', { name: '＋ Add catalog item' }).click()
    await page.getByLabel('Search items').fill(`${prefix} Item`)
    await expect(page.locator('.picker-result')).toHaveCount(42)
    await page.locator('.picker-results').evaluate((el) => { el.scrollTop = el.scrollHeight })
    console.log(`item picker scrolled: ${JSON.stringify(await pickerMetrics(page))}`)
    await page.getByLabel('Search items').fill(`${prefix} Item 01`)
    await expect(page.locator('.picker-result')).toHaveCount(1)
    console.log(`item picker filtered: ${JSON.stringify(await pickerMetrics(page))}`)
    await measure('item picker filtered', '#item-search')
    await page.locator('.picker-result').click()
    await expect(page.locator('.inventory-row').filter({ hasText: `${prefix} Item 01` })).toBeVisible()
    await measure('item selected', '.inventory-list')

    await page.goto(`/characters/${ids.characterId}/spellbooks`)
    await expect(page.locator('.spell-entry')).toHaveCount(22)
    await measure('long spellbook', '.spell-list')
    await page.getByRole('button', { name: '＋ Add spell' }).click()
    await page.getByLabel('Search spells').fill(`${prefix} Spell 21`)
    await expect(page.locator('.picker-result')).toHaveCount(1)
    await measure('spell picker', '#item-search')
    await page.locator('.picker-result').click()
    await expect(page.locator('.spell-entry')).toHaveCount(23)
    await measure('spell selected', '.spell-list')

    await page.goto(`/games/${ids.gameId}/encounters?encounter=${ids.encounterId}`)
    await expect(page.locator('.combatant-card')).toHaveCount(15)
    await measure('combat loaded', '.combatant-list')
    console.log(`combat first card height: ${Math.round((await page.locator('.combatant-card').first().boundingBox())!.height)}`)
    const last = page.locator('.combatant-card').last()
    await last.scrollIntoViewIfNeeded()
    await measure('combat last participant', '.combatant-list')
    await last.getByLabel('Current HP').fill('6')
    await last.getByLabel('Conditions').fill('Prone')
    await last.getByRole('button', { name: 'Save' }).click()
    await expect(last.getByLabel('Current HP')).toHaveValue('6')
    await measure('combat saved', '.combatant-list')
    await page.getByRole('button', { name: '＋ Add catalog creature' }).click()
    await page.getByLabel('Search creatures').fill(`${prefix} Creature`)
    await expect(page.locator('.picker-result')).toHaveCount(1)
    await measure('creature picker', '#item-search')
    await page.locator('.picker-result').first().click()
    await expect(page.locator('.encounter-entry-list .inventory-row')).toHaveCount(3)
    await measure('creature selected', '.encounter-entry-list')

    await page.goto(`/games/${ids.gameId}/encounter`)
    await expect(page.locator('.combatant-card')).toHaveCount(15)
    // The cards render before the asynchronous realtime subscription is installed.
    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await measure('player before update', '.combatant-list')
    // Hold refresh long enough to make the loading geometry observable.
    await page.route(`**/api/collections/games/records/${ids.gameId}**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.continue()
    })
    const updated = await request.post(`${e2eApiBase}/api/olea/records/combatants/${lastCombatantId}/update`, { data: { expected: { current_hp: 6 }, fields: { current_hp: 5 } } })
    expect(updated.ok(), await updated.text()).toBeTruthy()
    await expect(page.getByText('Loading active encounter…')).toBeVisible()
    await measure('player loading on live update', '.combatant-list')
    await expect(page.locator('.combatant-card')).toHaveCount(15)
    await expect(page.getByText('HP 5/10')).toBeVisible()
    await measure('player after live update', '.combatant-list')
    await page.unrouteAll({ behavior: 'wait' })
  } finally {
    // Drop references before deleting catalog records; the shared fixture owns the game.
    const book = await request.delete(`${api}/spellbooks/records/${ids.spellbookId}`)
    expect(book.ok(), 'baseline spellbook cleanup').toBeTruthy()
    const items = await request.get(`${api}/inventory_items/records?filter=${encodeURIComponent(`inventory='${ids.inventoryId}'`)}`)
    for (const item of (await items.json()).items as Array<{ id: string; catalog_item: string }>) {
      if (catalogIds.includes(item.catalog_item)) {
        const removed = await request.delete(`${api}/inventory_items/records/${item.id}`)
        expect(removed.ok(), 'baseline inventory item cleanup').toBeTruthy()
      }
    }
    if (creatureId) {
      const entries = await request.get(`${api}/encounter_creatures/records?filter=${encodeURIComponent(`encounter='${ids.encounterId}' && creature='${creatureId}'`)}`)
      for (const entry of (await entries.json()).items as Array<{ id: string }>) {
        const removed = await request.delete(`${api}/encounter_creatures/records/${entry.id}`)
        expect(removed.ok(), 'baseline encounter entry cleanup').toBeTruthy()
      }
    }
    for (const id of catalogIds) {
      const response = await request.delete(`${api}/catalog/records/${id}`)
      expect(response.ok(), `catalog cleanup ${id}`).toBeTruthy()
    }
  }
})
