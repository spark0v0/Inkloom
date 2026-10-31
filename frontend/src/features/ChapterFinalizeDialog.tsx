import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Plus, Sparkle, X } from '@phosphor-icons/react'
import { activeStates, ApiError, api, dateLabel, errorText, number, uuid } from '../lib/api'
import type { CanonPreparation, Chapter, Evidence, JobInput, MemoryProposal, Novel, Provider, Roles, Version } from '../lib/api'
import { Badge, Button, Field, Loading, Modal, Notice } from '../components/ui'
import { SourceButton } from './JobPresentation'
import { useJobStream } from '../lib/useJobStream'

type Submission = { body: Parameters<typeof api.confirm>[2]; next: boolean }

export function CanonDialog({ novel, chapter, version, workspaceId, proposed: initialProposed, onEvidence, onClose, providers, roles, onNext }: {
  novel: Novel; chapter: Chapter; version: Version; workspaceId: string; proposed: MemoryProposal[];
  onEvidence: (e: Evidence) => void; onClose: () => void; providers: Provider[]; roles: Roles; onNext: () => Promise<void>
}) {
  const cache = useQueryClient()
  const preparation = useQuery({ queryKey: ['canon', novel.id, chapter.id, version.id], queryFn: () => api.prepareCanon(novel.id, chapter.id, workspaceId), staleTime: 0 })
  const entities = useQuery({ queryKey: ['entities', novel.id], queryFn: () => api.entities(novel.id) })
  const [basis, setBasis] = useState<CanonPreparation | null>(null)
  const [latest, setLatest] = useState<CanonPreparation | null>(null)
  const [proposed, setProposed] = useState(initialProposed)
  const [selected, setSelected] = useState<number[]>([])
  const [manual, setManual] = useState<MemoryProposal[]>([])
  const [providerId, setProviderId] = useState(roles.extractor || 'demo')
  const [jobId, setJobId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Submission | null>(null)
  const [paragraph, setParagraph] = useState(version.paragraphs[0]?.paragraph_id || '')
  const [claim, setClaim] = useState('')
  const [kind, setKind] = useState<MemoryProposal['kind']>('event')
  const [storyTime, setStoryTime] = useState('')
  const [knownBy, setKnownBy] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<JobInput | null>(null)
  const applied = useRef<string | null>(null)
  const operationId = useRef(uuid())
  const composing = useRef(false)
  const provider = providers.find(p => p.id === providerId)
  const jobs = useQuery({ queryKey: ['jobs', novel.id, chapter.id, version.id, 'extract-summary'],
    queryFn: () => api.jobHistory({ novel_id: novel.id, chapter_id: chapter.id, task: 'extract', base_version_id: version.id }, workspaceId), enabled: !!basis && !basis.confirmed })
  const matching = jobId || (!basis?.confirmed ? jobs.data?.items.find(j => !['cancelled', 'failed'].includes(j.state))?.id : undefined)
  const job = useQuery({ queryKey: ['job', matching], queryFn: () => api.job(matching!, novel.id, undefined, workspaceId), enabled: !!matching })
  useJobStream(job.data)
  const active = !!job.data && activeStates.has(job.data.state)
  const locked = busy || !!confirmation || !basis || basis.version_id !== version.id

  function loadBasis(value: CanonPreparation, changes = value.changes) {
    setBasis(value); setProposed(changes); setSelected(changes.map((_, i) => i)); setManual([]); setLatest(null)
  }
  useEffect(() => {
    if (!basis && preparation.data && !preparation.isFetching && !preparation.error) loadBasis(preparation.data, preparation.data.confirmed ? preparation.data.changes : initialProposed)
  }, [basis, preparation.data, preparation.isFetching, preparation.error, initialProposed])
  useEffect(() => {
    if (basis && (!basis.confirmed || jobId) && !confirmation && job.data?.state === 'succeeded' && job.data.result?.kind === 'extract' && job.data.base_version_id === version.id && applied.current !== job.data.id) {
      applied.current = job.data.id
      setProposed(job.data.result.changes); setSelected(job.data.result.changes.map((_, i) => i))
    }
  }, [basis, confirmation, job.data, jobId, version.id])

  async function summarize() {
    if (locked || active || composing.current) return
    setBusy(true); setError('')
    try {
      pending.current ||= { chapter_id: chapter.id, base_version_id: version.id, references_revision: chapter.references_revision, task: 'extract',
        provider_id: providerId, instruction: '整理本章已经发生的人物变化、事件与伏笔，不把计划当事实。',
        target_chars: novel.chapter_words, chapter_batch: 5, max_attempts: 1, idempotency_key: uuid() }
      const value = await api.createJob(novel.id, pending.current, workspaceId)
      pending.current = null; setJobId(value.id); cache.setQueryData(['job', value.id], value)
      await cache.invalidateQueries({ queryKey: ['jobs', novel.id] })
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.current = null
      setError(errorText(e))
    } finally { setBusy(false) }
  }
  function add() {
    const source = version.paragraphs.find(p => p.paragraph_id === paragraph)
    if (locked || composing.current || !claim.trim() || !source) return
    setManual(previous => [...previous, { kind, claim, subject: '', story_time: storyTime || null, known_by: knownBy,
      evidence: [{ source_id: `${version.id}:${source.paragraph_id}`, quote: source.text }] }])
    setClaim(''); setKnownBy([])
  }
  async function confirm(next = false) {
    if (busy || !basis || basis.version_id !== version.id || active || pending.current || composing.current) return
    const submission = confirmation || { body: { version_id: version.id, operation_id: operationId.current,
      base_canon_revision: basis.canon_revision, changes: [...proposed.filter((_, i) => selected.includes(i)), ...manual] }, next }
    setConfirmation(submission); setBusy(true); setError('')
    try {
      const receipt = await api.confirm(novel.id, chapter.id, submission.body, workspaceId)
      const current = await api.prepareCanon(novel.id, chapter.id, workspaceId)
      if (current.version_id !== version.id || !current.confirmed || current.canon_revision !== receipt.revision) {
        setConfirmation(null); operationId.current = uuid(); setLatest(current)
        setError('定稿请求已处理，但定稿记录随后发生变化。请比较最新记忆后重新复核。'); return
      }
      await Promise.all([['novel', novel.id], ['chapter', novel.id, chapter.id], ['chapters', novel.id], ['facts', novel.id], ['novels'], ['canon', novel.id, chapter.id]].map(queryKey => cache.invalidateQueries({ queryKey })))
      setConfirmation(null); onClose(); if (submission.next) await onNext()
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setConfirmation(null); operationId.current = uuid()
        if (e.code === 'CANON_CONFLICT') setLatest(await api.prepareCanon(novel.id, chapter.id, workspaceId).catch(() => null))
      }
      setError(errorText(e))
    } finally { setBusy(false) }
  }
  return <Modal open dismissible={!busy && !confirmation} onOpenChange={open => { if (!open && !busy && !confirmation) onClose() }} title="本章定稿" wide>
    <div className="canon-summary"><CheckCircle size={24} /><div><strong>{chapter.title}</strong><span>{number(version.char_count)} 字 · {dateLabel(version.created_at)}</span></div><Badge>正文将用于后续章节</Badge></div>
    {!basis && preparation.isFetching && <Loading label="正在读取定稿记忆…" />}
    {preparation.error && <Notice action={<Button onClick={() => void preparation.refetch()}>重试读取</Button>}>{errorText(preparation.error)}</Notice>}
    {basis && basis.version_id !== version.id && <Notice>正文版本已变化，请返回章节读取最新内容。</Notice>}
    <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
      <legend className="sr-only">本章记忆与原文依据</legend>
      <section className="finalize-memory">
        <div className="section-heading"><div><h3>本章记忆</h3><p className="muted small">{basis?.confirmed ? '已载入作者确认的记忆，修改后可重新定稿。' : '整理人物变化与伏笔，供后文引用。'}</p></div><Badge tone={provider?.kind === 'demo' ? 'amber' : 'neutral'}>{provider?.kind === 'demo' ? '演示样例' : provider?.model}</Badge></div>
        <div className="finalize-model-row"><label><span className="sr-only">记忆整理模型</span><select aria-label="记忆整理模型" disabled={busy || active || !!pending.current} value={providerId} onChange={e => setProviderId(e.target.value)}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Button onClick={() => void summarize()} disabled={busy || active || !provider || (provider.kind !== 'demo' && !provider.has_key)}><Sparkle size={17} />{active ? '正在整理…' : pending.current ? '确认上次提交' : 'AI 整理本章记忆'}</Button></div>
        {pending.current && <Notice>上次提交尚未确认，将使用原模型确认同一次请求。</Notice>}
        {job.data?.error_message && <Notice>{job.data.error_message}</Notice>}
        {!proposed.length && !active && basis && <p className="small muted">也可以直接定稿，仅将正文用于后续创作。</p>}
      </section>
      {proposed.map((p, i) => <div className="canon-proposal" key={i}><label><input type="checkbox" checked={selected.includes(i)} onChange={() => setSelected(value => value.includes(i) ? value.filter(n => n !== i) : [...value, i])} /><span>{p.claim}</span></label>{p.evidence.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}</div>)}
      {manual.map((p, i) => <div className="canon-proposal" key={`manual-${i}`}><div className="button-row"><Badge>手动整理</Badge><p>{p.claim}</p><button className="icon-button" aria-label="移除此项变化" onClick={() => setManual(items => items.filter((_, n) => n !== i))}><X size={16} /></button></div><blockquote>{p.evidence[0].quote}</blockquote></div>)}
      <details className="manual-fact"><summary><Plus size={16} />手动添加一条变化</summary><div className="form-stack">
        <Field label="原文依据"><select value={paragraph} onChange={e => setParagraph(e.target.value)}>{version.paragraphs.map(p => <option key={p.paragraph_id} value={p.paragraph_id}>{p.text.slice(0, 85)}</option>)}</select></Field>
        <Field label="概括发生了什么"><textarea rows={2} maxLength={3000} value={claim} onChange={e => setClaim(e.target.value)} /></Field>
        <div className="form-row"><Field label="变化类型"><select value={kind} onChange={e => setKind(e.target.value as MemoryProposal['kind'])}><option value="event">事件</option><option value="state">人物或世界状态</option><option value="knowledge">人物获知的信息</option><option value="thread">伏笔</option></select></Field><Field label="故事发生时间（可选）"><input maxLength={240} value={storyTime} onChange={e => setStoryTime(e.target.value)} placeholder="如：抵达雾港的第二天" /></Field></div>
        {kind === 'knowledge' && <Field label="谁在此时获知此事？"><div className="checkbox-list">{entities.data?.filter(e => e.kind === 'character').map(e => <label key={e.id}><input type="checkbox" checked={knownBy.includes(e.id)} onChange={() => setKnownBy(values => values.includes(e.id) ? values.filter(v => v !== e.id) : [...values, e.id])} />{e.name}</label>)}</div></Field>}
        <Button disabled={!claim.trim() || !paragraph} onClick={add}>添加到本次确认</Button>
      </div></details>
    </fieldset>
    {error && <Notice>{error}</Notice>}
    {latest && <Notice tone="neutral"><details><summary>查看工作区最新记忆</summary>{latest.changes.map((item, i) => <p key={i}>{item.claim}</p>)}{!latest.changes.length && <p>当前没有记忆条目。</p>}</details><Button disabled={latest.version_id !== version.id} onClick={() => { loadBasis(latest); setError('') }}>采用最新记忆，重新编辑</Button></Notice>}
    {confirmation && !busy && <Notice>定稿结果尚未确认。原记忆与操作号已保留，请确认上次定稿。</Notice>}
    <div className="modal-actions"><Button disabled={busy || !!confirmation} onClick={onClose}>返回修改</Button>
      {confirmation ? <Button variant="primary" disabled={busy} onClick={() => void confirm()}>{busy ? '正在确认…' : '确认上次定稿'}</Button> : <>
        <Button disabled={locked || active || !!pending.current || !version.text.trim()} onClick={() => void confirm()}>仅定稿</Button>
        <Button variant="primary" disabled={locked || active || !!pending.current || !version.text.trim()} onClick={() => void confirm(true)}><CheckCircle size={17} />确认定稿，下一章</Button>
      </>}
    </div>
  </Modal>
}
