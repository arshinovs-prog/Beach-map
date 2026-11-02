import { test, expect } from '@playwright/test'

test('production app opens and initializes the map shell', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/')
  await expect(page.locator('#root')).toBeVisible()
  await expect(page.locator('.maplibregl-canvas')).toBeAttached({ timeout: 15000 })

  expect(pageErrors, 'Uncaught browser errors').toEqual([])
})
