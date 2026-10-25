import { ArrowRight, FileText } from '@phosphor-icons/react'
import type { Evidence } from '../lib/api'

export function SourceButton({ evidence, onEvidence, label }: { evidence: Evidence; onEvidence: (e: Evidence) => void; label?: string }) {
  return <button className="source-button" onClick={() => onEvidence(evidence)}><FileText size={16} /><span>{label || evidence.chapter_title || '查看原文'}</span><ArrowRight size={14} /></button>
}
