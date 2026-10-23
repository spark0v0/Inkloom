import type { ChapterSummary } from './api'

/** Continue in story order; a recently confirmed chapter is not unfinished work. */
export function nextWritingChapter(chapters: ChapterSummary[]) {
  const ordered = [...chapters].sort((a, b) => a.position - b.position)
  return ordered.find(c => c.review_state !== 'confirmed')
}
