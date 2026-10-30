import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowClockwise, ArrowRight, GitBranch, MagnifyingGlass, PencilSimple } from '@phosphor-icons/react'
import { api, errorText } from '../lib/api'
import type { Evidence } from '../lib/api'
import type { Navigate } from '../lib/route'
import { buildStoryMap, chapterState, chapterStateLabels, filterStoryMap } from '../lib/storyMap'
import type { StoryMarker } from '../lib/storyMap'
import { threadStageNames, threadStatusNames } from '../lib/threads'
import { Badge, Button, Empty, Loading, Notice } from '../components/ui'
import { SourceButton } from '../components/SourceButton'
import './story-map.css'

const pageSize = 40
type Props = { novelId: string; navigate: Navigate; onEvidence: (e: Evidence) => void; onPlan: () => void }

export function StoryMap({ novelId, navigate, onEvidence, onPlan }: Props) {
  const chapters = useQuery({ queryKey: ['chapters', novelId], queryFn: () => api.chapters(novelId), staleTime: 0, refetchOnMount: 'always' })
  const tracks = useQuery({ queryKey: ['threads', novelId], queryFn: () => api.threads(novelId), staleTime: 0, refetchOnMount: 'always' })
  const [search, setSearch] = useState('')
  const [volume, setVolume] = useState<string | undefined>(undefined)
  const [state, setState] = useState('')
  const [threadId, setThreadId] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterId = useId()
  const [page, setPage] = useState(0)
  const [navigationError, setNavigationError] = useState('')
  const firstHeading = useRef<HTMLHeadingElement>(null)
  const paging = useRef(false)
  const rows = useMemo(() => buildStoryMap(novelId, chapters.data || [], tracks.data || []), [novelId, chapters.data, tracks.data])
  const filtered = useMemo(() => filterStoryMap(rows, { search, volume, state, threadId }), [rows, search, volume, state, threadId])
  const volumes = [...new Set(rows.map(row => row.chapter.volume))]
  const count = filtered.length
  const pages = Math.max(1, Math.ceil(count / pageSize))
  const currentPage = Math.min(page, pages - 1)
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  useEffect(() => {
    if (!paging.current) return
    paging.current = false
    firstHeading.current?.focus({ preventScroll: true })
    firstHeading.current?.scrollIntoView({ block: 'center' })
  }, [currentPage])
  const relatedCounts = useMemo(() => {
    const values = new Map<string, number>()
    for (const row of rows) for (const id of new Set(row.markers.map(m => m.thread.entity.id))) values.set(id, (values.get(id) || 0) + 1)
    return values
  }, [rows])
  const error = chapters.error || tracks.error
  const refreshing = chapters.isFetching || tracks.isFetching
  const selected = tracks.data?.find(t => t.entity.id === threadId)
  function chooseThread(id: string) { setThreadId(id); setPage(0) }
  function clear() { setSearch(''); setVolume(undefined); setState(''); setThreadId(''); setPage(0) }
  function goThread(id: string) { void navigate({ page: 'bible', novelId, threadId: id }).catch(e => setNavigationError(errorText(e))) }
  function goChapter(id: string) { void navigate({ page: 'plot', novelId, chapterId: id, view: 'map' }).catch(e => setNavigationError(errorText(e))) }
  function refresh() { void Promise.all([chapters.refetch(), tracks.refetch()]) }
  if (!chapters.data || !tracks.data) return error ? <Notice>{errorText(error)}<Button onClick={refresh}>重新读取脉络</Button></Notice> : <Loading />
  return <section className={`story-map ${filtersOpen ? 'filters-open' : ''}`} aria-label="故事脉络">
    <div className="story-map-filters">
      <label className="search-input"><MagnifyingGlass size={18} /><input aria-label="搜索章节、细纲或伏笔" placeholder="搜索章节、细纲或伏笔…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></label>
      <div className="story-map-filter-options" id={filterId}><select aria-label="脉络分卷" value={volume === undefined ? '' : JSON.stringify(volume)} onChange={e => { setVolume(e.target.value === '' ? undefined : JSON.parse(e.target.value)); setPage(0) }}><option value="">全部分卷</option>{volumes.map(v => <option key={v} value={JSON.stringify(v)}>{v || '未分卷'}</option>)}</select>
      <select aria-label="脉络章节状态" value={state} onChange={e => { setState(e.target.value); setPage(0) }}><option value="">全部状态</option>{Object.entries(chapterStateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </div><Button className="story-map-filter-toggle" aria-expanded={filtersOpen} aria-controls={`${filterId} ${filterId}-thread`} onClick={() => setFiltersOpen(!filtersOpen)}>筛选{(volume !== undefined || state || threadId) ? ` · ${Number(volume !== undefined) + Number(!!state) + Number(!!threadId)}` : ''}</Button>
      <Button disabled={refreshing} onClick={refresh}><ArrowClockwise size={17} />{refreshing ? '正在读取…' : '刷新脉络'}</Button>
    </div>
    {error && <Notice>刷新未完成，当前保留上次读取的内容：{errorText(error)}</Notice>}
    {navigationError && <Notice>{navigationError}</Notice>}
    <div className="story-map-caption"><p>按章节顺序查看；回忆与倒叙以细纲为准。计划回收不代表正文已经发生。</p><span role="status">显示 {count} / {rows.length} 章</span></div>
    <label className="story-map-thread-picker" id={`${filterId}-thread`}>伏笔脉络<select aria-label="按伏笔查看脉络" value={threadId} onChange={e => chooseThread(e.target.value)}><option value="">全部伏笔</option>{tracks.data.map(t => <option key={t.entity.id} value={t.entity.id}>{t.entity.name} · {relatedCounts.get(t.entity.id) || 0} 章</option>)}</select></label>
    {selected && <div className="story-map-selection"><strong>{selected.entity.name}</strong><Badge tone={selected.status === 'needs_review' ? 'amber' : 'neutral'}>{threadStatusNames[selected.status]}</Badge>{selected.paused && <Badge>已暂缓</Badge>}<Button variant="ghost" onClick={() => goThread(selected.entity.id)}>打开伏笔档案<ArrowRight size={16} /></Button><Button variant="ghost" onClick={() => chooseThread('')}>显示全部伏笔</Button></div>}
    <div className="story-map-workspace">
      <div className="story-map-main">
        {!rows.length ? <Empty icon={<GitBranch size={32} />} title="还没有章节" action={<Button onClick={onPlan}>去规划章节<ArrowRight size={17} /></Button>}>建立章节细纲后，就能沿着章节查看剧情与伏笔。</Empty> : !visible.length ? <Empty icon={<MagnifyingGlass size={30} />} title="没有符合条件的章节" action={<Button onClick={clear}>清除筛选</Button>}>{selected && !relatedCounts.get(selected.entity.id) ? '这条伏笔还未关联章节。打开伏笔档案可安排回收，或关联已定稿原文。' : '试试其他关键词、分卷或章节状态。'}</Empty> : <ol className="story-map-timeline" aria-label="章节脉络">{visible.map(({ chapter, markers }, index) => <li key={chapter.id} className={`story-map-step state-${chapterState(chapter)}`} value={chapter.position}>
          {(index === 0 || chapter.volume !== visible[index - 1].chapter.volume) && <div className="story-map-volume"><h2>{chapter.volume || '未分卷'}</h2></div>}
          <article aria-label={chapter.title}><span className="story-map-node" aria-hidden="true">{chapter.position}</span>
            <div className="story-map-chapter-heading"><h3 ref={index === 0 ? firstHeading : undefined} tabIndex={-1}>{chapter.title}</h3><Badge tone={chapter.review_state === 'needs_review' ? 'amber' : chapter.review_state === 'confirmed' ? 'green' : 'neutral'}>{chapterStateLabels[chapterState(chapter)]}</Badge></div>
            <p className="story-map-goal">{chapter.goal || '尚未填写细纲'}</p>
            {!!markers.length && <div className="story-map-markers">{markers.filter(m => !threadId || m.thread.entity.id === threadId).map(marker => <Marker key={marker.key} marker={marker} onEvidence={onEvidence} onThread={goThread} />)}</div>}
            <div className="story-map-chapter-actions"><Button onClick={() => goChapter(chapter.id)}><PencilSimple size={16} />编辑细纲</Button></div>
          </article></li>
        )}</ol>}
        {pages > 1 && <nav className="story-map-pagination" aria-label="脉络翻页"><Button disabled={currentPage === 0} onClick={() => { paging.current = true; setPage(currentPage - 1) }}>上一页</Button><span>第 {currentPage + 1} / {pages} 页</span><Button disabled={currentPage >= pages - 1} onClick={() => { paging.current = true; setPage(currentPage + 1) }}>下一页</Button></nav>}
      </div>
      <aside className="story-map-index" aria-label="伏笔索引"><div className="section-heading"><h2>伏笔脉络</h2><span>{tracks.data.length} 条</span></div><button className={`story-map-index-item ${!threadId ? 'active' : ''}`} aria-pressed={!threadId} onClick={() => chooseThread('')}>全部伏笔</button>{tracks.data.map(t => <button key={t.entity.id} className={`story-map-index-item ${threadId === t.entity.id ? 'active' : ''}`} aria-pressed={threadId === t.entity.id} onClick={() => chooseThread(t.entity.id)}><strong>{t.entity.name}</strong><span>{t.paused ? '已暂缓' : threadStatusNames[t.status]} · {relatedCounts.get(t.entity.id) || 0} 章</span></button>)}{!tracks.data.length && <p className="muted">还没有伏笔。可在人物与设定中添加，随后关联章节。</p>}</aside>
    </div>
  </section>
}

function Marker({ marker, onEvidence, onThread }: { marker: StoryMarker; onEvidence: (e: Evidence) => void; onThread: (id: string) => void }) {
  const planned = marker.kind === 'planned'
  const label = planned ? marker.thread.paused ? '暂缓计划' : marker.thread.status === 'resolved' ? '原计划回收' : '计划回收'
    : marker.current ? '已' + threadStageNames[marker.progress.stage] : threadStageNames[marker.progress.stage] + '待复核'
  return <div className={`story-map-marker ${planned ? 'is-planned' : !marker.current ? 'needs-review' : ''}`}>
    <div className="story-map-marker-heading"><button className="inline-link" onClick={() => onThread(marker.thread.entity.id)}>{marker.thread.entity.name}</button><Badge tone={!planned && !marker.current ? 'amber' : 'neutral'}>{label}</Badge>{marker.thread.entity.status === 'proposed' && <Badge tone="amber">设定待确认</Badge>}</div>
    <p>{planned ? marker.thread.intent || '尚未填写回收安排' : marker.progress.note || marker.progress.evidence.quote}</p>
    {!planned && <><SourceButton evidence={marker.progress.evidence} onEvidence={onEvidence} label={marker.current ? '查看原文' : '查看旧版原文'} />{!marker.current && <p className="story-map-warning">{marker.progress.invalid_reason || '本章需要复核，请核对原文后重新关联。'}</p>}</>}
  </div>
}
