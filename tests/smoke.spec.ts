import { expect, test } from '@playwright/test'

test('production app renders its Russian landing page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Куда купаться\? — пляжи Анапы/)
  await expect(page.locator('#root').locator('> *')).toHaveCount(1)
  await expect(page.locator('#root')).not.toBeEmpty()
})
