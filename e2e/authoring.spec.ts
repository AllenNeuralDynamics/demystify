import type { Locator } from '@playwright/test'
import { sampleManuscript } from '../src/lib/sampleManuscript'
import { authenticateMaintainer, createRoomName, expect, test } from './support'

const sourceModifier = (source: Locator) => source.evaluate(() => {
  const ios = /Apple Computer/.test(navigator.vendor) &&
    (/Mobile\/\w+/.test(navigator.userAgent) || navigator.maxTouchPoints > 2)
  return ios || /Mac/.test(navigator.platform) ? 'Meta' : 'Control'
})

const selectSourceDocument = async (source: Locator) => {
  await source.press(`${await sourceModifier(source)}+a`)
}

const paneToolbarSource = '# Pane toolbars\n\nSource target.\n\nVisual target.\n\n$$\nx^2\n$$\n\nAfter.'

for (const mode of ['Source only', 'Visual editor', 'Split view']) {
  test(`pane editing controls stay scoped in ${mode}`, async ({ page }, testInfo) => {
    test.skip(mode === 'Split view' && testInfo.project.name.startsWith('mobile'), 'Two visible panes require desktop space')
    await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
    const source = page.getByRole('textbox', { name: 'MyST source', exact: true, includeHidden: true })
    await source.focus()
    await selectSourceDocument(source)
    await page.keyboard.insertText(paneToolbarSource)
    await page.getByTitle(mode, { exact: true }).click()
    const sourceTools = page.getByRole('toolbar', { name: 'Source editing tools', exact: true })
    const visualTools = page.getByRole('toolbar', { name: 'Visual editing tools', exact: true })
    const formatted = page.getByRole('textbox', { name: 'Formatted manuscript', exact: true })
    await expect(sourceTools).toHaveCount(mode === 'Visual editor' ? 0 : 1)
    await expect(visualTools).toHaveCount(mode === 'Source only' ? 0 : 1)
    for (const title of ['Undo', 'Redo', 'Bold', 'Italic', 'Inline code']) {
      await expect(page.locator('.editor-toolbar').getByTitle(title, { exact: true })).toHaveCount(0)
    }
    const visibleTools = mode === 'Visual editor' ? visualTools : sourceTools
    expect(await visibleTools.getByTitle('Inline code', { exact: true }).locator('svg').getAttribute('class'))
      .not.toBe(await page.getByTitle('Source only', { exact: true }).locator('svg').getAttribute('class'))

    if (mode !== 'Visual editor') {
      await expect(sourceTools.getByTitle('Redo', { exact: true })).toBeDisabled()
      await source.locator('.cm-line').filter({ hasText: /^Source target\.$/ }).click({ position: { x: 2, y: 8 } })
      await source.press('Home')
      await source.press('Shift+End')
      await sourceTools.getByTitle('Bold', { exact: true }).click()
      await expect(source).toContainText('**Source target.**')
      await sourceTools.getByTitle('Bold', { exact: true }).click()
      await expect(source).not.toContainText('**Source target.**')
      await sourceTools.getByTitle('Undo', { exact: true }).click()
      await expect(source).toContainText('**Source target.**')
      await sourceTools.getByTitle('Redo', { exact: true }).click()
      await expect(source).not.toContainText('**Source target.**')
      await expect(sourceTools.getByTitle('Redo', { exact: true })).toBeDisabled()
      const modifier = await sourceModifier(source)
      await source.press(`${modifier}+b`)
      await expect(source).toContainText('**Source target.**')
      await source.press(`${modifier}+b`)
      await expect(source).not.toContainText('**Source target.**')
    }

    if (mode !== 'Source only') {
      await expect(visualTools.getByTitle('Undo', { exact: true })).toBeDisabled()
      await expect(visualTools.getByTitle('Redo', { exact: true })).toBeDisabled()
      const paragraph = formatted.locator('p').filter({ hasText: /^Visual target\.$/ })
      await paragraph.click({ position: { x: 2, y: 8 } })
      await page.keyboard.press('Shift+ArrowRight')
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('V')
      await visualTools.getByTitle('Bold', { exact: true }).click()
      await expect(paragraph.locator('strong')).toHaveText('V')
      await visualTools.getByTitle('Bold', { exact: true }).click()
      await expect(paragraph.locator('strong')).toHaveCount(0)
      await visualTools.getByTitle('Undo', { exact: true }).click()
      await expect(paragraph.locator('strong')).toHaveText('V')
      await visualTools.getByTitle('Redo', { exact: true }).click()
      await expect(paragraph.locator('strong')).toHaveCount(0)
      await expect(visualTools.getByTitle('Redo', { exact: true })).toBeDisabled()
    }

    if (mode === 'Split view') {
      await sourceTools.getByTitle('Undo', { exact: true }).click()
      await expect(source).toContainText('**Source target.**')
      await visualTools.getByTitle('Undo', { exact: true }).click()
      await expect(source).toContainText('**V**isual target.')
      await expect(source).toContainText('**Source target.**')
      await sourceTools.getByTitle('Redo', { exact: true }).click()
      await expect(source).not.toContainText('**Source target.**')
      await expect(source).toContainText('**V**isual target.')
      await visualTools.getByTitle('Redo', { exact: true }).click()
      await expect(source).not.toContainText('**V**isual target.')
    }
    await page.screenshot({ path: testInfo.outputPath('pane-editing-tools.png') })
  })
}

test('pane tools and document menus preserve an open object-source draft', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Independent pane histories are tested with both panes visible')
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source', exact: true })
  await source.focus()
  await selectSourceDocument(source)
  await page.keyboard.insertText(paneToolbarSource)
  const sourceTools = page.getByRole('toolbar', { name: 'Source editing tools', exact: true })
  const visualTools = page.getByRole('toolbar', { name: 'Visual editing tools', exact: true })
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript', exact: true })
  await source.locator('.cm-line').filter({ hasText: /^Source target\.$/ }).click({ position: { x: 2, y: 8 } })
  await source.press('Home')
  await source.press('Shift+End')
  await formatted.getByRole('button', { name: 'Edit equation', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'LaTeX equation', exact: true })
  await draft.fill('x^3')
  for (const title of ['Undo', 'Redo', 'Bold', 'Italic', 'Inline code', 'Link', 'Cite a paper']) {
    await expect(visualTools.getByTitle(title, { exact: true })).toBeDisabled()
  }
  for (const [menu, item] of [['Edit', 'Undo'], ['Edit', 'Redo'], ['Format', 'Bold']]) {
    await page.getByRole('button', { name: menu, exact: true }).click()
    await expect(page.getByRole('menuitem', { name: item, exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(draft).toHaveValue('x^3')
    await expect(source).toContainText('x^2')
    await expect(source).not.toContainText('x^3')
  }
  await sourceTools.getByTitle('Bold', { exact: true }).click()
  await expect(source).toContainText('**Source target.**')
  await expect(draft).toHaveValue('x^3')
  await page.getByTitle('Cancel object edit', { exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(source).toContainText('**Source target.**')
  await expect(source).toContainText('x^2')
  await formatted.getByRole('button', { name: 'Edit equation', exact: true }).click()
  await draft.fill('x^4')
  await page.getByTitle('Apply equation', { exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(source).toContainText('x^4')
  await expect(source).toContainText('**Source target.**')
  await visualTools.getByTitle('Undo', { exact: true }).click()
  await expect(source).toContainText('x^2')
  await expect(source).toContainText('**Source target.**')
})

test('edits existing Visual links, citations and bibliography entries', async ({ page }, testInfo) => {
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reference library', exact: true }).click()
  await page.getByTitle('Import BibTeX', { exact: true }).click()
  await page.getByRole('textbox', { name: 'BibTeX to import' }).fill(
    '@article{smith2024, title={A paper}, author={Smith, Ada}, year={2024}, doi={10.1000/example}}',
  )
  await page.getByRole('button', { name: 'Import references', exact: true }).click()
  await expect(page.locator('.reference-library-row')).toContainText('A paper')
  await page.getByTitle('Close reference library', { exact: true }).click()
  const source = page.getByRole('textbox', { name: 'MyST source' })
  await source.focus()
  await selectSourceDocument(source)
  await page.keyboard.insertText('# Inline objects\n\nRead the [project website](https://example.org/prior "Project home").\n\nPrior {cite:p}`smith2024`.\n')
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  const website = formatted.getByRole('link', { name: 'project website', exact: true })
  await website.click()
  const linkEditor = page.getByRole('dialog', { name: 'Edit link', exact: true })
  await expect(linkEditor.getByRole('textbox', { name: 'Link URL', exact: true })).toHaveValue('https://example.org/prior')
  await expect(linkEditor.getByRole('textbox', { name: 'Link text', exact: true })).toHaveValue('project website')
  const bounds = await linkEditor.boundingBox()
  expect(bounds).not.toBeNull()
  const width = page.viewportSize()!.width
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
  await linkEditor.getByRole('textbox', { name: 'Link URL', exact: true }).fill('https://example.org/updated')
  await linkEditor.getByTitle('Apply link', { exact: true }).click()
  await expect(linkEditor).toHaveCount(0)
  await expect(website).toHaveAttribute('href', 'https://example.org/updated')
  await expect(website).toHaveAttribute('title', 'Project home')
  await website.click()
  await linkEditor.getByRole('textbox', { name: 'Link URL', exact: true }).fill('https://example.org/discarded')
  await linkEditor.getByTitle('Cancel link edit', { exact: true }).click()
  await expect(website).toHaveAttribute('href', 'https://example.org/updated')
  await page.screenshot({ path: testInfo.outputPath('visual-inline-objects.png') })
  await formatted.getByRole('button', { name: 'Edit citation', exact: true }).click()
  const citationEditor = page.getByRole('dialog', { name: 'Edit citation', exact: true })
  await expect(citationEditor.locator('.citation-result').filter({ hasText: 'A paper' })).toHaveAttribute('aria-pressed', 'true')
  await citationEditor.getByRole('textbox', { name: 'Citation locator or suffix' }).fill('p. 4')
  await citationEditor.getByRole('button', { name: 'Apply citation', exact: true }).click()
  await expect(citationEditor).toHaveCount(0)
  await expect(formatted.locator('[data-visual-citation]')).toHaveCount(1)
  await expect(formatted.locator('[data-visual-citation]')).toContainText('p. 4')
  await formatted.getByRole('button', { name: 'Edit reference smith2024', exact: true }).click()
  const referenceEditor = page.getByRole('dialog', { name: 'Edit smith2024', exact: true })
  const entry = referenceEditor.getByRole('textbox', { name: 'BibTeX entry', exact: true })
  await expect(entry).toHaveValue(/@article\{smith2024/)
  await entry.fill((await entry.inputValue()).replace('A paper', 'Updated paper'))
  await referenceEditor.getByRole('button', { name: 'Save entry', exact: true }).click()
  await page.getByTitle('Close reference library', { exact: true }).click()
  await expect(formatted.locator('.visual-readonly-appendix')).toContainText('Updated paper')
  await website.click()
  await linkEditor.getByTitle('Remove link', { exact: true }).click()
  await expect(website).toHaveCount(0)
  await expect(formatted).toContainText('Read the project website.')
  await page.getByTitle('Source only', { exact: true }).click()
  await expect(source).toContainText('Read the project website.')
  await expect(source).not.toContainText('https://example.org/')
  expect((await source.innerText()).match(/smith2024/g)).toHaveLength(1)
})

test('edits directive settings from the selected Visual object', async ({ page }, testInfo) => {
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  await source.focus()
  await selectSourceDocument(source)
  await page.keyboard.insertText('# Directive objects\n\n:::{admonition} Original title\n:class: note\n\nDirective body.\n:::\n')
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  await formatted.locator('.visual-container-content p').click()
  const action = page.getByTitle('Edit object source', { exact: true })
  await expect(action).toBeEnabled()
  await action.click()
  const editor = page.getByRole('textbox', { name: 'MyST object source', exact: true })
  await expect(editor).toHaveValue(/:::\{admonition\} Original title/)
  await editor.fill((await editor.inputValue()).replace('Original title', 'Updated title'))
  await page.getByTitle('Apply MyST object', { exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(formatted.locator('.admonition-title')).toHaveText('Updated title')
  await expect(formatted).toContainText('Directive body.')
  await page.getByTitle('Source only', { exact: true }).click()
  await expect(source).toContainText(':::{admonition} Updated title')
  await expect(source).toContainText(':class: note')
})

test('edits cross-reference passages and rendered footnote definitions', async ({ page }, testInfo) => {
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  await source.focus()
  await selectSourceDocument(source)
  await page.keyboard.insertText('# Reference objects\n\n(target)=\n\n## Target\n\nSee {ref}`target` and this note[^note].\n\n[^note]:\n    Footnote body.\n')
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  await formatted.locator('.visual-protected-block a[href="#target"]').click()
  const objectEditor = page.getByRole('textbox', { name: 'MyST object source', exact: true })
  await expect(objectEditor).toHaveValue('See {ref}`target` and this note[^note].')
  await objectEditor.fill('Compare {ref}`target` and this note[^note].')
  await page.getByTitle('Apply MyST object', { exact: true }).click()
  await expect(formatted.locator('a[href="#target"]')).toHaveText('Target')
  const footnote = formatted.getByRole('button', { name: 'Edit footnote note', exact: true })
  await footnote.click()
  await expect(objectEditor).toHaveValue('[^note]:\n    Footnote body.')
  await objectEditor.fill('[^note]:\n    Updated footnote body.')
  await page.getByTitle('Apply MyST object', { exact: true }).click()
  await expect(objectEditor).toHaveCount(0)
  await expect(footnote).toContainText('Updated footnote body.')
  await page.getByTitle('Source only', { exact: true }).click()
  await expect(source).toContainText('Compare {ref}`target` and this note[^note].')
  await expect(source).toContainText('[^note]:')
  await expect(source).toContainText('Updated footnote body.')
})

test('edits continuously across formatted paragraphs without approval controls', async ({ page }, testInfo) => {
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  await source.focus()
  await selectSourceDocument(source)
  await page.keyboard.insertText('# Draft\n\nFirst paragraph.\n\nSecond paragraph.\n')
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  await expect(formatted).toBeVisible()
  await formatted.locator('p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' Updated.')
  await expect(formatted.locator('p').first()).toHaveText('First paragraph. Updated.')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('A new paragraph.')
  await expect(formatted.locator('p')).toHaveCount(3)
  await expect(formatted).toBeFocused()
  await expect(page.getByTitle('Finish visual edit')).toHaveCount(0)
  await expect(page.getByTitle('Save visual edit')).toHaveCount(0)
  await page.getByTitle('Source only').click()
  await expect(source).toContainText('First paragraph. Updated.')
  await expect(source).toContainText('A new paragraph.')
  await expect(source).toContainText('Second paragraph.')
})

test('edits equations and protected MyST objects in place', async ({ page }, testInfo) => {
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  await source.focus()
  await selectSourceDocument(source)
  await page.keyboard.insertText('# Object editing\n\nBefore.\n\n$$\nx^2\n$$\n\n| Measure | Value |\n| --- | --- |\n| Cells | 10 |\n\n:::{figure} /sample-figure.svg\n:name: fig-demo\n:alt: Demo figure\n\nOriginal figure caption.\n:::\n\nAfter.')
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  await expect(formatted.getByRole('button', { name: 'Edit equation', exact: true })).toHaveCount(1)
  await formatted.getByRole('button', { name: 'Edit equation', exact: true }).click()
  const equation = page.getByRole('textbox', { name: 'LaTeX equation', exact: true })
  await expect(equation).toHaveValue('x^2')
  await equation.fill('x^3 + y')
  await expect(page.locator('.visual-object-preview')).toHaveCount(0)
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)
  const geometry = await page.locator('.visual-object-editor').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { left: bounds.left, right: bounds.right, width: window.innerWidth,
      contained: element.scrollWidth <= element.clientWidth }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.width)
  expect(geometry.contained).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('equation-object-editor.png') })
  await page.getByTitle('Apply equation', { exact: true }).click()
  await expect(equation).toHaveCount(0)
  await page.getByTitle('Source only', { exact: true }).click()
  await expect(source).toContainText('x^3 + y')
  await expect(source).toContainText('Before.')
  await expect(source).toContainText('After.')
  await page.getByTitle('Visual editor', { exact: true }).click()
  await formatted.getByRole('button', { name: 'Edit equation', exact: true }).click()
  await equation.fill('discarded draft')
  await page.getByTitle('Cancel object edit', { exact: true }).click()
  const table = formatted.locator('.visual-protected-block').filter({ has: page.locator('table') })
  await table.click()
  const objectSource = page.getByRole('textbox', { name: 'MyST object source', exact: true })
  const original = await objectSource.inputValue()
  await objectSource.fill(original.replace('10', '12'))
  await expect(page.locator('.visual-object-preview')).toHaveCount(0)
  await page.getByTitle('Apply MyST object', { exact: true }).click()
  await expect(objectSource).toHaveCount(0)
  await expect(formatted.locator('table')).toContainText('12')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click()
  await expect(formatted.locator('table')).toContainText('10')
  await formatted.getByRole('button', { name: 'Edit figure', exact: true }).click()
  await expect(objectSource).toHaveValue(/:::\{figure\}/)
  const figureSource = await objectSource.inputValue()
  expect(figureSource).toContain(':name: fig-demo')
  await objectSource.fill(figureSource.replace('Original figure caption.', 'Updated figure caption.'))
  await page.getByTitle('Apply MyST object', { exact: true }).click()
  await expect(formatted.locator('figure figcaption')).toContainText('Updated figure caption.')
  await expect(formatted.locator('figure figcaption p.myst-editable-block')).toHaveCount(1)
  await page.getByTitle('Source only', { exact: true }).click()
  await expect(source).toContainText('x^3 + y')
  await expect(source).not.toContainText('discarded draft')
})

test('moves seamlessly between labeled equations, captions and prose', async ({ page }, testInfo) => {
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  await source.focus()
  await selectSourceDocument(source)
  await page.keyboard.insertText('# Labeled objects\n\nBefore.\n\n(first-equation)=\n\n$$\na^2\n$$\n\n' +
    '(second-equation)=\n\n$$\nb^3\n$$\n\n:::{figure} /sample-figure.svg\n:name: fig-long\n\n' +
    'Detailed caption with $c^4$ and a [linked result](https://example.org).\n:::\n\nAfter.')
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  const equations = formatted.getByRole('button', { name: 'Edit equation', exact: true })
  await expect(equations).toHaveCount(2)
  await equations.first().click()
  const equation = page.getByRole('textbox', { name: 'LaTeX equation', exact: true })
  await expect(equation).toHaveValue('a^2')
  await equation.fill('a^5')
  await equations.last().click()
  await expect(equation).toHaveValue('b^3')
  await equation.fill('b^6')
  await formatted.locator('p').filter({ hasText: /^Before\.$/ }).click()
  await expect(equation).toHaveCount(0)
  await formatted.locator('figcaption .visual-protected-block').click({ position: { x: 8, y: 8 } })
  const caption = page.getByRole('textbox', { name: 'MyST object source', exact: true })
  await expect(caption).toHaveValue(/^Detailed caption with \$c\^4\$/)
  await expect(page.locator('.visual-object-preview')).toHaveCount(0)
  await caption.fill((await caption.inputValue()).replace('Detailed caption', 'Updated detailed caption'))
  await formatted.locator('p').filter({ hasText: /^After\.$/ }).click()
  await expect(caption).toHaveCount(0)
  await expect(formatted.locator('figcaption')).toContainText('Updated detailed caption')
  await formatted.getByRole('button', { name: 'Edit figure', exact: true }).click()
  await caption.fill((await caption.inputValue()).replace(':name: fig-long', ':name: fig-updated'))
  await equations.first().click()
  await expect(equation).toHaveValue('a^5')
  await formatted.locator('p').filter({ hasText: /^After\.$/ }).click()
  await expect(equation).toHaveCount(0)
  await page.getByTitle('Source only', { exact: true }).click()
  await expect(source).toContainText('(first-equation)=')
  await expect(source).toContainText('(second-equation)=')
  await expect(source).toContainText('a^5')
  await expect(source).toContainText('b^6')
  await expect(source).toContainText('Updated detailed caption')
  await expect(source).toContainText(':name: fig-updated')
})

test('keeps object editor geometry and document scroll stable', async ({ page }, testInfo) => {
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  const paragraphs = Array.from({ length: 18 }, (_, index) =>
    `Context paragraph ${index + 1} keeps the document long enough to inspect scrolling.`).join('\n\n')
  const caption = Array.from({ length: 14 }, (_, index) =>
    `Caption section ${index + 1} describes the spatial component $c_${index}$ and its corresponding measurements.`).join(' ')
  await source.focus()
  await selectSourceDocument(source)
  await page.keyboard.insertText(`# Stable objects\n\n${paragraphs}\n\n$$\nx^2\n$$\n\n` +
    `:::{figure} /sample-figure.svg\n:name: fig-stable\n\n${caption}\n:::\n\nFollowing paragraph.\n\n${paragraphs}`)
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  await expect.poll(() => formatted.locator('img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true)
  const objects = [
    { name: 'equation', target: formatted.getByRole('button', { name: 'Edit equation', exact: true }) },
    { name: 'caption', target: formatted.locator('figcaption .visual-protected-block') },
    { name: 'figure', target: formatted.getByRole('button', { name: 'Edit figure', exact: true }) },
  ]
  const geometry = () => page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.preview-pane')!
    const following = Array.from(pane.querySelectorAll('p'))
      .find((element) => element.textContent === 'Following paragraph.')!
    return { scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight,
      followingTop: following.getBoundingClientRect().top }
  })
  for (const object of objects) {
    await object.target.scrollIntoViewIfNeeded()
    const before = await geometry()
    const originalBounds = await object.target.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const footprint = (element.matches('img') ? element.closest('figure')! : element).getBoundingClientRect()
      const pane = element.closest('.preview-pane')!
      const label = pane.querySelector('.preview-label')!.getBoundingClientRect()
      const top = Math.max(bounds.top, label.bottom)
      const bottom = Math.min(bounds.bottom, pane.getBoundingClientRect().bottom, window.innerHeight)
      return { height: footprint.height, width: footprint.width, clickY: (top + bottom) / 2 - bounds.top }
    })
    await object.target.click(object.name === 'caption' ? { position: { x: 8, y: originalBounds.clickY } } : {})
    const editor = page.locator('.visual-object-editor')
    const input = editor.locator('textarea')
    await expect(input).toBeFocused()
    const opened = await geometry()
    const expansion = Math.max(96, Math.ceil(originalBounds.height)) - originalBounds.height
    expect(Math.abs(opened.scrollHeight - before.scrollHeight - expansion)).toBeLessThanOrEqual(2)
    expect(Math.abs(opened.scrollTop - before.scrollTop)).toBeLessThanOrEqual(2)
    expect(Math.abs(opened.followingTop - before.followingTop - expansion)).toBeLessThanOrEqual(2)
    const panelBefore = await editor.boundingBox()
    expect(panelBefore).not.toBeNull()
    expect(Math.abs(panelBefore!.width - originalBounds.width)).toBeLessThanOrEqual(2)
    const expectedHeight = Math.max(96, Math.ceil(originalBounds.height))
    expect(Math.abs(panelBefore!.height - expectedHeight), `${object.name} editor height`).toBeLessThanOrEqual(2)
    expect(await editor.evaluate((element) => element.closest('.is-object-editing') !== null)).toBe(true)
    await page.keyboard.insertText(`\\begin{aligned}\n${Array.from({ length: 200 }, (_, index) => `x_${index} &= y_${index}`).join(' \\\\\n')}\n\\end{aligned}`)
    const panelAfter = await editor.boundingBox()
    expect(panelAfter).toEqual(panelBefore)
    expect(await geometry()).toEqual(opened)
    expect(await input.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`stable-${object.name}-editor.png`) })
    const pane = page.locator('.preview-pane')
    await pane.evaluate((element) => {
      const object = element.querySelector('.is-object-editing')!
      element.scrollTop += object.getBoundingClientRect().bottom - element.getBoundingClientRect().top + 80
    })
    await expect.poll(() => editor.evaluate((element) => {
      const pane = element.closest('.preview-pane')!.getBoundingClientRect()
      const bounds = element.getBoundingClientRect()
      return bounds.bottom <= pane.top || bounds.top >= pane.bottom
    })).toBe(true)
    await pane.evaluate((element, top) => { element.scrollTop = top }, opened.scrollTop)
    await page.getByTitle('Cancel object edit', { exact: true }).click()
    await expect(editor).toHaveCount(0)
    const closed = await geometry()
    expect(closed.scrollHeight).toBe(before.scrollHeight)
    expect(Math.abs(closed.scrollTop - before.scrollTop)).toBeLessThanOrEqual(2)
    expect(Math.abs(closed.followingTop - before.followingTop)).toBeLessThanOrEqual(2)
  }
})

test('shared formatting toolbar targets the continuous Visual selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Shared toolbar routing runs once')
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  await page.getByRole('textbox', { name: 'MyST source' }).fill('# Draft\n\nFirst paragraph.\n')
  await page.getByTitle('Visual editor', { exact: true }).click()
  const formatted = page.getByRole('textbox', { name: 'Formatted manuscript' })
  await formatted.locator('p').first().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowRight')
  await page.getByTitle('Bold', { exact: true }).click()
  await expect(formatted.locator('strong')).toHaveText('F')
  await page.getByTitle('Undo', { exact: true }).click()
  await expect(formatted.locator('strong')).toHaveCount(0)
  await expect(formatted).toContainText('First paragraph.')
  await page.getByTitle('Insert MyST content').click()
  await page.getByRole('dialog', { name: 'Insert MyST content' })
    .getByRole('button', { name: /^Note/ }).click()
  await expect(formatted.locator('aside')).toHaveCount(1)
  await page.getByTitle('Source only').click()
  await expect(page.getByRole('textbox', { name: 'MyST source' })).toContainText(':::{note}')
})

test('uses neutral document text and blue focus for live editing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Editing color semantics run once')
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  await expect(page.getByRole('status', { name: 'Server save status' })).toHaveCSS('color', 'rgb(24, 90, 188)')
  await expect(page.locator('.file-row.active')).toHaveCSS('color', 'rgb(24, 90, 188)')
  await page.getByRole('textbox', { name: 'MyST source' }).focus()
  await expect(page.locator('.cm-cursor')).toHaveCSS('border-left-color', 'rgb(26, 115, 232)')
  await page.getByTitle('Visual editor', { exact: true }).click()
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const paragraph = page.locator('.myst-preview p.myst-editable-block').first()
    await paragraph.hover()
    await expect(paragraph).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await paragraph.click()
    const field = page.getByRole('textbox', { name: 'Formatted manuscript' })
    await expect(field).toBeFocused()
    await expect(field).toHaveCSS('color', 'rgb(32, 33, 36)')
    await expect(field).toHaveCSS('caret-color', 'rgb(26, 115, 232)')
    await expect(field).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.screenshot({ path: testInfo.outputPath(`editing-colors-${viewport.width}.png`) })
  }
})

test('keeps document comments attached to the selected passage through replies and resolution', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Contextual comment workflow runs once')
  await authenticateMaintainer(page, createRoomName(testInfo), testInfo)
  await page.getByTitle('Visual editor', { exact: true }).click()
  await page.locator('.myst-preview p').filter({ hasText: 'A manuscript should be as inspectable' }).waitFor()
  await page.evaluate(() => {
    const paragraph = Array.from(document.querySelectorAll('.myst-preview p'))
      .find((element) => element.textContent?.includes('A manuscript should be as inspectable'))!
    const node = paragraph.firstChild!
    const start = node.textContent!.indexOf('inspectable')
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + 'inspectable'.length)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.locator('.myst-selection-comment').click()
  await expect(page.locator('.comment-composer-quote')).toHaveText('inspectable')
  await expect(page.getByRole('searchbox', { name: 'Search review' })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'New comment' }).fill('Clarify the scope of this finding.')
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)
  await page.getByTitle('Source only', { exact: true }).click()
  const source = page.getByRole('textbox', { name: 'MyST source' })
  await source.click()
  await source.press('ControlOrMeta+End')
  await page.getByTitle('Visual editor', { exact: true }).click()
  await page.locator('.comment-composer').getByRole('button', { name: 'Comment', exact: true }).click()
  const thread = page.locator('.comment').filter({ hasText: 'Clarify the scope of this finding.' })
  await expect(thread).toBeVisible()
  const mark = page.locator('.myst-comment-highlight')
  await expect(mark).toHaveText('inspectable')
  await page.getByTitle('Close comments').click()
  await mark.focus()
  await mark.press('Enter')
  await expect(page.locator('.document-panes')).toHaveClass(/view-preview/)
  await expect(thread).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => {
    const highlight = await mark.boundingBox()
    const card = await thread.boundingBox()
    return highlight && card ? Math.abs(highlight.y - card.y) : Number.POSITIVE_INFINITY
  }).toBeLessThan(100)
  await thread.getByRole('combobox', { name: /Reply to comment/ }).fill('Agreed, I will clarify it.')
  await thread.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(thread.locator('.comment-reply')).toContainText('Agreed, I will clarify it.')
  await thread.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(thread).toHaveCount(0)
  await expect(mark).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('resolved')
  await expect(thread).toBeVisible()
  await thread.getByRole('button', { name: 'Reopen', exact: true }).click()
  await expect(mark).toHaveText('inspectable')
  await expect(page.locator('.document-panes')).toHaveClass(/view-preview/)
  await page.getByTitle('Search and filter comments').click()
  await expect(page.getByRole('searchbox', { name: 'Search review' })).toBeVisible()
})

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

  await page.keyboard.press('ControlOrMeta+Alt+M')
  await expect(comments).toBeVisible()
  await expect(comments.getByRole('textbox', { name: 'New comment' })).toBeFocused()

  await comments.getByRole('textbox', { name: 'New comment' }).fill('Browser-authored comment')
  await comments.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(comments.locator('.comment')).toContainText('Browser-authored comment')

  await page.reload()
  await expect(page.locator('.sync-status')).toHaveText('Live')
  await expect(page.locator('.cm-content')).toContainText(':::{note}')
  await page.getByTitle('Open comments').click()
  const reopenedComments = page.getByRole('complementary', { name: 'Comments' })
  await expect(reopenedComments.getByRole('textbox', { name: 'New comment' })).toHaveCount(0)
  const addComment = reopenedComments.getByTitle('Add comment to selection')
  await expect(addComment).toBeVisible()
  await addComment.click()
  await expect(reopenedComments.getByRole('textbox', { name: 'New comment' })).toBeFocused()
  await reopenedComments.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(reopenedComments.getByRole('textbox', { name: 'New comment' })).toHaveCount(0)
  await expect(reopenedComments.locator('.comment'))
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
  const helpDialog = page.getByRole('dialog', { name: 'How DeMystify works' })
  await expect(helpDialog).toBeVisible()
  await expect(helpDialog.getByRole('navigation', { name: 'Help topics' })).toBeVisible()
  await helpDialog.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(helpDialog.getByRole('heading', { name: 'Keep discussion attached to the work' }))
    .toBeVisible()
  await helpDialog.getByRole('button', { name: 'About', exact: true }).click()
  await expect(helpDialog.getByText('MyST parser', { exact: true })).toBeVisible()
  await expect(helpDialog.getByText('1.7.3', { exact: true })).toBeVisible()
  const viewport = page.viewportSize()
  const helpBounds = await helpDialog.boundingBox()
  if (viewport && helpBounds && viewport.width >= 900) {
    expect(helpBounds.width).toBeGreaterThan(800)
    expect(helpBounds.height).toBeGreaterThan(600)
  } else if (viewport && helpBounds && viewport.width <= 560) {
    expect(helpBounds.x).toBeGreaterThanOrEqual(0)
    expect(helpBounds.y).toBeGreaterThanOrEqual(0)
    expect(helpBounds.x + helpBounds.width).toBeLessThanOrEqual(viewport.width)
    expect(helpBounds.y + helpBounds.height).toBeLessThanOrEqual(viewport.height)
    expect(await helpDialog.locator('.help-topic-content').evaluate((content) =>
      content.scrollWidth <= content.clientWidth)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(helpDialog).toBeHidden()
  await expect(helpTrigger).toBeFocused()

  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('menu', { name: 'Tools menu' })
    .getByRole('menuitem', { name: 'Reference library' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Reference library' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Reference library' })).toBeHidden()

  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('menu', { name: 'Tools menu' })
    .getByRole('menuitem', { name: 'Publication metadata' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Publication metadata' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Publication metadata' })).toBeHidden()
})

test('renders collapsible MyST dropdown bodies from Source', async ({ page }, testInfo) => {
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  const dropdownSource = `

::::{dropdown} Show complete Methods
:class: manuscript-methods-dropdown

## Experimental animals

All animal procedures were approved. **Critical methods detail.**

Implementation: <https://github.com/AllenNeuralDynamics/aind-ophys-motion-correction-and-registration>
::::`

  await source.fill(`${sampleManuscript}${dropdownSource}`)
  const dropdown = page.locator('.myst-preview details.myst-dropdown')
  const summary = dropdown.locator('summary')
  const methodsBody = dropdown.getByText('Critical methods detail.', { exact: false })

  await expect(summary).toHaveText('Show complete Methods')
  await expect(dropdown).not.toHaveAttribute('open', '')
  await expect(methodsBody).toBeHidden()
  await summary.click()
  await expect(dropdown).toHaveAttribute('open', '')
  await expect(dropdown.getByRole('heading', { name: 'Experimental animals' })).toBeVisible()
  await expect(methodsBody).toBeVisible()
  const implementationLink = dropdown.getByRole('link', {
    name: 'https://github.com/AllenNeuralDynamics/aind-ophys-motion-correction-and-registration',
  })
  await expect(implementationLink).toHaveCSS('overflow-wrap', 'anywhere')
  expect(await implementationLink.evaluate((link) => {
    const dropdownBounds = link.closest('details')?.getBoundingClientRect()
    const linkBounds = link.getBoundingClientRect()
    return Boolean(
      dropdownBounds &&
      linkBounds.left >= dropdownBounds.left - 1 &&
      linkBounds.right <= dropdownBounds.right + 1,
    )
  })).toBe(true)
})

test('keeps linked panes anchored when expanding a MyST dropdown', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'Linked pane scrolling is desktop-only')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)
  const source = page.getByRole('textbox', { name: 'MyST source' })
  const hiddenTarget = 'Hidden linked-scroll target'
  const body = Array.from(
    { length: 24 },
    (_, index) => `Methods paragraph ${index + 1} keeps the expanded body substantial.`,
  ).join('\n\n')
  const appendix = Array.from(
    { length: 12 },
    (_, index) => `Appendix paragraph ${index + 1} provides trailing rendered space.`,
  ).join('\n\n')
  await source.fill(`${sampleManuscript}

::::{dropdown} Show complete Methods

## Experimental animals

${body}

#### ${hiddenTarget}

The hidden endpoint becomes visible after expansion.
::::

## Appendix

${appendix}`)

  const dropdown = page.locator('.myst-preview details.myst-dropdown')
  const summary = dropdown.locator('summary')
  const visualTarget = dropdown.getByRole('heading', { name: hiddenTarget, includeHidden: true })
  const linkedScroll = page.locator('.pane-scroll-link')
  const centerElement = async (locator: Locator) => locator.evaluate((element) => {
    const scroller = element.closest<HTMLElement>('.cm-scroller, .preview-pane')
    if (!scroller) throw new Error('Could not find the pane scroller')
    const elementBounds = element.getBoundingClientRect()
    const scrollerBounds = scroller.getBoundingClientRect()
    scroller.scrollTop += elementBounds.top + elementBounds.height / 2 -
      (scrollerBounds.top + scroller.clientHeight / 2)
    scroller.dispatchEvent(new Event('scroll'))
  })
  const centerDistance = async (locator: Locator) => locator.evaluate((element) => {
    const scroller = element.closest<HTMLElement>('.cm-scroller, .preview-pane')
    if (!scroller) throw new Error('Could not find the pane scroller')
    const elementBounds = element.getBoundingClientRect()
    const scrollerBounds = scroller.getBoundingClientRect()
    return Math.abs(
      elementBounds.top + elementBounds.height / 2 -
      (scrollerBounds.top + scroller.clientHeight / 2),
    )
  })

  await expect(summary).toHaveText('Show complete Methods')
  await expect(visualTarget).toBeAttached()
  await linkedScroll.click()
  await expect(linkedScroll).toHaveAttribute('aria-pressed', 'false')
  await linkedScroll.click()
  await expect(linkedScroll).toHaveAttribute('aria-pressed', 'true')

  await source.focus()
  await source.press('ControlOrMeta+f')
  const find = page.getByRole('textbox', { name: 'Find' })
  await find.fill(hiddenTarget)
  await find.press('Enter')
  await page.keyboard.press('Escape')
  const sourceTarget = page.locator('.cm-line').filter({ hasText: `#### ${hiddenTarget}` }).first()

  await expect(sourceTarget).toBeVisible()
  await centerElement(sourceTarget)
  await expect.poll(() => centerDistance(summary)).toBeLessThan(80)
  await expect(visualTarget).toBeHidden()

  await summary.click()
  await expect(dropdown).toHaveAttribute('open', '')
  await expect(visualTarget).toBeVisible()
  await expect.poll(() => centerDistance(visualTarget)).toBeLessThan(80)
  await expect.poll(() => centerDistance(sourceTarget)).toBeLessThan(80)
})

test('keeps Source and Visual aligned to the same content when Split scrolling is linked', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'The linked divider control is desktop-only')
  const roomName = createRoomName(testInfo)
  await authenticateMaintainer(page, roomName, testInfo)

  const source = page.getByRole('textbox', { name: 'MyST source' })
  const visual = page.locator('.myst-preview')
  const original = 'A manuscript should be as inspectable as the analysis behind it.'
  const replacement = 'The Visual manuscript follows every accepted Source edit.'
  const renderedSpacer = '<div class="scroll-test-spacer" style="height: 900px">Rendered spacing</div>'
  await expect(source).toContainText(original)
  await source.fill(sampleManuscript
    .replace(original, replacement)
    .replace('## Results', `${renderedSpacer}\n\n## Results`))
  await expect(visual).toContainText(replacement)
  await expect(visual).not.toContainText(original)
  await expect(page.locator('.scroll-test-spacer')).toHaveCSS('height', '900px')

  const linkedScroll = page.locator('.pane-scroll-link')
  await expect(linkedScroll).toBeVisible()
  await expect(linkedScroll).toHaveAttribute('title', 'Unlink pane scrolling')
  await expect(linkedScroll).toHaveAttribute('aria-pressed', 'true')
  const previewScroller = page.locator('.preview-pane')
  const centerElement = async (locator: Locator) => locator.evaluate((element) => {
    const scroller = element.closest<HTMLElement>('.cm-scroller, .preview-pane')
    if (!scroller) throw new Error('Could not find the pane scroller')
    const elementBounds = element.getBoundingClientRect()
    const scrollerBounds = scroller.getBoundingClientRect()
    scroller.scrollTop += elementBounds.top + elementBounds.height / 2 -
      (scrollerBounds.top + scroller.clientHeight / 2)
    scroller.dispatchEvent(new Event('scroll'))
  })
  const centerDistance = async (locator: Locator) => locator.evaluate((element) => {
    const scroller = element.closest<HTMLElement>('.cm-scroller, .preview-pane')
    if (!scroller) throw new Error('Could not find the pane scroller')
    const elementBounds = element.getBoundingClientRect()
    const scrollerBounds = scroller.getBoundingClientRect()
    return Math.abs(
      elementBounds.top + elementBounds.height / 2 -
      (scrollerBounds.top + scroller.clientHeight / 2),
    )
  })
  const sourceHeading = (heading: string) => page.locator('.cm-line')
    .filter({ hasText: `## ${heading}` }).first()
  const visualHeading = (heading: string) => visual.getByRole('heading', {
    level: 2,
    name: heading,
  })

  await centerElement(sourceHeading('Results'))
  await expect.poll(() => centerDistance(visualHeading('Results'))).toBeLessThan(60)

  await linkedScroll.click()
  await expect(linkedScroll).toHaveAttribute('aria-pressed', 'false')
  await expect(linkedScroll).toHaveAttribute('title', 'Link pane scrolling')
  const independentPreviewTop = await previewScroller.evaluate((element) => element.scrollTop)
  await centerElement(sourceHeading('Introduction'))
  await page.waitForTimeout(100)
  expect(await previewScroller.evaluate((element) => element.scrollTop))
    .toBeCloseTo(independentPreviewTop, 1)

  await linkedScroll.click()
  await expect(linkedScroll).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => centerDistance(visualHeading('Introduction'))).toBeLessThan(60)

  await centerElement(visualHeading('A simple model'))
  await expect.poll(() => centerDistance(sourceHeading('A simple model'))).toBeLessThan(60)

  const splitDivider = await linkedScroll.boundingBox()
  await page.getByTitle('Open comments').click()
  await expect(page.getByRole('complementary', { name: 'Comments' })).toBeVisible()
  const reviewDivider = await linkedScroll.boundingBox()
  expect(splitDivider).not.toBeNull()
  expect(reviewDivider).not.toBeNull()
  if (splitDivider && reviewDivider) expect(reviewDivider.x).toBeLessThan(splitDivider.x - 100)
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  }))
  await centerElement(visualHeading('Results'))
  await expect.poll(() => centerDistance(sourceHeading('Results'))).toBeLessThan(140)
  await page.getByTitle('Close comments').click()

  await page.getByTitle('Source only').click()
  await expect(page.locator('.pane-scroll-link')).toHaveCount(0)
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
  await source.focus()
  await source.press('ControlOrMeta+Home')
  await expect(page.locator('.cm-activeLine')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await expect(page.locator('.cm-lineNumbers .cm-activeLineGutter')).toHaveCSS(
    'background-color',
    'rgb(241, 243, 244)',
  )
  const selectPhrase = async (selectedText = phrase) => {
    await source.focus()
    await source.press('ControlOrMeta+Home')
    const targetLine = page.locator('.cm-line').filter({ hasText: selectedText }).first()
    await expect(targetLine).toBeVisible()
    const bounds = await targetLine.evaluate((line, selectedText) => {
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
    }, selectedText)
    await page.mouse.move(bounds.left + 1, bounds.y)
    await page.mouse.down()
    await page.mouse.move(bounds.right - 1, bounds.y, { steps: 8 })
    await page.mouse.up()
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    }))
    await expect(page.locator('.cm-selectionBackground')).not.toHaveCount(0)
  }

  await selectPhrase('MyST')
  await expect(page.locator('.cm-selectionMatch')).not.toHaveCount(0)
  await expect(page.locator('.cm-selectionMatch').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await selectPhrase()
  await expect(page.locator('.cm-selectionBackground').first()).toHaveCSS(
    'background-color',
    'rgb(183, 216, 246)',
  )
  await source.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(phrase)

  await source.press('ControlOrMeta+x')
  await expect(source).not.toContainText('# A shared language')
  await source.press('ControlOrMeta+z')
  await expect(source).toContainText('# A shared language')

  await source.press('ControlOrMeta+Alt+M')
  const comments = page.getByRole('complementary', { name: 'Comments' })
  await comments.getByRole('textbox', { name: 'New comment' }).fill('Selected phrase comment')
  await comments.getByRole('button', { name: 'Comment', exact: true }).click()
  await page.getByTitle('Close comments').click()
  await expect(page.locator('.cm-comment-anchor').filter({ hasText: phrase })).toHaveCount(1)

  await page.getByRole('button', { name: 'Format', exact: true }).click()
  await page.getByRole('menu', { name: 'Format menu' })
    .getByRole('menuitem', { name: 'Bold' })
    .click()
  await expect(source).toContainText('# **A shared** language')

  await source.press('ControlOrMeta+z')
  await source.press('ControlOrMeta+End')
  await source.press('ControlOrMeta+v')
  await expect.poll(async () => ((await source.textContent())?.match(/A shared/g) ?? []).length)
    .toBe(2)
})

test('preserves rendered text selection in the continuous visual editor', async ({ page }, testInfo) => {
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
  await expect(page.getByRole('textbox', { name: 'Formatted manuscript' })).toBeFocused()
  await expect(page.locator('.visual-inline-editor')).toHaveCount(0)

  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await paragraph.click()
  await expect(page.getByRole('textbox', { name: 'Formatted manuscript' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Formatted manuscript' })).toBeVisible()
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
