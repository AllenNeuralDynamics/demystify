import { expect, test as base, type Page, type TestInfo } from '@playwright/test'

export { expect }

export const test = base.extend<{ pageDiagnostics: void }>({
  pageDiagnostics: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`Page error: ${error.message}`))
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        !message.text().includes('server responded with a status of 401')
      ) errors.push(`Console error: ${message.text()}`)
    })
    page.on('response', (response) => {
      if (response.status() >= 500) {
        errors.push(`HTTP ${response.status()}: ${response.url()}`)
      }
    })

    await use()

    expect(errors, 'The browser reported unexpected runtime errors').toEqual([])
  }, { auto: true }],
})

export const createRoomName = (testInfo: TestInfo) => {
  const title = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 24)
  return `e2e-${title}-${testInfo.workerIndex}-${Date.now().toString(36)}`
}

export const authenticateMaintainer = async (
  page: Page,
  roomName: string,
  testInfo: TestInfo,
) => {
  const identity = 10_000 + testInfo.workerIndex
  await page.addInitScript((profileId) => {
    window.localStorage.setItem('demystify.profile', JSON.stringify({
      id: `e2e-profile-${profileId}`,
      name: 'E2E Maintainer',
      color: '#16705d',
      colorLight: '#dcefe9',
    }))
  }, identity)
  const sessionResponse = await page.request.post('/api/test/session', {
    data: { id: identity, login: `e2e-editor-${testInfo.workerIndex}` },
  })
  expect(sessionResponse.status()).toBe(204)

  const claimResponse = await page.request.post(`/api/rooms/${roomName}/claim`)
  expect(claimResponse.status()).toBe(201)

  await page.goto(`/?doc=${roomName}`)
  await expect(page.locator('.sync-status')).toHaveText('Live')
  await expect(page.getByTitle('Share access')).toBeVisible()
  await expect(page.getByTitle('Insert MyST content')).toBeEnabled()
}
