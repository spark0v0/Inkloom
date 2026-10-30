import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Preview data lives in a dedicated workspace; never run fixtures against data/.
const base = 'http://127.0.0.1:9878'
const output = fileURLToPath(new URL('../../docs/screenshots/ui-polish/', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = [], captures = [], accessibility = []
page.on('pageerror', e => errors.push(e.message))
await mkdir(output, { recursive: true })
async function capture(name, check = false) {
  await page.screenshot({ path: output + name + '.png' })
  captures.push({ name, ...await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, height: innerHeight })) })
  if (check) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    accessibility.push({ name, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })) })
  }
}
try {
  await page.goto(base)
  await page.getByRole('button', { name: '新建小说', exact: true }).waitFor()
  const health = await page.evaluate(async () => (await fetch('/api/v1/health')).json())
  if (!health.workspace_name.startsWith('ui-polish-preview-')) throw new Error('Refusing author workspace')
  await capture('library-initial')
  const ids = await page.evaluate(async () => {
    const r = await fetch('/api/v1/demo', { method: 'POST' })
    if (!r.ok) throw new Error('Demo fixture failed')
    const novel = await r.json()
    const chapters = await (await fetch(`/api/v1/novels/${novel.id}/chapters`)).json()
    return { novel: novel.id, chapter: chapters[0].id }
  })
  await page.reload()
  await page.locator('.library-book').first().waitFor()
  await capture('library-desktop', true)
  await page.getByRole('button', { name: '已归档', exact: true }).click()
  await expect(page.getByRole('heading', { name: '没有归档作品', exact: true })).toBeVisible()
  await capture('library-empty', true)
  await page.goto(`${base}/#/write/${ids.novel}/${ids.chapter}`)
  const editor = page.getByRole('textbox', { name: '小说正文', exact: true })
  await editor.waitFor()
  await page.locator('.assistant-form').waitFor()
  await capture('editor-desktop', true)
  const text = await editor.innerText()
  const initialWidth = await editor.evaluate(e => e.getBoundingClientRect().width)
  await page.getByRole('button', { name: '收起章节目录', exact: true }).click()
  await expect(page.locator('.desktop-directory')).toBeHidden()
  await expect(editor).toHaveText(text, { useInnerText: true })
  if (await editor.evaluate(e => e.getBoundingClientRect().width) < initialWidth) throw new Error('Collapsing directory reduced writing room')
  await page.getByRole('button', { name: '收起写作助手', exact: true }).click()
  await expect(page.locator('.desktop-assistant')).toHaveCount(0)
  await capture('editor-focused-panes')
  await page.getByRole('button', { name: '展开章节目录', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.desktop-directory')).toBeVisible()
  await page.getByRole('button', { name: '展开写作助手', exact: true }).click()
  await page.setViewportSize({ width: 768, height: 1024 })
  await capture('editor-tablet')
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('editor-mobile', true)
  await page.getByRole('button', { name: '打开章节目录', exact: true }).click()
  const directory = page.getByRole('dialog', { name: '章节目录', exact: true })
  await expect(directory.getByRole('textbox', { name: '搜索章节' })).toBeVisible()
  await directory.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('button', { name: '打开写作助手', exact: true }).click()
  const assistant = page.getByRole('dialog', { name: 'AI 写作', exact: true })
  await expect(assistant.getByRole('button', { name: '找灵感', exact: true })).toBeVisible()
  await capture('assistant-mobile', true)
  await assistant.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.goto(base)
  await page.locator('.library-book').first().waitFor()
  await capture('library-mobile', true)
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.goto(`${base}/#/plot/${ids.novel}`)
    await page.getByRole('button', { name: '编辑作品', exact: true }).waitFor()
    await expect(page.locator('.loading-state')).toHaveCount(0)
    await capture('planning-' + name, true)
    await page.goto(`${base}/#/plot/${ids.novel}/${ids.chapter}`)
    await page.getByRole('button', { name: '保存细纲', exact: true }).waitFor()
    await capture('outline-' + name, true)
  }
  const report = { captures, accessibility, errors, novelRoute: `/#/write/${ids.novel}/${ids.chapter}`, realModelCalls: 0 }
  await writeFile(output + 'checks.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (errors.length || captures.some(v => v.width > v.viewport) || accessibility.some(r => r.violations.length)) process.exitCode = 1
} finally { await browser.close() }
