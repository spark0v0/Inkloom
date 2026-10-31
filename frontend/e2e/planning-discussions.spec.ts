import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { resolve } from 'node:path'

test('规划讨论恢复历史、重放未确认发送、采纳细纲并拦截旧提案', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function write(path: string, body: object, method = 'POST') {
      const response = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Discussion fixture ${response.status}: ${await response.text()}`)
      return response.json()
    }
    const novel = await write('/novels', { title: '雾港来信 · 规划讨论', premise: '林舟回到雾港，寻找父亲来信中提到的旧灯塔。' })
    const path = `/novels/${novel.id}`
    await write(path + '/plans', { title: '全书方案', level: 'book', body: '追查灯塔旧案，逐步揭开父亲的去向。' })
    await write(path + '/plans', { title: '第一卷 雾港', level: 'volume', body: '林舟从来信发现线索。' })
    const chapter = await write(path + '/chapters', { title: '第1章 雨夜来信', volume: '第一卷 雾港' })
    await write(path + `/chapters/${chapter.id}/outline`, { base_revision: 0, operation_id: crypto.randomUUID(), document: {
      kind: 'structured', title: chapter.title, goal: '林舟前往旧灯塔，寻找寄信人的线索。', conflict: '守塔人拒绝开门，潮水正在上涨。',
      beats: ['发现门上的新锁', '从侧窗看到父亲留下的刻印'], ending_hook: '楼上传来父亲惯常吹的口哨。',
    } }, 'PUT')
    const version = await write(path + `/chapters/${chapter.id}/versions`, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text: '雨水滴在信封上，林舟抬头望向旧灯塔。' })
    await write(path + '/chapters', { title: '第2章 守塔人', volume: '第一卷 雾港', goal: '追查守塔人的身份与来信的关系。' })
    return { novel: novel.id as string, chapter: chapter.id as string, version: version.id as string }
  })
  await page.goto(`/#/plot/${ids.novel}?view=discuss`)
  await page.getByRole('button', { name: '新讨论', exact: true }).click()
  const region = page.getByRole('region', { name: '规划讨论', exact: true })
  const composer = region.getByRole('textbox', { name: '讨论内容', exact: true })
  await expect(composer).toBeEnabled()
  await composer.fill('主角为什么要冒险去灯塔？希望行动动机更明确。')
  await composer.dispatchEvent('compositionstart')
  await composer.press('Control+Enter')
  expect(await page.evaluate(async id => (await (await fetch(`/api/v1/jobs?novel_id=${id}`)).json()).length, ids.novel)).toBe(0)
  await composer.dispatchEvent('compositionend')
  await region.getByRole('button', { name: '查看本次资料', exact: true }).click()
  const contextModal = page.getByRole('dialog', { name: '本次资料与费用估算', exact: true })
  await expect(contextModal).toContainText('没有读取正文')
  await contextModal.getByRole('button', { name: '关闭对话框', exact: true }).click()
  const payloads: { idempotency_key: string }[] = []
  let loseAck = true
  await page.route(`**/api/v1/novels/${ids.novel}/jobs`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    payloads.push(route.request().postDataJSON())
    if (loseAck) { loseAck = false; await route.fetch(); return route.abort('failed') }
    return route.continue()
  })
  await region.getByRole('button', { name: '发送', exact: true }).click()
  await expect(region.getByText('发送结果尚未确认。请先刷新讨论核对，或重试原请求。', { exact: true })).toBeVisible()
  await page.reload()
  await expect(region.getByText('发现未发送的讨论，其中一次发送尚未确认。恢复后请核对记录，再使用原请求重试。', { exact: true })).toBeVisible()
  await region.getByRole('button', { name: '恢复', exact: true }).click()
  await region.getByRole('button', { name: '刷新讨论', exact: true }).click()
  await expect(region.getByRole('button', { name: '查看并采纳', exact: true })).toBeVisible({ timeout: 15000 })
  await region.getByRole('button', { name: '重试原请求', exact: true }).click()
  await expect(composer).toHaveValue('')
  expect(payloads).toHaveLength(2)
  expect(payloads[0].idempotency_key).toBe(payloads[1].idempotency_key)
  expect(await region.locator('.discussion-turn').count()).toBe(1)
  await region.getByRole('button', { name: '查看并采纳', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '审阅细纲修改建议', exact: true })
  await expect(modal.getByRole('heading', { name: '原细纲', exact: true })).toBeVisible()
  const applyRequests: { operation_id: string }[] = []
  let loseApplyAck = true
  await page.route(`**/api/v1/novels/${ids.novel}/jobs/*/discussion-proposal`, async route => {
    applyRequests.push(route.request().postDataJSON())
    if (loseApplyAck) { loseApplyAck = false; await route.fetch(); return route.abort('failed') }
    return route.continue()
  })
  await modal.getByRole('button', { name: '采纳所选修改', exact: true }).click()
  await expect(modal.getByText('采纳结果尚未确认，请用原操作重试。', { exact: true })).toBeVisible()
  await page.mouse.click(2, 2)
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: '重试原操作', exact: true }).click()
  expect(applyRequests).toHaveLength(2)
  expect(applyRequests[0].operation_id).toBe(applyRequests[1].operation_id)
  await expect(modal.getByText('已采纳', { exact: true })).toBeVisible()
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  const first = await page.evaluate(async ids => ({
    outline: await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/outline`)).json(),
    chapter: await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)).json(),
  }), ids)
  expect(first.outline.revision).toBe(2)
  expect(first.outline.document.goal).toContain('核实收到的线索')
  expect(first.outline.document.conflict).toBe('守塔人拒绝开门，潮水正在上涨。')
  expect(first.chapter.working_version_id).toBe(ids.version)
  await composer.fill('接下来怎样让守塔人的阻拦更有悬念？')
  await region.getByRole('button', { name: '发送', exact: true }).click()
  await expect(region.getByRole('button', { name: '查看并采纳', exact: true })).toBeVisible({ timeout: 15000 })
  await page.reload()
  await expect(region.locator('.discussion-turn')).toHaveCount(2)
  await region.screenshot({ path: resolve('..', '.tmp', `planning-discussion-${testInfo.project.name}.png`) })
  const composerBox = await composer.boundingBox()
  const panelBox = await region.boundingBox()
  expect(composerBox && panelBox && composerBox.y + composerBox.height <= panelBox.y + panelBox.height).toBeTruthy()
  await region.getByRole('button', { name: '查看并采纳', exact: true }).click()
  await expect(modal).toBeVisible()
  await page.evaluate(async ids => {
    const path = `/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/outline`
    const current = await (await fetch(path)).json()
    const response = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_revision: current.revision, operation_id: crypto.randomUUID(), document: { ...current.document, goal: '作者决定让林舟等到天亮再进入灯塔。' } }) })
    if (!response.ok) throw new Error('Concurrent outline edit failed')
  }, ids)
  await modal.getByRole('button', { name: '采纳所选修改', exact: true }).click()
  await expect(modal.getByRole('alert').first()).toContainText('变化')
  await expect(modal.getByRole('button', { name: '采纳所选修改', exact: true })).toBeDisabled()
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  const discussionHash = new URL(page.url()).hash
  expect(discussionHash).toContain('&discussion=')
  await region.locator('.discussion-references > summary').click()
  await region.getByRole('button', { name: '编辑', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: '第1章 雨夜来信', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回规划讨论', exact: true }).click()
  expect(new URL(page.url()).hash).toBe(discussionHash)
  await expect(region.locator('.discussion-turn')).toHaveCount(2)
  const a11y = await new AxeBuilder({ page }).include('.planning-discussions').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(a11y.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toContainText('雨水滴在信封上')
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开写作助手', exact: true }).click()
  await expect(page.getByText('生成的正文会显示在这里', { exact: true })).toBeVisible()
  await expect(page.locator('.candidate-area')).not.toContainText('细纲修改建议')
  expect(errors).toEqual([])
})
