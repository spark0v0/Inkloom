import { describe, expect, it } from 'vitest'
import type { ChapterSummary } from './api'
import { nextWritingChapter } from './workflow'

const chapter = (position: number, review_state: ChapterSummary['review_state'], updated_at: string): ChapterSummary => ({
  id: `chapter_${position}`, novel_id: 'novel_test', title: `第${position}章`, volume: '第一卷', position,
  review_state, updated_at, goal: '', working_version_id: `version_${position}`, accepted_version_id: null, char_count: 0,
})

describe('继续写作的章节选择', () => {
  it('忽略刚定稿章的较新时间，进入下一未完成章', () => {
    const list = [chapter(3, 'draft', '2026-10-19'), chapter(1, 'confirmed', '2026-10-21'), chapter(2, 'draft', '2026-10-20')]
    expect(nextWritingChapter(list)?.position).toBe(2)
    expect(list[0].position).toBe(3)
  })
  it('前文修改后先回到待重新定稿的章', () => {
    expect(nextWritingChapter([chapter(1, 'needs_review', '2026-10-19'), chapter(2, 'draft', '2026-10-21')])?.position).toBe(1)
  })
  it('空书或全部定稿应回到规划，不制造新章节', () => {
    expect(nextWritingChapter([])).toBeUndefined()
    expect(nextWritingChapter([chapter(1, 'confirmed', '2026-10-21')])).toBeUndefined()
  })
})
