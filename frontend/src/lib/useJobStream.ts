import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { activeStates } from './api'
import type { JobDetail } from './api'

export function useJobStream(job: JobDetail | undefined) {
  const cache = useQueryClient()
  const [connection, setConnection] = useState('')
  const active = job && activeStates.has(job.state)
  useEffect(() => {
    if (!job?.id || !active) { setConnection(''); return }
    const stream = new EventSource(`/api/v1/jobs/${job.id}/events?novel_id=${job.novel_id}`)
    let lastRefresh = 0
    stream.onopen = () => setConnection('已连接')
    stream.onerror = () => setConnection('正在重连，任务继续保存在工作区')
    stream.onmessage = () => {
      if (Date.now() - lastRefresh > 160) {
        lastRefresh = Date.now(); void cache.invalidateQueries({ queryKey: ['job', job.id] })
      }
    }
    stream.addEventListener('complete', () => { stream.close(); setConnection(''); void cache.invalidateQueries({ queryKey: ['job', job.id] }); void cache.invalidateQueries({ queryKey: ['jobs'] }) })
    return () => stream.close()
  }, [job?.id, job?.novel_id, active, cache])
  return connection
}
