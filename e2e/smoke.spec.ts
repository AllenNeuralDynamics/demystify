import { authenticateMaintainer, createRoomName, expect, selectSourceDocument, test } from './support'

test('room and invitation links stay visible in Suggesting mode and across reloads without granting management access', async ({ page, browser }, testInfo) => {
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await page.getByRole('button', { name: 'Editing', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Suggesting', exact: true }).click()
  await page.getByTitle('Share access', { exact: true }).click()
  const share = page.getByRole('dialog', { name: 'Share manuscript', exact: true })
  const normalUrl = await share.getByRole('textbox', { name: 'Room link', exact: true }).inputValue()
  expect(new URL(normalUrl).hash).toBe('')
  expect(new URL(normalUrl).search).toBe(`?doc=${roomName}`)
  await share.getByRole('button', { name: 'Create suggestion link', exact: true }).click()
  const suggestion = share.getByRole('textbox', { name: 'Suggestion link', exact: true })
  await expect(suggestion).toHaveValue(/#collaborate=/)
  const suggestionUrl = await suggestion.inputValue()
  await page.screenshot({ path: testInfo.outputPath('visible-room-links.png') })
  await page.getByTitle('Close share dialog', { exact: true }).click()
  await page.getByTitle('Share access', { exact: true }).click()
  await expect(suggestion).toHaveValue(suggestionUrl)
  await page.getByTitle('Close share dialog', { exact: true }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTitle('Share access', { exact: true }).click()
  await expect(suggestion).toHaveValue(suggestionUrl)
  await share.getByRole('button', { name: 'Create viewer link', exact: true }).click()
  await expect(share.getByRole('textbox', { name: 'Viewer link', exact: true })).toHaveValue(/#view=/)
  await expect(suggestion).toHaveValue(suggestionUrl)
  const guestContext = await browser.newContext()
  try {
    const guest = await guestContext.newPage()
    await guest.goto(suggestionUrl)
    await expect(guest.getByText('Suggestion mode', { exact: true }).first()).toBeVisible()
    await guest.getByTitle('Share access', { exact: true }).click()
    const guestShare = guest.getByRole('dialog', { name: 'Share manuscript', exact: true })
    await expect(guestShare.getByRole('textbox', { name: 'Room link', exact: true })).toHaveValue(normalUrl)
    await expect(guestShare.getByRole('button', { name: 'Create suggestion link', exact: true })).toHaveCount(0)
    await expect(guestShare.getByRole('textbox', { name: 'Suggestion link', exact: true })).toHaveCount(0)
    await expect(guestShare.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0)
  } finally { await guestContext.close() }
})

test('room titles are shared and persistent without changing the manuscript', async ({ page }, testInfo) => {
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source', exact: true })
  const manuscript = () => source.evaluate((element) => {
    let current: Element | null = element
    while (current) {
      const property = Object.keys(current).find((key) => key.startsWith('__reactFiber$'))
      let fiber = property ? (current as unknown as Record<string, unknown>)[property] as {
        memoizedProps?: { sharedText?: { toString: () => string } }; return?: unknown
      } : null
      for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return as typeof fiber) {
        if (fiber.memoizedProps?.sharedText) return fiber.memoizedProps.sharedText.toString()
      }
      current = current.parentElement
    }
    throw new Error('Shared manuscript unavailable')
  })
  const original = await manuscript()
  await page.getByRole('button', { name: /^Rename room:/ }).click()
  const rename = page.getByRole('dialog', { name: 'Rename room', exact: true })
  await rename.getByRole('textbox', { name: 'Room title', exact: true }).fill('Reviewer response')
  await expect(rename.getByRole('status', { name: 'Pull request title', exact: true })).toContainText('Update Reviewer response')
  await page.screenshot({ path: testInfo.outputPath('rename-room.png') })
  await rename.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(rename).toHaveCount(0)
  await expect(page.locator('.document-title')).toHaveText('Reviewer response')
  expect(await manuscript()).toBe(original)
  expect(new URL(page.url()).searchParams.get('doc')).toBe(roomName)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.document-title')).toHaveText('Reviewer response')
  expect(await manuscript()).toBe(original)
})

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
      const imported = { ...freshRoom, binding: { ...binding, baseBranch: route.request().postDataJSON().baseBranch, branchName: `demystify/${requestedRoom.slice(0, 12)}` } }
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
      if (url.pathname.endsWith('/branches')) return route.fulfill({ json: { branches: [{ name: 'main' }, { name: 'revision/two' }] } })
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
      await next.getByLabel('Source branch', { exact: true }).selectOption('revision/two')
      await importDialog.getByRole('button', { name: 'Open file', exact: true }).click()
      await expect(importDialog).toHaveCount(0)
      await expect(next.getByRole('textbox', { name: 'MyST source', exact: true })).toContainText('Source paragraph.')
      expect(new URL(next.url()).searchParams.has('import')).toBe(false)
      expect(importedRooms.size).toBe(1)
      expect(Array.from(importedRooms.values())[0].binding.baseBranch).toBe('revision/two')
      await expect(dialog).toBeVisible()
      expect(new URL(page.url()).searchParams.get('doc')).toBe(roomName)
      expect(await source.locator('.cm-line').allTextContents()).toEqual(originalDraft)
      expect(mutations).toEqual([])
    } finally {
      await next.close()
    }
  })
}

test('version history previews and restores a named room checkpoint without losing the current draft', async ({ page }, testInfo) => {
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source', exact: true })
  const replaceSource = async (text: string) => {
    await source.focus()
    await selectSourceDocument(source)
    await page.keyboard.insertText(text)
    await expect(page.getByRole('status', { name: 'Server save status' })).toHaveAttribute('data-save-state', 'saved')
  }
  await replaceSource('# Versioned manuscript\n\nOriginal paragraph.\n')
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Version history', exact: true })
  await expect(history).toBeVisible()
  await history.getByRole('textbox', { name: 'Version name', exact: true }).fill('Before revision')
  await history.getByRole('button', { name: 'Save named version', exact: true }).click()
  await expect(history.getByRole('button', { name: 'Preview version: Before revision', exact: true })).toBeVisible()
  await history.getByRole('button', { name: 'Back to document', exact: true }).click()
  await replaceSource('# Versioned manuscript\n\nRevised paragraph.\n')
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  await history.getByRole('button', { name: 'Preview version: Before revision', exact: true }).click()
  await expect(history.getByRole('main', { name: 'Version preview', exact: true })).toContainText('Original paragraph.')
  await expect(history.locator('[contenteditable="true"]')).toHaveCount(0)
  await expect(source).toContainText('Revised paragraph.')
  await history.getByRole('button', { name: 'Changes', exact: true }).click()
  await expect(history.locator('[data-change="removed"]')).toContainText('Original paragraph.')
  await expect(history.locator('[data-change="added"]')).toContainText('Revised paragraph.')
  await page.screenshot({ path: testInfo.outputPath('version-history.png') })
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toContain('safety version')
    await dialog.accept()
  })
  await history.getByRole('button', { name: 'Restore this version', exact: true }).click()
  await expect(history.getByRole('button', { name: 'Back to document', exact: true })).toBeEnabled()
  await expect(history.getByText('Restored version', { exact: true })).toBeVisible()
  await history.getByRole('button', { name: 'Back to document', exact: true }).click()
  await expect(source).toContainText('Original paragraph.')
  await expect(source).not.toContainText('Revised paragraph.')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(source).toContainText('Original paragraph.')
  const listing = await (await page.request.get(`/api/rooms/${roomName}/versions`)).json()
  const safety = listing.versions.find((version: { kind: string }) => version.kind === 'safety')
  expect(safety).toBeTruthy()
  const savedDraft = await (await page.request.get(`/api/rooms/${roomName}/versions/${safety.id}`)).json()
  expect(savedDraft.snapshot.content).toContain('Revised paragraph.')
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  await expect(history.getByRole('button', { name: 'Preview version: Before revision', exact: true })).toBeVisible()
})
