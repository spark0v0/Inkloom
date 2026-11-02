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
      if (!response.ok) throw new Error(`Editor fixture: ${response.status}`)
      return response.json()
    }
    const novel = await post('/novels', { title: '灯塔来信' })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '第一章 潮声' })
    const path = `/novels/${novel.id}/chapters/${chapter.id}/versions`
    const old = await post(path, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text: '旧稿里的潮声。'.repeat(600) })
    const text = '平常的叙述。\n\n信封上有一个名字。'
    const current = await post(path, { base_version_id: old.id, operation_id: crypto.randomUUID(), text, editor_doc: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '平常的叙述。' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '信封上有一个名字。', marks: [{ type: 'bold' }, { type: 'italic' }] }] },
    ] } })
    return { novel: novel.id as string, chapter: chapter.id as string, old: old.id as string, current: current.id as string, oldText: old.text as string }
  })
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toBeVisible()
  return ids
}

async function history(page: Page) {
  await page.getByRole('button', { name: '版本', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '章节版本', exact: true })
  await expect(dialog.locator('.version-list button')).toHaveCount(3)
  await dialog.locator('.version-list button').nth(1).click()
  await expect(dialog.locator('.version-body')).toContainText('旧稿里的潮声。')
  return dialog
}

test('正文格式随光标更新，撤销重做状态与输入法组合一致', async ({ page }) => {
  await fixture(page)
  const body = page.getByRole('textbox', { name: '小说正文', exact: true })
  const bold = page.getByRole('button', { name: '加粗', exact: true })
  const italic = page.getByRole('button', { name: '斜体', exact: true })
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled()
  await body.locator('p').nth(1).click()
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  await expect(italic).toHaveAttribute('aria-pressed', 'true')
  await body.locator('p').first().click()
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
  await expect(italic).toHaveAttribute('aria-pressed', 'false')
  await body.dispatchEvent('compositionstart', { data: '潮' })
  await expect(bold).toBeDisabled()
  await expect(italic).toBeDisabled()
  await body.dispatchEvent('compositionend', { data: '潮' })
  await expect(bold).toBeEnabled()
  await body.press('Home')
  await body.press('Shift+End')
  await bold.click()
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
})

test('写作工具在手机与中等宽度完整可达，专注模式使用整个窗口', async ({ page }, info) => {
  await fixture(page)
  for (const width of [390, 800, 1024, 1100, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const toolbar = page.locator('.editor-toolbar')
    const bounds = await toolbar.boundingBox()
    expect(bounds).not.toBeNull()
    const controls = toolbar.locator('button:visible, select:visible')
    for (const control of await controls.all()) {
      await expect(control).toBeInViewport()
      const rect = (await control.boundingBox())!
      expect(rect.x, `width ${width}, ${await control.getAttribute('aria-label')}`).toBeGreaterThanOrEqual(bounds!.x)
      expect(rect.x + rect.width, `width ${width}, ${await control.getAttribute('aria-label')}`).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
    }
    if (width <= 1024) await expect(page.getByRole('button', { name: '打开章节目录', exact: true })).toBeVisible()
    if (width <= 1100) {
      const editor = (await page.locator('.editor-panel').boundingBox())!
      expect(editor.x + editor.width).toBeCloseTo(width, 0)
    }
  }
  await page.getByRole('button', { name: '收起章节目录', exact: true }).click()
  await expect(page.locator('.desktop-directory')).not.toBeVisible()
  await page.getByRole('button', { name: '展开章节目录', exact: true }).click()
  await expect(page.locator('.desktop-directory')).toBeVisible()
  await page.getByRole('button', { name: '收起写作助手', exact: true }).click()
  await expect(page.locator('.desktop-assistant')).not.toBeVisible()
  await page.getByRole('button', { name: '展开写作助手', exact: true }).click()
  await expect(page.locator('.desktop-assistant')).toBeVisible()
  await page.setViewportSize({ width: 800, height: 900 })
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  const editor = (await page.locator('.editor-panel').boundingBox())!
  expect(editor.x).toBe(0)
  expect(editor.y).toBe(0)
  expect(editor.width).toBe(800)
  expect(editor.height).toBe(900)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '专注写作', exact: true })).toBeVisible()
  await page.screenshot({ path: `../.tmp/editor-toolbar-${info.project.name}.png` })
})

test('版本恢复等待期间锁定选择与关闭，长正文和底部操作可达', async ({ page }, info) => {
  const ids = await fixture(page)
  const dialog = await history(page)
  await expect(dialog.getByRole('button', { name: '恢复为新版本', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `../.tmp/editor-history-${info.project.name}.png` })
  const axe = await new AxeBuilder({ page }).include('.version-history-modal').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map(value => value.id)).toEqual([])
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let writes = 0
  await page.route(`**/chapters/${ids.chapter}/versions`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    writes++
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  try {
    await dialog.getByRole('button', { name: '恢复为新版本', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
    await expect(dialog.getByRole('button', { name: '关闭对话框', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled()
    for (const button of await dialog.locator('.version-list button').all()) await expect(button).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
  } finally { release() }
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toHaveText(ids.oldText)
  await expect(page.getByRole('button', { name: '版本', exact: true })).toBeFocused()
  expect(writes).toBe(1)
})

test('空白历史明确提示恢复结果，可先下载所选稿件', async ({ page }) => {
  const ids = await fixture(page)
  const dialog = await history(page)
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载此版', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('第一章 潮声-版本副本.txt')
  await dialog.locator('.version-list button').last().click()
  await expect(dialog).toContainText('恢复后将得到空白正文')
  await expect(dialog.getByRole('button', { name: '恢复空白版本', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: '恢复空白版本', exact: true })).toBeInViewport()
  await dialog.getByRole('button', { name: '恢复空白版本', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toBeEmpty()
  const versions = await (await page.request.get(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/versions-page`)).json()
  expect(versions.items).toHaveLength(4)
  expect(versions.items.some((version: { id: string }) => version.id === ids.current)).toBe(true)
})

for (const newer of [false, true]) test(`恢复回执丢失后复用原请求${newer ? '，迟到回执不替换更新的正文' : '，只创建一个版本'}`, async ({ page }) => {
  const ids = await fixture(page)
  const dialog = await history(page)
  const submitted: object[] = []
  let newerText = ''
  await page.route(`**/chapters/${ids.chapter}/versions`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    submitted.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (submitted.length === 1) {
      if (newer) {
        const saved = await response.json()
        newerText = '另一窗口在恢复后又写下的新正文。'
        const write = await page.request.post(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/versions`, {
          headers: { Origin: 'http://127.0.0.1:9876' }, data: { base_version_id: saved.id, operation_id: crypto.randomUUID(), text: newerText },
        })
        expect(write.ok()).toBe(true)
        const current = await write.json()
        const confirm = await page.request.post(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/canon`, {
          headers: { Origin: 'http://127.0.0.1:9876' }, data: { version_id: current.id, operation_id: crypto.randomUUID() },
        })
        expect(confirm.ok()).toBe(true)
      }
      await route.abort()
    } else await route.fulfill({ response })
  })
  await dialog.getByRole('button', { name: '恢复为新版本', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '确认上次恢复', exact: true })).toBeVisible()
  await expect(dialog.locator('.version-list button').first()).toBeDisabled()
  await dialog.getByRole('button', { name: '确认上次恢复', exact: true }).click()
  if (newer) {
    await expect(dialog).toContainText('工作区随后又有修改')
    await expect(dialog.locator('.version-body')).toContainText(newerText)
    await dialog.getByRole('button', { name: '查看最新正文', exact: true }).click()
  }
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toHaveText(newer ? newerText : ids.oldText)
  if (newer) await expect(page.getByRole('region', { name: '章节写作' }).getByText('已定稿', { exact: true })).toBeVisible()
  expect(submitted).toHaveLength(2)
  expect(submitted[1]).toEqual(submitted[0])
  const versions = await (await page.request.get(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/versions-page`)).json()
  expect(versions.items).toHaveLength(newer ? 5 : 4)
})
