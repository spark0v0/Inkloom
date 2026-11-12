export type Page = 'library' | 'write' | 'bible' | 'plot' | 'jobs' | 'settings' | 'backup'
export type Route = { page: Page; novelId?: string; chapterId?: string; view?: 'map' | 'discuss'; threadId?: string; discussionId?: string }
const pages = new Set<Page>(['library', 'write', 'bible', 'plot', 'jobs', 'settings', 'backup'])
export function readRoute(): Route {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?')
  const [raw, novelId, chapterId] = path.split('/')
  const page = pages.has(raw as Page) ? raw as Page : 'library'
  const params = new URLSearchParams(query)
  return { page, novelId: novelId || undefined, chapterId: chapterId || undefined,
    ...(page === 'plot' && ['map', 'discuss'].includes(params.get('view') || '') ? { view: params.get('view') as 'map' | 'discuss' } : {}),
    ...(page === 'plot' && params.get('view') === 'discuss' && params.get('discussion') ? { discussionId: params.get('discussion')! } : {}),
    ...(page === 'bible' && params.get('thread') ? { threadId: params.get('thread')! } : {}) }
}
export const routeHash = (route: Route) => {
  const query = new URLSearchParams()
  if (route.page === 'plot' && route.view) query.set('view', route.view)
  if (route.page === 'plot' && route.view === 'discuss' && route.discussionId) query.set('discussion', route.discussionId)
  if (route.page === 'bible' && route.threadId) query.set('thread', route.threadId)
  return '#/' + [route.page, route.novelId, route.chapterId].filter(Boolean).join('/') + (query.size ? '?' + query : '')
}
export type Navigate = (route: Route) => Promise<void>
