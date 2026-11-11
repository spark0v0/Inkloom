import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Closeout fixture: ${response.status}`)
      return response.json()
    }
    const novel = await post('/novels', { title: '星河档案 ABC：等待下一封来信', genre: '科幻', premise: '一名深空档案员发现一封寄自未来的信。' })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '第一章 来信' })
    await fetch('/api/v1/roles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writer: 'demo', planner: 'demo', reviewer: 'demo', extractor: 'demo' }) })
    await post('/providers', { name: '已配置但未选择的连接', base_url: 'http://127.0.0.1:1/v1', model: 'no-generation' })
    return { novel: novel.id as string, chapter: chapter.id as string }
  })
  await page.reload()
  await expect(page.locator('.library-book').filter({ hasText: '星河档案 ABC' }).first()).toBeVisible()
  return ids
}

test('书架反映实际写作模型，搜索忽略空白大小写且长书名操作可达', async ({ page }, info) => {
  await fixture(page)
  await expect(page.locator('.library-model')).toContainText('演示 · 固定样例')
  await expect(page.locator('.library-model')).not.toContainText('已配置但未选择的连接')
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: '搜索作品', exact: true }).click()
    await page.getByRole('textbox', { name: '输入搜索内容', exact: true }).fill('  ａｂｃ  ')
    await page.getByRole('button', { name: '搜索作品', exact: true }).click()
  } else await page.getByRole('textbox', { name: '搜索作品', exact: true }).fill('  ａｂｃ  ')
  const book = page.locator('.library-book').filter({ hasText: '星河档案 ABC' }).first()
  await expect(book).toBeVisible()
  await expect(book.getByRole('button', { name: '继续写作', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
})

test('继续写作等待时拒绝重复打开，离开书架后迟到结果不切回作品', async ({ page }, info) => {
  const ids = await fixture(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let reads = 0
  await page.route(`**/novels/${ids.novel}/chapters`, async route => { reads++; await held; await route.continue() })
  const book = page.locator('.library-book').filter({ hasText: '星河档案 ABC' }).first()
  try {
    await book.getByRole('button', { name: '继续写作', exact: true }).click()
    await expect(book.getByRole('button', { name: '正在打开…', exact: true })).toBeDisabled()
    await book.getByRole('button', { name: '正在打开…', exact: true }).dispatchEvent('click')
    if (info.project.name === 'mobile') await page.getByRole('button', { name: '打开主菜单', exact: true }).click()
    await page.getByRole('button', { name: '模型设置', exact: true }).click()
    await expect(page).toHaveURL(/#\/settings$/)
    release()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/#\/settings$/)
    expect(reads).toBe(1)
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }) }
})

test('已有手写章节不回到开书向导，可直接编辑细纲和补充全书规划', async ({ page }) => {
  const ids = await fixture(page)
  let generations = 0
  page.on('request', request => { if (request.method() === 'POST' && /\/jobs$/.test(request.url())) generations++ })
  await page.goto(`/#/plot/${ids.novel}`)
  await expect(page.locator('.chapter-table-row').filter({ hasText: '第一章 来信' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '创作步骤', exact: true }).getByRole('button', { name: /章节细纲$/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'AI 生成全书方案', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: '添加分卷', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '全书设定', exact: true }).click()
  await page.getByRole('button', { name: '添加大纲', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加规划', exact: true })
  await expect(dialog.getByRole('combobox', { name: '层级', exact: true })).toHaveValue('book')
  await dialog.getByRole('textbox', { name: '标题', exact: true }).fill('全书方向')
  await dialog.getByRole('textbox', { name: '内容', exact: true }).fill('档案员沿着信件查出真相。')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.book-blueprint')).toContainText('档案员沿着信件查出真相。')
  expect(generations).toBe(0)
})
