import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PenNib } from '@phosphor-icons/react'
import { api, errorText } from '../lib/api'
import type { Evidence, JobDetail, ReviewFinding } from '../lib/api'
import { Badge, Button, Field, Notice } from '../components/ui'
import { SourceButton } from '../components/SourceButton'

const types: Record<ReviewFinding['type'], string> = {
  fact_conflict: '疑似事实冲突', knowledge_leak: '角色知识', timeline_question: '时间与位置',
  motivation_question: '人物动机', repetition: '重复描写', pacing: '叙事节奏', thread_question: '伏笔线索', needs_verification: '待核实',
}
const decisions: Record<ReviewFinding['decision'], string> = {
  pending: '待作者判断', confirmed: '确认问题', intentional: '有意安排', false_positive: '误报', later: '稍后处理',
}
type Props = {
  job: JobDetail; result: Extract<NonNullable<JobDetail['result']>, { kind: 'review' }>;
  onEvidence: (e: Evidence) => void;
  onPrepare?: (index: number, note: string) => Promise<void>;
  stale?: boolean; disabled?: boolean;
}

export function ReviewFindings({ job, result, onEvidence, onPrepare, stale, disabled }: Props) {
  const cache = useQueryClient()
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<{ index: number; message: string } | null>(null)
  async function run(index: number, operation: () => Promise<void>) {
    if (busy !== null) return
    setBusy(index); setError(null)
    try { await operation() } catch (e) { setError({ index, message: errorText(e) }) } finally { setBusy(null) }
  }
  async function decide(index: number, decision: ReviewFinding['decision']) {
    const finding = result.findings[index]
    const value = await api.decide(job.id, job.novel_id, { index, decision, note: notes[index] ?? finding.decision_note,
      base_decision: finding.decision, base_note: finding.decision_note })
    cache.setQueryData(['job', job.id], value)
    void cache.invalidateQueries({ queryKey: ['jobs'] })
    void cache.invalidateQueries({ queryKey: ['job'] })
  }
  return <div className="review-results">
    <p className="review-summary">{result.summary}</p>
    {stale && <Notice>正文或参考已变化，这份审稿仅供查看。请重新审稿后再准备改写。</Notice>}
    {!result.findings.length && <p className="muted">本次未提出具体问题。</p>}
    {result.findings.map((finding, index) => {
      const locked = disabled || busy !== null
      const dismissed = finding.decision === 'intentional' || finding.decision === 'false_positive'
      return <article className="review-finding" key={index} aria-label={`审稿意见 ${index + 1}`}>
        <div className="review-finding-heading"><Badge tone={finding.severity === 'important' ? 'amber' : 'neutral'}>{finding.severity === 'important' ? '需要关注' : finding.severity === 'question' ? '待核实' : '建议'}</Badge><h3>{types[finding.type]}</h3><span className="small muted">{decisions[finding.decision]}</span></div>
        <blockquote>{finding.target.quote}</blockquote>
        <p>{finding.explanation}</p><p className="review-suggestion">{finding.suggestion}</p>
        <div className="review-main-actions">
          {onPrepare && <Button variant="primary" disabled={locked || stale || dismissed} onClick={() => void run(index, () => onPrepare(index, notes[index] ?? finding.decision_note))}><PenNib size={17} />{busy === index ? '正在准备…' : '准备改写这一段'}</Button>}
          <SourceButton evidence={finding.target} onEvidence={onEvidence} label="定位待审正文" />
          {finding.source_evidence?.map((e, i) => <SourceButton key={i} evidence={e} onEvidence={onEvidence} />)}
        </div>
        {onPrepare && dismissed && <p className="small muted">此项已标记为{decisions[finding.decision]}，如需改写请先调整作者判断。</p>}
        <details className="review-author-decision"><summary>作者判断与说明</summary>
          <Field label="作者说明（可选）"><textarea disabled={locked} rows={2} maxLength={2000} value={notes[index] ?? finding.decision_note} onChange={e => setNotes(values => ({ ...values, [index]: e.target.value }))} placeholder="例如：这是有意安排的回忆，后文会解释。" /></Field>
          <div className="finding-actions">{(['confirmed', 'intentional', 'false_positive', 'later', 'pending'] as const).map(decision => <button key={decision} disabled={locked} aria-pressed={finding.decision === decision} onClick={() => void run(index, () => decide(index, decision))}>{decision === 'pending' ? '待判断' : decisions[decision]}</button>)}<Button variant="ghost" disabled={locked} onClick={() => void run(index, () => decide(index, finding.decision))}>保存说明</Button></div>
        </details>
        {error?.index === index && <Notice>{error.message}<Button disabled={locked} onClick={() => void run(index, async () => { const latest = await api.job(job.id, job.novel_id); cache.setQueryData(['job', job.id], latest) })}>读取最新判断</Button></Notice>}
      </article>
    })}
  </div>
}
