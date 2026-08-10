import { authenticateMaintainer, createRoomName, expect, test } from './support'

test('loads the anonymous application shell', async ({ page }, testInfo) => {
  const roomName = createRoomName(testInfo)
  const healthResponse = await page.request.get('/api/health')

  expect(healthResponse.ok()).toBe(true)
  await page.goto(`/?doc=${roomName}`)

  await expect(page.getByText('DeMystify', { exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByText('Connect GitHub to access this room.')).toBeVisible()
})

test('opens a live authenticated maintainer room', async ({ page }, testInfo) => {
  const roomName = createRoomName(testInfo)

  await authenticateMaintainer(page, roomName, testInfo)

  await expect(page.getByRole('region', { name: 'MyST source editor' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Visual document editor' })).toBeVisible()
  await expect(page.getByTitle('Connect GitHub repository')).toBeVisible()
})
