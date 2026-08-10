import AxeBuilder from '@axe-core/playwright'
import { authenticateMaintainer, createRoomName, expect, test } from './support'

const expectNoAxeViolations = async (page: Parameters<typeof authenticateMaintainer>[0]) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const violations = results.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    targets: nodes.map((node) => node.target.join(' ')),
  }))
  expect(violations).toEqual([])
}

test('anonymous shell has no automated WCAG A or AA violations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One engine is sufficient for axe DOM analysis')
  const roomName = createRoomName(testInfo)
  await page.goto(`/?doc=${roomName}`)
  await expect(page.getByText('Connect GitHub to access this room.')).toBeVisible()

  await expectNoAxeViolations(page)
})

test('authenticated editor and comments have no automated WCAG A or AA violations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One engine is sufficient for axe DOM analysis')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  await page.getByTitle('Open comments').click()
  await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()

  await expectNoAxeViolations(page)
})

test('modal state has no automated WCAG A or AA violations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One engine is sufficient for axe DOM analysis')
  const roomName = createRoomName(testInfo)
  await page.goto(`/?doc=${roomName}`)
  await page.getByTitle('How DeMystify works').click()
  await expect(page.getByRole('dialog', { name: 'How DeMystify works' })).toBeVisible()

  await expectNoAxeViolations(page)
})
