import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { resolve } from 'node:path'

async function fixture(page: Page) {
  await page.goto('/')
  const ids = await page.evaluate(async () => {
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Thread fixture failed: ' + response.status)
      return response.json()
    }
    const novel = await post('/novels', { title: '伏笔跟进验收-' + Date.now() })
    const chapters: { id: string; version: string }[] = []
    for (const [title, text] of [['雨夜归港', '罗盘指针已经断裂🙂，无法再辨认方向。\n\n他向商队问路。'], ['商队旧事', '老商人认出了罗盘背面的刻印。'], ['北岸密库', '最后答案：罗盘来自北岸的密库。']]) {
      const chapter = await post(`/novels/${novel.id}/chapters`, { title })
      const version = await post(`/novels/${novel.id}/chapters/${chapter.id}/versions`, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text })
      await post(`/novels/${novel.id}/chapters/${chapter.id}/canon`, { version_id: version.id, operation_id: crypto.randomUUID(), changes: [] })
      chapters.push({ id: chapter.id, version: version.id })
    }
    const entity = await post(`/novels/${novel.id}/entities`, { kind: 'thread', name: '断裂罗盘', summary: '刻印指向失落的航线，也牵出父亲的下落。' })
    return { novel: novel.id, entity: entity.id, chapters }
  })
  await page.goto(`/#/bible/${ids.novel}`)
  await page.locator('.page-tabs').getByRole('button', { name: /^伏笔/ }).click()
  await expect(page.getByRole('region', { name: '伏笔详情', exact: true })).toBeVisible()
  return ids
}

async function associate(page: Page, chapterId: string, stage: string) {
  await page.getByRole('button', { name: '关联正文进展', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '关联正文进展', exact: true })
  await dialog.getByLabel('已定稿章节', { exact: true }).selectOption(chapterId)
  await expect(dialog.getByRole('blockquote')).toBeVisible()
  await dialog.getByLabel('进展类型', { exact: true }).selectOption(stage)
  await dialog.getByRole('button', { name: '确认关联', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

async function readThreads(page: Page, novel: string) {
  return page.evaluate(async novel => (await (await fetch(`/api/v1/novels/${novel}/threads`)).json()), novel)
}

test('伏笔计划、原文关联与撤销恢复，写作只看到当时有效进展', async ({ page }, testInfo) => {
  const ids = await fixture(page)
  const detail = page.getByRole('region', { name: '伏笔详情', exact: true })
  const search = page.getByRole('textbox', { name: '搜索伏笔', exact: true })
  expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(180)
  await search.fill('没有这条伏笔')
  await expect(page.getByRole('heading', { name: '没有符合条件的伏笔', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await search.fill('罗盘')
  await expect(detail).toBeVisible()
  await detail.getByLabel('计划回收章节', { exact: true }).selectOption(ids.chapters[1].id)
  await detail.getByLabel('届时如何推进或回收', { exact: true }).fill('让商人辨认刻印，保留父亲下落的悬念。')
  await detail.getByRole('button', { name: '保存安排', exact: true }).click()
  await expect(detail.getByText('安排已保存', { exact: true })).toBeVisible()
  await associate(page, ids.chapters[0].id, 'planted')
  await associate(page, ids.chapters[1].id, 'advanced')
  await detail.getByRole('heading', { name: '断裂罗盘', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(`../docs/screenshots/thread-tracking-${testInfo.project.name}.png`) })
  await detail.getByRole('article', { name: '推进记录：商队旧事', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(`../docs/screenshots/thread-progress-${testInfo.project.name}.png`) })
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(a11y.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await associate(page, ids.chapters[2].id, 'resolved')
  await expect(detail.getByRole('button', { name: '关联正文进展', exact: true })).toBeDisabled()
  const resolved = detail.getByRole('article', { name: '回收记录：北岸密库', exact: true })
  await resolved.getByRole('button', { name: '撤销关联', exact: true }).click()
  await expect(detail.getByRole('button', { name: '关联正文进展', exact: true })).toBeEnabled()
  await detail.getByText('已撤销记录（1）', { exact: true }).click()
  await resolved.getByRole('button', { name: '恢复关联', exact: true }).click()
  await expect(detail.getByRole('button', { name: '关联正文进展', exact: true })).toBeDisabled()
  await page.reload()
  await page.locator('.page-tabs').getByRole('button', { name: /^伏笔/ }).click()
  await expect(page.getByRole('region', { name: '伏笔详情', exact: true }).getByText('已回收', { exact: true })).toBeVisible()
  await page.goto(`/#/write/${ids.novel}/${ids.chapters[1].id}`)
  await expect(page.locator('.editor-panel')).toBeVisible()
  const open = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await open.isVisible()) await open.click()
  const assistant = page.locator('.assistant-panel:visible')
  await assistant.getByRole('combobox', { name: '写作模型', exact: true }).selectOption('demo')
  await assistant.getByRole('button', { name: '查看将引用的资料', exact: true }).click()
  const context = page.getByRole('dialog', { name: '本次引用资料', exact: true }).locator('.context-thread-guidance')
  await expect(context.getByText('已埋设', { exact: true })).toBeVisible()
  await expect(context).not.toContainText('最后答案')
  await expect(context).not.toContainText('已回收')
  const jobs = await page.evaluate(async novel => (await (await fetch(`/api/v1/jobs/page?novel_id=${novel}`)).json()), ids.novel)
  expect(jobs.items).toEqual([])
  expect((await readThreads(page, ids.novel))[0].progress).toHaveLength(3)
})

test('伏笔双窗口保存冲突保留输入，读取最新安排后可明确保存', async ({ page }) => {
  const ids = await fixture(page)
  const other = await page.context().newPage()
  await other.goto(`/#/bible/${ids.novel}`)
  await other.locator('.page-tabs').getByRole('button', { name: /^伏笔/ }).click()
  await other.getByLabel('届时如何推进或回收', { exact: true }).fill('第二窗口的安排，不能丢失。')
  await page.getByLabel('届时如何推进或回收', { exact: true }).fill('第一窗口已保存的计划。')
  await page.getByRole('button', { name: '保存安排', exact: true }).click()
  await expect(page.getByText('安排已保存', { exact: true })).toBeVisible()
  await other.getByRole('button', { name: '保存安排', exact: true }).click()
  await expect(other.getByRole('alert').filter({ hasText: '伏笔跟进已在其他窗口更新' })).toBeVisible()
  await expect(other.getByLabel('届时如何推进或回收', { exact: true })).toHaveValue('第二窗口的安排，不能丢失。')
  await other.getByRole('button', { name: '读取最新记录', exact: true }).click()
  await expect(other.getByRole('alert').filter({ hasText: '当前已保存的安排：第一窗口已保存的计划。' })).toBeVisible()
  await expect(other.getByLabel('届时如何推进或回收', { exact: true })).toHaveValue('第二窗口的安排，不能丢失。')
  await other.getByRole('button', { name: '保存安排', exact: true }).click()
  await expect(other.getByText('安排已保存', { exact: true })).toBeVisible()
  expect((await readThreads(other, ids.novel))[0].intent).toBe('第二窗口的安排，不能丢失。')
  await other.close()
})

test('正文改稿后旧伏笔待复核，打开的关联表单拒绝旧版本并保留说明', async ({ page }) => {
  const ids = await fixture(page)
  await associate(page, ids.chapters[0].id, 'planted')
  await page.getByRole('button', { name: '关联正文进展', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '关联正文进展', exact: true })
  await dialog.getByLabel('已定稿章节', { exact: true }).selectOption(ids.chapters[1].id)
  await dialog.getByLabel('作者说明（可选）', { exact: true }).fill('尚未保存的说明。')
  await page.evaluate(async ids => {
    const response = await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapters[0].id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_version_id: ids.chapters[0].version, operation_id: crypto.randomUUID(), text: '罗盘没有损坏，作者改变了设定。' }) })
    if (!response.ok) throw new Error('Source update failed')
  }, ids)
  await dialog.getByRole('button', { name: '确认关联', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('请先将该章节定稿')
  await expect(dialog.getByLabel('作者说明（可选）', { exact: true })).toHaveValue('尚未保存的说明。')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.reload()
  await page.locator('.page-tabs').getByRole('button', { name: /^伏笔/ }).click()
  const detail = page.getByRole('region', { name: '伏笔详情', exact: true })
  await expect(detail.getByText('待复核', { exact: true })).toBeVisible()
  await expect(detail.getByRole('article')).toContainText('原文已变更或章节待重新定稿')
  expect((await readThreads(page, ids.novel))[0].progress).toHaveLength(1)
})

test('关联保存回执丢失后重试不重复，也不覆盖其他窗口的新计划', async ({ page }) => {
  const ids = await fixture(page)
  await page.getByLabel('届时如何推进或回收', { exact: true }).fill('当前窗口尚未保存的安排。')
  let fail = true
  await page.route(`**/api/v1/novels/${ids.novel}/threads/${ids.entity}/progress`, async route => {
    if (route.request().method() === 'POST' && fail) {
      fail = false
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_ACK_LOST', message: '模拟保存回执丢失。' }) })
    } else await route.continue()
  })
  await page.getByRole('button', { name: '关联正文进展', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '关联正文进展', exact: true })
  await expect(dialog.getByRole('blockquote')).toBeVisible()
  await dialog.getByRole('button', { name: '确认关联', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('保存回执未确认')
  await expect(dialog.getByLabel('作者说明（可选）', { exact: true })).toBeDisabled()
  await page.evaluate(async ids => {
    const track = (await (await fetch(`/api/v1/novels/${ids.novel}/threads`)).json())[0]
    const response = await fetch(`/api/v1/novels/${ids.novel}/threads/${ids.entity}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_revision: track.revision, intent: '另一个窗口刚刚保存的安排。' }) })
    if (!response.ok) throw new Error('Concurrent plan save failed')
  }, ids)
  await dialog.getByRole('button', { name: '重试确认关联', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect((await readThreads(page, ids.novel))[0].progress).toHaveLength(1)
  await expect(page.getByLabel('届时如何推进或回收', { exact: true })).toHaveValue('当前窗口尚未保存的安排。')
  await page.getByRole('button', { name: '保存安排', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '伏笔跟进已在其他窗口更新' })).toBeVisible()
  expect((await readThreads(page, ids.novel))[0].intent).toBe('另一个窗口刚刚保存的安排。')
})
