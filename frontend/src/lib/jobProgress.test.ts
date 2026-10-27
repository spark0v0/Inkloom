import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import type { JobDetail, JobProgress } from './api'
import { mergeProgress, watchJob } from './jobProgress'

class FakeStream {
  static latest: FakeStream
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: (() => void) | null = null
  listeners = new Map<string, () => void>()
  closed = false
  constructor() { FakeStream.latest = this }
  addEventListener(name: string, fn: () => void) { this.listeners.set(name, fn) }
  close() { this.closed = true }
}

function detail(overrides: Partial<JobDetail> = {}): JobDetail {
  return { id: 'job-one', novel_id: 'novel-one', state: 'running', output_text: '已有片段', attempt_count: 1,
    updated_at: '2026-10-27T08:00:00.000001+00:00', context: { model: 'frozen-model' }, attempts: [],
    ...overrides } as JobDetail
}
function progress(overrides: Partial<JobProgress> = {}): JobProgress {
  return { id: 'job-one', novel_id: 'novel-one', state: 'running', output_text: '新的完整片段', attempt_count: 1,
    updated_at: '2026-10-27T08:00:01.000001+00:00', candidate_status: 'pending', cost: null,
    checkpoint: 'dispatched', error_code: null, error_message: null, ...overrides }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const key = ['job', 'job-one']
let cache: QueryClient
let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', FakeStream)
  cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  cache.setQueryData(key, detail())
})
afterEach(() => { stop?.(); stop = undefined; cache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('活跃任务只读同步', () => {
  it('快照替换片段并保留冻结资料，拒绝跨书、迟到、旧调用和终止状态覆盖', () => {
    const current = detail()
    const merged = mergeProgress(current, progress())!
    expect(merged.output_text).toBe('新的完整片段')
    expect(merged.context).toBe(current.context)
    expect(merged.attempts).toBe(current.attempts)
    expect(mergeProgress(merged, progress())).toEqual(merged)
    for (const invalid of [progress({ novel_id: 'another' }), progress({ attempt_count: 0 }),
      progress({ updated_at: '2020' }), progress({ state: 'succeeded' })]) expect(mergeProgress(current, invalid)).toBe(current)
    const cancelled = detail({ state: 'cancelled' })
    expect(mergeProgress(cancelled, progress())).toBe(cancelled)
  })

  it('合并高频事件，读取串行执行，重放通知不重复追加片段', async () => {
    const pending = deferred<JobProgress>()
    const light = vi.spyOn(api, 'jobProgress').mockReturnValueOnce(pending.promise).mockResolvedValue(progress())
    const full = vi.spyOn(api, 'job')
    stop = watchJob(detail(), cache, () => undefined)
    for (let i = 0; i < 100; i++) FakeStream.latest.onmessage?.()
    await vi.advanceTimersByTimeAsync(500)
    expect(light).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 100; i++) FakeStream.latest.onmessage?.()
    await vi.advanceTimersByTimeAsync(1000)
    expect(light).toHaveBeenCalledTimes(1)
    pending.resolve(progress())
    await vi.advanceTimersByTimeAsync(500)
    expect(light).toHaveBeenCalledTimes(2)
    expect(cache.getQueryData<JobDetail>(key)?.output_text).toBe('新的完整片段')
    expect(full).not.toHaveBeenCalled()
  })

  it('complete 到达时等待在途进度，再读取完整结果和调用历史', async () => {
    const pending = deferred<JobProgress>()
    vi.spyOn(api, 'jobProgress').mockReturnValue(pending.promise)
    const result = detail({ state: 'succeeded', updated_at: '2026-10-27T08:00:02+00:00', output_text: '最终正文', candidate_status: 'ready' })
    const full = vi.spyOn(api, 'job').mockResolvedValue(result)
    stop = watchJob(detail(), cache, () => undefined)
    FakeStream.latest.onmessage?.()
    await vi.advanceTimersByTimeAsync(500)
    FakeStream.latest.listeners.get('complete')?.()
    expect(full).not.toHaveBeenCalled()
    pending.resolve(progress())
    await vi.advanceTimersByTimeAsync(500)
    expect(full).toHaveBeenCalledTimes(1)
    expect(cache.getQueryData(key)).toEqual(result)
    expect(FakeStream.latest.closed).toBe(true)
  })

  it('断线仍读取持久化进度，最终详情失败保留片段，定时重读后才显示可采纳结果', async () => {
    const light = vi.spyOn(api, 'jobProgress').mockResolvedValueOnce(progress()).mockResolvedValue(progress({ state: 'succeeded' }))
    const result = detail({ state: 'succeeded', updated_at: '2026-10-27T08:00:02+00:00', candidate_status: 'ready' })
    const full = vi.spyOn(api, 'job').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result)
    const notify = vi.fn()
    stop = watchJob(detail(), cache, notify)
    FakeStream.latest.onerror?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(cache.getQueryData<JobDetail>(key)?.output_text).toBe('新的完整片段')
    await vi.advanceTimersByTimeAsync(5001)
    expect(light).toHaveBeenCalledTimes(2)
    expect(cache.getQueryData<JobDetail>(key)?.state).toBe('running')
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('重试读取'))
    await vi.advanceTimersByTimeAsync(5001)
    expect(full).toHaveBeenCalledTimes(2)
    expect(cache.getQueryData<JobDetail>(key)?.candidate_status).toBe('ready')
  })

  it('迟到的旧完成详情不能盖掉已重试的新任务，也不能停止后续读取', async () => {
    vi.spyOn(api, 'jobProgress').mockResolvedValue(progress({ attempt_count: 2, updated_at: '2026-10-27T08:00:04+00:00' }))
    vi.spyOn(api, 'job').mockResolvedValue(detail({ state: 'failed', updated_at: '2026-10-27T08:00:02+00:00' }))
    stop = watchJob(detail(), cache, () => undefined)
    cache.setQueryData(key, detail({ state: 'running', attempt_count: 2, updated_at: '2026-10-27T08:00:03+00:00' }))
    FakeStream.latest.listeners.get('complete')?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(cache.getQueryData<JobDetail>(key)?.attempt_count).toBe(2)
    await vi.advanceTimersByTimeAsync(5001)
    expect(api.jobProgress).toHaveBeenCalledTimes(1)
    expect(cache.getQueryData<JobDetail>(key)?.updated_at).toContain('08:00:04')
  })

  it('一次读取失败恢复后清除旧同步错误提示', async () => {
    vi.spyOn(api, 'jobProgress').mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(progress())
    const notify = vi.fn()
    stop = watchJob(detail(), cache, notify)
    FakeStream.latest.onopen?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('重试读取'))
    FakeStream.latest.onmessage?.()
    await vi.advanceTimersByTimeAsync(500)
    expect(notify).toHaveBeenLastCalledWith('已连接')
  })

  it('离开页面中止读取、清理定时器，迟到响应不写缓存或触发生成', async () => {
    const pending = deferred<JobProgress>()
    let signal: AbortSignal | undefined
    const light = vi.spyOn(api, 'jobProgress').mockImplementation((_id, _novel, value) => { signal = value; return pending.promise })
    const create = vi.spyOn(api, 'createJob')
    stop = watchJob(detail(), cache, () => undefined)
    FakeStream.latest.onmessage?.()
    await vi.advanceTimersByTimeAsync(500)
    stop()
    expect(signal?.aborted).toBe(true)
    pending.resolve(progress())
    await vi.advanceTimersByTimeAsync(15000)
    FakeStream.latest.onmessage?.()
    await vi.advanceTimersByTimeAsync(500)
    expect(cache.getQueryData<JobDetail>(key)?.output_text).toBe('已有片段')
    expect(light).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
  })
})
