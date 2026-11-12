import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../lib/api'
import { readRoute, routeHash } from './route'
import type { Route } from './route'
import { nextWritingChapter } from '../lib/workflow'

export function useWorkspaceNavigation(workspaceId: string, onCommit: () => void) {
  const cache = useQueryClient()
  const [route, setRoute] = useState(readRoute)
  const current = useRef(route)
  const [lastNovel, setLastNovel] = useState(route.novelId)
  const [navigationError, setNavigationError] = useState('')
  const alive = useRef(true)
  const intent = useRef(0)
  const guard = useRef<(() => Promise<unknown>) | null>(null)
  const registerGuard = useCallback((callback: typeof guard.current) => { guard.current = callback }, [])
  const flush = useCallback(() => guard.current?.() ?? Promise.resolve(), [])
  useLayoutEffect(() => {
    alive.current = true
    return () => { alive.current = false; intent.current++ }
  }, [])

  const transition = useCallback(async (requested: Route, fromHistory: boolean) => {
    if (!alive.current) return
    const revision = ++intent.current
    const startHash = location.hash
    const isLatest = () => alive.current && revision === intent.current && location.hash === startHash
    setNavigationError('')
    try {
      let next = requested
      if (requested.page === 'write' && requested.novelId && !requested.chapterId) {
        const novelId = requested.novelId
        const chapters = await cache.fetchQuery({
          queryKey: ['chapters', novelId], queryFn: () => api.chapters(novelId, workspaceId), staleTime: 0,
        })
        if (!isLatest()) return
        const chapter = nextWritingChapter(chapters)
        next = chapter ? { page: 'write', novelId, chapterId: chapter.id } : { page: 'plot', novelId }
      }
      const hash = routeHash(next)
      if (hash !== routeHash(current.current)) {
        await flush()
        if (!isLatest()) return
        current.current = next
        setRoute(next)
        if (next.novelId) setLastNovel(next.novelId)
      }
      if (hash !== location.hash) {
        if (fromHistory) history.replaceState(null, '', hash)
        else history.pushState(null, '', hash)
      }
      onCommit()
    } catch (error) {
      if (!isLatest()) return
      if (fromHistory) history.replaceState(null, '', routeHash(current.current))
      setNavigationError(errorText(error))
      throw error
    }
  }, [cache, flush, onCommit, workspaceId])

  const navigate = useCallback((next: Route) => transition(next, false), [transition])
  useEffect(() => {
    const onHashChange = () => { void transition(readRoute(), true).catch(() => undefined) }
    window.addEventListener('hashchange', onHashChange)
    const initial = current.current
    if (initial.page === 'write' && initial.novelId && !initial.chapterId) onHashChange()
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [transition])

  return { route, lastNovel, navigate, navigationError, clearNavigationError: () => setNavigationError(''), registerGuard, flush }
}
