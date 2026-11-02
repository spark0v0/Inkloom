import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function fixture(page: Page, outline = false) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  return page.evaluate(async outline => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Polish fixture: ${response.status}`)
      return response.json()
    }
    const novel = await post('/novels', { title: '海港手记', premise: '档案员调查灯塔失踪案。' })
    if (outline) {
      await post(`/novels/${novel.id}/plans`, { title: '全书方向', level: 'book', body: '寻找失踪的守塔人。' })
      await post(`/novels/${novel.id}/plans`, { title: '第一卷', level: 'volume', body: '循着来信抵达海港。' })
    }
    const prior = await post(`/novels/${novel.id}/chapters`, { title: '第1章 海港旧事' })
    const version = await post(`/novels/${novel.id}/chapters/${prior.id}/versions`, { base_version_id: prior.working_version_id, operation_id: crypto.randomUUID(), text: '守塔人留下了一封无法辨认落款的信。\n\n黄昏时，档案员走进了旧码头。' })
    await post(`/novels/${novel.id}/chapters/${prior.id}/canon`, { version_id: version.id, operation_id: crypto.randomUUID() })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '第2章 来信' })
    return { novel: novel.id as string, chapter: chapter.id as string }
  }, outline)
}

async function assistant(page: Page, ids: { novel: string; chapter: string }) {
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.locator('.editor-panel')).toBeVisible()
  const open = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await open.isVisible()) await open.click()
  return page.locator('.assistant-panel:visible')
}

test('文风冲突合并未改字段，长内容比较仍可操作保存', async ({ page }, info) => {
  const ids = await fixture(page)
  await (await assistant(page, ids)).getByRole('button', { name: /写作风格/ }).click()
  const dialog = page.getByRole('dialog', { name: '写作风格', exact: true })
  await dialog.getByLabel('语言与节奏', { exact: true }).fill('本页的冷静叙事。')
  await page.evaluate(async novel => {
    const current = await (await fetch(`/api/v1/novels/${novel}`)).json()
    const response = await fetch(`/api/v1/novels/${novel}/writing-style`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_settings_revision: current.settings_revision, style: '另一窗口的文风。'.repeat(200), preferences: { viewpoint: 'first_person', avoid: '避免过度解释', example: '潮声停了一瞬。'.repeat(100) } }) })
    if (!response.ok) throw new Error('Concurrent style fixture failed')
  }, ids.novel)
  await dialog.getByRole('button', { name: '保存风格', exact: true }).click()
  await dialog.getByRole('button', { name: '读取最新风格', exact: true }).click()
  await expect(dialog.getByLabel('语言与节奏', { exact: true })).toHaveValue('本页的冷静叙事。')
  await expect(dialog.getByLabel('叙述视角', { exact: true })).toHaveValue('first_person')
  await expect(dialog.getByLabel('避免的写法（可选）', { exact: true })).toHaveValue('避免过度解释')
  await dialog.getByText('查看当前已保存风格', { exact: true }).click()
  await expect(dialog.getByRole('button', { name: '保存风格', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `../.tmp/context-polish-style-${info.project.name}.png` })
  await dialog.getByRole('button', { name: '保存风格', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await page.evaluate(async novel => (await (await fetch(`/api/v1/novels/${novel}`)).json()), ids.novel)
  expect(saved.writing_preferences.viewpoint).toBe('first_person')
  expect(saved.writing_preferences.example).toBe('潮声停了一瞬。'.repeat(100))
})

test('文风输入法组合不提交，保存参数冻结且只写入一次', async ({ page }) => {
  const ids = await fixture(page)
  await (await assistant(page, ids)).getByRole('button', { name: /写作风格/ }).click()
  const dialog = page.getByRole('dialog', { name: '写作风格', exact: true })
  const language = dialog.getByLabel('语言与节奏', { exact: true })
  await language.fill('克制的短句。')
  await dialog.getByRole('button', { name: '+ 减少套话', exact: true }).click()
  await expect(dialog.getByLabel('避免的写法（可选）', { exact: true })).toHaveValue(/倒吸凉气/)
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  let writes = 0
  await page.route(`**/novels/${ids.novel}/writing-style`, async route => {
    writes += 1
    const response = await route.fetch()
    await hold
    await route.fulfill({ response })
  })
  try {
    await language.dispatchEvent('compositionstart')
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await expect(dialog.getByRole('button', { name: '保存风格', exact: true })).toBeEnabled()
    await language.dispatchEvent('compositionend')
    await dialog.getByRole('button', { name: '保存风格', exact: true }).click()
    await expect.poll(() => writes).toBe(1)
    await expect(language).toBeDisabled()
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    release()
    await expect(dialog).not.toBeVisible()
    expect(writes).toBe(1)
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }) }
})

test('引用排除重算预算可恢复，历史调用引用只读', async ({ page }, info) => {
  const ids = await fixture(page)
  const panel = await assistant(page, ids)
  const contexts: any[] = []
  page.on('response', response => { if (response.url().endsWith(`/novels/${ids.novel}/context`) && response.ok()) void response.json().then(value => contexts.push(value)).catch(() => undefined) })
  await panel.getByRole('button', { name: '查看将引用的资料', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '本次引用资料', exact: true })
  await expect.poll(() => contexts.length).toBe(1)
  const first = contexts[0]
  const source = first.sources.find((item: any) => item.kind !== 'draft' && !item.pinned)
  expect(source).toBeTruthy()
  const toggle = dialog.getByRole('checkbox', { name: `引用${source.chapter_title}的段落`, exact: true }).first()
  await toggle.click()
  await expect.poll(() => contexts.length).toBe(2)
  expect(contexts[1].excluded_source_ids).toContain(source.source_id)
  expect(contexts[1].estimated_input_tokens).toBeLessThan(first.estimated_input_tokens)
  await expect(dialog.getByRole('button', { name: '返回写作', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `../.tmp/context-polish-preview-${info.project.name}.png` })
  const accessibility = await new AxeBuilder({ page }).include('.context-preview-modal').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(accessibility.violations.map(value => value.id)).toEqual([])
  await dialog.getByRole('checkbox', { checked: false }).click()
  await expect.poll(() => contexts.length).toBe(3)
  expect(contexts[2].source_fingerprint).toBe(first.source_fingerprint)
  await dialog.getByRole('button', { name: '返回写作', exact: true }).click()
  await panel.getByRole('button', { name: '生成本章正文', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  await page.locator('.call-details:visible').getByText('引用资料与调用记录', { exact: true }).click()
  await page.getByRole('button', { name: '查看引用资料', exact: true }).click()
  await expect(dialog.getByText('历史调用 · 只读', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
})

test('对白打磨先准备人设约束，明确生成后才创建候选', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.locator('.editor-panel')).toBeVisible()
  const text = '林舟避开守卫的追问，低声说：“我只想回家。”'
  await page.getByRole('textbox', { name: '小说正文', exact: true }).fill(text)
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  await page.locator('.manuscript-content p').first().evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element)
    const selection = window.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.getByRole('group', { name: '选段快捷操作', exact: true }).getByRole('button', { name: '准备对白打磨选段', exact: true }).click()
  const panel = page.locator('.assistant-panel:visible')
  await expect(panel.getByRole('status').filter({ hasText: '已准备对白打磨' })).toBeVisible()
  const count = () => page.evaluate(async novel => (await (await fetch(`/api/v1/jobs?novel_id=${novel}`)).json()).length, ids.novel)
  expect(await count()).toBe(0)
  await panel.getByRole('button', { name: '生成对白打磨候选', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  const jobs = await page.evaluate(async novel => {
    const list = await (await fetch(`/api/v1/jobs?novel_id=${novel}`)).json()
    return (await (await fetch(`/api/v1/jobs/${list[0].id}?novel_id=${novel}`)).json())
  }, ids.novel)
  expect(jobs.context.instruction).toContain('不把所有人改成冷酷或强势')
  expect(jobs.context.instruction).toContain('不改变对白造成的情节结果')
  expect(jobs.context.current_selection.text).toBe(text)
  const close = page.getByRole('button', { name: '关闭对话框', exact: true })
  if (await close.isVisible()) await close.click()
  const manuscript = page.getByRole('button', { name: '正文', exact: true })
  if (await manuscript.isVisible()) await manuscript.click()
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toHaveText(text)
})

test('引用重算失败保留成功选择，重开预览仍可恢复自动引用', async ({ page }) => {
  const ids = await fixture(page)
  const panel = await assistant(page, ids)
  await panel.getByRole('button', { name: '查看将引用的资料', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '本次引用资料', exact: true })
  const toggle = dialog.getByRole('checkbox').first()
  let fail = true
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/novels/${ids.novel}/context`, async route => {
    if (!fail) return route.continue()
    await hold
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_PREVIEW_FAILURE', message: '隔离测试：预览读取失败' }) })
  })
  try {
    await toggle.click()
    await expect(toggle).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '返回写作', exact: true })).toBeDisabled()
    release()
    await expect(dialog.getByRole('alert')).toContainText('隔离测试：预览读取失败')
    await expect(toggle).toBeChecked()
    fail = false
    await toggle.click()
    await expect(dialog.getByRole('checkbox', { checked: false })).toHaveCount(1)
    await dialog.getByRole('button', { name: '返回写作', exact: true }).click()
    await panel.getByRole('button', { name: '查看将引用的资料', exact: true }).click()
    await dialog.getByRole('button', { name: '恢复全部自动引用', exact: true }).click()
    await expect(dialog.getByRole('checkbox', { checked: false })).toHaveCount(0)
    await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }) }
})

for (const outline of [false, true]) test(`${outline ? '章节细纲' : '全书方案'}回执丢失时锁定参数，确认复用同一任务`, async ({ page }) => {
  const ids = await fixture(page, outline)
  await page.goto(`/#/plot/${ids.novel}`)
  if (outline) await page.getByRole('button', { name: 'AI 规划后续章节', exact: true }).click()
  const panel = page.getByRole('region', { name: outline ? 'AI 章节细纲' : 'AI 全书方案', exact: true })
  await panel.getByLabel('补充要求', { exact: true }).fill('让人物的选择推动情节。')
  const bodies: any[] = []
  await page.route(`**/novels/${ids.novel}/jobs`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    bodies.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (bodies.length === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'LOST_ACK', message: '隔离测试：回执丢失' }) })
    return route.fulfill({ response })
  })
  try {
    await panel.getByRole('button', { name: outline ? '生成 5 章细纲' : 'AI 生成全书方案', exact: true }).click()
    await expect(panel.getByRole('alert').filter({ hasText: '隔离测试：回执丢失' })).toBeVisible()
    await expect(panel.getByLabel('补充要求', { exact: true })).toBeDisabled()
    await expect(panel.getByLabel('创作模型', { exact: true })).toBeDisabled()
    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/jobs/page?novel_id=${ids.novel}`)
      const jobs = await response.json()
      return jobs.items.find((job: { task: string }) => job.task === (outline ? 'outline' : 'blueprint'))?.state
    }).toBe('succeeded')
    await expect(panel.getByRole('button', { name: '确认上次提交', exact: true })).toBeVisible()
    if (outline) {
      await expect(panel.getByLabel('本次规划', { exact: true })).toBeDisabled()
      await expect(panel.getByRole('button', { name: '返回大纲', exact: true })).toBeDisabled()
    }
    await panel.getByRole('button', { name: '确认上次提交', exact: true }).click()
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1]).toEqual(bodies[0])
    await expect(panel.getByRole('button', { name: outline ? '采纳这 5 章' : '采纳方案，规划章节', exact: true })).toBeVisible()
    const jobs = await page.evaluate(async novel => (await (await fetch(`/api/v1/jobs?novel_id=${novel}`)).json()), ids.novel)
    expect(jobs.filter((job: any) => job.task === (outline ? 'outline' : 'blueprint'))).toHaveLength(1)
  } finally { await page.unrouteAll({ behavior: 'wait' }) }
})
