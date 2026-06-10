import { expect, test } from '@playwright/test'

test('webgl failure preserves primary metrics', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'WebGLRenderingContext', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(window, 'WebGL2RenderingContext', {
      configurable: true,
      value: undefined,
    })
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/play/sca-01?mock=1')

  await expect(
    page.locator('[data-three-fallback="risk-globe"]'),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-widget="metric-cards"]')).toBeVisible()
})
