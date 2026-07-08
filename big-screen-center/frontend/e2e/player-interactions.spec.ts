import { expect, test } from '@playwright/test'

import { TEMPLATE_BLUEPRINTS } from '../src/templates/manifests'

for (const [id] of TEMPLATE_BLUEPRINTS) {
  test(`${id} supports linked hover, lock, switch, and clear`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.addInitScript(() => {
      window.sessionStorage.setItem('big-screen-mock', '1')
      window.sessionStorage.setItem('big-screen-profile', 'medium')
    })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/play/${id}?mock=1`)

    const cards = page.locator('[data-widget="metric-cards"] [data-interaction-key]')
    await expect(cards).toHaveCount(4)

    const first = cards.nth(0)
    const second = cards.nth(1)
    await first.hover()
    await expect(first).toHaveAttribute('data-interaction-state', 'primary')

    await first.click()
    await expect(page.locator('[data-interaction-console]')).toBeVisible()
    await expect(first).toHaveAttribute('aria-pressed', 'true')

    await second.click()
    await expect(second).toHaveAttribute('aria-pressed', 'true')
    await expect(first).toHaveAttribute('aria-pressed', 'false')

    await page.keyboard.press('Escape')
    await expect(page.locator('[data-interaction-console]')).toHaveCount(0)
  })
}

test('low profile keeps color feedback without motion', async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('big-screen-mock', '1')
    window.sessionStorage.setItem('big-screen-profile', 'low')
  })
  await page.goto('/play/sca-01?mock=1')
  const card = page.locator('[data-interaction-key]').first()
  await card.hover()
  await expect(card).toHaveAttribute('data-interaction-state', 'primary')
  await expect(card).toHaveCSS('transform', 'none')
})
