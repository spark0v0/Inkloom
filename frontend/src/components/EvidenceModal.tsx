import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { ArrowSquareOut, Quotes } from '@phosphor-icons/react'
import { api, dateLabel, errorText } from '../lib/api'
import type { Evidence } from '../lib/api'
import { Badge, Loading, Modal, Notice } from './ui'

export function EvidenceModal({ evidence, onClose }: { evidence: Evidence | null; onClose: () => void }) {
  const marked = useRef<HTMLParagraphElement>(null)
  const version = useQuery({ queryKey: ['source-version', evidence?.version_id],
    queryFn: () => api.version(evidence!.novel_id!, evidence!.chapter_id!, evidence!.version_id!),
    enabled: !!(evidence?.novel_id && evidence.chapter_id && evidence.version_id) })
  useEffect(() => { if (version.data) marked.current?.scrollIntoView({ block: 'center' }) }, [version.data, evidence])
  return <Modal open={!!evidence} onOpenChange={value => !value && onClose()} title="原文依据" description="引用绑定指定正文版本；此处为只读查看，不会替换你的当前工作稿。" wide>
    {version.isLoading ? <Loading /> : version.error ? <Notice>{errorText(version.error)}</Notice> : version.data ? <>
      <div className="source-meta"><Badge tone="green">原文版本</Badge><span>{evidence?.chapter_title || '章节正文'}</span><span>{dateLabel(version.data.created_at)}</span><ArrowSquareOut size={16} /></div>
      <div className="source-manuscript">{version.data.paragraphs.map(p => {
        const selected = p.paragraph_id === evidence?.paragraph_id
        const quote = selected ? evidence?.quote : null
        const found = quote ? p.text.indexOf(quote) : -1
        return <p ref={selected ? marked : undefined} key={p.paragraph_id} className={selected ? 'source-selected' : ''}>{selected && <Quotes size={16} className="source-quote-icon" />}{found >= 0 && quote ? <>{p.text.slice(0, found)}<mark>{quote}</mark>{p.text.slice(found + quote.length)}</> : p.text}</p>
      })}</div>
    </> : <Notice>此引用缺少可以定位的版本信息。请回到任务记录查看来源，不会猜测原文位置。</Notice>}
  </Modal>
}
