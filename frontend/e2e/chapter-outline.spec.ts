import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { resolve } from 'node:path'

async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  const ids = await page.evaluate(async () => {
    const send = async (path: string, body: object, method = 'POST') => {
      const response = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Fixture failed: ' + response.status)
      return response.json()
    }
    const novel = await send('/novels', { title: '细纲工作台验收' })
    await send(`/novels/${novel.id}/plans`, { title: '全书', level: 'book', body: '归乡者调查来信。' })
    await send(`/novels/${novel.id}/plans`, { title: '第一卷', level: 'volume', body: '找到原始档案。' })
    const chapter = await send(`/novels/${novel.id}/chapters`, { title: '第1章 夜行' })
    await send(`/novels/${novel.id}/chapters/${chapter.id}/versions`, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text: '正式正文保持原样😀。' })
    await send(`/novels/${novel.id}/chapters/${chapter.id}/outline`, { base_revision: 0, operation_id: crypto.randomUUID(),
      document: { kind: 'structured', title: chapter.title, goal: '林舟潜入旧灯塔，核实来信中的线索。', conflict: '守塔人拒绝开门，潮水正在上涨。',
        beats: ['发现门上的新锁', '从侧窗进入，找到被撕去的一页', '听见楼上传来熟悉的口哨声'], ending_hook: '纸页上的笔迹，与父亲最后一封信相同。' } }, 'PUT')
    return { novel: novel.id as string, chapter: chapter.id as string }
  })
  await page.goto(`/#/plot/${ids.novel}`)
  await page.locator('.chapter-table-row').filter({ hasText: '第1章 夜行' }).click()
  await expect(page.getByRole('region', { name: '编辑章节细纲' })).toBeVisible()
  return ids
}
async function state(page: Page, ids: { novel: string; chapter: string }) {
  return page.evaluate(async ids => (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/outline`)).json(), ids)
}
async function ai(page: Page) {
  const tab = page.getByRole('tab', { name: 'AI 建议', exact: true })
  if (await tab.isVisible()) await tab.click()
}
async function manual(page: Page) {
  const tab = page.getByRole('tab', { name: '细纲', exact: true })
  if (await tab.isVisible()) await tab.click()
}
async function cached(page: Page, field: string, text: string) {
  return page.evaluate(async ({ field, text }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('story-workshop-recovery', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const values = await new Promise<{ document?: Record<string, unknown> }[]>(resolve => { const request = db.transaction('drafts').objectStore('drafts').getAll(); request.onsuccess = () => resolve(request.result) })
    db.close(); return values.some(value => value.document?.[field] === text)
  }, { field, text })
}

test('细纲可直接编辑、保存、刷新和恢复历史，手机单列可用', async ({ page }, info) => {
  const ids = await fixture(page)
  await page.getByRole('textbox', { name: '核心冲突', exact: true }).fill('守塔人要求主角先交出那封信。')
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await state(page, ids)).revision).toBe(2)
  await page.reload()
  await expect(page.getByRole('textbox', { name: '核心冲突', exact: true })).toHaveValue('守塔人要求主角先交出那封信。')
  await expect(page.getByRole('textbox', { name: '情节节点 3', exact: true })).toHaveValue('听见楼上传来熟悉的口哨声')
  await page.screenshot({ path: resolve(`../docs/screenshots/chapter-outline-${info.project.name}.png`) })
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map(item => item.id)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const history = page.getByRole('dialog', { name: '细纲历史', exact: true })
  await history.getByRole('button', { name: /版本 1 / }).click()
  await history.getByRole('button', { name: '恢复为新版本', exact: true }).click()
  await expect(history).not.toBeVisible()
  await expect.poll(async () => (await state(page, ids)).revision).toBe(3)
  await expect(page.getByRole('textbox', { name: '核心冲突', exact: true })).toHaveValue('守塔人拒绝开门，潮水正在上涨。')
  const untouched = await page.evaluate(async ids => {
    const chapter = await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)).json()
    const jobs = await (await fetch(`/api/v1/jobs?novel_id=${ids.novel}`)).json()
    return { text: chapter.version.text, jobs: jobs.length }
  }, ids)
  expect(untouched).toEqual({ text: '正式正文保持原样😀。', jobs: 0 })
})

test('AI 仅修改指定字段，回执丢失不重复生成，旧建议不能覆盖新细纲', async ({ page }, info) => {
  const ids = await fixture(page)
  await ai(page)
  await page.getByLabel('修改范围', { exact: true }).selectOption('ending_hook')
  await page.getByRole('textbox', { name: '修改要求', exact: true }).fill('保留父亲线索，强化主角发现的时刻。')
  const payloads: object[] = []
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1/novels/${ids.novel}/jobs`) payloads.push(request.postDataJSON()) })
  await page.getByText('本次参考与费用', { exact: true }).click()
  await page.getByRole('button', { name: '查看本次参考（不生成）', exact: true }).click()
  await expect(page.locator('.outline-context .context-details')).toBeVisible()
  await page.locator('.outline-context .source-button').first().click()
  await expect(page.getByRole('dialog')).toContainText('正式正文保持原样😀。')
  await page.getByRole('dialog').getByRole('button', { name: '关闭对话框', exact: true }).click()
  expect(payloads).toHaveLength(0)
  await page.getByText('本次参考与费用', { exact: true }).click()
  await page.route(`**/api/v1/novels/${ids.novel}/jobs`, async route => { await route.fetch(); await route.abort() }, { times: 1 })
  await page.getByRole('button', { name: '生成修改建议', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认上次提交', exact: true })).toBeEnabled()
  await expect(page.getByLabel('修改范围', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '确认上次提交', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳所选修改', exact: true })).toBeEnabled()
  expect(payloads).toHaveLength(2)
  expect(payloads[1]).toEqual(payloads[0])
  await page.screenshot({ path: resolve(`../docs/screenshots/chapter-outline-ai-${info.project.name}.png`) })
  const before = await state(page, ids)
  await page.getByRole('button', { name: '采纳所选修改', exact: true }).click()
  await expect.poll(async () => (await state(page, ids)).revision).toBe(2)
  const after = await state(page, ids)
  expect(after.document.goal).toBe(before.document.goal)
  expect(after.document.conflict).toBe(before.document.conflict)
  expect(after.document.beats).toEqual(before.document.beats)
  expect(after.document.ending_hook).toContain('演示建议')
  await expect(page.getByText('这份建议已采纳，仍可继续编辑细纲。')).toBeVisible()
  await page.getByRole('button', { name: '生成修改建议', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳所选修改', exact: true })).toBeEnabled()
  await page.evaluate(async ids => {
    const path = `/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/outline`
    const current = await (await fetch(path)).json()
    const response = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_revision: current.revision, operation_id: crypto.randomUUID(), document: { ...current.document, goal: '另一个窗口保存的新目标。' } }) })
    if (!response.ok) throw new Error('Concurrent update failed')
  }, ids)
  await page.getByRole('button', { name: '采纳所选修改', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '原稿、设定或细纲已更新，请重新生成建议。' })).toBeVisible()
  expect((await state(page, ids)).document.goal).toBe('另一个窗口保存的新目标。')
  expect(await page.evaluate(async novel => (await (await fetch(`/api/v1/jobs?novel_id=${novel}`)).json()).length, ids.novel)).toBe(2)
})

test('细纲保存回执可确认，冲突保留输入，刷新恢复草稿且输入法组合不提交', async ({ page, context }) => {
  const ids = await fixture(page)
  await page.route(`**/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/outline`, async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    await route.fetch(); await route.abort()
  }, { times: 1 })
  await page.getByRole('textbox', { name: '本章目标', exact: true }).fill('回执测试目标。')
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认上次保存', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '确认上次保存', exact: true }).click()
  await expect.poll(async () => (await state(page, ids)).revision).toBe(2)
  const other = await context.newPage()
  await other.goto(`/#/plot/${ids.novel}/${ids.chapter}`)
  await expect(other.getByRole('textbox', { name: '本章目标', exact: true })).toHaveValue('回执测试目标。')
  await page.getByRole('textbox', { name: '核心冲突', exact: true }).fill('第一窗口保存的冲突。')
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await state(page, ids)).revision).toBe(3)
  await other.getByRole('textbox', { name: '核心冲突', exact: true }).fill('第二窗口未保存的冲突。')
  await expect.poll(() => cached(other, 'conflict', '第二窗口未保存的冲突。')).toBe(true)
  await page.getByRole('textbox', { name: '本章目标', exact: true }).fill('第一窗口再次保存的目标。')
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await state(page, ids)).revision).toBe(4)
  expect(await cached(other, 'conflict', '第二窗口未保存的冲突。')).toBe(true)
  await other.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect(other.getByRole('alert').filter({ hasText: '细纲已在其他窗口更新。你的输入已保留，请读取最新细纲后比较。' })).toBeVisible()
  await expect(other.getByRole('textbox', { name: '核心冲突', exact: true })).toHaveValue('第二窗口未保存的冲突。')
  await other.getByRole('button', { name: '读取最新细纲并比较', exact: true }).click()
  await other.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await state(other, ids)).revision).toBe(5)
  await other.getByRole('textbox', { name: '本章目标', exact: true }).fill('刷新后要恢复的草稿。')
  await expect.poll(() => cached(other, 'goal', '刷新后要恢复的草稿。')).toBe(true)
  await other.reload()
  await other.getByRole('button', { name: '恢复本地细纲', exact: true }).click()
  await expect(other.getByRole('textbox', { name: '本章目标', exact: true })).toHaveValue('刷新后要恢复的草稿。')
  await other.getByRole('textbox', { name: '本章目标', exact: true }).dispatchEvent('compositionstart')
  await other.getByRole('textbox', { name: '本章目标', exact: true }).press('Control+s')
  expect((await state(other, ids)).revision).toBe(5)
  await other.getByRole('textbox', { name: '本章目标', exact: true }).dispatchEvent('compositionend')
  await other.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await state(other, ids)).revision).toBe(6)
  await manual(other)
  await other.close()
})
