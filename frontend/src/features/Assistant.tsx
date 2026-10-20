import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, FileText, Pause, Play, Stop, ArrowCounterClockwise, PenNib, CaretDown, X, ClipboardText } from '@phosphor-icons/react'
import { activeStates, ApiError, api, dateLabel, downloadText, errorText, jobStateNames, number, taskNames, uuid } from '../lib/api'
import type { Chapter, Context, ContextInput, Evidence, JobDetail, JobInput, MemoryProposal, Novel, Provider, Roles, Selection, Task, Version } from '../lib/api'
import { Badge, Button, Empty, Field, Modal, Notice } from '../components/ui'

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
    {result.kind === 'extract' && <><p className="muted">以下只是变化提议。请在“确认正史”中选择后提交。</p>{result.changes.map((change, i) => <div className="memory-proposal" key={i}><Badge>{change.kind === 'knowledge' ? '人物知识' : change.kind === 'thread' ? '伏笔' : '本章变化'}</Badge><p>{change.claim}</p>{change.evidence.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}</div>)}{!result.changes.length && <p>本次没有提出新的变化。</p>}{result.uncertainties?.map((s, i) => <Notice key={i}>{s}</Notice>)}</>}
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
}

export function Assistant({ novel, chapter, providers, roles, flush, selection, onAdopt, onEvidence, onExtractReady, onClose }: AssistantProps) {
  const cache = useQueryClient()
  const [task, setTask] = useState<Task>('continue')
  const [tab, setTab] = useState<'assistant' | 'context'>('assistant')
  const [instruction, setInstruction] = useState('')
  const [target, setTarget] = useState(500)
  const [providerId, setProviderId] = useState(roles.writer || 'demo')
  const [context, setContext] = useState<Context | null>(null)
  const [excluded, setExcluded] = useState<string[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showCompare, setShowCompare] = useState(false)
  const [budget, setBudget] = useState('')
  const [maxAttempts, setMaxAttempts] = useState(3)
  const pendingSubmission = useRef<JobInput | null>(null)
  const provider = providers.find(p => p.id === providerId)
  const jobs = useQuery({ queryKey: ['jobs', novel.id], queryFn: () => api.jobs(novel.id) })
  const currentJobId = jobId || jobs.data?.find(j => j.chapter_id === chapter.id)?.id
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
    return { chapter_id: chapter.id, base_version_id: version.id, task, instruction: instruction || chapter.goal || '保持当前叙述视角，推进本章。',
      provider_id: providerId, target_chars: target, excluded_source_ids: excluded,
      selection: task === 'rewrite' ? selection : null }
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
    if (!job.data) return
    try {
      const version = await flush()
      const adopted = await api.adopt(job.data.id, novel.id, version.id)
      onAdopt(adopted); setShowCompare(false)
      await cache.invalidateQueries({ queryKey: ['job', job.data.id] }); await cache.invalidateQueries({ queryKey: ['chapters', novel.id] }); await cache.invalidateQueries({ queryKey: ['novel', novel.id] })
    } catch (e) { setError(errorText(e)) }
  }
  const canAdopt = job.data && ['continue', 'rewrite'].includes(job.data.task) && job.data.state === 'succeeded' && job.data.candidate_status === 'ready'
  return <aside className="assistant-panel" aria-label="写作助手"><div className="assistant-heading"><strong>写作助手</strong>{provider?.kind === 'demo' && <Badge tone="amber">演示</Badge>}{onClose && <button className="icon-button mobile-only" aria-label="关闭写作助手" onClick={onClose}><X size={18} /></button>}</div>
    <div className="assistant-tabs"><button className={tab === 'assistant' ? 'active' : ''} onClick={() => setTab('assistant')}>协助创作</button><button className={tab === 'context' ? 'active' : ''} onClick={() => setTab('context')}>本次上下文</button></div>
    <div className="assistant-scroll">{tab === 'context' ? context ? <ContextDetails context={context} onEvidence={onEvidence} excluded={excluded} onToggle={id => { setExcluded(previous => previous.includes(id) ? previous.filter(x => x !== id) : [...previous, id]); }} /> : <Empty icon={<FileText size={26} />} title="先准备一次上下文">将显示选中的原文、设定和用量估算。<Button onClick={() => preparing.mutate()} disabled={preparing.isPending}>查看将引用的内容</Button></Empty> : <>
      <div className="task-tabs">{(['continue', 'rewrite', 'review'] as const).map(value => <button key={value} className={task === value ? 'active' : ''} onClick={() => changeTask(value)}>{value === 'rewrite' ? '改写' : value === 'review' ? '审稿' : taskNames[value]}</button>)}<select aria-label="更多写作任务" value={['plan', 'extract', 'handoff'].includes(task) ? task : ''} onChange={e => e.target.value && changeTask(e.target.value as Task)}><option value="">更多</option><option value="plan">场景规划</option><option value="extract">提取变化</option><option value="handoff">前章交接</option></select></div>
      <div className="assistant-form"><h3>{task === 'review' ? '这一章，有哪些值得核对？' : task === 'extract' ? '整理本章已经发生的变化' : task === 'plan' ? '先想清楚这一章如何推进' : task === 'rewrite' ? '这一段，你希望如何修改？' : task === 'handoff' ? '为下一章留一份交接' : '这一段，你想如何推进？'}</h3><textarea aria-label="本次写作要求" rows={4} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder={chapter.goal || '写下你的要求，AI 会先给出候选。'} maxLength={12000} />
        {task === 'rewrite' && <p className="selection-hint">{selection ? `已选择 ${Array.from(selection.text).length} 个字符` : '请先在正文中选择要改写的文字。'}</p>}
        <div className="form-row"><Field label="目标字数"><select value={target} onChange={e => setTarget(Number(e.target.value))}><option value={300}>约 300 字</option><option value={500}>约 500 字</option><option value={1000}>约 1,000 字</option><option value={2000}>约 2,000 字</option></select></Field><Field label="模型连接"><select value={providerId} onChange={e => { setProviderId(e.target.value); setContext(null) }}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>
        <details className="generation-limits"><summary>调用与费用上限</summary><div className="form-stack"><Field label="最多调用次数" help="失败后需手动重试，达到上限即停止。"><select value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n} 次</option>)}</select></Field><Field label={`费用上限（${provider?.currency || 'CNY'}，可选）`} help="需要配置价格；历史费用未知时会阻止继续调用。"><input type="number" min="0.0001" max="10000" step="any" value={budget} onChange={e => setBudget(e.target.value)} placeholder="不设置金额上限" /></Field></div></details>
        {provider?.kind !== 'demo' && !provider?.has_key && <Notice>此连接尚未配置密钥。可继续手写，或在模型设置中添加。</Notice>}
        <Button variant="primary" className="full-width" disabled={!!active || generating.isPending || !provider || (provider.kind !== 'demo' && !provider.has_key) || (task === 'rewrite' && !selection)} onClick={() => generating.mutate()}><PenNib size={18} />{generating.isPending ? '正在准备…' : task === 'extract' ? '提取变化候选' : task === 'review' ? '生成审稿意见' : task === 'plan' ? '生成场景计划' : task === 'handoff' ? '生成交接提议' : '生成候选稿'}</Button><p className="assistant-helper">先预览，再决定是否采纳</p>
      </div>
      <section className="assistant-section"><div className="section-heading"><h4>本次参考</h4>{context && <Badge>{context.sources.length + context.entities.length}</Badge>}<button className="icon-button" aria-label="准备上下文" onClick={() => preparing.mutate()} disabled={preparing.isPending}><CaretDown size={16} /></button></div>{context ? <>{context.entities.slice(0, 2).map(e => <div className="compact-reference" key={e.id}><FileText size={16} /><span>{e.kind === 'character' ? '人物' : '设定'} / {e.name}</span></div>)}{context.sources.filter(s => s.kind === 'canon').slice(0, 2).map(s => <SourceButton key={s.source_id} evidence={{ ...s, quote: s.text }} onEvidence={onEvidence} />)}</> : <p className="small muted">发送前可查看当前稿、已确认前文与相关设定。</p>}<button className="text-link" onClick={() => preparing.mutate()} disabled={preparing.isPending}>查看完整上下文<ArrowRight size={15} /></button></section>
      {(error || generating.error || preparing.error) && <Notice>{error || errorText(generating.error ?? preparing.error)}{pendingSubmission.current && <span className="block small">重试生成按钮会沿用同一次提交，不会偷偷创建第二个任务。</span>}</Notice>}
      <section className="assistant-section candidate-area">{job.data ? <><div className="section-heading"><h4>{taskNames[job.data.task as Task]}结果</h4><Badge tone={active ? 'green' : job.data.state === 'failed' || job.data.state === 'interrupted_uncertain' ? 'amber' : 'neutral'}>{jobStateNames[job.data.state]}</Badge></div>{job.data.is_demo && <p className="demo-disclosure">演示响应，用于体验流程，不代表模型能力。</p>}{connection && <p className="small muted" role="status">{connection}</p>}
        {active && <div className="button-row"><Button variant="ghost" onClick={() => void control('pause')} disabled={job.data.state !== 'running' && job.data.state !== 'queued'}><Pause size={15} />暂停</Button><Button variant="ghost" onClick={() => void control('cancel')}><Stop size={15} />取消</Button></div>}
        {job.data.state === 'paused' && <Button onClick={() => void control('resume')}><Play size={15} />继续任务</Button>}
        {['failed', 'interrupted_uncertain'].includes(job.data.state) && <><Notice>{job.data.error_message || '任务未完成。'}{job.data.state === 'interrupted_uncertain' && <span className="block">请求可能已执行并计费，核实后再重试。</span>}</Notice><Button onClick={() => void control('retry')} disabled={job.data.attempt_count >= job.data.max_attempts}><ArrowCounterClockwise size={16} />确认并重试</Button></>}
        {job.data.output_text && <JobResult job={job.data} onEvidence={onEvidence} />}
        {job.data.candidate_status === 'adopted' && <Notice tone="green">已采纳为新正文版本。正史仍需单独确认。</Notice>}
        {job.data.candidate_status === 'needs_rebase' && <Notice>原稿或参考已变化。请查看候选后手动合并，旧稿会保留。</Notice>}
        {canAdopt && <div className="candidate-actions"><Button variant="primary" onClick={() => setShowCompare(true)}><Check size={16} />比较并采纳</Button><Button variant="ghost" onClick={() => void control('reject')}>保留原稿</Button></div>}
        {job.data.output_text && <button className="text-link small" onClick={() => downloadText(job.data!.output_text, `${chapter.title}-候选稿.txt`)}>下载候选文本</button>}
        <p className="small muted">{dateLabel(job.data.created_at)} · 第 {job.data.attempt_count} 次调用 · {job.data.is_demo ? '本地演示，不计费' : job.data.cost == null ? '实际费用未知' : `${job.data.cost.toFixed(4)} ${job.data.context.currency}`}</p>
      </> : <Empty icon={<FileText size={28} weight="light" />} title="候选稿会显示在这里">原稿会完整保留。</Empty>}</section>
    </>}</div>
    <footer className="assistant-footer">{provider?.kind === 'demo' ? '演示响应，不调用真实模型。' : '选定上下文会发送到你配置的模型服务。'}</footer>
    <Modal open={showCompare} onOpenChange={setShowCompare} title="候选稿预览" description="采纳后保存为新正文版本，原稿保留。正史需要单独确认。" wide className="candidate-modal"><div className="comparison"><div><h4>当前原稿</h4><div className="comparison-text">{chapter.version.text || '当前稿为空。'}</div></div><div><h4>{job.data?.task === 'rewrite' ? '替换选段的建议' : '建议追加的内容'}</h4><div className="comparison-text comparison-new">{job.data?.output_text}</div></div></div>{job.data && job.data.base_version_id !== chapter.working_version_id && <Notice>原稿已更新，直接采纳将被拒绝。你仍可下载候选后手动合并。</Notice>}{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={() => setShowCompare(false)}>继续保留原稿</Button><Button variant="primary" onClick={() => void adopt()}>采纳为新版本</Button></div></Modal>
  </aside>
}
