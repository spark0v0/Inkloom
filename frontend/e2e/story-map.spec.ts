import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { resolve } from 'node:path'

test('故事脉络区分计划与原文进展，支持改纲、深链、筛选与刷新失败恢复', async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/')
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function write(path: string, body: object, method = 'POST') {
      const response = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Story map fixture ${response.status}: ${await response.text()}`)
      return response.json()
    }
    const novel = await write('/novels', { title: '雾港来信 · 脉络验收', premise: '林舟回到雾港，沿着断裂罗盘寻找父亲的下落。' })
    const path = `/novels/${novel.id}`
    await write(path + '/plans', { title: '雾港旧案', level: 'book', body: '先寻找罗盘的来历，再追查北岸密库。' })
    const chapters = []
    for (let i = 0; i < 41; i++) {
      const names = ['雨夜归港', '商队旧事', '北岸密库']
      const goals = ['林舟在旧货箱找到罗盘，码头上的钟声却提前响起。', '商人辨认罗盘上的刻印，线索指向旧航线。', '林舟前往北岸，调查罗盘与密库的关系。']
      const chapter = await write(path + '/chapters', { title: names[i] || `远航篇第${i + 1}章`, volume: i < 3 ? '第一卷：雾港旧事' : '第二卷：远航', goal: goals[i] || '在远航中寻找旧案的下一条线索。' })
      chapters.push(chapter)
    }
    const thread = await write(path + '/entities', { kind: 'thread', name: '断裂罗盘', summary: '罗盘背面的刻印指向失落的航线。', aliases: ['Compass'], status: 'author' })
    let track = await write(path + `/threads/${thread.id}`, { base_revision: 0, target_chapter_id: chapters[2].id, intent: '在北岸密库揭开刻印的含义。', paused: false }, 'PUT')
    for (let i = 0; i < 2; i++) {
      const version = await write(path + `/chapters/${chapters[i].id}/versions`, { base_version_id: chapters[i].working_version_id, operation_id: crypto.randomUUID(), text: i ? '商人认出了罗盘上的旧刻印。' : '林舟从旧货箱里找到一枚断裂的罗盘。' })
      await write(path + `/chapters/${chapters[i].id}/canon`, { version_id: version.id, operation_id: crypto.randomUUID(), changes: [] })
      track = await write(path + `/threads/${thread.id}/progress`, { base_revision: track.revision, operation_id: crypto.randomUUID(), chapter_id: chapters[i].id, version_id: version.id, stage: i ? 'advanced' : 'planted', evidence: { source_id: `${version.id}:${version.paragraphs[0].paragraph_id}`, quote: version.text } })
      chapters[i].working_version_id = version.id
    }
    await write(path + `/chapters/${chapters[1].id}/versions`, { base_version_id: chapters[1].working_version_id, operation_id: crypto.randomUUID(), text: '商人否认见过刻印，林舟只能另寻线索。' })
    const other = await write(path + '/entities', { kind: 'thread', name: '一封横跨三十年的北岸旧信与无人认领的ArchiveRecord', summary: '尚未验证的旧信线索。' })
    await write(path + `/threads/${other.id}`, { base_revision: 0, target_chapter_id: chapters[40].id, intent: '之后再安排旧信的回收。', paused: true }, 'PUT')
    return { novel: novel.id, thread: thread.id, chapters: chapters.map(c => c.id), firstVersion: chapters[0].working_version_id }
  })
  const mapUrl = `/#/plot/${ids.novel}?view=map`
  await page.goto(mapUrl)
  const map = page.getByRole('region', { name: '故事脉络', exact: true })
  const first = map.getByRole('article', { name: '雨夜归港', exact: true })
  const second = map.getByRole('article', { name: '商队旧事', exact: true })
  const third = map.getByRole('article', { name: '北岸密库', exact: true })
  await expect(first.getByText('已埋设', { exact: true })).toBeVisible()
  await expect(second.getByText('推进待复核', { exact: true })).toBeVisible()
  await expect(third.getByText('计划回收', { exact: true })).toBeVisible()
  await expect(third.getByText('已回收', { exact: true })).toHaveCount(0)
  await expect(map.getByRole('article')).toHaveCount(40)
  const paging = map.getByRole('navigation', { name: '脉络翻页', exact: true })
  await paging.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(map.getByRole('article')).toHaveCount(1)
  await expect(map.getByRole('heading', { name: '远航篇第41章', exact: true })).toBeFocused()
  await expect(map.getByText('暂缓计划', { exact: true })).toBeVisible()
  await paging.getByRole('button', { name: '上一页', exact: true }).click()
  await map.getByRole('textbox', { name: '搜索章节、细纲或伏笔', exact: true }).fill('ＣＯＭＰＡＳＳ')
  await expect(map.getByRole('article')).toHaveCount(3)
  const filterToggle = map.getByRole('button', { name: /^筛选/ })
  if (await filterToggle.isVisible()) await filterToggle.click()
  await map.getByRole('combobox', { name: '脉络章节状态', exact: true }).selectOption('needs_review')
  await expect(map.getByRole('article')).toHaveCount(1)
  await map.getByRole('combobox', { name: '脉络章节状态', exact: true }).selectOption('')
  if (await filterToggle.isVisible()) await filterToggle.click()
  await page.locator('.page-scroll').evaluate(e => { e.scrollTop = 0 })
  await page.screenshot({ path: resolve(`../docs/screenshots/story-map-${testInfo.project.name}.png`) })
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.screenshot({ path: resolve('../docs/screenshots/story-map-tablet.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(accessibility.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await second.getByRole('button', { name: '查看旧版原文', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('商人认出了罗盘上的旧刻印。', { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '关闭对话框', exact: true }).click()
  await first.getByRole('button', { name: '编辑细纲', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '现有细纲', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '现有细纲', exact: true }).fill('林舟发现罗盘后主动拜访守夜人，在钟楼找到第二条线索。')
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect(page.locator('.outline-save-bar')).toContainText('已保存')
  await page.getByRole('button', { name: '返回故事脉络', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`plot/${ids.novel}\\?view=map$`))
  await expect(first).toContainText('主动拜访守夜人')
  await first.getByRole('button', { name: '断裂罗盘', exact: true }).click()
  await expect(page.getByRole('region', { name: '伏笔详情', exact: true }).getByRole('heading', { name: '断裂罗盘', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: '伏笔详情', exact: true })).toContainText('断裂罗盘')
  await page.goto(mapUrl)
  await expect(first).toBeVisible()
  for (const resource of ['threads', 'chapters']) {
    const path = `**/api/v1/novels/${ids.novel}/${resource}`
    await page.route(path, route => route.fulfill({ status: 503, json: { code: 'TEST_OFFLINE', message: '验收：暂时不可用' } }))
    await map.getByRole('button', { name: '刷新脉络', exact: true }).click()
    await expect(map.getByRole('alert')).toContainText('刷新未完成')
    await expect(first).toContainText('主动拜访守夜人')
    await page.unroute(path)
    await map.getByRole('button', { name: '刷新脉络', exact: true }).click()
    await expect(map.getByRole('alert')).toHaveCount(0)
  }
  await map.getByRole('textbox', { name: '搜索章节、细纲或伏笔', exact: true }).fill('没有这个情节')
  await expect(map.getByRole('heading', { name: '没有符合条件的章节', exact: true })).toBeVisible()
  await map.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(map.getByRole('article')).toHaveCount(40)
  const state = await page.evaluate(async id => ({
    jobs: await (await fetch(`/api/v1/jobs?novel_id=${id.novel}`)).json(),
    chapter: await (await fetch(`/api/v1/novels/${id.novel}/chapters/${id.chapters[0]}`)).json(),
  }), ids)
  expect(state.jobs).toEqual([])
  expect(state.chapter.working_version_id).toBe(ids.firstVersion)
  expect(pageErrors).toEqual([])
})
