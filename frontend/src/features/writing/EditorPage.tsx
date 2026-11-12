import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Article, Check, CheckCircle, ClockCounterClockwise, DotsThree, List, SidebarSimple, Sparkle, X } from '@phosphor-icons/react'
import { api, countChars, dateLabel, downloadText, errorText, number, uuid } from '../../lib/api'
import type { Chapter, ChapterSummary, Evidence, MemoryProposal, Novel, Roles, Selection, Version } from '../../lib/api'
import type { Navigate } from '../../app/route'
import { useManuscript } from './useManuscript'
import { useReadingPreferences } from './useReadingPreferences'
import type { RecoveryDraft } from '../../lib/drafts'
import { Button, Field, Modal, Notice } from '../../components/ui'
import { Assistant } from './Assistant'
import { ChapterList } from './ChapterList'
import { ManuscriptTools } from './ManuscriptTools'
import { rewriteActions } from '../../lib/writing'
import type { RewriteAction, SelectionRewrite } from '../../lib/writing'
import { cleanEntityName } from '../../lib/entityTemplates'

const CanonDialog = lazy(() => import('./ChapterFinalizeDialog').then(m => ({ default: m.CanonDialog })))
const ReviewImpactDialog = lazy(() => import('../story/ReviewImpactDialog').then(m => ({ default: m.ReviewImpactDialog })))
const WritingStyleDialog = lazy(() => import('./WritingStyleDialog').then(m => ({ default: m.WritingStyleDialog })))
const VersionHistoryDialog = lazy(() => import('./VersionHistoryDialog').then(m => ({ default: m.VersionHistoryDialog })))
const emptyRoles: Roles = { writer: '', planner: '', reviewer: '', extractor: '' }

type Props = {
  novel: Novel; chapter: Chapter; chapters: ChapterSummary[]; workspaceId: string;
  navigate: Navigate; onEvidence: (e: Evidence) => void; registerGuard: (guard: (() => Promise<unknown>) | null) => void;
  readWarning?: { message: string; retry: () => void };
}

export function EditorPage({ novel, chapter, chapters, workspaceId, navigate, onEvidence, registerGuard, readWarning }: Props) {
  const cache = useQueryClient()
  const connections = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const roleConfig = useQuery({ queryKey: ['roles'], queryFn: api.roles })
  const modelReadError = connections.error ?? roleConfig.error
  const providers = roleConfig.data && !modelReadError ? connections.data ?? [] : []
  const roles = roleConfig.data ?? emptyRoles
  const modelWarning = modelReadError ? errorText(modelReadError) : undefined
  const retryModels = () => { void connections.refetch(); void roleConfig.refetch() }
  const [selection, setSelection] = useState<Selection | null>(null)
  const [quickRewrite, setQuickRewrite] = useState<SelectionRewrite | null>(null)
  const [preparingSelection, setPreparingSelection] = useState(false)
  const [composing, setComposing] = useState(false)
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
  const [impactOpen, setImpactOpen] = useState(false)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [error, setError] = useState('')
  const { fontSize, fontFamily, setFontSize, setFontFamily } = useReadingPreferences()
  const [focused, setFocused] = useState(false)
  const [changes, setChanges] = useState<{ versionId: string; values: MemoryProposal[] } | null>(null)
  const [canonVersion, setCanonVersion] = useState<Version | null>(null)
  const [quickEntityText, setQuickEntityText] = useState<string | null>(null)
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
        compositionstart: () => { stateRef.current.composing.current = true; setComposing(true); setSelection(null); return false },
        compositionend: () => {
          stateRef.current.composing.current = false
          setComposing(false)
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
  const assistantProps = {
    novel,
    chapter,
    workspaceId,
    providers,
    roles,
    modelWarning,
    retryModels,
    flush: manuscript.flush,
    selection,
    quickRewrite,
    onQuickPrepared: quickPrepared,
    onWritingStyle: () => setStyleOpen(true),
    onAdopt: adopt,
    onEvidence,
    onExtractReady: extraction,
    blockedChapter: previous?.title,
    onResolvePrevious: () => {
      if (previous) void navigate({ page: 'write', novelId: novel.id, chapterId: previous.id }).catch(e => setError(errorText(e)))
    },
  }
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
      await api.editChapter(novel.id, chapter.id, { ...changes, base_outline_revision: metadataBase.revision, base_volume: metadataBase.volume }, workspaceId)
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

  return <div className={`writing-layout ${!assistantOpen ? 'assistant-hidden' : ''} ${!directoryVisible ? 'directory-hidden' : ''} ${focused ? 'writing-focus' : ''}`} style={{ '--manuscript-size': `${fontSize}px`, '--manuscript-font': fontFamily === 'serif' ? 'var(--font-reading-serif)' : 'var(--font-ui)' } as React.CSSProperties}>
    <div className="desktop-directory"><ChapterList workspaceId={workspaceId} novel={novel} chapters={chapters} currentId={chapter.id} navigate={navigate} beforeCreate={manuscript.flush} /></div>
    <section className={`editor-panel ${candidateView ? 'viewing-candidate' : ''}`} aria-label="章节写作">
      {!compact && <nav className="document-tabs" aria-label="稿件视图"><button aria-pressed={!candidateView} onClick={() => setCandidateView(false)}>正文</button><button aria-pressed={candidateView} disabled={!hasCandidate || !assistantOpen} onClick={() => setCandidateView(true)}>{candidateLabel}</button><span>{chapter.title}</span></nav>}
      <div className="editor-toolbar"><div className="button-row"><button className="icon-button mobile-directory-toggle" aria-label="打开章节目录" onClick={() => setDirectoryOpen(true)}><List size={20} /></button><span className="editor-volume">{chapter.volume}</span><span className="toolbar-divider" /><ManuscriptTools editor={editor} composing={composing} /></div><div className="button-row"><button className="icon-button pane-toggle desktop-directory-toggle" aria-label={directoryVisible ? '收起章节目录' : '展开章节目录'} aria-expanded={directoryVisible} title={directoryVisible ? '收起章节目录' : '展开章节目录'} onClick={() => setDirectoryVisible(!directoryVisible)}><List size={18} /><span className="toolbar-label">目录</span></button><label className="reading-font"><span className="sr-only">正文字体</span><select aria-label="正文字体" value={fontFamily} onChange={e => setFontFamily(e.target.value === 'serif' ? 'serif' : 'sans')}><option value="sans">黑体</option><option value="serif">宋体</option></select></label><label className="font-size-label"><span className="sr-only">正文字号</span><select aria-label="正文字号" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}><option value={16}>16</option><option value={18}>18</option><option value={20}>20</option><option value={22}>22</option></select></label><button className="icon-button focus-toggle" aria-label={focused ? '退出专注写作' : '专注写作'} onClick={() => setFocused(!focused)}><Article size={19} /></button><button className="icon-button pane-toggle desktop-assistant-toggle" aria-expanded={assistantOpen} title={assistantOpen ? '收起写作助手' : '展开写作助手'} aria-label={assistantOpen ? '收起写作助手' : '展开写作助手'} onClick={() => { setAssistantOpen(!assistantOpen); setCandidateView(false) }}><SidebarSimple size={19} /><span className="toolbar-label">助手</span></button><button className="icon-button mobile-assistant-toggle" aria-label="打开写作助手" onClick={() => setMobileAssistant(true)}><Sparkle size={20} /></button></div></div>
      {!candidateView && selection && (
        <div className="selection-actions" role="group" aria-label="选段快捷操作">
          <span className="selection-count">已选 {Array.from(selection.text).length} 字</span>
          <div className="selection-btn-group">
            {Object.entries(rewriteActions).map(([action, value]) => (
              <Button
                key={action}
                disabled={preparingSelection}
                onMouseDown={e => e.preventDefault()}
                onClick={() => void prepareSelection(action as RewriteAction)}
                aria-label={`准备${value.name}选段`}
                className="selection-action-btn"
              >
                {value.name}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            disabled={preparingSelection}
            onMouseDown={e => e.preventDefault()}
            onClick={() => setQuickEntityText(selection.text)}
            title="将选中的词条快速存入设定库"
            className="selection-entity-btn"
          >
            + 记为设定
          </Button>
          <button
            type="button"
            className="icon-button selection-close-btn"
            disabled={preparingSelection}
            aria-label="收起选段快捷操作"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setSelection(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="candidate-host" ref={setCandidateHost} hidden={!candidateView} />
      <div className="editor-scroll" hidden={candidateView}>
        <div className="editor-notices">{readWarning && <Notice action={<Button onClick={readWarning.retry}>重读资料</Button>}>暂时无法刷新资料。{readWarning.message}</Notice>}{novel.dirty_from_order != null && <Notice action={<Button onClick={() => void manuscript.flush().then(() => setImpactOpen(true)).catch(e => setError(errorText(e)))}>查看复核清单</Button>}>第 {novel.dirty_from_order} 章起需要复核，请按顺序检查后重新定稿。</Notice>}{manuscript.recoveries.map(value => <Notice key={value.key} action={<Button onClick={() => void restoreBuffer(value)}>恢复草稿</Button>}>发现一份 {dateLabel(value.updatedAt)} 的浏览器恢复副本。<button className="inline-link" onClick={() => { downloadText(value.text, `${chapter.title}-恢复副本.txt`); manuscript.dismissRecovery(value) }}>先下载副本</button><details><summary>查看恢复副本</summary><pre className="outline-readable">{value.text}</pre></details></Notice>)}{(manuscript.message || error) && <Notice action={manuscript.status === 'error' ? <Button onClick={() => void manuscript.flush().catch(() => undefined)}>重试保存</Button> : undefined}>{manuscript.message || error}</Notice>}</div>
        <div className="manuscript"><div className="chapter-eyebrow">{chapter.review_state === 'confirmed' ? <><CheckCircle size={15} />已定稿</> : chapter.review_state === 'needs_review' ? '待重新定稿' : '草稿'}</div><div className="manuscript-heading"><h1>{chapter.title}</h1><button className="icon-button" aria-label="编辑章节信息" onClick={openMetadata}><DotsThree size={24} /></button></div>{chapter.goal && <details className="chapter-goal"><summary>本章细纲</summary><p>{chapter.goal}</p></details>}<EditorContent editor={editor} /></div>

        <nav className="chapter-pagination" aria-label="前后章节">
          <button disabled={!previousChapter} onClick={() => { if (previousChapter) void navigate({ page: 'write', novelId: novel.id, chapterId: previousChapter.id }).catch(e => setError(errorText(e))) }}><span>‹ 上一章</span><small>{previousChapter?.title || '已是第一章'}</small></button>
          <button disabled={!nextChapter} onClick={() => { if (nextChapter) void navigate({ page: 'write', novelId: novel.id, chapterId: nextChapter.id }).catch(e => setError(errorText(e))) }}><span>下一章 ›</span><small>{nextChapter?.title || '已是最后一章'}</small></button>
        </nav>
      </div>
      <footer className="editor-status" hidden={candidateView}><span className={`save-status save-${manuscript.status}`} role="status">{manuscript.status === 'saved' ? <Check size={14} /> : <span className="status-dot" />}{({ saved: '已保存', dirty: '有未保存修改', saving: '正在保存…', error: '保存未确认', conflict: '版本冲突 · 原文已保留' })[manuscript.status]}</span><span className="editor-wordcount">{number(countChars(manuscript.localText))} 字</span><button onClick={() => { setHistoryOpen(true) }}><ClockCounterClockwise size={16} />版本</button><Button variant="primary" onClick={() => void openCanon()}><CheckCircle size={16} />本章定稿</Button></footer>
    </section>
    {!compact && assistantOpen && <div className="desktop-assistant"><Assistant {...assistantProps} candidateHost={candidateHost} onCandidate={candidateChanged} onShowCandidate={() => setCandidateView(true)} /></div>}
    <Modal open={directoryOpen} onOpenChange={setDirectoryOpen} title="章节目录" description="选择章节或添加新章。" className="directory-modal"><ChapterList workspaceId={workspaceId} novel={novel} chapters={chapters} currentId={chapter.id} navigate={navigate} beforeCreate={manuscript.flush} onClose={() => setDirectoryOpen(false)} /></Modal>
    <Modal open={mobileAssistant} onOpenChange={setMobileAssistant} title="AI 写作" className="assistant-modal"><Assistant {...assistantProps} onClose={() => setMobileAssistant(false)} /></Modal>
    <Modal open={metadataOpen} onOpenChange={value => !busy && setMetadataOpen(value)} dismissible={!busy} title="章节信息"><form className="form-stack" onCompositionStart={() => { metadataComposing.current = true }} onCompositionEnd={() => { metadataComposing.current = false }} onSubmit={e => { e.preventDefault(); if (!metadataComposing.current) void saveMetadata() }}>
      <fieldset className="form-stack metadata-fields" disabled={busy}><legend className="sr-only">编辑章节信息</legend><Field label="章节标题"><input required maxLength={240} value={title} onChange={e => changeMetadata('title', e.target.value)} /></Field><Field label="分卷"><input maxLength={160} value={volume} onChange={e => changeMetadata('volume', e.target.value)} /></Field><Field label="本章细纲"><textarea maxLength={8000} rows={5} value={goal} onChange={e => changeMetadata('goal', e.target.value)} /></Field><Button disabled={metadataTouched.size > 0} onClick={() => void navigate({ page: 'plot', novelId: novel.id, chapterId: chapter.id }).catch(e => setMetadataError(errorText(e)))}>分字段编辑与 AI 修改</Button></fieldset>
      {metadataLatest && <Notice tone="neutral">你的输入仍保留，只会保存你主动修改的字段。<details><summary>查看最新章节信息</summary><p>{metadataLatest.title} · {metadataLatest.volume}</p><pre className="outline-readable">{metadataLatest.goal || '尚未填写细纲'}</pre></details></Notice>}
      {metadataError && <Notice>{metadataError}<Button disabled={busy} onClick={() => void readMetadata()}>读取最新章节信息并比较</Button></Notice>}
      <div className="modal-actions"><Button disabled={busy} onClick={() => setMetadataOpen(false)}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存信息'}</Button></div></form></Modal>
    <Modal dismissible={false} open={!!manuscript.conflict} onOpenChange={() => undefined} title="此章已有另一个版本" description="两份文字都已保留。请比较后选择，关闭页面前可先下载当前草稿。" wide><div className="comparison"><div><h4>本页尚未保存的草稿</h4><div className="comparison-text">{manuscript.localText}</div></div><div><h4>工作区最新版本</h4><div className="comparison-text">{manuscript.conflict?.text}</div></div></div><div className="modal-actions"><Button onClick={() => downloadText(manuscript.localText, `${chapter.title}-冲突草稿.txt`)}>下载本页草稿</Button><Button onClick={() => manuscript.conflict && adopt(manuscript.conflict)}>使用工作区版本</Button><Button variant="primary" onClick={() => void manuscript.rebase().then(value => value && adopt(value)).catch(e => setError(errorText(e)))}>将本页文字另存为新版本</Button></div></Modal>
    <Suspense fallback={null}>
      {historyOpen && <VersionHistoryDialog novelId={novel.id} chapter={chapter} workspaceId={workspaceId} onClose={() => setHistoryOpen(false)} flush={manuscript.flush} onAdopt={adopt} />}
      {impactOpen && <ReviewImpactDialog novelId={novel.id} workspaceId={workspaceId} navigate={navigate} onClose={() => setImpactOpen(false)} />}
      {canonOpen && canonVersion && <CanonDialog workspaceId={workspaceId} novel={novel} chapter={chapter} version={canonVersion} proposed={changes?.versionId === canonVersion.id ? changes.values : []} onEvidence={onEvidence} onClose={() => setCanonOpen(false)} providers={providers} roles={roles} onNext={async () => { const next = chapters.find(c => c.position === chapter.position + 1); await navigate(next ? { page: 'write', novelId: novel.id, chapterId: next.id } : { page: 'plot', novelId: novel.id }) }} />}
      {styleOpen && <WritingStyleDialog novel={novel} onClose={() => setStyleOpen(false)} />}
    </Suspense>
    {quickEntityText !== null && <InlineQuickEntityModal novelId={novel.id} initialName={quickEntityText} onClose={() => setQuickEntityText(null)} />}
  </div>
}

function InlineQuickEntityModal({
  novelId,
  initialName,
  onClose
}: {
  novelId: string
  initialName: string
  onClose: () => void
}) {
  const cache = useQueryClient()
  const [kind, setKind] = useState<'character' | 'world'>('character')
  const [name, setName] = useState(() => cleanEntityName(initialName))
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const composing = useRef(false)

  async function handleSave() {
    if (!name.trim() || pending.current || composing.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await api.saveEntity(novelId, {
        kind,
        name: name.trim(),
        summary: summary.trim(),
        body: '',
        aliases: [name.trim()],
        status: 'author'
      })
      await cache.invalidateQueries({ queryKey: ['entities', novelId] })
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      dismissible={!busy}
      onOpenChange={v => !v && onClose()}
      title="快速记录设定词条"
      description="无需离开写作页面，直接将词条添加进小说世界观与人物库。"
    >
      <form
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => { composing.current = false }}
        onSubmit={e => {
          e.preventDefault()
          void handleSave()
        }}
        className="form-stack"
      >
        <fieldset disabled={busy} className="form-stack metadata-fields">
          <legend className="sr-only">快速设定内容</legend>
          <div className="form-row">
            <Field label="设定类型">
              <select value={kind} onChange={e => setKind(e.target.value as 'character' | 'world')}>
                <option value="character">人物 / 配角</option>
                <option value="world">世界设定 / 功法 / 宗门</option>
              </select>
            </Field>
            <Field label="名称">
              <input required maxLength={80} value={name} onChange={e => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="一句话简述（可选）" help="简短记录其身份、功法境界或关键特征">
            <textarea
              rows={2}
              maxLength={1000}
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="例如：云岚宗外门长老，对主角怀有敌意"
            />
          </Field>
        </fieldset>
        {error && <Notice>{error}</Notice>}
        <div className="modal-actions" style={{ marginTop: '12px' }}>
          <Button type="button" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? '正在保存…' : '存入设定库'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
