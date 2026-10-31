import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Finalization fixture: ${response.status}`)
      return response.json()
    }
    const novel = await post('/novels', { title: '定稿边界验收' })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '第一章' })
    const version = await post(`/novels/${novel.id}/chapters/${chapter.id}/versions`, {
      base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text: '林舟把钥匙交给守塔人。',
    })
    const second = await post(`/novels/${novel.id}/chapters`, { title: '第二章' })
    const next = await post(`/novels/${novel.id}/chapters/${second.id}/versions`, {
      base_version_id: second.working_version_id, operation_id: crypto.randomUUID(), text: '守塔人用钥匙打开楼梯间。',
    })
    return { novel: novel.id as string, chapter: chapter.id as string, version: version.id as string,
      second: second.id as string, next: next.id as string, source: `${version.id}:${version.paragraphs[0].paragraph_id}` }
  })
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  return ids
}

test('定稿回执丢失后重放同一请求，再次打开恢复作者记忆且不影响后章', async ({ page }) => {
  const ids = await fixture(page)
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '本章定稿', exact: true })
  await expect(dialog.getByRole('button', { name: '仅定稿', exact: true })).toBeEnabled()
  await dialog.getByText('手动添加一条变化', { exact: true }).click()
  await dialog.getByRole('textbox', { name: '概括发生了什么', exact: true }).fill('作者记忆：钥匙已交给守塔人。')
  await dialog.getByRole('button', { name: '添加到本次确认', exact: true }).click()
  const requests: unknown[] = []
  const path = `**/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/canon`
  await page.route(path, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    } else await route.continue()
  })
  await dialog.getByRole('button', { name: '仅定稿', exact: true }).click()
  await expect(dialog).toContainText('定稿结果尚未确认。')
  await expect(dialog.getByRole('button', { name: '返回修改', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('combobox', { name: '记忆整理模型', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '移除此项变化', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '确认上次定稿', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  await page.unroute(path)
  const revision = await page.evaluate(async ids => {
    const response = await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.second}/canon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: ids.next, operation_id: crypto.randomUUID(), changes: [] }),
    })
    if (!response.ok) throw new Error(`Second chapter confirmation: ${response.status}`)
    return (await response.json()).revision as number
  }, ids)
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: '作者记忆：钥匙已交给守塔人。', exact: true })).toBeChecked()
  await dialog.getByRole('button', { name: '仅定稿', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const current = await page.evaluate(async ids => ({
    novel: await (await fetch(`/api/v1/novels/${ids.novel}`)).json(),
    second: await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.second}`)).json(),
  }), ids)
  expect(current.novel.canon_revision).toBe(revision)
  expect(current.second.review_state).toBe('confirmed')
})

test('并发修改定稿记忆时保留本页选择，比较最新记忆后明确确认', async ({ page }) => {
  const ids = await fixture(page)
  await page.evaluate(async ids => {
    const response = await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/canon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        version_id: ids.version, operation_id: crypto.randomUUID(), changes: [{ kind: 'event', claim: '最初确认的记忆。',
          evidence: [{ source_id: ids.source, quote: '林舟把钥匙交给守塔人。' }] }],
      }),
    })
    if (!response.ok) throw new Error(`Initial confirmation: ${response.status}`)
  }, ids)
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '本章定稿', exact: true })
  const original = dialog.getByRole('checkbox', { name: '最初确认的记忆。', exact: true })
  await expect(original).toBeChecked()
  await original.uncheck()
  await page.evaluate(async ids => {
    const path = `/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/canon`
    const basis = await (await fetch(path)).json()
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      version_id: ids.version, operation_id: crypto.randomUUID(), base_canon_revision: basis.canon_revision,
      changes: basis.changes.map((change: object) => ({ ...change, claim: '另一窗口确认的新记忆。' })),
    }) })
    if (!response.ok) throw new Error(`Concurrent confirmation: ${response.status}`)
  }, ids)
  await dialog.getByRole('button', { name: '仅定稿', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('定稿记忆已变化')
  await expect(original).not.toBeChecked()
  await dialog.getByText('查看工作区最新记忆', { exact: true }).click()
  await expect(dialog).toContainText('另一窗口确认的新记忆。')
  await dialog.getByRole('button', { name: '采用最新记忆，重新编辑', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: '另一窗口确认的新记忆。', exact: true })).toBeChecked()
  await dialog.getByRole('button', { name: '仅定稿', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const memory = await page.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/canon`)).json()).changes, ids)
  expect(memory).toHaveLength(1)
  expect(memory[0].claim).toBe('另一窗口确认的新记忆。')
})

test('定稿记忆读取失败时禁止空数据确认，重试成功后恢复操作', async ({ page }) => {
  const ids = await fixture(page)
  const path = `**/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/canon`
  await page.route(path, route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ code: 'TEST_READ_FAILED', message: '读取失败，仅用于边界验收。' }) }))
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '本章定稿', exact: true })
  await expect(dialog).toContainText('读取失败，仅用于边界验收。')
  await expect(dialog.getByRole('button', { name: '仅定稿', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'AI 整理本章记忆', exact: true })).toBeDisabled()
  await page.unroute(path)
  await dialog.getByRole('button', { name: '重试读取', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '仅定稿', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '返回修改', exact: true }).click()
  await expect(dialog).not.toBeVisible()
})
