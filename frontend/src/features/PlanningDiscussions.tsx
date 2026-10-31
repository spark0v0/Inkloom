import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChatsCircle, Check, PaperPlaneTilt, Plus, Stop } from '@phosphor-icons/react'
import { activeStates, api, ApiError, dateLabel, errorText, jobStateNames, uuid } from '../lib/api'
import type { ChapterSummary, Context, ContextInput, Conversation, DiscussionTurn, Evidence, JobInput, OutlineField } from '../lib/api'
import type { Navigate } from '../lib/route'
import { discussionDrafts } from '../lib/drafts'
import type { DiscussionDraft } from '../lib/drafts'
import { outlineFields, outlineText, outlineValue } from '../lib/outlines'
import { useJobStream } from '../lib/useJobStream'
import { Badge, Button, Empty, Field, Loading, Modal, Notice } from '../components/ui'
import { ProviderDisclosure } from '../components/ProviderDisclosure'
import { ContextDetails, SourceButton } from './JobPresentation'
import './planning-discussions.css'

export function PlanningDiscussions({ novelId, workspaceId, chapters, navigate, discussionId, onEvidence }: {
  novelId: string; workspaceId: string; chapters: ChapterSummary[]; navigate: Navigate; discussionId?: string; onEvidence: (e: Evidence) => void
}) {
  const cache = useQueryClient()
  const list = useQuery({ queryKey: ['discussions', novelId], queryFn: () => api.conversations(novelId, workspaceId) })
  const selectionKey = `inkloom:discussion:${workspaceId}:${novelId}`
  const [selected, setSelected] = useState(() => { try { return sessionStorage.getItem(selectionKey) } catch { return null } })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const conversation = list.data?.find(item => item.id === (discussionId || selected)) || (!discussionId ? list.data?.[0] : undefined)
  function choose(id: string) {
    setSelected(id)
    try { sessionStorage.setItem(selectionKey, id) } catch { /* Only the selected ID is a preference. */ }
    void navigate({ page: 'plot', novelId, view: 'discuss', discussionId: id }).catch(e => setError(errorText(e)))
  }
  async function create() {
    setBusy(true); setError('')
    try {
      const value = await api.createConversation(novelId, workspaceId)
      cache.setQueryData<Conversation[]>(['discussions', novelId], old => [value, ...(old || [])])
      choose(value.id)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  if (!chapters.length) return <Empty icon={<ChatsCircle size={30} />} title="先准备一章细纲" action={<Button onClick={() => void navigate({ page: 'plot', novelId })}>规划章节<ArrowRight size={16} /></Button>}>规划助手会读取你选定的细纲，讨论剧情，再提出可审阅的修改建议。</Empty>
  return <section className="planning-discussions" aria-label="规划讨论">
    <aside className="discussion-list">
      <div className="section-heading"><h2>讨论记录</h2><Button onClick={() => void create()} disabled={busy}><Plus size={16} />新讨论</Button></div>
      {error && <Notice>{error}</Notice>}
      {list.isPending ? <Loading label="正在读取讨论…" /> : list.error ? <Notice action={<Button onClick={() => void list.refetch()}>重试</Button>}>{errorText(list.error)}</Notice> : <>
        <label className="discussion-mobile-picker">当前讨论<select value={conversation?.id || ''} onChange={e => choose(e.target.value)}><option value="" disabled>选择讨论</option>{list.data?.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <div className="discussion-list-items">{list.data?.map(item => <button className={conversation?.id === item.id ? 'active' : ''} key={item.id} onClick={() => choose(item.id)} aria-current={conversation?.id === item.id ? 'true' : undefined}><strong>{item.title}</strong><small>{dateLabel(item.updated_at)}</small></button>)}</div>
      </>}
      {!list.isPending && !list.error && !list.data?.length && <p className="muted small">为当前卡住的剧情开一个讨论。</p>}
    </aside>
    {conversation ? <DiscussionThread key={conversation.id} conversation={conversation} chapters={chapters} workspaceId={workspaceId} navigate={navigate} onEvidence={onEvidence} /> : discussionId && list.data ? <Notice>此作品中没有该讨论，请从左侧选择，或新建讨论。</Notice> : <Empty icon={<ChatsCircle size={32} />} title="和 AI 一起推敲剧情" action={<Button variant="primary" onClick={() => void create()} disabled={busy || list.isPending}>新建讨论</Button>}>选一至三章细纲，说说你卡住的地方。</Empty>}
  </section>
}

function DiscussionThread({ conversation, chapters, workspaceId, navigate, onEvidence }: {
  conversation: Conversation; chapters: ChapterSummary[]; workspaceId: string; navigate: Navigate; onEvidence: (e: Evidence) => void
}) {
  const novelId = conversation.novel_id
  const cache = useQueryClient()
  const history = useInfiniteQuery({ queryKey: ['discussion', novelId, conversation.id], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.discussion(novelId, conversation.id, pageParam, workspaceId), getNextPageParam: page => page.next_before || undefined })
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles })
  const entities = useQuery({ queryKey: ['entities', novelId], queryFn: () => api.entities(novelId, workspaceId) })
  const current = history.data?.pages[0]?.conversation
  const head = current?.last_job_id
  const job = useQuery({ queryKey: ['job', head], queryFn: () => api.job(head!, novelId, undefined, workspaceId), enabled: !!head })
  const connection = useJobStream(job.data)
  const active = !!job.data && activeStates.has(job.data.state)
  const [chapterIds, setChapterIds] = useState(conversation.chapter_ids.length ? conversation.chapter_ids : [chapters[0].id])
  const [manuscriptIds, setManuscriptIds] = useState<string[]>([])
  const [entityIds, setEntityIds] = useState<string[]>([])
  const [materialsReady, setMaterialsReady] = useState(false)
  const [providerChoice, setProviderChoice] = useState<string | null>(null)
  const providerId = providerChoice || roles.data?.planner || 'demo'
  const provider = providers.data?.find(item => item.id === providerId)
  const [instruction, setInstruction] = useState('')
  const [pending, setPending] = useState<JobInput | null>(null)
  const [recovery, setRecovery] = useState<DiscussionDraft | null>(null)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [preview, setPreview] = useState<Context | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [inspect, setInspect] = useState<string | null>(null)
  const composing = useRef(false)
  const messages = useRef<HTMLDivElement>(null)
  const prefix = `discussion:${workspaceId}:${novelId}:${conversation.id}:`
  const [draftKey] = useState(() => prefix + uuid())
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const draftSnapshot = (): DiscussionDraft => ({ key: draftKey, instruction, chapterIds, manuscriptIds, entityIds, providerId, pending, updatedAt: new Date().toISOString() })
  useEffect(() => {
    let live = true
    void discussionDrafts.list(prefix).then(items => {
      if (!live) return
      setRecovery(items.filter(item => item.key !== draftKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null)
      setRecoveryReady(true)
    }).catch(() => { if (live) { setRecoveryReady(true); setError('无法读取讨论恢复副本，请保留未发送的文字。') } })
    return () => { live = false }
  }, [prefix, draftKey])
  useEffect(() => {
    if (!recoveryReady || recovery) return
    const value: DiscussionDraft = { key: draftKey, instruction, chapterIds, manuscriptIds, entityIds, providerId, pending, updatedAt: new Date().toISOString() }
    queue.current = queue.current.catch(() => undefined).then(() => instruction.trim() || pending ? discussionDrafts.put(value) : discussionDrafts.remove(draftKey))
      .catch(() => setError('浏览器恢复副本写入失败，请保留未发送的文字。'))
  }, [draftKey, instruction, chapterIds, manuscriptIds, entityIds, providerId, pending, recoveryReady, recovery])
  useEffect(() => {
    if (materialsReady || !recoveryReady || recovery || !current || (head && job.data?.id !== head)) return
    setManuscriptIds(job.data?.context.discussion?.manuscripts?.map(item => item.chapter_id) || [])
    setEntityIds(job.data?.context.discussion?.entity_ids || [])
    setMaterialsReady(true)
  }, [materialsReady, recoveryReady, recovery, current, head, job.data])
  useEffect(() => {
    if (!job.data || active) return
    void cache.invalidateQueries({ queryKey: ['discussion', novelId, conversation.id] })
    void cache.invalidateQueries({ queryKey: ['discussions', novelId] })
  }, [job.data?.id, job.data?.state, active, cache, novelId, conversation.id])
  useEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight }, [head, job.data?.state, history.data?.pages[0]?.items[0]?.result])
  useEffect(() => { setPreview(null) }, [instruction, providerId, chapterIds, manuscriptIds, entityIds, current?.last_job_id])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (busy || pending) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [busy, pending])
  async function recover(use: boolean) {
    if (!recovery) return
    const source = recovery
    try {
      if (use) {
        await discussionDrafts.put({ ...source, key: draftKey })
        setInstruction(source.instruction); setChapterIds(source.chapterIds); setProviderChoice(source.providerId); setPending(source.pending)
        setManuscriptIds(source.manuscriptIds || []); setEntityIds(source.entityIds || []); setMaterialsReady(true)
      }
      await discussionDrafts.removeIfUnchanged(source)
      setRecovery(null)
    } catch (e) { setError(errorText(e)) }
  }
  async function prepare(): Promise<{ context: Context; input: JobInput }> {
    if (!current || !chapterIds.length || !instruction.trim()) throw new Error('请选择参考细纲并填写讨论内容。')
    const anchor = await api.chapter(novelId, chapterIds[0], workspaceId)
    const manuscripts = await Promise.all(manuscriptIds.map(id => api.chapter(novelId, id, workspaceId)))
    const body: ContextInput = { task: 'discuss', chapter_id: anchor.id, base_version_id: anchor.working_version_id,
      instruction: instruction.trim(), provider_id: providerId, target_chars: 500, chapter_batch: 5,
      discussion: { conversation_id: conversation.id, last_job_id: current.last_job_id, chapter_ids: chapterIds,
        manuscripts: manuscripts.map(item => ({ chapter_id: item.id, version_id: item.working_version_id })), entity_ids: entityIds } }
    const context = preview || await api.context(novelId, body, workspaceId)
    const input: JobInput = { ...body, discussion: context.discussion, idempotency_key: uuid(), max_attempts: 1 }
    setPreview(context)
    return { context, input }
  }
  async function seeContext() {
    if (busy || composing.current) return
    setBusy(true); setError('')
    try { await prepare(); setContextOpen(true) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function send() {
    if (busy || composing.current) return
    setBusy(true); setError('')
    try {
      const input = pending || (await prepare()).input
      // Persist the exact operation before dispatch; an explicit retry reuses its key.
      await queue.current.catch(() => undefined)
      await discussionDrafts.put({ ...draftSnapshot(), instruction: input.instruction || '', pending: input })
      setPending(input)
      const value = await api.createJob(novelId, input, workspaceId)
      cache.setQueryData(['job', value.id], value)
      setPending(null); setInstruction(''); setPreview(null)
      await Promise.all([cache.invalidateQueries({ queryKey: ['discussion', novelId, conversation.id] }), cache.invalidateQueries({ queryKey: ['discussions', novelId] })])
    } catch (e) {
      setError(errorText(e))
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) { setPending(null); setPreview(null) }
    } finally { setBusy(false) }
  }
  async function cancel() {
    if (!job.data) return
    setBusy(true); setError('')
    try { cache.setQueryData(['job', job.data.id], await api.control(job.data.id, novelId, 'cancel', workspaceId)) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  function toggleChapter(id: string) {
    if (chapterIds.includes(id)) setChapterIds(chapterIds.filter(item => item !== id))
    else if (chapterIds.length < 3) setChapterIds([...chapterIds, id])
  }
  const turns = history.data?.pages.flatMap(page => page.items).slice().reverse() || []
  const locked = busy || !!pending || !!recovery || !recoveryReady || !materialsReady || active
  return <div className="discussion-thread">
    <header className="discussion-heading"><div><h2>{current?.title || conversation.title}</h2><p className="small muted">结合细纲与所选正文讨论，建议由你审阅后采纳。</p></div><Button variant="ghost" disabled={history.isFetching} onClick={() => void history.refetch()}>刷新讨论</Button></header>
    <div className="discussion-reference-groups">
    <details className="discussion-references"><summary>参考细纲 · {chapterIds.length} / 3<span>{chapterIds.map(id => chapters.find(item => item.id === id)?.title || '章节不存在').join('、')}</span></summary>
      <fieldset disabled={locked}><legend className="sr-only">选择参考章节，最多三章</legend><div className="discussion-chapter-picker">{chapters.map(item => <div key={item.id}><label><input type="checkbox" checked={chapterIds.includes(item.id)} disabled={!chapterIds.includes(item.id) && chapterIds.length >= 3} onChange={() => toggleChapter(item.id)} /><span>{item.title}<small>{item.goal || '尚未填写细纲'}</small></span></label><button type="button" className="text-link" onClick={() => void navigate({ page: 'plot', novelId, chapterId: item.id, view: 'discuss', discussionId: conversation.id })}>编辑</button></div>)}</div></fieldset>
      <p className="small muted">细纲属于计划；还会读取作品方向、所列书卷规划及最近讨论。</p>
    </details>
    <details className="discussion-references">
      <summary>正文与档案 · {manuscriptIds.length} 章正文 / {entityIds.length} 条档案</summary>
      <fieldset disabled={locked}>
        <legend>参考正文（最多三章，读取当前已保存版本）</legend>
        <div className="discussion-chapter-picker">{chapters.map(item => <label key={item.id}>
          <input type="checkbox" aria-label={`参考正文：${item.title}`} checked={manuscriptIds.includes(item.id)}
            disabled={(!item.char_count && !manuscriptIds.includes(item.id)) || (!manuscriptIds.includes(item.id) && manuscriptIds.length >= 3)}
            onChange={() => setManuscriptIds(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old, item.id])} />
          <span>{item.title}<small>{item.char_count ? `${item.char_count} 字 · ${item.review_state === 'confirmed' ? '已定稿' : item.review_state === 'needs_review' ? '待复核' : '当前稿'}` : '暂无正文'}</small></span>
        </label>)}</div>
        <h4>作者档案（最多十二条）</h4>
        {entities.isPending ? <Loading label="正在读取档案…" /> : entities.error ? <Notice action={<Button onClick={() => void entities.refetch()}>重试</Button>}>{errorText(entities.error)}</Notice> : <div className="discussion-chapter-picker">{entities.data?.filter(item => item.status === 'author').map(item => <label key={item.id}>
          <input type="checkbox" aria-label={`参考档案：${item.name}`} checked={entityIds.includes(item.id)} disabled={!entityIds.includes(item.id) && entityIds.length >= 12}
            onChange={() => setEntityIds(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old, item.id])} />
          <span>{item.name}<small>{item.summary || '作者设定'}</small></span>
        </label>)}</div>}
      </fieldset>
      <p className="small muted">未勾选的正文与档案不会作为本轮参考发送。当前稿和待复核稿会明确标注。</p>
    </details>
    {job.error && <Notice action={<Button onClick={() => void job.refetch()}>重试读取</Button>}>{errorText(job.error)}</Notice>}
    </div>
    <div className="discussion-messages" ref={messages} role="log" aria-label="讨论消息" aria-busy={active} tabIndex={0}>
      {history.isPending && <Loading label="正在读取讨论…" />}
      {history.error && <Notice action={<Button onClick={() => void history.refetch()}>重试</Button>}>{errorText(history.error)}</Notice>}
      {history.hasNextPage && <Button disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>查看更早的讨论</Button>}
      {!history.isPending && !history.error && !turns.length && <div className="discussion-start"><ChatsCircle size={30} weight="light" /><h3>从一个具体问题开始</h3><p>“这章主角为什么要冒险？”<br />“转折太突兀，怎样让上一章埋下线索？”</p></div>}
      {turns.map(turn => <DiscussionMessage onEvidence={onEvidence} key={turn.id} turn={turn} inspect={() => setInspect(turn.id)} latestId={head || undefined} activeId={active ? job.data?.id : undefined} />)}
      {connection && <Notice tone="neutral">{connection}</Notice>}
    </div>
    <div className="discussion-composer">
      {recovery && <Notice action={<div className="button-row"><Button onClick={() => void recover(true)}>恢复</Button><Button onClick={() => void recover(false)}>放弃此副本</Button></div>}>发现未发送的讨论{recovery.pending ? '，其中一次发送尚未确认。恢复后请核对记录，再使用原请求重试。' : '。'}</Notice>}
      {pending && <Notice>发送结果尚未确认。请先刷新讨论核对，或重试原请求。</Notice>}
      {error && !pending && <Notice>{error}</Notice>}
      {!recovery && <><Field label="讨论内容"><textarea rows={3} maxLength={4000} value={instruction} disabled={locked} placeholder="说说你卡住的地方，或让 AI 针对细纲提出修改建议…" onChange={e => setInstruction(e.target.value)} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing && !locked) { e.preventDefault(); void send() } }} /></Field>
      <div className="discussion-send-row"><label>讨论模型<select aria-label="讨论模型" value={providerId} onChange={e => setProviderChoice(e.target.value)} disabled={locked}>{providers.data?.map(item => <option value={item.id} key={item.id}>{item.name} · {item.model}</option>)}</select></label>{!pending && !active && <Button variant="ghost" disabled={locked || !instruction.trim() || !chapterIds.length} onClick={() => void seeContext()}>查看本次资料</Button>}{active ? <Button disabled={busy} onClick={() => void cancel()}><Stop size={16} />停止回复</Button> : <Button variant="primary" disabled={busy || !!recovery || !recoveryReady || !materialsReady || !current || (!pending && (!instruction.trim() || !chapterIds.length || !provider || (provider.kind !== 'demo' && !provider.has_key)))} onClick={() => void send()}><PaperPlaneTilt size={17} />{busy ? '准备发送…' : pending ? '重试原请求' : '发送'}</Button>}</div>
      <ProviderDisclosure provider={provider} /></> }
      {providers.error && <Notice>{errorText(providers.error)}</Notice>}
      {preview && contextOpen && <Modal open title="本次资料与费用估算" wide onOpenChange={setContextOpen} className="discussion-context"><div className="discussion-context-outlines">{preview.discussion_outlines?.map(item => <details key={item.chapter_id}><summary>{item.document.title}</summary><pre>{outlineText(item.document)}</pre></details>)}</div><ContextDetails context={preview} onEvidence={onEvidence} /></Modal>}
    </div>
    {inspect && <DiscussionProposal workspaceId={workspaceId} novelId={novelId} conversationId={conversation.id} jobId={inspect} onClose={() => setInspect(null)} />}
  </div>
}

function DiscussionMessage({ turn, inspect, activeId, latestId, onEvidence }: { onEvidence: (e: Evidence) => void; turn: DiscussionTurn; inspect: () => void; activeId?: string; latestId?: string }) {
  return <article className="discussion-turn">
    <div className="discussion-author"><span>你</span><p>{turn.instruction}</p></div>
    <div className="discussion-assistant"><div className="discussion-message-meta"><strong>规划助手</strong>{turn.is_demo && <Badge tone="amber">演示回复</Badge>}<time>{dateLabel(turn.created_at)}</time></div>
      {turn.result ? <><p className="discussion-reply">{turn.result.reply}</p><div className="button-row">{turn.result.evidence?.map((item, i) => <SourceButton key={i} evidence={item} onEvidence={onEvidence} />)}</div>{turn.result.proposal && <section className="discussion-proposal-card"><div><strong>细纲修改建议</strong><p>{turn.result.proposal.summary}</p></div><Button onClick={inspect}>{turn.applied ? <><Check size={16} />查看已采纳建议</> : <>{turn.id === latestId ? '查看并采纳' : '查看历史建议'}<ArrowRight size={16} /></>}</Button></section>}</> : <p className="muted" role={turn.id === activeId ? 'status' : undefined}>{jobStateNames[turn.state] || turn.state}{turn.id === activeId ? '…' : ''}</p>}
      {turn.error_message && <Notice>{turn.error_message}</Notice>}
      {!turn.result && turn.id !== activeId && <Button variant="ghost" onClick={inspect}>查看本次记录</Button>}
    </div>
  </article>
}

function DiscussionProposal({ novelId, workspaceId, conversationId, jobId, onClose }: { novelId: string; workspaceId: string; conversationId: string; jobId: string; onClose: () => void }) {
  const cache = useQueryClient()
  const job = useQuery({ queryKey: ['job', jobId], queryFn: () => api.job(jobId, novelId, undefined, workspaceId), staleTime: 0 })
  const result = job.data?.result?.kind === 'discussion' ? job.data.result : null
  const proposal = result?.proposal
  const original = job.data?.context.discussion_outlines?.find(item => item.chapter_id === proposal?.chapter_id)
  const [selected, setSelected] = useState<OutlineField[]>([])
  const [pending, setPending] = useState<Parameters<typeof api.applyDiscussion>[2] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (proposal) setSelected(proposal.fields) }, [proposal])
  async function apply() {
    if (!original || !proposal || busy) return
    const data = pending || { base_revision: original.revision, fields: selected, operation_id: uuid() }
    setPending(data); setBusy(true); setError('')
    try {
      await api.applyDiscussion(novelId, jobId, data, workspaceId)
      setPending(null); setSaved(true)
      await Promise.all([
        ...['chapters', 'chapter', 'plans', 'novel', 'chapter-outline', 'outline-history'].map(key => cache.invalidateQueries({ queryKey: [key, novelId] })),
        cache.invalidateQueries({ queryKey: ['novels'] }), cache.invalidateQueries({ queryKey: ['job', jobId] }),
        cache.invalidateQueries({ queryKey: ['discussion', novelId, conversationId] }),
      ])
    } catch (e) {
      setError(errorText(e))
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) { setPending(null); void cache.invalidateQueries({ queryKey: ['job', jobId] }) }
    } finally { setBusy(false) }
  }
  const adopted = saved || job.data?.candidate_status === 'adopted'
  const stale = job.data?.candidate_status === 'needs_rebase'
  return <Modal open onOpenChange={value => !value && !busy && !pending && onClose()} title={proposal ? '审阅细纲修改建议' : '本次讨论记录'} description="勾选需要的字段后采纳，正文不会随之替换。" wide className="discussion-proposal-modal" dismissible={!busy && !pending}>
    {job.isPending ? <Loading /> : job.error ? <Notice>{errorText(job.error)}</Notice> : proposal && original ? <>
      <div className="section-heading"><h3>{proposal.document.title}</h3>{adopted && <Badge tone="green">已采纳</Badge>}</div><p>{proposal.summary}</p>
      {proposal.fields.map(field => <section className="discussion-field-comparison" key={field}><label><input type="checkbox" checked={selected.includes(field)} disabled={busy || !!pending || adopted} onChange={() => setSelected(selected.includes(field) ? selected.filter(item => item !== field) : [...selected, field])} />{outlineFields[field]}</label><div><section><h4>原细纲</h4><pre>{outlineValue(original.document, field) || '未填写'}</pre></section><section><h4>修改建议</h4><pre>{outlineValue(proposal.document, field) || '未填写'}</pre></section></div></section>)}
    </> : <><p>{job.data?.error_message || jobStateNames[job.data?.state || '']}</p>{job.data?.output_text && <details><summary>已保留的部分内容 · 不可采纳</summary><pre className="outline-readable">{job.data.output_text}</pre></details>}</>}
    {stale && <Notice>参考细纲、作品资料或后续讨论已变化。这份建议仍可查看，请重新讨论后再采纳。</Notice>}
    {error && <Notice>{error}</Notice>}{pending && !busy && <Notice>采纳结果尚未确认，请用原操作重试。</Notice>}
    <div className="modal-actions"><Button onClick={onClose} disabled={busy || !!pending}>关闭</Button>{proposal && original && !adopted && <Button variant="primary" onClick={() => void apply()} disabled={busy || stale || !selected.length}>{busy ? '正在采纳…' : pending ? '重试原操作' : '采纳所选修改'}</Button>}</div>
  </Modal>
}
