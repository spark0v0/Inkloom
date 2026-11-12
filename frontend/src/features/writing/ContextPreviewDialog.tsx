import { useRef, useState } from 'react'
import { api, errorText } from '../../lib/api'
import type { Context, ContextInput, Evidence } from '../../lib/api'
import { Badge, Button, Modal, Notice } from '../../components/ui'
import { ContextDetails } from '../generation/JobPresentation'

export type ContextView = { context: Context; input?: ContextInput }

export function ContextPreviewDialog({ novelId, initial, onEvidence, onExcludedChange, onClose }: {
  novelId: string; initial: ContextView; onEvidence: (e: Evidence) => void
  onExcludedChange: (ids: string[]) => void; onClose: () => void
}) {
  const [context, setContext] = useState(initial.context)
  const [choices, setChoices] = useState(initial.context.sources)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  async function update(next: string[]) {
    if (!initial.input || pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const value = await api.context(novelId, { ...initial.input, excluded_source_ids: next })
      setContext(value)
      setChoices(previous => [...new Map([...previous, ...value.sources].map(source => [source.source_id, source])).values()])
      onExcludedChange(value.excluded_source_ids)
    } catch (e) { setError(errorText(e)) }
    finally { pending.current = false; setBusy(false) }
  }

  return <Modal open onOpenChange={value => !value && onClose()} dismissible={!busy} title="本次引用资料" wide className="context-preview-modal">
    <div className="context-preview-body">
      <Badge>{initial.input ? '生成预览' : '历史调用 · 只读'}</Badge>
      {initial.input && context.excluded_source_ids.length > 0 && <p className="small muted">已排除 {context.excluded_source_ids.length} 段自动前文。<Button variant="ghost" disabled={busy} onClick={() => void update([])}>恢复全部自动引用</Button></p>}
      {busy && <p role="status" className="small muted">正在重新计算引用与预算…</p>}
      {error && <Notice>{error}<span className="block small">仍保留上次成功的选择和估算，请处理后再调整。</span></Notice>}
      <ContextDetails context={context} onEvidence={onEvidence} excluded={context.excluded_source_ids}
        excludedSources={choices.filter(source => context.excluded_source_ids.includes(source.source_id))}
        disabled={busy} onToggle={initial.input ? id => void update(context.excluded_source_ids.includes(id) ? context.excluded_source_ids.filter(value => value !== id) : [...context.excluded_source_ids, id]) : undefined} />
    </div>
    <div className="modal-actions"><Button disabled={busy} onClick={onClose}>返回写作</Button></div>
  </Modal>
}
