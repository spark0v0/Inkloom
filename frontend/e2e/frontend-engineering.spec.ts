import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  return page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function create(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Frontend fixture: ${response.status}`)
      return response.json()
    }
    const novel = await create('/novels', { title: '灯塔 · 前端工程复查' })
    const entity = await create(`/novels/${novel.id}/entities`, { kind: 'character', name: '林舟', summary: '最初的简述', body: '最初的档案。', aliases: ['阿舟'] })
    const provider = await create('/providers', { name: '本机复查连接', base_url: 'http://127.0.0.1:1/v1', model: 'test-only-no-generation' })
    return { novel: novel.id as string, entity, provider: provider.id as string }
  })
}

test('档案冲突后保留已改字段并合并未改字段', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/bible/${ids.novel}`)
  await page.locator('.entity-card').filter({ has: page.getByRole('heading', { name: '林舟', exact: true }) }).click()
  const dialog = page.getByRole('dialog', { name: '编辑人物', exact: true })
  await dialog.getByRole('textbox', { name: '详细档案', exact: true }).fill('本页希望保留的身世。')
  await page.evaluate(async ids => {
    const response = await fetch(`/api/v1/novels/${ids.novel}/entities/${ids.entity.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      base_updated_at: ids.entity.updated_at, kind: 'character', status: 'author', name: '林舟',
      summary: '另一窗口修改的简述', body: ids.entity.body, aliases: ['阿舟', '新别名'],
    }) })
    if (!response.ok) throw new Error('Concurrent entity update failed')
  }, ids)
  await dialog.getByRole('button', { name: '保存档案', exact: true }).click()
  await dialog.getByRole('button', { name: '读取最新档案', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '详细档案', exact: true })).toHaveValue('本页希望保留的身世。')
  await expect(dialog.getByRole('textbox', { name: '一句话简述', exact: true })).toHaveValue('另一窗口修改的简述')
  await expect(dialog.getByRole('textbox', { name: '别名', exact: true })).toHaveValue('阿舟、新别名')
  await dialog.getByRole('button', { name: '保存档案', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await page.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/entities`)).json()).find((value: { id: string }) => value.id === ids.entity.id), ids)
  expect(saved.body).toBe('本页希望保留的身世。')
  expect(saved.summary).toBe('另一窗口修改的简述')
  expect(saved.aliases).toEqual(['阿舟', '新别名'])
})

test('连接保存期间遮罩与 Esc 不关闭窗口，表单参数锁定', async ({ page }) => {
  await fixture(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: '添加模型连接', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加模型连接', exact: true })
  await dialog.getByRole('textbox', { name: '连接名称', exact: true }).fill('等待回执的本机连接')
  await dialog.getByRole('textbox', { name: '服务地址', exact: true }).fill('http://127.0.0.1:1/v1')
  await dialog.getByRole('textbox', { name: '模型 ID', exact: true }).fill('test-only-no-generation')
  const hold = deferred()
  let waiting = false
  await page.route('**/api/v1/providers', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    waiting = true
    await hold.promise
    await route.fulfill({ response })
  })
  try {
    await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect.poll(() => waiting).toBe(true)
    await page.mouse.click(3, 3)
    await expect(dialog).toBeVisible({ timeout: 2000 })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: '连接名称', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('combobox', { name: '从常用服务商一键填入预设', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
    hold.release()
    await expect(dialog).not.toBeVisible()
  } finally { hold.release() }
})

test('默认连接切换串行保存，后一次修改保留前一次结果', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto('/#/settings')
  await page.reload()
  const section = page.locator('.settings-section')
  const hold = deferred()
  const bodies: Record<string, string>[] = []
  let waiting = false
  await page.route('**/api/v1/roles', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    bodies.push(route.request().postDataJSON())
    const response = await route.fetch()
    waiting = true
    await hold.promise
    await route.fulfill({ response })
  })
  try {
    await section.getByRole('combobox', { name: '章节写作', exact: true }).selectOption(ids.provider)
    await expect.poll(() => waiting).toBe(true)
    await expect(section.getByRole('combobox', { name: '全书与章节策划', exact: true })).toBeDisabled({ timeout: 2000 })
    hold.release()
    await expect(section.getByRole('combobox', { name: '全书与章节策划', exact: true })).toBeEnabled()
    await section.getByRole('combobox', { name: '全书与章节策划', exact: true }).selectOption(ids.provider)
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1].writer).toBe(ids.provider)
    expect(bodies[1].planner).toBe(ids.provider)
    await expect(section.getByRole('combobox', { name: '全书与章节策划', exact: true })).toBeEnabled()
    await page.goto('/')
    await expect(page.locator('.library-model')).toContainText('本机复查连接')
  } finally {
    hold.release()
    await page.unrouteAll({ behavior: 'wait' })
    await page.evaluate(async () => {
      await fetch('/api/v1/roles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writer: 'demo', planner: 'demo', extractor: 'demo', reviewer: 'demo' }) })
    })
  }
})

test('手稿预览与导入期间冻结输入，导入内容与审阅结果相同', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: '导入手稿', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导入已有手稿', exact: true })
  await dialog.getByRole('textbox', { name: '作品名', exact: true }).fill('前端导入复查')
  const original = '第一章 来信\n林舟收到一封来信。'
  const source = dialog.getByRole('textbox', { name: '手稿预览或粘贴正文', exact: true })
  await source.fill(original)
  const preview = deferred()
  const importing = deferred()
  let previewWaiting = false
  let importWaiting = false
  await page.route('**/api/v1/import-preview', async route => {
    const response = await route.fetch()
    previewWaiting = true
    await preview.promise
    await route.fulfill({ response })
  })
  await page.route('**/api/v1/import', async route => {
    const response = await route.fetch()
    importWaiting = true
    await importing.promise
    await route.fulfill({ response })
  })
  try {
    await dialog.getByRole('button', { name: '预览章节切分', exact: true }).click()
    await expect.poll(() => previewWaiting).toBe(true)
    await expect(source).toBeDisabled({ timeout: 2000 })
    await expect(dialog.getByRole('combobox', { name: '文件编码', exact: true })).toBeDisabled()
    preview.release()
    const chapter = dialog.getByRole('textbox', { name: '章节正文', exact: true })
    await expect(chapter).toHaveValue('林舟收到一封来信。')
    await chapter.fill('林舟收到一封带有银印的来信。')
    await dialog.getByRole('button', { name: '确认导入 1 章', exact: true }).click()
    await expect.poll(() => importWaiting).toBe(true)
    await expect(chapter).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
    await page.mouse.click(3, 3)
    await expect(dialog).toBeVisible()
    importing.release()
    await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toHaveText('林舟收到一封带有银印的来信。')
  } finally { preview.release(); importing.release() }
})

test('新建作品忽略输入法组合提交，等待回执时拒绝重复提交', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '新建小说', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  const title = dialog.getByRole('textbox', { name: '书名（可以稍后由 AI 起名）', exact: true })
  await title.fill('输入法与重复提交复查')
  const hold = deferred()
  let requests = 0
  await page.route('**/api/v1/novels', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    requests += 1
    const response = await route.fetch()
    await hold.promise
    await route.fulfill({ response })
  })
  try {
    await title.dispatchEvent('compositionstart')
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await expect(dialog.getByRole('button', { name: '下一步：全书方案', exact: true })).toBeEnabled()
    await title.dispatchEvent('compositionend')
    await dialog.getByRole('button', { name: '下一步：全书方案', exact: true }).click()
    await expect.poll(() => requests).toBe(1)
    await expect(title).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await page.mouse.click(3, 3)
    await expect(dialog).toBeVisible()
    hold.release()
    await expect(dialog).not.toBeVisible()
    expect(requests).toBe(1)
  } finally { hold.release() }
})

test('读取失败清除旧手稿，大小错误给出明确原因', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '导入手稿', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导入已有手稿', exact: true })
  const file = dialog.getByLabel('选择 TXT / Markdown', { exact: true })
  const source = dialog.getByRole('textbox', { name: '手稿预览或粘贴正文', exact: true })
  await file.setInputFiles({ name: '原手稿.txt', mimeType: 'text/plain', buffer: Buffer.from('这份旧稿不能混入新文件。') })
  await expect(source).toHaveValue('这份旧稿不能混入新文件。')
  await file.setInputFiles({ name: '编码无效.txt', mimeType: 'text/plain', buffer: Buffer.from([0xff]) })
  await expect(dialog.getByRole('alert')).toContainText('文件无法按所选编码读取')
  await expect(source).toHaveValue('')
  await expect(dialog.getByRole('button', { name: '预览章节切分', exact: true })).toBeDisabled()
  await file.setInputFiles({ name: '超大手稿.txt', mimeType: 'text/plain', buffer: Buffer.alloc(6_000_001, 'a') })
  await expect(dialog.getByRole('alert')).toContainText('手稿超过 6 MB，请分卷导入。')
  await expect(source).toHaveValue('')
})

test('快速记录设定忽略输入法组合提交，保存期间锁定参数且不重复创建', async ({ page }) => {
  const ids = await fixture(page)
  const chapter = await page.evaluate(async novel => {
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Inline entity fixture failed')
      return response.json()
    }
    const chapter = await post(`/novels/${novel}/chapters`, { title: '登台' })
    await post(`/novels/${novel}/chapters/${chapter.id}/versions`, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text: '观星台' })
    return chapter.id as string
  }, ids.novel)
  await page.goto(`/#/write/${ids.novel}/${chapter}`)
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toHaveText('观星台')
  await page.locator('.manuscript-content p').first().evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.getByRole('group', { name: '选段快捷操作', exact: true }).getByRole('button', { name: '+ 记为设定', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '快速记录设定词条', exact: true })
  const name = dialog.getByRole('textbox', { name: '名称', exact: true })
  await expect(name).toHaveValue('观星台')
  const hold = deferred()
  let requests = 0
  await page.route(`**/api/v1/novels/${ids.novel}/entities`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    requests += 1
    const response = await route.fetch()
    await hold.promise
    await route.fulfill({ response })
  })
  try {
    await name.dispatchEvent('compositionstart')
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await expect(dialog.getByRole('button', { name: '存入设定库', exact: true })).toBeEnabled()
    await name.dispatchEvent('compositionend')
    await dialog.getByRole('button', { name: '存入设定库', exact: true }).click()
    await expect.poll(() => requests).toBe(1)
    await expect(name).toBeDisabled()
    await expect(dialog.getByRole('combobox', { name: '设定类型', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await page.keyboard.press('Escape')
    await page.mouse.click(3, 3)
    await expect(dialog).toBeVisible()
    hold.release()
    await expect(dialog).not.toBeVisible()
    const saved = await page.evaluate(async novel => (await (await fetch(`/api/v1/novels/${novel}/entities`)).json()).filter((entity: { name: string }) => entity.name === '观星台'), ids.novel)
    expect(saved).toHaveLength(1)
    expect(requests).toBe(1)
  } finally { hold.release(); await page.unrouteAll({ behavior: 'wait' }) }
})
