import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// This creates Demo fixtures only in the isolated preview workspace, never in data/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(root, 'docs/screenshots')
const base = 'http://127.0.0.1:8775'
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = [], captures = []
page.on('pageerror', e => errors.push(e.message))
await mkdir(output, { recursive: true })
async function capture(name) {
  await page.screenshot({ path: path.join(output, name + '.png') })
  captures.push({ name, ...await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth })) })
}
try {
  await page.goto(base)
  const health = await page.evaluate(async () => (await fetch('/api/v1/health')).json())
  if (!health.workspace_name.startsWith('ui-v3-preview')) throw new Error('Refusing to create fixtures in a user workspace.')
  await page.getByRole('button', { name: '新建小说', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '新建小说' })
  await modal.getByLabel('书名（可以稍后由 AI 起名）').fill('雾港来信 · 交互验证')
  await modal.getByLabel('你想写一个什么故事？').fill('一封来自失踪父亲的信，让陈序重返雾港。旧码头的档案里，藏着一艘从未登记的船。')
  await modal.getByRole('button', { name: '下一步：全书方案' }).click()
  const book = page.getByRole('region', { name: 'AI 全书方案', exact: true })
  await book.getByLabel('创作模型').selectOption('demo')
  await capture('setup-v4-desktop')
  await book.getByRole('button', { name: 'AI 生成全书方案', exact: true }).click()
  await book.getByRole('button', { name: '采纳方案，规划章节' }).waitFor({ timeout: 20000 })
  await capture('blueprint-v4-desktop')
  await book.getByRole('button', { name: '采纳方案，规划章节' }).click()
  const outline = page.getByRole('region', { name: 'AI 章节细纲', exact: true })
  await outline.getByLabel('本次规划').selectOption('3')
  await outline.getByRole('button', { name: '生成 3 章细纲', exact: true }).click()
  await outline.getByRole('button', { name: '采纳这 3 章' }).click({ timeout: 20000 })
  await capture('chapters-v4-desktop')
  await page.locator('.setup-ready').getByRole('button', { name: '开始写作' }).click()
  await page.getByRole('textbox', { name: '小说正文' }).waitFor()
  await page.locator('.assistant-form').getByRole('button', { name: '生成本章正文', exact: true }).click()
  await page.locator('.candidate-host').getByRole('button', { name: '采纳正文', exact: true }).waitFor({ timeout: 20000 })
  await capture('draft-v4-desktop')
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.getByRole('button', { name: '打开写作助手', exact: true }).waitFor()
  await capture('editor-v4-tablet')
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('editor-v4-mobile')
  await page.getByRole('button', { name: '打开写作助手', exact: true }).click()
  const assistant = page.getByRole('dialog', { name: 'AI 写作', exact: true })
  await assistant.getByRole('button', { name: '采纳正文', exact: true }).waitFor()
  await assistant.locator('.candidate-area').scrollIntoViewIfNeeded()
  await capture('draft-v4-mobile')
  await assistant.getByRole('button', { name: '采纳正文', exact: true }).click()
  await assistant.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('textbox', { name: '小说正文' }).waitFor()
  await capture('manuscript-v4-mobile')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '正文', exact: true }).waitFor()
  await capture('manuscript-v4-desktop')
  const report = { captures, errors, novelRoute: page.url().replace(base, '') }
  await writeFile(path.join(output, 'v4-viewport-checks.json'), JSON.stringify(report, null, 2) + '\n')
  if (errors.length || captures.some(x => x.body > x.viewport || x.document > x.viewport)) throw new Error('Page errors or horizontal overflow; inspect v4-viewport-checks.json.')
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
