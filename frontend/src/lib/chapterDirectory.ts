import type { ChapterSummary } from './api'

export type ChapterFilter = 'all' | 'unfinished' | 'confirmed' | 'needs_review'
export type ChapterGroup = { id: string; title: string; chapters: ChapterSummary[] }

export function groupChapters(chapters: ChapterSummary[]): ChapterGroup[] {
  const groups: ChapterGroup[] = []
  for (const chapter of [...chapters].sort((a, b) => a.position - b.position)) {
    const title = chapter.volume || '未分卷'
    const previous = groups.at(-1)
    if (previous?.title === title) previous.chapters.push(chapter)
    else groups.push({ id: chapter.id, title, chapters: [chapter] })
  }
  return groups
}

export function matchesChapter(chapter: ChapterSummary, query: string, filter: ChapterFilter) {
  if (filter === 'unfinished' && chapter.review_state === 'confirmed') return false
  if ((filter === 'confirmed' || filter === 'needs_review') && chapter.review_state !== filter) return false
  const normalized = query.normalize('NFKC').trim().toLocaleLowerCase()
  // A number jumps to that chapter's narrative position, not every title containing it.
  if (/^\d+$/.test(normalized)) return chapter.position === Number(normalized)
  const text = `${chapter.title}\n${chapter.volume}\n${chapter.goal}`.normalize('NFKC').toLocaleLowerCase()
  return normalized.split(/\s+/).every(term => text.includes(term))
}
