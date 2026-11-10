import { expect, test } from '@playwright/test'

test('app loads and edits offline after the first visit', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.locator('.tiptap')).toBeVisible()

  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false
    const registration = await navigator.serviceWorker.ready
    return Boolean(registration.active)
  })

  // A reload while online lets the service worker take control and precache.
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
    timeout: 30_000,
  })
  await page.waitForTimeout(1000)

  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page.locator('.tiptap')).toBeVisible({ timeout: 30_000 })

    await page.locator('.tiptap').click()
    await page.keyboard.type('离线也能写')
    await expect(page.locator('.tiptap')).toContainText('离线也能写')
    await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
