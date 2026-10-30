import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Archive, ArrowRight, BookOpen, CaretRight, Clock, Export, GearSix, List, MagnifyingGlass, Notebook, PenNib, TreeStructure, X } from '@phosphor-icons/react'
import { api, bindWorkspace, errorText } from './lib/api'
import type { Evidence, Health, Novel } from './lib/api'
import { readRoute, routeHash } from './lib/route'
import type { Route } from './lib/route'
import { Badge, Button, Empty, Loading, Modal, Notice } from './components/ui'
import { EvidenceModal } from './components/EvidenceModal'
import { ExportDialog } from './features/ExportDialog'
import { LibraryPage, openNovel } from './features/LibraryPage'
const EditorPage = lazy(() => import('./features/EditorPage').then(m => ({ default: m.EditorPage })))
const StoryPage = lazy(() => import('./features/StoryPage').then(m => ({ default: m.StoryPage })))
const PlanningPage = lazy(() => import('./features/PlanningPage').then(m => ({ default: m.PlanningPage })))
const JobsPage = lazy(() => import('./features/JobsPage').then(m => ({ default: m.JobsPage })))
const SettingsPage = lazy(() => import('./features/SettingsPage').then(m => ({ default: m.SettingsPage })))
const BackupPage = lazy(() => import('./features/BackupPage').then(m => ({ default: m.BackupPage })))

const pageNames = { library: '我的作品', write: '章节写作', bible: '人物与设定', plot: '大纲与章节', jobs: '生成记录', settings: '模型设置', backup: '工作区备份' }

export default function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1, refetchInterval: 15000 })
  const initialWorkspace = useRef<string | null>(null)
  if (health.data && initialWorkspace.current === null) initialWorkspace.current = health.data.workspace_id
  if (!health.data) return health.error ? <div className="connection-error"><Empty icon={<BookOpen size={38} />} title="暂时无法连接本地工作区" action={<Button variant="primary" onClick={() => void health.refetch()}>重新连接</Button>}>请确认本机服务正在运行。已有草稿的恢复副本会保留在当前浏览器。</Empty><Notice>{errorText(health.error)}</Notice></div> : <Loading label="正在打开本地工作区…" />
  return <WorkspaceSession key={health.data.workspace_id} health={{ data: health.data, isError: health.isError }} switched={initialWorkspace.current !== health.data.workspace_id} />
}

type HealthState = { data: Health; isError: boolean }

function WorkspaceSession({ health, switched }: { health: HealthState; switched: boolean }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: false }, mutations: { retry: false } } }))
  useLayoutEffect(() => {
    bindWorkspace(health.data.workspace_id)
    return () => { void client.cancelQueries() }
  }, [client, health.data.workspace_id])
  return <QueryClientProvider client={client}><WorkspaceApp health={health} switched={switched} /></QueryClientProvider>
}

function WorkspaceApp({ health, switched }: { health: HealthState; switched: boolean }) {
  const [route, setRoute] = useState<Route>(readRoute)
  const routeRef = useRef(route)
  routeRef.current = route
  const [lastNovel, setLastNovel] = useState(route.novelId)
  const [menu, setMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [navigationError, setNavigationError] = useState('')
  const guard = useRef<(() => Promise<unknown>) | null>(null)
  const novelId = route.novelId || lastNovel
  const novel = useQuery({ queryKey: ['novel', novelId], queryFn: () => api.novel(novelId!), enabled: !!novelId && !!health.data })
  const chapters = useQuery({ queryKey: ['chapters', route.novelId], queryFn: () => api.chapters(route.novelId!), enabled: !!route.novelId && route.page === 'write' && !!health.data })
  const chapter = useQuery({ queryKey: ['chapter', route.novelId, route.chapterId], queryFn: () => api.chapter(route.novelId!, route.chapterId!), enabled: !!route.novelId && !!route.chapterId && route.page === 'write' && !!health.data })
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers, enabled: !!health.data })
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles, enabled: !!health.data })
  const registerGuard = useCallback((callback: (() => Promise<unknown>) | null) => { guard.current = callback }, [])
  const navigate = useCallback(async (next: Route) => {
    try {
      await guard.current?.()
      setNavigationError(''); setMenu(false)
      routeRef.current = next; setRoute(next)
      if (next.novelId) setLastNovel(next.novelId)
      if (location.hash !== routeHash(next)) location.hash = routeHash(next)
    } catch (error) { setNavigationError(errorText(error)); throw error }
  }, [])
  const safeNavigate = (next: Route) => { void navigate(next).catch(() => undefined) }
  useEffect(() => {
    const change = () => {
      const next = readRoute()
      if (routeHash(next) === routeHash(routeRef.current)) return
      void navigate(next).catch(() => { history.replaceState(null, '', routeHash(routeRef.current)) })
    }
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.isComposing) { event.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('hashchange', change); window.addEventListener('keydown', shortcut)
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('keydown', shortcut) }
  }, [navigate])
  useEffect(() => {
    if (route.page === 'write' && route.novelId && !route.chapterId && novel.data) void openNovel(novel.data, navigate).catch(e => setNavigationError(errorText(e)))
  }, [route, novel.data, navigate])

  function goBook(page: 'write' | 'bible' | 'plot') {
    if (!novel.data) { safeNavigate({ page: 'library' }); return }
    if (page === 'write' && route.chapterId && route.novelId === novelId) safeNavigate({ page, novelId, chapterId: route.chapterId })
    else if (page === 'write') void openNovel(novel.data, navigate).catch(e => setNavigationError(errorText(e)))
    else safeNavigate({ page, novelId })
  }
  const sidebar = <>
    <button className="brand" onClick={() => safeNavigate({ page: 'library' })} aria-label="Inkloom，我的作品" title="我的作品"><span className="brand-mark"><PenNib size={27} weight="fill" /></span><span><strong>Inkloom</strong></span></button>
    <div className="sidebar-main"><button className={`nav-item library-nav ${route.page === 'library' ? 'active' : ''}`} title="我的作品" onClick={() => safeNavigate({ page: 'library' })}><BookOpen size={21} /><span>我的作品</span></button>
      {novel.data && <button className="current-book" onClick={() => goBook('plot')}><span className="mini-book">{Array.from(novel.data.title)[0]}</span><span><strong>{novel.data.title}</strong><small>{novel.data.platform}</small></span><CaretRight size={15} /></button>}
      {novel.data && <nav aria-label="创作导航"><button className={`nav-item ${route.page === 'plot' ? 'active' : ''}`} title="大纲与章节" onClick={() => goBook('plot')}><TreeStructure size={21} /><span>大纲与章节</span></button><button className={`nav-item ${route.page === 'write' ? 'active' : ''}`} title="章节写作" onClick={() => goBook('write')}><PenNib size={21} /><span>章节写作</span></button><button className={`nav-item ${route.page === 'bible' ? 'active' : ''}`} title="人物与设定" onClick={() => goBook('bible')}><Notebook size={21} /><span>人物与设定</span></button><button className="nav-item" title="连载导出" onClick={() => { if (novel.data) setExportOpen(true); else safeNavigate({ page: 'library' }) }}><Export size={21} /><span>连载导出</span></button></nav>}</div>
    <div className="sidebar-bottom"><button className={`nav-item ${route.page === 'settings' ? 'active' : ''}`} title="模型设置" onClick={() => safeNavigate({ page: 'settings' })}><GearSix size={21} /><span>模型设置</span></button><button className={`nav-item ${route.page === 'backup' ? 'active' : ''}`} title="备份" onClick={() => safeNavigate({ page: 'backup' })}><Archive size={21} /><span>备份</span></button><button className={`nav-item utility-nav ${route.page === 'jobs' ? 'active' : ''}`} title="生成记录" onClick={() => safeNavigate({ page: 'jobs', novelId: route.novelId })}><Clock size={20} /><span>生成记录</span></button><div className="local-status"><span className={`connection-dot ${health.isError ? 'offline' : ''}`} /><span>{health.isError ? '连接中断' : '本地工作区'}</span><span className="version-label">0.2</span></div></div>
  </>
  let content
  if (route.page === 'library') content = <LibraryPage navigate={navigate} query={query} />
  else if (route.page === 'settings') content = <SettingsPage />
  else if (route.page === 'backup') content = <BackupPage health={health.data} />
  else if (route.page === 'jobs') content = <JobsPage novelId={route.novelId} onEvidence={setEvidence} />
  else if (novel.error || (route.page === 'write' && (chapter.error || chapters.error || providers.error || roles.error))) content = <div className="content-page"><Notice>{errorText(novel.error || chapter.error || chapters.error || providers.error || roles.error)}</Notice><Button onClick={() => safeNavigate({ page: 'library' })}>返回作品</Button></div>
  else if (!novel.data || (route.page === 'write' && (!chapter.data || !chapters.data || !providers.data || !roles.data))) content = novelId ? <Loading /> : <Empty icon={<BookOpen size={34} />} title="先选择一部作品" action={<Button onClick={() => safeNavigate({ page: 'library' })}>打开我的作品</Button>}>人物、规划与正文都属于各自的故事。</Empty>
  else if (route.page === 'bible') content = <StoryPage key={`${novel.data.id}:${route.threadId || ''}`} novel={novel.data} threadId={route.threadId} onEvidence={setEvidence} />
  else if (route.page === 'plot') content = <PlanningPage key={novel.data.id} novel={novel.data} navigate={navigate} chapterId={route.chapterId} view={route.view} workspaceId={health.data.workspace_id} registerGuard={registerGuard} onEvidence={setEvidence} />
  else content = <EditorPage key={`${health.data.workspace_id}:${chapter.data!.id}`} novel={novel.data} chapter={chapter.data!} chapters={chapters.data!} workspaceId={health.data.workspace_id} providers={providers.data!} roles={roles.data!} navigate={navigate} onEvidence={setEvidence} registerGuard={registerGuard} />
  if (switched) content = <><Notice tone="neutral">工作区已在其他页面切换，已重新读取当前数据。原工作区的未保存稿件可返回原工作区查看浏览器恢复副本。</Notice>{content}</>
  return <div className={`app-shell ${route.page === 'write' ? 'is-writing' : ''}`}><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById("main-content")?.focus() }}>跳到主要内容</a><aside className="primary-sidebar">{sidebar}</aside><div className="app-main"><header className="app-header"><div className="header-breadcrumb"><button className="icon-button mobile-menu-toggle" aria-label="打开主菜单" onClick={() => setMenu(true)}><List size={21} /></button><span className="header-label">{route.novelId ? '我的作品' : '工作台'}</span>{route.novelId && <><CaretRight size={13} /><strong>{novel.data?.title || '作品'}</strong>{novel.data?.is_demo && <Badge>示例</Badge>}</>}<CaretRight size={13} /><span>{pageNames[route.page]}</span></div><div className="header-actions">{route.page === 'library' ? <label className="header-search"><MagnifyingGlass size={17} /><input aria-label="搜索作品" placeholder="搜索作品…" value={query} onChange={e => setQuery(e.target.value)} /><kbd>Ctrl K</kbd><button aria-label="打开搜索" onClick={() => setSearchOpen(true)} className="sr-only">搜索</button></label> : <button className="header-search search-button" aria-label="搜索已确认原文" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={17} /><span>搜索定稿正文…</span><kbd>Ctrl K</kbd></button>}{route.page === 'library' && <button className="icon-button mobile-library-search" aria-label="搜索作品" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={19} /></button>}{route.novelId && <Button aria-label="导出" className="export-trigger" onClick={() => setExportOpen(true)}><Export size={17} /><span>导出</span></Button>}<span className="author-avatar" title="本机作者">作</span></div></header>{navigationError && <Notice>尚未切换页面：{navigationError}<button className="inline-link" onClick={() => setNavigationError('')}>收起</button></Notice>}<main id="main-content" tabIndex={-1}><Suspense fallback={<Loading />}>{content}</Suspense></main></div>
    <Modal open={menu} onOpenChange={setMenu} title="Inkloom" className="navigation-modal"><div className="mobile-sidebar-content">{sidebar}</div></Modal>
    <EvidenceModal evidence={evidence} onClose={() => setEvidence(null)} />
    {searchOpen && <SearchDialog novel={route.page === 'library' ? undefined : novel.data} onClose={() => setSearchOpen(false)} onEvidence={setEvidence} onLibrarySearch={value => { setQuery(value); setSearchOpen(false); safeNavigate({ page: 'library' }) }} />}
    {exportOpen && novel.data && <ExportDialog novel={novel.data} onClose={() => setExportOpen(false)} flush={() => guard.current?.() ?? Promise.resolve()} />}
  </div>
}

function SearchDialog({ novel, onClose, onEvidence, onLibrarySearch }: { novel?: Novel; onClose: () => void; onEvidence: (e: Evidence) => void; onLibrarySearch: (text: string) => void }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const timeout = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(timeout) }, [query])
  const results = useQuery({ queryKey: ['search', novel?.id, debounced], queryFn: () => api.search(novel!.id, debounced), enabled: !!novel && !!debounced })
  return <Modal open onOpenChange={value => !value && onClose()} title={novel ? `搜索《${novel.title}》` : '搜索我的作品'} description={novel ? '仅搜索当前作品已确认且仍有效的原文，支持中文短词。' : '按书名、题材和故事方向搜索。'} wide><div className="search-dialog-input"><MagnifyingGlass size={22} /><input autoFocus aria-label="输入搜索内容" maxLength={200} placeholder={novel ? '人物名、一句话，或两字短词…' : '书名或故事方向…'} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !novel) onLibrarySearch(query) }} />{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={17} /></button>}</div>{novel ? <div className="search-results">{results.isFetching ? <Loading label="正在搜索定稿正文…" /> : results.error ? <Notice>{errorText(results.error)}</Notice> : debounced && !results.data?.length ? <Empty icon={<MagnifyingGlass size={28} />} title="没有找到有效原文">未确认或已经失效的正文不会进入这里。</Empty> : results.data?.map(({ source }) => <button className="search-result" key={source.source_id} onClick={() => onEvidence({ ...source, quote: source.text })}><span>{source.chapter_title}<ArrowRight size={16} /></span><p>{source.text}</p></button>)}</div> : <div className="modal-actions"><Button variant="primary" onClick={() => onLibrarySearch(query)}>搜索作品<ArrowRight size={17} /></Button></div>}</Modal>
}
