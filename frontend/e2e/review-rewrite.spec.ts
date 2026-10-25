import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

type LocalModel = { url: string; calls: () => number }
const replacement = '他收起损坏的罗盘，走向商队问路。'
const original = '序言🙂：罗盘已经损坏。\n\n他取出罗盘，指针重新转动起来。\n\n众人继续赶路。'
const target = '他取出罗盘，指针重新转动起来。'
const test = base.extend<{ model: LocalModel }>({
  model: async ({}, use) => {
    let calls = 0
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        calls++
        const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const input = JSON.parse(requestBody.messages.at(-1).content)
        const sources = input.draft_sources
        const review = { kind: 'review', summary: '本机协议测试建议，仍需作者核实。', findings: [
          { type: 'fact_conflict', severity: 'important', target: { source_id: sources?.[1]?.source_id, quote: target },
            source_evidence: [{ source_id: sources?.[0]?.source_id, quote: '罗盘已经损坏' }],
            explanation: '罗盘已经损坏，本段缺少修复经过。', suggestion: '改为向商队问路，保留罗盘损坏的事实。' },
          { type: 'pacing', severity: 'suggestion', target: { source_id: sources?.[2]?.source_id, quote: '众人继续赶路。' },
            source_evidence: [], explanation: '赶路过程缺少具体变化。', suggestion: '让人物在赶路时交换一条可核实的线索。' },
        ] }
        const text = input.task === 'review' ? JSON.stringify(review) : replacement
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        for (const value of [{ choices: [{ delta: { content: text }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 120, completion_tokens: 90 } }]) {
          response.write('data: ' + JSON.stringify(value) + '\n\n')
        }
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local model did not bind')
    try { await use({ url: `http://127.0.0.1:${address.port}/v1`, calls: () => calls }) }
    finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  },
})

async function fixture(page: Page, url: string) {
  await page.goto('/')
  const ids = await page.evaluate(async ({ url, original }) => {
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Fixture request failed: ' + response.status)
      return response.json()
    }
    const novel = await post('/novels', { title: '审稿修稿验收-' + Date.now() })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '第1章 雨夜归港' })
    const version = await post(`/novels/${novel.id}/chapters/${chapter.id}/versions`, { base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text: original })
    const provider = await post('/providers', { name: '本机审稿验收', base_url: url, model: 'local-review-fixture', api_key: 'fixture-not-a-secret', input_price: 0, output_price: 0, price_date: '2026-10-25' })
    return { novel: novel.id, chapter: chapter.id, version: version.id, provider: provider.id }
  }, { url, original })
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await page.reload()
  return ids
}

async function assistant(page: Page) {
  await expect(page.locator('.editor-panel')).toBeVisible()
  const open = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await open.isVisible()) await open.click()
  return page.locator('.assistant-panel:visible')
}

async function review(page: Page, provider: string) {
  const panel = await assistant(page)
  await panel.getByRole('button', { name: '审稿', exact: true }).click()
  await panel.getByRole('combobox', { name: '写作模型', exact: true }).selectOption(provider)
  await panel.getByRole('textbox', { name: '本次写作要求' }).fill('最早审稿记录：核对罗盘状态')
  await panel.getByRole('button', { name: '审阅本章', exact: true }).click()
  const card = page.getByRole('article', { name: '审稿意见 1', exact: true })
  await expect(card).toBeVisible()
  return card
}

async function savedChapter(page: Page, ids: { novel: string; chapter: string }) {
  return page.evaluate(async ids => (await (await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)).json()), ids)
}

test('审稿后准备段落改写不调用模型，明确生成、往返原建议并局部采纳', async ({ page, model }, testInfo) => {
  test.setTimeout(60000)
  const ids = await fixture(page, model.url)
  let card = await review(page, ids.provider)
  await card.getByText('作者判断与说明', { exact: true }).click()
  await card.getByLabel('作者说明（可选）').fill('保持雨夜氛围。')
  await card.getByText('作者判断与说明', { exact: true }).click()
  await card.getByRole('button', { name: '准备改写这一段', exact: true }).click()
  const panel = page.locator('.assistant-panel:visible')
  await expect(panel.getByRole('region', { name: '准备改写的段落' }).getByRole('blockquote')).toHaveText(target)
  expect(model.calls()).toBe(1)
  expect((await savedChapter(page, ids)).version.text).toBe(original)
  await panel.getByRole('combobox', { name: '写作模型', exact: true }).selectOption(ids.provider)
  await panel.getByRole('button', { name: '按建议改写', exact: true }).focus()
  await page.screenshot({ path: resolve(`../docs/screenshots/review-rewrite-${testInfo.project.name}.png`) })
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(accessibility.violations.map(value => ({ id: value.id, nodes: value.nodes.map(node => node.target) }))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await panel.getByRole('button', { name: '按建议改写', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  expect(model.calls()).toBe(2)
  expect((await savedChapter(page, ids)).version.text).toBe(original)
  await page.reload()
  await assistant(page)
  await page.getByRole('button', { name: '返回审稿意见', exact: true }).click()
  card = page.getByRole('article', { name: '审稿意见 1', exact: true })
  await expect(card).toBeVisible()
  await card.getByText('作者判断与说明', { exact: true }).click()
  await expect(card.getByLabel('作者说明（可选）')).toHaveValue('保持雨夜氛围。')
  await page.getByRole('button', { name: '返回修稿候选', exact: true }).click()
  await page.getByRole('button', { name: '采纳正文', exact: true }).click()
  await expect.poll(async () => (await savedChapter(page, ids)).version.text).toBe(original.replace(target, replacement))
  expect(model.calls()).toBe(2)
})

test('准备修稿后另一窗口更新正文，旧建议不会覆盖新稿或再次调用模型', async ({ page, model }) => {
  const ids = await fixture(page, model.url)
  const card = await review(page, ids.provider)
  await card.getByRole('button', { name: '准备改写这一段', exact: true }).click()
  const panel = page.locator('.assistant-panel:visible')
  await expect(panel.getByText('已准备段落改写', { exact: true })).toBeVisible()
  await page.evaluate(async ids => {
    const response = await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_version_id: ids.version, operation_id: crypto.randomUUID(), text: '另一窗口已经完成的新稿，不能覆盖。' }) })
    if (!response.ok) throw new Error('Concurrent version fixture failed')
  }, ids)
  await panel.getByRole('button', { name: '按建议改写', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /正文已更新/ }).first()).toBeVisible()
  expect(model.calls()).toBe(1)
  expect((await savedChapter(page, ids)).version.text).toBe('另一窗口已经完成的新稿，不能覆盖。')
})

test('作者判断冲突保留说明，误报不能准备修稿', async ({ page, model }) => {
  const ids = await fixture(page, model.url)
  const first = await review(page, ids.provider)
  const other = await page.context().newPage()
  await other.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await assistant(other)
  const second = other.getByRole('article', { name: '审稿意见 1', exact: true })
  await expect(second).toBeVisible()
  await first.getByText('作者判断与说明', { exact: true }).click()
  await second.getByText('作者判断与说明', { exact: true }).click()
  await second.getByLabel('作者说明（可选）').fill('第二窗口尚未保存的说明。')
  await first.getByRole('button', { name: '误报', exact: true }).click()
  await expect(first.getByRole('button', { name: '准备改写这一段', exact: true })).toBeDisabled()
  await second.getByRole('button', { name: '准备改写这一段', exact: true }).click()
  await expect(second.getByText(/作者判断已在其他窗口更新/)).toBeVisible()
  await expect(second.getByLabel('作者说明（可选）')).toHaveValue('第二窗口尚未保存的说明。')
  await second.getByRole('button', { name: '读取最新判断', exact: true }).click()
  await expect(second.getByRole('button', { name: '准备改写这一段', exact: true })).toBeDisabled()
  expect(model.calls()).toBe(1)
  await other.close()
})

test('完整生成历史可加载150条之前的记录，分页失败保留列表并可搜索筛选', async ({ page, model }, testInfo) => {
  test.setTimeout(120000)
  const ids = await fixture(page, model.url)
  await review(page, ids.provider)
  await page.evaluate(async ids => {
    async function request(path: string, body?: object) {
      const response = await fetch('/api/v1' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      if (!response.ok) throw new Error('History fixture failed: ' + response.status)
      return response.json()
    }
    for (let i = 0; i < 162; i++) {
      const job = await request(`/novels/${ids.novel}/jobs`, { chapter_id: ids.chapter, base_version_id: ids.version, task: 'plan', provider_id: 'demo', instruction: '分页占位 ' + i, idempotency_key: crypto.randomUUID() })
      let stopped = await request(`/jobs/${job.id}/cancel?novel_id=${ids.novel}`, {})
      for (let poll = 0; ['queued', 'running', 'pausing', 'cancelling'].includes(stopped.state); poll++) {
        if (poll >= 100) throw new Error('Fixture cancellation did not finish')
        await new Promise(resolve => setTimeout(resolve, 20))
        stopped = await request(`/jobs/${job.id}?novel_id=${ids.novel}`)
      }
    }
  }, ids)
  let failPage = true
  await page.route('**/api/v1/jobs/page**', async route => {
    if (failPage && new URL(route.request().url()).searchParams.has('cursor')) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_HISTORY_FAILURE', message: '人为模拟分页读取失败。' }) })
    } else await route.continue()
  })
  await page.goto(`/#/jobs/${ids.novel}`)
  await expect(page.locator('.job-row')).toHaveCount(30)
  await page.getByRole('button', { name: '加载更早记录', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '人为模拟分页读取失败。' })).toBeVisible()
  await expect(page.locator('.job-row')).toHaveCount(30)
  failPage = false
  await page.getByRole('button', { name: '重试读取', exact: true }).click()
  await expect(page.locator('.job-row')).toHaveCount(60)
  for (const count of [90, 120, 150, 163]) {
    await page.getByRole('button', { name: '加载更早记录', exact: true }).click()
    await expect(page.locator('.job-row')).toHaveCount(count)
  }
  await expect(page.getByRole('button', { name: '加载更早记录', exact: true })).toHaveCount(0)
  await page.locator('.page-scroll').evaluate(element => element.scrollTo(0, 0))
  await page.screenshot({ path: resolve(`../docs/screenshots/job-history-${testInfo.project.name}.png`) })
  await page.locator('.job-row').filter({ hasText: '最早审稿记录' }).click()
  const record = page.getByRole('dialog', { name: '任务记录', exact: true })
  await expect(record.getByText('本机协议测试建议，仍需作者核实。', { exact: true })).toBeVisible()
  await record.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('combobox', { name: '筛选生成类型' }).selectOption('review')
  await page.getByRole('combobox', { name: '筛选任务状态' }).selectOption('succeeded')
  await expect(page.locator('.job-row')).toHaveCount(1)
  await page.getByRole('searchbox', { name: '搜索生成记录' }).fill('不存在的要求')
  await expect(page.getByText('没有符合条件的记录', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  // Returning to the original filter restores its already loaded pages.
  await expect(page.locator('.job-row')).toHaveCount(163)
  expect(model.calls()).toBe(1)
})
