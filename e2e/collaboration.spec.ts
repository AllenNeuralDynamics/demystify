import { readFile } from 'node:fs/promises'
import type { WebSocketRoute } from '@playwright/test'
import * as Y from 'yjs'
import { resolveCommentAnchor } from '../src/lib/commentAnchors'
import type { SharedComment } from '../src/hooks/useCollaboration'
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

test('continuous Visual and Source editors merge same-paragraph edits without losing the Visual caret', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Mixed-mode collaboration uses desktop browser engines')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const original = '# Shared draft\n\nA shared paragraph.\n\nAnother paragraph.\n'
  await page.getByRole('textbox', { name: 'MyST source' }).fill(original)
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const sourcePage = await context.newPage()
  try {
    await authenticateMaintainer(sourcePage, roomName, testInfo)
    await expect(sourcePage.getByRole('textbox', { name: 'MyST source' })).toContainText('A shared paragraph.')
    await page.getByTitle('Visual editor', { exact: true }).click()
    const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
    await formatted.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' Visual one.')
    const source = sourcePage.getByRole('textbox', { name: 'MyST source' })
    await expect(source).toContainText('A shared paragraph. Visual one.')
    await source.press('ControlOrMeta+Home')
    await source.press('ArrowDown')
    await source.press('ArrowDown')
    await source.press('ArrowRight')
    await source.press('ArrowRight')
    await sourcePage.keyboard.insertText('Source-edited ')
    await expect(formatted.locator('p').first()).toContainText('A Source-edited shared paragraph. Visual one.')
    await expect(formatted.locator('.visual-remote-caret')).toHaveCount(1)
    await expect(formatted).toBeFocused()
    await page.keyboard.insertText(' Visual two.')
    await expect(formatted.locator('p').first()).toHaveText('A Source-edited shared paragraph. Visual one. Visual two.')
    await expect(source).toContainText('A Source-edited shared paragraph. Visual one. Visual two.')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(source).toContainText('A Source-edited shared paragraph.')
    await expect(source).not.toContainText('Visual two.')
    await page.getByTitle('Source only').click()
    const sourceWithoutPresence = await page.getByRole('textbox', { name: 'MyST source' }).evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.cm-ySelectionCaret').forEach((cursor) => cursor.remove())
      return copy.textContent
    })
    expect(sourceWithoutPresence).toContain('A Source-edited shared paragraph.')
  } finally { await context.close() }
})

test('two continuous Visual editors can keep editing the same paragraph', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Two-editor collaboration uses desktop browser engines')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await page.getByRole('textbox', { name: 'MyST source' }).fill('# Draft\n\nShared paragraph.\n')
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const second = await context.newPage()
  try {
    await authenticateMaintainer(second, roomName, testInfo)
    await page.getByTitle('Visual editor', { exact: true }).click()
    await second.getByTitle('Visual editor', { exact: true }).click()
    const firstEditor = page.getByRole('textbox', { name: 'Formatted manuscript' })
    const secondEditor = second.getByRole('textbox', { name: 'Formatted manuscript' })
    await firstEditor.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' First.')
    await expect(secondEditor).toContainText('Shared paragraph. First.')
    await secondEditor.locator('p').first().click()
    await second.keyboard.press('End')
    await second.keyboard.insertText(' Second.')
    await expect(firstEditor).toContainText('Shared paragraph. First. Second.')
    await expect(firstEditor).toBeFocused()
    await page.keyboard.insertText(' Continued.')
    await expect(secondEditor).toContainText('Continued.')
    expect(await firstEditor.innerText()).toBe(await secondEditor.innerText())
  } finally { await context.close() }
})

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
  await paragraph.fill(replacement)
  await expect(paragraph).toContainText(replacement)
  await expect(page.locator('.visual-draft-status')).toHaveCount(0)
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
    const caption = viewerPage.locator('.myst-preview figcaption').first()
    await expect(caption).toHaveCSS('font-size', '13px')
    expect(await caption.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight)))
      .toBeCloseTo(20.8, 2)
    await expect(caption).toHaveCSS('color', 'rgb(32, 33, 36)')
    await expect(caption).toHaveCSS('white-space', 'normal')
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

test('suggestion participant submits individually accepted or rejected Visual edits', async ({ browser, page }, testInfo) => {
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
    await expect(collaboratorPage.getByText('Suggesting', { exact: true }).last()).toBeVisible()
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
    await paragraph.click()
    const visualEditor = collaboratorPage.getByRole('textbox', { name: 'Formatted manuscript' })
    await collaboratorPage.getByTitle('Cite a paper').click()
    await expect(collaboratorPage.getByRole('dialog', { name: 'Cite a paper' })
      .getByText(/Choose from this manuscript's library/)).toBeVisible()
    await collaboratorPage.keyboard.press('Escape')
    await expect(visualEditor).toBeVisible()
    await paragraph.fill('A reviewer-proposed sentence.')
    await expect(collaboratorPage.locator('.visual-draft-status')).toHaveCount(0)

    await expect(page.locator('.sync-status')).toHaveText('Live')
    await expect(page.locator('.myst-preview .myst-suggestion-insertion'))
      .toContainText('reviewer-proposed sentence.')
    const insertion = page.locator('.myst-preview .myst-suggestion-insertion')
    await expect(insertion).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(insertion).toHaveCSS('color', 'rgb(32, 33, 36)')
    await expect(insertion).toHaveCSS('border-bottom-color', 'rgb(166, 75, 54)')
    await expect(page.getByRole('button', { name: 'Editing' })).toBeVisible()
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await page.getByRole('menu', { name: 'Tools menu' })
      .getByRole('menuitem', { name: 'Citations' })
      .click()
    await expect(page.getByRole('dialog', { name: 'Cite a paper' })
      .getByRole('textbox', { name: 'Search papers' }))
      .toHaveAttribute('placeholder', 'Title, author, year, DOI, or PMID')
    await page.keyboard.press('Escape')
    await page.getByTitle('Open comments').click()
    const acceptedSuggestion = page.locator('.comment.suggestion-thread').filter({
      hasText: 'reviewer-proposed sentence.',
    })
    await expect(acceptedSuggestion).toContainText('E2E Reviewer')
    await acceptedSuggestion.click()
    await expect(acceptedSuggestion).toHaveAttribute('aria-expanded', 'true')
    await expect(acceptedSuggestion).toBeFocused()
    await expect(page.locator('.myst-suggestion-option.is-active')).toHaveCount(1)
    await acceptedSuggestion.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(acceptedSuggestion).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('resolved')
    const resolvedAcceptedSuggestion = page.locator('.comment.suggestion-thread').filter({
      hasText: 'reviewer-proposed sentence.',
    })
    await expect(resolvedAcceptedSuggestion.locator('.suggestion-summary'))
      .toContainText('Accepted')
    await expect(page.locator('.myst-preview')).toContainText('A reviewer-proposed sentence.')
    await expect(page.locator('.myst-preview .myst-suggestion-insertion')).toHaveCount(0)
    await expect(page.getByTitle('Save snapshot to GitHub')).toBeEnabled()

    await replaceFirstVisualParagraph(
      collaboratorPage,
      'A reviewer-proposed sentence.',
      'A proposal that should be rejected.',
    )
    await expect(page.locator('.myst-preview .myst-suggestion-insertion'))
      .toContainText('proposal that should be rejected')
    await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('open')
    const rejectedSuggestion = page.locator('.comment.suggestion-thread').filter({
      hasText: 'proposal that should be rejected',
    })
    await rejectedSuggestion.click()
    await rejectedSuggestion.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(rejectedSuggestion).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('resolved')
    await expect(page.locator('.comment.suggestion-thread').filter({
      hasText: 'proposal that should be rejected',
    }).locator('.suggestion-summary')).toContainText('Rejected')
    await collaboratorPage.getByTitle('Source only').click()
    await expect(collaboratorPage.locator('.cm-content')).toContainText('A reviewer-proposed sentence.')
    await expect(collaboratorPage.locator('.cm-content'))
      .not.toContainText('A proposal that should be rejected.')
  } finally {
    await collaboratorContext.close()
  }
})

test('guest object edits autosave as suggestions when clicking away', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Guest object suggestion integration runs once')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  await source.focus()
  await source.press('ControlOrMeta+a')
  const acceptedSource = '# Guest equations\n\n$$\na^2\n$$\n\n$$\nb^3\n$$\n\nAfter.'
  await page.keyboard.insertText(acceptedSource)
  await expect(page.locator('.document-title')).toHaveText('Guest equations')
  const token = await createShareToken(page, roomName, 'collaborator')
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const guest = await context.newPage()
  try {
    await guest.addInitScript(() => localStorage.setItem('demystify.profile', JSON.stringify({
      id: 'formula-reviewer', name: 'Formula Reviewer', color: '#315f9b', colorLight: '#e8f0fe',
    })))
    await guest.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(guest.locator('.sync-status')).toHaveText('Suggesting')
    await guest.getByTitle('Visual editor', { exact: true }).click()
    const formatted = guest.getByRole('textbox', { name: 'Formatted manuscript' })
    const equations = formatted.getByRole('button', { name: 'Edit equation', exact: true })
    await expect(equations).toHaveCount(2)
    await equations.first().click()
    const equation = guest.getByRole('textbox', { name: 'LaTeX equation', exact: true })
    await equation.fill('a^5')
    await equations.last().click()
    await expect(equation).toHaveValue('b^3')
    await equation.fill('b^6')
    await formatted.locator('p').filter({ hasText: /^After\.$/ }).click()
    await expect(equation).toHaveCount(0)
    await expect(guest.locator('.visual-draft-status')).toHaveCount(0)
    await expect(formatted.locator('.math-display annotation')).toHaveText(['a^5', 'b^6'])
    await page.getByTitle('Open comments', { exact: true }).click()
    await expect(page.locator('.comment.suggestion-thread').first()).toContainText('Formula Reviewer')
    const canonical = await page.evaluate(() => {
      type EditorFiber = { memoizedProps?: { sharedText?: Y.Text }; return?: EditorFiber | null }
      let element = document.querySelector('.cm-content')
      while (element) {
        const key = Object.keys(element).find((property) => property.startsWith('__reactFiber$'))
        let fiber = key ? (element as unknown as Record<string, EditorFiber>)[key] : null
        for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return ?? null) {
          const document = fiber.memoizedProps?.sharedText?.doc
          if (document) return document.getText('content').toString()
        }
        element = element.parentElement
      }
      throw new Error('Accepted document could not be found')
    })
    expect(canonical).toBe(acceptedSource)
  } finally {
    await context.close()
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

test('two Source reviewers keep independent attributed suggestions', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Independent suggestion decisions run once')
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
    await expect(reviewer.locator('.sync-status')).toHaveText('Suggesting')
    return { context, reviewer }
  }
  const first = await openReviewer('Source Reviewer')
  const second = await openReviewer('Methods Reviewer')
  const original = 'A manuscript should be as inspectable as the analysis behind it.'
  const replacement = 'A manuscript should keep every source-level proposal inspectable before acceptance.'
  const remoteOriginal = 'The repository remains the durable record. Live updates are collected into deliberate snapshots, committed to a branch, and reviewed through a pull request.'
  const remoteReplacement = 'The repository remains the durable record while collaborators review source-level proposals.'

  try {
    const reviewerSource = first.reviewer.getByRole('textbox', { name: 'MyST source' })
    await expect(reviewerSource).toContainText(original)
    const expectedCanonical = sampleManuscript.replace(original, replacement)
    await reviewerSource.fill(expectedCanonical)

    await expect(first.reviewer.getByText('Saving suggestion...')).toBeVisible()
    await expect(second.reviewer.locator('.myst-preview')).toContainText(replacement)
    const secondSource = second.reviewer.getByRole('textbox', { name: 'MyST source' })
    const secondDraft = expectedCanonical.replace(remoteOriginal, remoteReplacement)
    await secondSource.fill(secondDraft)
    await expect(page.locator('.sync-status')).toHaveText('Live')
    await expect(page.locator('.myst-preview .myst-suggestion-insertion'))
      .toContainText('keep every source-level proposal inspectable')
    const sourceInsertion = page.locator('.cm-suggestion-insertion').first()
    await expect(sourceInsertion).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(sourceInsertion).toHaveCSS('color', 'rgb(32, 33, 36)')
    await expect(sourceInsertion).toHaveCSS('border-bottom-color', 'rgb(166, 75, 54)')

    await page.getByRole('button', {
      name: /Suggested insertion by Source Reviewer/,
    }).first().click()
    await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()
    const firstSuggestion = page.locator('.comment.suggestion-thread').filter({
      has: page.getByText('Source Reviewer', { exact: true }),
    })
    const secondSuggestion = page.locator('.comment.suggestion-thread').filter({
      has: page.getByText('Methods Reviewer', { exact: true }),
    })
    await expect(firstSuggestion).toContainText('Source Reviewer')
    await expect(secondSuggestion).toContainText('Methods Reviewer')
    await expect(firstSuggestion).toHaveAttribute('aria-expanded', 'true')
    await expect(firstSuggestion).toBeFocused()
    await expect(page.locator('.myst-suggestion-option.is-active')).toHaveCount(1)
    await firstSuggestion.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(firstSuggestion).toHaveCount(0)
    await expect(secondSuggestion.locator('.suggestion-summary')).toContainText('Replace:')
    await secondSuggestion.focus()
    await secondSuggestion.press('Enter')
    await expect(secondSuggestion).toHaveAttribute('aria-expanded', 'true')
    await secondSuggestion.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(secondSuggestion).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('resolved')
    await expect(page.locator('.comment.suggestion-thread').filter({
      has: page.getByText('Source Reviewer', { exact: true }),
    }).locator('.suggestion-summary')).toContainText('Accepted')
    await expect(page.locator('.comment.suggestion-thread').filter({
      has: page.getByText('Methods Reviewer', { exact: true }),
    }).locator('.suggestion-summary')).toContainText('Rejected')
    await expect(page.locator('.myst-preview')).toContainText(replacement)
    await expect(page.locator('.myst-preview')).not.toContainText(remoteReplacement)
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test('only authors edit comments and replies while everyone can reply', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Comment ownership runs once')
  test.setTimeout(60_000)
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
    await first.reviewer.getByTitle('Add comment to selection').click()
    await first.reviewer.getByRole('textbox', { name: 'New comment' }).fill('Original comment text.')
    await first.reviewer.getByRole('button', { name: 'Comment', exact: true }).click()
    const firstComment = first.reviewer.locator('.comment').filter({
      has: first.reviewer.getByText('Reviewer A', { exact: true }),
    })
    const secondView = second.reviewer.locator('.comment').filter({
      has: second.reviewer.getByText('Reviewer A', { exact: true }),
    })
    await expect(firstComment).toBeVisible()
    await expect(secondView).toBeVisible()
    await page.getByTitle('Open comments').click()
    const maintainerView = page.locator('.comment').filter({
      has: page.getByText('Reviewer A', { exact: true }),
    })
    await expect(firstComment.getByRole('button', { name: 'Comment actions', exact: true })).toBeVisible()
    await expect(secondView.getByRole('button', { name: 'Comment actions', exact: true })).toHaveCount(0)
    await expect(maintainerView.getByRole('button', { name: 'Comment actions', exact: true })).toHaveCount(0)

    await firstComment.getByRole('button', { name: 'Comment actions', exact: true }).click()
    await firstComment.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    const commentEditor = firstComment.getByRole('textbox', { name: 'Edit comment by Reviewer A' })
    await commentEditor.fill('Author-edited comment text.')
    await first.reviewer.keyboard.press('Meta+Enter')
    await expect(commentEditor).toHaveCount(0)
    await expect(secondView).toContainText('Author-edited comment text.')
    await expect(secondView).toContainText('edited')

    await secondView.click()
    await expect(secondView).toHaveAttribute('aria-expanded', 'true')
    await secondView.getByRole('combobox', { name: /Reply to comment by Reviewer A/ })
      .fill('Reply from Reviewer B.')
    await secondView.getByRole('button', { name: 'Reply', exact: true }).click()
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

    const mentionReply = secondView.getByRole('combobox', {
      name: /Reply to comment by Reviewer A/,
    })
    await mentionReply.fill('@e2e')
    const maintainerOption = second.reviewer.getByRole('option', { name: /Integration Test/ })
    await expect(maintainerOption).toBeVisible()
    const mentionLayout = await maintainerOption.evaluate((option) => {
      const avatar = option.querySelector<HTMLElement>('.mention-option-avatar')
      const identity = option.querySelector<HTMLElement>('.mention-option-identity')
      if (!avatar || !identity) throw new Error('Mention option layout is incomplete')
      const avatarBounds = avatar.getBoundingClientRect()
      const identityBounds = identity.getBoundingClientRect()
      const optionBounds = option.getBoundingClientRect()
      return {
        avatarRight: avatarBounds.right,
        identityLeft: identityBounds.left,
        identityRight: identityBounds.right,
        identityWidth: identityBounds.width,
        optionRight: optionBounds.right,
      }
    })
    expect(mentionLayout.identityLeft).toBeGreaterThanOrEqual(mentionLayout.avatarRight)
    expect(mentionLayout.identityWidth).toBeGreaterThan(100)
    expect(mentionLayout.identityRight).toBeLessThanOrEqual(mentionLayout.optionRight)
    await mentionReply.press('Enter')
    await expect(mentionReply).toHaveValue(/^@e2e-editor-\d+ $/)
    await mentionReply.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    }))
    await mentionReply.pressSequentially('please review this.')
    await secondView.getByRole('button', { name: 'Reply', exact: true }).click()

    await maintainerView.click()
    await expect(maintainerView).toContainText(/@e2e-editor-\d+ please review this\./)
    await expect(secondView.getByText('Queued for maintainer', { exact: true })).toHaveCount(1)
    await page.getByTitle('Search and filter comments').click()
    await page.getByRole('button', { name: 'For you', exact: true }).click()
    await expect(page.getByRole('button', { name: 'For you', exact: true }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect(maintainerView).toBeVisible()
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test('keeps an attributed suggestion in the mobile reading flow', async ({ browser, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile-'), 'Mobile review geometry runs on phone projects')
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
    await target.fill('A long attributed proposal that remains readable and wraps naturally on a narrow phone viewport.')
    await expect(reviewerPage.locator('.visual-draft-status')).toHaveCount(0)

    await page.getByTitle('Visual editor').click()
    await expect(page.locator('.myst-preview .myst-suggestion-insertion')).toContainText('long attributed proposal')
    await page.getByTitle('Open comments').click()
    await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()
    const suggestion = page.locator('.comment.suggestion-thread').filter({
      has: page.getByText('Mobile Reviewer', { exact: true }),
    })
    await expect(suggestion).toContainText('Mobile Reviewer')
    await expect(suggestion.locator('.suggestion-summary')).toContainText('Replace:')
    await expect(suggestion).not.toContainText('PENDING')
    const viewport = page.viewportSize()
    const bounds = await suggestion.boundingBox()
    expect(viewport).not.toBeNull()
    expect(bounds).not.toBeNull()
    if (viewport && bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
      expect(bounds.height).toBeLessThan(130)
    }
    await suggestion.click()
    await suggestion.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    }))
    const mobileReply = suggestion.getByRole('combobox', {
      name: /Reply to comment by Mobile Reviewer/,
    })
    await mobileReply.fill('@Mobile')
    const mentionOptions = page.getByRole('listbox')
    await expect(mentionOptions).toBeVisible()
    const mentionBounds = await mentionOptions.boundingBox()
    const replyBounds = await mobileReply.boundingBox()
    expect(mentionBounds).not.toBeNull()
    expect(replyBounds).not.toBeNull()
    if (viewport && mentionBounds && replyBounds) {
      expect(mentionBounds.x).toBeGreaterThanOrEqual(0)
      expect(mentionBounds.x + mentionBounds.width).toBeLessThanOrEqual(viewport.width)
      expect(mentionBounds.y).toBeGreaterThanOrEqual(replyBounds.y + replyBounds.height)
      expect(mentionBounds.y + mentionBounds.height).toBeLessThanOrEqual(viewport.height)
    }
    await mobileReply.fill('')
    await page.getByTitle('Close comments').click()

    await page.getByTitle('Source only').click()
    await expect(page.getByRole('button', {
      name: /Suggested insertion by Mobile Reviewer/,
    }).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport?.width ?? 0)
  } finally {
    await reviewerContext.close()
  }
})

test('protects a Source draft before the autosave debounce sends it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Buffered draft protection runs once')
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  await page.getByRole('button', { name: 'Editing', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Suggesting', exact: true }).click()
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 1_000))
  const source = page.getByRole('textbox', { name: 'MyST source' })
  const current = await source.innerText()
  await source.fill(current.replace('A manuscript should be', 'A buffered source draft must be'))
  await expect(page.getByRole('status', { name: 'Server save status' }))
    .toHaveAttribute('data-save-state', 'unconfirmed')
  const warned = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(warned).toBe(true)
  await page.clock.resume()
  await expect(page.getByRole('status', { name: 'Server save status' }))
    .toHaveAttribute('data-save-state', 'saved')
})

test('protects and exports a Visual draft before automatic suggestion submission', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Buffered Visual recovery runs once')
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  await page.getByRole('button', { name: 'Editing', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Suggesting', exact: true }).click()
  await page.getByTitle('Visual editor', { exact: true }).click()
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 1_000))
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  await formatted.locator('p').first().fill('A buffered Visual draft remains recoverable.')
  await expect(page.getByRole('status', { name: 'Server save status' }))
    .toHaveAttribute('data-save-state', 'unconfirmed')
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)
  const downloadPromise = page.waitForEvent('download')
  await page.evaluate(async (modulePath) => {
    const recovery = await import(modulePath)
    return recovery.downloadCurrentRoomRecovery()
  }, process.env.DEMYSTIFY_E2E_BUILD === '1' ? '/recovery-export.js' : '/src/recovery.ts')
  const download = await downloadPromise
  const path = await download.path()
  expect(path).not.toBeNull()
  const backup = JSON.parse(await readFile(path!, 'utf8'))
  expect(backup.localDrafts.visualDrafts).toEqual(expect.arrayContaining([
    expect.objectContaining({ filePath: 'manuscript.md',
      source: expect.stringContaining('A buffered Visual draft remains recoverable.'), suggestionMode: true }),
  ]))
  await page.clock.resume()
  await expect(page.getByRole('status', { name: 'Server save status' }))
    .toHaveAttribute('data-save-state', 'saved')
  await expect(page.locator('.visual-draft-status')).toHaveCount(0)
})

test('does not claim saved when a live socket stops delivering persistence receipts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Covered by desktop engines')
  test.setTimeout(60_000)
  let dropReceipts = false
  await page.routeWebSocket(/\/collaboration\//, (socket) => {
    const server = socket.connectToServer()
    server.onMessage((message) => {
      const bytes = typeof message === 'string' ? null : new Uint8Array(message)
      if (dropReceipts && bytes?.[0] === 4) return
      socket.send(message)
    })
  })
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await page.getByTitle('Open comments').click()
  dropReceipts = true
  await page.getByTitle('Visual editor', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Formatted manuscript' }).locator('p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' Visual save needs a receipt.')
  await page.getByTitle('Add comment to selection').click()
  await page.getByRole('textbox', { name: 'New comment' }).fill('Server save needs a receipt')
  await page.locator('.comments-panel').getByRole('button', { name: 'Comment', exact: true }).click()
  const saveStatus = page.getByRole('status', { name: 'Server save status' })
  await expect(saveStatus).toHaveAttribute('data-save-state', 'unconfirmed')
  await expect(page.locator('.sync-status')).toHaveText('Live')
  await expect(saveStatus).toHaveAttribute('data-save-state', 'error', { timeout: 15_000 })
  await expect(page.locator('.connection-warning')).toContainText('No server save receipt')
  const warned = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(warned).toBe(true)
  dropReceipts = false
  await expect(saveStatus).toHaveAttribute('data-save-state', 'saved', { timeout: 10_000 })
  await expect(page.locator('.connection-warning')).toHaveCount(0)
  await expect(page.locator('.comment')).toContainText('Server save needs a receipt')
  await expect(page.getByRole('textbox', { name: 'Formatted manuscript' }))
    .toContainText('Visual save needs a receipt.')
})

test('exports 24 unsent comments from an existing disconnected tab without reloading it', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Recovery download runs once')
  test.setTimeout(90_000)
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const reviewer = await context.newPage()
  let disconnected = false
  let activeSocket: WebSocketRoute | null = null
  await reviewer.routeWebSocket(/\/collaboration\//, async (socket) => {
    if (disconnected) {
      await socket.close({ code: 1013, reason: 'Recovery test interruption' })
      return
    }
    activeSocket = socket
    socket.connectToServer()
  })
  try {
    await reviewer.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(reviewer.locator('.sync-status')).toHaveText('Suggesting')
    await reviewer.getByTitle('Open comments').click()
    disconnected = true
    await activeSocket?.close({ code: 1013, reason: 'Recovery test interruption' })
    await expect(reviewer.locator('.sync-status')).not.toHaveText('Suggesting')
    for (let index = 0; index < 24; index++) {
      await reviewer.getByTitle('Add comment to selection').click()
      await reviewer.getByRole('textbox', { name: 'New comment' }).fill(`Unsent review ${index}`)
      await reviewer.locator('.comments-panel').getByRole('button', { name: 'Comment', exact: true }).click()
    }
    await expect(reviewer.locator('.comments-heading')).toContainText('24 open')
    await expect(reviewer.locator('.connection-warning')).toContainText('Server save not confirmed')
    await expect(reviewer.getByTitle('Download recovery file', { exact: true })).toBeVisible()
    await page.getByTitle('Open comments').click()
    await expect(page.locator('.comments-heading')).toContainText('0 open')

    const pageStartedAt = await reviewer.evaluate(() => performance.timeOrigin)
    const [download, summary] = await Promise.all([
      reviewer.waitForEvent('download'),
      reviewer.evaluate(async (modulePath) => {
        const moduleUrl = new URL(modulePath, window.location.href).href
        const exporter = await import(moduleUrl)
        return exporter.downloadCurrentRoomRecovery()
      }, process.env.DEMYSTIFY_E2E_BUILD === '1' ? '/recovery-export.js' : '/dist/recovery-export.js'),
    ])
    const filePath = await download.path()
    expect(filePath).not.toBeNull()
    const backup = JSON.parse(await readFile(filePath!, 'utf8'))
    expect(summary.comments).toBe(24)
    expect(backup.roomName).toBe(roomName)
    expect(backup.connectionAtExport.connected).toBe(false)
    expect(Object.keys(backup.document.comments)).toHaveLength(24)
    expect(backup.localDrafts.source).toContain('A shared language for reproducible manuscripts')
    expect(await reviewer.evaluate(() => performance.timeOrigin)).toBe(pageStartedAt)
    await expect(reviewer.locator('.comments-heading')).toContainText('24 open')
    await expect(page.locator('.comments-heading')).toContainText('0 open')

    const restored = new Y.Doc()
    try {
      Y.applyUpdate(restored, new Uint8Array(Buffer.from(backup.yjsStateBase64, 'base64')))
      const comments = restored.getMap<SharedComment>('comments')
      expect(comments.size).toBe(24)
      for (const comment of comments.values()) {
        expect(comment.anchor).toBeDefined()
        const target = comment.anchorTarget === 'working' ? 'workingContent' : 'content'
        const range = resolveCommentAnchor(restored, restored.getText(target), comment.anchor!)
        expect(range?.orphaned).toBe(false)
        expect(range?.quote).toBe(comment.anchor?.quote)
      }
    } finally {
      restored.destroy()
    }

    reviewer.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload')
      await dialog.accept()
    })
    await reviewer.reload()
    await expect(reviewer.locator('.connection-warning')).toContainText('Browser recovery available')
    await reviewer.getByTitle('Open comments').click()
    await expect(reviewer.locator('.comments-heading')).toContainText('24 open')
    await expect(page.locator('.comments-heading')).toContainText('0 open')

    await reviewer.setViewportSize({ width: 390, height: 844 })
    const warning = await reviewer.locator('.connection-warning').boundingBox()
    const panel = await reviewer.locator('.comments-panel').boundingBox()
    expect(warning).not.toBeNull()
    expect(panel).not.toBeNull()
    expect(panel!.y).toBeGreaterThanOrEqual(warning!.y + warning!.height)
    expect(await reviewer.locator('.connection-warning').evaluate(element =>
      element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth,
    )).toBe(true)

    disconnected = false
    await reviewer.getByTitle('Reconnect collaboration').click()
    await expect(reviewer.locator('.sync-status')).toHaveText('Suggesting', { timeout: 20_000 })
    await expect(reviewer.locator('.connection-warning')).toHaveCount(0)
    await expect(page.locator('.comments-heading')).toContainText('24 open', { timeout: 20_000 })
  } finally {
    await context.close()
  }
})

test('queues local edits while disconnected and converges after reconnecting', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Network recovery runs once in Chromium')
  test.setTimeout(60_000)
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
    await page.getByTitle('Visual editor', { exact: true }).click()

    interruptCollaboration = true
    await activeSocket?.close({ code: 1013, reason: 'E2E network interruption' })
    await expect(page.locator('.sync-status')).not.toHaveText('Live')
    await page.getByRole('textbox', { name: 'Formatted manuscript' }).locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' Offline Visual edit.')
    await expect(page.locator('.myst-preview')).toContainText('Offline Visual edit.')
    await expect(viewerPage.locator('.myst-preview')).not.toContainText('Offline Visual edit.')
    await insertNote(page)
    await expect.poll(() => noteCount(page)).toBe(initialNoteCount + 1)
    await expect.poll(() => noteCount(viewerPage)).toBe(initialNoteCount)
    page.once('dialog', (dialog) => dialog.accept())
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'MyST source' })).toContainText('Offline Visual edit.')
    await page.getByTitle('Visual editor', { exact: true }).click()
    await expect.poll(() => noteCount(page)).toBe(initialNoteCount + 1)

    interruptCollaboration = false
    await expect(page.locator('.sync-status')).toHaveText('Live', { timeout: 15_000 })
    await expect.poll(() => noteCount(viewerPage), { timeout: 15_000 }).toBe(initialNoteCount + 1)
    await expect(viewerPage.locator('.myst-preview')).toContainText('Offline Visual edit.')
    await expect(page.getByRole('status', { name: 'Server save status' }))
      .toHaveAttribute('data-save-state', 'saved')
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
