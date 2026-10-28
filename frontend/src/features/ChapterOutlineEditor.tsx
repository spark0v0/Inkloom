import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, ClockCounterClockwise, Plus, Sparkle, X } from '@phosphor-icons/react'
import { activeStates, ApiError, api, dateLabel, errorText, jobStateNames, uuid } from '../lib/api'
import type { Context, ContextInput, Evidence, JobInput, Novel, OutlineDocument, OutlineField, OutlineHistoryItem, OutlineRevision, OutlineState } from '../lib/api'
import type { Navigate } from '../lib/route'
import { outlineDrafts } from '../lib/drafts'
import type { OutlineRecoveryDraft } from '../lib/drafts'
import { outlineFields, outlineText, outlineValue, rebaseOutline, sameOutline, structuredFields } from '../lib/outlines'
import { useJobStream } from '../lib/useJobStream'
import { Badge, Button, Field, Loading, Modal, Notice } from '../components/ui'
import { ProviderDisclosure } from '../components/ProviderDisclosure'
import { ContextDetails } from './JobPresentation'

type Operation =
  | { kind: 'save'; data: Parameters<typeof api.saveChapterOutline>[2] }
  | { kind: 'generate'; data: JobInput }
  | { kind: 'adopt'; job: string; data: Parameters<typeof api.applyOutlineEdit>[2] }
  | { kind: 'restore'; revision: number; data: Parameters<typeof api.restoreOutline>[3] }

type Props = { novel: Novel; chapterId: string; workspaceId: string; navigate: Navigate; registerGuard: (guard: (() => Promise<unknown>) | null) => void; onEvidence: (e: Evidence) => void }

export function ChapterOutlineEditor({ novel, chapterId, workspaceId, navigate, registerGuard, onEvidence }: Props) {
  const cache = useQueryClient()
  const read = useQuery({ queryKey: ['chapter-outline', novel.id, chapterId], queryFn: () => api.chapterOutline(novel.id, chapterId) })
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles })
  const [base, setBase] = useState<OutlineState | null>(null)
  const [draft, setDraft] = useState<OutlineDocument | null>(null)
  const [remote, setRemote] = useState<OutlineState | null>(null)
  const [formatConflict, setFormatConflict] = useState(false)
  const [recovery, setRecovery] = useState<OutlineRecoveryDraft | null>(null)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [tab, setTab] = useState('outline')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [scope, setScope] = useState('all')
  const [instruction, setInstruction] = useState('')
  const [selected, setSelected] = useState<OutlineField[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [pending, setPending] = useState<Operation | null>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const preparingRef = useRef(false)
  const [context, setContext] = useState<Context | null>(null)
  const [error, setError] = useState('')
  const composing = useRef(false)
  const queue = useRef(Promise.resolve())
  const [tabId] = useState(() => {
    try { const value = sessionStorage.getItem('inkloom-outline-tab') || uuid(); sessionStorage.setItem('inkloom-outline-tab', value); return value }
    catch { return uuid() }
  })
  const prefix = `outline:${workspaceId}:${novel.id}:${chapterId}:`
  const key = prefix + tabId
  const recoveryLoaded = useRef(false)
  const dirty = !!draft && !!base && !sameOutline(draft, base.document)
  const locked = busy || preparing || !!pending
  const guardState = useRef({ dirty, locked })
  guardState.current = { dirty, locked }
  const list = useQuery({ queryKey: ['jobs', novel.id, chapterId, 'outline_edit'], queryFn: () => api.jobs(novel.id, { chapter_id: chapterId, task: 'outline_edit' }) })
  const currentJob = jobId || list.data?.[0]?.id
  const job = useQuery({ queryKey: ['job', currentJob], queryFn: () => api.job(currentJob!, novel.id), enabled: !!currentJob })
  const connection = useJobStream(job.data)
  const active = !!job.data && activeStates.has(job.data.state)
  const candidate = job.data?.result?.kind === 'outline_edit' ? job.data.result : null
  const providerId = chosen ?? roles.data?.planner ?? 'demo'
  const provider = providers.data?.find(p => p.id === providerId)
  const changes = candidate && base ? (base.document.kind === 'text' ? ['text'] as OutlineField[] : structuredFields)
    .filter(field => outlineValue(base.document, field) !== outlineValue(candidate.document, field)) : []
  useEffect(() => {
    if (read.data && !base) { setBase(read.data); setDraft(read.data.document) }
  }, [read.data, base])
  useEffect(() => {
    if (!read.data || recoveryLoaded.current) return
    let live = true
    void Promise.all([outlineDrafts.get(key), outlineDrafts.list(prefix)]).then(([own, values]) => {
      const value = own || values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      const alreadySaved = value && value.baseRevision <= read.data!.revision && sameOutline(value.document, read.data!.document)
      if (live) { recoveryLoaded.current = true; setRecovery(value && !alreadySaved ? value : null); setRecoveryReady(true) }
    })
      .catch(() => { if (live) { recoveryLoaded.current = true; setRecoveryReady(true); setError('无法读取浏览器恢复副本，请及时保存细纲。') } })
    return () => { live = false }
  }, [key, prefix, read.data])
  useEffect(() => {
    if (!recoveryReady || recovery || !base || !draft) return
    queue.current = queue.current.catch(() => undefined).then(async () => {
      if (dirty) await outlineDrafts.put({ key, baseRevision: base.revision, document: draft, updatedAt: new Date().toISOString() })
      else await outlineDrafts.remove(key)
    }).catch(() => setError('浏览器恢复副本写入失败，请保存到工作区。'))
  }, [key, base, draft, dirty, recovery, recoveryReady])
  useEffect(() => {
    registerGuard(async () => { if (guardState.current.dirty || guardState.current.locked) throw new Error('细纲还有未确认的修改，请先保存，或放弃本次修改。') })
    const beforeUnload = (event: BeforeUnloadEvent) => { if (guardState.current.dirty || guardState.current.locked) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { registerGuard(null); window.removeEventListener('beforeunload', beforeUnload) }
  }, [registerGuard])
  useEffect(() => { setSelected(changes) }, [job.data?.id, job.data?.state])
  useEffect(() => { setContext(null) }, [providerId, scope, instruction, base?.revision])

  function accept(value: OutlineState) {
    if (value.operation_revision != null && value.operation_revision !== value.revision) {
      setRemote(value)
      setError(`上次操作已保存为版本 ${value.operation_revision}，但细纲随后更新。你的输入已保留，请先比较最新内容。`)
    } else { setBase(value); setDraft(value.document); setRemote(null); setRecovery(null); setFormatConflict(false) }
    cache.setQueryData(['chapter-outline', novel.id, chapterId], value)
    for (const name of ['plans', 'chapters', 'chapter', 'novel', 'jobs', 'outline-history']) void cache.invalidateQueries({ queryKey: [name, novel.id] })
    void cache.invalidateQueries({ queryKey: ['novels'] })
  }
  async function submit(operation: Operation) {
    if (busy || composing.current || (pending && pending.kind !== operation.kind)) return
    const request = pending || operation
    setPending(request); setBusy(true); setError('')
    try {
      if (request.kind === 'generate') {
        const value = await api.createJob(novel.id, request.data)
        cache.setQueryData(['job', value.id], value); setJobId(value.id); setTab('ai')
      } else if (request.kind === 'save') accept(await api.saveChapterOutline(novel.id, chapterId, request.data))
      else if (request.kind === 'adopt') {
        accept(await api.applyOutlineEdit(request.job, novel.id, request.data))
        void cache.invalidateQueries({ queryKey: ['job', request.job] })
      } else { accept(await api.restoreOutline(novel.id, chapterId, request.revision, request.data)); setHistoryOpen(false) }
      setPending(null)
    } catch (e) {
      setError(errorText(e))
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setPending(null)
    } finally { setBusy(false) }
  }
  async function save() {
    if (base && draft && !formatConflict) await submit({ kind: 'save', data: { base_revision: base.revision, operation_id: uuid(), document: draft } })
  }
  async function latest() {
    if (!base || !draft) return
    setBusy(true)
    try {
      const value = await api.chapterOutline(novel.id, chapterId)
      setRemote(value)
      const merged = rebaseOutline(base.document, draft, value.document)
      if (merged) { setBase(value); setDraft(merged); setFormatConflict(false); setError('') }
      else { setFormatConflict(true); setError('细纲格式发生变化，请先比较并选择保留哪种格式。') }
    }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function input(): Promise<ContextInput> {
    if (!base) throw new Error('请先读取细纲。')
    const chapter = await api.chapter(novel.id, chapterId)
    const fields = base.document.kind === 'text' ? ['text'] as OutlineField[] : scope === 'all' ? structuredFields : [scope as OutlineField]
    return { task: 'outline_edit', chapter_id: chapterId, base_version_id: chapter.working_version_id,
      references_revision: chapter.references_revision, outline_edit: { base_revision: base.revision, fields },
      provider_id: providerId, instruction, target_chars: novel.chapter_words, chapter_batch: 5 }
  }
  async function preview() {
    if (preparingRef.current || locked || dirty) return
    preparingRef.current = true; setPreparing(true); setError('')
    try { setContext(await api.context(novel.id, await input())) }
    catch (e) { setError(errorText(e)) } finally { preparingRef.current = false; setPreparing(false) }
  }
  async function generate() {
    if (!base || dirty || preparingRef.current || busy) return
    preparingRef.current = true; setPreparing(true)
    try {
      if (pending?.kind === 'generate') { await submit(pending); return }
      const body = await input()
      setContext(await api.context(novel.id, body))
      await submit({ kind: 'generate', data: { ...body, idempotency_key: uuid(), max_attempts: 1, max_cost: null } })
    } catch (e) { setError(errorText(e)) } finally { preparingRef.current = false; setPreparing(false) }
  }
  async function control(action: string) {
    if (!job.data || locked) return
    setBusy(true)
    try { const value = await api.control(job.data.id, novel.id, action); cache.setQueryData(['job', value.id], value) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  const go = (page: 'plot' | 'write') => void navigate({ page, novelId: novel.id, chapterId: page === 'write' ? chapterId : undefined }).catch(e => setError(errorText(e)))
  if (!base || !draft) return <div className="content-page"><Button onClick={() => go('plot')}>返回章节列表</Button>{read.error ? <Notice>{errorText(read.error)}</Notice> : <Loading />}</div>
  const set = (field: OutlineField, value: string | string[]) => setDraft(previous => previous ? { ...previous, [field]: value } : previous)
  return <div className="page-scroll"><div className="content-page chapter-outline-page" onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!e.nativeEvent.isComposing && !locked) void save() }
  }}>
    <Button variant="ghost" onClick={() => go('plot')}><ArrowLeft size={17} />返回章节列表</Button>
    <header className="outline-heading"><h1>{base.document.title}</h1><div className="button-row"><Button onClick={() => setHistoryOpen(true)}><ClockCounterClockwise size={17} />历史版本</Button><Button onClick={() => go('write')}>写正文<ArrowRight size={17} /></Button></div></header>
    <div className="outline-mobile-tabs" role="tablist" aria-label="细纲工作区"><button role="tab" aria-selected={tab === 'outline'} onClick={() => setTab('outline')}>细纲</button><button role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>AI 建议</button></div>
    {error && <Notice>{error}{!locked && <Button onClick={() => void latest()}>读取最新细纲并比较</Button>}</Notice>}
    {pending && !busy && <Notice>上次操作尚未确认，请点击原操作按钮确认回执；不会另建生成请求。</Notice>}
    {recovery && <Notice tone="neutral">发现本机未保存的细纲副本。<Button disabled={locked} onClick={() => { setDraft(recovery.document); setBase({ ...base, revision: recovery.baseRevision }); setRecovery(null) }}>恢复本地细纲</Button><Button disabled={locked} onClick={() => setRecovery(null)}>本次不恢复</Button></Notice>}
    {remote && <Notice tone="neutral">你的修改仍保留，未修改的字段会采用最新内容。<details><summary>查看当前已保存细纲</summary><h3>{remote.document.title}</h3><pre className="outline-readable">{outlineText(remote.document)}</pre></details>{formatConflict && <div className="button-row"><Button disabled={locked} onClick={() => { setBase(remote); setFormatConflict(false); setError('') }}>保留我的格式，继续编辑</Button><Button disabled={locked} onClick={() => { accept({ ...remote, operation_revision: null }); setError('') }}>放弃本地修改，使用最新细纲</Button></div>}</Notice>}
    <div className={`outline-workspace showing-${tab}`}>
      <section className="outline-manual" aria-label="编辑章节细纲"><form onSubmit={e => { e.preventDefault(); void save() }}>
        <fieldset disabled={locked} className="form-stack"><legend className="sr-only">章节细纲</legend>
          <Field label="章节标题"><input value={draft.title} required maxLength={240} onChange={e => setDraft({ ...draft, title: e.target.value })} /></Field>
          {draft.kind === 'text' ? <><Field label="现有细纲"><textarea rows={14} maxLength={24000} value={draft.text} onChange={e => set('text', e.target.value)} /></Field><Button onClick={() => setDraft({ kind: 'structured', title: draft.title, goal: '', conflict: '', beats: [], ending_hook: '' })}>改用分字段编辑</Button><p className="small muted">手动整理后保存，原文保留在细纲历史中。</p></> : <>
            {base.document.kind === 'text' && <details><summary>整理前的原细纲</summary><pre className="outline-readable">{base.document.text}</pre></details>}
            <Field label="本章目标"><textarea rows={3} maxLength={1200} value={draft.goal || ''} onChange={e => set('goal', e.target.value)} /></Field>
            <Field label="核心冲突"><textarea rows={3} maxLength={1200} value={draft.conflict || ''} onChange={e => set('conflict', e.target.value)} /></Field>
            <div className="outline-beats"><strong>情节节点</strong>{(draft.beats || []).map((beat, index) => <div className="outline-beat" key={index}><span>{index + 1}</span><textarea aria-label={`情节节点 ${index + 1}`} rows={2} maxLength={600} value={beat} onChange={e => set('beats', (draft.beats || []).map((text, i) => i === index ? e.target.value : text))} /><Button variant="ghost" aria-label={`删除情节节点 ${index + 1}`} onClick={() => set('beats', (draft.beats || []).filter((_text, i) => i !== index))}><X size={17} /></Button></div>)}<Button disabled={(draft.beats || []).length >= 6} onClick={() => set('beats', [...(draft.beats || []), ''])}><Plus size={16} />添加情节节点</Button></div>
            <Field label="章末钩子"><textarea rows={3} maxLength={1000} value={draft.ending_hook || ''} onChange={e => set('ending_hook', e.target.value)} /></Field>
          </>}
        </fieldset>
        <div className="outline-save-bar"><span role="status">{busy && pending?.kind === 'save' ? '正在保存…' : pending?.kind === 'save' ? '保存尚未确认' : remote && remote.revision !== base.revision ? '有新版本，待比较' : dirty ? '尚未保存' : '已保存'}</span>{dirty && <Button disabled={locked} onClick={() => { accept({ ...(remote || base), operation_revision: null }); setError('') }}>放弃修改</Button>}<Button type="submit" variant="primary" disabled={busy || formatConflict || (!!pending && pending.kind !== 'save') || (!dirty && pending?.kind !== 'save')}>{pending?.kind === 'save' && !busy ? '确认上次保存' : '保存细纲'}</Button></div>
      </form></section>
      <section className="outline-assistance" aria-label="AI 修改建议"><h2>AI 修改建议</h2>
        <fieldset disabled={locked || active} className="form-stack"><legend className="sr-only">生成修改建议</legend><Field label="创作模型"><select value={providerId} onChange={e => setChosen(e.target.value)}>{providers.data?.map(p => <option value={p.id} key={p.id}>{p.name}{p.kind === 'demo' ? ' · 固定样例' : ''}</option>)}</select></Field>
          <Field label="修改范围"><select value={base.document.kind === 'text' ? 'text' : scope} onChange={e => setScope(e.target.value)}>{base.document.kind === 'text' ? <option value="text">现有细纲全文</option> : <><option value="all">整章细纲</option>{structuredFields.map(field => <option value={field} key={field}>只修改{outlineFields[field]}</option>)}</>}</select></Field>
          <Field label="修改要求"><textarea rows={4} maxLength={12000} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="希望保留什么，又想调整哪里？" /></Field><ProviderDisclosure provider={provider} />
        </fieldset>
        {dirty && <p className="outline-inline-hint">先保存细纲，再让 AI 基于保存的内容提出修改。</p>}
        <Button variant="primary" className="full-width" disabled={busy || active || dirty || (!!pending && pending.kind !== 'generate') || !provider || (provider.kind !== 'demo' && !provider.has_key)} onClick={() => void generate()}><Sparkle size={18} />{pending?.kind === 'generate' ? '确认上次提交' : '生成修改建议'}</Button>
        <details className="outline-context"><summary>本次参考与费用</summary><Button disabled={locked || active || dirty} onClick={() => void preview()}>查看本次参考（不生成）</Button>{context && <ContextDetails context={context} onEvidence={onEvidence} />}</details>
        {job.data && <div className="outline-candidate"><div className="section-heading"><strong>修改建议结果</strong><Badge>{job.data.is_demo ? '演示 · ' : ''}{jobStateNames[job.data.state]}</Badge></div>
          {active && <><p role="status">{connection || '正在生成建议…'}</p><Button disabled={locked} onClick={() => void control('cancel')}>停止生成</Button></>}
          {job.data.error_message && <Notice>{job.data.error_message}</Notice>}
          {job.data.state === 'interrupted_uncertain' && <Notice>上游可能已执行或计费，请核实后再决定是否重试。</Notice>}
          {['failed', 'interrupted_uncertain'].includes(job.data.state) && <p className="small muted">结果已保留；核对后可修改要求并创建一次新的生成。</p>}
          {candidate && <><p>{candidate.summary}</p><p className="small muted">{job.data.context.provider_name} · {job.data.context.model}</p>{changes.map(field => <article className="outline-change" key={field}><label className="checkbox-label"><input type="checkbox" checked={selected.includes(field)} disabled={locked || dirty || job.data?.candidate_status !== 'ready'} onChange={e => setSelected(previous => e.target.checked ? [...previous, field] : previous.filter(value => value !== field))} /><strong>{outlineFields[field]}</strong></label><div><small>当前</small><pre className="outline-readable">{outlineValue(base.document, field) || '未填写'}</pre></div><div className="outline-suggestion"><small>建议</small><pre className="outline-readable">{outlineValue(candidate.document, field) || '未填写'}</pre></div></article>)}
            {job.data.candidate_status === 'adopted' ? <Notice tone="neutral">这份建议已采纳，仍可继续编辑细纲。</Notice> : job.data.candidate_status === 'needs_rebase' || job.data.context.outline_edit?.base_revision !== base.revision ? <Notice>细纲或生成依据已变化，请重新生成建议。</Notice> : <Button variant="primary" className="full-width" disabled={busy || dirty || (!selected.length && pending?.kind !== 'adopt') || (!!pending && pending.kind !== 'adopt') || job.data.state !== 'succeeded'} onClick={() => void submit({ kind: 'adopt', job: job.data!.id, data: { base_revision: base.revision, operation_id: uuid(), fields: selected } })}>{pending?.kind === 'adopt' && !busy ? '确认上次采纳' : '采纳所选修改'}</Button>}
            {!changes.length && job.data.candidate_status !== 'adopted' && <p>本次建议没有改变细纲内容。</p>}
          </>}
        </div>}
        <p className="small muted">修改细纲不会替换正文。</p>
      </section>
    </div>
    {historyOpen && <OutlineHistory novelId={novel.id} chapterId={chapterId} base={base} locked={locked || dirty} busy={busy} pending={pending} operationError={error} onClose={() => !locked && setHistoryOpen(false)} onRestore={revision => void submit({ kind: 'restore', revision, data: { base_revision: base.revision, operation_id: uuid() } })} />}
  </div></div>
}

function OutlineHistory({ novelId, chapterId, base, locked, busy, pending, operationError, onClose, onRestore }: { novelId: string; chapterId: string; base: OutlineState; locked: boolean; busy: boolean; pending: Operation | null; operationError: string; onClose: () => void; onRestore: (revision: number) => void }) {
  const [items, setItems] = useState<OutlineHistoryItem[]>([])
  const [before, setBefore] = useState<number | null | undefined>(undefined)
  const [preview, setPreview] = useState<OutlineRevision | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const previewRequest = useRef(0)
  async function show(revision: number) {
    const request = ++previewRequest.current
    setPreview(null); setError('')
    try { const value = await api.outlineRevision(novelId, chapterId, revision); if (previewRequest.current === request) setPreview(value) }
    catch (e) { if (previewRequest.current === request) setError(errorText(e)) }
  }
  async function load(cursor?: number) {
    setLoading(true)
    try { const value = await api.outlineHistory(novelId, chapterId, cursor); setItems(previous => cursor == null ? value.items : [...previous, ...value.items]); setBefore(value.next_before ?? null) }
    catch (e) { setError(errorText(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [novelId, chapterId])
  const sources: Record<string, string> = { initial: '原始细纲', manual: '手动编辑', metadata: '章节信息', legacy: '规划编辑', ai: 'AI 建议', restore: '恢复历史' }
  return <Modal open onOpenChange={open => !open && onClose()} dismissible={!busy && !pending} title="细纲历史" wide><div className="outline-history"><div className="outline-history-list">{items.map(item => <Button key={item.revision} onClick={() => void show(item.revision)}><strong>版本 {item.revision}{item.revision === base.revision ? ' · 当前' : ''}</strong><span>{sources[item.source.split(':')[0]] || '细纲修改'} · {dateLabel(item.created_at)}</span></Button>)}{before != null && <Button disabled={loading} onClick={() => void load(before)}>加载更早版本</Button>}{loading && <Loading />}</div>{preview && <div className="outline-history-preview"><h3>版本 {preview.revision} · {preview.document.title}</h3><pre className="outline-readable">{outlineText(preview.document)}</pre><Button variant="primary" disabled={busy || (locked && pending?.kind !== 'restore') || preview.revision === base.revision} onClick={() => onRestore(preview.revision)}>{pending?.kind === 'restore' ? '确认上次恢复' : '恢复为新版本'}</Button></div>}</div>{(error || operationError) && <Notice>{error || operationError}</Notice>}</Modal>
}
