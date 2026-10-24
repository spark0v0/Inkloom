import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { api, errorText } from '../lib/api'
import type { Chapter, ReferenceSelection } from '../lib/api'
import { Badge, Button, Field, Loading, Modal, Notice } from '../components/ui'

type Props = { novelId: string; chapter: Chapter; onClose: () => void; onSaved: () => void }
const categories = { entities: '人物与设定', chapters: '前文定稿', notes: '补充资料' } as const

export function ChapterReferencesDialog({ novelId, chapter, onClose, onSaved }: Props) {
  const cache = useQueryClient()
  const entities = useQuery({ queryKey: ['entities', novelId], queryFn: () => api.entities(novelId), staleTime: 0, refetchOnMount: 'always' })
  const chapters = useQuery({ queryKey: ['chapters', novelId], queryFn: () => api.chapters(novelId), staleTime: 0, refetchOnMount: 'always' })
  const current = useQuery({ queryKey: ['references', novelId, chapter.id], queryFn: () => api.references(novelId, chapter.id), staleTime: 0, refetchOnMount: 'always' })
  const [selection, setSelection] = useState<ReferenceSelection>(chapter.references)
  const [revision, setRevision] = useState(chapter.references_revision)
  const [category, setCategory] = useState<keyof typeof categories>('entities')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const refreshing = current.isFetching || entities.isFetching || chapters.isFetching
  useEffect(() => {
    if (!initialized && current.data && !refreshing) {
      setSelection(current.data.selection); setRevision(current.data.revision); setInitialized(true)
    }
  }, [initialized, current.data, refreshing])
  const entityIds = selection.entity_ids || []
  const pinned = selection.chapters || []
  const notes = selection.notes || ''
  const query = search.trim().toLowerCase()
  const match = (value: string) => !query || value.toLowerCase().includes(query)
  const allEntities = entities.data || []
  const earlier = (chapters.data || []).filter(item => item.position < chapter.position)
  const visibleEntities = allEntities.filter(item => match(`${item.name} ${item.aliases?.join(' ')} ${item.summary} ${item.body}`))
  const visibleChapters = earlier.filter(item => match(`${item.title} ${item.volume} ${item.goal} ${item.position}`))
  const count = entityIds.length + pinned.length
  const loading = !initialized || entities.isPending || chapters.isPending
  const readError = current.error || entities.error || chapters.error
  const invalidSelection = !loading && !readError && (
    entityIds.some(id => !allEntities.some(item => item.id === id && item.status === 'author')) ||
    pinned.some(pin => !earlier.some(item => item.id === pin.chapter_id && item.review_state === 'confirmed' && item.accepted_version_id === pin.version_id))
  )

  function toggleEntity(id: string) {
    setSelection(value => ({ ...value, entity_ids: entityIds.includes(id) ? entityIds.filter(key => key !== id) : [...entityIds, id] }))
  }
  function removeChapter(id: string) {
    setSelection(value => ({ ...value, chapters: pinned.filter(pin => pin.chapter_id !== id) }))
  }
  function useCurrentVersion(id: string) {
    const item = earlier.find(value => value.id === id)
    if (!item?.accepted_version_id || item.review_state !== 'confirmed') return
    setSelection(value => ({ ...value, chapters: [...pinned.filter(pin => pin.chapter_id !== id), { chapter_id: id, version_id: item.accepted_version_id! }] }))
  }
  async function save() {
    setBusy(true); setError('')
    try {
      await api.saveReferences(novelId, chapter.id, { base_revision: revision, selection })
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['chapter', novelId, chapter.id] }),
        cache.invalidateQueries({ queryKey: ['chapters', novelId] }),
        cache.invalidateQueries({ queryKey: ['jobs', novelId] }),
        cache.invalidateQueries({ queryKey: ['job'] }),
      ])
      onSaved()
    } catch (e) {
      setError(errorText(e)); setConflict(typeof e === 'object' && e !== null && 'code' in e && e.code === 'REFERENCE_CONFLICT')
    } finally { setBusy(false) }
  }
  async function reload() {
    setBusy(true)
    try {
      const latest = await api.references(novelId, chapter.id)
      setSelection(latest.selection); setRevision(latest.revision); setError(''); setConflict(false)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return <Modal open onOpenChange={open => !open && !busy && onClose()} title="本章参考"
    description="这些资料会随本章生成发送给所选模型。保存不会调用 AI。" wide className="references-modal" dismissible={!busy}>
    <nav className="reference-tabs" aria-label="本章参考分类">
      {Object.entries(categories).map(([key, label]) => <button key={key} disabled={busy || loading} aria-pressed={category === key} onClick={() => { setCategory(key as keyof typeof categories); setSearch('') }}>{label}</button>)}
    </nav>
    <fieldset className="reference-editing" disabled={busy}><legend className="sr-only">设置本章参考</legend><div className="references-body">
      <div className="reference-options">
        {category !== 'notes' && <label className="search-input"><MagnifyingGlass size={18} /><input disabled={loading} aria-label="搜索本章参考" placeholder="搜索名称、别名或内容" value={search} onChange={e => setSearch(e.target.value)} maxLength={200} /></label>}
        {readError ? <Notice>{errorText(readError)}<Button onClick={() => { void current.refetch(); void entities.refetch(); void chapters.refetch() }}>重新读取</Button></Notice> : loading ? <Loading label="正在读取本书资料…" /> : category === 'notes' ? <Field label="本章补充资料" help="可填写研究笔记、文风要求或待验证的想法。仅作参考，不会成为故事中已发生事实的证据。"><textarea rows={12} value={notes} maxLength={12000} onChange={e => setSelection(value => ({ ...value, notes: e.target.value }))} placeholder="粘贴这次需要 AI 了解的资料，或留空…" /></Field> : category === 'entities' ? <>
          <fieldset className="reference-list"><legend className="sr-only">选择必读设定，最多 40 项</legend>
            {visibleEntities.slice(0, 100).map(item => {
              const selected = entityIds.includes(item.id)
              return <label className={`reference-option ${selected ? 'selected' : ''}`} key={item.id}>
                <input type="checkbox" checked={selected} disabled={busy || (!selected && (item.status !== 'author' || entityIds.length >= 40))} onChange={() => toggleEntity(item.id)} />
                <span><strong>{item.name}</strong><small>{item.summary || item.aliases?.join('、') || '已确认的作者设定'}</small></span>
                {item.status !== 'author' && <Badge tone="amber">待确认</Badge>}
              </label>
            })}
          </fieldset>
          {!visibleEntities.length && <div className="reference-empty">{query ? '没有匹配的设定，试试人物名或别名。' : '本书还没有设定，可先在“人物与设定”添加，或填写补充资料。'}<Button onClick={() => setCategory('notes')}>填写补充资料</Button></div>}
          {visibleEntities.length > 100 && <p className="small muted">显示前 100 项，请搜索名称或内容缩小范围。</p>}
        </> : <>
          <p className="small muted">只可引用本章之前的定稿。当前正文已自动作为基线。</p>
          <fieldset className="reference-list"><legend className="sr-only">选择必读前文，最多 8 章</legend>
            {visibleChapters.slice(0, 100).map(item => {
              const pin = pinned.find(value => value.chapter_id === item.id)
              const ready = item.review_state === 'confirmed' && !!item.accepted_version_id
              return <label className={`reference-option ${pin ? 'selected' : ''}`} key={item.id}>
                <input type="checkbox" checked={!!pin} disabled={busy || (!pin && (!ready || pinned.length >= 8))} onChange={() => pin ? removeChapter(item.id) : useCurrentVersion(item.id)} />
                <span><strong>{item.title}</strong><small>{item.volume}</small></span><Badge tone={ready ? 'neutral' : 'amber'}>{ready ? '已定稿' : '待定稿'}</Badge>
              </label>
            })}
          </fieldset>
          {!visibleChapters.length && <p className="reference-empty">{query ? '没有匹配的前文，试试章名或章号。' : '本章之前还没有章节，完成前章定稿后即可选择。'}</p>}
          {visibleChapters.length > 100 && <p className="small muted">显示前 100 章，请搜索章名或章号。</p>}
        </>}
      </div>
      <aside className="reference-selected" aria-label="已选必读">
        <div className="reference-selected-heading"><h3>已选必读 <span>{count}</span></h3>{count > 0 && <Button disabled={loading} variant="ghost" onClick={() => setSelection(value => ({ ...value, entity_ids: [], chapters: [] }))}>移除全部</Button>}</div>
        {!count && <p className="small muted">未指定必读，仍会自动召回相关内容。</p>}
        {entityIds.map(id => {
          const item = allEntities.find(value => value.id === id)
          const label = item?.name || '已移除的设定'
          return <div className="reference-selected-item" key={id}><div><strong>{label}</strong>{item && item.status === 'author' ? <small>作者设定</small> : !loading && <Badge tone="amber">请移除或先确认</Badge>}</div><button className="icon-button" aria-label={`移除设定${label}`} disabled={busy || loading} onClick={() => toggleEntity(id)}><X size={16} /></button></div>
        })}
        {pinned.map(pin => {
          const item = earlier.find(value => value.id === pin.chapter_id)
          const label = item?.title || '已移除的章节'
          const stale = item?.review_state !== 'confirmed' || item.accepted_version_id !== pin.version_id
          return <div className="reference-selected-item" key={pin.chapter_id}><div><strong>{label}</strong><small>前文定稿</small>{stale && !loading && <><Badge tone="amber">前文已修改，请重新确认</Badge>{item?.review_state === 'confirmed' ? <Button variant="ghost" disabled={busy} onClick={() => useCurrentVersion(pin.chapter_id)}>改用当前定稿</Button> : <p className="small muted">请先在目录中完成前章定稿，或移除此项。</p>}</>}</div><button className="icon-button" aria-label={`移除前文${label}`} disabled={busy || loading} onClick={() => removeChapter(pin.chapter_id)}><X size={16} /></button></div>
        })}
        {!!notes.trim() && <p className="small muted">已填写本章补充资料</p>}
      </aside>
    </div></fieldset>
    {error && <Notice>{error}{conflict && <Button disabled={busy} onClick={() => void reload()}>放弃本次修改，重新载入</Button>}</Notice>}
    <footer className="reference-actions"><span className="small muted" role="status">{refreshing ? '正在核对最新资料…' : invalidSelection ? '请先处理失效的必读资料' : `${count} 项必读${notes.trim() ? ' · 含补充资料' : ''}`}</span><div className="button-row"><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || loading || refreshing || !!readError || invalidSelection} onClick={() => void save()}>{busy ? '正在保存…' : '保存本章参考'}</Button></div></footer>
  </Modal>
}
