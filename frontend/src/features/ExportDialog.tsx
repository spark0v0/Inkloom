import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowClockwise } from '@phosphor-icons/react'
import { ApiError, api, downloadFile, errorText, exportQuery, npath, number } from '../lib/api'
import type { ExportOptions, Novel } from '../lib/api'
import { Badge, Button, Field, Loading, Modal, Notice } from '../components/ui'
import './export-dialog.css'

const reasons = { empty: '空白正文', unconfirmed: '尚未定稿', needs_review: '待重新定稿' }

export function ExportDialog({ novel, onClose, flush }: { novel: Novel; onClose: () => void; flush: () => Promise<unknown> }) {
  const [format, setFormat] = useState('txt')
  const [confirmed, setConfirmed] = useState(true)
  const [scope, setScope] = useState('all')
  const [start, setStart] = useState('1')
  const [end, setEnd] = useState(String(Math.max(1, novel.chapter_count)))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const from = Number(start), to = Number(end)
  const valid = scope === 'all' || [from, to].every(value => Number.isInteger(value) && value > 0 && value <= 2147483647) && from <= to
  const options: ExportOptions = { confirmed, ...(scope === 'range' ? { start_position: from, end_position: to } : {}) }
  const preview = useQuery({
    queryKey: ['export-preview', novel.id, confirmed, scope, from, to],
    queryFn: async () => { await flush(); return api.exportPreview(novel.id, options) },
    enabled: valid, staleTime: 0, retry: false,
  })
  const ready = valid && !!preview.data?.included_count && !preview.isFetching && !preview.isError && !busy

  async function download() {
    if (!ready || !preview.data) return
    setBusy(true); setError('')
    try {
      await flush()
      const query = exportQuery({ ...options, format, expected_fingerprint: preview.data.fingerprint })
      const range = scope === 'range' ? `-第${from}-${to}章` : ''
      await downloadFile(`${npath(novel.id)}/export?${query}`, `${preview.data.title}${range}-${confirmed ? '定稿' : '工作稿'}.${format}`)
      onClose()
    } catch (error) {
      setError(errorText(error))
      if (error instanceof ApiError && error.code === 'EXPORT_CHANGED') await preview.refetch()
    } finally { setBusy(false) }
  }

  return <Modal open onOpenChange={value => { if (!value && !busy) onClose() }} title="连载导出" className="export-dialog" dismissible={!busy}>
    <div className="export-body">
      <fieldset className="export-settings" disabled={busy} onChange={() => setError('')}>
        <Field label="格式"><select value={format} onChange={e => setFormat(e.target.value)}><option value="txt">合并 TXT</option><option value="zip">逐章 TXT（ZIP）</option><option value="md">Markdown</option></select></Field>
        <Field label="正文范围"><select value={confirmed ? 'confirmed' : 'working'} onChange={e => setConfirmed(e.target.value === 'confirmed')}><option value="confirmed">已定稿章节</option><option value="working">当前工作稿</option></select></Field>
        <Field label="章节范围"><select value={scope} onChange={e => setScope(e.target.value)}><option value="all">全部章节</option><option value="range">指定章序</option></select></Field>
        {scope === 'range' && <div className="export-range"><Field label="起始章序"><input type="number" min={1} max={2147483647} step={1} value={start} onChange={e => setStart(e.target.value)} /></Field><Field label="结束章序"><input type="number" min={1} max={2147483647} step={1} value={end} onChange={e => setEnd(e.target.value)} /></Field></div>}
      </fieldset>
      {!valid ? <Notice>请输入有效章序，起始章不能大于结束章。</Notice> : <>
        {preview.isFetching && <Loading label="正在读取导出预览…" />}
        {preview.error && <Notice action={<Button onClick={() => void preview.refetch()}>重新读取</Button>}>{errorText(preview.error)}</Notice>}
        {preview.data && !preview.error && !preview.isFetching && <section className="export-preview" aria-label="导出预览">
          <div className="export-preview-heading"><h3>本次导出</h3><Button variant="ghost" onClick={() => void preview.refetch()} disabled={busy} aria-label="刷新导出预览"><ArrowClockwise size={16} />刷新</Button></div>
          <p className="export-totals" role="status"><strong>{number(preview.data.included_count)} 章</strong><span>{number(preview.data.total_chars)} 字</span>{preview.data.skipped_count > 0 && <span>排除 {number(preview.data.skipped_count)} 章</span>}</p>
          {!confirmed && preview.data.chapters.some(chapter => chapter.included && chapter.review_state !== 'confirmed') && <Notice>当前工作稿包含尚未定稿的内容，请通读后再交稿。</Notice>}
          {!preview.data.included_count && <Notice tone="neutral">所选范围没有可导出的正文。{confirmed ? '请先定稿，或切换到当前工作稿。' : '请先写作或调整章节范围。'}</Notice>}
          {preview.data.chapters.length > 0 && <details className="export-chapters" open><summary>章节清单</summary><ol aria-label="导出章节清单">{preview.data.chapters.map(chapter => <li key={chapter.id} className={chapter.included ? '' : 'export-excluded'}><div><span className="export-order">{chapter.position}</span><span className="export-chapter-title">{chapter.title}</span></div><div><span>{number(chapter.char_count)} 字</span><Badge tone={chapter.included ? 'green' : 'neutral'}>{chapter.excluded_reason ? reasons[chapter.excluded_reason] : '纳入'}</Badge></div></li>)}</ol></details>}
        </section>}
      </>}
      {error && <Notice>{error}</Notice>}
    </div>
    <div className="modal-actions"><Button onClick={onClose} disabled={busy}>取消</Button><Button variant="primary" onClick={() => void download()} disabled={!ready}><ArrowDown size={17} />{busy ? '正在导出…' : '下载正文'}</Button></div>
  </Modal>
}
