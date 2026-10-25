import { authenticateMaintainer, createRoomName, expect, selectSourceDocument, test } from './support'

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

for (const action of ['Open another manuscript', 'Open source as new version']) {
  test(`manuscript versions compare safely and ${action.toLowerCase()}`, async ({ page, context }, testInfo) => {
    const roomName = createRoomName(testInfo)
    await authenticateMaintainer(page, roomName, testInfo)
    const draft = '# Manuscript versions\n\nRoom paragraph.\n'
    const source = page.getByRole('textbox', { name: 'MyST source', exact: true })
    await source.focus()
    await selectSourceDocument(source)
    await page.keyboard.insertText(draft)
    await expect(source.locator('.cm-line')).toHaveText(['# Manuscript versions', '', 'Room paragraph.', ''])
    await expect(page.getByRole('status', { name: 'Server save status' })).toHaveAttribute('data-save-state', 'saved')
    const room = await (await page.request.post(`/api/rooms/${roomName}/claim`)).json()
    const binding = {
      owner: 'research', repository: 'paper', fullName: 'research/paper',
      isFork: false, parentFullName: null, path: 'paper/index.md',
      baseBranch: 'main', branchName: `demystify/${roomName.slice(0, 12)}`,
    }
    const mutations: string[] = []
    const importedRooms = new Map<string, typeof room>()
    await context.route('**/api/auth/session', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ json: { ...await response.json(), githubConfigured: true } })
    })
    await context.route('**/api/rooms/*/claim', (route) => {
      const requestedRoom = new URL(route.request().url()).pathname.split('/')[3]
      if (requestedRoom === roomName) return route.fulfill({ json: { ...room, binding } })
      const imported = importedRooms.get(requestedRoom)
      return imported ? route.fulfill({ json: imported }) : route.continue()
    })
    await context.route('**/api/rooms/*/binding', async (route) => {
      const requestedRoom = new URL(route.request().url()).pathname.split('/')[3]
      if (requestedRoom === roomName) {
        mutations.push(route.request().url())
        return route.fulfill({ status: 409, json: { error: 'Unexpected room rebind' } })
      }
      const freshRoom = await (await context.request.post(`/api/rooms/${requestedRoom}/claim`)).json()
      const imported = { ...freshRoom, binding: { ...binding, branchName: `demystify/${requestedRoom.slice(0, 12)}` } }
      importedRooms.set(requestedRoom, imported)
      return route.fulfill({ json: imported })
    })
    await context.route('**/api/github/**', (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET') mutations.push(url.pathname)
      if (url.pathname.endsWith('/repositories')) return route.fulfill({ json: { repositories: [{
        id: 42, name: 'paper', fullName: 'research/paper', owner: 'research',
        isFork: false, parentFullName: null, private: false, defaultBranch: 'main', canPush: true,
      }] } })
      if (url.pathname.endsWith('/contents')) return route.fulfill({ json: { entries: [{
        type: 'file', name: 'index.md', path: binding.path, sha: 'source-sha',
      }] } })
      if (url.pathname.endsWith('/project-files')) return route.fulfill({ json: {
        config: { content: 'version: 1\n', path: 'paper/myst.yml', exists: true },
        files: [{ content: '# Manuscript versions\n\nSource paragraph.\n', path: binding.path, sha: 'source-sha' }],
        missing: [], bibliographyPaths: [],
      } })
      if (url.pathname.endsWith('/file')) return route.fulfill({ json: {
        content: url.searchParams.get('path')?.endsWith('.bib') ? '' : '# Manuscript versions\n\nSource paragraph.\n',
        path: url.searchParams.get('path'), sha: 'source-sha',
        htmlUrl: 'https://github.com/research/paper/blob/main/paper/index.md',
      } })
      return route.abort()
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('textbox', { name: 'MyST source', exact: true })).toContainText('Room paragraph.')
    const originalDraft = await source.locator('.cm-line').allTextContents()
    if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Show files', exact: true }).click()
    await expect(page.locator('.repository-picker')).toContainText('Source: main')
    await expect(page.locator('.repository-picker')).toContainText(`Draft: ${binding.branchName}`)
    await page.getByRole('button', { name: 'Manuscript versions', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Manuscript versions', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Bind current draft', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Open file', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Compare with main', exact: true }).click()
    await expect(dialog.getByRole('region', { name: 'Comparison with main', exact: true })).toContainText('Room differs from main')
    await expect(dialog.locator('[data-change="removed"]')).toContainText('Source paragraph.')
    await expect(dialog.locator('[data-change="added"]')).toContainText('Room paragraph.')
    const rectangle = await dialog.boundingBox()
    expect(rectangle!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(rectangle!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await page.screenshot({ path: testInfo.outputPath('manuscript-versions.png') })
    const [next] = await Promise.all([
      context.waitForEvent('page'), dialog.getByRole('button', { name: action, exact: true }).click(),
    ])
    try {
      const importDialog = next.getByRole('dialog', { name: 'GitHub repository', exact: true })
      await expect(importDialog).toBeVisible()
      const nextUrl = new URL(next.url())
      expect(nextUrl.searchParams.get('doc')).not.toBe(roomName)
      expect(nextUrl.searchParams.get('import')).toBe('github')
      expect(nextUrl.searchParams.has('serverCopy')).toBe(false)
      expect(nextUrl.hash).toBe('')
      if (action === 'Open source as new version') {
        await expect(next.getByLabel('Manuscript path', { exact: true })).toHaveValue(binding.path)
        await expect(next.getByLabel('Repository', { exact: true })).toHaveValue(binding.fullName)
      } else {
        await importDialog.getByRole('button', { name: 'index.md', exact: true }).click()
      }
      await importDialog.getByRole('button', { name: 'Open file', exact: true }).click()
      await expect(importDialog).toHaveCount(0)
      await expect(next.getByRole('textbox', { name: 'MyST source', exact: true })).toContainText('Source paragraph.')
      expect(new URL(next.url()).searchParams.has('import')).toBe(false)
      expect(importedRooms.size).toBe(1)
      await expect(dialog).toBeVisible()
      expect(new URL(page.url()).searchParams.get('doc')).toBe(roomName)
      expect(await source.locator('.cm-line').allTextContents()).toEqual(originalDraft)
      expect(mutations).toEqual([])
    } finally {
      await next.close()
    }
  })
}
