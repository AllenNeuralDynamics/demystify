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
  await expect(page.getByRole('img', { name: 'DeMystify' })).toBeVisible()
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByText('Connect GitHub to access this room.')).toBeVisible()
})

test('opens a live authenticated maintainer room', async ({ page }, testInfo) => {
  const roomName = createRoomName(testInfo)
  const avatarUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24"%3E%3Crect width="24" height="24" fill="%2316705d"/%3E%3C/svg%3E'

  await authenticateMaintainer(page, roomName, testInfo, avatarUrl)

  await expect(page.getByRole('region', { name: 'MyST source editor' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Visual document editor' })).toBeVisible()
  await expect(page.getByTitle('Connect GitHub repository')).toBeVisible()
  const profileImage = page.getByRole('button', {
    name: /GitHub identity @e2e-editor-/,
  }).locator('img')
  await expect(profileImage).toHaveAttribute('src', avatarUrl)

  await page.reload()
  await expect(page.locator('.sync-status')).toHaveText('Live')
  await expect(profileImage).toHaveAttribute('src', avatarUrl)
})
