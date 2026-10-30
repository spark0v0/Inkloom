export type Page = 'library' | 'write' | 'bible' | 'plot' | 'jobs' | 'settings' | 'backup'
export type Route = { page: Page; novelId?: string; chapterId?: string; view?: 'map'; threadId?: string }
const pages = new Set<Page>(['library', 'write', 'bible', 'plot', 'jobs', 'settings', 'backup'])
export function readRoute(): Route {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?')
  const [raw, novelId, chapterId] = path.split('/')
  const page = pages.has(raw as Page) ? raw as Page : 'library'
  const params = new URLSearchParams(query)
  return { page, novelId: novelId || undefined, chapterId: chapterId || undefined,
    ...(page === 'plot' && params.get('view') === 'map' ? { view: 'map' as const } : {}),
    ...(page === 'bible' && params.get('thread') ? { threadId: params.get('thread')! } : {}) }
}
export const routeHash = (route: Route) => {
  const query = new URLSearchParams()
  if (route.page === 'plot' && route.view === 'map') query.set('view', 'map')
  if (route.page === 'bible' && route.threadId) query.set('thread', route.threadId)
  return '#/' + [route.page, route.novelId, route.chapterId].filter(Boolean).join('/') + (query.size ? '?' + query : '')
}
export type Navigate = (route: Route) => Promise<void>
