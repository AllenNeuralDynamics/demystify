import type { WebSocketRoute } from '@playwright/test'
import { sampleManuscript } from '../src/lib/sampleManuscript'
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
    await expect(collaboratorPage.getByTitle('Insert MyST content')).toBeEnabled()
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

    const inlineSuggestion = page.locator('.myst-inline-suggestion').first()
    const inlineProposal = inlineSuggestion.locator('.myst-suggestion-option').first()
    await expect(inlineSuggestion.locator('del')).toContainText(originalText ?? '')
    await expect(inlineProposal.locator('ins')).toContainText('A reviewer-proposed sentence.')
    await expect(inlineProposal.locator('.myst-suggestion-author')).toHaveText('E2E Reviewer')
    await inlineProposal.click()
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

test('suggestion participant drafts in Source with a live Split preview', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'Desktop Source drafting covers all engines')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const reviewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const reviewer = await reviewerContext.newPage()
  const original = 'A manuscript should be as inspectable as the analysis behind it.'
  const replacement = 'A manuscript should keep every source-level proposal inspectable before acceptance.'
  const replacementFragment = 'keep every source-level proposal inspectable before acceptance'
  const remoteOriginal = 'The repository remains the durable record. Live updates are collected into deliberate snapshots, committed to a branch, and reviewed through a pull request.'
  const remoteReplacement = 'The repository remains the durable record while collaborators review source-level proposals.'

  try {
    await reviewer.addInitScript(() => {
      window.localStorage.setItem('demystify.profile', JSON.stringify({
        id: 'source-reviewer',
        name: 'Source Reviewer',
        color: '#a64b36',
        colorLight: '#f8e5df',
      }))
    })
    await reviewer.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(reviewer.locator('.sync-status')).toHaveText('Suggesting')
    await expect(reviewer.locator('.document-panes')).toHaveClass(/view-split/)
    const reviewerSource = reviewer.getByRole('textbox', { name: 'MyST source' })
    await expect(reviewerSource).toContainText(original)
    const expectedCanonical = sampleManuscript.replace(original, replacement)
    await reviewerSource.fill(expectedCanonical)

    await expect(reviewer.getByText('Drafting a source proposal')).toBeVisible()
    await expect(reviewer.locator('.myst-preview')).toContainText(replacement)
    await expect(page.locator('.cm-suggestion-proposal')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'MyST source' })).toContainText(original)

    await page.getByTitle('Visual editor').click()
    const remoteParagraph = page.locator('.myst-preview p.myst-editable-block')
      .filter({ hasText: remoteOriginal })
    await remoteParagraph.focus()
    await remoteParagraph.press('F2')
    await page.getByRole('textbox', { name: 'Edit paragraph' }).fill(remoteReplacement)
    await page.getByTitle('Save visual edit').click()
    await expect(reviewer.locator('.myst-preview')).toContainText(replacement)
    await expect(reviewer.locator('.myst-preview')).toContainText(remoteReplacement)
    await expect(reviewer.getByText('The manuscript changed in the same source range.')).toHaveCount(0)

    await reviewer.getByRole('button', { name: 'Propose changes' }).click()
    await expect(reviewer.getByText('Source suggestion ready for review')).toBeVisible()
    await page.getByTitle('Open comments').click()
    const thread = page.locator('.comment.suggestion-thread')
      .filter({ hasText: replacementFragment })
    await expect(thread).toBeVisible()
    await thread.locator('.comment-anchor-context').click()
    const sourceProposal = page.locator('.cm-suggestion-proposal')
      .filter({ hasText: replacementFragment })
    await expect(sourceProposal).toBeVisible()
    await expect(sourceProposal.locator('.cm-suggestion-author')).toHaveText('Source Reviewer')
    await thread.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(sourceProposal).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'MyST source' })).toContainText(replacement)
    await expect(reviewer.locator('.myst-preview')).toContainText(replacement)

    await reviewer.getByTitle('Close comments').click()
    const canonicalWithRemote = expectedCanonical.replace(remoteOriginal, remoteReplacement)
    const insertion = '\n\nA source-only insertion remains pending until review.'
    await reviewerSource.fill(`${canonicalWithRemote}${insertion}`)
    await expect(reviewer.locator('.myst-preview')).toContainText('A source-only insertion remains pending')
    await reviewer.getByRole('button', { name: 'Propose changes' }).click()
    const insertionProposal = page.locator('.cm-suggestion-proposal')
      .filter({ hasText: 'A source-only insertion remains pending' })
    await expect(insertionProposal).toBeVisible()
    await insertionProposal.click()
    const insertionThread = page.locator('.comment.suggestion-thread')
      .filter({ hasText: 'A source-only insertion remains pending' })
    await insertionThread.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(insertionProposal).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'MyST source' }))
      .not.toContainText('A source-only insertion remains pending')
  } finally {
    await reviewerContext.close()
  }
})

test('overlapping Source and Visual edits stop without overwriting either draft', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Overlapping source conflict runs once')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const reviewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const reviewer = await reviewerContext.newPage()
  const original = 'A manuscript should be as inspectable as the analysis behind it.'
  const localReplacement = 'A manuscript should preserve the reviewer source draft.'
  const remoteReplacement = 'A manuscript should preserve the maintainer visual revision.'

  try {
    await reviewer.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(reviewer.locator('.sync-status')).toHaveText('Suggesting')
    const reviewerSource = reviewer.getByRole('textbox', { name: 'MyST source' })
    await reviewerSource.fill(sampleManuscript.replace(original, localReplacement))
    await expect(reviewer.locator('.myst-preview')).toContainText(localReplacement)

    await page.getByTitle('Visual editor').click()
    const paragraph = page.locator('.myst-preview p.myst-editable-block')
      .filter({ hasText: original }).first()
    await paragraph.focus()
    await paragraph.press('F2')
    await page.getByRole('textbox', { name: 'Edit paragraph' }).fill(remoteReplacement)
    await page.getByTitle('Save visual edit').click()

    await expect(reviewer.getByText('The manuscript changed in the same source range.'))
      .toBeVisible()
    await expect(reviewer.getByRole('button', { name: 'Propose changes' })).toBeDisabled()
    await expect(reviewer.locator('.myst-preview')).toContainText(localReplacement)
    await expect(page.locator('.myst-preview')).toContainText(remoteReplacement)

    await reviewer.getByRole('button', { name: 'Discard' }).click()
    await expect(reviewer.getByText('Drafting a source proposal')).toHaveCount(0)
    await expect(reviewer.locator('.myst-preview')).toContainText(remoteReplacement)
    await expect(reviewer.locator('.myst-preview')).not.toContainText(localReplacement)
  } finally {
    await reviewerContext.close()
  }
})

test('different reviewers can revise one pending paragraph successively', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Successive multi-reviewer proposal runs once')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const original = 'A manuscript should be as inspectable as the analysis behind it.'
  const firstProposal = 'The manuscript should expose each analytical decision in context.'
  const revisedProposal = 'The manuscript should expose each analytical decision, reviewer, and source revision in context.'
  const revisedFragment = ', reviewer, and source revision'

  const openReviewer = async (name: string, id: string) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
    const reviewer = await context.newPage()
    await reviewer.addInitScript(({ profileId, profileName }) => {
      window.localStorage.setItem('demystify.profile', JSON.stringify({
        id: profileId,
        name: profileName,
        color: '#a64b36',
        colorLight: '#f8e5df',
      }))
    }, { profileId: id, profileName: name })
    await reviewer.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(reviewer.locator('.sync-status')).toHaveText('Suggesting')
    return { context, reviewer }
  }

  const first = await openReviewer('First Reviewer', 'first-reviewer')
  const second = await openReviewer('Second Reviewer', 'second-reviewer')
  try {
    await first.reviewer.getByTitle('Visual editor').click()
    const paragraph = first.reviewer.locator('.myst-preview p.myst-editable-block')
      .filter({ hasText: original }).first()
    await paragraph.focus()
    await paragraph.press('F2')
    await first.reviewer.getByRole('textbox', { name: 'Edit paragraph' }).fill(firstProposal)
    await first.reviewer.getByTitle('Save visual edit').click()

    await second.reviewer.getByTitle('Visual editor').click()
    const firstOption = second.reviewer.locator('.myst-suggestion-option')
      .filter({ hasText: firstProposal })
    await expect(firstOption).toBeVisible()
    await firstOption.click()
    const firstThread = second.reviewer.locator('.comment.suggestion-thread')
      .filter({ hasText: firstProposal })
    await firstThread.getByRole('button', { name: 'Revise', exact: true }).click()
    const sourceDraft = second.reviewer.getByRole('textbox', { name: 'MyST source' })
    await expect(sourceDraft).toContainText(firstProposal)
    await second.reviewer.keyboard.type(revisedProposal)
    await expect(second.reviewer.locator('.myst-preview')).toContainText(revisedProposal)
    await second.reviewer.getByRole('button', { name: 'Propose changes' }).click()

    await page.getByTitle('Open comments').click()
    await expect(page.locator('.comment.suggestion-thread').filter({ hasText: firstProposal }))
      .toBeVisible()
    await expect(page.locator('.comment.suggestion-thread').filter({ hasText: revisedFragment }))
      .toBeVisible()
    await page.getByTitle('Close comments').click()
    await page.getByTitle('Visual editor').click()
    const alternatives = page.locator('.myst-suggestion-option')
    await expect(alternatives).toHaveCount(2)
    await expect(alternatives.filter({ hasText: firstProposal })).toContainText('First Reviewer')
    await expect(alternatives.filter({ hasText: revisedProposal })).toContainText('Second Reviewer')

    await alternatives.filter({ hasText: revisedProposal }).click()
    const revisedThread = page.locator('.comment.suggestion-thread').filter({
      has: page.getByText('Second Reviewer', { exact: true }),
    })
    await revisedThread.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(revisedThread).toContainText('Accepted edit')
    const staleThread = page.locator('.comment.suggestion-thread').filter({
      has: page.getByText('First Reviewer', { exact: true }),
    })
    await expect(staleThread).toContainText('Conflicted edit')
    await page.getByTitle('Visual editor').click()
    await expect(page.locator('.myst-preview')).toContainText(revisedProposal)
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test('two reviewers can propose concurrent alternatives for the same paragraph', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Concurrent same-range proposals run once')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const original = 'A manuscript should be as inspectable as the analysis behind it.'

  const createReviewer = async (name: string, proposedText: string) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
    const reviewer = await context.newPage()
    await reviewer.addInitScript(({ profileName }) => {
      window.localStorage.setItem('demystify.profile', JSON.stringify({
        id: profileName,
        name: profileName,
        color: profileName === 'Reviewer A' ? '#a64b36' : '#27628d',
        colorLight: '#f8e5df',
      }))
    }, { profileName: name })
    await reviewer.goto(`/?doc=${roomName}#collaborate=${token}`)
    await reviewer.getByTitle('Visual editor').click()
    const paragraph = reviewer.locator('.myst-preview p.myst-editable-block')
      .filter({ hasText: original }).first()
    await paragraph.focus()
    await paragraph.press('F2')
    await reviewer.getByRole('textbox', { name: 'Edit paragraph' }).fill(proposedText)
    return { context, reviewer }
  }

  const firstText = 'Reviewer A proposes transparent analysis provenance.'
  const secondText = 'Reviewer B proposes inspectable evidence and provenance.'
  const first = await createReviewer('Reviewer A', firstText)
  const second = await createReviewer('Reviewer B', secondText)
  try {
    await Promise.all([
      first.reviewer.getByTitle('Save visual edit').click(),
      second.reviewer.getByTitle('Save visual edit').click(),
    ])
    await page.getByTitle('Visual editor').click()
    await expect(page.locator('.myst-suggestion-option')).toHaveCount(2)
    await expect(page.locator('.myst-suggestion-option').filter({ hasText: firstText }))
      .toContainText('Reviewer A')
    await expect(page.locator('.myst-suggestion-option').filter({ hasText: secondText }))
      .toContainText('Reviewer B')
    await page.getByTitle('Source only').click()
    await expect(page.locator('.cm-suggestion-deletion')).toHaveCount(1)
    await expect(page.locator('.cm-suggestion-proposal')).toHaveCount(2)
  } finally {
    await first.context.close()
    await second.context.close()
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
    const inline = page.locator('.myst-inline-suggestion').first()
    const inlineProposal = inline.locator('.myst-suggestion-option').first()
    await expect(inline.locator('del')).toContainText(original ?? '')
    await expect(inlineProposal.locator('ins')).toContainText('A long attributed proposal')
    await expect(inlineProposal.locator('.myst-suggestion-author')).toHaveText('Mobile Reviewer')

    const viewport = page.viewportSize()
    const bounds = await inline.boundingBox()
    expect(viewport).not.toBeNull()
    expect(bounds).not.toBeNull()
    if (viewport && bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    }

    await inlineProposal.click()
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
