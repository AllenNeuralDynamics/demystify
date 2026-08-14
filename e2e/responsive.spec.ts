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

test('sidebar-constrained toolbar exposes hidden authoring commands through More', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Responsive authoring overflow runs once in Chromium')
  await page.setViewportSize({ width: 1180, height: 700 })
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)

  const more = page.getByTitle('More authoring tools')
  await expect(more).toBeVisible()
  await more.click()
  const menu = page.getByRole('menu', { name: 'More authoring tools' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Bold' })).toBeEnabled()
  await menu.getByRole('menuitem', { name: 'Add comment' }).click()
  await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()

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
