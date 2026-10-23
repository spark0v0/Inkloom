import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(root, 'docs/screenshots')
const base = 'http://127.0.0.1:8775'
const novelId = process.argv[2]
if (!novelId || !/^novel_[a-f0-9]+$/.test(novelId)) throw new Error('Pass the preview novel ID. This script only reads the local preview workspace.')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const measurements = []
async function capture(name) {
  await page.screenshot({ path: path.join(output, name + '.png') })
  measurements.push({ name, ...await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })) })
}
try {
  await page.goto(base)
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor()
  const chapters = await page.evaluate(async id => (await (await fetch('/api/v1/novels/' + id + '/chapters')).json()), novelId)
  if (!chapters.length) throw new Error('Preview novel has no chapters.')
  await page.goto(`${base}/#/plot/${novelId}`)
  await page.locator('.volume-workspace').waitFor()
  await capture('serial-studio-v3-desktop')
  await page.goto(`${base}/#/write/${novelId}/${chapters[0].id}`)
  await page.getByRole('textbox', { name: '小说正文' }).waitFor()
  await page.locator('.assistant-panel').waitFor()
  await capture('chapter-studio-v3-desktop')
  await page.setViewportSize({ width: 768, height: 1024 })
  await capture('chapter-studio-v3-tablet')
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('chapter-studio-v3-mobile')
  await page.getByRole('button', { name: '打开写作助手', exact: true }).click()
  await page.getByRole('dialog', { name: 'AI 写作', exact: true }).waitFor()
  await capture('assistant-v3-mobile')
  await page.getByRole('dialog', { name: 'AI 写作', exact: true }).getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.goto(`${base}/#/plot/${novelId}`)
  await page.locator('.volume-workspace').waitFor()
  await capture('serial-studio-v3-mobile')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(base)
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor()
  await capture('library-v3-desktop')
  await writeFile(path.join(output, 'v3-viewport-checks.json'), JSON.stringify({ measurements, errors }, null, 2) + '\n')
  if (errors.length || measurements.some(m => m.document > m.viewport || m.body > m.viewport)) throw new Error('Visual capture found runtime errors or viewport overflow; inspect v3-viewport-checks.json.')
  console.log(`Saved ${measurements.length} screenshots; no document overflow or page errors.`)
} finally { await browser.close() }
