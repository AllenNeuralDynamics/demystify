import { authenticateMaintainer, createRoomName, expect, test } from './support'

const viewportMatrix = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 560, height: 375 },
  { width: 667, height: 320 },
  { width: 820, height: 560 },
  { width: 821, height: 560 },
  { width: 900, height: 560 },
  { width: 972, height: 560 },
  { width: 973, height: 560 },
  { width: 1180, height: 600 },
  { width: 1400, height: 900 },
  { width: 1600, height: 500 },
]

test('critical application geometry remains inside every supported viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Geometry matrix runs once in Chromium')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)

  for (const viewport of viewportMatrix) {
    await page.setViewportSize(viewport)
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const bounds = document.querySelector(selector)?.getBoundingClientRect()
        return bounds
          ? { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height }
          : null
      }
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        topbar: rect('.topbar'),
        toolbar: rect('.editor-toolbar'),
        workspace: rect('.workspace'),
        commentsTrigger: rect('button.comments-trigger'),
        viewSwitcher: rect('.view-switcher'),
      }
    })

    expect(geometry.documentWidth, `${viewport.width}x${viewport.height} document overflow`).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    for (const [name, bounds] of Object.entries({
      topbar: geometry.topbar,
      toolbar: geometry.toolbar,
      workspace: geometry.workspace,
      commentsTrigger: geometry.commentsTrigger,
    })) {
      expect(bounds, `${viewport.width}x${viewport.height} ${name} missing`).not.toBeNull()
      expect(bounds?.width, `${viewport.width}x${viewport.height} ${name} width`).toBeGreaterThan(0)
      expect(bounds?.height, `${viewport.width}x${viewport.height} ${name} height`).toBeGreaterThan(0)
      expect(bounds?.left, `${viewport.width}x${viewport.height} ${name} left edge`).toBeGreaterThanOrEqual(-1)
      expect(bounds?.right, `${viewport.width}x${viewport.height} ${name} right edge`).toBeLessThanOrEqual(viewport.width + 1)
    }
    expect(
      geometry.commentsTrigger && geometry.viewSwitcher &&
      Math.max(geometry.commentsTrigger.left, geometry.viewSwitcher.left) <
        Math.min(geometry.commentsTrigger.right, geometry.viewSwitcher.right) &&
      Math.max(geometry.commentsTrigger.top, geometry.viewSwitcher.top) <
        Math.min(geometry.commentsTrigger.bottom, geometry.viewSwitcher.bottom),
      `${viewport.width}x${viewport.height} comments/view switcher overlap`,
    ).toBe(false)
  }
})

test('figure captions use the figure width and Visual comments stay beside the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Caption and comment geometry runs once')
  await page.setViewportSize({ width: 1600, height: 960 })
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const wrappedCaption = 'A detailed caption explains the panels.\n'.repeat(16).trim()
  await page.getByRole('textbox', { name: 'MyST source' }).fill([
    '# Caption geometry', '', ':::{figure} /sample-figure.svg', ':name: fig-plain', '',
    'A detailed figure caption describing each panel and the measurements. '.repeat(12), ':::', '',
    ':::{figure} /sample-figure.svg', ':name: fig-wrapped', '',
    `**Panel A.** [Panel reference](#fig-plain). ${wrappedCaption}`, ':::', '',
  ].join('\n'))
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  await expect(formatted.locator('#fig-wrapped figcaption')).toBeVisible()
  const captions = formatted.locator('figure figcaption p')
  await expect(captions).toHaveCount(2)
  const legend = formatted.locator('figure figcaption').first()
  await expect(legend).toHaveCSS('font-size', '13px')
  expect(await legend.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight)))
    .toBeCloseTo(20.8, 2)
  await expect(legend).toHaveCSS('color', 'rgb(32, 33, 36)')
  await expect(legend).toHaveCSS('white-space', 'normal')
  for (const width of [1600, 2560, 390]) {
    await page.setViewportSize({ width, height: 960 })
    for (const caption of await captions.all()) {
      const bounds = await caption.evaluate((element) => {
        const figure = element.closest('figure')!.getBoundingClientRect()
        const text = element.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(element)
        const lineWidth = Math.max(...Array.from(range.getClientRects()).map((rect) => rect.width))
        return { figureWidth: figure.width, captionWidth: text.width, left: text.left - figure.left,
          lineWidth, overflow: element.scrollWidth > element.clientWidth }
      })
      expect(Math.abs(bounds.captionWidth - bounds.figureWidth)).toBeLessThanOrEqual(2)
      expect(Math.abs(bounds.left)).toBeLessThanOrEqual(2)
      expect(bounds.lineWidth).toBeGreaterThan(bounds.figureWidth * 0.85)
      expect(bounds.overflow).toBe(false)
    }
  }
  for (const width of [1600, 2560]) {
    await page.setViewportSize({ width, height: 960 })
    const originalWidth = await formatted.evaluate((element) => element.getBoundingClientRect().width)
    await page.getByTitle('Open comments', { exact: true }).click()
    const layout = await page.evaluate(() => {
      const paper = document.querySelector('.continuous-visual-document')!.getBoundingClientRect()
      const comments = document.querySelector('.comments-panel')!.getBoundingClientRect()
      return { gap: comments.left - paper.right, paperWidth: paper.width }
    })
    expect(layout.gap).toBeGreaterThanOrEqual(0)
    expect(layout.gap).toBeLessThanOrEqual(32)
    expect(layout.paperWidth).toBe(originalWidth)
    await page.getByTitle('Close comments', { exact: true }).click()
  }
})

test('single-pane comments stay readable on wide screens while Split stays compact', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop comment rails use a bounded reading width')
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const panel = page.getByRole('complementary', { name: 'Comments' })
  const commentText = 'This comment should retain a readable width when the application window becomes wider. '.repeat(12).trim()
  let postedComment = false
  for (const width of [1180, 1600, 2560, 3840]) {
    await page.setViewportSize({ width, height: 960 })
    for (const mode of ['Visual editor', 'Source only']) {
      await page.getByTitle(mode, { exact: true }).click()
      await page.getByTitle('Open comments', { exact: true }).click()
      await expect(panel).toBeVisible()
      const geometry = await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const panes = element.closest('.document-panes')!.getBoundingClientRect()
        return { width: bounds.width, groupWidth: panes.width,
          rightGap: panes.right - bounds.right, overflow: element.scrollWidth > element.clientWidth }
      })
      expect(geometry.width).toBeGreaterThanOrEqual(320)
      expect(geometry.width).toBeLessThanOrEqual(400)
      expect(geometry.groupWidth).toBeLessThanOrEqual(1248)
      expect(Math.abs(geometry.rightGap)).toBeLessThanOrEqual(1)
      expect(geometry.overflow).toBe(false)
      await page.getByTitle('Add comment to selection', { exact: true }).click()
      const composer = panel.getByRole('textbox', { name: 'New comment' })
      await expect(composer).toBeFocused()
      const composerWidth = await composer.evaluate((element) => element.getBoundingClientRect().width)
      expect(composerWidth).toBeGreaterThan(geometry.width * 0.85)
      if (!postedComment) {
        await composer.fill(commentText)
        await panel.getByRole('button', { name: 'Comment', exact: true }).click()
        postedComment = true
      } else await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      const body = panel.getByText(commentText, { exact: true })
      await expect(body).toBeVisible()
      expect(await body.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(geometry.width * 0.85)
      if (mode === 'Visual editor') await page.screenshot({ path: testInfo.outputPath(`wide-comments-${width}.png`) })
      await page.getByTitle('Close comments', { exact: true }).click()
    }
    await page.getByTitle('Split view', { exact: true }).click()
    await page.getByTitle('Open comments', { exact: true }).click()
    expect(await panel.evaluate((element) => element.getBoundingClientRect().width)).toBe(320)
    await page.getByTitle('Close comments', { exact: true }).click()
  }
})

test('wide manuscript tables stay inside the mobile document page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Document table geometry runs once')
  await page.setViewportSize({ width: 390, height: 844 })
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  await page.getByTitle('Visual editor', { exact: true }).click()
  const table = page.locator('.myst-preview table').first()
  await table.scrollIntoViewIfNeeded()
  await expect(table).toHaveCSS('overflow-x', 'auto')
  const geometry = await table.evaluate((element) => {
    const paper = element.closest<HTMLElement>('.myst-preview')!
    return {
      paperClientWidth: paper.clientWidth,
      paperScrollWidth: paper.scrollWidth,
      tableRight: element.getBoundingClientRect().right,
      pageRight: paper.getBoundingClientRect().right,
    }
  })
  expect(geometry.paperScrollWidth).toBeLessThanOrEqual(geometry.paperClientWidth + 1)
  expect(geometry.tableRight).toBeLessThanOrEqual(geometry.pageRight)
})

test('phone comments open as a full-width sheet directly below the toolbar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Phone comment geometry runs once')
  await page.setViewportSize({ width: 390, height: 844 })
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  await page.getByTitle('Visual editor', { exact: true }).click()
  await page.getByTitle('Open comments').click()
  const panel = page.getByRole('complementary', { name: 'Comments' })
  await expect(panel).toBeVisible()
  const geometry = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const documentArea = element.closest('.document-panes')!.getBoundingClientRect()
    return { top: bounds.top, documentTop: documentArea.top, left: bounds.left, right: bounds.right, width: window.innerWidth }
  })
  expect(Math.abs(geometry.top - geometry.documentTop)).toBeLessThanOrEqual(1)
  expect(geometry.left).toBe(0)
  expect(geometry.right).toBe(geometry.width)
  await page.getByTitle('Add comment to selection').click()
  await expect(panel.getByRole('textbox', { name: 'New comment' })).toBeFocused()
  expect(await panel.locator('.comment-composer').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('mobile sidebar Escape policy changes exactly above 820px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Breakpoint policy runs once in Chromium')
  await page.setViewportSize({ width: 820, height: 560 })
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const sidebar = page.getByRole('complementary', { name: 'Project files' })
  const toggle = page.locator('button[aria-controls="project-files-sidebar"]')

  await toggle.click()
  await expect(sidebar).toHaveClass(/open/)
  await page.keyboard.press('Escape')
  await expect(sidebar).not.toHaveClass(/open/)

  await page.setViewportSize({ width: 821, height: 560 })
  await toggle.click()
  await expect(sidebar).toHaveClass(/open/)
  await page.keyboard.press('Escape')
  await expect(sidebar).toHaveClass(/open/)
})

test('document menus and compact toolbar follow Google Docs ownership', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Document chrome ownership runs once in Chromium')
  await page.setViewportSize({ width: 1180, height: 700 })
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)

  for (const label of ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Help']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  }

  const fileMenuTrigger = page.getByRole('button', { name: 'File', exact: true })
  await fileMenuTrigger.click()
  await expect(page.getByRole('menu', { name: 'File menu' })
    .getByRole('menuitem', { name: 'New document' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'File menu' })).toBeHidden()
  await expect(fileMenuTrigger).toBeFocused()

  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  const tools = page.getByRole('menu', { name: 'Tools menu' })
  await expect(tools.getByRole('menuitem', { name: /Word count/ })).toContainText('words')
  await expect(tools.getByRole('menuitem', { name: 'Reference library' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByTitle('Insert MyST content').click()
  const insertDialog = page.getByRole('dialog', { name: 'Insert MyST content' })
  await insertDialog.getByRole('searchbox', { name: 'Search content types' }).fill('comment')
  await insertDialog.getByRole('button', { name: /Add comment to selection/ }).click()
  await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()
  await page.getByTitle('Close comments').click()

  const chromeGeometry = await page.evaluate(() => {
    const bounds = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const save = bounds('.toolbar-save')
    const bold = bounds('button[title="Bold"]')
    const comments = bounds('.comments-trigger')
    const mode = bounds('.mode-menu')
    const sidebar = bounds('.file-sidebar')
    const sidebarToggle = bounds('.sidebar-edge-toggle')
    return {
      saveBeforeBold: Boolean(save && bold && save.right <= bold.left),
      commentsBeforeMode: Boolean(comments && mode && comments.right <= mode.left),
      toggleAtSidebarEdge: Boolean(
        sidebar && sidebarToggle &&
        Math.abs(sidebar.right - (sidebarToggle.left + sidebarToggle.width / 2)) <= 2,
      ),
    }
  })
  expect(chromeGeometry).toEqual({
    saveBeforeBold: true,
    commentsBeforeMode: true,
    toggleAtSidebarEdge: true,
  })

  const more = page.getByTitle('More authoring tools')
  await expect(more).toBeHidden()

  await page.setViewportSize({ width: 667, height: 700 })
  await expect(more).toBeVisible()
  await more.focus()
  await more.press('Enter')
  const menu = page.getByRole('menu', { name: 'More authoring tools' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Bold' })).toBeEnabled()
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 1600, height: 700 })
  await expect(more).toBeHidden()
})

test('GitHub primary action remains usable in a short landscape viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Short-landscape geometry runs once in Chromium')
  await page.setViewportSize({ width: 667, height: 320 })
  const roomName = createRoomName(testInfo)
  await page.goto(`/?doc=${roomName}`)
  await page.getByTitle('Connect GitHub identity').click()

  const dialog = page.getByRole('dialog', { name: 'GitHub identity' })
  const action = dialog.getByRole('link', { name: 'Continue with GitHub' })
  await expect(action).toBeInViewport()
  await action.click({ trial: true })

  const bounds = await action.boundingBox()
  expect(bounds).not.toBeNull()
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(320)
})
