import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowRight, BookOpen, Plus, UploadSimple, ArrowCounterClockwise, PlugsConnected } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { api, canUseProvider, number, errorText, dateLabel } from '../lib/api'
import type { Novel } from '../lib/api'
import type { Navigate } from '../lib/route'
import { nextWritingChapter } from '../lib/workflow'
import { ImportModal } from './ImportModal'
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
  const pending = useRef(false)
  const composing = useRef(false)
  const mutation = useMutation({ mutationFn: () => api.createNovel({ title: title.trim() || '未命名作品', genre, premise, style: '', platform, target_words: targetWords, chapter_words: chapterWords }),
    onSuccess: async novel => { await cache.invalidateQueries({ queryKey: ['novels'] }); onClose(); await navigate({ page: 'plot', novelId: novel.id }) }, onSettled: () => { pending.current = false } })
  return <Modal open={open} dismissible={!mutation.isPending} onOpenChange={value => !value && onClose()} title="新建小说" wide className="new-novel-modal"><form onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onSubmit={e => { e.preventDefault(); if (!pending.current && !composing.current) { pending.current = true; mutation.mutate() } }} className="form-stack"><fieldset disabled={mutation.isPending} className="form-stack metadata-fields"><legend className="sr-only">新小说信息</legend>
    <Field label="你想写一个什么故事？"><textarea autoFocus rows={4} value={premise} onChange={e => setPremise(e.target.value)} maxLength={12000} placeholder="例如：一个能听见旧物最后一句话的修复师，在一枚古戒里听到了自己的求救声。" /></Field>

    <div className="form-row"><Field label="题材"><input list="novel-genres" value={genre} maxLength={80} onChange={e => setGenre(e.target.value)} /></Field><Field label="目标平台"><select value={platform} onChange={e => setPlatform(e.target.value)}><option>番茄小说</option><option>起点中文网</option><option>自由创作</option></select></Field></div>
    <Field label="书名（可以稍后由 AI 起名）"><input maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="暂时没有名字也可以开始" /></Field>
    <datalist id="novel-genres">{['玄幻', '仙侠', '都市', '悬疑', '科幻', '历史', '言情'].map(g => <option value={g} key={g} />)}</datalist>
    <details className="new-book-options"><summary>篇幅设置 · {targetWords / 10000} 万字 / 每章 {number(chapterWords)} 字</summary>
    <div className="form-row"><Field label="全书计划"><select value={targetWords} onChange={e => setTargetWords(Number(e.target.value))}>{[100000, 300000, 500000, 1000000, 2000000, 3000000].map(n => <option key={n} value={n}>{n / 10000} 万字</option>)}</select></Field><Field label="每章字数"><select value={chapterWords} onChange={e => setChapterWords(Number(e.target.value))}>{[1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000].map(n => <option key={n} value={n}>{number(n)} 字</option>)}</select></Field></div>
    </details>
    </fieldset>
    {mutation.error && <Notice>{errorText(mutation.error)}</Notice>}
    <div className="modal-actions"><Button disabled={mutation.isPending} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? '正在创建…' : '下一步：全书方案'}<ArrowRight size={17} /></Button></div>
  </form></Modal>
}

export function LibraryPage({ navigate, query = '' }: { navigate: Navigate; query?: string }) {
  const cache = useQueryClient()
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const opening = useRef(false)
  const mounted = useRef(true)
  const navigationEpoch = useRef(0)
  useEffect(() => {
    mounted.current = true
    const invalidate = () => { navigationEpoch.current++ }
    window.addEventListener('hashchange', invalidate)
    return () => { mounted.current = false; window.removeEventListener('hashchange', invalidate) }
  }, [])
  const novels = useQuery({ queryKey: ['novels', archived], queryFn: () => api.novels(archived) })
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles })
  const writer = providers.data?.find(p => p.id === roles.data?.writer)
  const writerReady = canUseProvider(writer)
  const demo = useMutation({ mutationFn: api.demo, onSuccess: async novel => { await cache.invalidateQueries({ queryKey: ['novels'] }); await openNovel(novel, navigate) } })
  const search = query.normalize('NFKC').trim().toLocaleLowerCase()
  const list = (novels.data ?? []).filter(n => [n.title, n.genre, n.premise].join(' ').normalize('NFKC').toLocaleLowerCase().includes(search))
  async function continueNovel(novel: Novel) {
    if (opening.current) return
    opening.current = true; setOpeningId(novel.id); setError('')
    const startedAt = { epoch: navigationEpoch.current, hash: location.hash }
    try {
      // Suspense may keep the library mounted while the destination loads. Check
      // navigation intent as well as unmounting before using a delayed response.
      await openNovel(novel, next => mounted.current && navigationEpoch.current === startedAt.epoch && location.hash === startedAt.hash ? navigate(next) : Promise.resolve())
    } catch (e) { if (mounted.current) setError(errorText(e)) }
    finally { opening.current = false; if (mounted.current) setOpeningId(null) }
  }
  async function archive(novel: Novel) {
    try { await api.editNovel(novel.id, { archived: !archived, base_settings_revision: novel.settings_revision }); await cache.invalidateQueries({ queryKey: ['novels'] }); setError('') }
    catch (e) { setError(errorText(e)); void cache.invalidateQueries({ queryKey: ['novels'] }) }
  }
  return <div className="page library-page"><PageHeading title="我的作品" action={<div className="button-row"><Button onClick={() => setImporting(true)}><UploadSimple size={18} />导入手稿</Button><Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />新建小说</Button></div>} />
    <div className="library-model"><PlugsConnected size={18} /><span><small>写作模型</small><strong>{providers.isPending || roles.isPending ? '正在读取…' : writer?.name || '尚未配置'}</strong><small>{writer?.kind === 'demo' ? '演示 · 固定样例' : writer ? writerReady ? writer.model : '连接尚不可用' : '可在模型设置中连接'}</small></span><Button variant="ghost" onClick={() => void navigate({ page: 'settings' })}>{writer?.kind === 'demo' || !writerReady ? '连接模型' : '管理模型'}<ArrowRight size={16} /></Button></div>
    {(providers.error || roles.error) && <Notice>无法读取模型设置：{errorText(providers.error ?? roles.error)}<button className="inline-link" onClick={() => { void providers.refetch(); void roles.refetch() }}>重新读取</button></Notice>}
    <div className="section-tabs"><button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>创作中</button><button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>已归档</button><span className="tab-end">最近编辑</span></div>
    {(error || demo.error || novels.error) && <Notice>{error || errorText(demo.error ?? novels.error)}</Notice>}
    {novels.isLoading ? <Loading /> : list.length ? <div className="book-grid">{list.map(novel => <article className="library-book" key={novel.id}>
      <button className="library-book-main" onClick={() => void navigate({ page: 'plot', novelId: novel.id })} aria-label={`打开${novel.title}`}>
        <div className="studio-book-cover" aria-hidden="true"><span>{novel.title}</span></div>
        <div className="library-book-info">
          <div className="book-category">{novel.genre || '未分类'}<span>/</span>{novel.platform}{novel.is_demo && <Badge tone="amber">示例</Badge>}</div>
          <h2>{novel.title}</h2><p>{novel.premise || '继续完善这个故事的想法。'}</p>
          <div className="book-counts"><strong>{number(novel.total_chars)} <small>字</small></strong><span>{novel.chapter_count} 章</span><span>{novel.accepted_count} 章定稿</span></div>
        </div>
      </button>
      <div className="library-book-footer"><span>{dateLabel(novel.updated_at)}</span><div className="button-row">
        {!archived && <Button disabled={!!openingId} onClick={() => void continueNovel(novel)}>{openingId === novel.id ? '正在打开…' : !novel.chapter_count ? '开始策划' : novel.accepted_count === novel.chapter_count ? '规划下一章' : '继续写作'}<ArrowRight size={16} /></Button>}
        <button className="icon-button" aria-label={archived ? `恢复${novel.title}` : `归档${novel.title}`} onClick={() => void archive(novel)}>{archived ? <ArrowCounterClockwise size={18} /> : <Archive size={18} />}</button>
      </div></div>
    </article>)}</div> : <Empty icon={<BookOpen size={32} weight="light" />} title={search ? '没有找到这部作品' : archived ? '没有归档作品' : '从一个想法，写下第一章'} action={!archived && !search ? <Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />创建第一本小说</Button> : undefined}>{search ? '试试其他书名或题材。' : !archived ? '新建小说规划全书，或导入已有手稿继续写。' : undefined}</Empty>}
    {!archived && !list.some(n => n.is_demo) && <button className="demo-link" onClick={() => demo.mutate()} disabled={demo.isPending}>{demo.isPending ? '正在载入…' : '先看示例作品'}<ArrowRight size={16} /></button>}
    {creating && <NewNovelModal open={creating} onClose={() => setCreating(false)} navigate={navigate} />}
    {importing && <ImportModal open={importing} onClose={() => setImporting(false)} onImported={async novel => { await openNovel(novel, navigate); setImporting(false) }} />}
  </div>
}
