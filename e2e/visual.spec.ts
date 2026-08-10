import { authenticateMaintainer, createRoomName, expect, test } from './support'

const platformSnapshot = (name: string) => `${process.platform}-${name}`

const waitForStableRendering = async (page: Parameters<typeof authenticateMaintainer>[0]) => {
  const preview = page.getByRole('article', { name: /Visual MyST editor|Rendered MyST preview/ })
  await expect(preview.getByRole('heading', {
    name: 'A shared language for reproducible manuscripts',
  })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

test('desktop maintainer workspace matches its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Visual baselines use deterministic Chromium rendering')
  await page.setViewportSize({ width: 1440, height: 900 })
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await waitForStableRendering(page)

  await expect(page).toHaveScreenshot(platformSnapshot('maintainer-desktop.png'), {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
  })
})

test('mobile maintainer workspace matches its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Visual baselines use deterministic Chromium rendering')
  await page.setViewportSize({ width: 390, height: 844 })
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await waitForStableRendering(page)

  await expect(page).toHaveScreenshot(platformSnapshot('maintainer-mobile.png'), {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
  })
})

test('short-landscape identity dialog matches its visual baseline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Visual baselines use deterministic Chromium rendering')
  await page.setViewportSize({ width: 667, height: 320 })
  const roomName = createRoomName(testInfo)
  await page.goto(`/?doc=${roomName}`)
  await page.getByTitle('Connect GitHub identity').click()
  await expect(page.getByRole('dialog', { name: 'GitHub identity' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  await expect(page).toHaveScreenshot('github-dialog-short-landscape.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
  })
})
