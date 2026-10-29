import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const origin = 'http://127.0.0.1:9876'
type Copy = { key: string; text?: string; document?: Record<string, unknown>; baseDocument?: Record<string, unknown>; updatedAt: string }
async function copies(page: Page): Promise<Copy[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('story-workshop-recovery', 1)
    open.onsuccess = () => {
      const db = open.result
      const request = db.transaction('drafts').objectStore('drafts').getAll()
      request.onsuccess = () => { db.close(); resolve(request.result) }
      request.onerror = () => { db.close(); reject(request.error) }
    }
    open.onerror = () => reject(open.error)
  }))
}
async function store(page: Page, value: object) {
  await page.evaluate(value => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('story-workshop-recovery', 1)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').put(value)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
    open.onerror = () => reject(open.error)
  }), value)
}
async function fixture(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  return page.evaluate(async () => {
    const novel = await (await fetch('/api/v1/novels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '恢复边界验收', style: '旧文风' }) })).json()
    const chapter = await (await fetch(`/api/v1/novels/${novel.id}/chapters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '原章节标题' }) })).json()
    return { novel: novel.id as string, chapter: chapter.id as string }
  })
}
const path = (ids: { novel: string; chapter: string }) => `/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`

test('正文窗口各保留恢复副本，其他窗口保存不清理，重开可选择恢复', async ({ page, context }) => {
  const ids = await fixture(page)
  const url = `/#/write/${ids.novel}/${ids.chapter}`
  await page.goto(url)
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toBeVisible()
  const other = await context.newPage()
  await other.goto(url)
  await other.route('**' + path(ids) + '/versions', route => route.abort())
  await other.getByRole('textbox', { name: '小说正文', exact: true }).fill('窗口 B 未保存的正文。')
  await expect(other.locator('.save-status')).toHaveText('保存未确认')
  await expect.poll(async () => (await copies(other)).some(value => value.text === '窗口 B 未保存的正文。')).toBe(true)
  await other.close()
  await page.getByRole('textbox', { name: '小说正文', exact: true }).fill('窗口 A 正常保存的正文。')
  await expect(page.locator('.save-status')).toHaveText('已保存')
  expect((await copies(page)).some(value => value.text === '窗口 B 未保存的正文。')).toBe(true)
  await page.route('**' + path(ids) + '/versions', route => route.abort())
  await page.getByRole('textbox', { name: '小说正文', exact: true }).fill('窗口 A 后来未保存的文字。')
  await expect(page.locator('.save-status')).toHaveText('保存未确认')
  const reopen = await context.newPage()
  await reopen.goto(url)
  await expect(reopen.getByRole('button', { name: '恢复草稿', exact: true })).toHaveCount(2)
  await reopen.locator('.notice').filter({ hasText: '窗口 B 未保存的正文。' }).getByRole('button', { name: '恢复草稿', exact: true }).click()
  await expect.poll(async () => (await (await reopen.request.get(path(ids))).json()).version.text).toBe('窗口 B 未保存的正文。')
  await expect(reopen.getByRole('button', { name: '恢复草稿', exact: true })).toHaveCount(1)
  const remaining = await copies(reopen)
  expect(remaining.map(value => value.text)).toEqual(['窗口 A 后来未保存的文字。'])
  await reopen.close()
})

test('兼容旧正文副本，恢复保存期间被另一窗口更新的副本不能清除', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await expect(page.getByRole('textbox', { name: '小说正文', exact: true })).toBeVisible()
  const health = await (await page.request.get('/api/v1/health')).json()
  const chapter = await (await page.request.get(path(ids))).json()
  const value = { key: `${health.workspace_id}:${ids.novel}:${ids.chapter}`, baseVersion: chapter.working_version_id,
    text: '旧版浏览器副本。', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧版浏览器副本。' }] }] }, updatedAt: new Date().toISOString() }
  await store(page, value)
  await page.reload()
  await expect(page.getByRole('button', { name: '恢复草稿', exact: true })).toBeVisible()
  const submitted: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(path(ids) + '/versions')) submitted.push(request.postDataJSON().text) })
  await page.route('**' + path(ids) + '/versions', async route => {
    const response = await route.fetch()
    const text = '另一窗口后来写入的恢复副本。'
    await store(page, { ...value, text, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, updatedAt: new Date().toISOString() })
    await route.fulfill({ response })
  }, { times: 1 })
  await page.getByRole('textbox', { name: '小说正文', exact: true }).fill('恢复前尚未自动保存的本页输入。')
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await expect.poll(async () => (await (await page.request.get(path(ids))).json()).version.text).toBe(value.text)
  await expect(page.locator('.notice').filter({ hasText: '另一窗口后来写入的恢复副本。' })).toBeVisible()
  expect((await copies(page)).find(item => item.key === value.key)?.text).toBe('另一窗口后来写入的恢复副本。')
  expect(submitted).toEqual(['恢复前尚未自动保存的本页输入。', value.text])
})

for (const legacy of [false, true]) test(`${legacy ? '旧版' : '新版'}细纲副本按原始基线合并，保留另一窗口的新标题`, async ({ page, context }) => {
  const ids = await fixture(page)
  const outlinePath = path(ids) + '/outline'
  const original = { kind: 'structured', title: '原章节标题', goal: '原目标。', conflict: '原冲突。', beats: ['原节点。'], ending_hook: '原钩子。' }
  const put = async (target: Page, revision: number, document: object) => {
    const result = await target.request.put(outlinePath, { headers: { Origin: origin }, data: { base_revision: revision, operation_id: crypto.randomUUID(), document } })
    expect(result.ok()).toBe(true)
  }
  await put(page, 0, original)
  await page.goto(`/#/plot/${ids.novel}/${ids.chapter}`)
  await page.getByRole('textbox', { name: '本章目标', exact: true }).fill('本地只修改目标。')
  await expect.poll(async () => (await copies(page)).filter(value => value.document?.goal === '本地只修改目标。').length).toBe(1)
  const snapshot = (await copies(page)).find(value => value.document?.goal === '本地只修改目标。')!
  expect(snapshot.baseDocument).toEqual(original)
  if (legacy) { const { baseDocument: _base, ...old } = snapshot; await store(page, old) }
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.getByRole('button', { name: '新建小说', exact: true })).toBeVisible()
  await put(other, 1, { ...original, title: '另一窗口的新标题' })
  await page.reload()
  if (legacy) {
    await page.route('**' + outlinePath + '/history/1', route => route.fulfill({ status: 503, json: { code: 'TEMPORARY', message: '模拟历史暂不可读' } }), { times: 1 })
    await page.getByRole('button', { name: '恢复本地细纲', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '副本仍保留，可先下载' })).toBeVisible()
    await expect(page.getByRole('button', { name: '下载恢复副本', exact: true })).toBeVisible()
    expect((await copies(page)).some(value => value.document?.goal === '本地只修改目标。')).toBe(true)
  }
  await page.getByRole('button', { name: '恢复本地细纲', exact: true }).click()
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await page.getByRole('button', { name: '读取最新细纲并比较', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('另一窗口的新标题')
  await expect(page.getByRole('textbox', { name: '本章目标', exact: true })).toHaveValue('本地只修改目标。')
  await page.getByRole('button', { name: '保存细纲', exact: true }).click()
  await expect.poll(async () => (await (await page.request.get(outlinePath)).json()).revision).toBe(3)
  await expect.poll(async () => (await copies(page)).filter(value => value.key.startsWith(`outline:`)).length).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '恢复本地细纲', exact: true })).toHaveCount(0)
  await other.close()
})

test('编辑作品冲突保留作者题材，比较后采用新文风且只提交改动字段', async ({ page }) => {
  const ids = await fixture(page)
  await page.goto(`/#/plot/${ids.novel}`)
  await page.getByRole('button', { name: '编辑作品', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑作品', exact: true })
  const requests: Record<string, unknown>[] = []
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith('/novels/' + ids.novel)) requests.push(request.postDataJSON()) })
  await dialog.getByRole('textbox', { name: '题材', exact: true }).fill('悬疑推理')
  await dialog.getByRole('textbox', { name: '题材', exact: true }).dispatchEvent('compositionstart')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  expect(requests).toHaveLength(0)
  await dialog.getByRole('textbox', { name: '题材', exact: true }).dispatchEvent('compositionend')
  const novel = await (await page.request.get(`/api/v1/novels/${ids.novel}`)).json()
  const changed = await page.request.put(`/api/v1/novels/${ids.novel}/writing-style`, { headers: { Origin: origin }, data: { base_settings_revision: novel.settings_revision, style: '另一窗口的新文风', preferences: { viewpoint: 'third_person_limited' } } })
  expect(changed.ok()).toBe(true)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.getByRole('button', { name: '读取最新作品信息并比较', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '题材', exact: true })).toHaveValue('悬疑推理')
  await expect(dialog.getByRole('textbox', { name: '文风偏好', exact: true })).toHaveValue('另一窗口的新文风')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await (await page.request.get(`/api/v1/novels/${ids.novel}`)).json()
  expect(saved.style).toBe('另一窗口的新文风')
  expect(saved.genre).toBe('悬疑推理')
  expect(saved.writing_preferences.viewpoint).toBe('third_person_limited')
  expect(Object.keys(requests.at(-1)!).sort()).toEqual(['base_settings_revision', 'genre'])
})
