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

  await page.getByTitle('Open comments').click()
  const comments = page.getByRole('complementary', { name: 'Comments' })
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
