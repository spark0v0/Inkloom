import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowRight, BookOpen, MagnifyingGlass, Plus, User, GlobeHemisphereWest, GitBranch, Clock } from '@phosphor-icons/react'
import { ApiError, api, dateLabel, errorText } from '../lib/api'
import type { Entity, EntityInput, Evidence, Novel } from '../lib/api'
import { Badge, Button, Empty, Field, Loading, Modal, Notice, PageHeading } from '../components/ui'
import { SourceButton } from './JobPresentation'
import { ThreadPanel } from './ThreadPanel'

const kinds = { character: '人物', world: '世界设定', thread: '伏笔', timeline: '时间线' } as const
const icons = { character: User, world: GlobeHemisphereWest, thread: GitBranch, timeline: Clock }

export function StoryPage({ novel, onEvidence }: { novel: Novel; onEvidence: (e: Evidence) => void }) {
  const cache = useQueryClient()
  const entities = useQuery({ queryKey: ['entities', novel.id], queryFn: () => api.entities(novel.id) })
  const facts = useQuery({ queryKey: ['facts', novel.id], queryFn: () => api.facts(novel.id, true) })
  const [tab, setTab] = useState<EntityInput['kind'] | 'facts'>('character')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Entity | 'new' | null>(null)
  const [inactive, setInactive] = useState(false)
  const items = entities.data?.filter(e => e.kind === tab && (!search || `${e.name} ${e.summary} ${e.body} ${e.aliases?.join(' ')}`.includes(search))) || []
  const visibleFacts = facts.data?.filter(f => (inactive || f.active) && (!search || `${f.subject} ${f.claim}`.includes(search))) || []
  return <div className="page-scroll"><div className="content-page story-page"><PageHeading title="人物与设定" action={<Button variant="primary" onClick={() => setEditing('new')}><Plus size={17} />{tab === 'thread' ? '新建伏笔' : '新建设定'}</Button>} />
    <div className="page-tabs">{Object.entries(kinds).map(([kind, label]) => { const Icon = icons[kind as keyof typeof icons]; return <button className={tab === kind ? 'active' : ''} key={kind} onClick={() => setTab(kind as EntityInput['kind'])}><Icon size={18} />{label}<span>{entities.data?.filter(e => e.kind === kind).length || 0}</span></button> })}<button className={tab === 'facts' ? 'active' : ''} onClick={() => setTab('facts')}><BookOpen size={18} />故事记忆<span>{facts.data?.filter(f => f.active).length || 0}</span></button></div>
    {tab === 'thread' ? <ThreadPanel novelId={novel.id} onEvidence={onEvidence} onEdit={setEditing} onCreate={() => setEditing('new')} /> : <>
    <div className="section-toolbar"><div><Badge tone={tab === 'facts' ? 'green' : 'neutral'}>{tab === 'facts' ? `正史修订 ${novel.canon_revision}` : '作者设定'}</Badge><span className="muted small">{tab === 'facts' ? '每条事实绑定原文版本，修改前文后失效。' : '设定可用于构思，不等于正文中已经发生的事实。'}</span></div><label className="search-input"><MagnifyingGlass size={17} /><input aria-label="搜索故事档案" placeholder="搜索档案…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    {entities.isPending || facts.isPending ? <Loading /> : entities.error || facts.error ? <Notice>{errorText(entities.error || facts.error)}</Notice> : tab === 'facts' ? <><label className="checkbox-label"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} />显示已失效记录</label><div className="facts-list">{visibleFacts.map(f => <article className={`fact-card ${f.active ? '' : 'inactive'}`} key={f.id}><div className="section-heading"><Badge tone={f.active ? 'green' : 'amber'}>{f.active ? f.kind === 'knowledge' ? '人物已知' : f.kind === 'thread' ? '伏笔记录' : '已确认事实' : '已失效 · 不参与默认检索'}</Badge><span className="small muted">修订 {f.canon_revision}</span></div><p>{f.claim}</p>{f.story_time && <p className="small muted">故事时间：{f.story_time}</p>}{(f.known_by?.length ?? 0) > 0 && <p className="small muted">此时已知：{(f.known_by || []).map(id => entities.data?.find(e => e.id === id)?.name || '已移除的人物').join('、')}</p>}<div className="button-row">{f.evidence.map((e, i) => <SourceButton evidence={e} onEvidence={onEvidence} key={i} />)}</div></article>)}</div>{!visibleFacts.length && <Empty icon={<BookOpen size={32} weight="light" />} title={search ? '没有找到相关记忆' : '还没有本章记忆'} action={search ? <Button onClick={() => setSearch('')}>清除搜索</Button> : undefined}>{search ? '试试人物名或记忆中的词。' : '在写作区定稿时，让 AI 整理人物变化与伏笔。'}</Empty>}</> : items.length ? <div className="entity-grid">{items.map((entity, i) => { const Icon = icons[entity.kind]; return <button className="entity-card" key={entity.id} onClick={() => setEditing(entity)}><div className="entity-top"><span className={`entity-avatar avatar-${i % 4}`}>{entity.kind === 'character' ? Array.from(entity.name)[0] : <Icon size={25} weight="light" />}</span><Badge tone={entity.status === 'proposed' ? 'amber' : 'neutral'}>{entity.status === 'proposed' ? '待作者确认' : kinds[entity.kind]}</Badge></div><h2>{entity.name}</h2><p>{entity.summary || '还没有简述。点击补充这个设定。'}</p>{(entity.aliases?.length ?? 0) > 0 && <div className="alias-list">{(entity.aliases || []).slice(0, 4).map(alias => <span key={alias}>{alias}</span>)}</div>}<div className="entity-bottom"><span>{dateLabel(entity.updated_at)}</span><ArrowRight size={18} /></div></button> })}</div> : <Empty icon={<User size={32} weight="light" />} title={search ? '没有找到相关档案' : `添加第一个${kinds[tab]}`}>{search ? '试试人物名、别名或设定中的词。' : '先记下重要的名字和规则，细节可以边写边补。'}{!search && <Button onClick={() => setEditing('new')}><Plus size={17} />添加设定</Button>}</Empty>}
    </>}
    {editing && <EntityDialog novelId={novel.id} entity={editing === 'new' ? null : editing} initialKind={tab === 'facts' ? 'character' : tab} onClose={() => setEditing(null)} onSaved={() => { void cache.invalidateQueries({ queryKey: ['entities', novel.id] }); void cache.invalidateQueries({ queryKey: ['threads', novel.id] }); void cache.invalidateQueries({ queryKey: ['novel', novel.id] }); setEditing(null) }} />}
  </div></div>
}

function EntityDialog({ novelId, entity, initialKind, onClose, onSaved }: { novelId: string; entity: Entity | null; initialKind: EntityInput['kind']; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EntityInput>(entity ? { kind: entity.kind, name: entity.name, summary: entity.summary, body: entity.body, aliases: entity.aliases, status: entity.status } : { kind: initialKind, name: '', summary: '', body: '', aliases: [], status: 'author' })
  const [aliases, setAliases] = useState(entity?.aliases?.join('、') || '')
  const [baseline, setBaseline] = useState(entity?.updated_at)
  const [latest, setLatest] = useState<Entity | null>(null)
  const [conflicted, setConflicted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await api.saveEntity(novelId, { ...form, aliases: aliases.split(/[、,，\n]/).map(s => s.trim()).filter(Boolean) }, entity?.id, baseline); onSaved() }
    catch (e) { setError(errorText(e)); setConflicted(e instanceof ApiError && e.code === 'ENTITY_CONFLICT') } finally { setBusy(false) }
  }
  async function readLatest() {
    setBusy(true)
    try {
      const value = (await api.entities(novelId)).find(item => item.id === entity?.id)
      if (!value) throw new Error('档案已不存在，请另建档案保存当前输入。')
      setLatest(value); setBaseline(value.updated_at); setConflicted(false); setError('')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title={entity ? `编辑${kinds[entity.kind]}` : '新建设定'} description="记录人物、世界规则与伏笔，供后续创作参考。" wide className="edit-form-modal"><form onSubmit={e => { e.preventDefault(); void save() }} className="bounded-edit-form"><div className="edit-form-fields form-stack"><div className="form-row"><Field label="类型"><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as EntityInput['kind'] })}>{Object.entries(kinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field><Field label="状态"><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as EntityInput['status'] })}><option value="author">作者已确认的设定</option><option value="proposed">待确认提议</option></select></Field></div><Field label="名称"><input required maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="一句话简述"><textarea rows={2} maxLength={4000} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></Field><Field label="别名" help="使用顿号或逗号分隔；例如：沈砚、沈先生。"><input value={aliases} onChange={e => setAliases(e.target.value)} maxLength={2000} /></Field><Field label="详细档案"><textarea rows={9} maxLength={16000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="身份、动机、关系、限制，以及你希望保持的细节…" /></Field>{latest && <Notice tone="neutral">你的输入仍保留，请比较后再保存。<details><summary>查看当前已保存档案</summary><strong>{latest.name} · {kinds[latest.kind]} · {latest.status === 'author' ? '已确认' : '待确认'}</strong><p>{latest.summary}</p><p>{latest.aliases?.join('、')}</p><div className="comparison-text">{latest.body}</div></details></Notice>}</div>{error && <Notice>{error}{conflicted && <Button disabled={busy} onClick={() => void readLatest()}>读取最新档案</Button>}</Notice>}<div className="modal-actions"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy || !form.name.trim()}>{busy ? '正在保存…' : '保存档案'}</Button></div></form></Modal>
}
