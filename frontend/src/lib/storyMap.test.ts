import { describe, expect, it } from 'vitest'
import type { ChapterSummary, Thread } from './api'
import { buildStoryMap, chapterState, filterStoryMap } from './storyMap'

const chapter = (position: number, overrides: Partial<ChapterSummary> = {}): ChapterSummary => ({
  id: `c${position}`, novel_id: 'novel', title: `第${position}章`, position, volume: '第一卷',
  goal: '', outline_revision: 0, working_version_id: `v${position}`, accepted_version_id: `v${position}`,
  char_count: 12, review_state: 'confirmed', updated_at: '', ...overrides,
})
const track = (overrides: Partial<Thread> = {}): Thread => ({
  entity: { id: 'thread', novel_id: 'novel', kind: 'thread', name: '断裂罗盘', aliases: ['Compass'], summary: '', body: '', status: 'author', updated_at: '' },
  revision: 0, target_chapter_id: 'c3', target_chapter_title: '第3章', target_position: 3, intent: '揭开旧航线',
  paused: false, status: 'planted', progress: [{ id: 'progress', chapter_id: 'c1', chapter_position: 1, chapter_title: '第1章',
    version_id: 'v1', paragraph_ordinal: 0, stage: 'planted', evidence: { source_id: 'source', quote: '发现罗盘' },
    note: '', valid: true, voided: false, invalid_reason: '', created_at: '' }], ...overrides,
})

describe('故事脉络的计划与事实边界', () => {
  it('按章节顺序投影，回收计划不能变成已发生的进展，输入保持不变', () => {
    const chapters = [chapter(3, { review_state: 'draft', accepted_version_id: null, char_count: 0 }), chapter(1)]
    const rows = buildStoryMap('novel', chapters, [track({ paused: true })])
    expect(rows.map(r => r.chapter.id)).toEqual(['c1', 'c3'])
    expect(rows[0].markers[0]).toMatchObject({ kind: 'record', current: true })
    expect(rows[1].markers[0]).toMatchObject({ kind: 'planned', thread: { paused: true } })
    expect(chapterState(rows[1].chapter)).toBe('empty')
    expect(chapters[0].id).toBe('c3')
  })
  it('即使伏笔缓存仍标为有效，正文改版或待重新定稿后也显示待复核', () => {
    for (const value of [chapter(1, { accepted_version_id: 'new' }), chapter(1, { review_state: 'needs_review' })]) {
      expect(buildStoryMap('novel', [value], [track()])[0].markers[0]).toMatchObject({ current: false })
    }
    const thread = track()
    thread.progress[0].valid = false
    expect(buildStoryMap('novel', [chapter(1)], [thread])[0].markers[0]).toMatchObject({ current: false })
  })
  it('不展示已撤销、其他作品或不存在章节的关联', () => {
    const withdrawn = track(); withdrawn.progress[0].voided = true
    const foreign = track(); foreign.entity.novel_id = 'other'
    const orphan = track(); orphan.progress[0].chapter_id = 'missing'
    const rows = buildStoryMap('novel', [chapter(1), chapter(2, { novel_id: 'other' })], [withdrawn, foreign, orphan])
    expect(rows).toHaveLength(1)
    expect(rows[0].markers).toEqual([])
  })
  it('按别名、分卷、状态和单条伏笔联合筛选，支持全角英文', () => {
    const rows = buildStoryMap('novel', [chapter(1), chapter(2), chapter(3)], [track()])
    expect(filterStoryMap(rows, { search: 'ＣＯＭＰＡＳＳ', volume: '第一卷', state: 'confirmed', threadId: 'thread' }).map(r => r.chapter.id)).toEqual(['c1', 'c3'])
    expect(filterStoryMap(rows, { search: '不存在', state: '', threadId: '' })).toEqual([])
    expect(filterStoryMap(rows, { search: '', volume: '', state: '', threadId: '' })).toEqual([])
  })
})
