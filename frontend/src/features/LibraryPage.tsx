import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowRight, BookOpen, Plus, Sparkle, UploadSimple, ArrowCounterClockwise, PlugsConnected } from '@phosphor-icons/react'
import { useState } from 'react'
import { api, number, errorText, dateLabel } from '../lib/api'
import type { Novel, ImportChapter } from '../lib/api'
import type { Navigate } from '../lib/route'
import { nextWritingChapter } from '../lib/workflow'
import { Badge, Button, Empty, Field, Loading, Modal, Notice, PageHeading } from '../components/ui'

export async function openNovel(novel: Novel, navigate: Navigate) {
  const chapters = await api.chapters(novel.id)
  const next = nextWritingChapter(chapters)
  if (!next) {
    await navigate({ page: 'plot', novelId: novel.id })
    return
  }
  await navigate({ page: 'write', novelId: novel.id, chapterId: next.id })
}

export function NewNovelModal({ open, onClose, navigate }: { open: boolean; onClose: () => void; navigate: Navigate }) {
  const cache = useQueryClient()
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('悬疑')
  const [premise, setPremise] = useState('')
  const [platform, setPlatform] = useState('番茄小说')
  const [targetWords, setTargetWords] = useState(1000000)
  const [chapterWords, setChapterWords] = useState(2000)
  const mutation = useMutation({ mutationFn: () => api.createNovel({ title: title.trim() || '未命名作品', genre, premise, style: '', platform, target_words: targetWords, chapter_words: chapterWords }),
    onSuccess: async novel => { await cache.invalidateQueries({ queryKey: ['novels'] }); onClose(); await navigate({ page: 'plot', novelId: novel.id }) } })
  return <Modal open={open} onOpenChange={value => !value && onClose()} title="新建小说" wide className="new-novel-modal"><form onSubmit={e => { e.preventDefault(); mutation.mutate() }} className="form-stack">
    <Field label="你想写一个什么故事？"><textarea autoFocus rows={4} value={premise} onChange={e => setPremise(e.target.value)} maxLength={12000} placeholder="例如：一个能听见旧物最后一句话的修复师，在一枚古戒里听到了自己的求救声。" /></Field>

    <div className="form-row"><Field label="题材"><input list="novel-genres" value={genre} maxLength={80} onChange={e => setGenre(e.target.value)} /></Field><Field label="目标平台"><select value={platform} onChange={e => setPlatform(e.target.value)}><option>番茄小说</option><option>起点中文网</option><option>自由创作</option></select></Field></div>
    <Field label="书名（可以稍后由 AI 起名）"><input maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="暂时没有名字也可以开始" /></Field>
    <datalist id="novel-genres">{['玄幻', '仙侠', '都市', '悬疑', '科幻', '历史', '言情'].map(g => <option value={g} key={g} />)}</datalist>
    <details className="new-book-options"><summary>篇幅设置 · {targetWords / 10000} 万字 / 每章 {number(chapterWords)} 字</summary>
    <div className="form-row"><Field label="全书计划"><select value={targetWords} onChange={e => setTargetWords(Number(e.target.value))}>{[100000, 300000, 500000, 1000000, 2000000, 3000000].map(n => <option key={n} value={n}>{n / 10000} 万字</option>)}</select></Field><Field label="每章字数"><select value={chapterWords} onChange={e => setChapterWords(Number(e.target.value))}>{[1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000].map(n => <option key={n} value={n}>{number(n)} 字</option>)}</select></Field></div>
    </details>
    {mutation.error && <Notice>{errorText(mutation.error)}</Notice>}
    <div className="modal-actions"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? '正在创建…' : '下一步：全书方案'}<ArrowRight size={17} /></Button></div>
  </form></Modal>
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
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const novels = useQuery({ queryKey: ['novels', archived], queryFn: () => api.novels(archived) })
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const realProvider = providers.data?.find(p => p.kind !== 'demo' && p.has_key)
  const demo = useMutation({ mutationFn: api.demo, onSuccess: async novel => { await cache.invalidateQueries({ queryKey: ['novels'] }); await openNovel(novel, navigate) } })
  const list = (novels.data ?? []).filter(n => [n.title, n.genre, n.premise].join(' ').includes(query))
  async function archive(novel: Novel) {
    try { await api.editNovel(novel.id, { archived: !archived, base_settings_revision: novel.settings_revision }); await cache.invalidateQueries({ queryKey: ['novels'] }); setError('') }
    catch (e) { setError(errorText(e)); void cache.invalidateQueries({ queryKey: ['novels'] }) }
  }
  return <div className="page library-page"><PageHeading title="我的作品" action={<div className="button-row"><Button onClick={() => setImporting(true)}><UploadSimple size={18} />导入手稿</Button><Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />新建小说</Button></div>} />
    <div className="library-model"><div className={`model-beacon ${realProvider ? "active" : ""}`} /><PlugsConnected size={20} /><span>{realProvider ? <><strong>{realProvider.name}</strong><small>{realProvider.model}</small></> : <><strong>连接你的 AI，开始创作</strong><small>支持 OpenAI 兼容接口</small></>}</span><Button variant="ghost" onClick={() => void navigate({ page: 'settings' })}>{realProvider ? '管理模型' : '连接模型'}<ArrowRight size={16} /></Button></div>
    <div className="section-tabs"><button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>创作中</button><button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>已归档</button><span className="tab-end">最近编辑</span></div>
    {(error || demo.error || novels.error) && <Notice>{error || errorText(demo.error ?? novels.error)}</Notice>}
    {novels.isLoading ? <Loading /> : list.length ? <div className="book-grid">{list.map(novel => <article className="library-book" key={novel.id}><button className="library-book-main" onClick={() => void navigate({ page: 'plot', novelId: novel.id })} aria-label={`打开${novel.title}`}><div className="studio-book-cover" aria-hidden="true"><BookOpen size={24} weight="light" /><span>{novel.title}</span></div><div className="library-book-info"><div className="book-category">{novel.genre || '未分类'}<span>/</span>{novel.platform}{novel.is_demo && <Badge tone="amber">示例</Badge>}</div><h2>{novel.title}</h2><p>{novel.premise || '继续完善这个故事的想法。'}</p><div className="book-counts"><strong>{number(novel.total_chars)} <small>字</small></strong><span>{novel.chapter_count} 章</span><span>{novel.accepted_count} 章定稿</span></div></div></button><div className="library-book-footer"><span>{dateLabel(novel.updated_at)}</span><div className="button-row">{!archived && <Button variant="primary" onClick={() => void openNovel(novel, navigate).catch(e => setError(errorText(e)))}>{!novel.chapter_count ? '开始策划' : novel.accepted_count === novel.chapter_count ? '规划下一章' : '继续写作'}<ArrowRight size={16} /></Button>}<button className="icon-button" aria-label={archived ? `恢复${novel.title}` : `归档${novel.title}`} onClick={() => void archive(novel)}>{archived ? <ArrowCounterClockwise size={18} /> : <Archive size={18} />}</button></div></div></article>)}</div> : <Empty icon={<BookOpen size={36} weight="light" />} title={query ? '没有找到这部作品' : archived ? '没有归档作品' : '你的第一本小说，从一个想法开始'} action={!archived && !query ? <Button variant="primary" onClick={() => setCreating(true)}><Sparkle size={18} />创建第一本小说</Button> : undefined}>{query ? '试试其他书名或题材。' : !archived ? '让 AI 帮你策划全书，再逐章创作。' : undefined}</Empty>}
    {!archived && !list.some(n => n.is_demo) && <button className="demo-link" onClick={() => demo.mutate()} disabled={demo.isPending}>{demo.isPending ? '正在载入…' : '先看示例作品'}<ArrowRight size={16} /></button>}
    {creating && <NewNovelModal open={creating} onClose={() => setCreating(false)} navigate={navigate} />}
    {importing && <ImportModal open={importing} onClose={() => setImporting(false)} navigate={navigate} />}
  </div>
}
