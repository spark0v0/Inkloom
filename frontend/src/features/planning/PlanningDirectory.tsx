import { CaretRight, CheckCircle, FileText, PencilSimple, Plus, Sparkle } from '@phosphor-icons/react'
import { Button, Empty } from '../../components/ui'
import type { ChapterSummary, Plan } from '../../lib/api'

export type PlanningVolume = { title: string; plan?: Plan; chapters: ChapterSummary[] }
export type VolumeSelection = { title: string; planId?: string }

export function planningVolumes(plans: Plan[], chapters: ChapterSummary[]) {
  const byVolume = new Map<string, ChapterSummary[]>()
  for (const chapter of chapters) {
    const volume = byVolume.get(chapter.volume)
    if (volume) volume.push(chapter)
    else byVolume.set(chapter.volume, [chapter])
  }
  const groups: PlanningVolume[] = plans.map(plan => ({ title: plan.title, plan, chapters: byVolume.get(plan.title) ?? [] }))
  for (const plan of plans) byVolume.delete(plan.title)
  for (const [title, rows] of byVolume) groups.push({ title, chapters: rows })
  return groups.sort((a, b) => (a.chapters[0]?.position ?? Number.MAX_SAFE_INTEGER)
    - (b.chapters[0]?.position ?? Number.MAX_SAFE_INTEGER))
}

const volumeName = (group: PlanningVolume) => group.title || '未分卷'
const volumeKey = (group: PlanningVolume) => group.plan?.id ?? `volume:${group.title}`

export function PlanningDirectory({ groups, current, busy, onSelect, onAddVolume, onEditVolume, onGenerate, onAddChapter, onOpenChapter }: {
  groups: PlanningVolume[]; current?: PlanningVolume; busy: boolean;
  onSelect: (group: PlanningVolume) => void; onAddVolume: (title?: string) => void;
  onEditVolume: (plan: Plan) => void; onGenerate: () => void; onAddChapter: () => void;
  onOpenChapter: (id: string) => void;
}) {
  const plan = current?.plan
  const chapters = current?.chapters ?? []
  const showVolumes = groups.length > 1 || !!plan
  const summary = plan?.body.split('\n', 1)[0]
  const confirmed = chapters.filter(chapter => chapter.review_state === 'confirmed').length

  return <div className={`volume-workspace ${showVolumes ? '' : 'without-volumes'}`}>
    {showVolumes && <aside className="volume-list" aria-label="分卷目录">
      <div className="section-heading">
        <h2>分卷</h2>
        <button className="icon-button" aria-label="添加分卷" onClick={() => onAddVolume()}><Plus size={18} /></button>
      </div>
      <div className="volume-options">
        {groups.map(group => <button key={volumeKey(group)} className={`volume-option ${group === current ? 'active' : ''}`} aria-pressed={group === current} onClick={() => onSelect(group)}>
          <strong>{volumeName(group)}</strong>
          <small>{group.chapters.length} 章{!group.plan ? ' · 待补规划' : ''}</small>
        </button>)}
      </div>
      <select className="volume-select" aria-label="选择分卷" value={current ? volumeKey(current) : ''} onChange={event => {
        const selected = groups.find(group => volumeKey(group) === event.target.value)
        if (selected) onSelect(selected)
      }}>
        {groups.map(group => <option key={volumeKey(group)} value={volumeKey(group)}>{volumeName(group)} · {group.chapters.length} 章</option>)}
      </select>
    </aside>}
    <section className="volume-chapters" aria-label="章节细纲目录">
      <div className="volume-detail-heading">
        <div><h2>{current ? volumeName(current) : '章节'}</h2>{summary && <p>{summary}</p>}</div>
        <div className="button-row">
          {plan && <button className="icon-button" aria-label="编辑分卷" onClick={() => onEditVolume(plan)}><PencilSimple size={18} /></button>}
          {plan && <Button variant="primary" onClick={onGenerate}><Sparkle size={18} />AI 规划后续章节</Button>}
          {current?.title && !plan && <Button onClick={() => onAddVolume(current.title)}><Plus size={17} />补分卷规划</Button>}
          {!showVolumes && <Button variant={current?.title ? 'ghost' : 'secondary'} onClick={() => onAddVolume()}><Plus size={17} />添加分卷</Button>}
        </div>
      </div>
      {chapters.length ? <div className="chapter-table">
        <div className="chapter-table-head" aria-hidden="true"><span>章节</span><span>本章剧情</span><span>状态</span><span /></div>
        {chapters.map(chapter => <ChapterRow key={chapter.id} chapter={chapter} onOpen={() => onOpenChapter(chapter.id)} />)}
      </div> : <Empty icon={<FileText size={30} />} title={current ? '这一卷还没有章节' : '还没有章节'} />}
      <div className="volume-footer">
        <Button variant={chapters.length ? 'ghost' : 'secondary'} onClick={onAddChapter} disabled={busy}><Plus size={18} />手动添加章节</Button>
        {!!chapters.length && <span className="muted small">{chapters.length} 章 · {confirmed} 章定稿</span>}
      </div>
    </section>
  </div>
}

function ChapterRow({ chapter, onOpen }: { chapter: ChapterSummary; onOpen: () => void }) {
  const confirmed = chapter.review_state === 'confirmed'
  const status = confirmed ? '已定稿' : chapter.review_state === 'needs_review' ? '待复核' : chapter.char_count ? '草稿' : '待创作'
  return <button className="chapter-table-row" onClick={onOpen}>
    <strong>{chapter.title}</strong>
    <p className={chapter.goal ? undefined : 'outline-blank'}>{chapter.goal || '尚未填写细纲'}</p>
    <span className={`chapter-row-state ${confirmed ? 'complete' : ''}`}>{confirmed ? <CheckCircle size={17} weight="fill" /> : <FileText size={17} />}{status}</span>
    <CaretRight size={17} />
  </button>
}
