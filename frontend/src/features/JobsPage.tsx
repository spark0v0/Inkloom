import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ArrowCounterClockwise, Clock, DownloadSimple, MagnifyingGlass, Pause, Play, Stop } from '@phosphor-icons/react'
import { activeStates, api, dateLabel, downloadText, errorText, jobStateNames, taskNames } from '../lib/api'
import type { Evidence, JobHistoryFilters, Task } from '../lib/api'
import { Badge, Button, Empty, Loading, Modal, Notice, PageHeading } from '../components/ui'
import { AttemptHistory, ContextDetails, JobResult } from './JobPresentation'
import { useJobStream } from '../lib/useJobStream'

type StateFilter = NonNullable<JobHistoryFilters['state']> | ''

export function JobsPage({ novelId, onEvidence }: { novelId?: string; onEvidence: (e: Evidence) => void }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [task, setTask] = useState<Task | ''>('')
  const [state, setState] = useState<StateFilter>('')
  const [selected, setSelected] = useState<{ id: string; novelId: string } | null>(null)
  useEffect(() => {
    if (composing) return
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search, composing])
  const jobs = useInfiniteQuery({
    queryKey: ['jobs', novelId, 'page', query, task, state],
    queryFn: ({ pageParam }) => api.jobHistory({ novel_id: novelId, query, task: task || undefined,
      state: state || undefined, cursor: pageParam, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: page => page.next_cursor || undefined,
    refetchInterval: value => value.state.data?.pages.some(page => page.items.some(job => activeStates.has(job.state))) ? 1800 : false,
  })
  const rows = jobs.data?.pages.flatMap(page => page.items) || []
  const filtered = !!query || !!task || !!state
  function reset() { setSearch(''); setQuery(''); setTask(''); setState('') }
  return <div className="page-scroll"><div className="content-page">
    <PageHeading title="生成记录" />
    <div className="history-filters">
      <label className="search-input"><MagnifyingGlass size={19} /><input type="search" aria-label="搜索生成记录" maxLength={200} placeholder="搜索书名、章名或写作要求" value={search} onChange={e => setSearch(e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} /></label>
      <select aria-label="筛选生成类型" value={task} onChange={e => setTask(e.target.value as Task | '')}><option value="">全部类型</option>{Object.entries(taskNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
      <select aria-label="筛选任务状态" value={state} onChange={e => setState(e.target.value as StateFilter)}><option value="">全部状态</option>{Object.entries(jobStateNames).map(([key, name]) => <option key={key} value={key}>{key === 'succeeded' ? '已完成' : name}</option>)}</select>
      {filtered && <Button variant="ghost" onClick={reset}>清除筛选</Button>}
    </div>
    <p className="small muted history-count" role="status">{jobs.isPending ? '正在读取记录…' : `已显示 ${rows.length} 条记录`}</p>
    {jobs.isPending ? <Loading /> : rows.length ? <div className="jobs-list">{rows.map(job => <button className="job-row" key={job.id} onClick={() => setSelected({ id: job.id, novelId: job.novel_id })}>
      <span className={`job-icon ${activeStates.has(job.state) ? 'job-active' : ''}`}><Clock size={22} /></span>
      <div><h3>{taskNames[job.task as Task]}{job.is_demo && <Badge tone="amber">演示</Badge>}</h3>
        <span className="history-location">{novelId ? job.chapter_title : `${job.novel_title} · ${job.chapter_title}`}</span>
        {job.instruction_preview && <p>{job.instruction_preview}</p>}
        <span className="small muted">{dateLabel(job.created_at)} · 调用 {job.attempt_count}/{job.max_attempts}{job.candidate_status === 'needs_rebase' ? ' · 原稿或参考已变化' : ''}</span>
      </div><Badge tone={activeStates.has(job.state) ? 'green' : ['failed', 'interrupted_uncertain'].includes(job.state) ? 'amber' : 'neutral'}>{job.candidate_status === 'adopted' ? '已采纳' : job.state === 'succeeded' ? '已完成' : jobStateNames[job.state]}</Badge>
    </button>)}</div> : !jobs.error && <Empty icon={<Clock size={34} weight="light" />} title={filtered ? '没有符合条件的记录' : '还没有生成记录'}>{filtered ? '试试其他关键词或清除筛选。' : '开始创作后，可在这里找回生成结果。'}</Empty>}
    {jobs.error && <Notice>{errorText(jobs.error)}<Button onClick={() => void (jobs.isFetchNextPageError ? jobs.fetchNextPage() : jobs.refetch())}>重试读取</Button></Notice>}
    {jobs.hasNextPage && <div className="history-more"><Button disabled={jobs.isFetching} onClick={() => void jobs.fetchNextPage({ cancelRefetch: false })}>{jobs.isFetchingNextPage ? '正在读取…' : '加载更早记录'}</Button></div>}
    {selected && <JobDialog jobId={selected.id} novelId={selected.novelId} onEvidence={onEvidence} onClose={() => setSelected(null)} />}
  </div></div>
}

function JobDialog({ jobId, novelId, onEvidence, onClose }: { jobId: string; novelId: string; onEvidence: (e: Evidence) => void; onClose: () => void }) {
  const cache = useQueryClient()
  const job = useQuery({ queryKey: ['job', jobId], queryFn: () => api.job(jobId, novelId) })
  const [error, setError] = useState('')
  const connection = useJobStream(job.data)
  async function control(action: string) {
    try { const result = await api.control(jobId, novelId, action); cache.setQueryData(['job', jobId], result); await cache.invalidateQueries({ queryKey: ['jobs'] }) } catch (e) { setError(errorText(e)) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title="任务记录" description="候选与原稿分开保存。断线重连只读取已有任务。" wide>{job.isPending ? <Loading /> : job.error ? <Notice>{errorText(job.error)}</Notice> : job.data && <><div className="section-heading"><h3>{taskNames[job.data.task as Task]}</h3><Badge>{jobStateNames[job.data.state]}</Badge></div>{job.data.is_demo && <Notice tone="neutral">这是本地演示响应，不代表真实模型写作能力。</Notice>}<p>{job.data.instruction}</p>{job.data.error_message && <Notice>{job.data.error_message}</Notice>}{job.data.state === 'interrupted_uncertain' && <Notice>上游请求可能已执行并计费。核实服务记录后，才能判断是否需要重试。</Notice>}{connection && <p className="small muted">{connection}</p>}<div className="button-row">{activeStates.has(job.data.state) && <><Button onClick={() => void control('pause')}><Pause size={16} />暂停</Button><Button onClick={() => void control('cancel')}><Stop size={16} />取消</Button></>}{job.data.state === 'paused' && <Button onClick={() => void control('resume')}><Play size={16} />继续</Button>}{['failed', 'interrupted_uncertain'].includes(job.data.state) && <Button disabled={job.data.attempt_count >= job.data.max_attempts} onClick={() => void control('retry')}><ArrowCounterClockwise size={16} />确认并重试</Button>}{job.data.output_text && <Button onClick={() => downloadText(job.data!.output_text, `候选-${jobId.slice(-8)}.txt`)}><DownloadSimple size={16} />下载结果</Button>}</div>{error && <Notice>{error}</Notice>}<div className="job-result-full"><JobResult job={job.data} onEvidence={onEvidence} stale={job.data.candidate_status === 'needs_rebase'} /></div><details><summary>查看生成时的上下文快照</summary><ContextDetails context={job.data.context} onEvidence={onEvidence} /></details><AttemptHistory attempts={job.data.attempts} currency={job.data.context.currency} /></>}</Modal>
}
