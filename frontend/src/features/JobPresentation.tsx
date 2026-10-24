import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ClipboardText, FileText } from '@phosphor-icons/react'
import { api, downloadText, errorText, number } from '../lib/api'
import type { Context, Evidence, JobDetail } from '../lib/api'
import { Badge, Button, Field, Notice } from '../components/ui'
import { InspirationResult } from './InspirationResult'
import { BlueprintView, OutlineView } from './ProductionResults'

export function SourceButton({ evidence, onEvidence, label }: { evidence: Evidence; onEvidence: (e: Evidence) => void; label?: string }) {
  return <button className="source-button" onClick={() => onEvidence(evidence)}><FileText size={16} /><span>{label || evidence.chapter_title || '查看原文'}</span><ArrowRight size={14} /></button>
}

export function AttemptHistory({ attempts, currency }: { attempts: JobDetail['attempts']; currency: string }) {
  const states: Record<string, string> = {
    request_prepared: '请求已准备', dispatch_started: '请求已发出', streaming: '正在接收', completed: '已完成',
    failed: '调用失败', interrupted_uncertain: '响应中断，需核实上游状态',
    cancelled_before_dispatch: '发送前已停止', cancelled_after_dispatch: '已停止，上游可能仍计费',
  }
  return <details className="attempt-history"><summary>调用记录与历史内容（{attempts.length}）</summary>
    {attempts.map(attempt => <article className="attempt-entry" key={attempt.id}>
      <div className="attempt-row"><strong>第 {attempt.number} 次</strong><span>{states[attempt.call_state] || '调用状态待核实'}</span>
        <span>{attempt.usage ? `输入 ${attempt.usage.prompt_tokens ?? '未知'} / 输出 ${attempt.usage.completion_tokens ?? '未知'} tokens` : '用量未知'}</span>
        <span>{attempt.cost == null ? '费用未知' : `${attempt.cost.toFixed(4)} ${currency}`}</span>
      </div>
      {attempt.output_text && <><details className="attempt-content"><summary>查看第 {attempt.number} 次保留内容</summary><pre>{attempt.output_text}</pre></details>
        <Button variant="ghost" onClick={() => downloadText(attempt.output_text, `第${attempt.number}次调用-${attempt.id.slice(-8)}.txt`)}>下载第 {attempt.number} 次内容</Button></>}
    </article>)}
    <p className="small muted">未完成内容保留供查看与下载，不能直接当作完整候选采纳。</p>
  </details>
}

export function JobResult({ job, onEvidence, onChoose, stale = false }: { job: JobDetail; onEvidence: (e: Evidence) => void; onChoose?: (index: number) => void; stale?: boolean }) {
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
  if (!result && !['continue', 'rewrite'].includes(job.task)) return <p className="small muted" role="status">{['queued', 'running', 'pausing'].includes(job.state) ? '正在整理结果，完成后显示。' : '结果未完整生成，已保留的内容可下载查看。'}</p>
  if (!result) return <div className="candidate-prose">{job.output_text || '等待模型返回内容…'}</div>
  if (result.kind === 'blueprint') return <BlueprintView value={result} />
  if (result.kind === 'outline') return <OutlineView value={result} />
  if (result.kind === 'inspiration') return <InspirationResult job={job} onEvidence={onEvidence} onChoose={onChoose} disabled={stale} />
  return <div className="structured-result">
    {result.kind === 'extract' && <><p className="muted">这些记忆将在本章定稿时由你确认。</p>{result.changes.map((change, i) => <div className="memory-proposal" key={i}><Badge>{change.kind === 'knowledge' ? '人物知识' : change.kind === 'thread' ? '伏笔' : '本章变化'}</Badge><p>{change.claim}</p>{change.evidence.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}</div>)}{!result.changes.length && <p>本次没有提出新的变化。</p>}{result.uncertainties?.map((s, i) => <Notice key={i}>{s}</Notice>)}</>}
    {result.kind === 'review' && <><p>{result.summary}</p>{result.findings.map((finding, i) => <div className="review-finding" key={i}><div className="button-row"><Badge tone={finding.severity === 'important' ? 'amber' : 'neutral'}>{finding.severity === 'important' ? '需要关注' : finding.severity === 'question' ? '待核实' : '建议'}</Badge><span className="muted">{finding.decision === 'pending' ? '待作者判断' : finding.decision === 'intentional' ? '有意安排' : finding.decision === 'false_positive' ? '标记为误报' : finding.decision === 'later' ? '稍后处理' : '确认问题'}</span></div><p>{finding.explanation}</p><blockquote>{finding.target.quote}</blockquote><SourceButton evidence={finding.target} onEvidence={onEvidence} label="定位待审正文" />{finding.source_evidence?.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}<p className="muted">{finding.suggestion}</p><Field label="作者说明（可选）"><textarea rows={2} maxLength={2000} value={notes[i] ?? finding.decision_note} onChange={e => setNotes(values => ({ ...values, [i]: e.target.value }))} placeholder="例如：这是有意安排的回忆，后文会解释。" /></Field><div className="finding-actions">{(['confirmed', 'intentional', 'false_positive', 'later'] as const).map((decision, n) => <button key={decision} onClick={() => void api.decide(job.id, job.novel_id, { index: i, decision, note: notes[i] ?? finding.decision_note }).then(() => cache.invalidateQueries({ queryKey: ['job', job.id] })).catch(e => setMessage(errorText(e)))}>{['确认问题', '有意安排', '误报', '稍后'][n]}</button>)}</div></div>)}</>}
    {result.kind === 'plan' && <><h3>{result.title}</h3>{result.scenes.map((scene, i) => <div className="scene-item" key={i}><span className="scene-number">{i + 1}</span><div><strong>{scene.goal}</strong><dl><dt>阻力</dt><dd>{scene.obstacle}</dd><dt>选择</dt><dd>{scene.decision}</dd><dt>变化</dt><dd>{scene.change}</dd></dl></div></div>)}{result.open_questions?.map((s, i) => <p className="muted" key={i}>{s}</p>)}<Button onClick={() => void savePlan()}><ClipboardText size={17} />保存到剧情规划</Button></>}
    {result.kind === 'handoff' && <><h3>本章交接提议</h3>{result.observations.map((change, i) => <div className="memory-proposal" key={i}><p>{change.claim}</p>{change.evidence.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}</div>)}<h4>仍未解答的问题</h4>{result.open_questions?.map((s, i) => <p key={i}>{s}</p>)}<h4>后续建议 · 尚未发生</h4>{result.next_suggestions?.map((s, i) => <p key={i}>{s}</p>)}</>}
    {message && <Notice tone="neutral">{message}</Notice>}
  </div>
}

export function ContextDetails({ context, onEvidence, excluded, onToggle }: { context: Context; onEvidence: (e: Evidence) => void; excluded?: string[]; onToggle?: (id: string) => void }) {
  return <div className="context-details"><div className="context-budget"><div><span>输入估算</span><strong>{number(context.estimated_input_tokens)} tokens</strong></div><div><span>输出上限</span><strong>{number(context.max_output_tokens)} tokens</strong></div></div><p className="small muted">{context.estimate_note}</p>
    <div className="context-cost"><span>{context.provider_name} / {context.model}</span><Badge tone={context.is_demo ? 'amber' : 'green'}>{context.is_demo ? '演示，不调用外部模型' : context.estimated_max_cost == null ? '费用未估算' : `预留估算 ${context.estimated_max_cost.toFixed(4)} ${context.currency}`}</Badge></div>
    {!context.is_demo && context.provider_url && <p className="small muted">发送至：{context.provider_url}</p>}
    {context.inspiration_title && <p className="context-notice">本次选中的剧情方向：{context.inspiration_title}（未来创作意图）</p>}
    {context.notices.map((s, i) => <p className="context-notice" key={i}>{s}</p>)}
    <details><summary>本次要求与作品方向</summary><p className="small">{context.instruction}</p><p className="small muted">本章意图：{context.chapter_goal || '未填写'}</p><p className="small muted">{context.author_brief?.premise || '未填写故事方向'}</p>{context.author_brief?.style && <p className="small muted">文风：{context.author_brief?.style}</p>}</details>
    {context.current_selection && <><h4>当前选段与附近原文</h4><div className="context-source"><p>{context.rewrite_surroundings?.before}</p><blockquote>{context.current_selection.text}</blockquote><p>{context.rewrite_surroundings?.after}</p></div></>}
    {context.reference_notes && <details><summary>本章补充资料 · 非正史</summary><p className="reference-notes-preview">{context.reference_notes}</p></details>}
    {context.entities.length > 0 && <><h4>作者设定</h4>{context.entities.map(e => <div className="context-setting" key={e.id}><strong>{e.name}{context.pinned_entity_ids?.includes(e.id) && <Badge>必读</Badge>}</strong><span>{e.summary}</span></div>)}</>}
    <h4>原文来源 · {context.sources.length}</h4>{context.sources.map(source => <div className="context-source" key={source.source_id}><div className="context-source-title">{onToggle && source.kind !== 'draft' && <input type="checkbox" disabled={source.pinned} aria-label={`引用${source.chapter_title}的段落`} checked={source.pinned || !excluded?.includes(source.source_id)} onChange={() => onToggle(source.source_id)} />}<SourceButton evidence={{ ...source, quote: source.text }} onEvidence={onEvidence} /><Badge>{source.kind === 'draft' ? '当前稿' : source.pinned ? '本章必读' : '已确认'}</Badge></div><p>{source.text}</p></div>)}
    <h4>已确认事实 · {context.facts.length}</h4>{context.facts.map(f => <p className="small" key={f.id}>{f.claim}</p>)}
    {context.plans.length > 0 && <details><summary>未来规划 · 不作为已发生事实</summary>{context.plans.map(p => <p key={p.id}>{p.title}：{p.body}</p>)}</details>}
  </div>
}
