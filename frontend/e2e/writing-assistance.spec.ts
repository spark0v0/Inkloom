import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { resolve } from 'node:path'

const prefix = '前文🙂。'
const quote = '林舟收起地图，推开了门。'
const suffix = '他没有回头，街上的钟声仍在继续。'

async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  const ids = await page.evaluate(async text => {
    const post = async (path: string, body: object) => {
      const r = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('Fixture failed: ' + r.status)
      return r.json()
    }
    const novel = await post('/novels', { title: '写作助手验收' })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '第一章' })
    const version = await post(`/novels/${novel.id}/chapters/${chapter.id}/versions`, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text })
    return { novel: novel.id, chapter: chapter.id, version: version.id }
  }, prefix + quote + suffix)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.locator('.editor-panel')).toBeVisible()
  return ids
}

async function assistant(page: Page) {
  await expect(page.locator('.editor-panel')).toBeVisible()
  const open = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await open.isVisible()) await open.click()
  return page.locator('.assistant-panel:visible')
}

async function selectText(page: Page) {
  await page.locator('.manuscript-content p').first().evaluate((element, text) => {
    const node = element.firstChild!
    const start = node.textContent!.indexOf(text)
    if (start < 0) throw new Error('Selection text missing')
    const range = document.createRange()
    range.setStart(node, start); range.setEnd(node, start + text.length)
    const selected = window.getSelection()!
    selected.removeAllRanges(); selected.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, quote)
  await expect(page.getByRole('group', { name: '选段快捷操作', exact: true })).toBeVisible()
}

async function jobs(page: Page, novel: string) {
  return page.evaluate(async novel => (await (await fetch(`/api/v1/jobs/page?novel_id=${novel}`)).json()).items, novel)
}

test('本书风格保存恢复，引用资料可核对，模板和保存不调用模型', async ({ page }, info) => {
  const ids = await fixture(page)
  const panel = await assistant(page)
  await panel.getByRole('button', { name: /写作风格/ }).click()
  const dialog = page.getByRole('dialog', { name: '写作风格', exact: true })
  await dialog.getByRole('button', { name: '紧凑悬念', exact: true }).click()
  await dialog.getByLabel('叙述视角', { exact: true }).selectOption('first_person')
  await dialog.getByText('作者示例（只参考文风）', { exact: true }).click()
  await dialog.getByLabel('表达示例', { exact: true }).fill('示例中的银钥匙仅作表达参考。')
  const contentBox = (await dialog.locator('.writing-style-scroll').boundingBox())!
  const actionsBox = (await dialog.locator('.modal-actions').boundingBox())!
  expect(contentBox.y + contentBox.height).toBeLessThanOrEqual(actionsBox.y)
  expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await page.screenshot({ path: resolve(`../docs/screenshots/writing-style-${info.project.name}.png`) })
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map(v => v.id)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await dialog.getByRole('button', { name: '保存风格', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await jobs(page, ids.novel)).toEqual([])
  await page.reload()
  const restored = await assistant(page)
  await restored.getByRole('button', { name: /写作风格/ }).click()
  await expect(dialog.getByLabel('叙述视角', { exact: true })).toHaveValue('first_person')
  await dialog.getByText('作者示例（只参考文风） · 已填写', { exact: true }).click()
  await expect(dialog.getByLabel('表达示例', { exact: true })).toHaveValue('示例中的银钥匙仅作表达参考。')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await restored.getByRole('button', { name: '查看将引用的资料', exact: true }).click()
  const context = page.getByRole('dialog', { name: '本次引用资料', exact: true })
  await context.getByText('本次写作风格', { exact: true }).click()
  await expect(context.locator('.context-writing-style')).toContainText('第一人称')
  await expect(context.locator('.context-writing-style')).toContainText('表达示例 · 非故事事实')
  expect(await jobs(page, ids.novel)).toEqual([])
})

test('文风双窗口冲突保留输入，可比较最新风格后保存', async ({ page }) => {
  const ids = await fixture(page)
  await (await assistant(page)).getByRole('button', { name: /写作风格/ }).click()
  const other = await page.context().newPage()
  await other.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await (await assistant(other)).getByRole('button', { name: /写作风格/ }).click()
  const a = page.getByRole('dialog', { name: '写作风格', exact: true })
  const b = other.getByRole('dialog', { name: '写作风格', exact: true })
  await b.getByLabel('语言与节奏', { exact: true }).fill('第二窗口未保存的节奏要求。')
  await a.getByLabel('语言与节奏', { exact: true }).fill('第一窗口的新文风。')
  await a.getByRole('button', { name: '保存风格', exact: true }).click()
  await expect(a).not.toBeVisible()
  await b.getByRole('button', { name: '保存风格', exact: true }).click()
  await expect(b.getByRole('alert')).toContainText('已在其他窗口更新')
  await expect(b.getByLabel('语言与节奏', { exact: true })).toHaveValue('第二窗口未保存的节奏要求。')
  await b.getByRole('button', { name: '读取最新风格', exact: true }).click()
  await b.getByText('查看当前已保存风格', { exact: true }).click()
  await expect(b).toContainText('第一窗口的新文风。')
  await b.getByRole('button', { name: '保存风格', exact: true }).click()
  await expect(b).not.toBeVisible()
  const novel = await other.evaluate(async novel => (await (await fetch(`/api/v1/novels/${novel}`)).json()), ids.novel)
  expect(novel.style).toBe('第二窗口未保存的节奏要求。')
  await other.close()
})

test('选段快捷操作仅准备，旧版本拒绝生成，明确生成采纳保留段外文字', async ({ page }, info) => {
  const ids = await fixture(page)
  let submitted: { selection: { start_codepoint: number; text: string }; task: string } | undefined
  await page.route(`**/api/v1/novels/${ids.novel}/jobs`, async route => {
    if (route.request().method() === 'POST') submitted = route.request().postDataJSON()
    await route.continue()
  })
  await selectText(page)
  await page.screenshot({ path: resolve(`../docs/screenshots/selection-actions-${info.project.name}.png`) })
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map(v => v.id)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const prepare = page.getByRole('button', { name: '准备扩写选段', exact: true })
  if (info.project.name === 'desktop') await prepare.press('Enter')
  else await prepare.click()
  await expect(page.getByRole('status').filter({ hasText: '已准备扩写' })).toBeVisible()
  expect(submitted).toBeUndefined()
  expect(await jobs(page, ids.novel)).toEqual([])
  await page.evaluate(async ids => {
    const r = await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_version_id: ids.version, operation_id: crypto.randomUUID(), text: '前文🙂。林舟收起地图，推开了门。他没有回头，街上的钟声仍在继续。新增的后记。' }) })
    if (!r.ok) throw new Error('Concurrent edit failed')
  }, ids)
  await page.getByRole('button', { name: '生成扩写候选', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '正文已更新' })).toBeVisible()
  expect(submitted).toBeUndefined()
  await page.reload()
  await expect(page.locator('.editor-panel')).toBeVisible()
  await selectText(page)
  await page.getByRole('button', { name: '准备扩写选段', exact: true }).click()
  await page.getByRole('button', { name: '生成扩写候选', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  expect(submitted?.task).toBe('rewrite')
  expect(submitted?.selection).toMatchObject({ start_codepoint: Array.from(prefix).length, text: quote })
  await page.getByRole('button', { name: '采纳正文', exact: true }).click()
  await expect.poll(async () => (await jobs(page, ids.novel)).some((job: { candidate_status: string }) => job.candidate_status === 'adopted')).toBe(true)
  const saved = await page.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)).json()).version.text as string, ids)
  expect(saved.startsWith(prefix)).toBe(true)
  expect(saved.endsWith(suffix + '新增的后记。')).toBe(true)
  expect(saved).toContain('没有把那个问题立刻问出口')
})
