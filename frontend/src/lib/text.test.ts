import { describe, expect, it } from 'vitest'
import fixtures from '../../../docs/contracts/text-fixtures.json'
import { countChars } from './api'
import { readRoute, routeHash } from './route'

describe('与 Python 共享的字数契约', () => {
  for (const sample of fixtures) it(sample.label, () => expect(countChars(sample.text)).toBe(sample.count))
})
describe('路由与错误恢复信息', () => {
  it('作品与章节路径可往返，不把来源锚点当作品 ID', () => {
    const route = { page: 'write' as const, novelId: 'novel_1', chapterId: 'chapter_2' }
    const previous = globalThis.location
    Object.defineProperty(globalThis, 'location', { value: { hash: routeHash(route) }, configurable: true })
    expect(readRoute()).toEqual(route)
    Object.defineProperty(globalThis, 'location', { value: previous, configurable: true })
  })
})
