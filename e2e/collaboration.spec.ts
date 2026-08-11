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

test('suggestion participant can edit the shared draft without publishing authority', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Covered by desktop browser engines')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const token = await createShareToken(page, roomName, 'collaborator')

  const collaboratorContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const collaboratorPage = await collaboratorContext.newPage()
  try {
    await collaboratorPage.goto(`/?doc=${roomName}#collaborate=${token}`)
    await expect(collaboratorPage.getByText('Suggestion mode', { exact: true }).first()).toBeVisible()
    await expect(collaboratorPage.getByTitle('Insert MyST content')).toBeEnabled()
    await expect(collaboratorPage.getByTitle('Save snapshot to GitHub')).toBeDisabled()

    await insertNote(collaboratorPage)
    await expect(page.locator('.cm-content')).toContainText(':::{note}')
  } finally {
    await collaboratorContext.close()
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
    await expect(page.locator('.sync-status')).toHaveText('disconnected')
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
