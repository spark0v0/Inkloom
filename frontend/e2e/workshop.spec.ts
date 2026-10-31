import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

test('卡剧情找灵感、选中方向续写、刷新恢复与采纳', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  await create(page, '灵感闭环')
  const original = '陈序拿到账本，发现里面夹着一封未署名的信。他不知道该先找谁。'
  await write(page, original)
  const submissions: Record<string, any>[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && /\/novels\/[^/]+\/jobs$/.test(request.url())) submissions.push(request.postDataJSON())
  })
  let panel = await assistant(page)
  await panel.getByRole('button', { name: '找灵感', exact: true }).click()
  await panel.getByLabel('卡在哪里？').selectOption('人物没有理由行动')
  await panel.getByRole('button', { name: '找三个走向', exact: true }).click()
  await expect(page.locator('.inspiration-card:visible')).toHaveCount(3)
  expect(submissions).toHaveLength(1)
  expect(submissions[0].task).toBe('inspiration')
  expect(submissions[0].instruction).toContain('人物没有理由行动')
  if (testInfo.project.name === 'mobile') await expect(page.locator('.inspiration-card:visible').first().getByRole('heading')).toBeInViewport()
  await page.screenshot({ path: resolve(`../docs/screenshots/inspiration-${testInfo.project.name}.png`) })
  await page.locator('.inspiration-card:visible').first().getByText('展开情节与依据', { exact: true }).click()
  await expect(page.locator('.inspiration-card:visible').first().getByText('需要补充或核对的铺垫', { exact: true })).toBeVisible()
  await closeAssistant(page)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText(original)
  await page.reload()
  panel = await assistant(page)
  if (await page.getByRole('button', { name: '剧情灵感', exact: true }).isVisible()) await page.getByRole('button', { name: '剧情灵感', exact: true }).click()
  await expect(page.locator('.inspiration-card:visible')).toHaveCount(3)
  expect(submissions).toHaveLength(1)
  await page.locator('.inspiration-card:visible').nth(1).getByRole('button', { name: '用这个方向续写' }).click()
  await expect(panel.getByText('已选：让对手先一步行动', { exact: true })).toBeVisible()
  expect(submissions).toHaveLength(1) // Choosing is not a paid generation.
  await panel.getByRole('button', { name: '按此方向续写', exact: true }).click()
  const adopt = page.getByRole('button', { name: '采纳正文', exact: true })
  await expect(adopt).toBeVisible()
  expect(submissions).toHaveLength(2)
  expect(submissions[1].task).toBe('continue')
  expect(submissions[1].inspiration.option_index).toBe(1)
  await adopt.click()
  await closeAssistant(page)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toContainText(original)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toContainText('门外的脚步声停了')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toContainText('门外的脚步声停了')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('改稿后旧灵感不能直接续写，找灵感前先保存', async ({ page }) => {
  test.setTimeout(60000)
  await create(page, '灵感基线保护')
  const text = '这份刚输入的原稿必须先保存，再作为灵感参考。'
  await page.getByRole('textbox', { name: '小说正文' }).fill(text)
  let panel = await assistant(page)
  await panel.getByRole('button', { name: '找灵感', exact: true }).click()
  await panel.getByRole('button', { name: '找三个走向', exact: true }).click()
  await expect(page.locator('.inspiration-card:visible')).toHaveCount(3)
  await closeAssistant(page)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText(text)
  await write(page, '主角烧掉了账本，原来的局面已经改变。')
  panel = await assistant(page)
  if (await page.getByRole('button', { name: '剧情灵感', exact: true }).isVisible()) await page.getByRole('button', { name: '剧情灵感', exact: true }).click()
  await expect(page.locator('.inspiration-card:visible').first().getByRole('button', { name: '用这个方向续写' })).toBeDisabled()
  await expect(page.getByText('正文或参考已变化，旧方向仍可阅读。请重新找灵感后再用于续写。', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '找灵感', exact: true }).click()
  await panel.getByRole('button', { name: '找三个走向', exact: true }).click()
  await expect(page.locator('.inspiration-card:visible').first().getByRole('button', { name: '用这个方向续写' })).toBeEnabled()
})

test('写作提交回执丢失时保留同一请求并锁定参数', async ({ page }) => {
  test.setTimeout(60000)
  await create(page, '提交保护')
  await write(page, '陈序把账本放在桌上。')
  const panel = await assistant(page)
  await panel.getByRole('button', { name: '找灵感', exact: true }).click()
  let lost = false
  const bodies: Record<string, any>[] = []
  await page.route('**/novels/*/jobs', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    bodies.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (!lost) { lost = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'LOST_ACK', message: '测试：提交回执丢失' }) }) }
    return route.fulfill({ response })
  })
  await panel.getByRole('button', { name: '找三个走向', exact: true }).click()
  await expect(panel.getByRole('button', { name: '确认上次提交', exact: true })).toBeVisible()
  await expect(panel.getByLabel('卡在哪里？')).toBeDisabled()
  await expect(panel.getByRole('button', { name: '写作', exact: true })).toBeDisabled()
  await expect(panel.getByRole('textbox', { name: '本次写作要求' })).toBeDisabled()
  await panel.getByRole('button', { name: '确认上次提交', exact: true }).click()
  await expect(page.locator('.inspiration-card:visible')).toHaveCount(3)
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  const jobs = await page.evaluate(async () => {
    const novelId = location.hash.split('/')[2]
    return (await (await fetch('/api/v1/jobs?novel_id=' + novelId)).json())
  })
  expect(jobs.filter((job: any) => job.task === 'inspiration')).toHaveLength(1)
})

async function create(page: Page, name: string, enterEditor = true) {
  await page.goto('/')
  await page.getByRole('button', { name: '新建小说', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await dialog.getByLabel('书名（可以稍后由 AI 起名）').fill(`${name}-${Date.now()}`)
  await dialog.getByRole('button', { name: '下一步：全书方案' }).click()
  await expect(page.getByRole('button', { name: 'AI 生成全书方案' })).toBeVisible()
  if (!enterEditor) return
  await page.getByRole('button', { name: '直接开始写作' }).click()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toBeVisible()
}
async function write(page: Page, text: string) {
  const manuscriptTab = page.getByRole('button', { name: '正文', exact: true })
  if (await manuscriptTab.isVisible()) await manuscriptTab.click()
  await page.getByRole('textbox', { name: '小说正文' }).fill(text)
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
}
async function assistant(page: Page) {
  await expect(page.locator('.editor-panel')).toBeVisible()
  const opener = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await opener.isVisible()) await opener.click()
  return page.locator('.assistant-panel:visible')
}
async function closeAssistant(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'AI 写作', exact: true })
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
  const manuscriptTab = page.getByRole('button', { name: '正文', exact: true })
  if (await manuscriptTab.isVisible()) await manuscriptTab.click()
}

async function directory(page: Page) {
  await expect(page.getByRole('textbox', { name: '小说正文' })).toBeVisible()
  const opener = page.getByRole('button', { name: '打开章节目录', exact: true })
  if (await opener.isVisible()) await opener.click()
  return page.locator('.chapter-panel:visible')
}

test('百章目录搜索、状态筛选、折叠定位与切章保存', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  await create(page, '长篇目录')
  const ids = await page.evaluate(async () => {
    const novelId = location.hash.split('/')[2]
    const chapters = []
    for (let i = 2; i <= 120; i++) {
      const response = await fetch(`/api/v1/novels/${novelId}/chapters`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          title: `第${i}章 ${i === 120 ? '归航' : '雾中来信'}`, volume: `第${Math.ceil(i / 40)}卷`,
          goal: i === 120 ? '林舟在灯塔与故人重逢' : '',
        }) })
      if (!response.ok) throw new Error(`fixture chapter ${i}: ${response.status}`)
      chapters.push(await response.json())
    }
    return { novelId, last: chapters.at(-1).id, previous: chapters.at(-2).id }
  })
  await page.reload()
  let panel = await directory(page)
  await expect(panel.getByRole('button', { name: '展开第3卷', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await panel.getByRole('textbox', { name: '搜索章节', exact: true }).fill('灯塔 重逢')
  await expect(panel.locator('.chapter-item')).toHaveCount(1)
  await expect(panel.locator('.chapter-item')).toContainText('第120章 归航')
  await panel.getByRole('combobox', { name: '章节状态', exact: true }).selectOption('confirmed')
  await expect(panel.getByText('没有匹配的章节', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '清除筛选', exact: true }).click()
  await panel.getByRole('button', { name: '收起第一卷', exact: true }).click()
  await expect(panel.locator('.chapter-item[aria-current]')).toHaveCount(0)
  await panel.getByRole('button', { name: '定位当前章', exact: true }).click()
  await expect(panel.locator('.chapter-item[aria-current]')).toBeInViewport()
  await panel.getByRole('textbox', { name: '搜索章节', exact: true }).fill('１２０')
  await expect(panel.locator('.chapter-item')).toHaveCount(1)
  await page.screenshot({ path: resolve(`../docs/screenshots/longform-directory-${testInfo.project.name}.png`) })
  await panel.locator('.chapter-item').click()
  await expect(page.getByRole('heading', { name: '第120章 归航', exact: true })).toBeVisible()
  const nav = page.getByRole('navigation', { name: '前后章节' })
  await expect(nav.getByRole('button', { name: /下一章/ })).toBeDisabled()
  await page.getByRole('textbox', { name: '小说正文' }).fill('切换章节前最后输入的文字不能丢失。')
  await nav.getByRole('button', { name: /上一章/ }).click()
  await expect(page).toHaveURL(new RegExp(ids.previous))
  await page.getByRole('navigation', { name: '前后章节' }).getByRole('button', { name: /下一章/ }).click()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('切换章节前最后输入的文字不能丢失。')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('切换章节前最后输入的文字不能丢失。')
  panel = await directory(page)
  await expect(panel.locator('.chapter-item[aria-current]')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('切章保存失败保留当前编辑内容', async ({ page }) => {
  await create(page, '切章保护')
  await page.evaluate(async () => {
    const novelId = location.hash.split('/')[2]
    const response = await fetch(`/api/v1/novels/${novelId}/chapters`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '第二章' }) })
    if (!response.ok) throw new Error(`fixture failed: ${response.status}`)
  })
  await page.reload()
  const initialUrl = page.url()
  await page.route('**/versions', route => route.request().method() === 'POST' ? route.abort() : route.continue())
  await page.getByRole('textbox', { name: '小说正文' }).fill('这份未保存的稿件需要保留。')
  await page.getByRole('navigation', { name: '前后章节' }).getByRole('button', { name: /下一章/ }).click()
  await expect(page.getByText('保存未确认', { exact: true })).toBeVisible()
  expect(page.url()).toBe(initialUrl)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('这份未保存的稿件需要保留。')
  await page.unroute('**/versions')
  await page.getByRole('navigation', { name: '前后章节' }).getByRole('button', { name: /下一章/ }).click()
  await expect(page.getByRole('heading', { name: '第二章', exact: true })).toBeVisible()
})

test('手写保存、刷新、版本、导出与正史确认', async ({ page }) => {
  await create(page, '手稿验收')
  await write(page, '😀林舟收起航海图。\n\n第二段：你好，雾港。')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toContainText('第二段：你好，雾港。')
  await page.getByRole('button', { name: '版本', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '章节版本' })).toContainText('林舟收起航海图。')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  await page.getByRole('button', { name: '仅定稿' }).click()
  await expect(page.getByRole('region', { name: '章节写作' }).getByText('已定稿', { exact: true })).toBeVisible()
  const exportButton = page.getByRole('button', { name: '导出', exact: true }); if (await exportButton.isVisible()) await exportButton.click(); else await page.getByRole('button', { name: '连载导出', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载正文', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.txt$/)
  const text = await page.getByRole('textbox', { name: '小说正文' }).innerText()
  expect(text).toContain('😀林舟')
})

test('演示候选不会直接改稿，采纳后旧版本保留', async ({ page }) => {
  await create(page, '候选验收')
  await write(page, '林舟把窗户关上。')
  const panel = await assistant(page)
  await panel.locator('.assistant-form').getByRole('button', { name: /^(重写本章正文|生成本章正文|润色选段)$/, exact: true }).click()
  await expect(page.getByRole('button', { name: '对比原稿', exact: true })).toBeVisible()
  await expect(page.locator('.manuscript-content')).toHaveText('林舟把窗户关上。')
  if (await page.getByRole('button', { name: 'AI 草稿', exact: true }).isVisible()) await page.getByRole('button', { name: 'AI 草稿', exact: true }).click()
  await page.getByRole('button', { name: '对比原稿', exact: true }).click()
  await page.getByRole('button', { name: '采纳正文', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '对比原稿' })).not.toBeVisible()
  await closeAssistant(page)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toContainText('没有把那个问题立刻问出口')
  await page.getByRole('button', { name: '版本', exact: true }).click()
  await expect(page.locator('.version-list button')).toHaveCount(3)
})

test('生成后修改原稿，旧候选不能覆盖新文字', async ({ page }) => {
  await create(page, '并发改稿验收')
  await write(page, '第一份原稿。')
  let panel = await assistant(page)
  await panel.locator('.assistant-form').getByRole('button', { name: /^(重写本章正文|生成本章正文|润色选段)$/, exact: true }).click()
  await expect(page.getByRole('button', { name: '对比原稿', exact: true })).toBeVisible()
  await closeAssistant(page)
  await write(page, '作者后来修改的新文字。')
  panel = await assistant(page)
  if (await page.getByRole('button', { name: 'AI 草稿', exact: true }).isVisible()) await page.getByRole('button', { name: 'AI 草稿', exact: true }).click()
  await page.getByRole('button', { name: '对比原稿', exact: true }).click()
  await page.getByRole('button', { name: '采纳正文', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '对比原稿' })).toContainText('原稿已更新')
  await expect(page.locator('.manuscript-content')).toHaveText('作者后来修改的新文字。')
})

test('两页编辑冲突保留双方，显式另存解决', async ({ page, context }) => {
  await create(page, '版本冲突验收')
  await write(page, '最初版本。')
  const other = await context.newPage()
  await other.goto(page.url())
  await expect(other.getByRole('textbox', { name: '小说正文' })).toContainText('最初版本。')
  await write(page, '第一页保存的文字。')
  await other.getByRole('textbox', { name: '小说正文' }).fill('第二页需要保留的文字。')
  const conflict = other.getByRole('dialog', { name: '此章已有另一个版本' })
  await expect(conflict).toBeVisible()
  await expect(conflict).toContainText('第一页保存的文字。')
  await expect(conflict).toContainText('第二页需要保留的文字。')
  await conflict.getByRole('button', { name: '将本页文字另存为新版本' }).click()
  await expect(conflict).not.toBeVisible()
  await other.reload()
  await expect(other.getByRole('textbox', { name: '小说正文' })).toHaveText('第二页需要保留的文字。')
})

test('离线保存不报成功，恢复连接后重试原请求', async ({ page, context }) => {
  await create(page, '离线验收')
  await write(page, '已经保存的文字。')
  await context.setOffline(true)
  await page.getByRole('textbox', { name: '小说正文' }).fill('网络中断期间的草稿。')
  await expect(page.getByText('保存未确认', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('网络中断期间的草稿。')
  await context.setOffline(false)
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('网络中断期间的草稿。')
})

test('提取只给提议，确认后可以定位来源与搜索', async ({ page }) => {
  await create(page, '记忆验收')
  await write(page, '林舟第一次抵达雾港。')
  const panel = await assistant(page)
  await panel.getByText('高级', { exact: true }).click()
  await panel.getByLabel('更多写作任务').selectOption('extract')
  await panel.getByText('高级', { exact: true }).click()
  await panel.getByRole('button', { name: '整理本章记忆', exact: true }).click()
  await expect(panel.getByText('这些记忆将在本章定稿时由你确认。')).toBeVisible()
  await closeAssistant(page)
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  await page.getByRole('button', { name: '仅定稿' }).click()
  await expect(page.getByRole('region', { name: '章节写作' }).getByText('已定稿', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /搜索已确认原文/ }).click()
  await page.getByRole('textbox', { name: '输入搜索内容' }).fill('林舟')
  await page.locator('.search-result').first().click()
  await expect(page.getByRole('dialog', { name: '原文依据' })).toContainText('林舟第一次抵达雾港。')
  await expect(page.locator('.source-selected mark')).toContainText('林舟')
})

test('窄屏无横向溢出，助手和目录通过抽屉可达', async ({ page }, testInfo) => {
  await create(page, '长标题和布局验收')
  await write(page, '一段用于布局检查的正文。'.repeat(250))
  const sizes = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth }))
  expect(sizes.body).toBeLessThanOrEqual(sizes.width)
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '打开章节目录' }).click()
    await expect(page.getByRole('dialog', { name: '章节目录' })).toBeVisible()
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
    await assistant(page)
    await expect(page.getByRole('dialog', { name: 'AI 写作' })).toBeVisible()
    await closeAssistant(page)
  }
  await expect(page.getByRole('button', { name: '本章定稿', exact: true })).toBeVisible()
})

test('emoji 后选段改写保留其余原文', async ({ page }) => {
  await create(page, '选段验收')
  await write(page, '😀林舟收起地图。')
  await page.locator('.manuscript-content p').first().evaluate(element => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 2); range.setEnd(element.firstChild!, 4)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  const panel = await assistant(page)
  await panel.getByRole('button', { name: '润色选段', exact: true }).click()
  await expect(panel.getByText('已选 2 字符')).toBeVisible()
  await panel.locator('.assistant-form').getByRole('button', { name: /^(重写本章正文|生成本章正文|润色选段)$/, exact: true }).click()
  if (await page.getByRole('button', { name: 'AI 草稿', exact: true }).isVisible()) await page.getByRole('button', { name: 'AI 草稿', exact: true }).click()
  await page.getByRole('button', { name: '对比原稿', exact: true }).click()
  await page.getByRole('button', { name: '采纳正文', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '对比原稿' })).not.toBeVisible()
  await closeAssistant(page)
  await expect(page.locator('.manuscript-content')).toContainText('😀林舟')
  await expect(page.locator('.manuscript-content')).toContainText('收起地图。')
  await expect(page.locator('.manuscript-content')).toContainText('没有把那个问题立刻问出口')
})

test('手稿切分预览与实际导入一致', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '导入手稿', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导入已有手稿' })
  await dialog.getByLabel('选择 TXT / Markdown').setInputFiles({ name: '原创导入样例.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 初见\n林舟在雾中辨认灯光。\n\n第二章 归来\n沈砚终于回来了。', 'utf8') })
  await dialog.getByRole('button', { name: '预览章节切分' }).click()
  await dialog.getByRole('button', { name: '第二章 归来', exact: true }).click()
  await dialog.getByLabel('修正章节名').fill('第二章 雾后的来客')
  await dialog.getByRole('button', { name: '确认导入 2 章' }).click()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toBeVisible()
  const directory = page.getByRole('button', { name: '打开章节目录' })
  if (await directory.isVisible()) await directory.click()
  await page.getByRole('button', { name: /第二章 雾后的来客 草稿/ }).click()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('沈砚终于回来了。')
})

test('备份下载、校验与新工作区恢复', async ({ page }) => {
  await create(page, '恢复验收')
  await write(page, '这份正文需要在恢复后完整保留。')
  const original = await page.evaluate(async () => (await (await fetch('/api/v1/health')).json()).workspace_id)
  await page.goto('/#/backup')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载工作区备份' }).click()
  const file = await (await downloaded).path()
  await page.getByLabel('选择工作区备份').setInputFiles(file!)
  await page.getByRole('button', { name: '校验并预览备份' }).click()
  const dialog = page.getByRole('dialog', { name: '备份已通过校验' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '切换到恢复的工作区' }).click()
  try {
    await expect(page.getByRole('heading', { name: '我的作品', exact: true })).toBeVisible()
    const restored = await page.evaluate(async () => (await (await fetch('/api/v1/health')).json()).workspace_id)
    expect(restored).not.toBe(original)
    const search = page.getByRole('textbox', { name: '搜索作品', exact: true })
    if (await search.isVisible()) await search.fill('恢复验收')
    else {
      await page.getByRole('button', { name: '搜索作品', exact: true }).click()
      await page.getByRole('textbox', { name: '输入搜索内容' }).fill('恢复验收')
      await page.getByRole('dialog').getByRole('button', { name: '搜索作品', exact: true }).click()
    }
    await page.getByRole('button', { name: '继续写作', exact: true }).first().click()
    await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('这份正文需要在恢复后完整保留。')
  } finally {
    // Workspace activation is server-wide; later cases must start in the disposable original.
    const response = await page.request.post('/api/v1/workspace/use-original', { headers: { Origin: new URL(page.url()).origin } })
    expect(response.ok()).toBeTruthy()
    expect((await (await page.request.get('/api/v1/health')).json()).workspace_id).toBe(original)
  }
})

test('编辑器与助手的自动可访问性检查', async ({ page }) => {
  await create(page, '可访问性检查')
  await write(page, '一段用于检查的正文。')
  const collect = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, message: n.failureSummary })) }))
  expect(await collect()).toEqual([])
  await assistant(page)
  expect(await collect()).toEqual([])
})

test('任务已提交但响应失败，重试复用同一任务', async ({ page }) => {
  await create(page, '幂等提交验收')
  await write(page, '林舟等着门外的人开口。')
  let intercepted = false
  await page.route('**/novels/*/jobs', async route => {
    if (route.request().method() === 'POST' && !intercepted) {
      intercepted = true
      await route.fetch()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SIMULATED_RESPONSE_FAILURE', message: '测试：提交已到达，响应未确认。', details: {} }) })
    } else await route.continue()
  })
  const panel = await assistant(page)
  await panel.locator('.assistant-form').getByRole('button', { name: /^(重写本章正文|生成本章正文|润色选段)$/, exact: true }).click()
  await expect(panel.getByText('测试：提交已到达，响应未确认。')).toBeVisible()
  await panel.locator('.assistant-form').getByRole('button', { name: '确认上次提交', exact: true }).click()
  await expect(page.getByRole('button', { name: '对比原稿', exact: true })).toBeVisible()
  const ids = new URL(page.url()).hash.split('/')
  const jobs = await page.evaluate(async novelId => (await (await fetch('/api/v1/jobs?novel_id=' + novelId)).json()), ids[2])
  expect(jobs).toHaveLength(1)
  expect(jobs[0].attempt_count).toBe(1)
})

test('AI 建书、章节细纲、整章生成、记忆定稿、下一章与连载导出', async ({ page }) => {
  test.setTimeout(70000)
  await create(page, 'AI连载闭环', false)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(accessibility.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
  await page.getByRole('button', { name: 'AI 生成全书方案', exact: true }).click()
  const book = page.getByRole('region', { name: 'AI 全书方案', exact: true })
  await expect(book.getByText('演示样例 · 候选已生成')).toBeVisible({ timeout: 20000 })
  await book.getByRole('button', { name: '采纳方案，规划章节' }).click({ timeout: 20000 })
  const planning = page.getByRole('region', { name: 'AI 章节细纲', exact: true })
  await planning.getByLabel('本次规划').selectOption('3')
  await planning.getByRole('button', { name: '生成 3 章细纲', exact: true }).click()
  await planning.getByRole('button', { name: '采纳这 3 章' }).click({ timeout: 20000 })
  await expect(page.locator('.chapter-table-row')).toHaveCount(3)
  await page.locator('.setup-ready').getByRole('button', { name: '开始写作' }).click()
  const panel = await assistant(page)
  await expect(panel.getByLabel('目标字数')).toHaveValue('2000')
  await panel.getByRole('button', { name: '生成本章正文', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  await expect(page.locator('.manuscript-content')).toBeEmpty()
  await page.getByRole('button', { name: '采纳正文', exact: true }).click()
  await expect(panel.locator('.badge').filter({ hasText: '已采纳' })).toBeVisible()
  await closeAssistant(page)
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  const finish = page.getByRole('dialog', { name: '本章定稿', exact: true })
  await finish.getByRole('button', { name: 'AI 整理本章记忆', exact: true }).click()
  await expect(finish.locator('.canon-proposal').first()).toBeVisible()
  await finish.getByRole('button', { name: '确认定稿，下一章', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第2章 旧码头', exact: true })).toBeVisible()
  const nextPanel = await assistant(page)
  await nextPanel.getByRole('button', { name: '生成本章正文', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  await closeAssistant(page)
  const exportButton = page.getByRole('button', { name: '导出', exact: true })
  if (await exportButton.isVisible()) await exportButton.click()
  else await page.getByRole('button', { name: '连载导出', exact: true }).click()
  const exporting = page.getByRole('dialog', { name: '连载导出', exact: true })
  await exporting.getByLabel('格式').selectOption('zip')
  await expect(exporting.getByLabel('正文范围')).toHaveValue('confirmed')
  const download = page.waitForEvent('download')
  await exporting.getByRole('button', { name: '下载正文', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.zip$/)
  await expect(exporting).not.toBeVisible()
  const novelId = new URL(page.url()).hash.split('/')[2]
  await page.goto(`/#/jobs/${novelId}`)
  await page.locator('.job-row').filter({ hasText: '全书方案' }).click()
  const record = page.getByRole('dialog', { name: '任务记录', exact: true })
  await expect(record.getByRole('heading', { name: '作品简介', exact: true })).toBeVisible()
  await record.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.locator('.job-row').filter({ hasText: '章节细纲' }).click()
  await expect(record.locator('.outline-preview')).toContainText('雨夜来信')
})

test('首个模型连接可同时用于全部创作环节', async ({ page }, testInfo) => {
  const connectionName = `本机配置验收-${testInfo.project.name}-${Date.now()}`
  await page.goto('/#/settings')
  await page.getByRole('button', { name: '添加模型连接', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加模型连接', exact: true })
  await dialog.getByLabel('连接名称').fill(connectionName)
  await dialog.getByLabel('服务地址').fill('http://127.0.0.1:1/v1')
  await dialog.getByLabel('模型 ID').fill('local-validation-only')
  await dialog.getByLabel('API Key', { exact: true }).fill('test-only-placeholder-never-sent')
  await dialog.getByLabel('同时设为默认创作模型（策划、写作、记忆与审稿）').check()
  await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const values = await page.evaluate(async () => ({
    providers: await (await fetch('/api/v1/providers')).json(),
    roles: await (await fetch('/api/v1/roles')).json(),
  }))
  const configured = values.providers.find((p: { name: string }) => p.name === connectionName)
  expect(configured.has_key).toBe(true)
  expect(JSON.stringify(values.providers)).not.toContain('test-only-placeholder-never-sent')
  expect(Object.values(values.roles)).toEqual([configured.id, configured.id, configured.id, configured.id])
  await page.evaluate(async () => {
    await fetch('/api/v1/roles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writer: 'demo', planner: 'demo', extractor: 'demo', reviewer: 'demo' }) })
  })
})

test('模型目录读取、选择和就地错误反馈', async ({ page }, testInfo) => {
  let malformed = false
  const calls: string[] = []
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(malformed ? [] : { data: [{ id: 'writer-a' }, { id: 'writer-b' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test provider did not bind')
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  const name = `目录选择-${testInfo.project.name}-${Date.now()}`
  try {
    await page.goto('/#/settings')
    const id = await page.evaluate(async ({ baseUrl, name }) => {
      const response = await fetch('/api/v1/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, base_url: baseUrl, model: 'unknown-model', api_key: 'test-only-placeholder' }) })
      if (!response.ok) throw new Error(`Provider fixture failed: ${response.status}`)
      return (await response.json()).id
    }, { baseUrl, name })
    await page.reload()
    const card = page.locator('.provider-card').filter({ has: page.getByRole('heading', { name, exact: true }) })
    await card.getByRole('button', { name: '检查连接', exact: true }).click()
    await expect(card.getByText(/当前模型未出现在目录中/)).toBeVisible()
    await card.getByRole('button', { name: '选择目录中的模型（2 个）', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '配置模型连接', exact: true })
    await dialog.getByRole('combobox', { name: '从服务目录选择模型', exact: true }).selectOption('writer-b')
    await expect(dialog.getByLabel('模型 ID', { exact: true })).toHaveValue('writer-b')
    await dialog.getByLabel('服务地址', { exact: true }).fill('http://127.0.0.1:1/v1')
    await expect(dialog.getByRole('combobox', { name: '从服务目录选择模型', exact: true })).toHaveCount(0)
    await dialog.getByLabel('服务地址', { exact: true }).fill(baseUrl)
    await page.screenshot({ path: resolve(`../docs/screenshots/model-catalog-${testInfo.project.name}.png`) })
    await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(card.getByText('writer-b', { exact: true })).toBeVisible()
    expect(calls).toEqual(['GET /v1/models'])
    const saved = await page.evaluate(async id => (await (await fetch('/api/v1/providers')).json()).find((p: { id: string }) => p.id === id), id)
    expect(saved.model).toBe('writer-b')
    expect(JSON.stringify(saved)).not.toContain('test-only-placeholder')
    malformed = true
    await card.getByRole('button', { name: '检查连接', exact: true }).click()
    await expect(card.getByRole('alert')).toContainText('模型目录格式不兼容')
    expect(calls).toEqual(['GET /v1/models', 'GET /v1/models'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})


test('开书方案刷新可恢复，采纳后页内进入细纲且不会自动调用', async ({ page }) => {
  await create(page, '开书恢复', false)
  const panel = page.getByRole('region', { name: 'AI 全书方案' })
  await panel.getByLabel('创作模型').selectOption('demo')
  await panel.getByRole('button', { name: 'AI 生成全书方案' }).click()
  await expect(panel.getByRole('button', { name: '采纳方案，规划章节' })).toBeVisible({ timeout: 20000 })
  await page.reload()
  await page.getByRole('button', { name: '采纳方案，规划章节' }).click()
  await expect(page.getByRole('region', { name: 'AI 章节细纲' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const novelId = new URL(page.url()).hash.split('/')[2]
  const jobs = await page.evaluate(async id => (await (await fetch('/api/v1/jobs?novel_id=' + id)).json()), novelId)
  expect(jobs).toHaveLength(1)
  expect(jobs[0].candidate_status).toBe('adopted')
  await page.getByRole('button', { name: '返回大纲', exact: true }).click()
  await expect(page.locator('.volume-option')).toHaveCount(3)
})

test('继续写作进入未完成章，前章未定稿有直接处理入口', async ({ page }) => {
  const title = `继续写作定位-${Date.now()}`
  await create(page, title)
  await write(page, '林舟已经找到第一条线索。')
  const novelId = new URL(page.url()).hash.split('/')[2]
  const firstId = new URL(page.url()).hash.split('/')[3]
  const next = await page.evaluate(async id => (await (await fetch(`/api/v1/novels/${id}/chapters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '第2章 新线索', volume: '第一卷', goal: '' }),
  })).json()), novelId)
  await page.goto(`/#/write/${novelId}/${next.id}`)
  const panel = await assistant(page)
  await expect(panel.getByRole('button', { name: '生成本章正文', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '去处理前章' }).click()
  await expect(page).toHaveURL(new RegExp(firstId + '$'))
  await page.getByRole('button', { name: '本章定稿', exact: true }).click()
  await page.getByRole('button', { name: '仅定稿', exact: true }).click()
  await page.goto('/')
  const book = page.locator('.library-book').filter({ hasText: title })
  await book.getByRole('button', { name: '继续写作', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(next.id + '$'))
  await expect(page.getByRole('heading', { name: '第2章 新线索', exact: true })).toBeVisible()
})
