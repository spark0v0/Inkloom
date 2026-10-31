import { afterEach, expect, it, vi } from 'vitest'
import { api, bindWorkspace } from './api'

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
