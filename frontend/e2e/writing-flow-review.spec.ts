import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  return page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function write(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Review fixture: ${response.status}`)
      return response.json()
    }
    const novel = await write('/novels', { title: '雾港 · 流程复查', chapter_words: 2200 })
    const path = `/novels/${novel.id}`
    const first = await write(path + '/chapters', { title: '未定稿的前章' })
    await write(path + `/chapters/${first.id}/versions`, { base_version_id: first.working_version_id, operation_id: crypto.randomUUID(), text: '这是尚未确认的前章草稿。' })
    const second = await write(path + '/chapters', { title: '先起草的后章', goal: '林舟在客栈问路。' })
    const a = await write(path + '/entities', { kind: 'character', name: '林舟' })
    const b = await write(path + '/entities', { kind: 'character', name: '守塔人' })
    const relation = await write(path + '/relations', { source_id: a.id, target_id: b.id, relation_type: '旧识', description: '原来的关系描述。' })
    return { novel: novel.id as string, chapter: second.id as string, relation, person: a.id as string }
  })
}

async function assistant(page: Page) {
  const open = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await open.isVisible()) await open.click()
  return page.locator('.assistant-panel:visible')
}

test('前章未定稿可起草场景，短续写与整章要求互不混淆', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toBeVisible()
  const panel = await assistant(page)
  await panel.getByRole('button', { name: '续写200字', exact: true }).click()
  await expect(panel.getByRole('combobox', { name: '目标字数', exact: true })).toHaveValue('200')
  await panel.getByRole('button', { name: '写完整章', exact: true }).click()
  await expect(panel.getByRole('combobox', { name: '目标字数', exact: true })).toHaveValue('2200')
  await panel.getByRole('button', { name: '写一个场景', exact: true }).click()
  await panel.getByRole('textbox', { name: '本场要发生什么', exact: true }).fill('林舟在客栈问到去灯塔的路。')
  await panel.getByRole('button', { name: '生成场景草稿', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '采纳正文', exact: true }).click()
  await expect.poll(async () => page.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)).json()).char_count, ids)).toBeGreaterThan(0)
})

test('关系编辑冲突保留本页修改并合并未改字段，键盘与手机可以操作', async ({ page }, info) => {
  const ids = await fixture(page)
  await page.goto(`/#/bible/${ids.novel}`)
  await page.getByRole('button', { name: /^关系图谱/ }).click()
  const graph = page.locator('.relationship-graph-container')
  if (info.project.name === 'desktop') await graph.getByRole('button', { name: '查看人物关系：林舟', exact: true }).press('Enter')
  else await graph.getByRole('combobox', { name: '查看人物关系', exact: true }).selectOption(ids.person)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await graph.getByRole('button', { name: '编辑关系', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑人物关系', exact: true })
  const description = dialog.getByRole('textbox', { name: '关系与恩怨详情（可选）', exact: true })
  await description.fill('本窗口希望保留的新描述。')
  await page.evaluate(async ids => {
    const response = await fetch(`/api/v1/novels/${ids.novel}/relations/${ids.relation.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_updated_at: ids.relation.updated_at, relation_type: '师徒', bidirectional: false }) })
    if (!response.ok) throw new Error('Concurrent relation update failed')
  }, ids)
  await dialog.getByRole('button', { name: '保存关系', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('其他窗口更新')
  await expect(description).toHaveValue('本窗口希望保留的新描述。')
  await dialog.getByRole('button', { name: '读取最新关系并保留本页修改', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '关系类型', exact: true })).toHaveValue('师徒')
  await expect(description).toHaveValue('本窗口希望保留的新描述。')
  await dialog.getByRole('button', { name: '保存关系', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(graph).toContainText('本窗口希望保留的新描述。')
  await graph.getByRole('combobox', { name: '查看人物关系', exact: true }).selectOption(ids.relation.target_id)
  await expect(graph).toContainText('本窗口希望保留的新描述。')
  const scan = await new AxeBuilder({ page }).include('.relationship-graph-container').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(scan.violations).toEqual([])
  await page.evaluate(() => document.querySelector('.page-scroll')?.scrollTo(0, 0))
  if (info.project.name === 'mobile') await expect(graph.locator('.selected-character-inspector strong').first()).toBeInViewport()
  await page.screenshot({ path: info.outputPath('relations-review.png') })
})

test('服务预设不带入另一服务的临时密钥，免密钥本机连接可选', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: '添加模型连接', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加模型连接', exact: true })
  await dialog.getByRole('combobox', { name: '从常用服务商一键填入预设', exact: true }).selectOption('deepseek')
  const secret = dialog.getByLabel('API Key', { exact: true })
  await secret.fill('test-only-not-a-real-key')
  await dialog.getByRole('combobox', { name: '从常用服务商一键填入预设', exact: true }).selectOption('ollama-local')
  await expect(secret).toHaveValue('')
  await dialog.getByRole('textbox', { name: '模型 ID', exact: true }).fill('local-test')
  await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('本机服务 · 可免密钥', { exact: true }).first()).toBeVisible()
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toBeVisible()
  const panel = await assistant(page)
  const choices = panel.getByRole('combobox', { name: '写作模型', exact: true })
  await expect(choices).toContainText('本机 Ollama')
  const providerId = await page.evaluate(async () => (await (await fetch('/api/v1/providers')).json()).find((item: { name: string }) => item.name === '本机 Ollama').id as string)
  await choices.selectOption(providerId)
  await expect(panel.getByRole('button', { name: '生成本章正文', exact: true })).toBeEnabled()
  await page.evaluate(async () => {
    const response = await fetch('/api/v1/roles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writer: 'demo', planner: 'demo', extractor: 'demo', reviewer: 'demo' }) })
    if (!response.ok) throw new Error('Could not restore demo roles')
  })
  // No local model server is contacted by this browser test.
})
