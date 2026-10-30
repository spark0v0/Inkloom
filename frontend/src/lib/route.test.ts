import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRoute, routeHash } from './route'

afterEach(() => vi.unstubAllGlobals())
describe('规划与伏笔深链', () => {
  it('旧写作链接保持兼容', () => {
    vi.stubGlobal('location', { hash: '#/write/novel/chapter' })
    expect(readRoute()).toEqual({ page: 'write', novelId: 'novel', chapterId: 'chapter' })
    expect(routeHash(readRoute())).toBe('#/write/novel/chapter')
  })
  it('细纲编辑链接保留返回脉络的入口', () => {
    const hash = routeHash({ page: 'plot', novelId: 'novel', chapterId: 'chapter', view: 'map' })
    vi.stubGlobal('location', { hash })
    expect(readRoute()).toEqual({ page: 'plot', novelId: 'novel', chapterId: 'chapter', view: 'map' })
  })
  it('伏笔参数经过编码并限定在档案页，未知视图忽略', () => {
    vi.stubGlobal('location', { hash: routeHash({ page: 'bible', novelId: 'novel', threadId: '伏笔&特殊?' }) })
    expect(readRoute().threadId).toBe('伏笔&特殊?')
    vi.stubGlobal('location', { hash: '#/write/novel/chapter?view=map&thread=other' })
    expect(readRoute()).toEqual({ page: 'write', novelId: 'novel', chapterId: 'chapter' })
    vi.stubGlobal('location', { hash: '#/plot/novel?view=unknown' })
    expect(readRoute().view).toBeUndefined()
  })
})
