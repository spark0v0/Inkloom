import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, LinkSimple, MagnifyingGlass } from '@phosphor-icons/react'
import { ApiError, api, errorText, uuid } from '../lib/api'
import type { ChapterSummary, Entity, Evidence, Thread, ThreadProgressInput } from '../lib/api'
import { threadStageNames, threadStatusNames } from '../lib/threads'
import { Badge, Button, Empty, Field, Loading, Modal, Notice } from '../components/ui'
import { SourceButton } from '../components/SourceButton'

type Props = { novelId: string; onEvidence: (e: Evidence) => void; onEdit: (e: Entity) => void; onCreate: () => void; initialThreadId?: string }

export function ThreadPanel({ novelId, onEvidence, onEdit, onCreate, initialThreadId }: Props) {
  const tracks = useQuery({ queryKey: ['threads', novelId], queryFn: () => api.threads(novelId) })
  const chapters = useQuery({ queryKey: ['chapters', novelId], queryFn: () => api.chapters(novelId) })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(initialThreadId || null)
  const rows = (tracks.data || []).filter(track => (!filter || (filter === 'paused' ? track.paused : track.status === filter)) &&
    `${track.entity.name} ${track.entity.summary} ${(track.entity.aliases || []).join(' ')} ${track.intent}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const current = rows.find(track => track.entity.id === selected) || rows[0]
  return <section aria-label="伏笔跟进" className="thread-panel">
    <div className="thread-toolbar"><label className="search-input"><MagnifyingGlass size={18} /><input aria-label="搜索伏笔" placeholder="搜索伏笔、别名或安排" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <select aria-label="筛选伏笔状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="">全部状态</option>{Object.entries(threadStatusNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}<option value="paused">已暂缓</option></select>
    </div>
    {tracks.isPending || chapters.isPending ? <Loading /> : tracks.error || chapters.error ? <Notice>{errorText(tracks.error || chapters.error)}<Button onClick={() => { void tracks.refetch(); void chapters.refetch() }}>重新读取</Button></Notice> : !current ?
      <Empty icon={<GitBranch size={32} />} title={search || filter ? '没有符合条件的伏笔' : '还没有伏笔'}>{search || filter ? <Button onClick={() => { setSearch(''); setFilter('') }}>清除筛选</Button> : <Button onClick={onCreate}>新建伏笔</Button>}</Empty> :
      <div className="thread-workspace"><nav className="thread-list" aria-label="伏笔列表">{rows.map(track => <button key={track.entity.id} className={track.entity.id === current.entity.id ? 'selected' : ''} aria-current={track.entity.id === current.entity.id ? 'true' : undefined} onClick={() => setSelected(track.entity.id)}>
        <strong>{track.entity.name}</strong><p>{track.entity.summary}</p><span className="thread-row-meta"><Badge tone={track.status === 'needs_review' ? 'amber' : 'neutral'}>{threadStatusNames[track.status]}</Badge>{track.paused ? <span>已暂缓</span> : track.target_position ? <span>计划第 {track.target_position} 章回收</span> : <span>未安排回收章节</span>}</span>
      </button>)}</nav><ThreadDetail key={current.entity.id} track={current} chapters={chapters.data || []} novelId={novelId} onEvidence={onEvidence} onEdit={onEdit} /></div>}
  </section>
}

function ThreadDetail({ track, chapters, novelId, onEvidence, onEdit }: { track: Thread; chapters: ChapterSummary[] } & Omit<Props, 'onCreate'>) {
  const cache = useQueryClient()
  const [intent, setIntent] = useState(track.intent)
  const [target, setTarget] = useState(track.target_chapter_id || '')
  const [paused, setPaused] = useState(track.paused)
  const [revision, setRevision] = useState(track.revision)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  useEffect(() => {
    if (!dirty && !busy) { setIntent(track.intent); setTarget(track.target_chapter_id || ''); setPaused(track.paused); setRevision(track.revision) }
  }, [track, dirty, busy])
  function update(value: Thread) {
    cache.setQueryData<Thread[]>(['threads', novelId], old => old?.map(item => item.entity.id === value.entity.id ? value : item))
    const samePlan = value.intent === track.intent && value.target_chapter_id === track.target_chapter_id && value.paused === track.paused
    if (revision === track.revision && (!dirty || samePlan)) setRevision(value.revision)
    void cache.invalidateQueries({ queryKey: ['novel', novelId] })
    void cache.invalidateQueries({ queryKey: ['jobs'] })
  }
  async function readLatest() {
    setBusy(true)
    try {
      const latest = await api.threads(novelId)
      const value = latest.find(item => item.entity.id === track.entity.id)
      cache.setQueryData(['threads', novelId], latest)
      if (value) { setRevision(value.revision); setError(''); setMessage('已读取最新记录。你的安排仍保留，比较后再保存。') }
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function savePlan() {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { const value = await api.saveThreadPlan(novelId, track.entity.id, { base_revision: revision, target_chapter_id: target || null, intent, paused }); update(value); setDirty(false); setMessage('安排已保存') }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function change(id: string, voided: boolean) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { update(await api.changeThreadProgress(novelId, track.entity.id, id, { base_revision: track.revision, voided })); setMessage(voided ? '关联已撤销，原文保留' : '关联已恢复') }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  function edit() { setDirty(true); setMessage('') }
  const active = track.progress.filter(item => !item.voided)
  const withdrawn = track.progress.filter(item => item.voided)
  function record(item: Thread['progress'][number]) {
    return <article className={`thread-progress ${item.valid ? '' : 'thread-progress-stale'}`} key={item.id} aria-label={`${threadStageNames[item.stage]}记录：${item.chapter_title}`}>
      <div className="section-heading"><strong>第 {item.chapter_position} 章 · {item.chapter_title}</strong><Badge tone={!item.valid && !item.voided ? 'amber' : 'neutral'}>{threadStageNames[item.stage]}</Badge></div>
      <blockquote>{item.evidence.quote}</blockquote>{item.note && <p>{item.note}</p>}{!item.valid && !item.voided && <p className="thread-warning">待复核：{item.invalid_reason}</p>}
      <div className="thread-record-actions"><SourceButton evidence={item.evidence} onEvidence={onEvidence} label="查看原文" /><Button variant="ghost" disabled={busy} onClick={() => void change(item.id, !item.voided)}>{item.voided ? '恢复关联' : '撤销关联'}</Button></div>
    </article>
  }
  return <section className="thread-detail" aria-label="伏笔详情">
    <div className="section-heading"><h2>{track.entity.name}</h2><Badge tone={track.status === 'needs_review' ? 'amber' : 'neutral'}>{threadStatusNames[track.status]}</Badge><Button variant="ghost" onClick={() => onEdit(track.entity)}>编辑设定</Button></div>
    {track.entity.summary && <p className="thread-intro">{track.entity.summary}</p>}
    {track.entity.status === 'proposed' && <Notice>这条设定尚待作者确认。确认前不会进入默认写作参考。</Notice>}
    <form className="thread-plan" onSubmit={e => { e.preventDefault(); void savePlan() }}><h3>作者计划</h3><fieldset disabled={busy}>
      <Field label="计划回收章节"><select value={target} onChange={e => { setTarget(e.target.value); edit() }}><option value="">暂不安排</option>{chapters.map(c => <option key={c.id} value={c.id}>第 {c.position} 章 · {c.title}</option>)}</select></Field>
      <Field label="届时如何推进或回收"><textarea rows={3} maxLength={2000} value={intent} onChange={e => { setIntent(e.target.value); edit() }} placeholder="例如：让商人认出刻印，但暂不揭晓失踪者的身份" /></Field>
      <label className="checkbox-label"><input type="checkbox" checked={paused} onChange={e => { setPaused(e.target.checked); edit() }} />暂缓自动跟进提醒</label>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存安排'}</Button>
    </fieldset></form>
    {dirty && (revision !== track.revision || message.startsWith('已读取')) && <Notice>当前已保存的安排：{track.intent || '未填写'}；回收章节：{track.target_chapter_title || '未安排'}。你的输入仍保留。</Notice>}
    {error && <Notice>{error}<Button disabled={busy} onClick={() => void readLatest()}>读取最新记录</Button></Notice>}
    {message && <p role="status" className="thread-save-message">{message}</p>}
    <div className="section-heading thread-progress-heading"><h3>跟进记录</h3><Button disabled={busy || track.status === 'resolved'} onClick={() => setLinkOpen(true)}><LinkSimple size={18} />关联正文进展</Button></div>
    {active.length ? <div className="thread-timeline">{active.map(record)}</div> : <p className="muted">还没有关联正文。选择已定稿的段落，记录埋设、推进或回收。</p>}
    {!!withdrawn.length && <details className="thread-withdrawn"><summary>已撤销记录（{withdrawn.length}）</summary>{withdrawn.map(record)}</details>}
    {linkOpen && <ProgressDialog novelId={novelId} track={track} chapters={chapters} onClose={() => setLinkOpen(false)} onSaved={value => { update(value); setLinkOpen(false); setMessage('正文进展已关联') }} />}
  </section>
}

function ProgressDialog({ novelId, track, chapters, onClose, onSaved }: { novelId: string; track: Thread; chapters: ChapterSummary[]; onClose: () => void; onSaved: (value: Thread) => void }) {
  const cache = useQueryClient()
  const confirmed = chapters.filter(c => c.review_state === 'confirmed' && c.accepted_version_id)
  const [chapterId, setChapterId] = useState(confirmed[0]?.id || '')
  const [paragraphId, setParagraphId] = useState('')
  const [stage, setStage] = useState<ThreadProgressInput['stage']>(track.status === 'planned' ? 'planted' : 'advanced')
  const [note, setNote] = useState('')
  const [revision, setRevision] = useState(track.revision)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<ThreadProgressInput | null>(null)
  const chapter = confirmed.find(c => c.id === chapterId)
  const version = useQuery({ queryKey: ['version', novelId, chapterId, chapter?.accepted_version_id], queryFn: () => api.version(novelId, chapterId, chapter!.accepted_version_id!), enabled: !!chapter?.accepted_version_id })
  const paragraph = version.data?.paragraphs.find(p => p.paragraph_id === paragraphId) || version.data?.paragraphs[0]
  const sourceQuote = Array.from(paragraph?.text || '').slice(0, 10000).join('')
  async function save() {
    if (busy || !chapter || !paragraph || !version.data) return
    setBusy(true); setError('')
    const body = pending.current || { base_revision: revision, operation_id: uuid(), chapter_id: chapter.id, version_id: version.data.id,
      stage, evidence: { source_id: `${version.data.id}:${paragraph.paragraph_id}`, quote: sourceQuote }, note }
    pending.current = body
    try { const value = await api.addThreadProgress(novelId, track.entity.id, body); pending.current = null; onSaved(value) }
    catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.current = null; setError(errorText(e)) }
    finally { setBusy(false) }
  }
  async function reload() {
    setBusy(true)
    try {
      const latest = await api.threads(novelId)
      const latestChapters = await api.chapters(novelId)
      cache.setQueryData(['threads', novelId], latest); cache.setQueryData(['chapters', novelId], latestChapters)
      const current = latest.find(t => t.entity.id === track.entity.id)
      if (current) setRevision(current.revision)
      setError(''); setParagraphId('')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && !busy && onClose()} title="关联正文进展" wide>
    {!confirmed.length ? <Notice>还没有已定稿章节。先在章节写作中完成定稿，再关联原文。</Notice> : <form onSubmit={e => { e.preventDefault(); void save() }} className="form-stack">
      <fieldset disabled={busy || !!pending.current} className="form-stack"><Field label="已定稿章节"><select value={chapterId} onChange={e => { setChapterId(e.target.value); setParagraphId('') }}>{confirmed.map(c => <option key={c.id} value={c.id}>第 {c.position} 章 · {c.title}</option>)}</select></Field>
        <Field label="原文段落"><select value={paragraph?.paragraph_id || ''} onChange={e => setParagraphId(e.target.value)}>{version.data?.paragraphs.map((p, i) => <option key={p.paragraph_id} value={p.paragraph_id}>第 {i + 1} 段 · {p.text.slice(0, 70)}</option>)}</select></Field>
        {version.isPending ? <Loading /> : version.error ? <Notice>{errorText(version.error)}</Notice> : paragraph && <blockquote className="thread-source-preview" tabIndex={0}>{sourceQuote}{Array.from(paragraph.text).length > 10000 && <small>（本次关联前 10000 个字符）</small>}</blockquote>}
        <Field label="进展类型"><select value={stage} onChange={e => setStage(e.target.value as ThreadProgressInput['stage'])}>{Object.entries(threadStageNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
        <Field label="作者说明（可选）"><textarea rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </fieldset>
      {error && <Notice>{error}{pending.current ? <p>保存回执未确认，请重试确认同一次关联。</p> : <Button disabled={busy} onClick={() => void reload()}>读取最新记录和章节</Button>}</Notice>}
      <div className="modal-actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy || !paragraph || !chapter || version.isError}>{busy ? '正在关联…' : pending.current ? '重试确认关联' : '确认关联'}</Button></div>
    </form>}
  </Modal>
}
