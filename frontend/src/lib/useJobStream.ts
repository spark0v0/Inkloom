import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { activeStates } from './api'
import type { JobDetail } from './api'
import { watchJob } from './jobProgress'

export function useJobStream(job: JobDetail | undefined) {
  const cache = useQueryClient()
  const [connection, setConnection] = useState('')
  const active = job && activeStates.has(job.state)
  useEffect(() => {
    if (!job?.id || !active) { setConnection(''); return }
    return watchJob(job, cache, setConnection)
  }, [job?.id, job?.novel_id, active, cache])
  return connection
}
