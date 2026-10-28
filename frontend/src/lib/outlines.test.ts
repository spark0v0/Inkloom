import { describe, expect, it } from 'vitest'
import type { OutlineDocument } from './api'
import { rebaseOutline } from './outlines'

const original: OutlineDocument = { kind: 'structured', title: '第1章', goal: '找信', conflict: '门锁着', beats: ['查门锁'], ending_hook: '灯灭了' }
describe('细纲冲突后保留作者改动', () => {
  it('保留作者目标，并接入另一窗口的标题、冲突和情节节点', () => {
    const draft = { ...original, goal: '先调查笔迹' }
    const current = { ...original, title: '第1章 来信', conflict: '有人守门', beats: ['核对封条', '检查窗户'] }
    expect(rebaseOutline(original, draft, current)).toEqual({ ...current, goal: draft.goal })
  })
  it('同一字段双方都改时仍保留作者输入供比较，不静默选用远端', () => {
    const current = { ...original, goal: '远端目标' }
    expect(rebaseOutline(original, { ...original, goal: '本地目标' }, current)).toEqual({ ...current, goal: '本地目标' })
  })
  it('自由文本只合并未改标题，格式变化要求明确选择', () => {
    const text: OutlineDocument = { kind: 'text', title: '原名', text: '自由记录' }
    expect(rebaseOutline(text, { ...text, text: '作者记录' }, { ...text, title: '新名' })).toEqual({ ...text, title: '新名', text: '作者记录' })
    expect(rebaseOutline(original, original, text)).toBeNull()
    expect(rebaseOutline(text, original, text)).toBeNull()
  })
})
