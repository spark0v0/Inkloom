import type { QueryClient } from '@tanstack/react-query'
import { activeStates, api } from './api'
import type { JobDetail, JobProgress } from './api'

function newer(current: JobDetail, value: JobProgress) {
  return current.id === value.id && current.novel_id === value.novel_id &&
    value.attempt_count >= current.attempt_count && value.updated_at >= current.updated_at
}

export function mergeProgress(current: JobDetail | undefined, value: JobProgress) {
  if (!current || !activeStates.has(current.state) || !activeStates.has(value.state) || !newer(current, value)) return current
  return { ...current, ...value }
}

/** Events signal a persisted snapshot; replayed deltas are never blindly appended. */
export function watchJob(job: Pick<JobDetail, 'id' | 'novel_id'>, cache: QueryClient, onConnection: (value: string) => void) {
  const key = ['job', job.id]
  const controller = new AbortController()
  const stream = new EventSource(`/api/v1/jobs/${encodeURIComponent(job.id)}/events?novel_id=${encodeURIComponent(job.novel_id)}`)
  let disposed = false
  let inFlight = false
  let dirty = false
  let fullRequested = false
  let connected = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule(full = false, delay = 500) {
    if (disposed) return
    dirty = true
    fullRequested ||= full
    if (!inFlight && timer === undefined) timer = setTimeout(() => { timer = undefined; void refresh() }, delay)
  }

  async function refresh() {
    if (disposed || inFlight) return
    inFlight = true
    dirty = false
    let readingFull = fullRequested
    fullRequested = false
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])
      if (!readingFull) {
        const value = await api.jobProgress(job.id, job.novel_id, signal)
        if (disposed) return
        if (activeStates.has(value.state)) {
          cache.setQueryData<JobDetail>(key, current => mergeProgress(current, value))
          onConnection(connected ? '已连接' : '正在重连，已同步保存的进度')
        } else readingFull = true
      }
      if (readingFull) {
        const value = await api.job(job.id, job.novel_id, signal)
        if (disposed) return
        cache.setQueryData<JobDetail>(key, current => current && newer(current, value) &&
          (activeStates.has(current.state) || !activeStates.has(value.state)) ? value : current)
        const current = cache.getQueryData<JobDetail>(key)
        if (current && !activeStates.has(current.state)) {
          stop()
          onConnection('')
          void cache.invalidateQueries({ queryKey: ['jobs'] })
        }
      }
    } catch {
      if (!disposed) {
        fullRequested ||= readingFull
        onConnection('进度暂未同步，正在重试读取；任务仍保存在工作区')
      }
    } finally {
      inFlight = false
      if (dirty && !disposed) schedule()
    }
  }

  const fallback = setInterval(() => schedule(false, 0), 5000)
  function stop() {
    disposed = true
    stream.close()
    controller.abort()
    if (timer !== undefined) clearTimeout(timer)
    clearInterval(fallback)
  }
  stream.onopen = () => { if (!disposed) { connected = true; onConnection('已连接'); schedule(false, 0) } }
  stream.onerror = () => { if (!disposed) { connected = false; onConnection('正在重连，任务继续保存在工作区'); schedule(false, 0) } }
  stream.onmessage = () => schedule()
  stream.addEventListener('complete', () => { connected = false; stream.close(); schedule(true, 0) })
  return stop
}
