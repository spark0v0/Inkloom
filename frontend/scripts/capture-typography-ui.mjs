import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Use only a disposable preview workspace, never the author's running service.
const base = process.argv[2] ?? 'http://127.0.0.1:9881'
const output = fileURLToPath(new URL('../../docs/screenshots/typography/', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = [], externalRequests = [], captures = [], accessibility = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { if (new URL(request.url()).origin !== new URL(base).origin) externalRequests.push(request.url()) })
async function capture(name, check = false) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: output + name + '.png', timeout: 10000 })
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }))
  if (dimensions.width > dimensions.viewport) throw new Error(`${name}: horizontal page overflow`)
  if (name.startsWith('editor-')) {
    const clipped = await page.locator('.editor-toolbar button:visible, .editor-toolbar select:visible').evaluateAll(elements => elements.filter(element => {
      const rect = element.getBoundingClientRect()
      return rect.left < 0 || rect.right > innerWidth
    }).map(element => element.getAttribute('aria-label')))
    if (clipped.length) throw new Error(`${name}: clipped toolbar controls ${clipped.join(', ')}`)
  }
  captures.push({ name, ...dimensions })
  if (check) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    accessibility.push({ name, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) })
  }
}
try {
  await mkdir(output, { recursive: true })
  await page.goto(base)
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor()
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('typography-')) throw new Error('Dedicated typography preview workspace required')
    const novels = await (await fetch('/api/v1/novels')).json()
    if (novels.length !== 1 || !novels[0].is_demo) throw new Error('Dedicated demo required')
    const chapters = await (await fetch(`/api/v1/novels/${novels[0].id}/chapters`)).json()
    return { novel: novels[0].id, chapter: chapters[0].id }
  })
  await page.locator('.library-book').waitFor()
  await capture('library-desktop', true)
  const editorUrl = `${base}/#/write/${ids.novel}/${ids.chapter}`
  await page.goto(editorUrl)
  const editor = page.getByRole('textbox', { name: '小说正文', exact: true })
  await editor.waitFor()
  await page.locator('.assistant-form').waitFor()
  const manuscript = await editor.innerText()
  await expect(page.getByLabel('正文字体', { exact: true })).toHaveValue('sans')
  await capture('editor-desktop', true)
  await page.getByLabel('正文字体', { exact: true }).selectOption('serif')
  await page.getByLabel('正文字号', { exact: true }).selectOption('20')
  await page.reload()
  await expect(page.getByLabel('正文字体', { exact: true })).toHaveValue('serif')
  await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('20')
  await expect(editor).toHaveCSS('font-size', '20px')
  await expect(editor).toHaveText(manuscript, { useInnerText: true })
  await page.getByLabel('正文字体', { exact: true }).selectOption('sans')
  await page.getByLabel('正文字号', { exact: true }).selectOption('18')
  await page.setViewportSize({ width: 768, height: 1024 })
  await capture('editor-tablet')
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('editor-mobile', true)
  await page.getByRole('button', { name: '打开写作助手', exact: true }).click()
  await page.getByRole('dialog', { name: 'AI 写作', exact: true }).waitFor()
  await capture('assistant-mobile', true)
  await page.getByRole('dialog', { name: 'AI 写作', exact: true }).getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/#/settings`)
  await page.getByRole('heading', { name: '模型设置', exact: true }).waitFor()
  await capture('settings-desktop', true)
  const fonts = await page.evaluate(() => [...document.fonts].map(f => ({ family: f.family, weight: f.weight, status: f.status })))
  const bodyFont = await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)
  const report = { captures, accessibility, preferences: 'persisted after reload; manuscript unchanged', bodyFont, fonts, externalRequests, errors }
  await writeFile(output + 'verification.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (!fonts.some(f => f.family.replace(/["']/g, '') === 'Inkloom UI' && f.status === 'loaded')) throw new Error('Local UI font did not load')
  if (errors.length || externalRequests.length || accessibility.some(a => a.violations.length)) process.exitCode = 1
} finally { await browser.close() }
