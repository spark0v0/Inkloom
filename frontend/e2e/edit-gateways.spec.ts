import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const origin = 'http://127.0.0.1:9876'
async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  return page.evaluate(async () => {
    const send = async (path: string, body: object, method = 'POST') => {
      const response = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Fixture: ' + response.status)
      return response.json()
    }
    const novel = await send('/novels', { title: '编辑入口验收' })
    await send(`/novels/${novel.id}/plans`, { title: '全书', level: 'book', body: '寻找旧档案。' })
    const plan = await send(`/novels/${novel.id}/plans`, { title: '第一卷', level: 'volume', body: '原分卷安排。' })
    const chapter = await send(`/novels/${novel.id}/chapters`, { title: '第1章' })
    await send(`/novels/${novel.id}/chapters/${chapter.id}/outline`, { base_revision: 0, operation_id: crypto.randomUUID(),
      document: { kind: 'structured', title: chapter.title, goal: '原本的目标。', conflict: '无法打开门。', beats: ['检查门锁'], ending_hook: '门锁发出响声。' } }, 'PUT')
    return { novel: novel.id as string, chapter: chapter.id as string, plan: plan.id as string }
  })
}
function chapterPath(ids: { novel: string; chapter: string }) { return `/api/v1/novels/${ids.novel}/chapters/${ids.chapter}` }
async function outline(page: Page, ids: { novel: string; chapter: string }) { return (await page.request.get(chapterPath(ids) + '/outline')).json() }
async function changeOutline(page: Page, ids: { novel: string; chapter: string }, goal: string) {
  const before = await outline(page, ids)
  const result = await page.request.put(chapterPath(ids) + '/outline', { headers: { Origin: origin }, data: {
    base_revision: before.revision, operation_id: crypto.randomUUID(), document: { ...before.document, goal },
  } })
  expect(result.ok()).toBe(true)
}

test('旧保存确认返回当前版本，保留本地输入且不自动授予覆盖新稿的基线', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/plot/${ids.novel}/${ids.chapter}`)
  await expect(page.getByRole('textbox', { name: '本章目标', exact: true })).toHaveValue('原本的目标。')
  await page.getByRole('textbox', { name: '本章目标', exact: true }).fill('A 已提交但没收到回执的目标。')
  await page.route('**' + chapterPath(ids) + '/outline', async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    await route.fetch()
    await changeOutline(page, ids, 'B 后保存的新目标。')
    await route.abort()
  }, { times: 1 })
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await page.getByRole('button', { name: '确认上次保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '上次操作已保存为版本 2，但细纲随后更新。' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '本章目标', exact: true })).toHaveValue('A 已提交但没收到回执的目标。')
  expect((await outline(page, ids)).document.goal).toBe('B 后保存的新目标。')
  expect((await outline(page, ids)).revision).toBe(3)
  await expect(page.getByText('有新版本，待比较', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '读取最新细纲并比较', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '本章目标', exact: true })).toHaveValue('B 后保存的新目标。')
})

test('章节信息冲突保留输入，重新比较后只改标题并保留新细纲和正文', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await page.getByRole('button', { name: '编辑章节信息', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '章节信息', exact: true })
  await dialog.getByRole('textbox', { name: '章节标题', exact: true }).fill('第1章 作者改的标题')
  const current = await (await page.request.get(chapterPath(ids))).json()
  const prose = await page.request.post(chapterPath(ids) + '/versions', { headers: { Origin: origin }, data: {
    base_version_id: current.working_version_id, operation_id: crypto.randomUUID(), text: '另一份已经保存的正文。',
  } })
  expect(prose.ok()).toBe(true)
  await changeOutline(page, ids, '另一窗口更新的细纲目标。')
  const patches: Record<string, unknown>[] = []
  page.on('request', request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname === chapterPath(ids)) patches.push(request.postDataJSON()) })
  await dialog.getByRole('button', { name: '保存信息', exact: true }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: '章节信息或细纲已在其他窗口更新。' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('第1章 作者改的标题')
  await dialog.getByRole('button', { name: '读取最新章节信息并比较', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '本章细纲', exact: true })).toContainText('另一窗口更新的细纲目标。')
  await dialog.getByRole('button', { name: '保存信息', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const final = await (await page.request.get(chapterPath(ids))).json()
  expect(final.title).toBe('第1章 作者改的标题')
  expect(final.version.text).toBe('另一份已经保存的正文。')
  expect((await outline(page, ids)).document.goal).toBe('另一窗口更新的细纲目标。')
  expect(patches.at(-1)?.goal).toBeUndefined()
  expect(patches.at(-1)?.base_outline_revision).toBe(2)
})

test('细纲冲突比较保留作者目标，同时接入另一窗口改过的其他字段', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/plot/${ids.novel}/${ids.chapter}`)
  await page.getByRole('textbox', { name: '本章目标', exact: true }).fill('本地作者的新目标。')
  const current = await outline(page, ids)
  const remote = await page.request.put(chapterPath(ids) + '/outline', { headers: { Origin: origin }, data: {
    base_revision: current.revision, operation_id: crypto.randomUUID(), document: { ...current.document,
      title: '第1章 远端新标题', conflict: '另一个窗口改的冲突。', beats: ['检查窗户', '核对印记'] },
  } })
  expect(remote.ok()).toBe(true)
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '细纲已在其他窗口更新。' })).toBeVisible()
  await page.getByRole('button', { name: '读取最新细纲并比较', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '本章目标', exact: true })).toHaveValue('本地作者的新目标。')
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('第1章 远端新标题')
  await expect(page.getByRole('textbox', { name: '核心冲突', exact: true })).toHaveValue('另一个窗口改的冲突。')
  await expect(page.getByRole('textbox', { name: '情节节点 2', exact: true })).toHaveValue('核对印记')
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await outline(page, ids)).revision).toBe(3)
  expect((await outline(page, ids)).document.goal).toBe('本地作者的新目标。')
})

test('分卷规划冲突后保留新正文安排，仅应用作者改名', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/plot/${ids.novel}`)
  await page.getByRole('button', { name: '编辑分卷', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑规划', exact: true })
  await dialog.getByRole('textbox', { name: '标题', exact: true }).fill('第一卷 来信')
  const path = `/api/v1/novels/${ids.novel}/plans/${ids.plan}`
  const current = await (await page.request.get(path)).json()
  const updated = await page.request.put(path, { headers: { Origin: origin }, data: { title: current.title, level: current.level,
    body: '另一个窗口补充的新分卷安排。', base_updated_at: current.updated_at } })
  expect(updated.ok()).toBe(true)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: '规划已在其他窗口更新。' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('第一卷 来信')
  await dialog.getByRole('button', { name: '读取最新规划并比较', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '内容', exact: true })).toHaveValue('另一个窗口补充的新分卷安排。')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const final = await (await page.request.get(path)).json()
  expect(final.title).toBe('第一卷 来信')
  expect(final.body).toBe('另一个窗口补充的新分卷安排。')
  const chapter = await (await page.request.get(chapterPath(ids))).json()
  expect(chapter.volume).toBe('第一卷 来信')
  expect((await outline(page, ids)).revision).toBe(1)
})

test('细纲格式变化须明确选择，保留本地格式后仍可从历史取回远端全文', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/plot/${ids.novel}/${ids.chapter}`)
  await page.getByRole('textbox', { name: '本章目标', exact: true }).fill('作者保留的结构化目标。')
  const current = await outline(page, ids)
  const changed = await page.request.put(chapterPath(ids) + '/outline', { headers: { Origin: origin }, data: {
    base_revision: current.revision, operation_id: crypto.randomUUID(), document: { kind: 'text', title: current.document.title, text: '远端自由文本：先调查来信，再确认人物动机。' },
  } })
  expect(changed.ok()).toBe(true)
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await page.getByRole('button', { name: '读取最新细纲并比较', exact: true }).click()
  await expect(page.getByRole('button', { name: '保留我的格式，继续编辑', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存细纲', exact: true })).toBeDisabled()
  expect((await outline(page, ids)).document.kind).toBe('text')
  await page.getByRole('button', { name: '保留我的格式，继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await outline(page, ids)).revision).toBe(3)
  expect((await outline(page, ids)).document.goal).toBe('作者保留的结构化目标。')
  const history = await (await page.request.get(chapterPath(ids) + '/outline/history/2')).json()
  expect(history.document.text).toBe('远端自由文本：先调查来信，再确认人物动机。')
})

test('细纲格式冲突放弃修改后采用最新格式，仍能继续保存', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/plot/${ids.novel}/${ids.chapter}`)
  await page.getByRole('textbox', { name: '本章目标', exact: true }).fill('即将放弃的本地目标。')
  const current = await outline(page, ids)
  const changed = await page.request.put(chapterPath(ids) + '/outline', { headers: { Origin: origin }, data: {
    base_revision: current.revision, operation_id: crypto.randomUUID(), document: { kind: 'text', title: current.document.title, text: '远端最新的自由文本。' },
  } })
  expect(changed.ok()).toBe(true)
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await page.getByRole('button', { name: '读取最新细纲并比较', exact: true }).click()
  await expect(page.getByRole('button', { name: '保留我的格式，继续编辑', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  const text = page.getByRole('textbox', { name: '现有细纲', exact: true })
  await expect(text).toHaveValue('远端最新的自由文本。')
  await text.fill('在最新自由文本上继续修改。')
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await outline(page, ids)).revision).toBe(3)
  expect((await outline(page, ids)).document.text).toBe('在最新自由文本上继续修改。')
})
