import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CaretDown, CaretRight, CheckCircle, ClockCounterClockwise, Crosshair, MagnifyingGlass, Plus, Sparkle, X } from '@phosphor-icons/react'
import { api, errorText, number } from '../lib/api'
import type { ChapterSummary, Novel } from '../lib/api'
import type { Navigate, Route } from '../lib/route'
import { groupChapters, matchesChapter } from '../lib/chapterDirectory'
import type { ChapterFilter } from '../lib/chapterDirectory'
import { Notice } from '../components/ui'

export function ChapterList({ novel, chapters, currentId, navigate, beforeCreate, onClose }: { novel: Novel; chapters: ChapterSummary[]; currentId: string; navigate: Navigate; beforeCreate?: () => Promise<unknown>; onClose?: () => void }) {
  const cache = useQueryClient()
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ChapterFilter>('all')
  const groups = useMemo(() => groupChapters(chapters), [chapters])
  const [collapsed, setCollapsed] = useState(() => new Set(groups.filter(g => !g.chapters.some(c => c.id === currentId)).map(g => g.id)))
  const [locating, setLocating] = useState(0)
  const currentButton = useRef<HTMLButtonElement>(null)
  const filtering = !!query.trim() || filter !== 'all'
  const visible = groups.map(g => ({ ...g, chapters: g.chapters.filter(c => matchesChapter(c, query, filter)) })).filter(g => g.chapters.length)
  const visibleCount = visible.reduce((sum, g) => sum + g.chapters.length, 0)
  useEffect(() => { currentButton.current?.scrollIntoView({ block: 'nearest' }) }, [currentId, locating])

  async function go(route: Route) {
    try { setError(''); await navigate(route); onClose?.() }
    catch (e) { setError(errorText(e)) }
  }
  async function add() {
    try {
      setCreating(true); setError(''); await beforeCreate?.()
      const ordered = groups.flatMap(g => g.chapters)
      const next = await api.createChapter(novel.id, { title: `第${(ordered.at(-1)?.position || 0) + 1}章`, volume: ordered.at(-1)?.volume || '第一卷', goal: '' })
      await cache.invalidateQueries({ queryKey: ['chapters', novel.id] })
      await go({ page: 'write', novelId: novel.id, chapterId: next.id })
    } catch (e) { setError(errorText(e)) } finally { setCreating(false) }
  }
  function locate() {
    setQuery(''); setFilter('all')
    setCollapsed(values => new Set([...values].filter(id => !groups.find(g => g.id === id)?.chapters.some(c => c.id === currentId))))
    setLocating(n => n + 1)
  }
  return <aside className="chapter-panel" aria-label="章节目录">
    <button className="directory-book-link" onClick={() => void go({ page: 'plot', novelId: novel.id })}>‹ {novel.title}</button>
    <div className="chapter-heading"><strong>章节目录</strong><button className="icon-button" aria-label="新建章节" onClick={() => void add()} disabled={creating}><Plus size={18} /></button></div>
    <div className="chapter-progress"><span>{novel.accepted_count} / {chapters.length} 章已定稿</span><span>{number(novel.total_chars)} 字</span></div>
    <div className="directory-tools">
      <div className="directory-search"><MagnifyingGlass size={16} aria-hidden="true" /><input aria-label="搜索章节" placeholder="章名、细纲或章号" value={query} maxLength={200} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清空章节搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div>
      <div className="directory-filter"><select aria-label="章节状态" value={filter} onChange={e => setFilter(e.target.value as ChapterFilter)}><option value="all">全部章节</option><option value="unfinished">未定稿</option><option value="needs_review">待复核</option><option value="confirmed">已定稿</option></select><button title="定位当前章" aria-label="定位当前章" onClick={locate}><Crosshair size={18} /></button></div>
    </div>
    {filtering && <div className="directory-result-count" role="status">找到 {visibleCount} 章</div>}
    <div className="chapter-scroll">
      {!visible.length && <div className="directory-empty"><p>{chapters.length ? '没有匹配的章节' : '还没有章节'}</p>{filtering && <button onClick={() => { setQuery(''); setFilter('all') }}>清除筛选</button>}</div>}
      {visible.map(group => {
        const expanded = filtering || !collapsed.has(group.id)
        return <section key={group.id} className="directory-volume">
          <button className="volume-toggle" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}${group.title}`} disabled={filtering} onClick={() => setCollapsed(values => { const next = new Set(values); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next })}>{expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}<span>{group.title}</span><small>{group.chapters.length}</small></button>
          {expanded && group.chapters.map(chapter => <button key={chapter.id} ref={chapter.id === currentId ? currentButton : undefined} className={`chapter-item ${chapter.id === currentId ? 'active' : ''}`} onClick={() => void go({ page: 'write', novelId: novel.id, chapterId: chapter.id })} aria-current={chapter.id === currentId ? 'page' : undefined}>
            <span className="chapter-state">{chapter.review_state === 'confirmed' ? <CheckCircle size={16} /> : chapter.review_state === 'needs_review' ? <ClockCounterClockwise size={16} /> : <span className="chapter-dot" />}</span><span className="chapter-item-text"><strong>{chapter.title}</strong><small>{chapter.review_state === 'confirmed' ? '已定稿' : chapter.review_state === 'needs_review' ? '待复核' : chapter.char_count ? '草稿' : '待创作'}<span>{number(chapter.char_count)} 字</span></small></span>
          </button>)}
        </section>
      })}
    </div>
    {error && <Notice>{error}</Notice>}
    <button className="chapter-add" onClick={() => void add()} disabled={creating}><Plus size={17} />新建章节</button>
    <button className="chapter-plan-link" onClick={() => void go({ page: 'plot', novelId: novel.id })}><Sparkle size={17} />规划后续章节</button>
  </aside>
}
