import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, CaretRight, Check, CheckCircle, PencilSimple, Sparkle, Stop } from '@phosphor-icons/react'
import { canUseProvider, activeStates, api, ApiError, errorText, jobStateNames, number, uuid } from '../../lib/api'
import type { Blueprint, Evidence, JobInput, Novel, Plan, PlanInput } from '../../lib/api'
import type { Navigate } from '../../app/route'
import { nextWritingChapter } from '../../lib/workflow'
import { Badge, Button, Field, Loading, Modal, Notice } from '../../components/ui'
import { useJobStream } from '../../lib/useJobStream'
import { BlueprintView, OutlineView } from '../generation/ProductionResults'
import { ChapterOutlineEditor } from './ChapterOutlineEditor'
import { ProviderDisclosure } from '../../components/ProviderDisclosure'
import { NovelBriefDialog } from './NovelBriefDialog'
import { StoryMap } from './StoryMap'
import { PlanningDiscussions } from './PlanningDiscussions'
import { ReviewImpactDialog } from '../story/ReviewImpactDialog'
import { PlanningDirectory, planningVolumes } from './PlanningDirectory'
import type { VolumeSelection } from './PlanningDirectory'

const labels = { book: '全书', volume: '分卷', chapter: '章节', scene: '场景' }

export function PlanningPage({ novel, navigate, chapterId, workspaceId, registerGuard, onEvidence, view, discussionId }: { novel: Novel; navigate: Navigate; chapterId?: string; view?: 'map' | 'discuss'; discussionId?: string; workspaceId: string; registerGuard: (guard: (() => Promise<unknown>) | null) => void; onEvidence: (e: Evidence) => void }) {
  const cache = useQueryClient()
  const plans = useQuery({ queryKey: ['plans', novel.id], queryFn: () => api.plans(novel.id), enabled: !chapterId })
  const chapters = useQuery({ queryKey: ['chapters', novel.id], queryFn: () => api.chapters(novel.id), enabled: !chapterId })
  const jobs = useQuery({ queryKey: ['jobs', novel.id, 'planning-pending'], queryFn: () => api.jobHistory({ novel_id: novel.id, tasks: ['blueprint', 'outline'], pending_only: true, limit: 1 }, workspaceId), refetchInterval: 3000, enabled: !chapterId })
  const [planningTab, setPlanningTab] = useState<'book' | 'volumes'>('volumes')
  const tab = view || planningTab
  const [selected, setSelected] = useState<VolumeSelection | null>(null)
  const [editing, setEditing] = useState<{ plan?: Plan; level?: PlanInput['level']; title?: string } | null>(null)
  const [brief, setBrief] = useState(false)
  const [impactOpen, setImpactOpen] = useState(false)
  const [generation, setGeneration] = useState<'blueprint' | 'outline' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [appliedChapters, setAppliedChapters] = useState<string[]>([])
  const readyRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (appliedChapters.length) { readyRef.current?.scrollIntoView({ block: 'nearest' }); readyRef.current?.focus({ preventScroll: true }) } }, [appliedChapters])
  const [resumeId, setResumeId] = useState<string | null>(null)
  const allPlans = plans.data || []
  const book = allPlans.find(p => p.level === 'book')
  const blueprint = book?.structure?.kind === 'blueprint' ? book.structure as unknown as Blueprint : null
  const volumes = allPlans.filter(p => p.level === 'volume')
  const groups = planningVolumes(volumes, chapters.data ?? [])
  const group = groups.find(item => selected?.planId ? item.plan?.id === selected.planId : item.title === selected?.title)
    ?? groups[0]
  const volume = group?.plan
  const hasChapters = novel.chapter_count > 0 || !!chapters.data?.length
  const resumable = jobs.data?.items[0]
  const first = chapters.data?.[0]
  const blankFirst = chapters.data?.length === 1 && first?.title === '第1章' && first.volume === '第一卷'
    && !first.char_count && !first.goal && !first.outline_revision && first.review_state === 'draft'
  const setupKind = generation || (!view && !book && !volumes.length && (!hasChapters || (blankFirst && resumable?.task === 'blueprint')) ? 'blueprint' : null)
  function selectTab(value: 'book' | 'volumes' | 'map' | 'discuss') {
    if (value === 'book' || value === 'volumes') setPlanningTab(value)
    if (view || value === 'map' || value === 'discuss') void navigate({ page: 'plot', novelId: novel.id, view: value === 'map' || value === 'discuss' ? value : undefined }).catch(e => setError(errorText(e)))
  }
  async function refresh() {
    await Promise.all(['novel', 'chapters', 'plans', 'entities', 'jobs'].map(key => cache.invalidateQueries({ queryKey: [key, novel.id] })))
    await cache.invalidateQueries({ queryKey: ['novels'] })
  }
  async function addChapter(first = false) {
    if (busy) return
    setBusy(true)
    try {
      const chapterId = first ? (await api.planningAnchor(novel.id, workspaceId)).chapter_id : (await api.createChapter(novel.id, {
        title: `第${(chapters.data?.at(-1)?.position ?? 0) + 1}章`, volume: group?.title ?? '第一卷', goal: '',
      }, workspaceId)).id
      await refresh()
      await navigate({ page: 'write', novelId: novel.id, chapterId })
    }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function resume() {
    if (!resumable) return
    try {
      const detail = await api.job(resumable.id, novel.id, undefined, workspaceId)
      if (detail.task === 'outline') {
        const plan = volumes.find(item => item.id === detail.context.volume_plan_id)
        if (!plan) throw new Error('原分卷已变化，请读取最新规划后再继续。')
        setSelected({ title: plan.title, planId: plan.id })
      }
      setResumeId(detail.id)
      setGeneration(detail.task as 'blueprint' | 'outline')
    } catch (e) { setError(errorText(e)) }
  }
  function startWriting() {
    const target = chapters.data?.find(c => appliedChapters.includes(c.id)) || nextWritingChapter(chapters.data || [])
    if (target) void navigate({ page: 'write', novelId: novel.id, chapterId: target.id }).catch(e => setError(errorText(e)))
    else { selectTab('volumes'); setGeneration(volume ? 'outline' : null) }
  }
  const production = setupKind && <ProductionPanel key={`${setupKind}:${setupKind === 'outline' ? volume?.id : ''}:${resumeId || ''}`} novel={novel} workspaceId={workspaceId} kind={setupKind} volume={volume} resumeId={resumeId} onSettings={() => void navigate({ page: 'settings' })} onClose={() => { setGeneration(null); setResumeId(null) }} onApplied={async ids => {
    await refresh(); selectTab('volumes'); setResumeId(null)
    if (setupKind === 'blueprint') {
      const firstVolume = cache.getQueryData<Plan[]>(['plans', novel.id])?.find(plan => plan.level === 'volume')
      if (firstVolume) setSelected({ title: firstVolume.title, planId: firstVolume.id })
      setGeneration(firstVolume ? 'outline' : null)
    } else { setAppliedChapters(ids); setGeneration(null) }
  }} />
  if (chapterId) return <ChapterOutlineEditor key={chapterId} novel={novel} chapterId={chapterId} returnView={view} returnDiscussionId={discussionId} workspaceId={workspaceId} navigate={navigate} registerGuard={registerGuard} onEvidence={onEvidence} />

  const readError = tab === 'discuss' ? chapters.error : plans.error ?? chapters.error
  const retryPlans = () => { if (plans.error) void plans.refetch(); if (chapters.error) void chapters.refetch() }
  let body
  if (tab === 'map' && !setupKind) {
    body = <StoryMap novelId={novel.id} navigate={navigate} onEvidence={onEvidence} onPlan={() => selectTab('volumes')} />
  } else if (tab === 'discuss' && !setupKind) {
    body = chapters.data ? <PlanningDiscussions onEvidence={onEvidence} key={workspaceId + ':' + novel.id} novelId={novel.id} discussionId={discussionId} workspaceId={workspaceId} chapters={chapters.data} navigate={navigate} /> : !readError && <Loading />
  } else if (!plans.data || !chapters.data) {
    body = !readError && <Loading />
  } else if (setupKind) {
    body = <>{production}{!book && <div className="setup-alternative">
      <button className="text-link" onClick={() => setEditing({ level: 'book' })}>手动添加大纲</button>
      <button className="text-link" disabled={busy} onClick={() => { if (chapters.data.length) startWriting(); else void addChapter(true) }}>直接开始写作<ArrowRight size={16} /></button>
    </div>}</>
  } else if (tab === 'book') {
    body = <section className="book-blueprint">
      {blueprint ? <BlueprintView value={blueprint} /> : <><h2>{book?.title || '作品方向'}</h2><p className="preserve-lines">{book?.body || novel.premise}</p></>}
      <div className="button-row">
        <Button onClick={() => setEditing({ plan: book, level: 'book' })}><PencilSimple size={16} />{book ? '编辑大纲' : '添加大纲'}</Button>
        <Button variant="primary" onClick={() => selectTab('volumes')}>规划分卷章节<ArrowRight size={16} /></Button>
      </div>
    </section>
  } else {
    body = <PlanningDirectory groups={groups} current={group} busy={busy}
      onSelect={value => setSelected({ title: value.title, planId: value.plan?.id })}
      onAddVolume={title => setEditing({ level: 'volume', title })}
      onEditVolume={plan => setEditing({ plan })}
      onGenerate={() => setGeneration('outline')}
      onAddChapter={() => void addChapter()}
      onOpenChapter={id => void navigate({ page: 'plot', novelId: novel.id, chapterId: id }).catch(e => setError(errorText(e)))} />
  }

  return <div className="page-scroll"><div className={`serial-studio ${tab === 'map' ? 'viewing-story-map' : tab === 'discuss' ? 'viewing-planning-discussion' : ''}`}>
    <header className="book-heading"><div className="studio-book-cover" aria-hidden="true"><BookOpen size={28} weight="light" /><span>{novel.title}</span></div><div className="book-heading-main"><div className="book-category">{novel.genre || '题材待定'}<span>/</span>{novel.platform || '自由创作'}{novel.is_demo && <Badge tone="amber">示例</Badge>}</div><h1>{novel.title}</h1>{novel.premise && <p>{novel.premise}</p>}<div className="book-targets"><span>计划 {number(novel.target_words / 10000)} 万字</span><span>每章 {number(novel.chapter_words)} 字</span><span>{novel.accepted_count} 章已定稿</span></div></div><Button onClick={() => setBrief(true)}><PencilSimple size={17} />编辑作品</Button></header>
    <nav className="creation-steps" aria-label="创作步骤">
      <button className={book ? 'done' : hasChapters ? '' : 'current'} aria-current={!book && !hasChapters ? 'step' : undefined} onClick={() => { selectTab('book'); setGeneration(book ? null : 'blueprint') }}><span>{book ? <Check size={16} /> : '1'}</span>全书方案</button><i />
      <button className={book && !chapters.data?.some(c => c.goal) ? 'current' : ''} disabled={!book && !volumes.length && !hasChapters} onClick={() => { selectTab('volumes'); setGeneration(null) }}><span>2</span>章节细纲</button><i />
      <button onClick={startWriting} disabled={!chapters.data?.length}><span>3</span>开始写作</button>
    </nav>
    {novel.dirty_from_order != null && <Notice action={<Button onClick={() => setImpactOpen(true)}>查看复核清单</Button>}>第 {novel.dirty_from_order} 章起需要重新复核定稿。</Notice>}
    {resumable && !setupKind && <div className="production-resume"><Sparkle size={18} /><span>{resumable.task === 'blueprint' ? '全书方案' : '章节细纲'} · {jobStateNames[resumable.state]}</span><Button variant="ghost" onClick={() => void resume()}>查看进度<ArrowRight size={16} /></Button></div>}
    {error && <Notice>{error}</Notice>}
    {!setupKind && appliedChapters.length > 0 && <div className="setup-ready" role="status" ref={readyRef} tabIndex={-1}><CheckCircle size={22} /><span>已建立 {appliedChapters.length} 章细纲</span><Button variant="primary" onClick={startWriting}>开始写作<ArrowRight size={17} /></Button></div>}
    {!setupKind && <nav className="studio-tabs" aria-label="规划视图">
      <button aria-pressed={tab === 'book'} className={tab === 'book' ? 'active' : ''} onClick={() => selectTab('book')}>全书设定</button>
      <button aria-pressed={tab === 'volumes'} className={tab === 'volumes' ? 'active' : ''} onClick={() => selectTab('volumes')}>{volumes.length ? '分卷大纲' : '章节目录'}<span>{volumes.length || chapters.data?.length || 0}</span></button>
      <button aria-pressed={tab === 'map'} className={tab === 'map' ? 'active' : ''} onClick={() => selectTab('map')}>故事脉络</button>
      <button aria-pressed={tab === 'discuss'} className={tab === 'discuss' ? 'active' : ''} onClick={() => { setGeneration(null); selectTab('discuss') }}>规划讨论</button>
    </nav>}
    {readError && tab !== 'map' && <Notice action={<Button onClick={retryPlans}>重读规划资料</Button>}>{errorText(readError)}</Notice>}
    {body}
    {tab !== 'discuss' && allPlans.some(p => p.level === 'scene' || (p.level === 'chapter' && !p.structure?.chapter_id)) && <details className="legacy-plans"><summary>其他规划</summary>{allPlans.filter(p => p.level === 'scene' || (p.level === 'chapter' && !p.structure?.chapter_id)).map(p => <button key={p.id} className="legacy-plan" onClick={() => setEditing({ plan: p })}><Badge>{labels[p.level]}</Badge>{p.title}<CaretRight size={16} /></button>)}</details>}

    {impactOpen && <ReviewImpactDialog novelId={novel.id} workspaceId={workspaceId} navigate={navigate} onClose={() => setImpactOpen(false)} />}
    {editing && <PlanDialog novelId={novel.id} plan={editing.plan} defaultLevel={editing.level} defaultTitle={editing.title} onClose={() => setEditing(null)} />}
    {brief && <NovelBriefDialog novel={novel} onClose={() => setBrief(false)} />}
  </div></div>
}

function ProductionPanel({ novel, workspaceId, kind, volume, resumeId, onSettings, onClose, onApplied }: { novel: Novel; workspaceId: string; kind: 'blueprint' | 'outline'; volume?: Plan; resumeId: string | null; onSettings: () => void; onClose: () => void; onApplied: (ids: string[]) => Promise<void> }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.scrollIntoView({ block: 'nearest' }); headingRef.current?.focus({ preventScroll: true }) }, [])
  const cache = useQueryClient()
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles })
  const jobs = useQuery({ queryKey: ['jobs', novel.id, kind, kind === 'outline' ? volume?.id : null, 'production-summary'], queryFn: () => api.jobHistory({ novel_id: novel.id, task: kind, volume_plan_id: kind === 'outline' ? volume?.id : undefined, pending_only: true, limit: 1 }, workspaceId), enabled: kind === 'blueprint' || !!volume })
  const [chosen, setChosen] = useState('')
  const pending = useRef<JobInput | null>(null)
  const requestPending = useRef(false)
  const preferred = providers.data?.find(p => p.id === roles.data?.planner) || providers.data?.find(p => p.kind !== 'demo' && canUseProvider(p))
  const providerId = pending.current?.provider_id || chosen || preferred?.id || 'demo'
  const provider = providers.data?.find(p => p.id === providerId)
  const [instruction, setInstruction] = useState('')
  const [batch, setBatch] = useState(5)
  const [jobId, setJobId] = useState<string | null>(null)
  const existing = jobs.data?.items[0]
  const id = jobId || resumeId || existing?.id
  const job = useQuery({ queryKey: ['job', id], queryFn: () => api.job(id!, novel.id, undefined, workspaceId), enabled: !!id })
  useJobStream(job.data)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = busy || !!pending.current
  const active = !!job.data && activeStates.has(job.data.state)
  async function generate() {
    if (requestPending.current || (active && !pending.current)) return
    requestPending.current = true
    setBusy(true); setError('')
    try {
      if (!pending.current) {
        const anchor = await api.planningAnchor(novel.id, workspaceId)
        const contextInput = { ...anchor, task: kind, provider_id: providerId, instruction, chapter_batch: batch, volume_plan_id: kind === 'outline' ? volume?.id : null, target_chars: novel.chapter_words }
        await api.context(novel.id, contextInput, workspaceId)
        pending.current = { ...contextInput, idempotency_key: uuid(), max_attempts: 3 }
      }
      const created = await api.createJob(novel.id, pending.current, workspaceId)
      pending.current = null; setJobId(created.id); cache.setQueryData(['job', created.id], created)
      await cache.invalidateQueries({ queryKey: ['jobs', novel.id] })
    } catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.current = null; setError(errorText(e)) } finally { requestPending.current = false; setBusy(false) }
  }
  async function control(action: string) {
    if (!job.data || requestPending.current || pending.current) return
    try { const result = await api.control(job.data.id, novel.id, action, workspaceId); cache.setQueryData(['job', result.id], result) } catch (e) { setError(errorText(e)) }
  }
  async function apply() {
    if (!job.data || requestPending.current || pending.current) return
    requestPending.current = true
    setBusy(true)
    try { const result = await api.applyPlan(job.data.id, novel.id, workspaceId); await onApplied(result.chapter_ids) } catch (e) { setError(errorText(e)) } finally { requestPending.current = false; setBusy(false) }
  }
  const ready = job.data?.state === 'succeeded' && job.data.candidate_status === 'ready'
  return <section className="production-inline" aria-label={kind === 'blueprint' ? 'AI 全书方案' : 'AI 章节细纲'}><header className="production-title"><div><h2 ref={headingRef} tabIndex={-1}>{kind === 'blueprint' ? '全书方案' : '规划章节细纲'}</h2><p>{kind === 'blueprint' ? '根据故事想法生成大纲、人物与分卷。' : volume?.title}</p></div>{kind === 'outline' && <Button disabled={locked} onClick={onClose}>返回大纲</Button>}</header><details className="production-controls" open={locked || !job.data || (!active && !job.data.result)}><summary>模型与生成要求</summary><div className="form-row"><Field label="创作模型"><select value={providerId} onChange={e => setChosen(e.target.value)} disabled={active || locked}>{providers.data?.map(p => <option key={p.id} value={p.id}>{p.kind === 'demo' ? '演示模型（固定样例）' : `${p.name} · ${p.model}`}</option>)}</select></Field>{kind === 'outline' && <Field label="本次规划"><select value={batch} onChange={e => setBatch(Number(e.target.value))} disabled={active || locked}>{[3, 5, 10, 15, 20].map(n => <option key={n} value={n}>{n} 章</option>)}</select></Field>}</div><Field label="补充要求"><textarea rows={2} maxLength={12000} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder={kind === 'blueprint' ? '例如：主角不靠系统，侧重悬疑推理，感情线克制' : '例如：这几章加快节奏，让主角付出一次代价'} disabled={active || locked} /></Field><ProviderDisclosure provider={provider} />{(provider?.kind === 'demo' || !canUseProvider(provider)) && <button className="text-link" disabled={locked} onClick={onSettings}>连接自己的模型<ArrowRight size={15} /></button>}<Button variant="primary" onClick={() => void generate()} disabled={busy || (active && !pending.current) || !canUseProvider(provider)}><Sparkle size={18} />{busy ? '正在提交…' : pending.current ? '确认上次提交' : job.data ? '按新要求重新生成' : kind === 'blueprint' ? 'AI 生成全书方案' : `生成 ${batch} 章细纲`}</Button></details>{error && <Notice>{error}{pending.current && <span className="block small">上次提交尚未确认，生成要求已锁定。请确认同一次提交后继续。</span>}</Notice>}{job.data && <section className="production-result"><div className="section-heading"><h3>{job.data.result ? '预览方案' : '生成进度'}</h3><Badge tone={job.data.is_demo ? 'amber' : 'neutral'}>{job.data.is_demo ? '演示样例 · ' : ''}{jobStateNames[job.data.state]}</Badge>{active && <Button variant="ghost" onClick={() => void control('cancel')}><Stop size={16} />停止生成</Button>}</div>{job.data.error_message && <Notice>{job.data.error_message}</Notice>}{['failed', 'interrupted_uncertain'].includes(job.data.state) && <Button onClick={() => void control('retry')} disabled={locked || job.data.attempt_count >= job.data.max_attempts}>{job.data.state === 'interrupted_uncertain' ? '已核实费用，重试' : '重试本次生成'}</Button>}{job.data.state === 'paused' && <Button disabled={locked} onClick={() => void control('resume')}>继续</Button>}{job.data.result?.kind === 'blueprint' ? <BlueprintView value={job.data.result} /> : job.data.result?.kind === 'outline' ? <OutlineView value={job.data.result} /> : active ? <Loading label={`正在构思${kind === 'blueprint' ? '全书方案' : '章节细纲'}，已接收 ${number(job.data.output_text.length)} 字符…`} /> : job.data.output_text && <details><summary>查看未完成响应</summary><pre className="partial-output">{job.data.output_text}</pre></details>}{job.data.candidate_status === 'needs_rebase' && <Notice>作品或目录已更新，请重新生成。</Notice>}</section>}<div className="modal-actions sticky-modal-actions"><span className="small muted">{active ? '离开页面后仍可继续查看进度' : ready ? '采纳后保存到本书，可继续修改' : '生成结果保留在本页'}</span>{ready && <Button variant="primary" onClick={() => void apply()} disabled={locked}><Check size={18} />{kind === 'blueprint' ? '采纳方案，规划章节' : `采纳这 ${job.data?.result?.kind === 'outline' ? job.data.result.chapters.length : batch} 章`}</Button>}</div></section>
}

function PlanDialog({ novelId, plan, onClose, defaultLevel = 'volume', defaultTitle = '' }: { novelId: string; plan?: Plan; onClose: () => void; defaultLevel?: PlanInput['level']; defaultTitle?: string }) {
  const cache = useQueryClient()
  const [form, setForm] = useState<PlanInput>({ title: plan?.title || defaultTitle, level: plan?.level || defaultLevel, body: plan?.body || '' })
  const [baseline, setBaseline] = useState(plan)
  const [latest, setLatest] = useState<Plan | null>(null)
  const [touched, setTouched] = useState(new Set<'title' | 'body'>())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const composing = useRef(false)
  function change(key: 'title' | 'body', value: string) {
    setForm(previous => ({ ...previous, [key]: value }))
    setTouched(previous => new Set([...previous, key]))
  }
  async function save() {
    if (busy || composing.current) return
    setBusy(true); setError('')
    try {
      if (baseline) {
        const changes = Object.fromEntries([...touched].map(key => [key, form[key]]))
        await api.editPlan(novelId, baseline.id, { title: baseline.title, body: baseline.body, level: baseline.level,
          ...changes, base_updated_at: baseline.updated_at })
      } else await api.savePlan(novelId, form)
      await Promise.all(['plans', 'novel', 'chapters', 'chapter'].map(key => cache.invalidateQueries({ queryKey: [key, novelId] })))
      onClose()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function readLatest() {
    if (!plan || busy) return
    setBusy(true)
    try {
      const value = await api.plan(novelId, plan.id)
      setForm(previous => ({ ...previous, title: touched.has('title') ? previous.title : value.title,
        body: touched.has('body') ? previous.body : value.body }))
      setBaseline(value); setLatest(value); setError('')
    }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && !busy && onClose()} dismissible={!busy} title={plan ? '编辑规划' : '添加规划'} wide>
    <form className="form-stack" onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset disabled={busy} className="form-stack planning-fields"><legend className="sr-only">规划内容</legend>
        <div className="form-row"><Field label="层级"><select value={form.level} disabled={!!plan} onChange={e => setForm({ ...form, level: e.target.value as PlanInput['level'] })}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="标题"><input required maxLength={240} value={form.title} onChange={e => change('title', e.target.value)} /></Field></div>
        <Field label="内容"><textarea rows={12} maxLength={24000} value={form.body} onChange={e => change('body', e.target.value)} /></Field>
      </fieldset>
      {latest && <Notice tone="neutral">你的输入仍保留，只会保存你主动修改的字段。<details><summary>查看最新规划</summary><h3>{latest.title}</h3><pre className="outline-readable">{latest.body || '尚未填写内容'}</pre></details></Notice>}
      {error && <Notice>{error}{plan && <Button disabled={busy} onClick={() => void readLatest()}>读取最新规划并比较</Button>}</Notice>}
      <div className="modal-actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy || !form.title.trim()}>{busy ? '正在保存…' : '保存'}</Button></div>
    </form>
  </Modal>
}
