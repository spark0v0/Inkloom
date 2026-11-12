import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function createBook(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  return page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function create(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Review fixture: ${response.status}`)
      return response.json()
    }
    const novel = await create('/novels', { title: '渡口纪事' })
    const chapter = await create(`/novels/${novel.id}/chapters`, { title: '来信', volume: '渡口旧事', goal: '循着信里的落款寻找旧渡口。' })
    return { novelId: novel.id as string, chapterId: chapter.id as string }
  })
}

test('侧栏打开写作时，较晚的导航不会被目录回执覆盖', async ({ page }, info) => {
  const { novelId } = await createBook(page)
  await page.goto(`/#/plot/${novelId}`)
  await expect(page.locator('.chapter-table-row').filter({ hasText: '来信' })).toBeVisible()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const directory = `**/novels/${novelId}/chapters`
  await page.route(directory, async route => { await held; await route.continue() })
  try {
    if (info.project.name === 'mobile') await page.getByRole('button', { name: '打开主菜单' }).click()
    const requested = page.waitForRequest(directory)
    await page.getByRole('button', { name: '章节写作', exact: true }).click()
    await requested
    await page.getByRole('button', { name: '模型设置', exact: true }).click()
    await expect(page).toHaveURL(/#\/settings$/)
    const returned = page.waitForResponse(directory)
    release()
    await returned
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/#\/settings$/)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('保存后目录刷新失败时保留当前输入，重试恢复目录', async ({ page }) => {
  const { novelId, chapterId } = await createBook(page)
  await page.goto(`/#/write/${novelId}/${chapterId}`)
  const editor = page.getByRole('textbox', { name: '小说正文', exact: true })
  await expect(editor).toBeEditable()
  const instance = await editor.elementHandle()
  const directory = `**/novels/${novelId}/chapters`
  await page.route(directory, route => route.fulfill({ status: 503, json: { code: 'READ_FAILED', message: '测试目录暂不可读' } }))
  await editor.fill('信里只有一句话。')
  await expect(page.getByText('测试目录暂不可读')).toBeVisible()
  await expect(editor).toBeFocused()
  expect(await instance?.evaluate(element => element.isConnected)).toBe(true)
  await expect(editor).toHaveText('信里只有一句话。')
  await page.unroute(directory)
  await page.getByRole('button', { name: '重读资料', exact: true }).click()
  await expect(page.getByText('测试目录暂不可读')).not.toBeVisible()
  await editor.fill('信里多了一句新的话。')
  await expect(page.locator('.save-status')).toHaveText('已保存')
  await page.reload()
  await expect(editor).toHaveText('信里多了一句新的话。')
})

test('浏览器后退等待保存时，进行中的中文组合输入保留在当前章', async ({ page }, info) => {
  const { novelId, chapterId } = await createBook(page)
  await page.goto(`/#/plot/${novelId}`)
  await expect(page.locator('.chapter-table-row').filter({ hasText: '来信' })).toBeVisible()
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '打开主菜单' }).click()
  await page.getByRole('button', { name: '章节写作', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/write/${novelId}/${chapterId}$`))
  const editor = page.getByRole('textbox', { name: '小说正文', exact: true })
  const save = `**/novels/${novelId}/chapters/${chapterId}/versions`
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route(save, async route => { await held; await route.continue() })
  try {
    const requested = page.waitForRequest(request => request.url().endsWith(`/chapters/${chapterId}/versions`) && request.method() === 'POST')
    await editor.fill('第一封信仍在桌上。')
    await page.evaluate(() => history.back())
    await requested
    await editor.dispatchEvent('compositionstart')
    release()
    await expect(page.getByText(/请先完成当前中文输入/)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/write/${novelId}/${chapterId}$`))
    await expect(editor).toHaveText('第一封信仍在桌上。')
    await editor.dispatchEvent('compositionend')
    await page.evaluate(id => { location.hash = `#/plot/${id}` }, novelId)
    await expect(page.locator('.chapter-table-row').filter({ hasText: '来信' })).toBeVisible()
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('模型配置无法读取时仍可手写和查看版本', async ({ page }, info) => {
  const { novelId, chapterId } = await createBook(page)
  await page.route('**/api/v1/roles', route => route.fulfill({ status: 503, json: { code: 'READ_FAILED', message: '测试模型设置暂不可读' } }))
  await page.goto(`/#/write/${novelId}/${chapterId}`)
  await page.reload()
  const editor = page.getByRole('textbox', { name: '小说正文', exact: true })
  await expect(editor).toBeEditable()
  await editor.fill('没有模型，也能把稿子写下去。')
  await expect(page.locator('.save-status')).toHaveText('已保存')
  await page.getByRole('button', { name: '版本', exact: true }).click()
  const history = page.getByRole('dialog', { name: /版本/ })
  await expect(history).toBeVisible()
  await history.getByRole('button', { name: '关闭对话框' }).click()
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '打开写作助手' }).click()
  const assistant = page.getByRole('complementary', { name: '写作助手' })
  await expect(assistant.getByText(/测试模型设置暂不可读/)).toBeVisible()
  await expect(assistant.getByRole('button', { name: '重写本章正文', exact: true })).toBeDisabled()
  await expect(assistant.locator('.assistant-footer')).toHaveCount(0)
})

test('没有选中作品时全局搜索从书架查找', async ({ page }) => {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: '模型设置', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '搜索作品', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '搜索我的作品', exact: true })
  const input = dialog.getByRole('textbox', { name: '输入搜索内容' })
  await input.fill('不存在的作品')
  await input.press('Enter')
  await expect(page).toHaveURL(/#\/library$/)
  await expect(page.getByText('没有找到这部作品')).toBeVisible()
})

test('添加正式分卷后旧章仍可打开，并能补上原卷的规划', async ({ page }, info) => {
  const { novelId, chapterId } = await createBook(page)
  await page.goto(`/#/plot/${novelId}`)
  const chapter = page.locator('.chapter-table-row').filter({ hasText: '来信' })
  await expect(chapter).toBeVisible()
  await page.getByRole('button', { name: '添加分卷', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加规划', exact: true })
  await dialog.getByRole('textbox', { name: '标题', exact: true }).fill('远行')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(chapter).toBeVisible()
  await page.getByRole('button', { name: '补分卷规划', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('渡口旧事')
  await dialog.getByRole('textbox', { name: '内容', exact: true }).fill('从来信追查渡口的旧案。')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 规划后续章节', exact: true })).toBeVisible()
  await expect(chapter).toBeVisible()
  if (info.project.name === 'mobile') await expect(page.getByRole('combobox', { name: '选择分卷' }).locator('option').first()).toHaveText('渡口旧事 · 1 章')
  else await expect(page.locator('.volume-option').first()).toContainText('渡口旧事')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
  await page.screenshot({ path: info.outputPath('planning-directory.png') })
  await chapter.click()
  await expect(page).toHaveURL(new RegExp(`/plot/${novelId}/${chapterId}$`))
})
