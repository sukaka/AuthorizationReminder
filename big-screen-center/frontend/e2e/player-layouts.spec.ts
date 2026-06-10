import { expect, test } from '@playwright/test'

import { TEMPLATE_BLUEPRINTS } from '../src/templates/manifests'
import type { SystemKey } from '../src/types'

const groups: Array<[SystemKey, string]> = [
  ['sca', 'SCA'],
  ['train-exam', '培训考试'],
  ['reminder', '授权提醒'],
]

for (const [systemKey, label] of groups) {
  test(`${label} templates render both layouts`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.addInitScript(() => {
      window.sessionStorage.setItem('big-screen-mock', '1')
      window.sessionStorage.setItem('big-screen-profile', 'medium')
    })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/')

    for (const [id, templateSystem, , , , , coreType] of TEMPLATE_BLUEPRINTS) {
      if (templateSystem !== systemKey) continue

      await test.step(`${id} widescreen`, async () => {
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.locator(`a[href="/play/${id}"]`).click()
        await expect(
          page.locator('[data-screen-layout="widescreen"]'),
        ).toBeVisible()
        await expect(
          page.locator(`.screen-grid__area--core [data-widget="${coreType}"]`),
        ).toBeVisible({ timeout: 60_000 })
        await expect(page.locator('[data-source-status]')).toHaveCount(1)
        await expect(page.locator('[data-widget-error="true"]')).toHaveCount(0)
      })

      await test.step(`${id} ultrawide`, async () => {
        await page.setViewportSize({ width: 3840, height: 1080 })
        await expect(
          page.locator('[data-screen-layout="ultrawide"]'),
        ).toBeVisible()
        await expect(
          page.locator(`.screen-grid__area--core [data-widget="${coreType}"]`),
        ).toBeVisible()
        await expect(page.locator('[data-source-status]')).toHaveCount(1)
        await expect(page.locator('[data-widget-error="true"]')).toHaveCount(0)
        await page.locator('.screen-exit').click()
        await expect(page.locator(`a[href="/play/${id}"]`)).toBeVisible()
      })
    }
  })
}
