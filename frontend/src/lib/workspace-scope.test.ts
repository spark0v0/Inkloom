import { afterEach, expect, it, vi } from 'vitest'
import { api, bindWorkspace, downloadFile } from './api'

afterEach(() => { bindWorkspace(''); vi.unstubAllGlobals() })

it('讨论发送与采纳拒绝原页面工作区切换后的迟到调用', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  bindWorkspace('replacement')
  const body = { chapter_id: 'chapter', base_version_id: 'version', task: 'discuss' as const,
    instruction: '讨论动机', provider_id: 'demo', target_chars: 500, chapter_batch: 5,
    discussion: { conversation_id: 'conversation', chapter_ids: ['chapter'] } }
  await expect(api.context('novel', body, 'original')).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' })
  await expect(api.createJob('novel', { ...body, max_attempts: 1, idempotency_key: 'stable-operation' }, 'original')).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' })
  await expect(api.applyDiscussion('novel', 'job', { base_revision: 0, operation_id: 'stable-operation', fields: ['text'] }, 'original')).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' })
  expect(fetch).not.toHaveBeenCalled()
})

it('下载正文期间切换工作区时拒绝交付迟到文件', async () => {
  bindWorkspace('original')
  const response = new Response('测试工作稿')
  vi.spyOn(response, 'blob').mockImplementation(async () => {
    bindWorkspace('replacement')
    return new Blob(['测试工作稿'])
  })
  vi.stubGlobal('fetch', vi.fn(async () => response))
  await expect(downloadFile('/novels/novel/export', '测试.txt')).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' })
})
