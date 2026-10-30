import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const before = process.argv.includes('--before')
const base = 'http://127.0.0.1:9878'
const output = fileURLToPath(new URL(before ? '../../.tmp/ui-detail-before/' : '../../docs/screenshots/ui-detail/', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
context.setDefaultTimeout(10000)
const page = await context.newPage()
const captures = [], errors = [], checks = []
page.on('pageerror', e => errors.push(e.message))
await mkdir(output, { recursive: true })
async function capture(name, axe = false) {
  await page.screenshot({ path: output + name + '.png' })
  captures.push({ name, ...await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll('.provider-card,.entity-card,.volume-chapters,.modal-heading')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className) })) })
  if (axe) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    checks.push({ name, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })) })
  }
}
try {
  await page.goto(base)
  await page.getByRole('button', { name: '新建小说', exact: true }).waitFor()
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('ui-polish-preview-20261030')) throw new Error('Refusing author workspace')
    const get = async path => (await fetch('/api/v1' + path)).json()
    const post = async (path, body) => {
      const r = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('Fixture: ' + path + ' ' + r.status)
      return r.json()
    }
    const title = '长内容界面验收：在没有名字的港口寻找一封迟到七年的信'
    const novel = (await get('/novels')).find(n => n.title === title) || await post('/novels', { title, genre: '悬疑推理', premise: '林舟返回雾港，沿着一封没有署名的信追查父亲失踪的真相。' })
    const path = '/novels/' + novel.id
    if (!(await get(path + '/plans')).length) {
      await post(path + '/plans', { level: 'book', title, body: '以港口失踪案为主线，逐步揭开信件和旧航线的秘密。' })
      await post(path + '/plans', { level: 'volume', title: '第一卷：雾港旧事与没有名字的船', body: '主角调查旧码头，发现记录中的时间矛盾。' })
      for (const [i, name] of ['一封迟到七年的信和再也没有响起的码头钟声', '没有名字的船', '守夜人的秘密'].entries()) {
        await post(path + '/chapters', { title: `第${i + 1}章 ${name}`, volume: '第一卷：雾港旧事与没有名字的船', goal: '【本章目标】林舟带着旧信回到码头，寻找当年的守夜人。\n【冲突】登记册缺失一页，守夜人却坚持说那天从未有船靠岸。\n【推进】通过潮汐时间核对证词，在旧仓库发现船票。\n【结尾】船票上的日期是明天。' })
      }
      for (const name of ['林舟', '旧码头的守夜人：一个知道所有船期却从不离开钟楼的人', 'ArchiveKeeperWithoutRegisteredName']) {
        await post(path + '/entities', { kind: 'character', name, summary: '守着一份不能交出的旧名单。他需要在保护旧友与帮助主角之间做出选择。', body: '身份：旧港口档案员。\n动机：查明七年前的真相。\n限制：不能离开雾港。', aliases: ['第七航线登记员', 'TheKeeperOfTheForgottenHarborRecords'], status: 'author' })
      }
    }
    const providers = await get('/providers')
    const provider = providers.find(p => p.name === '长名称连接验收') || await post('/providers', { name: '长名称连接验收', model: 'fiction-writer-with-long-model-identifier-and-extended-context-window-test', base_url: 'https://example.invalid/compatibility/long-endpoint-prefix/v1' })
    return { novel: novel.id, provider: provider.id }
  })
  // Fixture requests bypass QueryClient; start views with an authoritative cache.
  await page.reload()
  for (const [size, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.goto(`${base}/#/plot/${ids.novel}`)
    await page.getByRole('button', { name: /分卷大纲/ }).click()
    await page.locator('.chapter-table-row').first().waitFor()
    if (size === 'mobile') await page.locator('.volume-chapters').scrollIntoViewIfNeeded()
    await capture('planning-' + size, !before && size === 'mobile')
    if (!before && size === 'mobile') await expect(page.locator('.chapter-table-row').first().locator('p')).toBeVisible()
    await page.goto(`${base}/#/bible/${ids.novel}`)
    await page.locator('.entity-card').first().waitFor()
    await capture('story-' + size, !before && size === 'mobile')
    await page.locator('.entity-card').nth(1).click()
    const entity = page.getByRole('dialog')
    await capture('entity-dialog-' + size)
    if (!before) await expect(entity.getByRole('button', { name: '保存档案', exact: true })).toBeInViewport()
    await expect(entity.getByRole('button', { name: '关闭对话框', exact: true })).toBeVisible()
    await entity.getByRole('button', { name: '关闭对话框', exact: true }).click()
    await page.goto(`${base}/#/settings`)
    await page.getByRole('heading', { name: '长名称连接验收', exact: true }).waitFor()
    await capture('settings-' + size, !before && size === 'mobile')
    await page.getByRole('button', { name: '配置连接', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '配置模型连接', exact: true })
    await capture('provider-dialog-' + size, !before && size === 'mobile')
    if (!before) {
      await expect(dialog.getByRole('button', { name: '保存连接', exact: true })).toBeInViewport()
      await dialog.getByText('环境变量与协议选项', { exact: true }).click()
      await dialog.getByLabel('配置有来源日期的价格，用于费用预估').check()
      await expect(dialog.getByRole('button', { name: '保存连接', exact: true })).toBeInViewport()
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
    } else await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
  }
  if (!before) {
    await page.goto(`${base}/#/bible/${ids.novel}`)
    await page.getByRole('button', { name: /故事记忆/ }).click()
    await page.getByRole('textbox', { name: '搜索故事档案' }).fill('不存在的关键词')
    await expect(page.getByRole('heading', { name: '没有找到相关记忆', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await expect(page.getByRole('heading', { name: '还没有本章记忆', exact: true })).toBeVisible()
    // Save through the bounded form, including keyboard access in a short viewport.
    await page.getByRole('button', { name: /^人物/ }).click()
    const card = page.locator('.entity-card').first()
    await card.click()
    await page.setViewportSize({ width: 390, height: 540 })
    const editor = page.getByRole('dialog')
    const summary = '界面验收：保存编辑后的档案，重新打开仍可读取。'
    await editor.getByLabel('一句话简述', { exact: true }).fill(summary)
    await editor.getByLabel('详细档案', { exact: true }).click()
    await page.keyboard.press('Tab')
    await expect(editor.getByRole('button', { name: '取消', exact: true })).toBeFocused()
    await expect(editor.getByRole('button', { name: '保存档案', exact: true })).toBeInViewport()
    await editor.getByRole('button', { name: '保存档案', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await page.reload()
    await page.locator('.entity-card').filter({ hasText: summary }).click()
    await expect(page.getByRole('dialog').getByLabel('一句话简述', { exact: true })).toHaveValue(summary)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.entity-card').filter({ hasText: summary })).toBeFocused()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${base}/#/settings`)
    await page.getByRole('button', { name: '配置连接', exact: true }).click()
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: '长名称连接验收', exact: true })).toBeVisible()
  }
  await writeFile(output + 'checks.json', JSON.stringify({ captures, checks, errors, realModelCalls: 0 }, null, 2) + '\n')
  console.log(JSON.stringify({ captures, checks, errors }, null, 2))
  if (!before && (errors.length || captures.some(c => c.documentWidth > c.width || c.overflowing.length) || checks.some(c => c.violations.length))) process.exitCode = 1
} finally { await browser.close() }
