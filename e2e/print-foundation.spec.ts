import { expect, test } from '@playwright/test'

test('print calibration preview shows four positions, duplex pages, and overflow warnings', async ({ page }) => {
  await page.goto('/print/calibration')
  await expect(page.getByRole('heading', { name: 'Print calibration' })).toBeVisible()
  await expect(page.locator('.print-sheet[aria-label="Sheet 1 fronts"] .print-card')).toHaveCount(4)
  await expect(page.locator('.print-sheet[aria-label="Sheet 1 backs"] .print-card')).toHaveCount(4)
  await expect(page.locator('.print-sheet[aria-label="Sheet 2 fronts"] .print-card')).toHaveCount(4)
  await expect(page.locator('.print-sheet[aria-label="Sheet 2 backs"] .print-card')).toHaveCount(4)
  await expect(page.locator('.print-warning')).toContainText('Overflow example')

  await page.getByLabel('Duplex flip edge').selectOption('short-edge')
  const backNames = await page.locator('.print-sheet[aria-label="Sheet 1 backs"] .card-name').allTextContents()
  expect(backNames).toEqual(['Calibration card 3', 'Calibration card 4', 'Calibration card 1', 'Calibration card 2'])

  await page.getByLabel('Include calibration page').check()
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
  const pages = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)]
  expect(pages).toHaveLength(5)
})
