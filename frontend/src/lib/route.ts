export type Page = 'library' | 'write' | 'bible' | 'plot' | 'jobs' | 'settings' | 'backup'
export type Route = { page: Page; novelId?: string; chapterId?: string }
const pages = new Set<Page>(['library', 'write', 'bible', 'plot', 'jobs', 'settings', 'backup'])
export function readRoute(): Route {
  const [raw, novelId, chapterId] = location.hash.replace(/^#\/?/, '').split('/')
  const page = pages.has(raw as Page) ? raw as Page : 'library'
  return { page, novelId: novelId || undefined, chapterId: chapterId || undefined }
}
export const routeHash = (route: Route) => '#/' + [route.page, route.novelId, route.chapterId].filter(Boolean).join('/')
export type Navigate = (route: Route) => Promise<void>
