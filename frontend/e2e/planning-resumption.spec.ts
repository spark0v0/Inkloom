import { expect, test } from '@playwright/test'

test('恢复第二卷细纲时保持原分卷，第一卷不显示其他卷的候选', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  const ids = await page.evaluate(async () => {
    const health = await (await fetch('/api/v1/health')).json()
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Refusing author workspace')
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Planning fixture: ${response.status}`)
      return response.json()
    }
    const novel = await post('/novels', { title: '分卷恢复验收' })
    const path = `/novels/${novel.id}`
    await post(path + '/plans', { title: '全书方案', level: 'book', body: '林舟追查来信与旧灯塔。' })
    await post(path + '/plans', { title: '第一卷 雾港', level: 'volume', body: '收到来信。' })
    const second = await post(path + '/plans', { title: '第二卷 远航', level: 'volume', body: '林舟带着线索离港。' })
    const chapter = await post(path + '/chapters', { title: '第1章', volume: '第一卷 雾港' })
    const job = await post(path + '/jobs', { chapter_id: chapter.id, base_version_id: chapter.working_version_id,
      task: 'outline', volume_plan_id: second.id, provider_id: 'demo', chapter_batch: 3, idempotency_key: crypto.randomUUID() })
    return { novel: novel.id as string, job: job.id as string }
  })
  await expect.poll(() => page.evaluate(async ids => (await (await fetch(`/api/v1/jobs/${ids.job}?novel_id=${ids.novel}`)).json()).state, ids)).toBe('succeeded')
  await page.goto(`/#/plot/${ids.novel}`)
  await page.getByRole('button', { name: '查看进度', exact: true }).click()
  const panel = page.getByRole('region', { name: 'AI 章节细纲', exact: true })
  await expect(panel.locator('.production-title p')).toHaveText('第二卷 远航')
  await expect(panel.getByRole('button', { name: '采纳这 3 章', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '返回大纲', exact: true }).click()
  await page.getByRole('button', { name: '第一卷 雾港', exact: false }).first().click()
  await page.getByRole('button', { name: 'AI 规划后续章节', exact: true }).click()
  await expect(panel.locator('.production-title p')).toHaveText('第一卷 雾港')
  await expect(panel.getByRole('button', { name: '采纳这 3 章', exact: true })).not.toBeVisible()
})
