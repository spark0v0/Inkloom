import type { ChapterSummary, Thread } from './api'

export type StoryMarker = { key: string; thread: Thread } & (
  { kind: 'planned' } | { kind: 'record'; progress: Thread['progress'][number]; current: boolean }
)
export type StoryRow = { chapter: ChapterSummary; markers: StoryMarker[] }
export type StoryFilters = { search: string; volume?: string; state: string; threadId: string }

// A projection of author plans and version-bound records, never an inferred event graph.
export function buildStoryMap(novelId: string, chapters: ChapterSummary[], threads: Thread[]): StoryRow[] {
  const rows = chapters.filter(c => c.novel_id === novelId).map(chapter => ({ chapter, markers: [] as StoryMarker[] }))
    .sort((a, b) => a.chapter.position - b.chapter.position)
  const byId = new Map(rows.map(row => [row.chapter.id, row]))
  for (const thread of threads) {
    if (thread.entity.novel_id !== novelId) continue
    const target = thread.target_chapter_id && byId.get(thread.target_chapter_id)
    if (target) target.markers.push({ key: thread.entity.id + ':plan', thread, kind: 'planned' })
    for (const progress of thread.progress) {
      const row = byId.get(progress.chapter_id)
      if (!row || progress.voided) continue
      const current = progress.valid && row.chapter.review_state === 'confirmed'
        && progress.version_id === row.chapter.accepted_version_id
      row.markers.push({ key: progress.id, thread, kind: 'record', progress, current })
    }
  }
  return rows
}

export function chapterState(chapter: ChapterSummary) {
  return chapter.review_state === 'confirmed' ? 'confirmed' : chapter.review_state === 'needs_review'
    ? 'needs_review' : chapter.char_count ? 'draft' : 'empty'
}

export const chapterStateLabels: Record<string, string> = { confirmed: '已定稿', needs_review: '待重新定稿', draft: '草稿', empty: '待创作' }

export function filterStoryMap(rows: StoryRow[], filters: StoryFilters): StoryRow[] {
  const search = filters.search.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
  return rows.filter(({ chapter, markers }) => {
    if (filters.volume !== undefined && chapter.volume !== filters.volume) return false
    if (filters.state && chapterState(chapter) !== filters.state) return false
    if (filters.threadId && !markers.some(m => m.thread.entity.id === filters.threadId)) return false
    if (!search) return true
    const text = [chapter.title, chapter.goal, chapter.volume, ...markers.flatMap(m =>
      [m.thread.entity.name, ...(m.thread.entity.aliases || []), m.thread.intent])].join(' ').normalize('NFKC').toLocaleLowerCase('zh-CN')
    return text.includes(search)
  })
}
