import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, FileText, Pause, Play, Stop, ArrowCounterClockwise, PenNib, Sparkle, SlidersHorizontal, X, ClipboardText } from '@phosphor-icons/react'
import { activeStates, ApiError, api, countChars, dateLabel, downloadText, errorText, jobStateNames, number, uuid } from '../lib/api'
import type { Chapter, Context, ContextInput, Evidence, JobDetail, JobInput, MemoryProposal, Novel, Provider, Roles, Selection, Task, Version } from '../lib/api'
import { Badge, Button, Field, Modal, Notice } from '../components/ui'

export function SourceButton({ evidence, onEvidence, label }: { evidence: Evidence; onEvidence: (e: Evidence) => void; label?: string }) {
  return <button className="source-button" onClick={() => onEvidence(evidence)}><FileText size={16} /><span>{label || evidence.chapter_title || '查看原文'}</span><ArrowRight size={14} /></button>
}

export function JobResult({ job, onEvidence }: { job: JobDetail; onEvidence: (e: Evidence) => void }) {
  const cache = useQueryClient()
  const [message, setMessage] = useState('')
  const [notes, setNotes] = useState<Record<number, string>>({})
  const result = job.result
  async function savePlan() {
    if (result?.kind !== 'plan') return
    try {
      await api.savePlan(job.novel_id, { title: result.title, level: 'chapter', body: result.scenes.map((s, i) => `场景 ${i + 1}\n目标：${s.goal}\n阻力：${s.obstacle}\n选择：${s.decision}\n变化：${s.change}`).join('\n\n') })
      await cache.invalidateQueries({ queryKey: ['plans', job.novel_id] }); setMessage('已保存为剧情规划。此操作不会更新正史。')
    } catch (e) { setMessage(errorText(e)) }
  }
  if (!result) return <div className="candidate-prose">{job.output_text || '等待模型返回内容…'}</div>
  return <div className="structured-result">
    {result.kind === 'extract' && <><p className="muted">这些记忆将在本章定稿时由你确认。</p>{result.changes.map((change, i) => <div className="memory-proposal" key={i}><Badge>{change.kind === 'knowledge' ? '人物知识' : change.kind === 'thread' ? '伏笔' : '本章变化'}</Badge><p>{change.claim}</p>{change.evidence.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}</div>)}{!result.changes.length && <p>本次没有提出新的变化。</p>}{result.uncertainties?.map((s, i) => <Notice key={i}>{s}</Notice>)}</>}
    {result.kind === 'review' && <><p>{result.summary}</p>{result.findings.map((finding, i) => <div className="review-finding" key={i}><div className="button-row"><Badge tone={finding.severity === 'important' ? 'amber' : 'neutral'}>{finding.severity === 'important' ? '需要关注' : finding.severity === 'question' ? '待核实' : '建议'}</Badge><span className="muted">{finding.decision === 'pending' ? '待作者判断' : finding.decision === 'intentional' ? '有意安排' : finding.decision === 'false_positive' ? '标记为误报' : finding.decision === 'later' ? '稍后处理' : '确认问题'}</span></div><p>{finding.explanation}</p><blockquote>{finding.target.quote}</blockquote><SourceButton evidence={finding.target} onEvidence={onEvidence} label="定位待审正文" />{finding.source_evidence?.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}<p className="muted">{finding.suggestion}</p><Field label="作者说明（可选）"><textarea rows={2} maxLength={2000} value={notes[i] ?? finding.decision_note} onChange={e => setNotes(values => ({ ...values, [i]: e.target.value }))} placeholder="例如：这是有意安排的回忆，后文会解释。" /></Field><div className="finding-actions">{(['confirmed', 'intentional', 'false_positive', 'later'] as const).map((decision, n) => <button key={decision} onClick={() => void api.decide(job.id, job.novel_id, { index: i, decision, note: notes[i] ?? finding.decision_note }).then(() => cache.invalidateQueries({ queryKey: ['job', job.id] })).catch(e => setMessage(errorText(e)))}>{['确认问题', '有意安排', '误报', '稍后'][n]}</button>)}</div></div>)}</>}
    {result.kind === 'plan' && <><h3>{result.title}</h3>{result.scenes.map((scene, i) => <div className="scene-item" key={i}><span className="scene-number">{i + 1}</span><div><strong>{scene.goal}</strong><dl><dt>阻力</dt><dd>{scene.obstacle}</dd><dt>选择</dt><dd>{scene.decision}</dd><dt>变化</dt><dd>{scene.change}</dd></dl></div></div>)}{result.open_questions?.map((s, i) => <p className="muted" key={i}>{s}</p>)}<Button onClick={() => void savePlan()}><ClipboardText size={17} />保存到剧情规划</Button></>}
    {result.kind === 'handoff' && <><h3>本章交接提议</h3>{result.observations.map((change, i) => <div className="memory-proposal" key={i}><p>{change.claim}</p>{change.evidence.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}</div>)}<h4>仍未解答的问题</h4>{result.open_questions?.map((s, i) => <p key={i}>{s}</p>)}<h4>后续建议 · 尚未发生</h4>{result.next_suggestions?.map((s, i) => <p key={i}>{s}</p>)}</>}
    {message && <Notice tone="neutral">{message}</Notice>}
  </div>
}

export function useJobStream(job: JobDetail | undefined) {
  const cache = useQueryClient()
  const [connection, setConnection] = useState('')
  const active = job && activeStates.has(job.state)
  useEffect(() => {
    if (!job?.id || !active) { setConnection(''); return }
    const stream = new EventSource(`/api/v1/jobs/${job.id}/events?novel_id=${job.novel_id}`)
    let lastRefresh = 0
    stream.onopen = () => setConnection('已连接')
    stream.onerror = () => setConnection('正在重连，任务继续保存在工作区')
    stream.onmessage = () => {
      if (Date.now() - lastRefresh > 160) {
        lastRefresh = Date.now(); void cache.invalidateQueries({ queryKey: ['job', job.id] })
      }
    }
    stream.addEventListener('complete', () => { stream.close(); setConnection(''); void cache.invalidateQueries({ queryKey: ['job', job.id] }); void cache.invalidateQueries({ queryKey: ['jobs'] }) })
    return () => stream.close()
  }, [job?.id, job?.novel_id, active, cache])
  return connection
}

export function ContextDetails({ context, onEvidence, excluded, onToggle }: { context: Context; onEvidence: (e: Evidence) => void; excluded?: string[]; onToggle?: (id: string) => void }) {
  return <div className="context-details"><div className="context-budget"><div><span>输入估算</span><strong>{number(context.estimated_input_tokens)} tokens</strong></div><div><span>输出上限</span><strong>{number(context.max_output_tokens)} tokens</strong></div></div><p className="small muted">{context.estimate_note}</p>
    <div className="context-cost"><span>{context.provider_name} / {context.model}</span><Badge tone={context.is_demo ? 'amber' : 'green'}>{context.is_demo ? '演示，不调用外部模型' : context.estimated_max_cost == null ? '费用未估算' : `预留估算 ${context.estimated_max_cost.toFixed(4)} ${context.currency}`}</Badge></div>
    {!context.is_demo && context.provider_url && <p className="small muted">发送至：{context.provider_url}</p>}
    {context.notices.map((s, i) => <p className="context-notice" key={i}>{s}</p>)}
    <details><summary>本次要求与作品方向</summary><p className="small">{context.instruction}</p><p className="small muted">本章意图：{context.chapter_goal || '未填写'}</p><p className="small muted">{context.author_brief?.premise || '未填写故事方向'}</p>{context.author_brief?.style && <p className="small muted">文风：{context.author_brief?.style}</p>}</details>
    {context.current_selection && <><h4>当前选段与附近原文</h4><div className="context-source"><p>{context.rewrite_surroundings?.before}</p><blockquote>{context.current_selection.text}</blockquote><p>{context.rewrite_surroundings?.after}</p></div></>}
    {context.entities.length > 0 && <><h4>作者设定</h4>{context.entities.map(e => <div className="context-setting" key={e.id}><strong>{e.name}</strong><span>{e.summary}</span></div>)}</>}
    <h4>原文来源 · {context.sources.length}</h4>{context.sources.map(source => <div className="context-source" key={source.source_id}><div className="context-source-title">{onToggle && source.kind !== 'draft' && <input type="checkbox" aria-label={`引用${source.chapter_title}的段落`} checked={!excluded?.includes(source.source_id)} onChange={() => onToggle(source.source_id)} />}<SourceButton evidence={{ ...source, quote: source.text }} onEvidence={onEvidence} /><Badge>{source.kind === 'draft' ? '当前稿' : '已确认'}</Badge></div><p>{source.text}</p></div>)}
    <h4>已确认事实 · {context.facts.length}</h4>{context.facts.map(f => <p className="small" key={f.id}>{f.claim}</p>)}
    {context.plans.length > 0 && <details><summary>未来规划 · 不作为已发生事实</summary>{context.plans.map(p => <p key={p.id}>{p.title}：{p.body}</p>)}</details>}
  </div>
}

export type AssistantProps = {
  novel: Novel; chapter: Chapter; providers: Provider[]; roles: Roles;
  flush: () => Promise<Version>; selection: Selection | null;
  onAdopt: (version: Version) => void; onEvidence: (e: Evidence) => void;
  onExtractReady: (changes: MemoryProposal[], versionId: string) => void;
  onClose?: () => void;
  candidateHost?: HTMLElement | null; onCandidate?: (id: string, show: boolean) => void; onShowCandidate?: () => void;
  blockedChapter?: string; onResolvePrevious?: () => void;
}

export function Assistant({ novel, chapter, providers, roles, flush, selection, onAdopt, onEvidence, onExtractReady, onClose, candidateHost, onCandidate, onShowCandidate, blockedChapter, onResolvePrevious }: AssistantProps) {
  const cache = useQueryClient()
  const [task, setTask] = useState<Task>('continue')
  const [mode, setMode] = useState<'chapter' | 'continue' | 'rewrite'>('chapter')
  const [tab, setTab] = useState<'assistant' | 'context'>('assistant')
  const [instruction, setInstruction] = useState('')
  const [target, setTarget] = useState(novel.chapter_words)
  const [providerId, setProviderId] = useState(roles.writer || 'demo')
  const [context, setContext] = useState<Context | null>(null)
  const [excluded, setExcluded] = useState<string[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showCompare, setShowCompare] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [budget, setBudget] = useState('')
  const [maxAttempts, setMaxAttempts] = useState(3)
  const pendingSubmission = useRef<JobInput | null>(null)
  const provider = providers.find(p => p.id === providerId)
  const jobs = useQuery({ queryKey: ['jobs', novel.id], queryFn: () => api.jobs(novel.id) })
  const currentJobId = jobId || jobs.data?.find(j => j.chapter_id === chapter.id && !['blueprint', 'outline'].includes(j.task))?.id
  const job = useQuery({ queryKey: ['job', currentJobId], queryFn: () => api.job(currentJobId!, novel.id), enabled: !!currentJobId,
    refetchInterval: query => query.state.data && activeStates.has(query.state.data.state) ? 900 : false })
  const connection = useJobStream(job.data)
  const active = job.data && activeStates.has(job.data.state)
  useEffect(() => { setJobId(null); setContext(null); setInstruction(''); pendingSubmission.current = null; setError('') }, [chapter.id])
  useEffect(() => {
    const result = job.data?.result
    if (job.data?.state === 'succeeded' && result?.kind === 'extract') onExtractReady(result.changes, job.data.base_version_id)
  }, [job.data, onExtractReady])
  function changeTask(next: Task) {
    setTask(next); setContext(null); setError('')
    const role = next === 'plan' ? 'planner' : next === 'review' ? 'reviewer' : next === 'extract' || next === 'handoff' ? 'extractor' : 'writer'
    setProviderId(roles[role] || 'demo')
  }
  async function input(): Promise<ContextInput> {
    const version = await flush()
    const wholeChapter = task === 'continue' && mode === 'chapter'
    const effectiveTask = wholeChapter && version.text.trim() ? 'rewrite' : task
    const effectiveSelection = wholeChapter && version.text.trim() ? { start_codepoint: 0, end_codepoint: Array.from(version.text).length, text: version.text } : task === 'rewrite' ? selection : null
    const direction = wholeChapter ? `依据本章细纲创作完整一章，目标约 ${target} 字。包含完整场景推进和有意义的章末钩子；只输出正文，不重复章节标题。` : ''
    return { chapter_id: chapter.id, base_version_id: version.id, task: effectiveTask, instruction: [direction, instruction || chapter.goal || '推进本章剧情，保持视角和人物一致。'].filter(Boolean).join('\n'),
      provider_id: providerId, target_chars: target, chapter_batch: 5, excluded_source_ids: excluded, selection: effectiveSelection }
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
  }, onSuccess: value => { setJobId(value.id); setTab('assistant'); cache.setQueryData(['job', value.id], value); void cache.invalidateQueries({ queryKey: ['jobs'] }); setError('') } })
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
      onAdopt(adopted); setShowCompare(false); setError('')
      await cache.invalidateQueries({ queryKey: ['job', job.data.id] }); await cache.invalidateQueries({ queryKey: ['chapters', novel.id] }); await cache.invalidateQueries({ queryKey: ['novel', novel.id] })
    } catch (e) { setError(errorText(e)) } finally { setAdopting(false) }
  }
  const canAdopt = job.data && ['continue', 'rewrite'].includes(job.data.task) && job.data.state === 'succeeded' && job.data.candidate_status === 'ready'
  const inDocument = !!candidateHost && !!job.data && ['continue', 'rewrite'].includes(job.data.task)
  const notified = useRef<string | null>(null)
  useEffect(() => {
    if (inDocument && job.data && notified.current !== job.data.id) {
      notified.current = job.data.id
      onCandidate?.(job.data.id, job.data.candidate_status !== 'adopted' && job.data.candidate_status !== 'rejected')
    }
  }, [inDocument, job.data, onCandidate])
  const candidate = <section className="assistant-section candidate-area">{job.data ? <><div className="section-heading"><h4>本次生成</h4><Badge tone={job.data.is_demo ? 'amber' : 'neutral'}>{job.data.is_demo ? '演示 · ' : ''}{job.data.candidate_status === 'adopted' ? '已采纳' : jobStateNames[job.data.state]}</Badge></div>
        {active && <div className="button-row"><span className="small muted" role="status">{connection || '正在生成…'}</span><Button variant="ghost" onClick={() => void control('cancel')}><Stop size={15} />停止</Button><Button variant="ghost" onClick={() => void control('pause')} disabled={job.data.state !== 'running' && job.data.state !== 'queued'}><Pause size={15} />暂停</Button></div>}
        {job.data.state === 'paused' && <Button onClick={() => void control('resume')}><Play size={15} />继续生成</Button>}
        {['failed', 'interrupted_uncertain'].includes(job.data.state) && <><Notice>{job.data.error_message || '生成未完成。'}{job.data.state === 'interrupted_uncertain' && <span className="block">请求可能已计费，核实后再重试。</span>}</Notice><Button onClick={() => void control('retry')} disabled={job.data.attempt_count >= job.data.max_attempts}><ArrowCounterClockwise size={16} />确认并重试</Button></>}
        {job.data.output_text && <JobResult job={job.data} onEvidence={onEvidence} />}
        {job.data.candidate_status === 'needs_rebase' && <Notice>原稿或参考已变化，请核对后重新生成。</Notice>}
        {error && <Notice>{error}</Notice>}{canAdopt && <div className="candidate-actions"><Button variant="primary" disabled={adopting} onClick={() => void adopt()}><Check size={17} />采纳正文</Button><Button onClick={() => setShowCompare(true)}>对比原稿</Button><Button variant="ghost" onClick={() => void control('reject')}>放弃</Button></div>}
        {['continue', 'rewrite'].includes(job.data.task) && job.data.output_text && <p className="candidate-count">本次 {number(countChars(job.data.output_text))} 字<span>目标 {number(job.data.context.author_brief?.chapter_words ? Number(job.data.context.author_brief.chapter_words) : target)} 字</span></p>}
        <details className="call-details"><summary>引用资料与调用记录</summary><button className="text-link" onClick={() => { setContext(job.data!.context); setTab('context') }}>查看引用资料<ArrowRight size={15} /></button><p className="small muted">{dateLabel(job.data.created_at)} · 第 {job.data.attempt_count} 次调用 · {job.data.is_demo ? '本地演示，不计费' : job.data.cost == null ? '实际费用未知' : `${job.data.cost.toFixed(4)} ${job.data.context.currency}`}</p><button className="text-link" onClick={() => downloadText(job.data!.output_text, `${chapter.title}-候选.txt`)}>下载本次结果</button></details>
      </> : <div className="candidate-placeholder"><PenNib size={24} weight="light" /><p>生成的正文会显示在这里</p></div>}</section>
  return <aside className="assistant-panel" aria-label="写作助手"><div className="assistant-heading"><strong>AI 写作</strong>{provider?.kind === 'demo' && <Badge tone="amber">演示</Badge>}<select aria-label="写作模型" value={providerId} onChange={e => { setProviderId(e.target.value); setContext(null) }}>{providers.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>{onClose && <button className="icon-button mobile-only" aria-label="关闭写作助手" onClick={onClose}><X size={18} /></button>}</div>
    <div className="assistant-tabs"><button className={task !== 'review' ? 'active' : ''} onClick={() => { changeTask('continue'); setTab('assistant') }}>写作</button><button className={task === 'review' ? 'active' : ''} onClick={() => { changeTask('review'); setTab('assistant') }}>审稿</button></div>
    <div className="assistant-scroll">
      {chapter.goal && <details className="assistant-outline"><summary><FileText size={18} /><span>本章细纲</span></summary><p>{chapter.goal}</p></details>}
      {task !== 'review' && <div className="writing-mode-tabs"><button className={mode === 'chapter' && task === 'continue' ? 'active' : ''} onClick={() => { setMode('chapter'); changeTask('continue') }}>写完整章</button><button className={mode === 'continue' && task === 'continue' ? 'active' : ''} onClick={() => { setMode('continue'); changeTask('continue') }}>续写</button><button className={task === 'rewrite' ? 'active' : ''} onClick={() => { setMode('rewrite'); changeTask('rewrite') }}>润色选段</button></div>}
      <div className="assistant-form">{blockedChapter && <Notice action={<Button onClick={onResolvePrevious}>去处理前章</Button>}>先完成《{blockedChapter}》的定稿，再写后文。</Notice>}<Field label={task === 'review' ? '审稿重点' : '补充要求'}><textarea aria-label="本次写作要求" rows={3} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder={task === 'review' ? '例如：检查人物动机、前后矛盾、重复和节奏' : '例如：加快节奏，让章末留下悬念'} maxLength={12000} /></Field>
        {task === 'rewrite' && <p className="selection-hint">{selection ? `已选 ${number(Array.from(selection.text).length)} 字符` : '先在正文中选择需要润色的文字。'}</p>}
        <div className="writing-options"><label><span className="sr-only">目标字数</span><select aria-label="目标字数" value={target} onChange={e => setTarget(Number(e.target.value))}>{[300, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000].map(n => <option key={n} value={n}>{number(n)} 字</option>)}</select></label><details className="generation-limits"><summary><SlidersHorizontal size={17} />高级</summary><div className="form-stack"><Field label="其他任务"><select aria-label="更多写作任务" value={['plan', 'extract', 'handoff'].includes(task) ? task : ''} onChange={e => e.target.value && changeTask(e.target.value as Task)}><option value="">选择任务</option><option value="plan">场景规划</option><option value="extract">整理本章记忆</option><option value="handoff">章节交接</option></select></Field><Field label="最多调用次数"><select value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n} 次</option>)}</select></Field><Field label={`费用上限（${provider?.currency || 'CNY'}）`}><input type="number" min="0.0001" max="10000" step="any" value={budget} onChange={e => setBudget(e.target.value)} placeholder="可选，需要配置价格" /></Field></div></details></div>
        {provider?.kind !== 'demo' && !provider?.has_key && <Notice>请先在模型设置中填写 API Key。</Notice>}
        {provider?.kind !== 'demo' && provider && provider.max_output_tokens < target * 1.6 && <p className="model-disclosure">模型输出上限偏小，整章可能截断。可在模型设置中调大。</p>}
        <Button variant="primary" className="full-width" disabled={!!active || generating.isPending || (!!blockedChapter && ['continue', 'rewrite'].includes(task)) || !provider || (provider.kind !== 'demo' && !provider.has_key) || (task === 'rewrite' && !selection)} onClick={() => generating.mutate()}><Sparkle size={19} />{generating.isPending ? '正在提交…' : task === 'extract' ? '整理本章记忆' : task === 'review' ? '审阅本章' : task === 'plan' ? '生成场景计划' : task === 'handoff' ? '生成章节交接' : task === 'rewrite' ? '润色选段' : mode === 'chapter' ? (chapter.char_count ? '重写本章正文' : '生成本章正文') : '继续写作'}</Button>
      </div>
      {(error || generating.error || preparing.error) && <Notice>{error || errorText(generating.error ?? preparing.error)}{pendingSubmission.current && <span className="block small">再次提交会重试同一次请求。</span>}</Notice>}
      {inDocument ? <div className="candidate-summary"><Badge>{job.data?.candidate_status === 'adopted' ? '已采纳' : job.data ? jobStateNames[job.data.state] : ''}</Badge><Button onClick={onShowCandidate}>查看 AI 草稿<ArrowRight size={16} /></Button><p className="small muted">{number(countChars(job.data?.output_text || ''))} 字 · {job.data?.is_demo ? '演示样例' : job.data?.context.model}</p></div> : candidate}
      {inDocument && createPortal(candidate, candidateHost!)}
      <button className="text-link context-trigger" onClick={() => preparing.mutate()} disabled={preparing.isPending}>查看将引用的资料<ArrowRight size={15} /></button>
    </div><footer className="assistant-footer">{provider?.kind === 'demo' ? '演示模式 · 固定样例' : `发送至 ${provider?.name || '所选模型服务'}`}</footer>
    <Modal open={tab === 'context'} onOpenChange={value => !value && setTab('assistant')} title="本次引用资料" wide>{context && <ContextDetails context={context} onEvidence={onEvidence} excluded={excluded} onToggle={id => setExcluded(previous => previous.includes(id) ? previous.filter(x => x !== id) : [...previous, id])} />}</Modal>
    <Modal open={showCompare} onOpenChange={setShowCompare} title="对比原稿" wide className="candidate-modal"><div className="comparison"><div><h4>当前原稿</h4><div className="comparison-text">{chapter.version.text || '空白'}</div></div><div><h4>{job.data?.task === 'rewrite' ? '替换内容' : '新增内容'}</h4><div className="comparison-text comparison-new">{job.data?.output_text}</div></div></div>{job.data && job.data.base_version_id !== chapter.working_version_id && <Notice>原稿已更新，请核对后重新生成。</Notice>}{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={() => setShowCompare(false)}>返回</Button><Button variant="primary" disabled={adopting} onClick={() => void adopt()}>采纳正文</Button></div></Modal>
  </aside>
}
