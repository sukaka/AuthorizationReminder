import { expect, test } from '@playwright/test'

for (const id of ['sca-01', 'train-01', 'remind-01']) {
  test(`${id} renders both layouts`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/play/${id}?mock=1`)
    await expect(
      page.locator('[data-screen-layout="widescreen"]'),
    ).toBeVisible()

    await page.setViewportSize({ width: 3840, height: 1080 })
    await page.reload()
    await expect(
      page.locator('[data-screen-layout="ultrawide"]'),
    ).toBeVisible()
  })
}
