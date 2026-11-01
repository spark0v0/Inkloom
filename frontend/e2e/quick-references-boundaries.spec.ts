import { expect, test } from '@playwright/test'

test('速查必读读取失败时禁止写入，等待回执后再保存下一项', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Quick references fixture failed')
      return response.json()
    }
    const novel = await post('/novels', { title: '速查必读边界' })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '来信' })
    const first = await post(`/novels/${novel.id}/entities`, { kind: 'character', name: '林舟' })
    const second = await post(`/novels/${novel.id}/entities`, { kind: 'character', name: '顾衡' })
    return { novel: novel.id, chapter: chapter.id, first: first.id, second: second.id }
  })
  let failRead = true
  let writes = 0
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/references`, async route => {
    if (route.request().method() === 'GET' && failRead) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_READ_FAILURE', message: '必读读取失败，仅用于隔离测试' }) })
    }
    if (route.request().method() !== 'PUT') return route.continue()
    writes += 1
    const response = await route.fetch()
    await hold
    await route.fulfill({ response })
  })
  try {
    await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
    await expect(page.locator('.editor-panel')).toBeVisible()
    const open = page.getByRole('button', { name: '打开写作助手', exact: true })
    if (await open.isVisible()) await open.click()
    await page.getByRole('button', { name: '速查设定', exact: false }).click()
    const dialog = page.getByRole('dialog', { name: '速查故事设定与主角状态', exact: true })
    await expect(dialog.getByRole('alert')).toContainText('必读读取失败，仅用于隔离测试')
    const first = dialog.locator('.quick-entity-card').filter({ hasText: '林舟' })
    const second = dialog.locator('.quick-entity-card').filter({ hasText: '顾衡' })
    await expect(first.getByRole('button', { name: '+ 设为本章必读', exact: true })).toBeDisabled()
    expect(writes).toBe(0)
    failRead = false
    await dialog.getByRole('button', { name: '重试读取本章必读', exact: true }).click()
    await expect(first.getByRole('button', { name: '+ 设为本章必读', exact: true })).toBeEnabled()
    await first.getByRole('button', { name: '+ 设为本章必读', exact: true }).click()
    await expect.poll(() => writes).toBe(1)
    await expect(second.getByRole('button', { name: '+ 设为本章必读', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled()
    await page.mouse.click(3, 3)
    await expect(dialog).toBeVisible()
    release()
    await expect(first.getByRole('button', { name: '已加入本章必读', exact: true })).toBeEnabled()
    await second.getByRole('button', { name: '+ 设为本章必读', exact: true }).click()
    await expect(second.getByRole('button', { name: '已加入本章必读', exact: true })).toBeEnabled()
    const saved = await page.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/references`)).json()), ids)
    expect(saved.selection.entity_ids).toEqual([ids.first, ids.second])
    expect(writes).toBe(2)
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }) }
})
