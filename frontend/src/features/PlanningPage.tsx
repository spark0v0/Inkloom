import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowRight, PencilSimple, Plus, TreeStructure } from '@phosphor-icons/react'
import { api, errorText } from '../lib/api'
import type { Novel, Plan, PlanInput } from '../lib/api'
import { Badge, Button, Empty, Field, Loading, Modal, Notice, PageHeading } from '../components/ui'

const levels = { book: '全书', volume: '分卷', chapter: '章节', scene: '场景' } as const
export function PlanningPage({ novel }: { novel: Novel }) {
  const cache = useQueryClient()
  const plans = useQuery({ queryKey: ['plans', novel.id], queryFn: () => api.plans(novel.id) })
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const [brief, setBrief] = useState(false)
  const [form, setForm] = useState({ title: novel.title, genre: novel.genre, premise: novel.premise, style: novel.style })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function saveBrief() {
    setBusy(true)
    try { await api.editNovel(novel.id, form); await cache.invalidateQueries({ queryKey: ['novel', novel.id] }); await cache.invalidateQueries({ queryKey: ['novels'] }); setBrief(false) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="page-scroll"><div className="content-page"><PageHeading title="剧情规划" description="为故事留下方向，也给意料之外的生长留些位置。" action={<Button variant="primary" onClick={() => setEditing('new')}><Plus size={17} />新建规划</Button>} /><div className="story-brief"><div className="section-heading"><div><span className="eyebrow">故事的起点</span><h2>{novel.title}</h2></div><Button variant="ghost" onClick={() => { setForm({ title: novel.title, genre: novel.genre, premise: novel.premise, style: novel.style }); setBrief(true) }}><PencilSimple size={17} />编辑方向</Button></div>{novel.genre && <Badge>{novel.genre}</Badge>}<p>{novel.premise || '还没有写下故事方向。可以从一个人物、一场意外或一句话开始。'}</p>{novel.style && <div className="style-note"><strong>叙述与文风</strong><p>{novel.style}</p></div>}</div><div className="section-heading planning-heading"><h2>从全书到场景</h2><Badge>未来规划 · 尚未发生</Badge></div>{plans.isPending ? <Loading /> : plans.error ? <Notice>{errorText(plans.error)}</Notice> : plans.data?.length ? <div className="plan-list">{plans.data.map((plan, i) => <button className="plan-row" key={plan.id} onClick={() => setEditing(plan)}><span className="plan-index">{String(i + 1).padStart(2, '0')}</span><div><div className="button-row"><Badge>{levels[plan.level]}</Badge><h3>{plan.title}</h3></div><p>{plan.body.slice(0, 180) || '点击补充目标、阻力、选择与变化。'}</p></div><ArrowRight size={20} /></button>)}</div> : <Empty icon={<TreeStructure size={34} weight="light" />} title="把故事拆成可以下笔的片段">可以手动添加大纲，也可以在写作助手生成场景计划后保存到这里。<Button onClick={() => setEditing('new')}>写下第一个规划</Button></Empty>}
    {editing && <PlanDialog novelId={novel.id} plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    <Modal open={brief} onOpenChange={setBrief} title="作品方向与文风" wide><form className="form-stack" onSubmit={e => { e.preventDefault(); void saveBrief() }}><div className="form-row"><Field label="作品名"><input required maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field><Field label="题材"><input maxLength={80} value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value })} /></Field></div><Field label="故事方向"><textarea rows={5} maxLength={12000} value={form.premise} onChange={e => setForm({ ...form, premise: e.target.value })} /></Field><Field label="文风偏好" help="写具体的叙事要求，例如视角、句式、节奏和应避免的表达。"><textarea rows={5} maxLength={8000} value={form.style} onChange={e => setForm({ ...form, style: e.target.value })} placeholder="第三人称限知；动作带出情绪；对白简短；避免连续的比喻。" /></Field>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={() => setBrief(false)}>取消</Button><Button type="submit" variant="primary" disabled={busy}>保存方向</Button></div></form></Modal>
  </div></div>
}

function PlanDialog({ novelId, plan, onClose }: { novelId: string; plan: Plan | null; onClose: () => void }) {
  const cache = useQueryClient()
  const [form, setForm] = useState<PlanInput>({ title: plan?.title || '', level: plan?.level || 'chapter', body: plan?.body || '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await api.savePlan(novelId, form, plan?.id); await cache.invalidateQueries({ queryKey: ['plans', novelId] }); await cache.invalidateQueries({ queryKey: ['novel', novelId] }); onClose() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title={plan ? '编辑规划' : '新建剧情规划'} description="规划作为创作方向。只有已确认正文中的事件，才能进入正史。" wide><form className="form-stack" onSubmit={e => { e.preventDefault(); void save() }}><div className="form-row"><Field label="层级"><select value={form.level} onChange={e => setForm({ ...form, level: e.target.value as PlanInput['level'] })}>{Object.entries(levels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="标题"><input required maxLength={240} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field></div><Field label="规划内容"><textarea rows={13} maxLength={24000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="目标：\n阻力：\n选择：\n变化：\n尚未解决的问题：" /></Field>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy || !form.title.trim()}>保存规划</Button></div></form></Modal>
}
