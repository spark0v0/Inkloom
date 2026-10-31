import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, FileText, Pause, Play, Stop, ArrowCounterClockwise, PenNib, Sparkle, SlidersHorizontal, User, X } from '@phosphor-icons/react'
import { activeStates, ApiError, api, countChars, dateLabel, downloadText, errorText, jobStateNames, number, uuid } from '../lib/api'
import type { Chapter, Context, ContextInput, Evidence, JobInput, MemoryProposal, Novel, Provider, ReviewRewritePreparation, Roles, Selection, Task, Version } from '../lib/api'
import { Badge, Button, Field, Modal, Notice } from '../components/ui'
import { AttemptHistory, ContextDetails, JobResult } from './JobPresentation'
import { useJobStream } from '../lib/useJobStream'
import { ChapterReferencesDialog } from './ChapterReferencesDialog'
import { QuickEntitiesDialog } from './QuickEntitiesDialog'
import { rewriteActions, rewriteTarget } from '../lib/writing'
import type { SelectionRewrite } from '../lib/writing'
import { deriveBeatsFromOutline } from '../lib/sceneBeats'

export type AssistantProps = {
  novel: Novel; chapter: Chapter; providers: Provider[]; roles: Roles;
  flush: () => Promise<Version>; selection: Selection | null;
  quickRewrite?: SelectionRewrite | null; onQuickPrepared?: (id: string) => void; onWritingStyle: () => void;
  onAdopt: (version: Version, expected: Version) => void; onEvidence: (e: Evidence) => void;
  onExtractReady: (changes: MemoryProposal[], versionId: string) => void;
  onClose?: () => void;
  candidateHost?: HTMLElement | null; onCandidate?: (id: string, show: boolean, label?: string) => void; onShowCandidate?: () => void;
  blockedChapter?: string; onResolvePrevious?: () => void;
}

function roleFor(task: Task): keyof Roles {
  return task === 'plan' || task === 'inspiration' ? 'planner' : task === 'review' ? 'reviewer' : task === 'extract' || task === 'handoff' ? 'extractor' : 'writer'
}

export function Assistant({ novel, chapter, providers, roles, flush, selection, quickRewrite, onQuickPrepared, onWritingStyle, onAdopt, onEvidence, onExtractReady, onClose, candidateHost, onCandidate, onShowCandidate, blockedChapter, onResolvePrevious }: AssistantProps) {
  const cache = useQueryClient()
  const [task, setTask] = useState<Task>('continue')
  const [mode, setMode] = useState<'chapter' | 'continue' | 'rewrite' | 'scene'>('chapter')
  const [tab, setTab] = useState<'assistant' | 'context'>('assistant')
  const [instruction, setInstruction] = useState('')
  const [scene, setScene] = useState<NonNullable<ContextInput['scene']>>({ goal: '', conflict: '', turn: '', ending: '', viewpoint: '' })
  const [problem, setProblem] = useState('不知道接下来发生什么')
  const [selectedDirection, setDirection] = useState<{ reference: NonNullable<ContextInput['inspiration']>; title: string } | null>(null)
  const [preparedRevision, setPreparedRevision] = useState<ReviewRewritePreparation | null>(null)
  const [preparedSelection, setPreparedSelection] = useState<SelectionRewrite | null>(null)
  const preparedQuickId = useRef<string | null>(null)
  const [preparingRevision, setPreparingRevision] = useState(false)
  const [returnRevisionId, setReturnRevisionId] = useState<string | null>(null)
  const [target, setTarget] = useState(novel.chapter_words)
  const [providerId, setProviderId] = useState(roles.writer || 'demo')
  const providerChoices = useRef<Partial<Roles>>({})
  const [context, setContext] = useState<Context | null>(null)
  useEffect(() => { setContext(null) }, [scene])
  const [excluded, setExcluded] = useState<string[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showCompare, setShowCompare] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [entitiesOpen, setEntitiesOpen] = useState(false)
  const [activeBeatIndex, setActiveBeatIndex] = useState<number>(0)
  const [justAdoptedBeat, setJustAdoptedBeat] = useState<number | null>(null)
  const outlineQuery = useQuery({ queryKey: ['chapter-outline', novel.id, chapter.id], queryFn: () => api.chapterOutline(novel.id, chapter.id) })
  const { beats, isFromOutline } = deriveBeatsFromOutline(outlineQuery.data)

  function applyBeat(index: number) {
    const b = beats[index]
    if (!b) return
    setActiveBeatIndex(index)
    setScene(current => ({
      ...current,
      goal: b.goal,
      conflict: b.conflict ?? current.conflict,
      turn: b.turn ?? current.turn,
      ending: b.ending ?? current.ending
    }))
    setTarget(b.suggestedTarget || 800)
    setContext(null)
  }
  const [adopting, setAdopting] = useState(false)
  const [budget, setBudget] = useState('')
  const [maxAttempts, setMaxAttempts] = useState(3)
  const pendingSubmission = useRef<JobInput | null>(null)
  const candidateRef = useRef<HTMLElement | null>(null)
  const provider = providers.find(p => p.id === providerId)
  const jobs = useQuery({ queryKey: ['jobs', novel.id, chapter.id, 'writing-summary'], queryFn: () => api.jobHistory({ novel_id: novel.id, chapter_id: chapter.id, tasks: ['continue', 'rewrite', 'plan', 'inspiration', 'review', 'extract', 'handoff'], limit: 1 }) })
  const currentJobId = jobId || jobs.data?.items[0]?.id
  const job = useQuery({ queryKey: ['job', currentJobId], queryFn: () => api.job(currentJobId!, novel.id), enabled: !!currentJobId })
  const connection = useJobStream(job.data)
  const active = job.data && activeStates.has(job.data.state)
  const hasStyle = !!(novel.style || novel.writing_preferences?.avoid || novel.writing_preferences?.example ||
    (novel.writing_preferences?.viewpoint && novel.writing_preferences.viewpoint !== 'unspecified'))
  useEffect(() => { setJobId(null); setContext(null); setInstruction(''); setDirection(null); setPreparedRevision(null); setReturnRevisionId(null); pendingSubmission.current = null; setError('') }, [chapter.id])
  const restored = useRef<string | null>(null)
  useEffect(() => {
    if (!jobId && job.data && restored.current !== job.data.id) {
      restored.current = job.data.id
      if (job.data.task === 'continue' && job.data.context.scene) {
        setMode('scene'); setTask('continue'); setScene(job.data.context.scene); setProviderId(job.data.provider_id)
        setTarget(job.data.context.target_chars || 800)
      }
      if (job.data.task === 'inspiration') {
        setTask('inspiration'); setProviderId(job.data.provider_id)
        providerChoices.current.planner = job.data.provider_id
      }
      if (job.data.task === 'review') {
        setTask('review'); setProviderId(job.data.provider_id)
        providerChoices.current.reviewer = job.data.provider_id
      }
    }
  }, [jobId, job.data])
  useEffect(() => {
    const result = job.data?.result
    if (job.data?.state === 'succeeded' && result?.kind === 'extract') onExtractReady(result.changes, job.data.base_version_id)
  }, [job.data, onExtractReady])
  function changeTask(next: Task) {
    setTask(next); setContext(null); setError(''); setDirection(null); setPreparedRevision(null); setPreparedSelection(null)
    const role = roleFor(next)
    setProviderId(providerChoices.current[role] || roles[role] || 'demo')
  }
  async function input(): Promise<ContextInput> {
    if (task === 'continue' && mode === 'scene' && !scene.goal.trim()) throw new Error('请填写本场要发生的事情。')
    const version = await flush()
    if (preparedRevision && preparedRevision.base_version_id !== version.id) throw new Error('正文已更新，请重新审稿后准备改写。')
    if (preparedSelection && preparedSelection.base_version_id !== version.id) throw new Error('正文已更新，请重新选择文字后准备改写。')
    const wholeChapter = task === 'continue' && mode === 'chapter'
    const effectiveTask = wholeChapter && version.text.trim() ? 'rewrite' : task
    const effectiveSelection = wholeChapter && version.text.trim() ? { start_codepoint: 0, end_codepoint: Array.from(version.text).length, text: version.text } : task === 'rewrite' ? preparedRevision?.selection || preparedSelection?.selection || selection : null
    const direction = wholeChapter ? `依据本章细纲创作完整一章，目标约 ${target} 字。包含完整场景推进和有意义的章末钩子；只输出正文，不重复章节标题。` : ''
    return { chapter_id: chapter.id, base_version_id: version.id, references_revision: chapter.references_revision, task: effectiveTask, instruction: [direction, task === 'inspiration' ? `当前卡点：${problem}` : '', instruction || (task === 'inspiration' ? '' : chapter.goal || '推进本章剧情，保持视角和人物一致。')].filter(Boolean).join('\n'),
      provider_id: providerId, target_chars: target, chapter_batch: 5, excluded_source_ids: excluded, selection: effectiveSelection,
      scene: task === 'continue' && mode === 'scene' ? scene : null,
      inspiration: selectedDirection?.reference || null, review_reference: preparedRevision?.reference || null }
  }
  const preparing = useMutation({ mutationFn: async () => { const body = await input(); return api.context(novel.id, body) }, onSuccess: value => { setContext(value); setTab('context') } })
  const generating = useMutation({ mutationFn: async () => {
    const body = pendingSubmission.current || { ...await input(), idempotency_key: uuid(), max_attempts: maxAttempts, max_cost: budget ? Number(budget) : null }
    if (!pendingSubmission.current) {
      const { idempotency_key: _key, max_attempts: _attempts, max_cost: _cost, ...contextInput } = body
      const preview = await api.context(novel.id, contextInput)
      setContext(preview)
    }
    pendingSubmission.current = body
    try {
      const created = await api.createJob(novel.id, body)
      pendingSubmission.current = null
      return created
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) pendingSubmission.current = null
      throw error
    }
  }, onSuccess: value => { setJobId(value.id); setTab('assistant'); setDirection(null); setPreparedRevision(null); setPreparedSelection(null); setReturnRevisionId(null); cache.setQueryData(['job', value.id], value); void cache.invalidateQueries({ queryKey: ['jobs'] }); setError('') } })
  const submissionLocked = generating.isPending || !!pendingSubmission.current || preparingRevision
  useEffect(() => {
    if (!quickRewrite || preparedQuickId.current === quickRewrite.id) return
    preparedQuickId.current = quickRewrite.id
    if (submissionLocked || active) setError('请先处理当前提交或生成任务，再准备选段改写。')
    else {
      changeTask('rewrite'); setMode('rewrite'); setTab('assistant')
      setPreparedSelection(quickRewrite); setInstruction(rewriteActions[quickRewrite.action].instruction); setTarget(rewriteTarget(quickRewrite))
      requestAnimationFrame(() => document.getElementById(`generate-${chapter.id}`)?.focus())
    }
    onQuickPrepared?.(quickRewrite.id)
  }, [quickRewrite, submissionLocked, active, onQuickPrepared, chapter.id])
  async function control(action: string) {
    if (!job.data) return
    try { const value = await api.control(job.data.id, novel.id, action); cache.setQueryData(['job', value.id], value); await cache.invalidateQueries({ queryKey: ['jobs'] }) }
    catch (e) { setError(errorText(e)) }
  }
  async function adopt() {
    if (!job.data || adopting) return
    setAdopting(true)
    try {
      const version = await flush()
      const adopted = await api.adopt(job.data.id, novel.id, version.id)
      onAdopt(adopted, version); setShowCompare(false); setError('')
      if (mode === 'scene') setJustAdoptedBeat(activeBeatIndex)
      await cache.invalidateQueries({ queryKey: ['job', job.data.id] }); await cache.invalidateQueries({ queryKey: ['chapters', novel.id] }); await cache.invalidateQueries({ queryKey: ['novel', novel.id] })
    } catch (e) { setError(errorText(e)) } finally { setAdopting(false) }
  }
  async function chooseDirection(index: number) {
    if (job.data?.result?.kind !== 'inspiration') return
    try {
      const version = await flush()
      if (version.id !== job.data.base_version_id || job.data.context.settings_revision !== novel.settings_revision || job.data.context.canon_revision !== novel.canon_revision || (job.data.context.references_revision || 0) !== chapter.references_revision) {
        setError('正文或参考已变化，请重新找灵感后选择方向。'); return
      }
      const title = job.data.result.options[index].title
      changeTask('continue'); setMode('continue'); setInstruction('')
      setDirection({ reference: { job_id: job.data.id, option_index: index }, title })
      requestAnimationFrame(() => document.getElementById(`generate-${chapter.id}`)?.focus())
    } catch (e) { setError(errorText(e)) }
  }
  async function prepareRevision(index: number, note: string) {
    if (job.data?.result?.kind !== 'review') return
    const source = job.data
    const finding = job.data.result.findings[index]
    setPreparingRevision(true)
    try {
      const version = await flush()
      if (note !== finding.decision_note) {
        const updated = await api.decide(source.id, novel.id, { index, decision: finding.decision, note,
          base_decision: finding.decision, base_note: finding.decision_note })
        cache.setQueryData(['job', source.id], updated)
      }
      const prepared = await api.prepareReviewRewrite(source.id, novel.id, { index, base_version_id: version.id })
      changeTask('rewrite'); setMode('rewrite'); setInstruction(''); setTarget(prepared.suggested_target_chars)
      setPreparedRevision(prepared)
      requestAnimationFrame(() => document.getElementById(`generate-${chapter.id}`)?.focus())
    } catch (e) {
      void cache.invalidateQueries({ queryKey: ['job', source.id] })
      throw e
    } finally { setPreparingRevision(false) }
  }
  const baselineChanged = !!job.data && (job.data.candidate_status === 'needs_rebase' || job.data.base_version_id !== chapter.working_version_id || job.data.context.settings_revision !== novel.settings_revision || job.data.context.canon_revision !== novel.canon_revision || (job.data.context.references_revision || 0) !== chapter.references_revision)
  const canAdopt = job.data && ['continue', 'rewrite'].includes(job.data.task) && job.data.state === 'succeeded' && job.data.candidate_status === 'ready'
  const inDocument = !!candidateHost && !!job.data && ['continue', 'rewrite', 'inspiration', 'review'].includes(job.data.task)
  useEffect(() => {
    if (inDocument || !job.data || !['queued', 'succeeded', 'failed', 'cancelled', 'interrupted_uncertain'].includes(job.data.state)) return
    if (document.activeElement?.matches('input, textarea, select')) return
    const frame = requestAnimationFrame(() => candidateRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [inDocument, job.data?.id, job.data?.state])
  const notified = useRef<string | null>(null)
  useEffect(() => {
    if (inDocument && job.data && notified.current !== job.data.id) {
      notified.current = job.data.id
      onCandidate?.(job.data.id, job.data.candidate_status !== 'adopted' && job.data.candidate_status !== 'rejected', job.data.task === 'inspiration' ? '剧情灵感' : job.data.task === 'review' ? '审稿意见' : 'AI 草稿')
    }
  }, [inDocument, job.data, onCandidate])
  const candidate = <section ref={candidateRef} className="assistant-section candidate-area">{job.data ? <><div className="section-heading"><h4>{job.data.task === 'review' ? '本次审稿' : '本次生成'}</h4><Badge tone={job.data.is_demo ? 'amber' : 'neutral'}>{job.data.is_demo ? '演示 · ' : ''}{job.data.candidate_status === 'adopted' ? '已采纳' : job.data.task === 'review' && job.data.state === 'succeeded' ? '审稿完成' : jobStateNames[job.data.state]}</Badge></div>
        {active && <div className="button-row"><span className="small muted" role="status">{connection || '正在生成…'}</span><Button variant="ghost" onClick={() => void control('cancel')}><Stop size={15} />停止</Button><Button variant="ghost" onClick={() => void control('pause')} disabled={job.data.state !== 'running' && job.data.state !== 'queued'}><Pause size={15} />暂停</Button></div>}
        {job.data.state === 'paused' && <Button onClick={() => void control('resume')}><Play size={15} />继续生成</Button>}
        {['failed', 'interrupted_uncertain'].includes(job.data.state) && <><Notice>{job.data.error_message || '生成未完成。'}{job.data.state === 'interrupted_uncertain' && <span className="block">请求可能已计费，核实后再重试。</span>}</Notice><Button onClick={() => void control('retry')} disabled={job.data.attempt_count >= job.data.max_attempts}><ArrowCounterClockwise size={16} />确认并重试</Button></>}
        {job.data.output_text && <JobResult job={job.data} onEvidence={onEvidence} onChoose={index => void chooseDirection(index)} onPrepareRewrite={prepareRevision} stale={baselineChanged} disabled={!!active || submissionLocked} />}
        {job.data.candidate_status === 'needs_rebase' && <Notice>原稿或参考已变化，请核对后重新生成。</Notice>}
        {error && <Notice>{error}</Notice>}{canAdopt && <div className="candidate-actions"><Button variant="primary" disabled={adopting} onClick={() => void adopt()}><Check size={17} />采纳正文</Button><Button onClick={() => setShowCompare(true)}>对比原稿</Button><Button variant="ghost" onClick={() => void control('reject')}>放弃</Button></div>}
        {job.data.context.inspiration_reference && <Button variant="ghost" disabled={!!active || submissionLocked} onClick={() => { const source = job.data?.context.inspiration_reference; if (source) { changeTask('inspiration'); setJobId(source.job_id) } }}>重新选择剧情方向<ArrowRight size={16} /></Button>}
        {job.data.context.review_reference && <Button variant="ghost" disabled={!!active || submissionLocked} onClick={() => { const source = job.data?.context.review_reference; if (source) { setReturnRevisionId(job.data!.id); changeTask('review'); setJobId(source.job_id) } }}>返回审稿意见<ArrowRight size={16} /></Button>}
        {job.data.task === 'review' && returnRevisionId && <Button variant="ghost" disabled={!!active || submissionLocked} onClick={() => { const id = returnRevisionId; changeTask('rewrite'); setJobId(id); setReturnRevisionId(null) }}>返回修稿候选<ArrowRight size={16} /></Button>}
        {['continue', 'rewrite'].includes(job.data.task) && job.data.output_text && <p className="candidate-count">本次 {number(countChars(job.data.output_text))} 字<span>{job.data.context.target_chars == null ? '原任务目标未知' : `目标 ${number(job.data.context.target_chars)} 字`}</span></p>}
        <details className="call-details"><summary>引用资料与调用记录</summary><button className="text-link" onClick={() => { setContext(job.data!.context); setTab('context') }}>查看引用资料<ArrowRight size={15} /></button><p className="small muted">{dateLabel(job.data.created_at)} · 第 {job.data.attempt_count} 次调用 · {job.data.is_demo ? '本地演示，不计费' : job.data.cost == null ? '实际费用未知' : `${job.data.cost.toFixed(4)} ${job.data.context.currency}`}</p><button className="text-link" onClick={() => downloadText(job.data!.output_text, `${chapter.title}-候选.txt`)}>下载本次结果</button><AttemptHistory attempts={job.data.attempts} currency={job.data.context.currency} /></details>
      </> : <div className="candidate-placeholder"><PenNib size={24} weight="light" /><p>生成的正文会显示在这里</p></div>}</section>
  return <aside className="assistant-panel" aria-label="写作助手"><div className="assistant-heading"><strong>AI 写作</strong>{provider?.kind === 'demo' && <Badge tone="amber">演示</Badge>}<select disabled={submissionLocked} aria-label="写作模型" value={providerId} onChange={e => { providerChoices.current[roleFor(task)] = e.target.value; setProviderId(e.target.value); setContext(null) }}>{providers.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>{onClose && <button className="icon-button mobile-only" aria-label="关闭写作助手" onClick={onClose}><X size={18} /></button>}</div>
    <div className="assistant-tabs"><button disabled={submissionLocked} className={!['review', 'inspiration'].includes(task) ? 'active' : ''} onClick={() => { changeTask('continue'); setTab('assistant') }}>写作</button><button disabled={submissionLocked} className={task === 'inspiration' ? 'active' : ''} onClick={() => { changeTask('inspiration'); setTab('assistant') }}>找灵感</button><button disabled={submissionLocked} className={task === 'review' ? 'active' : ''} onClick={() => { changeTask('review'); setTab('assistant') }}>审稿</button></div>
    <div className="assistant-scroll">
      {!['review', 'inspiration'].includes(task) && <div className="writing-mode-tabs"><button disabled={submissionLocked} className={mode === 'chapter' && task === 'continue' ? 'active' : ''} onClick={() => { setMode('chapter'); changeTask('continue') }}>写完整章</button><button disabled={submissionLocked} className={mode === 'continue' && task === 'continue' ? 'active' : ''} onClick={() => { setMode('continue'); changeTask('continue') }}>续写</button><button disabled={submissionLocked} className={mode === 'scene' && task === 'continue' ? 'active' : ''} onClick={() => { setMode('scene'); setTarget(800); changeTask('continue') }}>写一个场景</button><button disabled={submissionLocked} className={task === 'rewrite' ? 'active' : ''} onClick={() => { setMode('rewrite'); changeTask('rewrite') }}>润色选段</button></div>}
      {task === 'continue' && mode === 'scene' && <section className="scene-composer form-stack" aria-label="本场景要求">
        <p className="small muted">每次写一场；审阅采纳后接到当前正文末尾。</p>
        <div className="scene-beat-selector" style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span className="small muted">{isFromOutline ? '本章细纲节拍' : '经典四步节拍'}：</span>
            {isFromOutline && <Badge tone="green">已绑定细纲</Badge>}
          </div>
          <div className="scene-beat-row" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {beats.map((b, i) => (
              <Button
                key={i}
                type="button"
                variant={activeBeatIndex === i ? 'primary' : 'ghost'}
                onClick={() => applyBeat(i)}
                style={{ padding: '3px 8px', fontSize: '12px' }}
              >
                {b.label}
              </Button>
            ))}
          </div>
        </div>
        {justAdoptedBeat !== null && activeBeatIndex < beats.length - 1 && (
          <div className="next-beat-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--green-soft)', borderRadius: '6px' }}>
            <span className="small" style={{ color: 'var(--green-dark)' }}>上一场已采纳！</span>
            <Button
              type="button"
              variant="primary"
              style={{ fontSize: '12px', padding: '3px 8px' }}
              onClick={() => {
                applyBeat(activeBeatIndex + 1)
                setJustAdoptedBeat(null)
              }}
            >
              进入 {beats[activeBeatIndex + 1].label} <ArrowRight size={14} />
            </Button>
          </div>
        )}
        <Field label="本场要发生什么"><textarea rows={2} maxLength={1200} value={scene.goal} onChange={e => { setScene({ ...scene, goal: e.target.value }); setContext(null) }} placeholder="例如：主角与守塔人交涉，争取进入灯塔" /></Field>
        <Field label="阻碍或冲突"><textarea rows={2} maxLength={1200} value={scene.conflict || ''} onChange={e => { setScene({ ...scene, conflict: e.target.value }); setContext(null) }} placeholder="例如：对方要求交出唯一的钥匙" /></Field>
        <details><summary>转折、收束与视角</summary><div className="form-stack">
          <Field label="本场转折"><textarea rows={2} maxLength={1200} value={scene.turn || ''} onChange={e => setScene({ ...scene, turn: e.target.value })} /></Field>
          <Field label="写到哪里停"><textarea rows={2} maxLength={1200} value={scene.ending || ''} onChange={e => setScene({ ...scene, ending: e.target.value })} /></Field>
          <Field label="本场视角"><input maxLength={160} value={scene.viewpoint || ''} onChange={e => setScene({ ...scene, viewpoint: e.target.value })} placeholder="沿用本书视角，可留空" /></Field>
        </div></details>
      </section>}
      <div className="assistant-resources">
      <Button className="writing-style-trigger" variant="ghost" disabled={submissionLocked || !!active} onClick={onWritingStyle}><PenNib size={18} />写作风格<span>{hasStyle ? '本书已设置' : '未限定'}</span></Button>
      <Button className="chapter-references-trigger" variant="ghost" disabled={submissionLocked || !!active} onClick={() => setReferencesOpen(true)}><FileText size={17} />本章参考<span>{(chapter.references.entity_ids?.length || 0) + (chapter.references.chapters?.length || 0) ? `${(chapter.references.entity_ids?.length || 0) + (chapter.references.chapters?.length || 0)} 项必读` : chapter.references.notes?.trim() ? '含补充资料' : '自动召回'}</span></Button>
      <Button className="quick-entities-trigger" variant="ghost" disabled={submissionLocked || !!active} onClick={() => setEntitiesOpen(true)}><User size={17} />速查设定<span>主角/世界档案</span></Button>
      </div>
      {chapter.goal && <details className="assistant-outline"><summary><FileText size={18} /><span>本章细纲</span></summary><p>{chapter.goal}</p></details>}
      <div className="assistant-form"><fieldset className="assistant-inputs" disabled={submissionLocked}>{blockedChapter && <Notice action={<Button onClick={onResolvePrevious}>去处理前章</Button>}>先完成《{blockedChapter}》的定稿，再写后文。</Notice>}{task === 'inspiration' && <Field label="卡在哪里？"><select value={problem} onChange={e => { setProblem(e.target.value); setContext(null) }}>{['不知道接下来发生什么', '知道要发生什么，但过渡生硬', '这段太平，缺少冲突', '人物没有理由行动', '剧情重复，想换一种走法'].map(value => <option key={value}>{value}</option>)}</select></Field>}{selectedDirection && <div className="selected-direction" role="status"><strong>已选：{selectedDirection.title}</strong><p className="small">点击下方按钮生成候选正文。</p><Button variant="ghost" onClick={() => setDirection(null)}>移除方向</Button></div>}<Field label={task === 'review' ? '审稿重点' : task === 'inspiration' ? '补充想法（可选）' : '补充要求'}><textarea aria-label="本次写作要求" rows={3} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder={task === 'inspiration' ? '可留空，让 AI 根据本章给出三个不同走法' : task === 'review' ? '例如：检查人物动机、前后矛盾、重复和节奏' : '例如：加快节奏，让章末留下悬念'} maxLength={12000} /></Field>
        {preparedRevision && <section className="prepared-revision" aria-label="准备改写的段落"><div className="section-heading"><strong role="status">已准备段落改写</strong><Button variant="ghost" onClick={() => changeTask('review')}>取消修稿</Button></div><blockquote tabIndex={0}>{preparedRevision.selection.text}</blockquote><p className="small">{preparedRevision.finding.suggestion}</p></section>}
        {preparedSelection && <section className="prepared-selection" aria-label="准备改写的选段"><div className="section-heading"><strong role="status">已准备{rewriteActions[preparedSelection.action].name}</strong><Button variant="ghost" onClick={() => { changeTask('continue'); setMode('continue') }}>取消选段操作</Button></div><blockquote tabIndex={0}>{preparedSelection.selection.text}</blockquote><p className="small muted">检查原文和要求，点击生成后才调用模型。</p></section>}
        {task === 'rewrite' && !preparedRevision && !preparedSelection && <p className="selection-hint">{selection ? `已选 ${number(Array.from(selection.text).length)} 字符` : '先在正文中选择需要润色的文字。'}</p>}
        <div className="writing-options"><label hidden={task === 'inspiration'}><span className="sr-only">目标字数</span><select aria-label="目标字数" value={target} onChange={e => setTarget(Number(e.target.value))}>{Array.from(new Set([target, 100, 300, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000])).sort((a, b) => a - b).map(n => <option key={n} value={n}>{number(n)} 字</option>)}</select></label><details className="generation-limits"><summary><SlidersHorizontal size={17} />高级</summary><div className="form-stack"><Field label="其他任务"><select aria-label="更多写作任务" value={['plan', 'extract', 'handoff'].includes(task) ? task : ''} onChange={e => e.target.value && changeTask(e.target.value as Task)}><option value="">选择任务</option><option value="plan">场景规划</option><option value="extract">整理本章记忆</option><option value="handoff">章节交接</option></select></Field><Field label="最多调用次数"><select value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n} 次</option>)}</select></Field><Field label={`费用上限（${provider?.currency || 'CNY'}）`}><input type="number" min="0.0001" max="10000" step="any" value={budget} onChange={e => setBudget(e.target.value)} placeholder="可选，需要配置价格" /></Field></div></details></div>
        {provider?.kind !== 'demo' && !provider?.has_key && <Notice>请先在模型设置中填写 API Key。</Notice>}
        {provider?.kind !== 'demo' && provider && ['continue', 'rewrite'].includes(task) && provider.max_output_tokens < target * 1.6 && <p className="model-disclosure">模型输出上限偏小，整章可能截断。可在模型设置中调大。</p>}
        </fieldset><Button id={`generate-${chapter.id}`} variant="primary" className="full-width" disabled={!!active || generating.isPending || preparingRevision || (!pendingSubmission.current && task === 'continue' && mode === 'scene' && !scene.goal.trim()) || (!!blockedChapter && ['continue', 'rewrite'].includes(task)) || !provider || (provider.kind !== 'demo' && !provider.has_key) || (task === 'rewrite' && !selection && !preparedRevision && !preparedSelection)} onClick={() => generating.mutate()}><Sparkle size={19} />{generating.isPending ? '正在提交…' : pendingSubmission.current ? '确认上次提交' : preparedRevision ? '按建议改写' : preparedSelection ? `生成${rewriteActions[preparedSelection.action].name}候选` : task === 'inspiration' ? '找三个走向' : selectedDirection ? '按此方向续写' : task === 'extract' ? '整理本章记忆' : task === 'review' ? '审阅本章' : task === 'plan' ? '生成场景计划' : task === 'handoff' ? '生成章节交接' : task === 'rewrite' ? '润色选段' : mode === 'chapter' ? (chapter.char_count ? '重写本章正文' : '生成本章正文') : mode === 'scene' ? '生成场景草稿' : '继续写作'}</Button>
      </div>
      {(error || generating.error || preparing.error) && <Notice>{error || errorText(generating.error ?? preparing.error)}{pendingSubmission.current && <span className="block small">上次提交尚未确认，暂时锁定写作要求。点击“确认上次提交”继续处理同一次请求。</span>}</Notice>}
      {inDocument ? <div className="candidate-summary"><Badge>{job.data?.candidate_status === 'adopted' ? '已采纳' : job.data ? jobStateNames[job.data.state] : ''}</Badge><Button onClick={onShowCandidate}>{job.data?.task === 'inspiration' ? '查看剧情灵感' : job.data?.task === 'review' ? '查看审稿意见' : '查看 AI 草稿'}<ArrowRight size={16} /></Button><p className="small muted">{job.data?.task === 'inspiration' ? (job.data.result?.kind === 'inspiration' ? '三个剧情方向' : active ? '正在寻找剧情方向' : '剧情方向未完成') : job.data?.task === 'review' ? (job.data.result?.kind === 'review' ? `${job.data.result.findings.length} 条审稿意见` : '正在整理审稿意见') : `${number(countChars(job.data?.output_text || ''))} 字`} · {job.data?.is_demo ? '演示样例' : job.data?.context.model}</p></div> : candidate}
      {inDocument && createPortal(candidate, candidateHost!)}
      <button className="text-link context-trigger" onClick={() => preparing.mutate()} disabled={preparing.isPending}>查看将引用的资料<ArrowRight size={15} /></button>
    </div><footer className="assistant-footer">{provider?.kind === 'demo' ? '演示模式 · 固定样例' : `发送至 ${provider?.name || '所选模型服务'}`}</footer>
    {referencesOpen && <ChapterReferencesDialog novelId={novel.id} chapter={chapter} onClose={() => setReferencesOpen(false)} onSaved={() => { setReferencesOpen(false); setContext(null); setExcluded([]); setDirection(null); setPreparedRevision(null); setError('') }} />}
    {entitiesOpen && <QuickEntitiesDialog novelId={novel.id} chapter={chapter} onClose={() => setEntitiesOpen(false)} onReferencesChanged={() => { void cache.invalidateQueries({ queryKey: ['chapters', novel.id] }); setContext(null) }} />}
    <Modal open={tab === 'context'} onOpenChange={value => !value && setTab('assistant')} title="本次引用资料" wide>{context && <ContextDetails context={context} onEvidence={onEvidence} excluded={excluded} onToggle={id => setExcluded(previous => previous.includes(id) ? previous.filter(x => x !== id) : [...previous, id])} />}</Modal>
    <Modal open={showCompare} onOpenChange={setShowCompare} title="对比原稿" wide className="candidate-modal"><div className="comparison"><div><h4>当前原稿</h4><div className="comparison-text">{chapter.version.text || '空白'}</div></div><div><h4>{job.data?.task === 'rewrite' ? '替换内容' : '新增内容'}</h4><div className="comparison-text comparison-new">{job.data?.output_text}</div></div></div>{job.data && job.data.base_version_id !== chapter.working_version_id && <Notice>原稿已更新，请核对后重新生成。</Notice>}{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={() => setShowCompare(false)}>返回</Button><Button variant="primary" disabled={adopting} onClick={() => void adopt()}>采纳正文</Button></div></Modal>
  </aside>
}
