import { useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, downloadText, errorText, number, uuid } from '../lib/api'
import type { Chapter, Version } from '../lib/api'
import { Button, Loading, Modal, Notice } from '../components/ui'

type RestoreRequest = { base: Version; body: Parameters<typeof api.save>[2] }
const timestamp = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function VersionHistoryDialog({ novelId, chapter, workspaceId, onClose, flush, onAdopt }: {
  novelId: string; chapter: Chapter; workspaceId: string; onClose: () => void
  flush: () => Promise<Version>; onAdopt: (version: Version, expected: Version) => void
}) {
  const cache = useQueryClient()
  const versions = useInfiniteQuery({ queryKey: ['versions', novelId, chapter.id], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.versionHistory(novelId, chapter.id, pageParam), getNextPageParam: page => page.next_before || undefined })
  const [selected, setSelected] = useState(chapter.working_version_id)
  const version = useQuery({ queryKey: ['version', novelId, chapter.id, selected], queryFn: () => api.version(novelId, chapter.id, selected, workspaceId) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const pending = useRef<RestoreRequest | null>(null)
  const [superseded, setSuperseded] = useState<{ current: Version; base: Version } | null>(null)
  const locked = busy || !!pending.current

  async function restore() {
    if (inFlight.current || superseded || (!pending.current && (!version.data || selected === chapter.working_version_id))) return
    const target = version.data
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (!pending.current) {
        const base = await flush()
        pending.current = { base, body: { base_version_id: base.id, operation_id: uuid(), text: target!.text, editor_doc: target!.editor_doc } }
      }
      const request = pending.current
      const saved = await api.save(novelId, chapter.id, request.body, workspaceId)
      // An idempotent receipt identifies the write, not necessarily the current manuscript.
      const current = await api.chapter(novelId, chapter.id, workspaceId)
      cache.setQueryData(['chapter', novelId, chapter.id], current)
      pending.current = null
      if (current.working_version_id !== saved.id) {
        setSuperseded({ current: current.version, base: request.base })
        setError('恢复已保存，但工作区随后又有修改。请核对最新正文。')
        return
      }
      onAdopt(saved, request.base); onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.current = null
      setError(errorText(e))
    } finally { inFlight.current = false; setBusy(false) }
  }

  const preview = superseded?.current ?? version.data
  return <Modal open title="章节版本" description="恢复会另存新版本，已有文字保留。" wide className="version-history-modal" dismissible={!locked}
    onOpenChange={value => { if (!value && !inFlight.current && !pending.current) onClose() }}>
    <div className="version-layout">
      <div className="version-list" aria-label="保存记录">
        {versions.isPending && <Loading label="正在读取版本…" />}
        {versions.error && <Notice action={<Button disabled={locked} onClick={() => void versions.refetch()}>重试读取记录</Button>}>{errorText(versions.error)}</Notice>}
        {versions.data?.pages.flatMap(page => page.items).map(value => <button key={value.id} className={selected === value.id ? 'active' : ''} aria-pressed={selected === value.id}
          disabled={locked || !!superseded} onClick={() => { setSelected(value.id); setError('') }}>
          <strong><time dateTime={value.created_at}>{timestamp.format(new Date(value.created_at))}</time></strong>
          <span>{number(value.char_count)} 字{value.id === chapter.working_version_id ? ' · 当前正文' : ''}{value.id === chapter.accepted_version_id ? ' · 定稿' : ''}</span>
        </button>)}
        {versions.hasNextPage && <Button disabled={locked || versions.isFetchingNextPage} onClick={() => void versions.fetchNextPage()}>{versions.isFetchingNextPage ? '读取中…' : '更早的版本'}</Button>}
      </div>
      <div className="version-body" role="region" aria-label={superseded ? '工作区最新正文' : '所选版本正文'} tabIndex={0}>
        {superseded && <h3>工作区最新正文</h3>}
        {version.isPending && !superseded ? <Loading label="正在读取所选版本…" /> : version.error && !superseded ? <Notice action={<Button onClick={() => void version.refetch()}>重试读取正文</Button>}>{errorText(version.error)}</Notice> : <div className="comparison-text">{preview?.text || '此版本为空。'}</div>}
      </div>
    </div>
    {error && <Notice>{error}</Notice>}
    {preview && !preview.text && !superseded && <Notice tone="neutral">此版本没有正文。恢复后将得到空白正文，已有版本仍保留。</Notice>}
    {pending.current && !busy && <Notice>上次恢复尚未确认，已保留原版本和请求。请确认上次恢复。</Notice>}
    <div className="modal-actions">
      <Button disabled={!preview} onClick={() => preview && downloadText(preview.text, `${chapter.title}-版本副本.txt`)}>下载此版</Button>
      <Button disabled={locked} onClick={onClose}>关闭</Button>
      {superseded ? <Button variant="primary" onClick={() => { onAdopt(superseded.current, superseded.base); onClose() }}>查看最新正文</Button> :
        <Button variant="primary" disabled={busy || (!pending.current && (!version.data || selected === chapter.working_version_id))} onClick={() => void restore()}>{busy ? '正在确认恢复…' : pending.current ? '确认上次恢复' : preview && !preview.text ? '恢复空白版本' : '恢复为新版本'}</Button>}
    </div>
  </Modal>
}
