import type { WebSocketRoute } from '@playwright/test'
import { authenticateMaintainer, createRoomName, expect, test } from './support'

const createShareToken = async (
  page: Parameters<typeof authenticateMaintainer>[0],
  roomName: string,
  role: 'viewer' | 'collaborator',
) => {
  const response = await page.request.post(`/api/rooms/${roomName}/${role}-links`, {
    data: { expiresInDays: 7 },
  })
  expect(response.status()).toBe(201)
  return (await response.json() as { token: string }).token
}

const insertNote = async (page: Parameters<typeof authenticateMaintainer>[0]) => {
  await page.getByTitle('Insert MyST content').click()
  await page.getByRole('dialog', { name: 'Insert MyST content' })
    .getByRole('button', { name: /^Note/ })
    .click()
}

const noteCount = (page: Parameters<typeof authenticateMaintainer>[0]) =>
  page.locator('.cm-content').evaluate((element) =>
    (element.textContent?.match(/:::\{note\}/g) ?? []).length,
  )

const replaceFirstVisualParagraph = async (
  page: Parameters<typeof authenticateMaintainer>[0],
  currentText: string,
  replacement: string,
) => {
  await page.getByTitle('Visual editor').click()
  const paragraph = page.locator('.myst-preview p.myst-editable-block').first()
  await expect(paragraph).toBeVisible()
  await expect(paragraph).toContainText(currentText)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await paragraph.focus()
  await paragraph.press('F2')
  const editor = page.getByRole('textbox', { name: 'Edit paragraph' })
  await expect(editor).toBeVisible()
  await editor.fill(replacement)
  await page.getByTitle('Save visual edit').click()
}

test('viewer receives live changes but cannot edit', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Covered by desktop browser engines')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'viewer')

  const viewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const viewerPage = await viewerContext.newPage()
  try {
    await viewerPage.goto(`/?doc=${roomName}#view=${token}`)
    await expect(viewerPage.getByText('Viewer access', { exact: true })).toBeVisible()
    await expect(viewerPage.getByTitle('Insert MyST content')).toBeDisabled()
    await expect(viewerPage.locator('.sync-status')).toHaveText('Viewing')

    await insertNote(page)
    await expect(viewerPage.locator('.cm-content')).toContainText(':::{note}')
  } finally {
    await viewerContext.close()
  }
})

test('suggestion participant proposes an attributed edit for maintainer review', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Covered by desktop browser engines')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')

  const collaboratorContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const collaboratorPage = await collaboratorContext.newPage()
  try {
    const canonicalEditor = page.getByRole('textbox', { name: 'MyST source' })
    await expect(canonicalEditor).toContainText('A shared language for reproducible manuscripts')
    const canonicalBeforeSuggestion = await canonicalEditor.innerText()
    await collaboratorPage.addInitScript(() => {
      window.localStorage.setItem('demystify.profile', JSON.stringify({
        id: 'e2e-reviewer',
        name: 'E2E Reviewer',
        color: '#a64b36',
        colorLight: '#f8e5df',
      }))
    })
    await collaboratorPage.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(collaboratorPage.getByText('Suggestion mode', { exact: true }).first()).toBeVisible()
    await expect(collaboratorPage.getByTitle('Insert MyST content')).toBeDisabled()
    await expect(collaboratorPage.getByTitle('Save snapshot to GitHub')).toBeDisabled()

    await collaboratorPage.getByTitle('Visual editor').click()
    const paragraph = collaboratorPage.locator('.myst-preview p.myst-editable-block').first()
    const originalText = await paragraph.textContent()
    expect(originalText).toBeTruthy()
    await paragraph.click()
    const visualEditor = collaboratorPage.getByRole('textbox', { name: 'Edit paragraph' })
    await visualEditor.fill('A reviewer-proposed sentence.')
    await collaboratorPage.getByTitle('Save visual edit').click()

    await expect(collaboratorPage.getByText('Suggestion ready for review')).toBeVisible()
    const sourceDeletion = page.locator('.cm-suggestion-deletion').first()
    const sourceProposal = page.locator('.cm-suggestion-proposal').first()
    await expect(sourceDeletion).toContainText(originalText ?? '')
    await expect(sourceProposal.locator('.cm-suggestion-source'))
      .toContainText('A reviewer-proposed sentence.')
    await expect(sourceProposal.locator('.cm-suggestion-author')).toHaveText('E2E Reviewer')
    const originalSource = await sourceDeletion.textContent()
    const proposedSource = await sourceProposal.locator('.cm-suggestion-source').textContent()
    await sourceProposal.click()
    await expect(page.locator('.comment.suggestion-thread').first()).toBeVisible()
    await page.getByTitle('Close comments').click()

    const inlineSuggestion = page.locator('[data-myst-suggestion-id]').first()
    await expect(inlineSuggestion).toBeVisible()
    await expect(inlineSuggestion.locator('del')).toContainText(originalText ?? '')
    await expect(inlineSuggestion.locator('ins')).toContainText('A reviewer-proposed sentence.')
    await expect(inlineSuggestion.locator('.myst-suggestion-author')).toHaveText('E2E Reviewer')
    await inlineSuggestion.click()
    const suggestion = page.locator('.comment.suggestion-thread').first()
    await expect(suggestion).toContainText('E2E Reviewer')
    await expect(suggestion).toContainText('Suggested edit')
    await expect(suggestion).toContainText('A reviewer-proposed sentence.')

    await suggestion.getByRole('textbox', { name: /Reply to comment by/ })
      .fill('This wording is clearer.')
    await suggestion.getByTitle('Reply').click()
    await expect(collaboratorPage.locator('.comment.suggestion-thread').first())
      .toContainText('This wording is clearer.')

    await suggestion.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(page.locator('.cm-content')).toContainText('A reviewer-proposed sentence.')
    await expect(page.locator('.cm-suggestion-proposal')).toHaveCount(0)
    await expect(suggestion).toContainText('Accepted edit')

    await collaboratorPage.getByTitle('Source only').click()
    await expect(collaboratorPage.locator('.cm-content'))
      .toContainText('A reviewer-proposed sentence.')

    await collaboratorPage.getByTitle('Close comments').click()
    await replaceFirstVisualParagraph(
      collaboratorPage,
      'A reviewer-proposed sentence.',
      'A proposal that should be rejected.',
    )
    const rejectedSuggestion = page.locator('.comment.suggestion-thread')
      .filter({ hasText: 'A proposal that should be rejected.' })
    await expect(rejectedSuggestion).toBeVisible()
    await rejectedSuggestion.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(rejectedSuggestion).toContainText('Rejected edit')
    await expect(page.locator('.cm-content')).toContainText('A reviewer-proposed sentence.')
    await expect(page.locator('.cm-suggestion-proposal')
      .filter({ hasText: 'A proposal that should be rejected.' })).toHaveCount(0)

    await collaboratorPage.getByTitle('Close comments').click()
    await replaceFirstVisualParagraph(
      collaboratorPage,
      'A reviewer-proposed sentence.',
      'A proposal with a stale source anchor.',
    )
    await page.getByTitle('Close comments').click()
    await page.getByTitle('Source only').click()
    const sourceEditor = page.getByRole('textbox', { name: 'MyST source' })
    const canonicalAfterAcceptance = canonicalBeforeSuggestion.replace(
      originalSource ?? '',
      proposedSource ?? '',
    )
    await sourceEditor.fill(canonicalAfterAcceptance.replace(
      proposedSource ?? '',
      'A concurrent maintainer revision.',
    ))
    await expect(sourceEditor).toContainText('A concurrent maintainer revision.')
    await page.getByTitle('Open comments').click()
    const conflictedSuggestion = page.locator('.comment.suggestion-thread')
      .filter({ hasText: 'A proposal with a stale source anchor.' })
    await conflictedSuggestion.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(conflictedSuggestion).toContainText('Conflicted edit')
    await expect(page.locator('.cm-content')).toContainText('A concurrent maintainer revision.')
    await expect(page.locator('.cm-suggestion-proposal')
      .filter({ hasText: 'A proposal with a stale source anchor.' })).toHaveCount(0)
  } finally {
    await collaboratorContext.close()
  }
})

test('keeps a pending suggestion in the mobile reading flow', async ({ browser, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile-'), 'Mobile inline geometry runs on phone projects')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const reviewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const reviewerPage = await reviewerContext.newPage()

  try {
    await reviewerPage.addInitScript(() => {
      window.localStorage.setItem('demystify.profile', JSON.stringify({
        id: 'mobile-reviewer',
        name: 'Mobile Reviewer',
        color: '#a64b36',
        colorLight: '#f8e5df',
      }))
    })
    await reviewerPage.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(reviewerPage.locator('.sync-status')).toHaveText('Suggesting')
    await reviewerPage.getByTitle('Visual editor').click()
    const target = reviewerPage.locator('.myst-preview p.myst-editable-block').first()
    const original = await target.textContent()
    expect(original).toBeTruthy()
    await target.focus()
    await target.press('F2')
    await reviewerPage.getByRole('textbox', { name: 'Edit paragraph' })
      .fill('A long attributed proposal that remains readable and wraps naturally on a narrow phone viewport.')
    await reviewerPage.getByTitle('Save visual edit').click()

    await page.getByTitle('Visual editor').click()
    const inline = page.locator('[data-myst-suggestion-id]').first()
    await expect(inline).toBeVisible()
    await expect(inline.locator('del')).toContainText(original ?? '')
    await expect(inline.locator('ins')).toContainText('A long attributed proposal')
    await expect(inline.locator('.myst-suggestion-author')).toHaveText('Mobile Reviewer')

    const viewport = page.viewportSize()
    const bounds = await inline.boundingBox()
    expect(viewport).not.toBeNull()
    expect(bounds).not.toBeNull()
    if (viewport && bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    }

    await inline.click()
    await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()
    await expect(page.locator('.comment.suggestion-thread').first())
      .toContainText('Mobile Reviewer')
    await page.getByTitle('Close comments').click()

    await page.getByTitle('Source only').click()
    const sourceProposal = page.locator('.cm-suggestion-proposal').first()
    await expect(sourceProposal).toBeVisible()
    await expect(sourceProposal.locator('.cm-suggestion-source'))
      .toContainText('A long attributed proposal')
    await expect(sourceProposal.locator('.cm-suggestion-author')).toHaveText('Mobile Reviewer')
    const sourceBounds = await sourceProposal.boundingBox()
    expect(sourceBounds).not.toBeNull()
    if (viewport && sourceBounds) {
      expect(sourceBounds.x).toBeGreaterThanOrEqual(0)
      expect(sourceBounds.x + sourceBounds.width).toBeLessThanOrEqual(viewport.width)
    }
    await sourceProposal.click()
    await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()
  } finally {
    await reviewerContext.close()
  }
})

test('queues local edits while disconnected and converges after reconnecting', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Network recovery runs once in Chromium')
  const roomName = createRoomName(testInfo)
  let interruptCollaboration = false
  let activeSocket: WebSocketRoute | null = null
  await page.routeWebSocket(/\/collaboration\//, async (socket) => {
    if (interruptCollaboration) {
      await socket.close({ code: 1013, reason: 'E2E network interruption' })
      return
    }
    activeSocket = socket
    socket.connectToServer()
  })
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'viewer')

  const viewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const viewerPage = await viewerContext.newPage()
  try {
    await viewerPage.goto(`/?doc=${roomName}#view=${token}`)
    await expect(viewerPage.getByText('Viewer access', { exact: true })).toBeVisible()
    const initialNoteCount = await noteCount(page)
    await expect.poll(() => noteCount(viewerPage)).toBe(initialNoteCount)

    interruptCollaboration = true
    await activeSocket?.close({ code: 1013, reason: 'E2E network interruption' })
    await expect(page.locator('.sync-status')).not.toHaveText('Live')
    await insertNote(page)
    await expect.poll(() => noteCount(page)).toBe(initialNoteCount + 1)
    await expect.poll(() => noteCount(viewerPage)).toBe(initialNoteCount)

    interruptCollaboration = false
    await expect(page.locator('.sync-status')).toHaveText('Live', { timeout: 15_000 })
    await expect.poll(() => noteCount(viewerPage), { timeout: 15_000 }).toBe(initialNoteCount + 1)
  } finally {
    await viewerContext.close()
  }
})

test('suspends an idle room and reconnects on activity', async ({ page }, testInfo) => {
  await page.clock.install()
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const status = page.locator('.sync-status')
  const editor = page.locator('.cm-content')

  await expect(status).toHaveText('Live')
  await expect(editor).toContainText('A shared language for reproducible manuscripts')

  await page.clock.fastForward(10 * 60_000)
  await expect(status).toHaveText('disconnected')
  await expect(editor).toContainText('A shared language for reproducible manuscripts')

  await page.locator('.editor-toolbar').dispatchEvent('pointerdown')
  await expect(status).toHaveText('Live')
})
