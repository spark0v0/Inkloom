import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowCounterClockwise, ArrowClockwise, Article, Check, CheckCircle, ClockCounterClockwise, DotsThree, List, Plus, SidebarSimple, Sparkle, TextB, TextItalic, X } from '@phosphor-icons/react'
import { activeStates, ApiError, api, countChars, dateLabel, downloadText, errorText, number, uuid } from '../lib/api'
import type { Chapter, ChapterSummary, Evidence, JobInput, MemoryProposal, Novel, Provider, Roles, Selection, Version } from '../lib/api'
import type { Navigate } from '../lib/route'
import { useManuscript } from '../lib/useManuscript'
import type { RecoveryDraft } from '../lib/drafts'
import { Badge, Button, Field, Loading, Modal, Notice } from '../components/ui'
import { Assistant } from './Assistant'
import { SourceButton } from './JobPresentation'
import { useJobStream } from '../lib/useJobStream'
import { ChapterList } from './ChapterList'
import { WritingStyleDialog } from './WritingStyleDialog'
import { rewriteActions } from '../lib/writing'
import type { RewriteAction, SelectionRewrite } from '../lib/writing'

type Props = { novel: Novel; chapter: Chapter; chapters: ChapterSummary[]; workspaceId: string; providers: Provider[]; roles: Roles; navigate: Navigate; onEvidence: (e: Evidence) => void; registerGuard: (guard: (() => Promise<unknown>) | null) => void }

export function EditorPage({ novel, chapter, chapters, workspaceId, providers, roles, navigate, onEvidence, registerGuard }: Props) {
  const cache = useQueryClient()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [quickRewrite, setQuickRewrite] = useState<SelectionRewrite | null>(null)
  const [preparingSelection, setPreparingSelection] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const quickPrepared = useCallback((id: string) => setQuickRewrite(current => current?.id === id ? null : current), [])
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [compact, setCompact] = useState(() => window.innerWidth <= 1100)
  const [candidateHost, setCandidateHost] = useState<HTMLDivElement | null>(null)
  const [candidateView, setCandidateView] = useState(false)
  const [hasCandidate, setHasCandidate] = useState(false)
  const [candidateLabel, setCandidateLabel] = useState('AI 草稿')
  const candidateChanged = useCallback((_id: string, show: boolean, label = 'AI 草稿') => { setHasCandidate(true); setCandidateLabel(label); if (show) setCandidateView(true) }, [])
  useEffect(() => {
    const media = window.matchMedia('(max-width:1100px)')
    const change = () => { setCompact(media.matches); if (media.matches) setCandidateView(false) }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const [mobileAssistant, setMobileAssistant] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [directoryVisible, setDirectoryVisible] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [canonOpen, setCanonOpen] = useState(false)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [error, setError] = useState('')
  const [fontSize, setFontSize] = useState(18)
  const [focused, setFocused] = useState(false)
  const [changes, setChanges] = useState<{ versionId: string; values: MemoryProposal[] } | null>(null)
  const [canonVersion, setCanonVersion] = useState<Version | null>(null)
  const [title, setTitle] = useState(chapter.title)
  const [volume, setVolume] = useState(chapter.volume)
  const [goal, setGoal] = useState(chapter.goal)
  const [metadataBase, setMetadataBase] = useState({ revision: chapter.outline_revision ?? 0, volume: chapter.volume })
  const [metadataTouched, setMetadataTouched] = useState(new Set<'title' | 'volume' | 'goal'>())
  const [metadataLatest, setMetadataLatest] = useState<Chapter | null>(null)
  const [metadataError, setMetadataError] = useState('')
  const metadataComposing = useRef(false)
  const [busy, setBusy] = useState(false)
  const commit = useCallback((version: Version) => {
    cache.setQueryData<Chapter>(['chapter', novel.id, chapter.id], old => old ? { ...old, version, working_version_id: version.id, char_count: version.char_count, review_state: old.accepted_version_id && old.accepted_version_id !== version.id ? 'needs_review' : old.review_state } : old)
    void cache.invalidateQueries({ queryKey: ['chapters', novel.id] })
    void cache.invalidateQueries({ queryKey: ['versions', novel.id, chapter.id] })
    void cache.invalidateQueries({ queryKey: ['novel', novel.id] })
    void cache.invalidateQueries({ queryKey: ['novels'] })
    void cache.invalidateQueries({ queryKey: ['facts', novel.id] })
  }, [cache, novel.id, chapter.id])
  const initial = useRef(chapter.version).current
  const manuscript = useManuscript(novel.id, chapter.id, workspaceId, initial, commit)
  const stateRef = useRef(manuscript)
  stateRef.current = manuscript

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, codeBlock: false, horizontalRule: false, link: false, underline: false }), Placeholder.configure({ placeholder: '在这里写作，或用 AI 生成本章正文。' })],
    content: initial.editor_doc,
    editorProps: {
      attributes: { class: 'manuscript-content', role: 'textbox', 'aria-label': '小说正文', 'aria-multiline': 'true', spellcheck: 'false' },
      handleDOMEvents: {
        compositionstart: () => { stateRef.current.composing.current = true; setSelection(null); return false },
        compositionend: () => {
          stateRef.current.composing.current = false
          queueMicrotask(() => { if (editor) stateRef.current.change({ text: editor.getText({ blockSeparator: '\n\n' }), doc: editor.getJSON() }) })
          return false
        },
      },
    },
    onUpdate: ({ editor: instance }) => stateRef.current.change({ text: instance.getText({ blockSeparator: '\n\n' }), doc: instance.getJSON() }),
    onSelectionUpdate: ({ editor: instance }) => {
      if (stateRef.current.composing.current) return
      const { from, to } = instance.state.selection
      if (from === to) { setSelection(null); return }
      const prefix = instance.state.doc.textBetween(0, from, '\n\n')
      const text = instance.state.doc.textBetween(from, to, '\n\n')
      setSelection(text ? { start_codepoint: Array.from(prefix).length, end_codepoint: Array.from(prefix).length + Array.from(text).length, text } : null)
    },
  })

  useEffect(() => { registerGuard(manuscript.flush); return () => registerGuard(null) }, [registerGuard, manuscript.flush])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); if (!event.isComposing) void stateRef.current.flush().catch(e => setError(errorText(e)))
      }
      if (event.key === 'Escape' && focused) setFocused(false)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [focused])

  const adopt = useCallback((version: Version, expected?: Version) => {
    if (manuscript.accept(version, expected)) editor?.commands.setContent(version.editor_doc, { emitUpdate: false })
    setCandidateView(false)
  }, [editor, manuscript.accept])
  const extraction = useCallback((values: MemoryProposal[], versionId: string) => setChanges(previous => previous?.versionId === versionId && JSON.stringify(previous.values) === JSON.stringify(values) ? previous : { values, versionId }), [])
  const previous = chapters.find(c => c.position < chapter.position && c.review_state !== 'confirmed')
  const ordered = [...chapters].sort((a, b) => a.position - b.position)
  const chapterIndex = ordered.findIndex(c => c.id === chapter.id)
  const previousChapter = ordered[chapterIndex - 1]
  const nextChapter = ordered[chapterIndex + 1]
  const assistantProps = { novel, chapter, providers, roles, flush: manuscript.flush, selection, quickRewrite, onQuickPrepared: quickPrepared, onWritingStyle: () => setStyleOpen(true), onAdopt: adopt, onEvidence, onExtractReady: extraction, blockedChapter: previous?.title, onResolvePrevious: () => { if (previous) void navigate({ page: 'write', novelId: novel.id, chapterId: previous.id }).catch(e => setError(errorText(e))) } }
  async function prepareSelection(action: RewriteAction) {
    if (!selection || preparingSelection || manuscript.composing.current) return
    const selected = { ...selection }
    setPreparingSelection(true); setError('')
    try {
      const version = await manuscript.flush()
      if (Array.from(version.text).slice(selected.start_codepoint, selected.end_codepoint).join('') !== selected.text) throw new Error('选段已经变化，请重新选择后准备改写。')
      setQuickRewrite({ id: uuid(), base_version_id: version.id, action, selection: selected })
      setSelection(null); setAssistantOpen(true); setCandidateView(false)
      if (compact) setMobileAssistant(true)
    } catch (e) { setError(errorText(e)) } finally { setPreparingSelection(false) }
  }
  async function openCanon() {
    try { const version = await manuscript.flush(); setCanonVersion(version); setCanonOpen(true) } catch (e) { setError(errorText(e)) }
  }
  async function saveMetadata() {
    if (busy) return
    setBusy(true)
    setMetadataError('')
    try {
      await manuscript.flush()
      const values = { title, volume, goal }
      const changes = Object.fromEntries([...metadataTouched].map(key => [key, values[key]]))
      await api.editChapter(novel.id, chapter.id, { ...changes, base_outline_revision: metadataBase.revision, base_volume: metadataBase.volume })
      await Promise.all([['chapter', novel.id, chapter.id], ['chapters', novel.id], ['plans', novel.id], ['novel', novel.id]].map(queryKey => cache.invalidateQueries({ queryKey })))
      setMetadataOpen(false)
    } catch (e) { setMetadataError(errorText(e)) } finally { setBusy(false) }
  }
  function openMetadata() {
    setTitle(chapter.title); setGoal(chapter.goal); setVolume(chapter.volume)
    setMetadataBase({ revision: chapter.outline_revision ?? 0, volume: chapter.volume })
    setMetadataTouched(new Set()); setMetadataLatest(null); setMetadataError(''); setMetadataOpen(true)
  }
  function changeMetadata(key: 'title' | 'volume' | 'goal', value: string) {
    ({ title: setTitle, volume: setVolume, goal: setGoal })[key](value)
    setMetadataTouched(previous => new Set([...previous, key]))
  }
  async function readMetadata() {
    if (busy) return
    setBusy(true)
    try {
      const value = await api.chapter(novel.id, chapter.id)
      if (!metadataTouched.has('title')) setTitle(value.title)
      if (!metadataTouched.has('volume')) setVolume(value.volume)
      if (!metadataTouched.has('goal')) setGoal(value.goal)
      setMetadataBase({ revision: value.outline_revision ?? 0, volume: value.volume }); setMetadataLatest(value); setMetadataError('')
    } catch (e) { setMetadataError(errorText(e)) } finally { setBusy(false) }
  }
  async function restoreBuffer(value: RecoveryDraft) {
    if (manuscript.composing.current) { setError('请先完成当前中文输入，再恢复草稿。'); return }
    try {
      await manuscript.flush()
      editor?.commands.setContent(value.doc, { emitUpdate: false }); manuscript.change({ text: value.text, doc: value.doc })
      await manuscript.flush()
      await manuscript.consumeRecovery(value)
    } catch (e) { setError(errorText(e)) }
  }

  return <div className={`writing-layout ${!assistantOpen ? 'assistant-hidden' : ''} ${!directoryVisible ? 'directory-hidden' : ''} ${focused ? 'writing-focus' : ''}`}>
    <div className="desktop-directory"><ChapterList novel={novel} chapters={chapters} currentId={chapter.id} navigate={navigate} beforeCreate={manuscript.flush} /></div>
    <section className={`editor-panel ${candidateView ? 'viewing-candidate' : ''}`} aria-label="章节写作">
      {!compact && <nav className="document-tabs" aria-label="稿件视图"><button aria-pressed={!candidateView} onClick={() => setCandidateView(false)}>正文</button><button aria-pressed={candidateView} disabled={!hasCandidate || !assistantOpen} onClick={() => setCandidateView(true)}>{candidateLabel}</button><span>{chapter.title}</span></nav>}
      <div className="editor-toolbar"><div className="button-row"><button className="icon-button mobile-directory-toggle" aria-label="打开章节目录" onClick={() => setDirectoryOpen(true)}><List size={20} /></button><span className="editor-volume">{chapter.volume}</span><span className="toolbar-divider" /><button className={`icon-button ${editor?.isActive('bold') ? 'selected' : ''}`} aria-label="加粗" aria-pressed={editor?.isActive('bold')} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()}><TextB size={18} /></button><button className="icon-button" aria-label="斜体" onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()}><TextItalic size={18} /></button><button className="icon-button" aria-label="撤销" onClick={() => editor?.chain().focus().undo().run()}><ArrowCounterClockwise size={17} /></button><button className="icon-button" aria-label="重做" onClick={() => editor?.chain().focus().redo().run()}><ArrowClockwise size={17} /></button></div><div className="button-row"><button className="icon-button pane-toggle desktop-directory-toggle" aria-label={directoryVisible ? '收起章节目录' : '展开章节目录'} aria-expanded={directoryVisible} title={directoryVisible ? '收起章节目录' : '展开章节目录'} onClick={() => setDirectoryVisible(!directoryVisible)}><List size={18} /><span className="toolbar-label">目录</span></button><label className="font-size-label"><span className="sr-only">正文字号</span><select aria-label="正文字号" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}><option value={16}>16</option><option value={18}>18</option><option value={20}>20</option><option value={22}>22</option></select></label><button className="icon-button focus-toggle" aria-label={focused ? '退出专注写作' : '专注写作'} onClick={() => setFocused(!focused)}><Article size={19} /></button><button className="icon-button pane-toggle desktop-assistant-toggle" aria-expanded={assistantOpen} title={assistantOpen ? '收起写作助手' : '展开写作助手'} aria-label={assistantOpen ? '收起写作助手' : '展开写作助手'} onClick={() => { setAssistantOpen(!assistantOpen); setCandidateView(false) }}><SidebarSimple size={19} /><span className="toolbar-label">助手</span></button><button className="icon-button mobile-assistant-toggle" aria-label="打开写作助手" onClick={() => setMobileAssistant(true)}><Sparkle size={20} /></button></div></div>
      {!candidateView && selection && <div className="selection-actions" role="group" aria-label="选段快捷操作"><span>已选 {Array.from(selection.text).length} 字符</span>{Object.entries(rewriteActions).map(([action, value]) => <Button key={action} disabled={preparingSelection} onMouseDown={e => e.preventDefault()} onClick={() => void prepareSelection(action as RewriteAction)} aria-label={`准备${value.name}选段`}>{value.name}</Button>)}<Button variant="ghost" disabled={preparingSelection} aria-label="收起选段快捷操作" onMouseDown={e => e.preventDefault()} onClick={() => setSelection(null)}><X size={16} /></Button></div>}
      <div className="candidate-host" ref={setCandidateHost} hidden={!candidateView} />
      <div className="editor-scroll" hidden={candidateView}>
        <div className="editor-notices">{novel.dirty_from_order != null && novel.dirty_from_order < chapter.position && <Notice>第 {novel.dirty_from_order} 章已修改，请先重新定稿前文，再生成后续章节。</Notice>}{manuscript.recoveries.map(value => <Notice key={value.key} action={<Button onClick={() => void restoreBuffer(value)}>恢复草稿</Button>}>发现一份 {dateLabel(value.updatedAt)} 的浏览器恢复副本。<button className="inline-link" onClick={() => { downloadText(value.text, `${chapter.title}-恢复副本.txt`); manuscript.dismissRecovery(value) }}>先下载副本</button><details><summary>查看恢复副本</summary><pre className="outline-readable">{value.text}</pre></details></Notice>)}{(manuscript.message || error) && <Notice action={manuscript.status === 'error' ? <Button onClick={() => void manuscript.flush().catch(() => undefined)}>重试保存</Button> : undefined}>{manuscript.message || error}</Notice>}</div>
        <div className="manuscript" style={{ '--manuscript-size': `${fontSize}px` } as React.CSSProperties}><div className="chapter-eyebrow">{chapter.review_state === 'confirmed' ? <><CheckCircle size={15} />已定稿</> : chapter.review_state === 'needs_review' ? '待重新定稿' : '草稿'}</div><div className="manuscript-heading"><h1>{chapter.title}</h1><button className="icon-button" aria-label="编辑章节信息" onClick={openMetadata}><DotsThree size={24} /></button></div>{chapter.goal && <details className="chapter-goal"><summary>本章细纲</summary><p>{chapter.goal}</p></details>}<EditorContent editor={editor} /></div>

        <nav className="chapter-pagination" aria-label="前后章节">
          <button disabled={!previousChapter} onClick={() => { if (previousChapter) void navigate({ page: 'write', novelId: novel.id, chapterId: previousChapter.id }).catch(e => setError(errorText(e))) }}><span>‹ 上一章</span><small>{previousChapter?.title || '已是第一章'}</small></button>
          <button disabled={!nextChapter} onClick={() => { if (nextChapter) void navigate({ page: 'write', novelId: novel.id, chapterId: nextChapter.id }).catch(e => setError(errorText(e))) }}><span>下一章 ›</span><small>{nextChapter?.title || '已是最后一章'}</small></button>
        </nav>
      </div>
      <footer className="editor-status" hidden={candidateView}><span className={`save-status save-${manuscript.status}`} role="status">{manuscript.status === 'saved' ? <Check size={14} /> : <span className="status-dot" />}{({ saved: '已保存', dirty: '有未保存修改', saving: '正在保存…', error: '保存未确认', conflict: '版本冲突 · 原文已保留' })[manuscript.status]}</span><span className="editor-wordcount">{number(countChars(manuscript.localText))} 字</span><button onClick={() => { setHistoryOpen(true) }}><ClockCounterClockwise size={16} />版本</button><Button variant="primary" onClick={() => void openCanon()}><CheckCircle size={16} />本章定稿</Button></footer>
    </section>
    {!compact && assistantOpen && <div className="desktop-assistant"><Assistant {...assistantProps} candidateHost={candidateHost} onCandidate={candidateChanged} onShowCandidate={() => setCandidateView(true)} /></div>}
    <Modal open={directoryOpen} onOpenChange={setDirectoryOpen} title="章节目录" description="选择章节或添加新章。" className="directory-modal"><ChapterList novel={novel} chapters={chapters} currentId={chapter.id} navigate={navigate} beforeCreate={manuscript.flush} onClose={() => setDirectoryOpen(false)} /></Modal>
    <Modal open={mobileAssistant} onOpenChange={setMobileAssistant} title="AI 写作" className="assistant-modal"><Assistant {...assistantProps} onClose={() => setMobileAssistant(false)} /></Modal>
    <Modal open={metadataOpen} onOpenChange={value => !busy && setMetadataOpen(value)} dismissible={!busy} title="章节信息"><form className="form-stack" onCompositionStart={() => { metadataComposing.current = true }} onCompositionEnd={() => { metadataComposing.current = false }} onSubmit={e => { e.preventDefault(); if (!metadataComposing.current) void saveMetadata() }}>
      <fieldset className="form-stack metadata-fields" disabled={busy}><legend className="sr-only">编辑章节信息</legend><Field label="章节标题"><input required maxLength={240} value={title} onChange={e => changeMetadata('title', e.target.value)} /></Field><Field label="分卷"><input maxLength={160} value={volume} onChange={e => changeMetadata('volume', e.target.value)} /></Field><Field label="本章细纲"><textarea maxLength={8000} rows={5} value={goal} onChange={e => changeMetadata('goal', e.target.value)} /></Field><Button disabled={metadataTouched.size > 0} onClick={() => void navigate({ page: 'plot', novelId: novel.id, chapterId: chapter.id }).catch(e => setMetadataError(errorText(e)))}>分字段编辑与 AI 修改</Button></fieldset>
      {metadataLatest && <Notice tone="neutral">你的输入仍保留，只会保存你主动修改的字段。<details><summary>查看最新章节信息</summary><p>{metadataLatest.title} · {metadataLatest.volume}</p><pre className="outline-readable">{metadataLatest.goal || '尚未填写细纲'}</pre></details></Notice>}
      {metadataError && <Notice>{metadataError}<Button disabled={busy} onClick={() => void readMetadata()}>读取最新章节信息并比较</Button></Notice>}
      <div className="modal-actions"><Button disabled={busy} onClick={() => setMetadataOpen(false)}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存信息'}</Button></div></form></Modal>
    <Modal dismissible={false} open={!!manuscript.conflict} onOpenChange={() => undefined} title="此章已有另一个版本" description="两份文字都已保留。请比较后选择，关闭页面前可先下载当前草稿。" wide><div className="comparison"><div><h4>本页尚未保存的草稿</h4><div className="comparison-text">{manuscript.localText}</div></div><div><h4>工作区最新版本</h4><div className="comparison-text">{manuscript.conflict?.text}</div></div></div><div className="modal-actions"><Button onClick={() => downloadText(manuscript.localText, `${chapter.title}-冲突草稿.txt`)}>下载本页草稿</Button><Button onClick={() => manuscript.conflict && adopt(manuscript.conflict)}>使用工作区版本</Button><Button variant="primary" onClick={() => void manuscript.rebase().then(value => value && adopt(value)).catch(e => setError(errorText(e)))}>将本页文字另存为新版本</Button></div></Modal>
    {historyOpen && <VersionHistory novelId={novel.id} chapter={chapter} onClose={() => setHistoryOpen(false)} flush={manuscript.flush} onAdopt={adopt} />}
    {canonOpen && canonVersion && <CanonDialog novel={novel} chapter={chapter} version={canonVersion} proposed={changes?.versionId === canonVersion.id ? changes.values : []} onEvidence={onEvidence} onClose={() => setCanonOpen(false)} providers={providers} roles={roles} onNext={async () => { const next = chapters.find(c => c.position === chapter.position + 1); await navigate(next ? { page: 'write', novelId: novel.id, chapterId: next.id } : { page: 'plot', novelId: novel.id }) }} />}
    {styleOpen && <WritingStyleDialog novel={novel} onClose={() => setStyleOpen(false)} />}
  </div>
}

function VersionHistory({ novelId, chapter, onClose, flush, onAdopt }: { novelId: string; chapter: Chapter; onClose: () => void; flush: () => Promise<Version>; onAdopt: (v: Version, expected: Version) => void }) {
  const versions = useQuery({ queryKey: ['versions', novelId, chapter.id], queryFn: () => api.versions(novelId, chapter.id) })
  const [selected, setSelected] = useState(chapter.working_version_id)
  const version = useQuery({ queryKey: ['version', selected], queryFn: () => api.version(novelId, chapter.id, selected) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function restore() {
    if (!version.data) return
    setBusy(true)
    try { const base = await flush(); const saved = await api.save(novelId, chapter.id, { base_version_id: base.id, operation_id: uuid(), text: version.data.text, editor_doc: version.data.editor_doc }); onAdopt(saved, base); onClose() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title="章节版本" description="每次保存都是一个独立版本。恢复会另存新版本，已有文字不会被删除。" wide><div className="version-layout"><div className="version-list">{versions.data?.map(v => <button key={v.id} className={selected === v.id ? 'active' : ''} onClick={() => setSelected(v.id)}><strong>{dateLabel(v.created_at)}</strong><span>{number(v.char_count)} 字 {v.id === chapter.accepted_version_id ? '· 已确认版本' : ''}</span></button>)}</div><div className="version-body">{version.isPending ? <Loading /> : version.error ? <Notice>{errorText(version.error)}</Notice> : <div className="comparison-text">{version.data?.text || '此版本为空。'}</div>}</div></div>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={onClose}>关闭</Button><Button variant="primary" disabled={!version.data || busy || selected === chapter.working_version_id} onClick={() => void restore()}>恢复为新版本</Button></div></Modal>
}

function CanonDialog({ novel, chapter, version, proposed: initialProposed, onEvidence, onClose, providers, roles, onNext }: { novel: Novel; chapter: Chapter; version: Version; proposed: MemoryProposal[]; onEvidence: (e: Evidence) => void; onClose: () => void; providers: Provider[]; roles: Roles; onNext: () => Promise<void> }) {
  const cache = useQueryClient()
  const entities = useQuery({ queryKey: ['entities', novel.id], queryFn: () => api.entities(novel.id) })
  const [proposed, setProposed] = useState(initialProposed)
  const [providerId, setProviderId] = useState(roles.extractor || 'demo')
  const [jobId, setJobId] = useState<string | null>(null)
  const jobs = useQuery({ queryKey: ['jobs', novel.id, chapter.id, 'extract'], queryFn: () => api.jobs(novel.id, { chapter_id: chapter.id, task: 'extract' }) })
  const matching = jobId || jobs.data?.find(j => j.chapter_id === chapter.id && j.base_version_id === version.id && j.task === 'extract' && !['cancelled', 'failed'].includes(j.state))?.id
  const job = useQuery({ queryKey: ['job', matching], queryFn: () => api.job(matching!, novel.id), enabled: !!matching })
  useJobStream(job.data)
  const active = job.data && activeStates.has(job.data.state)
  const applied = useRef<string | null>(null)
  const pending = useRef<JobInput | null>(null)
  const provider = providers.find(p => p.id === providerId)
  useEffect(() => {
    if (job.data?.state === 'succeeded' && job.data.result?.kind === 'extract' && job.data.base_version_id === version.id && applied.current !== job.data.id) {
      applied.current = job.data.id
      setProposed(job.data.result.changes)
      setSelected(job.data.result.changes.map((_, i) => i))
    }
  }, [job.data, version.id])
  async function summarize() {
    setBusy(true); setError('')
    try {
      pending.current ||= { chapter_id: chapter.id, base_version_id: version.id, task: 'extract', provider_id: providerId, target_chars: novel.chapter_words, chapter_batch: 5, instruction: '整理本章影响后续连载的人物变化、重要事件、角色新获知的信息和未回收伏笔。每条必须有可验证的原文依据，不写未来计划。', idempotency_key: uuid(), max_attempts: 3 }
      const created = await api.createJob(novel.id, pending.current)
      pending.current = null; setJobId(created.id); cache.setQueryData(['job', created.id], created)
      await cache.invalidateQueries({ queryKey: ['jobs', novel.id] })
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.current = null
      setError(errorText(e))
    } finally { setBusy(false) }
  }
  const [selected, setSelected] = useState<number[]>(initialProposed.map((_, i) => i))
  const [manual, setManual] = useState<MemoryProposal[]>([])
  const [paragraph, setParagraph] = useState(version.paragraphs[0]?.paragraph_id || '')
  const [claim, setClaim] = useState('')
  const [kind, setKind] = useState<MemoryProposal['kind']>('event')
  const [storyTime, setStoryTime] = useState('')
  const [knownBy, setKnownBy] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const operationId = useRef(uuid())
  function add() {
    const source = version.paragraphs.find(p => p.paragraph_id === paragraph)
    if (!claim.trim() || !source) return
    setManual(previous => [...previous, { kind, claim, subject: '', story_time: storyTime || null, known_by: knownBy, evidence: [{ source_id: `${version.id}:${source.paragraph_id}`, quote: source.text }] }]); setClaim(''); setKnownBy([])
  }
  async function confirm(next = false) {
    setBusy(true)
    try {
      await api.confirm(novel.id, chapter.id, { version_id: version.id, operation_id: operationId.current, changes: [...proposed.filter((_, i) => selected.includes(i)), ...manual] })
      await Promise.all([['novel', novel.id], ['chapter', novel.id, chapter.id], ['chapters', novel.id], ['facts', novel.id], ['novels']].map(queryKey => cache.invalidateQueries({ queryKey }))); onClose(); if (next) await onNext()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title="本章定稿" wide><div className="canon-summary"><CheckCircle size={24} /><div><strong>{chapter.title}</strong><span>{number(version.char_count)} 字 · {dateLabel(version.created_at)}</span></div><Badge>正文将用于后续章节</Badge></div><section className="finalize-memory"><div className="section-heading"><div><h3>本章记忆</h3><p className="muted small">整理人物变化与伏笔，供后文引用。</p></div><Badge tone={provider?.kind === 'demo' ? 'amber' : 'neutral'}>{provider?.kind === 'demo' ? '演示样例' : provider?.model}</Badge></div><div className="finalize-model-row"><label><span className="sr-only">记忆整理模型</span><select aria-label="记忆整理模型" disabled={busy || !!active || !!pending.current} value={providerId} onChange={e => setProviderId(e.target.value)}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Button onClick={() => void summarize()} disabled={busy || !!active || !provider || (provider.kind !== 'demo' && !provider.has_key)}><Sparkle size={17} />{active ? '正在整理…' : pending.current ? '确认上次提交' : 'AI 整理本章记忆'}</Button></div>{pending.current && <Notice>上次提交尚未确认，将使用原模型确认同一次请求。</Notice>}{job.data?.error_message && <Notice>{job.data.error_message}</Notice>}{!proposed.length && !active && <p className="small muted">也可以直接定稿，仅将正文用于后续创作。</p>}</section>{proposed.map((p, i) => <div className="canon-proposal" key={i}><label><input type="checkbox" checked={selected.includes(i)} onChange={() => setSelected(value => value.includes(i) ? value.filter(n => n !== i) : [...value, i])} /><span>{p.claim}</span></label>{p.evidence.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}</div>)}{manual.map((p, i) => <div className="canon-proposal" key={`manual-${i}`}><div className="button-row"><Badge>手动整理</Badge><p>{p.claim}</p><button className="icon-button" aria-label="移除此项变化" onClick={() => setManual(items => items.filter((_, n) => n !== i))}><X size={16} /></button></div><blockquote>{p.evidence[0].quote}</blockquote></div>)}<details className="manual-fact"><summary><Plus size={16} />手动添加一条变化</summary><div className="form-stack"><Field label="原文依据"><select value={paragraph} onChange={e => setParagraph(e.target.value)}>{version.paragraphs.map(p => <option key={p.paragraph_id} value={p.paragraph_id}>{p.text.slice(0, 85)}</option>)}</select></Field><Field label="概括发生了什么"><textarea rows={2} maxLength={3000} value={claim} onChange={e => setClaim(e.target.value)} /></Field><div className="form-row"><Field label="变化类型"><select value={kind} onChange={e => setKind(e.target.value as MemoryProposal['kind'])}><option value="event">事件</option><option value="state">人物或世界状态</option><option value="knowledge">人物获知的信息</option><option value="thread">伏笔</option></select></Field><Field label="故事发生时间（可选）"><input maxLength={240} value={storyTime} onChange={e => setStoryTime(e.target.value)} placeholder="如：抵达雾港的第二天" /></Field></div>{kind === 'knowledge' && <Field label="谁在此时获知此事？"><div className="checkbox-list">{entities.data?.filter(e => e.kind === 'character').map(e => <label key={e.id}><input type="checkbox" checked={knownBy.includes(e.id)} onChange={() => setKnownBy(values => values.includes(e.id) ? values.filter(v => v !== e.id) : [...values, e.id])} />{e.name}</label>)}</div></Field>}<Button disabled={!claim.trim() || !paragraph} onClick={add}>添加到本次确认</Button></div></details>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={onClose}>返回修改</Button><Button disabled={busy || !!active || !version.text.trim()} onClick={() => void confirm()}>仅定稿</Button><Button variant="primary" disabled={busy || !!active || !version.text.trim()} onClick={() => void confirm(true)}><CheckCircle size={17} />{busy ? '正在定稿…' : '确认定稿，下一章'}</Button></div></Modal>
}
