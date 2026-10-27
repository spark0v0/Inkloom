import { test, expect } from '@playwright/test'

for (const disconnected of [false, true]) {
  test(`活跃任务轻量同步${disconnected ? '：SSE 断线仍能读取最终候选' : '：生成期间不反复拉取完整详情'}`, async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
    const ids = await page.evaluate(async () => {
      const post = async (path: string, body: object) => {
        const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (!response.ok) throw new Error('Fixture failed: ' + response.status)
        return response.json()
      }
      const novel = await post('/novels', { title: '轻量进度验收' })
      const chapter = await post(`/novels/${novel.id}/chapters`, { title: '第一章' })
      return { novel: novel.id, chapter: chapter.id }
    })
    if (disconnected) await page.route('**/api/v1/jobs/*/events?*', route => route.abort())
    const full: string[] = []
    const light: string[] = []
    const created: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (request.method() === 'GET' && /^\/api\/v1\/jobs\/[^/]+$/.test(path)) full.push(path)
      if (request.method() === 'GET' && path.endsWith('/progress')) light.push(path)
      if (request.method() === 'POST' && path === `/api/v1/novels/${ids.novel}/jobs`) created.push(path)
    })
    await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
    await expect(page.locator('.editor-panel')).toBeVisible()
    const open = page.getByRole('button', { name: '打开写作助手', exact: true })
    if (await open.isVisible()) await open.click()
    await page.locator('.assistant-form').getByRole('button', { name: '生成本章正文', exact: true }).click()
    await expect(page.getByRole('button', { name: '对比原稿', exact: true })).toBeVisible({ timeout: 12000 })
    expect(light.length).toBeGreaterThan(0)
    expect(full.length).toBeLessThanOrEqual(2) // Initial detail, then authoritative completion.
    expect(created).toHaveLength(1)
    expect(await page.locator('.manuscript-content').innerText()).not.toContain('门外的脚步声停了')
    await page.getByRole('button', { name: '对比原稿', exact: true }).click()
    await page.getByRole('button', { name: '采纳正文', exact: true }).click()
    await expect.poll(async () => page.evaluate(async ids => {
      const response = await fetch(`/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`)
      return (await response.json()).version.text as string
    }, ids)).toContain('门外的脚步声停了')
    expect(created).toHaveLength(1)
  })
}
