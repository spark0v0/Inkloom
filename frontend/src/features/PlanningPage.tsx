import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, CaretRight, Check, CheckCircle, FileText, PencilSimple, Plus, Sparkle, Stop } from '@phosphor-icons/react'
import { activeStates, api, ApiError, errorText, jobStateNames, number, uuid } from '../lib/api'
import type { Blueprint, ChapterSummary, JobInput, Novel, Plan, PlanInput, Provider } from '../lib/api'
import type { Navigate } from '../lib/route'
import { nextWritingChapter } from '../lib/workflow'
import { Badge, Button, Empty, Field, Loading, Modal, Notice } from '../components/ui'
import { useJobStream } from '../lib/useJobStream'
import { BlueprintView, OutlineView } from './ProductionResults'

const labels = { book: '全书', volume: '分卷', chapter: '章节', scene: '场景' }

export function PlanningPage({ novel, navigate }: { novel: Novel; navigate: Navigate }) {
  const cache = useQueryClient()
  const plans = useQuery({ queryKey: ['plans', novel.id], queryFn: () => api.plans(novel.id) })
  const chapters = useQuery({ queryKey: ['chapters', novel.id], queryFn: () => api.chapters(novel.id) })
  const jobs = useQuery({ queryKey: ['jobs', novel.id], queryFn: () => api.jobs(novel.id), refetchInterval: 3000 })
  const [tab, setTab] = useState<'book' | 'volumes'>('volumes')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const [brief, setBrief] = useState(false)
  const [generation, setGeneration] = useState<'blueprint' | 'outline' | null>(null)
  const [form, setForm] = useState({ title: novel.title, genre: novel.genre, premise: novel.premise, style: novel.style, platform: novel.platform, target_words: novel.target_words, chapter_words: novel.chapter_words })
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
  const volume = volumes.find(p => p.id === selected) || volumes[0]
  const list = (chapters.data || []).filter(c => volume ? c.volume === volume.title : true)
  const setupKind = generation || (!book && !volumes.length ? 'blueprint' : null)
  const resumable = jobs.data?.find(j => ['blueprint', 'outline'].includes(j.task) && (activeStates.has(j.state) || j.state === 'paused' || j.candidate_status === 'ready'))
  async function saveBrief() {
    setBusy(true)
    try { await api.editNovel(novel.id, form); await refresh(); setBrief(false) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function refresh() {
    await Promise.all(['novel', 'chapters', 'plans', 'entities', 'jobs'].map(key => cache.invalidateQueries({ queryKey: [key, novel.id] })))
    await cache.invalidateQueries({ queryKey: ['novels'] })
  }
  async function addChapter() {
    setBusy(true)
    try { const next = await api.createChapter(novel.id, { title: `第${(chapters.data?.length || 0) + 1}章`, volume: volume?.title || '第一卷', goal: '' }); await refresh(); await navigate({ page: 'write', novelId: novel.id, chapterId: next.id }) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function resume() {
    if (!resumable) return
    try {
      const detail = await api.job(resumable.id, novel.id)
      const planId = detail.context.plans.find(p => p.level === 'volume')?.id
      if (typeof planId === 'string') setSelected(planId)
      setResumeId(detail.id)
      setGeneration(detail.task as 'blueprint' | 'outline')
    } catch (e) { setError(errorText(e)) }
  }
  function startWriting() {
    const target = chapters.data?.find(c => appliedChapters.includes(c.id)) || nextWritingChapter(chapters.data || [])
    if (target) void navigate({ page: 'write', novelId: novel.id, chapterId: target.id }).catch(e => setError(errorText(e)))
    else { setTab('volumes'); setGeneration(volume ? 'outline' : null) }
  }
  const production = setupKind && <ProductionPanel key={`${setupKind}:${setupKind === 'outline' ? volume?.id : ''}:${resumeId || ''}`} novel={novel} kind={setupKind} volume={volume} resumeId={resumeId} onSettings={() => void navigate({ page: 'settings' })} onClose={() => { setGeneration(null); setResumeId(null) }} onApplied={async ids => {
    await refresh(); setTab('volumes'); setResumeId(null)
    if (setupKind === 'blueprint') setGeneration('outline')
    else { setAppliedChapters(ids); setGeneration(null) }
  }} />
  return <div className="page-scroll"><div className="serial-studio">
    <header className="book-heading"><div className="studio-book-cover" aria-hidden="true"><BookOpen size={28} weight="light" /><span>{novel.title}</span></div><div className="book-heading-main"><div className="book-category">{novel.genre || '题材待定'}<span>/</span>{novel.platform || '自由创作'}{novel.is_demo && <Badge tone="amber">示例</Badge>}</div><h1>{novel.title}</h1><p>{novel.premise || '写下一句故事想法，让 AI 帮你展开。'}</p><div className="book-targets"><span>计划 {number(novel.target_words / 10000)} 万字</span><span>每章 {number(novel.chapter_words)} 字</span><span>{novel.accepted_count} 章已定稿</span></div></div><Button onClick={() => { setForm({ title: novel.title, genre: novel.genre, premise: novel.premise, style: novel.style, platform: novel.platform, target_words: novel.target_words, chapter_words: novel.chapter_words }); setBrief(true) }}><PencilSimple size={17} />编辑作品</Button></header>
    <nav className="creation-steps" aria-label="创作步骤">
      <button className={book ? 'done' : 'current'} aria-current={!book ? 'step' : undefined} onClick={() => { setTab('book'); setGeneration(book ? null : 'blueprint') }}><span>{book ? <Check size={16} /> : '1'}</span>全书方案</button><i />
      <button className={book && !chapters.data?.some(c => c.goal) ? 'current' : ''} disabled={!book && !volumes.length} onClick={() => { setTab('volumes'); setGeneration(null) }}><span>2</span>章节细纲</button><i />
      <button onClick={startWriting} disabled={!chapters.data?.length}><span>3</span>开始写作</button>
    </nav>
    {resumable && !setupKind && <div className="production-resume"><Sparkle size={18} /><span>{resumable.task === 'blueprint' ? '全书方案' : '章节细纲'} · {jobStateNames[resumable.state]}</span><Button variant="ghost" onClick={() => void resume()}>查看进度<ArrowRight size={16} /></Button></div>}
    {error && <Notice>{error}</Notice>}
    {!setupKind && appliedChapters.length > 0 && <div className="setup-ready" role="status" ref={readyRef} tabIndex={-1}><CheckCircle size={22} /><span>已建立 {appliedChapters.length} 章细纲</span><Button variant="primary" onClick={startWriting}>开始写作<ArrowRight size={17} /></Button></div>}
    {!setupKind && <div className="studio-tabs"><button className={tab === 'book' ? 'active' : ''} onClick={() => setTab('book')}>全书设定</button><button className={tab === 'volumes' ? 'active' : ''} onClick={() => setTab('volumes')}>分卷大纲<span>{volumes.length}</span></button><Button variant="ghost" onClick={() => setEditing('new')}><Plus size={16} />手动添加</Button></div>}
    {plans.isPending || chapters.isPending ? <Loading /> : plans.error || chapters.error ? <Notice>{errorText(plans.error || chapters.error)}</Notice> : setupKind ? <>{production}{!book && <div className="setup-alternative"><button className="text-link" onClick={() => setEditing('new')}>手动添加大纲</button><button className="text-link" onClick={() => { if (chapters.data?.length) startWriting(); else void addChapter() }}>直接开始写作<ArrowRight size={16} /></button></div>}</> : tab === 'book' ? <section className="book-blueprint">{blueprint ? <BlueprintView value={blueprint} /> : <><h2>{book?.title || '作品方向'}</h2><p className="preserve-lines">{book?.body || novel.premise}</p></>}<div className="button-row"><Button onClick={() => book && setEditing(book)}><PencilSimple size={16} />编辑大纲</Button><Button variant="primary" onClick={() => setTab('volumes')}>规划分卷章节<ArrowRight size={16} /></Button></div></section> : <div className="volume-workspace"><aside className="volume-list"><div className="section-heading"><h2>分卷 <span>{volumes.length}</span></h2><button className="icon-button" aria-label="添加分卷" onClick={() => setEditing('new')}><Plus size={18} /></button></div>{volumes.map(v => <button key={v.id} className={`volume-option ${v.id === volume?.id ? 'active' : ''}`} onClick={() => setSelected(v.id)}><strong>{v.title}</strong><p>{v.body.split('\n')[0]}</p><small>{typeof v.structure?.planned_chapters === 'number' ? `计划 ${v.structure?.planned_chapters} 章` : `${chapters.data?.filter(c => c.volume === v.title).length || 0} 章`}</small></button>)}{!volumes.length && <p className="muted">先添加一个分卷。</p>}<Button variant="ghost" onClick={() => setEditing('new')}><Plus size={17} />添加分卷</Button></aside><section className="volume-chapters"><div className="volume-detail-heading"><div><h2>{volume?.title || '章节'}</h2><p>{volume?.body.split('\n')[0]}</p></div><div className="button-row">{volume && <button className="icon-button" aria-label="编辑分卷" onClick={() => setEditing(volume)}><PencilSimple size={18} /></button>}<Button variant="primary" disabled={!volume} onClick={() => setGeneration('outline')}><Sparkle size={18} />AI 规划后续章节</Button></div></div>{list.length ? <div className="chapter-table"><div className="chapter-table-head"><span>章节</span><span>本章剧情</span><span>状态</span><span /></div>{list.map(c => <ChapterRow key={c.id} chapter={c} onOpen={() => void navigate({ page: 'write', novelId: novel.id, chapterId: c.id })} />)}</div> : <Empty icon={<FileText size={30} />} title="这一卷还没有章节" action={<Button onClick={() => setGeneration('outline')} disabled={!volume}>AI 拆分章节<ArrowRight size={17} /></Button>}>每次规划一批，边写边调整。</Empty>}<div className="volume-footer"><button className="text-link" onClick={() => void addChapter()} disabled={busy}><Plus size={18} />手动添加章节</button>{volume && <span className="muted small">{list.length} 章 · {list.filter(c => c.review_state === 'confirmed').length} 章定稿</span>}</div></section></div>}
    {allPlans.some(p => p.level === 'scene' || (p.level === 'chapter' && !p.structure?.chapter_id)) && <details className="legacy-plans"><summary>其他规划</summary>{allPlans.filter(p => p.level === 'scene' || (p.level === 'chapter' && !p.structure?.chapter_id)).map(p => <button key={p.id} className="legacy-plan" onClick={() => setEditing(p)}><Badge>{labels[p.level]}</Badge>{p.title}<CaretRight size={16} /></button>)}</details>}

    {editing && <PlanDialog novelId={novel.id} plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    <Modal open={brief} onOpenChange={setBrief} title="编辑作品" wide><form className="form-stack" onSubmit={e => { e.preventDefault(); void saveBrief() }}><div className="form-row"><Field label="作品名"><input required maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field><Field label="题材"><input maxLength={80} value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value })} /></Field></div><div className="form-row"><Field label="目标平台"><select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}><option>番茄小说</option><option>起点中文网</option><option>自由创作</option></select></Field><Field label="目标字数"><input type="number" required min={10000} max={10000000} step={10000} value={form.target_words} onChange={e => setForm({ ...form, target_words: Number(e.target.value) })} /></Field></div><Field label="每章字数"><select value={form.chapter_words} onChange={e => setForm({ ...form, chapter_words: Number(e.target.value) })}>{[1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000].map(n => <option value={n} key={n}>{number(n)} 字</option>)}</select></Field><Field label="故事想法"><textarea rows={4} maxLength={12000} value={form.premise} onChange={e => setForm({ ...form, premise: e.target.value })} /></Field><Field label="文风偏好"><textarea rows={3} maxLength={8000} value={form.style} onChange={e => setForm({ ...form, style: e.target.value })} /></Field>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={() => setBrief(false)}>取消</Button><Button type="submit" variant="primary" disabled={busy}>保存</Button></div></form></Modal>
  </div></div>
}

function ChapterRow({ chapter, onOpen }: { chapter: ChapterSummary; onOpen: () => void }) {
  return <button className="chapter-table-row" onClick={onOpen}><strong>{chapter.title}</strong><p>{chapter.goal.split('\n')[0] || '尚未填写细纲'}</p><span className={`chapter-row-state ${chapter.review_state === 'confirmed' ? 'complete' : ''}`}>{chapter.review_state === 'confirmed' ? <CheckCircle size={17} weight="fill" /> : <FileText size={17} />}{chapter.review_state === 'confirmed' ? '已定稿' : chapter.review_state === 'needs_review' ? '待复核' : chapter.char_count ? '草稿' : '待创作'}</span><CaretRight size={17} /></button>
}

function ProductionPanel({ novel, kind, volume, resumeId, onSettings, onClose, onApplied }: { novel: Novel; kind: 'blueprint' | 'outline'; volume?: Plan; resumeId: string | null; onSettings: () => void; onClose: () => void; onApplied: (ids: string[]) => Promise<void> }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.scrollIntoView({ block: 'nearest' }); headingRef.current?.focus({ preventScroll: true }) }, [])
  const cache = useQueryClient()
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles })
  const jobs = useQuery({ queryKey: ['jobs', novel.id], queryFn: () => api.jobs(novel.id) })
  const [chosen, setChosen] = useState('')
  const preferred = providers.data?.find(p => p.id === roles.data?.planner) || providers.data?.find(p => p.kind !== 'demo' && p.has_key)
  const providerId = chosen || preferred?.id || 'demo'
  const provider = providers.data?.find(p => p.id === providerId)
  const [instruction, setInstruction] = useState('')
  const [batch, setBatch] = useState(5)
  const [jobId, setJobId] = useState<string | null>(null)
  const existing = jobs.data?.find(j => j.task === kind && j.candidate_status !== 'adopted' && j.candidate_status !== 'rejected' && (kind === 'blueprint' || !j.result || (j.result.kind === 'outline' && j.result.volume_title === volume?.title)))
  const id = jobId || resumeId || existing?.id
  const job = useQuery({ queryKey: ['job', id], queryFn: () => api.job(id!, novel.id), enabled: !!id, refetchInterval: q => q.state.data && activeStates.has(q.state.data.state) ? 600 : false })
  useJobStream(job.data)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<JobInput | null>(null)
  const active = !!job.data && activeStates.has(job.data.state)
  async function generate() {
    setBusy(true); setError('')
    try {
      if (!pending.current) {
        const chapters = await api.chapters(novel.id)
        const anchor = chapters[0] || await api.createChapter(novel.id, { title: '第1章', volume: '第一卷', goal: '' })
        const contextInput = { chapter_id: anchor.id, base_version_id: anchor.working_version_id, task: kind, provider_id: providerId, instruction, chapter_batch: batch, volume_plan_id: kind === 'outline' ? volume?.id : null, target_chars: novel.chapter_words }
        await api.context(novel.id, contextInput)
        pending.current = { ...contextInput, idempotency_key: uuid(), max_attempts: 3 }
      }
      const created = await api.createJob(novel.id, pending.current)
      pending.current = null; setJobId(created.id); cache.setQueryData(['job', created.id], created)
      await cache.invalidateQueries({ queryKey: ['jobs', novel.id] })
    } catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.current = null; setError(errorText(e)) } finally { setBusy(false) }
  }
  async function control(action: string) {
    if (!job.data) return
    try { const result = await api.control(job.data.id, novel.id, action); cache.setQueryData(['job', result.id], result) } catch (e) { setError(errorText(e)) }
  }
  async function apply() {
    if (!job.data) return
    setBusy(true)
    try { const result = await api.applyPlan(job.data.id, novel.id); await onApplied(result.chapter_ids) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  const ready = job.data?.state === 'succeeded' && job.data.candidate_status === 'ready'
  return <section className="production-inline" aria-label={kind === 'blueprint' ? 'AI 全书方案' : 'AI 章节细纲'}><header className="production-title"><div><h2 ref={headingRef} tabIndex={-1}>{kind === 'blueprint' ? '全书方案' : '规划章节细纲'}</h2><p>{kind === 'blueprint' ? '根据故事想法生成大纲、人物与分卷。' : volume?.title}</p></div>{kind === 'outline' && <Button onClick={onClose}>返回大纲</Button>}</header><details className="production-controls" open={!job.data || (!active && !job.data.result)}><summary>模型与生成要求</summary><div className="form-row"><Field label="创作模型"><select value={providerId} onChange={e => setChosen(e.target.value)} disabled={active}>{providers.data?.map(p => <option key={p.id} value={p.id}>{p.kind === 'demo' ? '演示模型（固定样例）' : `${p.name} · ${p.model}`}</option>)}</select></Field>{kind === 'outline' && <Field label="本次规划"><select value={batch} onChange={e => setBatch(Number(e.target.value))} disabled={active}>{[3, 5, 10, 15, 20].map(n => <option key={n} value={n}>{n} 章</option>)}</select></Field>}</div><Field label="补充要求"><textarea rows={2} maxLength={12000} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder={kind === 'blueprint' ? '例如：主角不靠系统，侧重悬疑推理，感情线克制' : '例如：这几章加快节奏，让主角付出一次代价'} disabled={active} /></Field><ProviderDisclosure provider={provider} />{(provider?.kind === 'demo' || !provider?.has_key) && <button className="text-link" onClick={onSettings}>连接自己的模型<ArrowRight size={15} /></button>}<Button variant="primary" onClick={() => void generate()} disabled={busy || active || !provider || (provider.kind !== 'demo' && !provider.has_key)}><Sparkle size={18} />{busy ? '正在提交…' : job.data ? '按新要求重新生成' : kind === 'blueprint' ? 'AI 生成全书方案' : `生成 ${batch} 章细纲`}</Button></details>{error && <Notice>{error}</Notice>}{job.data && <section className="production-result"><div className="section-heading"><h3>{job.data.result ? '预览方案' : '生成进度'}</h3><Badge tone={job.data.is_demo ? 'amber' : 'neutral'}>{job.data.is_demo ? '演示样例 · ' : ''}{jobStateNames[job.data.state]}</Badge>{active && <Button variant="ghost" onClick={() => void control('cancel')}><Stop size={16} />停止生成</Button>}</div>{job.data.error_message && <Notice>{job.data.error_message}</Notice>}{['failed', 'interrupted_uncertain'].includes(job.data.state) && <Button onClick={() => void control('retry')} disabled={job.data.attempt_count >= job.data.max_attempts}>{job.data.state === 'interrupted_uncertain' ? '已核实费用，重试' : '重试本次生成'}</Button>}{job.data.state === 'paused' && <Button onClick={() => void control('resume')}>继续</Button>}{job.data.result?.kind === 'blueprint' ? <BlueprintView value={job.data.result} /> : job.data.result?.kind === 'outline' ? <OutlineView value={job.data.result} /> : active ? <Loading label={`正在构思${kind === 'blueprint' ? '全书方案' : '章节细纲'}，已接收 ${number(job.data.output_text.length)} 字符…`} /> : job.data.output_text && <details><summary>查看未完成响应</summary><pre className="partial-output">{job.data.output_text}</pre></details>}{job.data.candidate_status === 'needs_rebase' && <Notice>作品或目录已更新，请重新生成。</Notice>}</section>}<div className="modal-actions sticky-modal-actions"><span className="small muted">{active ? '离开页面后仍可继续查看进度' : ready ? '采纳后保存到本书，可继续修改' : '生成结果保留在本页'}</span>{ready && <Button variant="primary" onClick={() => void apply()} disabled={busy}><Check size={18} />{kind === 'blueprint' ? '采纳方案，规划章节' : `采纳这 ${job.data?.result?.kind === 'outline' ? job.data.result.chapters.length : batch} 章`}</Button>}</div></section>
}

export function ProviderDisclosure({ provider }: { provider?: Provider }) {
  return <p className={`model-disclosure ${provider?.kind === 'demo' ? 'is-demo' : ''}`}>{provider?.kind === 'demo' ? '演示模式：使用固定样例，不调用真实模型。' : !provider?.has_key ? '先在模型设置中填写 API Key。' : `发送至 ${provider.name} · ${provider.model}。${provider.input_price == null ? '费用未知。' : '按配置价格估算费用。'}`}</p>
}

function PlanDialog({ novelId, plan, onClose }: { novelId: string; plan: Plan | null; onClose: () => void }) {
  const cache = useQueryClient()
  const [form, setForm] = useState<PlanInput>({ title: plan?.title || '', level: plan?.level || 'volume', body: plan?.body || '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await api.savePlan(novelId, form, plan?.id); await Promise.all(['plans', 'novel', 'chapters', 'chapter'].map(key => cache.invalidateQueries({ queryKey: [key, novelId] }))); onClose() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title={plan ? '编辑规划' : '添加规划'} wide><form className="form-stack" onSubmit={e => { e.preventDefault(); void save() }}><div className="form-row"><Field label="层级"><select value={form.level} disabled={!!plan} onChange={e => setForm({ ...form, level: e.target.value as PlanInput['level'] })}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="标题"><input required maxLength={240} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field></div><Field label="内容"><textarea rows={12} maxLength={24000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></Field>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy || !form.title.trim()}>保存</Button></div></form></Modal>
}
