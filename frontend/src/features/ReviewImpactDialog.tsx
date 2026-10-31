import { useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../lib/api'
import type { Navigate } from '../lib/route'
import { Badge, Button, Empty, Loading, Modal, Notice } from '../components/ui'
import { CheckCircle } from '@phosphor-icons/react'
import './review-impact.css'

export function ReviewImpactDialog({ novelId, workspaceId, navigate, onClose }: {
  novelId: string; workspaceId: string; navigate: Navigate; onClose: () => void
}) {
  const cache = useQueryClient()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const impact = useInfiniteQuery({ queryKey: ['review-impact', novelId],
    initialPageParam: { after: 0, fingerprint: undefined as string | undefined },
    queryFn: ({ pageParam }) => api.reviewImpact(novelId, pageParam.after, pageParam.fingerprint, workspaceId),
    getNextPageParam: page => page.next_after == null ? undefined : { after: page.next_after, fingerprint: page.source_fingerprint }, staleTime: 0 })
  const first = impact.data?.pages[0]
  async function openChapter(id: string) {
    setBusy(true); setError('')
    try { await navigate({ page: 'write', novelId, chapterId: id }); onClose() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open title="改稿复核清单" wide dismissible={!busy} onOpenChange={value => { if (!value && !busy) onClose() }}>
    <p className="small muted">按章节顺序检查后重新定稿。清单列出已保存正文的变化与必读前文；其余后章保留待复核状态。</p>
    {impact.isPending ? <Loading label="正在读取复核清单…" /> : <>
      {first && <div className="section-heading"><strong>{first.total} 章待复核</strong><Button disabled={impact.isFetching} onClick={() => void cache.resetQueries({ queryKey: ['review-impact', novelId] })}>{impact.isFetching ? '正在刷新…' : '刷新清单'}</Button></div>}
      {first?.total === 0 && <Empty icon={<CheckCircle size={28} />} title="暂无需要复核的定稿" />}
      <div className="review-impact-list">{impact.data?.pages.flatMap(page => page.items).map(item => <article key={item.chapter_id}>
        <div className="section-heading"><h3>{item.title}</h3><Badge>{item.manuscript_changed ? '正文已修改' : '前文变化，待复核'}</Badge></div>
        {item.references.map(reference => <p className="small" key={reference.chapter_id}>必读前文《{reference.title}》{reference.current_version_id !== reference.selected_version_id ? '已有新定稿，需重新选择参考。' : '尚待复核，需先确认前文。'}</p>)}
        {item.manuscript_changed && <ReviewComparisonDetails novelId={novelId} chapterId={item.chapter_id} acceptedId={item.accepted_version_id} workingId={item.working_version_id} workspaceId={workspaceId} />}
        <Button disabled={busy} onClick={() => void openChapter(item.chapter_id)} aria-label={`打开章节：${item.title}`}>打开章节</Button>
      </article>)}</div>
      {impact.hasNextPage && <Button disabled={impact.isFetchingNextPage} onClick={() => void impact.fetchNextPage()}>加载后续待复核章</Button>}
    </>}
    {impact.error && <Notice action={<Button onClick={() => void cache.resetQueries({ queryKey: ['review-impact', novelId] })}>刷新清单</Button>}>{errorText(impact.error)}</Notice>}
    {error && <Notice>{error}</Notice>}
    <div className="modal-actions"><Button disabled={busy} onClick={onClose}>关闭</Button>{first?.first_chapter_id && <Button variant="primary" disabled={busy || impact.isFetching || !!impact.error} onClick={() => void openChapter(first.first_chapter_id!)}>从最早待复核章开始</Button>}</div>
  </Modal>
}

type ComparisonProps = {
  novelId: string; chapterId: string; acceptedId: string; workingId: string; workspaceId: string
}

function ReviewComparisonDetails(props: ComparisonProps) {
  const [open, setOpen] = useState(false)
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>比较定稿与当前正文</summary>{open && <ReviewComparison {...props} />}</details>
}

function ReviewComparison({ novelId, chapterId, acceptedId, workingId, workspaceId }: ComparisonProps) {
  const versions = useQuery({ queryKey: ['review-comparison', novelId, chapterId, acceptedId, workingId],
    queryFn: () => Promise.all([api.version(novelId, chapterId, acceptedId, workspaceId), api.version(novelId, chapterId, workingId, workspaceId)]) })
  if (versions.isPending) return <Loading label="正在读取两个版本…" />
  if (versions.error) return <Notice action={<Button onClick={() => void versions.refetch()}>重试读取</Button>}>{errorText(versions.error)}</Notice>
  return <div className="review-impact-comparison"><section><h4>原定稿</h4><pre>{versions.data![0].text}</pre></section><section><h4>当前已保存正文</h4><pre>{versions.data![1].text}</pre></section></div>
}
