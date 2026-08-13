import { authenticateMaintainer, createRoomName, expect, test } from './support'

test('supports core maintainer authoring and dialog workflows', async ({ page }, testInfo) => {
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)

  const insertTrigger = page.getByTitle('Insert MyST content')
  await insertTrigger.click()
  const insertDialog = page.getByRole('dialog', { name: 'Insert MyST content' })
  await expect(insertDialog).toBeVisible()
  await insertDialog.getByRole('searchbox', { name: 'Search content types' }).fill('note')
  await insertDialog.getByRole('button', { name: /^Note/ }).click()
  await expect(insertDialog).toBeHidden()
  await expect(page.locator('.cm-content')).toContainText(':::{note}')

  await insertTrigger.click()
  await insertDialog.getByRole('searchbox', { name: 'Search content types' }).fill('comment')
  await insertDialog.getByRole('button', { name: /Add comment to selection/ }).click()
  const comments = page.getByRole('complementary', { name: 'Comments' })
  await expect(comments).toBeVisible()
  await expect(comments.getByRole('textbox', { name: 'New comment' })).toBeFocused()
  await page.getByTitle('Close comments').click()

  await page.keyboard.press('Meta+Alt+M')
  await expect(comments).toBeVisible()
  await expect(comments.getByRole('textbox', { name: 'New comment' })).toBeFocused()

  await comments.getByRole('textbox', { name: 'New comment' }).fill('Browser-authored comment')
  await comments.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(comments.locator('.comment')).toContainText('Browser-authored comment')

  await page.reload()
  await expect(page.locator('.sync-status')).toHaveText('Live')
  await expect(page.locator('.cm-content')).toContainText(':::{note}')
  await page.getByTitle('Open comments').click()
  await expect(page.getByRole('complementary', { name: 'Comments' }).locator('.comment'))
    .toContainText('Browser-authored comment')
  await page.getByTitle('Close comments').click()

  await page.getByTitle('Share access').click()
  const shareDialog = page.getByRole('dialog', { name: 'Share manuscript' })
  await shareDialog.getByRole('button', { name: 'Create viewer link' }).click()
  await expect(shareDialog.getByRole('textbox', { name: 'Viewer link' })).toHaveValue(/#view=/)
  await page.keyboard.press('Escape')
  await expect(shareDialog).toBeHidden()

  await page.getByTitle('Source only').click()
  await expect(page.locator('.document-panes')).toHaveClass(/view-source/)
  await page.getByTitle('Visual editor').click()
  await expect(page.locator('.document-panes')).toHaveClass(/view-preview/)
  await page.getByTitle('Split view').click()
  await expect(page.locator('.document-panes')).toHaveClass(/view-split/)

  const helpTrigger = page.getByTitle('How DeMystify works')
  await helpTrigger.click()
  await expect(page.getByRole('dialog', { name: 'How DeMystify works' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'How DeMystify works' })).toBeHidden()
  await expect(helpTrigger).toBeFocused()

  await page.getByTitle('Manage references').click()
  await expect(page.getByRole('dialog', { name: 'Reference library' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Reference library' })).toBeHidden()

  await page.getByTitle('Publication metadata').click()
  await expect(page.getByRole('dialog', { name: 'Publication metadata' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Publication metadata' })).toBeHidden()
})

test('selects, copies, cuts, pastes, and formats Source text', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Clipboard permissions are available in the Chromium project')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await page.getByTitle('Source only').click()
  const source = page.getByRole('textbox', { name: 'MyST source' })
  const phrase = 'A shared'
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  })
  const selectPhrase = async () => {
    await page.getByRole('button', {
      name: 'H1 A shared language for reproducible manuscripts',
    }).click()
    const headingLine = page.locator('.cm-line').filter({
      hasText: '# A shared language for reproducible manuscripts',
    })
    await expect(headingLine).toBeVisible()
    const bounds = await headingLine.evaluate((line, selectedText) => {
      const text = line.textContent ?? ''
      const start = text.indexOf(selectedText)
      if (start < 0) throw new Error(`Could not find ${selectedText} in Source heading`)
      const locate = (offset: number) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let consumed = 0
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const length = node.textContent?.length ?? 0
          if (offset <= consumed + length) return { node, offset: offset - consumed }
          consumed += length
        }
        throw new Error('Could not map Source selection offset')
      }
      const from = locate(start)
      const to = locate(start + selectedText.length)
      const range = document.createRange()
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      const rectangle = range.getBoundingClientRect()
      return {
        left: rectangle.left,
        right: rectangle.right,
        y: rectangle.top + rectangle.height / 2,
      }
    }, phrase)
    await page.mouse.move(bounds.left + 1, bounds.y)
    await page.mouse.down()
    await page.mouse.move(bounds.right - 1, bounds.y, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.cm-selectionBackground')).not.toHaveCount(0)
  }

  await selectPhrase()
  await source.press('Meta+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(phrase)

  await source.press('Meta+x')
  await expect(source).not.toContainText('# A shared language')
  await source.press('Meta+z')
  await expect(source).toContainText('# A shared language')

  await source.focus()
  await source.press('Meta+End')
  await source.press('Meta+v')
  await expect.poll(async () => ((await source.textContent())?.match(/A shared/g) ?? []).length)
    .toBe(2)
  await source.press('Meta+z')

  await selectPhrase()
  await source.press('Meta+Alt+M')
  const comments = page.getByRole('complementary', { name: 'Comments' })
  await comments.getByRole('textbox', { name: 'New comment' }).fill('Selected phrase comment')
  await comments.getByRole('button', { name: 'Comment', exact: true }).click()
  await page.getByTitle('Close comments').click()
  await expect(page.locator('.cm-comment-anchor').filter({ hasText: phrase })).toHaveCount(1)

  await selectPhrase()
  await page.getByTitle('More authoring tools').click()
  await page.getByRole('menu', { name: 'More authoring tools' })
    .getByRole('menuitem', { name: 'Bold' })
    .click()
  await expect(source).toContainText('# **A shared** language')
})

test('preserves rendered text selection before entering visual editing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'Mouse selection runs in desktop engines')
  await page.setViewportSize({ width: 1000, height: 760 })
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await page.getByTitle('Visual editor').click()

  const paragraph = page.locator('.myst-preview p.myst-editable-block').first()
  await expect(paragraph).toBeVisible()
  const bounds = await paragraph.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return

  const y = bounds.y + Math.min(14, bounds.height / 2)
  await page.mouse.move(bounds.x + 10, y)
  await page.mouse.down()
  await page.mouse.move(Math.min(bounds.x + 150, bounds.x + bounds.width - 10), y, {
    steps: 8,
  })
  await page.mouse.up()

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .not.toBe('')
  await expect(page.locator('.visual-prosemirror')).toHaveCount(0)

  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await paragraph.click()
  await expect(page.getByRole('textbox', { name: 'Edit paragraph' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Edit paragraph' })).toBeHidden()
})

test('keeps mobile Escape ordering and focus deterministic', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)

  const commentsTrigger = page.getByTitle('Open comments')
  const comments = page.getByRole('complementary', { name: 'Comments' })
  const sidebarToggle = page.locator('button[aria-controls="project-files-sidebar"]')
  const sidebar = page.getByRole('complementary', { name: 'Project files' })

  await commentsTrigger.click()
  await expect(comments).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(comments).toBeHidden()
  await expect(commentsTrigger).toBeFocused()

  await commentsTrigger.click()
  await sidebarToggle.click()
  await expect(sidebar).toHaveClass(/open/)
  await page.keyboard.press('Escape')
  await expect(sidebar).not.toHaveClass(/open/)
  await expect(comments).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(comments).toBeHidden()

  await sidebarToggle.click()
  await expect(sidebar).toHaveClass(/open/)
  const helpTrigger = page.getByTitle('How DeMystify works')
  await helpTrigger.click()
  await expect(page.getByRole('dialog', { name: 'How DeMystify works' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'How DeMystify works' })).toBeHidden()
  await expect(sidebar).toHaveClass(/open/)
  await page.keyboard.press('Escape')
  await expect(sidebar).not.toHaveClass(/open/)
})
