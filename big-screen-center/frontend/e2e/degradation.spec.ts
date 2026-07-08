import { expect, test } from '@playwright/test'

test('webgl failure preserves primary metrics', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'WebGLRenderingContext', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(window, 'WebGL2RenderingContext', {
      configurable: true,
      value: undefined,
    })
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      contextId: string,
      ...args: unknown[]
    ) {
      if (contextId === 'webgl' || contextId === 'webgl2') return null
      return getContext.call(this, contextId, ...args as never[])
    } as typeof HTMLCanvasElement.prototype.getContext
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/play/sca-01?mock=1')

  await expect(
    page.locator('[data-three-fallback="risk-globe"]'),
  ).toBeVisible({ timeout: 50_000 })
  await expect(page.locator('[data-widget="metric-cards"]')).toBeVisible()
})

test('offline mode makes no third-party requests', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      external.push(request.url())
    }
  })

  await page.goto('/play/remind-03?mock=1&offline=1')
  await expect(page.locator('[data-screen-ready="true"]')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('[data-source-status="mock"]')).toBeVisible()
  expect(external).toEqual([])
})

test('mobile exposes playback controls but redirects away from editor canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/playlists/1?mock=1')
  await expect(page.locator('[data-mobile-playback-controls]')).toBeVisible({
    timeout: 20_000,
  })

  await page.goto('/edit/sca-01?mock=1')
  await expect(page).toHaveURL(/\?notice=desktop-editor$/)
  await expect(page.locator('.grid-stack')).toHaveCount(0)
})
