import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowCounterClockwise, Clock, DownloadSimple, Pause, Play, Stop } from '@phosphor-icons/react'
import { activeStates, api, dateLabel, downloadText, errorText, jobStateNames, taskNames } from '../lib/api'
import type { Evidence, Task } from '../lib/api'
import { Badge, Button, Empty, Loading, Modal, Notice, PageHeading } from '../components/ui'
import { AttemptHistory, ContextDetails, JobResult } from './JobPresentation'
import { useJobStream } from '../lib/useJobStream'

export function JobsPage({ novelId, onEvidence }: { novelId?: string; onEvidence: (e: Evidence) => void }) {
  const jobs = useQuery({ queryKey: ['jobs', novelId], queryFn: () => api.jobs(novelId), refetchInterval: 1800 })
  const [selected, setSelected] = useState<{ id: string; novelId: string } | null>(null)
  return <div className="page-scroll"><div className="content-page"><PageHeading title="生成任务" description="查看每一次生成的原稿基线、候选、来源与执行记录。" /><div className="section-toolbar"><span className="muted">{jobs.data?.length ?? 0} 次任务</span><span className="small muted">同一本书同时执行一个生成任务</span></div>{jobs.isPending ? <Loading /> : jobs.error ? <Notice>{errorText(jobs.error)}</Notice> : jobs.data?.length ? <div className="jobs-list">{jobs.data.map(job => <button className="job-row" key={job.id} onClick={() => setSelected({ id: job.id, novelId: job.novel_id })}><span className={`job-icon ${activeStates.has(job.state) ? 'job-active' : ''}`}><Clock size={22} /></span><div><h3>{taskNames[job.task as Task]}{job.is_demo && <Badge tone="amber">演示</Badge>}</h3><p>{job.instruction || '未附加要求'}</p><span className="small muted">{dateLabel(job.created_at)} · 调用 {job.attempt_count}/{job.max_attempts}{job.candidate_status === 'adopted' ? ' · 已采纳' : job.candidate_status === 'needs_rebase' ? ' · 参考已变化' : ''}</span></div><Badge tone={activeStates.has(job.state) ? 'green' : ['failed', 'interrupted_uncertain'].includes(job.state) ? 'amber' : 'neutral'}>{jobStateNames[job.state]}</Badge></button>)}</div> : <Empty icon={<Clock size={34} weight="light" />} title="每一次尝试都会留下记录">从创作空间发起生成后，可在这里查看结果。关闭页面不会自动取消任务。</Empty>}{selected && <JobDialog jobId={selected.id} novelId={selected.novelId} onEvidence={onEvidence} onClose={() => setSelected(null)} />}</div></div>
}

function JobDialog({ jobId, novelId, onEvidence, onClose }: { jobId: string; novelId: string; onEvidence: (e: Evidence) => void; onClose: () => void }) {
  const cache = useQueryClient()
  const job = useQuery({ queryKey: ['job', jobId], queryFn: () => api.job(jobId, novelId), refetchInterval: query => query.state.data && activeStates.has(query.state.data.state) ? 900 : false })
  const [error, setError] = useState('')
  const connection = useJobStream(job.data)
  async function control(action: string) {
    try { const result = await api.control(jobId, novelId, action); cache.setQueryData(['job', jobId], result); await cache.invalidateQueries({ queryKey: ['jobs'] }) } catch (e) { setError(errorText(e)) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title="任务记录" description="候选与原稿分开保存。断线重连只读取已有任务。" wide>{job.isPending ? <Loading /> : job.error ? <Notice>{errorText(job.error)}</Notice> : job.data && <><div className="section-heading"><h3>{taskNames[job.data.task as Task]}</h3><Badge>{jobStateNames[job.data.state]}</Badge></div>{job.data.is_demo && <Notice tone="neutral">这是本地演示响应，不代表真实模型写作能力。</Notice>}<p>{job.data.instruction}</p>{job.data.error_message && <Notice>{job.data.error_message}</Notice>}{job.data.state === 'interrupted_uncertain' && <Notice>上游请求可能已执行并计费。核实服务记录后，才能判断是否需要重试。</Notice>}{connection && <p className="small muted">{connection}</p>}<div className="button-row">{activeStates.has(job.data.state) && <><Button onClick={() => void control('pause')}><Pause size={16} />暂停</Button><Button onClick={() => void control('cancel')}><Stop size={16} />取消</Button></>}{job.data.state === 'paused' && <Button onClick={() => void control('resume')}><Play size={16} />继续</Button>}{['failed', 'interrupted_uncertain'].includes(job.data.state) && <Button disabled={job.data.attempt_count >= job.data.max_attempts} onClick={() => void control('retry')}><ArrowCounterClockwise size={16} />确认并重试</Button>}{job.data.output_text && <Button onClick={() => downloadText(job.data!.output_text, `候选-${jobId.slice(-8)}.txt`)}><DownloadSimple size={16} />下载结果</Button>}</div>{error && <Notice>{error}</Notice>}<div className="job-result-full"><JobResult job={job.data} onEvidence={onEvidence} /></div><details><summary>查看生成时的上下文快照</summary><ContextDetails context={job.data.context} onEvidence={onEvidence} /></details><AttemptHistory attempts={job.data.attempts} currency={job.data.context.currency} /></>}</Modal>
}
