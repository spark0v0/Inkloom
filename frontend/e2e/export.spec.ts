import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function manuscript(page: Page) {
  await page.goto('/')
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor()
  const ids = await page.evaluate(async () => {
    async function call(path: string, body?: unknown) {
      const response = await fetch('/api/v1' + path, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Export fixture: ${response.status}`)
      return response.json()
    }
    const health = await call('/health')
    if (!health.workspace_name.startsWith('e2e-')) throw new Error('Disposable E2E workspace required')
    const novel = await call('/novels', { title: '连载交稿验收' })
    const prefix = `/novels/${novel.id}/chapters`
    const first = await call(prefix, { title: '第一章 启程' })
    const version = await call(`${prefix}/${first.id}/versions`, { base_version_id: first.working_version_id,
      operation_id: crypto.randomUUID(), text: '船离开了港口，这是第一章的正文。' })
    await call(`${prefix}/${first.id}/canon`, { version_id: version.id, operation_id: crypto.randomUUID() })
    const second = await call(prefix, { title: '第二章 回声' })
    await call(`${prefix}/${second.id}/versions`, { base_version_id: second.working_version_id,
      operation_id: crypto.randomUUID(), text: '他在旧船舱里听见了回声，这是第二章的工作稿。' })
    await call(prefix, { title: '第三章 空白', goal: '未来细纲不会进入正文导出。' })
    return { novel: novel.id, chapter: first.id }
  })
  await page.goto(`/#/write/${ids.novel}/${ids.chapter}`)
  await page.getByRole('textbox', { name: '小说正文', exact: true }).waitFor()
  return ids
}

async function openExport(page: Page) {
  const button = page.getByRole('button', { name: '导出', exact: true })
  if (await button.isVisible()) await button.click()
  else await page.getByRole('button', { name: '连载导出', exact: true }).click()
  return page.getByRole('dialog', { name: '连载导出', exact: true })
}

test('按章范围预览、排除原因与 ZIP 导出', async ({ page }, testInfo) => {
  await manuscript(page)
  const dialog = await openExport(page)
  await expect(dialog.getByLabel('正文范围')).toHaveValue('confirmed')
  await expect(dialog.locator('.export-totals')).toContainText('1 章')
  await expect(dialog.getByText('尚未定稿', { exact: true })).toBeVisible()
  await expect(dialog.getByText('空白正文', { exact: true })).toBeVisible()
  await dialog.getByLabel('章节范围').selectOption('range')
  await dialog.getByLabel('起始章序').fill('2')
  await dialog.getByLabel('结束章序').fill('3')
  await expect(dialog.locator('.export-totals')).toContainText('0 章')
  await expect(dialog.getByRole('button', { name: '下载正文', exact: true })).toBeDisabled()
  await dialog.getByLabel('正文范围').selectOption('working')
  await expect(dialog.locator('.export-totals')).toContainText('1 章')
  await expect(dialog.getByRole('list', { name: '导出章节清单' }).getByRole('listitem')).toHaveCount(2)
  await dialog.getByLabel('起始章序').fill('4')
  await expect(dialog).toContainText('起始章不能大于结束章')
  await expect(dialog.getByRole('button', { name: '下载正文', exact: true })).toBeDisabled()
  await dialog.getByLabel('起始章序').fill('2')
  await dialog.getByLabel('格式').selectOption('zip')
  await expect(dialog.getByRole('button', { name: '下载正文', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: '下载正文', exact: true })).toBeInViewport()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: resolve(`../docs/screenshots/export-final-${testInfo.project.name}.png`) })
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载正文', exact: true }).click()
  expect((await download).suggestedFilename()).toContain('-第2-3章-工作稿.zip')
  await expect(dialog).not.toBeVisible()
})

test('导出前保存本地输入，拒绝旧预览且不自动重试下载', async ({ page }) => {
  const ids = await manuscript(page)
  const editor = page.getByRole('textbox', { name: '小说正文', exact: true })
  await editor.fill('作者还在编辑的第一章，先保存再导出。')
  const dialog = await openExport(page)
  await expect(dialog.locator('.export-totals')).toContainText('0 章')
  await expect(dialog.getByText('待重新定稿', { exact: true })).toBeVisible()
  await dialog.getByLabel('正文范围').selectOption('working')
  await expect(dialog.getByRole('button', { name: '下载正文', exact: true })).toBeEnabled()
  await page.evaluate(async ids => {
    const prefix = `/api/v1/novels/${ids.novel}/chapters/${ids.chapter}`
    const chapter = await (await fetch(prefix)).json()
    const response = await fetch(prefix + '/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_version_id: chapter.working_version_id, operation_id: crypto.randomUUID(), text: '另一个窗口修订后的第一章，以这个版本交稿。' }) })
    if (!response.ok) throw new Error('Concurrent revision failed')
  }, ids)
  let downloads = 0
  page.on('download', () => downloads++)
  const conflict = page.waitForResponse(response => response.url().includes('/export?') && response.status() === 409)
  await dialog.getByRole('button', { name: '下载正文', exact: true }).click()
  await conflict
  await expect(dialog).toContainText('稿件已变更')
  await expect(dialog.getByRole('button', { name: '下载正文', exact: true })).toBeEnabled()
  expect(downloads).toBe(0)
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载正文', exact: true }).click()
  const path = await (await download).path()
  const text = await readFile(path!, 'utf8')
  expect(text).toContain('另一个窗口修订后的第一章')
  expect(text).not.toContain('作者还在编辑的第一章')
})
