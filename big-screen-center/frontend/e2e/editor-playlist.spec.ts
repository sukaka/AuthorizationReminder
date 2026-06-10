import { expect, test } from '@playwright/test'

test('desktop editor exposes constrained grid controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/edit/sca-01?mock=1')

  await expect(page.locator('.grid-stack')).toBeVisible()
  await expect(page.locator('.grid-stack-item')).toHaveCount(5)
  await expect(page.getByText('核心组件 · 不可隐藏')).toHaveCount(3)
})

test('playlist supports navigation and pause controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/playlists/1?mock=1')

  const controls = page.locator('[data-mobile-playback-controls]')
  await expect(controls).toBeVisible()
  await expect(controls).toContainText('sca-01')
  await controls.getByRole('button', { name: '下一项' }).click()
  await expect(controls).toContainText('train-01')
  await page.keyboard.press('Space')
  await expect(controls.getByRole('button', { name: '恢复' })).toBeVisible()
})

test('mobile redirects editor to catalog with guidance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/edit/sca-01?mock=1')

  await expect(page).toHaveURL(/\/\?notice=desktop-editor/)
  await expect(page.getByText('请在桌面端编辑')).toBeVisible()
})
