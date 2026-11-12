import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, MagnifyingGlass, X } from '@phosphor-icons/react'
import { Button, Empty, Loading, Modal, Notice } from '../components/ui'
import { api, errorText } from '../lib/api'
import type { Evidence, Novel } from '../lib/api'

export function SearchDialog({ novel, workspaceId, onClose, onEvidence, onLibrarySearch }: {
  novel?: Novel; workspaceId: string; onClose: () => void;
  onEvidence: (evidence: Evidence) => void; onLibrarySearch: (text: string) => void;
}) {
  const [query, setQuery] = useState('')
  const [settled, setSettled] = useState('')
  const term = query.trim()
  useEffect(() => {
    if (!novel || term === settled) return
    const timeout = setTimeout(() => setSettled(term), 250)
    return () => clearTimeout(timeout)
  }, [novel, term, settled])
  const results = useQuery({
    queryKey: ['search', novel?.id, settled],
    queryFn: () => api.search(novel!.id, settled, workspaceId),
    enabled: !!novel && !!term && settled === term,
  })

  let resultView
  if (novel && term) {
    if (settled !== term || results.isFetching || results.isPending) resultView = <Loading label="正在搜索定稿正文…" />
    else if (results.error) resultView = <Notice action={<Button onClick={() => void results.refetch()}>重新搜索</Button>}>{errorText(results.error)}</Notice>
    else if (!results.data?.length) resultView = <Empty icon={<MagnifyingGlass size={28} />} title="没有找到有效原文" />
    else resultView = results.data.map(({ source }) => <button className="search-result" key={source.source_id} onClick={() => onEvidence({ ...source, quote: source.text })}>
      <span>{source.chapter_title}<ArrowRight size={16} /></span><p>{source.text}</p>
    </button>)
  }

  return <Modal open onOpenChange={value => !value && onClose()} title={novel ? `搜索《${novel.title}》` : '搜索我的作品'}
    description={novel ? '搜索本书仍有效的定稿正文。' : '按书名、题材和故事方向搜索。'} wide>
    <div className="search-dialog-input">
      <MagnifyingGlass size={22} />
      <input autoFocus aria-label="输入搜索内容" maxLength={200} placeholder={novel ? '人物名或一句话…' : '书名或故事方向…'}
        value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !novel) onLibrarySearch(term) }} />
      {query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={17} /></button>}
    </div>
    {novel ? <div className="search-results">{resultView}</div> : <div className="modal-actions">
      <Button variant="primary" onClick={() => onLibrarySearch(term)}>搜索作品<ArrowRight size={17} /></Button>
    </div>}
  </Modal>
}
