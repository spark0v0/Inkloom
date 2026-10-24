import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function fixture(page: Page) {
  await page.goto('/')
  await page.request.get('/api/v1/health')
  return page.evaluate(async () => {
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`)
      return response.json()
    }
    const novel = await post('/novels', { title: '本章参考验收-' + Date.now(), chapter_words: 3000 })
    const entity = await post(`/novels/${novel.id}/entities`, { kind: 'character', name: '陈序', summary: '只用左手拿笔的档案员。' })
    let first: any
    let firstVersion: any
    for (const [i, text] of ['罗盘已经损坏，不能用于辨认方向。', '他们跟随商队出发。', '众人在驿站过夜。'].entries()) {
      const chapter = await post(`/novels/${novel.id}/chapters`, { title: ['第1章 雨夜来信', '第2章 途中', '第3章 夜宿'][i] })
      const version = await post(`/novels/${novel.id}/chapters/${chapter.id}/versions`, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text })
      await post(`/novels/${novel.id}/chapters/${chapter.id}/canon`, { version_id: version.id, operation_id: crypto.randomUUID() })
      if (!i) { first = chapter; firstVersion = version }
    }
    const current = await post(`/novels/${novel.id}/chapters`, { title: '第4章 再次启程' })
    const future = await post(`/novels/${novel.id}/chapters`, { title: '第5章 未来的秘密' })
    return { novel: novel.id, chapter: current.id, entity: entity.id, first: first.id, firstVersion: firstVersion.id, future: future.id }
  })
}

async function openAssistant(page: Page) {
  await expect(page.locator('.editor-panel')).toBeVisible()
  const opener = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await opener.isVisible()) await opener.click()
  return page.locator('.assistant-panel:visible')
}

async function openReferences(page: Page) {
  const panel = await openAssistant(page)
  await panel.getByRole('button', { name: /^本章参考/ }).click()
  const dialog = page.getByRole('dialog', { name: '本章参考', exact: true })
  await expect(dialog.getByLabel('搜索本章参考')).toBeVisible()
  return dialog
}

test('本章必读保存与刷新恢复，生成只采用保存的参考和任务目标', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const ids = await fixture(page)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await page.getByRole('textbox', { name: '小说正文' }).fill('陈序收起行囊，准备再次出发。')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  const submissions: any[] = []
  page.on('request', request => { if (request.method() === 'POST' && /\/novels\/[^/]+\/jobs$/.test(request.url())) submissions.push(request.postDataJSON()) })
  let dialog = await openReferences(page)
  await dialog.getByLabel('搜索本章参考').fill('不存在的档案')
  await expect(dialog.getByText('没有匹配的设定，试试人物名或别名。')).toBeVisible()
  await dialog.getByLabel('搜索本章参考').fill('陈序')
  await dialog.getByRole('checkbox', { name: /陈序/ }).check()
  await dialog.getByRole('button', { name: '前文定稿', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: /未来的秘密/ })).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: /第1章 雨夜来信/ }).check()
  await page.screenshot({ path: resolve(`../docs/screenshots/references-${testInfo.project.name}.png`) })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(accessibility.violations.map(value => ({ id: value.id, nodes: value.nodes.map(node => node.target) }))).toEqual([])
  await dialog.getByRole('button', { name: '补充资料', exact: true }).click()
  await dialog.getByLabel('本章补充资料', { exact: true }).fill('研究备忘：涨潮前通过旧码头，仅供本章构思。')
  await dialog.getByRole('button', { name: '保存本章参考', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(submissions).toHaveLength(0)
  await page.reload()
  dialog = await openReferences(page)
  await expect(dialog.getByRole('checkbox', { name: /陈序/ })).toBeChecked()
  await dialog.getByRole('button', { name: '前文定稿', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: /第1章 雨夜来信/ })).toBeChecked()
  await dialog.getByRole('button', { name: '补充资料', exact: true }).click()
  await expect(dialog.getByLabel('本章补充资料', { exact: true })).toHaveValue(/研究备忘/)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  const panel = page.locator('.assistant-panel:visible')
  await expect(panel.getByRole('button', { name: /^本章参考/ })).toBeFocused()
  await panel.getByRole('combobox', { name: '目标字数', exact: true }).selectOption('500')
  await panel.getByRole('button', { name: '重写本章正文', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  await expect(page.locator('.candidate-count:visible')).toContainText('目标 500 字')
  expect(submissions).toHaveLength(1)
  expect(submissions[0].references_revision).toBe(1)
  const state = await page.evaluate(async ids => {
    const jobs = await (await fetch('/api/v1/jobs?novel_id=' + ids.novel)).json()
    const job = await (await fetch(`/api/v1/jobs/${jobs[0].id}?novel_id=${ids.novel}`)).json()
    const chapter = await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)).json()
    return { job, chapter }
  }, ids)
  expect(state.job.context.pinned_entity_ids).toEqual([ids.entity])
  expect(state.job.context.sources.some((source: any) => source.pinned && source.version_id === ids.firstVersion)).toBe(true)
  expect(state.job.context.reference_notes).toContain('研究备忘')
  expect(state.chapter.version.text).toBe('陈序收起行囊，准备再次出发。')
})

test('前文更新后不能默用旧参考，作者可明确改用当前定稿', async ({ page }) => {
  test.setTimeout(60000)
  const ids = await fixture(page)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  let dialog = await openReferences(page)
  await dialog.getByRole('button', { name: '前文定稿', exact: true }).click()
  await dialog.getByRole('checkbox', { name: /第1章 雨夜来信/ }).check()
  await dialog.getByRole('button', { name: '保存本章参考', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const updated = await page.evaluate(async ids => {
    const base = `/api/v1/novels/${ids.novel}/chapters/${ids.first}`
    const version = await (await fetch(base + '/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_version_id: ids.firstVersion, operation_id: crypto.randomUUID(), text: '罗盘已经遗失，陈序决定向商队问路。' }) })).json()
    const response = await fetch(base + '/canon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version_id: version.id, operation_id: crypto.randomUUID() }) })
    if (!response.ok) throw new Error('Confirm fixture failed: ' + response.status)
    return version.id
  }, ids)
  const panel = page.locator('.assistant-panel:visible')
  await panel.getByRole('button', { name: '审稿', exact: true }).click()
  await panel.getByRole('button', { name: '审阅本章', exact: true }).click()
  await expect(panel.getByText(/已修改，请重新确认本章参考或移除/)).toBeVisible()
  dialog = await openReferences(page)
  await expect(dialog.getByText('前文已修改，请重新确认', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存本章参考', exact: true })).toBeDisabled()
  await expect(dialog.getByText('请先处理失效的必读资料', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '改用当前定稿', exact: true }).click()
  await expect(dialog.getByText('前文已修改，请重新确认', { exact: true })).not.toBeVisible()
  await dialog.getByRole('button', { name: '保存本章参考', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await page.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/references`)).json()), ids)
  expect(saved.selection.chapters[0].version_id).toBe(updated)
  expect(await page.evaluate(async ids => (await (await fetch('/api/v1/jobs?novel_id=' + ids.novel)).json()).length, ids)).toBe(0)
})

test('双窗口修改参考发生冲突时保留输入，显式重新载入后再保存', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  const dialog = await openReferences(page)
  await dialog.getByRole('button', { name: '补充资料', exact: true }).click()
  const second = await page.context().newPage()
  await second.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  const other = await openReferences(second)
  await other.getByRole('button', { name: '补充资料', exact: true }).click()
  await other.getByLabel('本章补充资料', { exact: true }).fill('第二窗口尚未保存的研究。')
  await dialog.getByLabel('本章补充资料', { exact: true }).fill('第一窗口已经保存的研究。')
  await dialog.getByRole('button', { name: '保存本章参考', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await other.getByRole('button', { name: '保存本章参考', exact: true }).click()
  await expect(other.getByText(/本章参考已在其他窗口更新/)).toBeVisible()
  await expect(other.getByLabel('本章补充资料', { exact: true })).toHaveValue('第二窗口尚未保存的研究。')
  await other.getByRole('button', { name: '放弃本次修改，重新载入', exact: true }).click()
  await expect(other.getByLabel('本章补充资料', { exact: true })).toHaveValue('第一窗口已经保存的研究。')
  await other.getByLabel('本章补充资料', { exact: true }).fill('比较之后确认的新研究。')
  await other.getByRole('button', { name: '保存本章参考', exact: true }).click()
  await expect(other).not.toBeVisible()
  await second.close()
})

test('生成截断后重试，前一次片段仍可查看和下载', async ({ page }) => {
  test.setTimeout(60000)
  let calls = 0
  const partial = '第一次调用保留的片段。'.repeat(32)
  const server = createServer((request, response) => {
    request.resume()
    calls++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const event = (value: object) => response.write('data: ' + JSON.stringify(value) + '\n\n')
    event({ choices: [{ delta: { content: calls === 1 ? partial : '第二次完整候选，作者仍需审阅。' }, finish_reason: null }] })
    event({ choices: [{ delta: {}, finish_reason: calls === 1 ? 'length' : 'stop' }] })
    event({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 80 } })
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test model did not bind')
  try {
    const ids = await fixture(page)
    const provider = await page.evaluate(async baseUrl => {
      const response = await fetch('/api/v1/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '仅本机截断测试服务', base_url: baseUrl, model: 'local-protocol-test', api_key: 'test-only-placeholder', input_price: 0, output_price: 0, price_date: '2026-10-24' }) })
      if (!response.ok) throw new Error('Provider fixture failed: ' + response.status)
      return (await response.json()).id
    }, `http://127.0.0.1:${address.port}/v1`)
    await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
    // This fixture creates a provider through the API after the app has mounted.
    // Reload so the normal bootstrap fetch includes it, as a fresh visit would.
    await page.reload()
    const panel = await openAssistant(page)
    await panel.getByRole('combobox', { name: '写作模型', exact: true }).selectOption(provider)
    await panel.getByRole('button', { name: '续写', exact: true }).click()
    await expect(panel.getByRole('combobox', { name: '写作模型', exact: true })).toHaveValue(provider)
    await panel.getByRole('button', { name: '找灵感', exact: true }).click()
    await expect(panel.getByRole('combobox', { name: '写作模型', exact: true })).toHaveValue('demo')
    await panel.getByRole('combobox', { name: '写作模型', exact: true }).selectOption(provider)
    await panel.getByRole('button', { name: '写作', exact: true }).click()
    await expect(panel.getByRole('combobox', { name: '写作模型', exact: true })).toHaveValue(provider)
    await panel.getByRole('button', { name: '找灵感', exact: true }).click()
    await expect(panel.getByRole('combobox', { name: '写作模型', exact: true })).toHaveValue(provider)
    await panel.getByRole('button', { name: '写作', exact: true }).click()
    expect(calls).toBe(0)
    await panel.getByRole('button', { name: '继续写作', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认并重试', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '确认并重试', exact: true }).click()
    await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
    await page.getByText('引用资料与调用记录', { exact: true }).click()
    await page.getByText('调用记录与历史内容（2）', { exact: true }).click()
    await page.getByText('查看第 1 次保留内容', { exact: true }).click()
    await expect(page.locator('.attempt-content:visible pre').first()).toHaveText(partial)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载第 1 次内容', exact: true }).click()
    const path = await (await download).path()
    expect(path && await readFile(path, 'utf-8')).toContain(partial)
    expect(calls).toBe(2)
    await page.goto(`/#/jobs/${ids.novel}`)
    await page.locator('.job-row').filter({ hasText: '正文生成' }).click()
    const record = page.getByRole('dialog', { name: '任务记录', exact: true })
    await record.getByText('调用记录与历史内容（2）', { exact: true }).click()
    await record.getByText('查看第 1 次保留内容', { exact: true }).click()
    await expect(record.locator('.attempt-content pre').first()).toHaveText(partial)
    expect(calls).toBe(2)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
