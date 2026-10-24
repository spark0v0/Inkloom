import { ArrowRight } from '@phosphor-icons/react'
import type { Evidence, JobDetail } from '../lib/api'
import { Button, Notice } from '../components/ui'

type Props = {
  job: JobDetail
  onEvidence: (evidence: Evidence) => void
  onChoose?: (index: number) => void
  disabled?: boolean
}

export function InspirationResult({ job, onEvidence, onChoose, disabled }: Props) {
  if (job.result?.kind !== 'inspiration') return null
  const usable = job.state === 'succeeded' && job.candidate_status === 'ready' && !disabled
  return <div className="inspiration-result">
    <div className="inspiration-diagnosis"><h3>当前卡点</h3><p>{job.result.diagnosis}</p></div>
    <p className="small muted">三个待选方向 · 尚未发生</p>
    {job.result.options.map((option, index) => <article className="inspiration-card" key={index}>
      <div className="inspiration-card-heading"><span className="inspiration-number" aria-hidden="true">{index + 1}</span><h3>{option.title}</h3></div>
      <p>{option.event}</p>
      <details><summary>展开情节与依据</summary>
        <dl><dt>人物动机</dt><dd>{option.motivation}</dd><dt>必须作出的选择</dt><dd>{option.choice}</dd><dt>代价</dt><dd>{option.cost}</dd></dl>
        <h4>接下来可以这样推进</h4><ol>{option.beats.map((beat, i) => <li key={i}>{beat}</li>)}</ol>
        {(option.required_setup || []).length > 0 && <div className="inspiration-setup"><h4>需要补充或核对的铺垫</h4><ul>{option.required_setup?.map((setup, i) => <li key={i}>{setup}</li>)}</ul></div>}
        <h4>前文依据</h4>{(option.evidence || []).length ? option.evidence?.map((evidence, i) => <div className="inspiration-evidence" key={i}><blockquote>{evidence.quote}</blockquote><button className="source-button" onClick={() => onEvidence(evidence)}>{evidence.chapter_title || '查看原文'}<ArrowRight size={14} /></button></div>) : <p className="small muted">暂无原文依据，属于待核实的创作建议。</p>}
      </details>
      {onChoose && <Button disabled={!usable} onClick={() => onChoose(index)}>用这个方向续写<ArrowRight size={16} /></Button>}
    </article>)}
    {!usable && onChoose && <Notice>正文或参考已变化，旧方向仍可阅读。请重新找灵感后再用于续写。</Notice>}
  </div>
}
