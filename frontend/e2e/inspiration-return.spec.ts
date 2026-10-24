import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { JobInput } from '../src/lib/api'

async function openAssistant(page: Page) {
  await expect(page.locator('.editor-panel')).toBeVisible()
  const button = page.getByRole('button', { name: '打开写作助手', exact: true })
  if (await button.isVisible()) await button.click()
  return page.locator('.assistant-panel:visible')
}

test('续写不满意可重新选择原方向，刷新后仍保留来源', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto('/')
  await page.request.get('/api/v1/health')
  const ids = await page.evaluate(async () => {
    async function post(path: string, body: object) {
      const response = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('fixture creation failed: ' + response.status)
      return response.json()
    }
    const novel = await post('/novels', { title: '方向重选-' + Date.now() })
    const chapter = await post(`/novels/${novel.id}/chapters`, { title: '账本的秘密' })
    return { novel: novel.id, chapter: chapter.id }
  })
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  const original = '陈序打开账本，发现一封未署名的信。'
  await page.getByRole('textbox', { name: '小说正文' }).fill(original)
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  const submissions: JobInput[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && /\/novels\/[^/]+\/jobs$/.test(request.url())) submissions.push(request.postDataJSON())
  })
  let panel = await openAssistant(page)
  await panel.getByRole('button', { name: '找灵感', exact: true }).click()
  await panel.getByRole('button', { name: '找三个走向', exact: true }).click()
  await expect(page.locator('.inspiration-card:visible')).toHaveCount(3)
  await page.locator('.inspiration-card:visible').first().getByRole('button', { name: '用这个方向续写' }).click()
  await panel.getByRole('button', { name: '按此方向续写', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  expect(submissions).toHaveLength(2)
  await page.reload()
  panel = await openAssistant(page)
  await page.getByRole('button', { name: '重新选择剧情方向', exact: true }).click()
  await expect(page.locator('.inspiration-card:visible')).toHaveCount(3)
  expect(submissions).toHaveLength(2)
  await page.locator('.inspiration-card:visible').nth(1).getByRole('button', { name: '用这个方向续写' }).click()
  await panel.getByRole('button', { name: '按此方向续写', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳正文', exact: true })).toBeVisible()
  expect(submissions).toHaveLength(3)
  expect(submissions[2].inspiration?.job_id).toBe(submissions[1].inspiration?.job_id)
  expect(submissions[2].inspiration?.option_index).toBe(1)
  const text = await page.evaluate(async ({ novel, chapter }) => {
    const response = await fetch(`/api/v1/novels/${novel}/chapters/${chapter}`)
    return (await response.json()).version.text
  }, ids)
  expect(text).toBe(original)
})
