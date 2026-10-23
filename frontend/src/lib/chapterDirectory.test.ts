import { describe, expect, it } from 'vitest'
import type { ChapterSummary } from './api'
import { groupChapters, matchesChapter } from './chapterDirectory'

function chapter(position: number, volume = '第一卷', review_state: ChapterSummary['review_state'] = 'draft'): ChapterSummary {
  return { id: `c${position}`, novel_id: 'novel', title: `第${position}章 雾港`, position, volume,
    review_state, goal: '林舟与 Raven 重逢', char_count: 0, working_version_id: `v${position}`, accepted_version_id: null, updated_at: '' }
}

describe('长篇目录', () => {
  it('按章序分组，同名不连续分卷不打乱章节', () => {
    const input = [chapter(3), chapter(1), chapter(2, '第二卷')]
    expect(groupChapters(input).map(g => g.chapters.map(c => c.position))).toEqual([[1], [2], [3]])
    expect(input[0].position).toBe(3)
  })
  it('章号精确匹配，支持全角数字和细纲多词查询', () => {
    expect(matchesChapter(chapter(12), '１２', 'all')).toBe(true)
    expect(matchesChapter(chapter(112), '12', 'all')).toBe(false)
    expect(matchesChapter(chapter(12), '雾港 raven', 'all')).toBe(true)
    expect(matchesChapter(chapter(12), '另一人', 'all')).toBe(false)
  })
  it('搜索与状态同时生效，待复核属于未定稿', () => {
    expect(matchesChapter(chapter(1, '', 'needs_review'), '林舟', 'unfinished')).toBe(true)
    expect(matchesChapter(chapter(1, '', 'confirmed'), '', 'unfinished')).toBe(false)
    expect(matchesChapter(chapter(1), '', 'needs_review')).toBe(false)
    expect(matchesChapter(chapter(1, '', 'confirmed'), '', 'confirmed')).toBe(true)
  })
})
