import { authenticateMaintainer, createRoomName, expect, test } from './support'

test('loads the anonymous application shell', async ({ page }, testInfo) => {
  const roomName = createRoomName(testInfo)
  const [healthResponse, robotsResponse] = await Promise.all([
    page.request.get('/api/health'),
    page.request.get('/robots.txt'),
  ])

  expect(healthResponse.ok()).toBe(true)
  expect(robotsResponse.ok()).toBe(true)
  expect(await robotsResponse.text()).toContain('Disallow: /')
  await page.goto(`/?doc=${roomName}`)

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow, noarchive',
  )
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
