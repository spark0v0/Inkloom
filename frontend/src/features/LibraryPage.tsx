import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowRight, BookOpen, FileText, FolderOpen, Lightbulb, Plus, UploadSimple, ArrowCounterClockwise } from '@phosphor-icons/react'
import { useState } from 'react'
import { api, number, errorText, dateLabel } from '../lib/api'
import type { Novel, ImportChapter } from '../lib/api'
import type { Navigate } from '../lib/route'
import { Badge, Button, Empty, Field, Loading, Modal, Notice, PageHeading, TextLink } from '../components/ui'

export async function openNovel(novel: Novel, navigate: Navigate) {
  const chapters = await api.chapters(novel.id)
  if (!chapters.length) {
    const first = await api.createChapter(novel.id, { title: '第一章', volume: '第一卷', goal: novel.premise })
    await navigate({ page: 'write', novelId: novel.id, chapterId: first.id })
    return
  }
  const written = chapters.filter(c => c.char_count > 0)
  const last = [...(written.length ? written : chapters)].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  await navigate({ page: 'write', novelId: novel.id, chapterId: last.id })
}

export function NewNovelModal({ open, onClose, navigate, idea = false }: { open: boolean; onClose: () => void; navigate: Navigate; idea?: boolean }) {
  const cache = useQueryClient()
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('')
  const [premise, setPremise] = useState('')
  const mutation = useMutation({ mutationFn: () => api.createNovel({ title, genre, premise, style: '' }),
    onSuccess: async novel => { await cache.invalidateQueries({ queryKey: ['novels'] }); onClose(); await openNovel(novel, navigate) } })
  return <Modal open={open} onOpenChange={value => !value && onClose()} title={idea ? '从一句创意开始' : '新建作品'} description="只需一个名字，就可以开始写作。其他内容可以慢慢补全。">
    <form onSubmit={e => { e.preventDefault(); mutation.mutate() }} className="form-stack">
      <Field label="作品名"><input autoFocus required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="给故事起一个暂时的名字" /></Field>
      <Field label="题材（可选）"><input maxLength={80} value={genre} onChange={e => setGenre(e.target.value)} placeholder="如：悬疑、仙侠、都市、现实" /></Field>
      <Field label={idea ? '一句话创意' : '故事方向（可选）'} help="先保存你的想法，之后可以在剧情规划中继续完善。"><textarea rows={4} value={premise} onChange={e => setPremise(e.target.value)} maxLength={12000} placeholder="谁想得到什么，又被什么阻挡？" /></Field>
      {mutation.error && <Notice>{errorText(mutation.error)}</Notice>}
      <div className="modal-actions"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={!title.trim() || mutation.isPending}>{mutation.isPending ? '正在创建…' : '创建并开始写作'}<ArrowRight size={17} /></Button></div>
    </form>
  </Modal>
}

export function ImportModal({ open, onClose, navigate }: { open: boolean; onClose: () => void; navigate: Navigate }) {
  const cache = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [encoding, setEncoding] = useState('utf-8')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [chapters, setChapters] = useState<ImportChapter[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  async function decode(selectedFile: File, code: string) {
    try {
      if (selectedFile.size > 6_000_000) throw new Error('手稿超过 6 MB，请分卷导入。')
      const body = new TextDecoder(code, { fatal: true }).decode(await selectedFile.arrayBuffer())
      setText(body); setChapters([]); setError('')
      if (!title) setTitle(selectedFile.name.replace(/\.(txt|md|markdown)$/i, ''))
    } catch { setError('文件无法按所选编码读取，请切换编码后检查预览，或使用 UTF-8 文件。') }
  }
  const preview = useMutation({ mutationFn: () => api.importPreview(text), onSuccess: value => { setChapters(value); setSelected(0) } })
  const importing = useMutation({ mutationFn: () => api.import(title, chapters), onSuccess: async novel => { await cache.invalidateQueries({ queryKey: ['novels'] }); onClose(); await openNovel(novel, navigate) } })
  return <Modal open={open} onOpenChange={value => !value && onClose()} title="导入已有手稿" description="先核对编码与章节切分；导入后的内容均为草稿，不会自动写入正史。" wide>
    <div className="form-stack">
      <div className="form-row"><Field label="选择 TXT / Markdown"><input type="file" accept=".txt,.md,.markdown" onChange={e => { const chosen = e.target.files?.[0]; if (chosen) { setFile(chosen); void decode(chosen, encoding) } }} /></Field>
        <Field label="文件编码"><select value={encoding} onChange={e => { setEncoding(e.target.value); if (file) void decode(file, e.target.value) }}><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="utf-16le">UTF-16 LE</option></select></Field></div>
      <Field label="作品名"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} /></Field>
      {!chapters.length ? <Field label="手稿预览或粘贴正文"><textarea rows={8} value={text} onChange={e => { setText(e.target.value); setError('') }} placeholder="支持第X章标题；未识别到章节时将作为单章导入。" /></Field> : <div className="import-preview"><div className="import-chapters" aria-label="章节切分预览">{chapters.map((chapter, i) => <button className={i === selected ? 'selected' : ''} key={i} onClick={() => setSelected(i)}>{chapter.title}</button>)}</div><div className="form-stack"><Field label="修正章节名"><input value={chapters[selected]?.title ?? ''} onChange={e => setChapters(previous => previous.map((c, i) => i === selected ? { ...c, title: e.target.value } : c))} /></Field><Field label="章节正文"><textarea rows={8} value={chapters[selected]?.text ?? ''} onChange={e => setChapters(previous => previous.map((c, i) => i === selected ? { ...c, text: e.target.value } : c))} /></Field></div></div>}
      {(error || preview.error || importing.error) && <Notice>{error || errorText(preview.error ?? importing.error)}</Notice>}
      <div className="modal-actions"><Button onClick={onClose}>取消</Button>{chapters.length > 0 && <Button onClick={() => setChapters([])}>重新切分</Button>}{chapters.length ? <Button variant="primary" disabled={!title.trim() || importing.isPending} onClick={() => importing.mutate()}>{importing.isPending ? '正在导入…' : `确认导入 ${chapters.length} 章`}</Button> : <Button variant="primary" disabled={!text.trim() || preview.isPending} onClick={() => preview.mutate()}>预览章节切分</Button>}</div>
    </div>
  </Modal>
}

export function LibraryPage({ navigate, query = '' }: { navigate: Navigate; query?: string }) {
  const cache = useQueryClient()
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [idea, setIdea] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const novels = useQuery({ queryKey: ['novels', archived], queryFn: () => api.novels(archived) })
  const demo = useMutation({ mutationFn: api.demo, onSuccess: async novel => { await cache.invalidateQueries({ queryKey: ['novels'] }); await openNovel(novel, navigate) } })
  const list = (novels.data ?? []).filter(n => [n.title, n.genre, n.premise].join(' ').includes(query))
  async function archive(novel: Novel) {
    try { await api.editNovel(novel.id, { archived: !archived }); await cache.invalidateQueries({ queryKey: ['novels'] }) }
    catch (e) { setError(errorText(e)) }
  }
  return <div className="page library-page">
    <PageHeading title="我的作品" description="把灵感写成故事，把故事慢慢写完。" action={<div className="button-row"><Button onClick={() => setImporting(true)}><UploadSimple size={18} />导入手稿</Button><Button variant="primary" onClick={() => { setIdea(false); setCreating(true) }}><Plus size={18} />新建作品</Button></div>} />
    <div className="section-tabs"><button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>全部作品</button><button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>已归档</button><span className="tab-end">按最近编辑排序</span></div>
    {(error || demo.error || novels.error) && <Notice>{error || errorText(demo.error ?? novels.error)}</Notice>}
    {novels.isLoading ? <Loading /> : list.length ? <div className="novel-list">{list.map(novel => <article className="novel-feature" key={novel.id}>
      <button className="book-cover" onClick={() => void openNovel(novel, navigate).catch(e => setError(errorText(e)))} aria-label={`打开${novel.title}`}><BookOpen size={30} weight="light" /><span>{novel.title}</span><small>{novel.genre || '创作手稿'}</small></button>
      <div className="novel-info"><div className="novel-title-row"><h2>{novel.title}</h2>{novel.genre && <Badge tone="green">{novel.genre}</Badge>}{novel.is_demo && <Badge tone="amber">示例作品</Badge>}</div><p className="novel-description">{novel.premise || '故事还在生长，下一段由你决定。'}</p>
        <div className="novel-meta"><span><FileText />{novel.chapter_count} 章</span><span>{number(novel.total_chars)} 字</span><span>{novel.accepted_count} 章已确认</span></div>
        <div className="button-row">{!archived && <><Button onClick={() => void openNovel(novel, navigate).catch(e => setError(errorText(e)))}><BookOpen size={18} />继续创作</Button><TextLink onClick={() => void navigate({ page: 'bible', novelId: novel.id })}>故事档案</TextLink></>}<Button variant="ghost" onClick={() => void archive(novel)}>{archived ? <ArrowCounterClockwise size={17} /> : <Archive size={17} />}{archived ? '恢复到书架' : '归档'}</Button></div>
      </div><div className="novel-side-note"><span>最近编辑</span><strong>{dateLabel(novel.updated_at)}</strong><p>每次保存都会保留正文版本。</p>{novel.dirty_from_order && <Badge tone="amber">第 {novel.dirty_from_order} 章起待复核</Badge>}</div>
    </article>)}</div> : <Empty icon={<BookOpen size={38} weight="light" />} title={query ? '没有找到这部作品' : archived ? '还没有归档的作品' : '给下一个故事，留一页空白'} action={!archived && !query ? <div className="button-row"><Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />新建第一部作品</Button><Button onClick={() => demo.mutate()} disabled={demo.isPending}>{demo.isPending ? '正在载入…' : '打开示例作品'}</Button></div> : undefined}>{query ? '试试其他书名或题材。' : '可以从空白开始，也可以先用示例作品熟悉创作流程。'}</Empty>}
    <section className="start-section"><h2>开始一个新故事</h2><div className="start-options"><button onClick={() => { setIdea(false); setCreating(true) }}><FileText size={28} weight="light" /><span><strong>空白作品</strong><small>直接进入编辑器，从第一段开始。</small></span><ArrowRight size={19} /></button><button onClick={() => { setIdea(true); setCreating(true) }}><Lightbulb size={28} weight="light" /><span><strong>从创意开始</strong><small>写下一句话，再逐步补全故事方向。</small></span><ArrowRight size={19} /></button><button onClick={() => setImporting(true)}><UploadSimple size={28} weight="light" /><span><strong>导入已有手稿</strong><small>支持 TXT 与 Markdown，先预览再导入。</small></span><ArrowRight size={19} /></button></div></section>
    <div className="workspace-note"><FolderOpen size={26} weight="light" /><div><strong>作品保存在你的工作区</strong><p>没有模型也可以写作。连接云端模型时，选定上下文会发送到你配置的服务。</p></div><TextLink onClick={() => void navigate({ page: 'settings' })}>管理模型连接</TextLink></div>
    {list.length > 0 && !list.some(n => n.is_demo) && !archived && <button className="demo-link" onClick={() => demo.mutate()} disabled={demo.isPending}>载入示例作品，熟悉候选稿与正史流程</button>}
    {creating && <NewNovelModal open={creating} onClose={() => setCreating(false)} navigate={navigate} idea={idea} />}
    {importing && <ImportModal open={importing} onClose={() => setImporting(false)} navigate={navigate} />}
  </div>
}
