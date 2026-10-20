import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowCounterClockwise, ArrowClockwise, Article, Check, CheckCircle, ClockCounterClockwise, DotsThree, List, Plus, SidebarSimple, Sparkle, TextB, TextItalic, X } from '@phosphor-icons/react'
import type { JSONContent } from '@tiptap/core'
import { api, countChars, dateLabel, downloadText, errorText, number, uuid } from '../lib/api'
import type { Chapter, ChapterSummary, Evidence, MemoryProposal, Novel, Provider, Roles, Selection, Version } from '../lib/api'
import type { Navigate } from '../lib/route'
import { useManuscript } from '../lib/useManuscript'
import { Badge, Button, Field, Loading, Modal, Notice } from '../components/ui'
import { Assistant, SourceButton } from './Assistant'

type Props = { novel: Novel; chapter: Chapter; chapters: ChapterSummary[]; workspaceId: string; providers: Provider[]; roles: Roles; navigate: Navigate; onEvidence: (e: Evidence) => void; registerGuard: (guard: (() => Promise<unknown>) | null) => void }

export function ChapterList({ novel, chapters, currentId, navigate, beforeCreate, onClose }: { novel: Novel; chapters: ChapterSummary[]; currentId: string; navigate: Navigate; beforeCreate?: () => Promise<unknown>; onClose?: () => void }) {
  const cache = useQueryClient()
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  async function add() {
    try {
      setCreating(true); await beforeCreate?.()
      const next = await api.createChapter(novel.id, { title: `第${chapters.length + 1}章`, volume: chapters.at(-1)?.volume || '第一卷', goal: '' })
      await cache.invalidateQueries({ queryKey: ['chapters', novel.id] })
      await navigate({ page: 'write', novelId: novel.id, chapterId: next.id }); onClose?.()
    } catch (e) { setError(errorText(e)) } finally { setCreating(false) }
  }
  return <aside className="chapter-panel" aria-label="章节目录"><div className="chapter-heading"><strong>章节目录</strong><button className="icon-button" aria-label="新建章节" onClick={() => void add()} disabled={creating}><Plus size={18} /></button></div><div className="chapter-progress"><span>{novel.accepted_count} / {chapters.length} 章已确认</span><span>{number(novel.total_chars)} 字</span></div><div className="chapter-scroll">{chapters.map((chapter, i) => <div key={chapter.id}>{(i === 0 || chapters[i - 1].volume !== chapter.volume) && <h3 className="volume-title">{chapter.volume || '未分卷'}</h3>}<button className={`chapter-item ${chapter.id === currentId ? 'active' : ''}`} onClick={() => { void navigate({ page: 'write', novelId: novel.id, chapterId: chapter.id }); onClose?.() }} aria-current={chapter.id === currentId ? 'page' : undefined}><span className="chapter-state">{chapter.review_state === 'confirmed' ? <CheckCircle size={16} /> : chapter.review_state === 'needs_review' ? <ClockCounterClockwise size={16} /> : <span className="chapter-dot" />}</span><span className="chapter-item-text"><strong>{chapter.title}</strong><small>{chapter.review_state === 'confirmed' ? '已确认' : chapter.review_state === 'needs_review' ? '待重新确认' : chapter.char_count ? '草稿' : '待创作'}<span>{number(chapter.char_count)} 字</span></small></span></button></div>)}</div>{error && <Notice>{error}</Notice>}<button className="chapter-add" onClick={() => void add()} disabled={creating}><Plus size={17} />新建章节</button><div className="chapter-legend"><CheckCircle size={14} />确认后才进入正式记忆</div></aside>
}

export function EditorPage({ novel, chapter, chapters, workspaceId, providers, roles, navigate, onEvidence, registerGuard }: Props) {
  const cache = useQueryClient()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [mobileAssistant, setMobileAssistant] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
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
  const [busy, setBusy] = useState(false)
  const commit = useCallback((version: Version) => {
    cache.setQueryData<Chapter>(['chapter', novel.id, chapter.id], old => old ? { ...old, version, working_version_id: version.id, char_count: version.char_count, review_state: old.accepted_version_id && old.accepted_version_id !== version.id ? 'needs_review' : old.review_state } : old)
    void cache.invalidateQueries({ queryKey: ['chapters', novel.id] })
    void cache.invalidateQueries({ queryKey: ['novel', novel.id] })
    void cache.invalidateQueries({ queryKey: ['novels'] })
    void cache.invalidateQueries({ queryKey: ['facts', novel.id] })
  }, [cache, novel.id, chapter.id])
  const initial = useRef(chapter.version).current
  const manuscript = useManuscript(novel.id, chapter.id, workspaceId, initial, commit)
  const stateRef = useRef(manuscript)
  stateRef.current = manuscript

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, codeBlock: false, horizontalRule: false, link: false, underline: false }), Placeholder.configure({ placeholder: '故事，从这里开始。\n写下第一句话，或让助手给你一份候选。' })],
    content: initial.editor_doc,
    editorProps: {
      attributes: { class: 'manuscript-content', role: 'textbox', 'aria-label': '小说正文', 'aria-multiline': 'true', spellcheck: 'false' },
      handleDOMEvents: {
        compositionstart: () => { stateRef.current.composing.current = true; return false },
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

  const adopt = useCallback((version: Version) => {
    editor?.commands.setContent(version.editor_doc, { emitUpdate: false })
    manuscript.accept(version)
  }, [editor, manuscript.accept])
  const extraction = useCallback((values: MemoryProposal[], versionId: string) => setChanges(previous => previous?.versionId === versionId && JSON.stringify(previous.values) === JSON.stringify(values) ? previous : { values, versionId }), [])
  const assistantProps = { novel, chapter, providers, roles, flush: manuscript.flush, selection, onAdopt: adopt, onEvidence, onExtractReady: extraction }
  async function openCanon() {
    try { const version = await manuscript.flush(); setCanonVersion(version); setCanonOpen(true) } catch (e) { setError(errorText(e)) }
  }
  async function saveMetadata() {
    setBusy(true)
    try { await manuscript.flush(); await api.editChapter(novel.id, chapter.id, { title, volume, goal }); await cache.invalidateQueries({ queryKey: ['chapter', novel.id, chapter.id] }); await cache.invalidateQueries({ queryKey: ['chapters', novel.id] }); setMetadataOpen(false) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function restoreBuffer(doc: JSONContent, text: string) {
    editor?.commands.setContent(doc, { emitUpdate: false }); manuscript.change({ text, doc }); manuscript.setRecovery(null)
  }

  return <div className={`writing-layout ${!assistantOpen ? 'assistant-hidden' : ''} ${focused ? 'writing-focus' : ''}`}>
    <div className="desktop-directory"><ChapterList novel={novel} chapters={chapters} currentId={chapter.id} navigate={navigate} beforeCreate={manuscript.flush} /></div>
    <section className="editor-panel" aria-label="章节写作"><div className="editor-toolbar"><div className="button-row"><button className="icon-button mobile-directory-toggle" aria-label="打开章节目录" onClick={() => setDirectoryOpen(true)}><List size={20} /></button><span className="editor-volume">{chapter.volume}</span><span className="toolbar-divider" /><button className={`icon-button ${editor?.isActive('bold') ? 'selected' : ''}`} aria-label="加粗" aria-pressed={editor?.isActive('bold')} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()}><TextB size={18} /></button><button className="icon-button" aria-label="斜体" onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()}><TextItalic size={18} /></button><button className="icon-button" aria-label="撤销" onClick={() => editor?.chain().focus().undo().run()}><ArrowCounterClockwise size={17} /></button><button className="icon-button" aria-label="重做" onClick={() => editor?.chain().focus().redo().run()}><ArrowClockwise size={17} /></button></div><div className="button-row"><label className="font-size-label"><span className="sr-only">正文字号</span><select aria-label="正文字号" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}><option value={16}>16</option><option value={18}>18</option><option value={20}>20</option><option value={22}>22</option></select></label><button className="icon-button focus-toggle" aria-label={focused ? '退出专注写作' : '专注写作'} onClick={() => setFocused(!focused)}><Article size={19} /></button><button className="icon-button desktop-assistant-toggle" aria-label={assistantOpen ? '收起写作助手' : '展开写作助手'} onClick={() => setAssistantOpen(!assistantOpen)}><SidebarSimple size={19} /></button><button className="icon-button mobile-assistant-toggle" aria-label="打开写作助手" onClick={() => setMobileAssistant(true)}><Sparkle size={20} /></button></div></div>
      <div className="editor-scroll">
        <div className="editor-notices">{novel.dirty_from_order != null && novel.dirty_from_order < chapter.position && <Notice>第 {novel.dirty_from_order} 章起有正史需要重新确认。你可以继续手写；依赖前文的续写会在确认后恢复。</Notice>}{manuscript.recovery && <Notice action={<Button onClick={() => void restoreBuffer(manuscript.recovery!.doc, manuscript.recovery!.text)}>恢复草稿</Button>}>发现一份 {dateLabel(manuscript.recovery.updatedAt)} 的浏览器恢复副本。<button className="inline-link" onClick={() => { downloadText(manuscript.recovery!.text, `${chapter.title}-恢复副本.txt`); manuscript.setRecovery(null) }}>先下载副本</button></Notice>}{(manuscript.message || error) && <Notice action={manuscript.status === 'error' ? <Button onClick={() => void manuscript.flush().catch(() => undefined)}>重试保存</Button> : undefined}>{manuscript.message || error}</Notice>}</div>
        <div className="manuscript" style={{ '--manuscript-size': `${fontSize}px` } as React.CSSProperties}><div className="chapter-eyebrow">{chapter.review_state === 'confirmed' ? <><CheckCircle size={15} />已确认正史</> : chapter.review_state === 'needs_review' ? '待重新确认 · 旧版本仍保留' : '正在创作 · 草稿'}</div><div className="manuscript-heading"><h1>{chapter.title}</h1><button className="icon-button" aria-label="编辑章节信息" onClick={() => { setTitle(chapter.title); setGoal(chapter.goal); setVolume(chapter.volume); setMetadataOpen(true) }}><DotsThree size={24} /></button></div>{chapter.goal && <details className="chapter-goal"><summary>本章意图</summary><p>{chapter.goal}</p></details>}<EditorContent editor={editor} /></div>
        <div className="chapter-end"><span /><span>故事还在继续</span><span /></div>
      </div>
      <footer className="editor-status"><span className={`save-status save-${manuscript.status}`} role="status">{manuscript.status === 'saved' ? <Check size={14} /> : <span className="status-dot" />}{({ saved: '已保存到工作区', dirty: '有未保存修改', saving: '正在保存…', error: '保存未确认', conflict: '版本冲突 · 原文已保留' })[manuscript.status]}</span><span className="editor-wordcount">{number(countChars(manuscript.localText))} 字</span><button onClick={() => { setHistoryOpen(true) }}><ClockCounterClockwise size={16} />版本</button><Button variant="primary" onClick={() => void openCanon()}><CheckCircle size={16} />确认正史</Button></footer>
    </section>
    {assistantOpen && <div className="desktop-assistant"><Assistant {...assistantProps} /></div>}
    <Modal open={directoryOpen} onOpenChange={setDirectoryOpen} title="章节目录" description="选择章节或添加新章。" className="directory-modal"><ChapterList novel={novel} chapters={chapters} currentId={chapter.id} navigate={navigate} beforeCreate={manuscript.flush} onClose={() => setDirectoryOpen(false)} /></Modal>
    <Modal open={mobileAssistant} onOpenChange={setMobileAssistant} title="写作助手" description="生成候选后，由你决定是否采纳。" className="assistant-modal"><Assistant {...assistantProps} onClose={() => setMobileAssistant(false)} /></Modal>
    <Modal open={metadataOpen} onOpenChange={setMetadataOpen} title="章节信息"><form className="form-stack" onSubmit={e => { e.preventDefault(); void saveMetadata() }}><Field label="章节标题"><input required maxLength={240} value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="分卷"><input maxLength={160} value={volume} onChange={e => setVolume(e.target.value)} /></Field><Field label="本章意图" help="这是未来写作方向，不代表事件已经发生。"><textarea maxLength={8000} rows={5} value={goal} onChange={e => setGoal(e.target.value)} /></Field>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={() => setMetadataOpen(false)}>取消</Button><Button type="submit" variant="primary" disabled={busy}>保存信息</Button></div></form></Modal>
    <Modal dismissible={false} open={!!manuscript.conflict} onOpenChange={() => undefined} title="此章已有另一个版本" description="两份文字都已保留。请比较后选择，关闭页面前可先下载当前草稿。" wide><div className="comparison"><div><h4>本页尚未保存的草稿</h4><div className="comparison-text">{manuscript.localText}</div></div><div><h4>工作区最新版本</h4><div className="comparison-text">{manuscript.conflict?.text}</div></div></div><div className="modal-actions"><Button onClick={() => downloadText(manuscript.localText, `${chapter.title}-冲突草稿.txt`)}>下载本页草稿</Button><Button onClick={() => manuscript.conflict && adopt(manuscript.conflict)}>使用工作区版本</Button><Button variant="primary" onClick={() => void manuscript.rebase().then(value => value && adopt(value)).catch(e => setError(errorText(e)))}>将本页文字另存为新版本</Button></div></Modal>
    {historyOpen && <VersionHistory novelId={novel.id} chapter={chapter} onClose={() => setHistoryOpen(false)} flush={manuscript.flush} onAdopt={adopt} />}
    {canonOpen && canonVersion && <CanonDialog novel={novel} chapter={chapter} version={canonVersion} proposed={changes?.versionId === canonVersion.id ? changes.values : []} onEvidence={onEvidence} onClose={() => setCanonOpen(false)} />}
  </div>
}

function VersionHistory({ novelId, chapter, onClose, flush, onAdopt }: { novelId: string; chapter: Chapter; onClose: () => void; flush: () => Promise<Version>; onAdopt: (v: Version) => void }) {
  const versions = useQuery({ queryKey: ['versions', novelId, chapter.id], queryFn: () => api.versions(novelId, chapter.id) })
  const [selected, setSelected] = useState(chapter.working_version_id)
  const version = useQuery({ queryKey: ['version', selected], queryFn: () => api.version(novelId, chapter.id, selected) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function restore() {
    if (!version.data) return
    setBusy(true)
    try { const base = await flush(); const saved = await api.save(novelId, chapter.id, { base_version_id: base.id, operation_id: uuid(), text: version.data.text, editor_doc: version.data.editor_doc }); onAdopt(saved); onClose() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title="章节版本" description="每次保存都是一个独立版本。恢复会另存新版本，已有文字不会被删除。" wide><div className="version-layout"><div className="version-list">{versions.data?.map(v => <button key={v.id} className={selected === v.id ? 'active' : ''} onClick={() => setSelected(v.id)}><strong>{dateLabel(v.created_at)}</strong><span>{number(v.char_count)} 字 {v.id === chapter.accepted_version_id ? '· 已确认版本' : ''}</span></button>)}</div><div className="version-body">{version.isPending ? <Loading /> : version.error ? <Notice>{errorText(version.error)}</Notice> : <div className="comparison-text">{version.data?.text || '此版本为空。'}</div>}</div></div>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={onClose}>关闭</Button><Button variant="primary" disabled={!version.data || busy || selected === chapter.working_version_id} onClick={() => void restore()}>恢复为新版本</Button></div></Modal>
}

function CanonDialog({ novel, chapter, version, proposed, onEvidence, onClose }: { novel: Novel; chapter: Chapter; version: Version; proposed: MemoryProposal[]; onEvidence: (e: Evidence) => void; onClose: () => void }) {
  const cache = useQueryClient()
  const entities = useQuery({ queryKey: ['entities', novel.id], queryFn: () => api.entities(novel.id) })
  const [selected, setSelected] = useState<number[]>(proposed.map((_, i) => i))
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
  async function confirm() {
    setBusy(true)
    try {
      await api.confirm(novel.id, chapter.id, { version_id: version.id, operation_id: operationId.current, changes: [...proposed.filter((_, i) => selected.includes(i)), ...manual] })
      await Promise.all([['novel', novel.id], ['chapter', novel.id, chapter.id], ['chapters', novel.id], ['facts', novel.id], ['novels']].map(queryKey => cache.invalidateQueries({ queryKey }))); onClose()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title="确认本章正史" description="确认当前正文与选中的变化。前文必须依次确认；后续修改会让相关记忆失效。" wide><div className="canon-summary"><CheckCircle size={24} /><div><strong>{chapter.title}</strong><span>{number(version.char_count)} 字 · {dateLabel(version.created_at)}</span></div><Badge>当前正史修订 {novel.canon_revision}</Badge></div><h3>本章变化</h3>{!proposed.length && <Notice tone="neutral">尚无 AI 提取候选。你可以手动整理事实，或先确认正文，之后补充记忆。</Notice>}{proposed.map((p, i) => <div className="canon-proposal" key={i}><label><input type="checkbox" checked={selected.includes(i)} onChange={() => setSelected(value => value.includes(i) ? value.filter(n => n !== i) : [...value, i])} /><span>{p.claim}</span></label>{p.evidence.map((e, j) => <SourceButton key={j} evidence={e} onEvidence={onEvidence} />)}</div>)}{manual.map((p, i) => <div className="canon-proposal" key={`manual-${i}`}><div className="button-row"><Badge>手动整理</Badge><p>{p.claim}</p><button className="icon-button" aria-label="移除此项变化" onClick={() => setManual(items => items.filter((_, n) => n !== i))}><X size={16} /></button></div><blockquote>{p.evidence[0].quote}</blockquote></div>)}<details className="manual-fact"><summary><Plus size={16} />手动添加一条变化</summary><div className="form-stack"><Field label="原文依据"><select value={paragraph} onChange={e => setParagraph(e.target.value)}>{version.paragraphs.map(p => <option key={p.paragraph_id} value={p.paragraph_id}>{p.text.slice(0, 85)}</option>)}</select></Field><Field label="概括发生了什么"><textarea rows={2} maxLength={3000} value={claim} onChange={e => setClaim(e.target.value)} /></Field><div className="form-row"><Field label="变化类型"><select value={kind} onChange={e => setKind(e.target.value as MemoryProposal['kind'])}><option value="event">事件</option><option value="state">人物或世界状态</option><option value="knowledge">人物获知的信息</option><option value="thread">伏笔</option></select></Field><Field label="故事发生时间（可选）"><input maxLength={240} value={storyTime} onChange={e => setStoryTime(e.target.value)} placeholder="如：抵达雾港的第二天" /></Field></div>{kind === 'knowledge' && <Field label="谁在此时获知此事？"><div className="checkbox-list">{entities.data?.filter(e => e.kind === 'character').map(e => <label key={e.id}><input type="checkbox" checked={knownBy.includes(e.id)} onChange={() => setKnownBy(values => values.includes(e.id) ? values.filter(v => v !== e.id) : [...values, e.id])} />{e.name}</label>)}</div></Field>}<Button disabled={!claim.trim() || !paragraph} onClick={add}>添加到本次确认</Button></div></details>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={onClose}>暂不确认</Button><Button variant="primary" disabled={busy || !version.text.trim()} onClick={() => void confirm()}><CheckCircle size={17} />{busy ? '正在确认…' : `确认正文与 ${selected.length + manual.length} 条变化`}</Button></div></Modal>
}
