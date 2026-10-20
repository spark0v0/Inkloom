import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const output = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url))
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const origin = 'http://127.0.0.1:8765'
const report = { date: new Date().toISOString(), browser: browser.version(), viewports: [] }
try {
  await page.goto(origin)
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor()
  await page.locator('.library-page .loading-state').waitFor({ state: 'hidden' })
  const demo = page.locator('.novel-feature').filter({ hasText: '示例作品' })
  if (!await demo.count()) {
    const open = page.getByRole('button', { name: '打开示例作品', exact: true })
    if (await open.count()) await open.click()
    else await page.getByRole('button', { name: '载入示例作品，熟悉候选稿与正史流程' }).click()
    await page.getByRole('textbox', { name: '小说正文' }).waitFor()
    await page.goto(origin + '/#/library')
  }
  await demo.first().waitFor()
  await page.screenshot({ path: resolve(output, 'library-desktop.png') })
  await demo.first().getByRole('button', { name: '继续创作', exact: true }).click()
  await page.getByRole('textbox', { name: '小说正文' }).waitFor()
  const editorUrl = page.url()
  await page.screenshot({ path: resolve(output, 'editor-desktop.png') })
  await page.getByRole('button', { name: '故事档案', exact: true }).click()
  await page.locator('.entity-card').first().waitFor()
  await page.screenshot({ path: resolve(output, 'story-bible-desktop.png') })
  for (const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844]]) {
    await page.setViewportSize({ width, height })
    await page.goto(editorUrl)
    await page.getByRole('textbox', { name: '小说正文' }).waitFor()
    const measure = await page.evaluate(() => ({ width: innerWidth, bodyWidth: document.body.scrollWidth, editorWidth: document.querySelector('.editor-panel').getBoundingClientRect().width }))
    if (measure.bodyWidth > width || measure.editorWidth < 250) throw new Error(`Layout failed at ${width}`)
    report.viewports.push({ width, height, ...measure })
    if (width === 390) {
      await page.screenshot({ path: resolve(output, 'editor-mobile.png') })
      await page.getByRole('button', { name: '打开写作助手', exact: true }).click()
      await page.getByRole('dialog', { name: '写作助手', exact: true }).waitFor()
      await page.screenshot({ path: resolve(output, 'assistant-mobile.png') })
    }
  }
  writeFileSync(resolve(output, 'viewport-checks.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
