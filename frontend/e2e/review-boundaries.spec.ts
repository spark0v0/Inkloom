import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  return page.evaluate(async () => {
    async function post(path: string, body: object) {
      const r = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('Fixture failed: ' + r.status)
      return r.json()
    }
    const novel = await post('/novels', { title: '核心边界验收' })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '第一章' })
    const version = await post(`/novels/${novel.id}/chapters/${chapter.id}/versions`, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text: '作者原稿。' })
    return { novel: novel.id, chapter: chapter.id, version: version.id }
  })
}

test('采纳等待期间输入保留，作者比较后可另存', async ({ page }) => {
  const ids = await fixture(page)
  await page.evaluate(async ids => {
    const r = await fetch(`/api/v1/novels/${ids.novel}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'continue', chapter_id: ids.chapter, base_version_id: ids.version, provider_id: 'demo', instruction: '演示候选', idempotency_key: crypto.randomUUID() }) })
    if (!r.ok) throw new Error('Demo job failed')
  }, ids)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.locator('.editor-panel')).toBeVisible()
  const assistantOpener = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await assistantOpener.isVisible()) await assistantOpener.click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  let release!: () => void
  let arrived!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const dispatched = new Promise<void>(resolve => { arrived = resolve })
  await page.route('**/api/v1/jobs/*/adopt?*', async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    arrived(); await held; await route.fulfill({ response })
  })
  await page.getByRole('button', { name: '采纳正文', exact: true }).click()
  await dispatched
  const assistantDialog = page.getByRole('dialog', { name: 'AI 写作', exact: true })
  if (await assistantDialog.isVisible()) await assistantDialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
  const manuscriptTab = page.getByRole('button', { name: '正文', exact: true })
  if (await manuscriptTab.isVisible()) await manuscriptTab.click()
  const editor = page.getByRole('textbox', { name: '小说正文', exact: true })
  const marker = '采纳等待期间刚写的新句子。'
  await editor.fill(marker)
  release()
  const conflict = page.getByRole('dialog', { name: '此章已有另一个版本', exact: true })
  await expect(conflict).toContainText(marker)
  await expect(page.locator('.manuscript-content')).toContainText(marker)
  await expect.poll(() => page.evaluate(async marker => {
    return new Promise<boolean>((resolve, reject) => {
      const open = indexedDB.open('story-workshop-recovery', 1)
      open.onsuccess = () => {
        const query = open.result.transaction('drafts').objectStore('drafts').getAll()
        query.onsuccess = () => { resolve(query.result.some(value => value.text.includes(marker))); open.result.close() }
        query.onerror = () => reject(query.error)
      }
      open.onerror = () => reject(open.error)
    })
  }, marker)).toBe(true)
  await conflict.getByRole('button', { name: '将本页文字另存为新版本', exact: true }).click()
  await expect(conflict).not.toBeVisible()
  await expect(page.locator('.save-status')).toHaveText('已保存')
  const saved = await page.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)).json()).version.text, ids)
  expect(saved).toBe(marker)
})

test('跨标签页恢复后重新读取当前工作区，原草稿副本保留', async ({ page }) => {
  const ids = await fixture(page)
  const before = await page.evaluate(async ids => {
    const health = await (await fetch('/api/v1/health')).json()
    const backup = Array.from(new Uint8Array(await (await fetch('/api/v1/workspace/backup')).arrayBuffer()))
    const r = await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_version_id: ids.version, operation_id: crypto.randomUUID(), text: '原工作区后来保存的新正文。' }) })
    if (!r.ok) throw new Error('Source save failed')
    return { workspace: health.workspace_id, backup }
  }, ids)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  const editor = page.getByRole('textbox', { name: '小说正文', exact: true })
  await expect(editor).toContainText('原工作区后来保存的新正文。')
  await page.route('**/api/v1/novels/*/chapters/*/versions', async route => {
    if (route.request().method() === 'POST') await route.abort('internetdisconnected')
    else await route.continue()
  })
  await editor.fill('原工作区未确认保存的草稿。')
  await expect(page.locator('.save-status')).toHaveText('保存未确认')
  const other = await page.context().newPage()
  await other.goto('/')
  await expect(other.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  await other.evaluate(async backup => {
    const r = await fetch('/api/v1/workspace/restore', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: new Uint8Array(backup) })
    if (!r.ok) throw new Error('Restore failed')
    const restored = await r.json()
    const activation = await fetch('/api/v1/workspace/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restore_id: restored.restore_id }) })
    if (!activation.ok) throw new Error('Activation failed')
  }, before.backup)
  await expect(editor).toHaveText('作者原稿。', { timeout: 22000 })
  await expect(page.locator('.save-status')).toHaveText('已保存')
  const result = await page.evaluate(async ({ ids, before }) => {
    const chapter = await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)).json()
    const recovery = await new Promise<{ text: string } | undefined>((resolve, reject) => {
      const open = indexedDB.open('story-workshop-recovery', 1)
      open.onsuccess = () => {
        const prefix = `${before.workspace}:${ids.novel}:${ids.chapter}:`
        const query = open.result.transaction('drafts').objectStore('drafts').getAll()
        query.onsuccess = () => { resolve(query.result.find(value => value.key.startsWith(prefix))); open.result.close() }
        query.onerror = () => reject(query.error)
      }
    })
    return { text: chapter.version.text, recovery: recovery?.text }
  }, { ids, before })
  expect(result).toEqual({ text: '作者原稿。', recovery: '原工作区未确认保存的草稿。' })
  await other.close()
})

test('档案双窗口冲突保留表单，读取最新值后明确保存', async ({ page }) => {
  const ids = await fixture(page)
  await page.evaluate(async ids => {
    const r = await fetch(`/api/v1/novels/${ids.novel}/entities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'character', name: '林舟', summary: '旧简介', body: '旧档案' }) })
    if (!r.ok) throw new Error('Entity fixture failed')
  }, ids)
  await page.goto(`/#/bible/${ids.novel}`)
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: '林舟', exact: true }) }).click()
  const other = await page.context().newPage()
  await other.goto(`/#/bible/${ids.novel}`)
  await other.getByRole('button').filter({ has: other.getByRole('heading', { name: '林舟', exact: true }) }).click()
  const first = page.getByRole('dialog', { name: '林舟', exact: true })
  const second = other.getByRole('dialog', { name: '林舟', exact: true })
  await second.getByLabel('一句话简述', { exact: true }).fill('B 的新简介')
  await first.getByLabel('详细档案', { exact: true }).fill('A 的新档案')
  await first.getByRole('button', { name: '保存档案', exact: true }).click()
  await expect(first).not.toBeVisible()
  await second.getByRole('button', { name: '保存档案', exact: true }).click()
  await expect(second.getByRole('alert')).toContainText('档案已在其他窗口更新')
  await expect(second.getByLabel('一句话简述', { exact: true })).toHaveValue('B 的新简介')
  await second.getByRole('button', { name: '读取最新档案', exact: true }).click()
  await second.getByText('查看当前已保存档案', { exact: true }).click()
  await expect(second).toContainText('A 的新档案')
  await second.getByLabel('详细档案', { exact: true }).fill('A 的新档案')
  await second.getByRole('button', { name: '保存档案', exact: true }).click()
  await expect(second).not.toBeVisible()
  const saved = await other.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/entities`)).json())[0], ids)
  expect(saved.body).toBe('A 的新档案'); expect(saved.summary).toBe('B 的新简介')
  await other.close()
})

test('记忆整理未确认时锁定模型，明确拒绝后可修改参数', async ({ page }) => {
  const ids = await fixture(page)
  const provider = await page.evaluate(async () => {
    const r = await fetch('/api/v1/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '仅供界面测试', base_url: 'http://127.0.0.1:1/v1', model: 'never-called', api_key: 'fake-local-review-key' }) })
    if (!r.ok) throw new Error('Provider fixture failed')
    return (await r.json()).id as string
  })
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await page.reload()
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '本章定稿', exact: true })
  const requests: { provider_id: string; idempotency_key: string }[] = []
  await page.route(`**/api/v1/novels/${ids.novel}/jobs`, async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ status: requests.length === 2 ? 422 : 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_REJECTION', message: '仅用于请求边界测试' }) })
  })
  await dialog.getByRole('button', { name: 'AI 整理本章记忆', exact: true }).click()
  const select = dialog.getByRole('combobox', { name: '记忆整理模型', exact: true })
  await expect(select).toBeDisabled(); await expect(select).toHaveValue('demo')
  await dialog.getByRole('button', { name: '确认上次提交', exact: true }).click()
  await expect(select).toBeEnabled()
  expect(requests[0]).toEqual(requests[1])
  await select.selectOption(provider)
  await dialog.getByRole('button', { name: 'AI 整理本章记忆', exact: true }).click()
  await expect(select).toBeDisabled()
  expect(requests[2].provider_id).toBe(provider)
  expect(requests[2].idempotency_key).not.toBe(requests[0].idempotency_key)
})
