import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Local visual QA only. Never creates fixtures in the author's workspace.
const base = 'http://127.0.0.1:9877'
const output = fileURLToPath(new URL('../../docs/screenshots/closeout/', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext()
const page = await context.newPage()
const errors = [], captures = []
page.on('pageerror', e => errors.push(e.message))
await mkdir(output, { recursive: true })
try {
  await page.goto(base)
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('closeout-preview-')) throw new Error('Refusing author workspace')
    const response = await fetch('/api/v1/demo', { method: 'POST' })
    if (!response.ok) throw new Error('Demo fixture failed')
    const novel = await response.json()
    const chapters = await (await fetch(`/api/v1/novels/${novel.id}/chapters`)).json()
    const novels = await (await fetch('/api/v1/novels')).json()
    if (!novels.some(n => n.title === '长街灯未眠')) {
      await fetch('/api/v1/novels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '长街灯未眠', genre: '都市', premise: '旧街拆迁的最后三十天，钟表修理师收到一只每天倒走一分钟的怀表。' }) })
    }
    return { novel: novel.id, chapter: chapters[0].id }
  })
  for (const [device, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height })
    for (const [name, hash, ready] of [
      ['library', '#/library', '.library-book'],
      ['editor', `#/write/${ids.novel}/${ids.chapter}`, '[contenteditable="true"]'],
      ['planning', `#/plot/${ids.novel}`, '.book-heading'],
      ['characters', `#/bible/${ids.novel}`, '.page-tabs'],
      ['settings', '#/settings', '.settings-section'],
    ]) {
      await page.goto(base + '/' + hash)
      await page.locator(ready).first().waitFor()
      await page.locator('.loading-state').waitFor({ state: 'hidden' })
      await page.evaluate(() => document.fonts.ready)
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }))
      if (device === 'mobile' && name === 'characters') {
        const cards = await page.locator('.entity-card').all()
        if (cards.length > 1) {
          const first = await cards[0].boundingBox(), second = await cards[1].boundingBox()
          if (!first || !second || second.y < first.y + first.height) throw new Error('人物卡片在手机上必须单列')
        }
      }
      if (device === 'mobile' && name === 'planning') {
        const wraps = await page.locator('.studio-tabs > button').evaluateAll(buttons => buttons.some(button => [...button.childNodes].some(node => {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) return false
          const range = document.createRange(); range.selectNodeContents(node)
          return range.getClientRects().length > 1
        })))
        if (wraps) throw new Error('规划页签文字发生拆行')
      }
      await page.screenshot({ path: output + `${name}-${device}.png` })
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      captures.push({ name, device, ...sizes, violations: audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })) })
    }
  }
  const report = { captures, errors }
  await writeFile(output + 'checks.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (errors.length || captures.some(c => c.width > c.viewport || c.violations.length)) throw new Error('Visual QA failed; see closeout/checks.json')
} finally { await browser.close() }
