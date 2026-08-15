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
  page.locator('.myst-preview aside').count()

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
  await page.getByTitle('Finish visual edit').click()
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
    await viewerPage.getByRole('button', { name: 'Tools', exact: true }).click()
    const viewerCitation = viewerPage.getByRole('menu', { name: 'Tools menu' })
      .getByRole('menuitem', { name: 'Citations' })
    await expect(viewerCitation).toBeDisabled()
    await expect(viewerCitation).toHaveAttribute('title', 'Editing access is required')

    await insertNote(page)
    await expect(viewerPage.locator('.cm-content')).toContainText(':::{note}')
  } finally {
    await viewerContext.close()
  }
})

test('suggestion participant edits live for maintainer acceptance or rejection', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Covered by desktop browser engines')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('menu', { name: 'Tools menu' })
    .getByRole('menuitem', { name: 'Citations' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Cite a paper' })
    .getByRole('textbox', { name: 'Search papers' }))
    .toHaveAttribute('placeholder', 'Title, author, year, DOI, or PMID')
  await page.keyboard.press('Escape')
  const token = await createShareToken(page, roomName, 'collaborator')

  const collaboratorContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const collaboratorPage = await collaboratorContext.newPage()
  try {
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
    await expect(collaboratorPage.getByText('Suggesting live')).toBeVisible()
    await collaboratorPage.getByRole('button', { name: 'Tools', exact: true }).click()
    await collaboratorPage.getByRole('menu', { name: 'Tools menu' })
      .getByRole('menuitem', { name: 'Citations' })
      .click()
    const collaboratorPicker = collaboratorPage.getByRole('dialog', { name: 'Cite a paper' })
    await expect(collaboratorPicker.getByText(/Choose from this manuscript's library/))
      .toBeVisible()
    await expect(collaboratorPicker.getByRole('textbox', { name: 'Search papers' }))
      .toHaveAttribute('placeholder', 'Search this manuscript library')
    await collaboratorPage.keyboard.press('Escape')

    await collaboratorPage.getByTitle('Visual editor').click()
    const paragraph = collaboratorPage.locator('.myst-preview p.myst-editable-block').first()
    const originalText = await paragraph.textContent()
    expect(originalText).toBeTruthy()
    await paragraph.focus()
    await paragraph.press('F2')
    const visualEditor = collaboratorPage.getByRole('textbox', { name: 'Edit paragraph' })
    await collaboratorPage.getByTitle('Cite a paper').click()
    await expect(collaboratorPage.getByRole('dialog', { name: 'Cite a paper' })
      .getByText(/Choose from this manuscript's library/)).toBeVisible()
    await collaboratorPage.keyboard.press('Escape')
    await expect(visualEditor).toBeVisible()
    await visualEditor.fill('A reviewer-proposed sentence.')
    await expect(collaboratorPage.getByText('Live', { exact: true })).toBeVisible()
    await expect(page.locator('.myst-preview .myst-suggestion-insertion'))
      .toContainText('A reviewer-proposed sentence.')
    await collaboratorPage.getByTitle('Finish visual edit').click()

    await expect(page.locator('.sync-status')).toHaveText('Suggesting')
    await expect(page.locator('.cm-suggestion-insertion').filter({
      hasText: 'reviewer-proposed',
    })).toHaveCount(1)
    const reviewChanges = page.getByRole('button', { name: 'Review changes' })
    await expect(reviewChanges).toBeEnabled()
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await page.getByRole('menu', { name: 'Tools menu' })
      .getByRole('menuitem', { name: 'Citations' })
      .click()
    await expect(page.getByRole('dialog', { name: 'Cite a paper' })
      .getByText(/Choose from this manuscript's library/)).toBeVisible()
    await page.keyboard.press('Escape')
    await reviewChanges.click()
    await page.getByRole('menu', { name: 'Review changes menu' })
      .getByRole('menuitem', { name: 'Review changes' })
      .click()
    const liveProposal = page.locator('.live-proposal-card')
    await expect(liveProposal).toContainText('Current live proposal')
    await expect(liveProposal).toContainText('E2E Reviewer')
    await expect(liveProposal.locator('.suggestion-line.added').filter({
      hasText: 'reviewer-proposed',
    })).toHaveCount(1)
    const activeChange = liveProposal.locator('.live-proposal-change').filter({
      hasText: 'reviewer-proposed',
    })
    await activeChange.click()
    await expect(activeChange).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.cm-suggestion-insertion.is-active').filter({
      hasText: 'reviewer-proposed',
    })).toHaveCount(1)
    await expect(liveProposal.locator('.live-proposal-change').first())
      .toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator(
      '.toolbar-save[title="Accept or discard the live proposal before saving to GitHub"]',
    ))
      .toBeDisabled()

    await liveProposal.getByRole('button', { name: 'Accept all', exact: true }).click()
    await expect(liveProposal).toHaveCount(0)
    await expect(page.locator('.sync-status')).toHaveText('Live')
    await expect(page.getByRole('button', { name: 'Editing' })).toBeVisible()
    await expect(page.getByTitle('Save snapshot to GitHub')).toBeEnabled()
    await expect(page.locator('.proposal-checkpoint').first()).toContainText('Accepted proposal')

    await replaceFirstVisualParagraph(
      collaboratorPage,
      'A reviewer-proposed sentence.',
      'A proposal that should be rejected.',
    )
    await expect(page.locator('.myst-preview .myst-suggestion-insertion'))
      .toContainText('A proposal that should be rejected.')
    await liveProposal.getByRole('button', { name: 'Discard all', exact: true }).click()
    await expect(liveProposal).toHaveCount(0)
    await collaboratorPage.getByTitle('Source only').click()
    await expect(collaboratorPage.locator('.cm-content')).toContainText('A reviewer-proposed sentence.')
    await expect(collaboratorPage.locator('.cm-content'))
      .not.toContainText('A proposal that should be rejected.')
    await expect(page.locator('.proposal-checkpoint').first()).toContainText('Rejected proposal')
  } finally {
    await collaboratorContext.close()
  }
})

test('revoked Suggestion access immediately becomes read-only', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Share revocation lifecycle runs once')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const reviewer = await context.newPage()

  try {
    await reviewer.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(reviewer.locator('.sync-status')).toHaveText('Suggesting')
    const source = reviewer.getByRole('textbox', { name: 'MyST source' })
    await expect(source).toHaveAttribute('contenteditable', 'true')

    await createShareToken(page, roomName, 'collaborator')
    await expect(reviewer.locator('.sync-status')).toHaveText('Access revoked')
    await expect(source).toHaveAttribute('contenteditable', 'false')
    await expect(reviewer.getByText(
      'Suggestion access was revoked. Open a current sharing link to continue.',
    )).toBeVisible()
  } finally {
    await context.close()
  }
})

test('Source and Visual share one live proposal with suggesting maintainers', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'Desktop live Source editing covers all engines')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const reviewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const reviewer = await reviewerContext.newPage()
  const original = 'A manuscript should be as inspectable as the analysis behind it.'
  const replacement = 'A manuscript should keep every source-level proposal inspectable before acceptance.'
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

    await expect(reviewer.getByText('Suggesting live')).toBeVisible()
    await expect(reviewer.locator('.myst-preview')).toContainText(replacement)
    await expect(page.locator('.sync-status')).toHaveText('Suggesting')
    await expect(page.locator('.myst-preview .myst-suggestion-insertion'))
      .toContainText(replacement)

    await page.getByTitle('Visual editor').click()
    const remoteParagraph = page.locator('.myst-preview p.myst-editable-block')
      .filter({ hasText: remoteOriginal })
    await remoteParagraph.focus()
    await remoteParagraph.press('F2')
    await page.getByRole('textbox', { name: 'Edit paragraph' }).fill(remoteReplacement)
    await expect(reviewer.locator('.myst-preview')).toContainText(remoteReplacement)
    await page.getByTitle('Finish visual edit').click()
    await expect(reviewer.locator('.myst-preview')).toContainText(replacement)
    await expect(reviewer.locator('.myst-preview')).toContainText(remoteReplacement)
    await expect(page.getByRole('button', { name: 'Review changes' })).toBeVisible()

    await page.getByTitle('Open comments').click()
    const liveProposal = page.locator('.live-proposal-card')
    await expect(liveProposal).toContainText('Source Reviewer')
    await expect(liveProposal).toContainText('Integration Test')
    await liveProposal.getByRole('button', { name: 'Accept all', exact: true }).click()
    await expect(liveProposal).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Editing' })).toBeVisible()
    await expect(page.locator('.myst-preview')).toContainText(replacement)
    await expect(page.locator('.myst-preview')).toContainText(remoteReplacement)
  } finally {
    await reviewerContext.close()
  }
})

test('only authors edit comments and replies while everyone can reply', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Comment ownership runs once')
  test.setTimeout(45_000)
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const openReviewer = async (name: string) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
    const reviewer = await context.newPage()
    await reviewer.addInitScript((profileName) => {
      window.localStorage.setItem('demystify.profile', JSON.stringify({
        id: profileName,
        name: profileName,
        color: '#a64b36',
        colorLight: '#f8e5df',
      }))
    }, name)
    await reviewer.goto(`/?doc=${roomName}#collaborate=${token}`)
    await reviewer.getByTitle('Open comments').click()
    return { context, reviewer }
  }
  const first = await openReviewer('Reviewer A')
  const second = await openReviewer('Reviewer B')

  try {
    await first.reviewer.getByRole('textbox', { name: 'New comment' }).fill('Original comment text.')
    await first.reviewer.getByRole('button', { name: 'Comment', exact: true }).click()
    const firstComment = first.reviewer.locator('.comment').filter({
      has: first.reviewer.getByText('Reviewer A', { exact: true }),
    })
    const secondView = second.reviewer.locator('.comment').filter({
      has: second.reviewer.getByText('Reviewer A', { exact: true }),
    })
    await expect(secondView).toBeVisible()
    await page.getByTitle('Open comments').click()
    const maintainerView = page.locator('.comment').filter({
      has: page.getByText('Reviewer A', { exact: true }),
    })
    await expect(firstComment.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
    await expect(secondView.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(maintainerView.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)

    await firstComment.getByRole('button', { name: 'Edit', exact: true }).click()
    const commentEditor = firstComment.getByRole('textbox', { name: 'Edit comment by Reviewer A' })
    await commentEditor.fill('Author-edited comment text.')
    await first.reviewer.keyboard.press('Meta+Enter')
    await expect(commentEditor).toHaveCount(0)
    await expect(secondView).toContainText('Author-edited comment text.')
    await expect(secondView).toContainText('edited')

    await secondView.getByRole('textbox', { name: /Reply to comment by Reviewer A/ })
      .fill('Reply from Reviewer B.')
    await secondView.getByTitle('Reply').click()
    const replyInFirst = firstComment.locator('.comment-reply').filter({
      has: first.reviewer.getByText('Reviewer B', { exact: true }),
    })
    const replyInSecond = secondView.locator('.comment-reply').filter({
      has: second.reviewer.getByText('Reviewer B', { exact: true }),
    })
    await expect(replyInFirst).toBeVisible()
    await expect(replyInFirst.getByTitle('Edit your reply')).toHaveCount(0)
    await replyInSecond.getByTitle('Edit your reply').click()
    const replyEditor = replyInSecond.getByRole('textbox', { name: 'Edit reply by Reviewer B' })
    await replyEditor.fill('Author-edited reply from Reviewer B.')
    await second.reviewer.keyboard.press('Meta+Enter')
    await expect(replyEditor).toHaveCount(0)
    await expect(replyInFirst).toContainText('Author-edited reply from Reviewer B.')
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test('different reviewers edit one current proposal across Source and Visual', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Cross-mode proposal revision runs once')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const original = 'A manuscript should be as inspectable as the analysis behind it.'
  const firstProposal = 'The manuscript should expose each analytical decision in context.'
  const revisedProposal = 'The manuscript should expose each analytical decision, reviewer, and source revision in context.'
  const finalProposal = 'The manuscript should expose each analytical decision, reviewer, source revision, and supporting evidence in context.'

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
    await first.reviewer.getByTitle('Finish visual edit').click()

    const sourceDraft = second.reviewer.getByRole('textbox', { name: 'MyST source' })
    await expect(second.reviewer.locator('.myst-preview .myst-suggestion-insertion'))
      .toContainText(firstProposal)
    await sourceDraft.fill(sampleManuscript.replace(original, revisedProposal))
    await expect(second.reviewer.locator('.myst-preview')).toContainText(revisedProposal)
    await expect(second.reviewer.locator('.myst-preview')).not.toContainText(firstProposal)

    await first.reviewer.getByTitle('Visual editor').click()
    const currentParagraph = first.reviewer.locator('.myst-preview p.myst-editable-block')
      .filter({ hasText: revisedProposal })
    await currentParagraph.focus()
    await currentParagraph.press('F2')
    await first.reviewer.getByRole('textbox', { name: 'Edit paragraph' }).fill(finalProposal)
    await first.reviewer.getByTitle('Finish visual edit').click()
    await expect(second.reviewer.locator('.myst-preview')).toContainText(finalProposal)
    await expect(second.reviewer.locator('.myst-preview')).not.toContainText(revisedProposal)

    await page.getByTitle('Open comments').click()
    const liveProposal = page.locator('.live-proposal-card')
    await expect(liveProposal).toContainText('First Reviewer')
    await expect(liveProposal).toContainText('Second Reviewer')
    await expect(page.locator('.myst-preview .myst-suggestion-insertion'))
      .toContainText(finalProposal)
    await expect(page.locator('.myst-suggestion-option').filter({
      hasText: finalProposal,
    })).toHaveCount(1)
    await liveProposal.getByRole('button', { name: 'Accept all', exact: true }).click()
    await page.getByTitle('Visual editor').click()
    await expect(page.locator('.myst-preview')).toContainText(finalProposal)
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test('concurrent Source typing converges into one live proposal', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Concurrent CRDT typing runs once')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')

  const createReviewer = async (name: string) => {
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
    return { context, reviewer }
  }

  const firstText = 'Reviewer A adds transparent analysis provenance.'
  const secondText = 'Reviewer B adds inspectable supporting evidence.'
  const first = await createReviewer('Reviewer A')
  const second = await createReviewer('Reviewer B')
  try {
    const firstSource = first.reviewer.getByRole('textbox', { name: 'MyST source' })
    const secondSource = second.reviewer.getByRole('textbox', { name: 'MyST source' })
    await Promise.all([
      firstSource.press('Meta+End'),
      secondSource.press('Meta+End'),
    ])
    await Promise.all([
      firstSource.pressSequentially(`\n\n${firstText}`),
      secondSource.pressSequentially(`\n\n${secondText}`),
    ])
    for (const sessionPage of [first.reviewer, second.reviewer, page]) {
      await expect(sessionPage.locator('.myst-preview')).toContainText(firstText)
      await expect(sessionPage.locator('.myst-preview')).toContainText(secondText)
    }
    await page.getByTitle('Open comments').click()
    const liveProposal = page.locator('.live-proposal-card')
    await expect(liveProposal).toHaveCount(1)
    await expect(liveProposal).toContainText('Reviewer A')
    await expect(liveProposal).toContainText('Reviewer B')
    await expect(page.getByText('Earlier revision')).toHaveCount(0)
    await liveProposal.getByRole('button', { name: 'Accept all', exact: true }).click()
    await expect(liveProposal).toHaveCount(0)
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test('keeps a live proposal in the mobile reading flow', async ({ browser, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile-'), 'Mobile live review geometry runs on phone projects')
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
    await target.focus()
    await target.press('F2')
    await reviewerPage.getByRole('textbox', { name: 'Edit paragraph' })
      .fill('A long attributed proposal that remains readable and wraps naturally on a narrow phone viewport.')
    await expect(reviewerPage.getByText('Live', { exact: true })).toBeVisible()

    await page.getByTitle('Visual editor').click()
    await expect(page.locator('.myst-preview')).toContainText('A long attributed proposal')
    await page.getByTitle('Open comments').click()
    await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()
    const liveProposal = page.locator('.live-proposal-card')
    await expect(liveProposal).toContainText('Mobile Reviewer')
    const viewport = page.viewportSize()
    const bounds = await liveProposal.boundingBox()
    expect(viewport).not.toBeNull()
    expect(bounds).not.toBeNull()
    if (viewport && bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    }
    await page.getByTitle('Close comments').click()

    await page.getByTitle('Source only').click()
    await expect(page.locator('.cm-suggestion-insertion').filter({
      hasText: 'long attributed proposal',
    })).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport?.width ?? 0)
    await reviewerPage.getByTitle('Finish visual edit').click()
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
    const sampleNote = 'The live preview is generated from the official JavaScript MyST parser.'
    await expect(page.locator('.myst-preview')).toContainText(sampleNote)
    await expect(viewerPage.locator('.myst-preview')).toContainText(sampleNote)
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
