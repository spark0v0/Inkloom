import { afterEach, expect, it, vi } from 'vitest'
import { api, bindWorkspace } from './api'

afterEach(() => { bindWorkspace(''); vi.unstubAllGlobals() })

it('任务集合按重复查询参数传递，分卷、基线和工作区保持完整', async () => {
  bindWorkspace('test-workspace')
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], next_cursor: null })))
  vi.stubGlobal('fetch', fetch)
  await api.jobHistory({ novel_id: 'novel', tasks: ['blueprint', 'outline'], volume_plan_id: 'volume',
    base_version_id: 'version', pending_only: true, limit: 1 }, 'test-workspace')
  const [path, options] = fetch.mock.calls[0]
  const query = new URL(path, 'http://localhost').searchParams
  expect(query.getAll('tasks')).toEqual(['blueprint', 'outline'])
  expect(query.get('volume_plan_id')).toBe('volume')
  expect(query.get('base_version_id')).toBe('version')
  expect(query.get('pending_only')).toBe('true')
  expect(new Headers(options.headers).get('X-Inkloom-Workspace')).toBe('test-workspace')
})
