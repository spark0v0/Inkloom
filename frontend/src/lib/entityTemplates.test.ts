import { describe, expect, it } from 'vitest'
import { entityTemplates } from './entityTemplates'

describe('entityTemplates', () => {
  it('contains essential web-novel archetypes', () => {
    const ids = entityTemplates.map(t => t.id)
    expect(ids).toContain('protagonist')
    expect(ids).toContain('system_cheat')
    expect(ids).toContain('faction')
    expect(ids).toContain('artifact')
  })

  it('provides structured body templates with anti-hallucination guidance', () => {
    const protagonist = entityTemplates.find(t => t.id === 'protagonist')!
    expect(protagonist.bodyTemplate).toContain('当前境界/战力阶位')
    expect(protagonist.bodyTemplate).toContain('【核心金手指 / 外挂系统】')

    const cheat = entityTemplates.find(t => t.id === 'system_cheat')!
    expect(cheat.bodyTemplate).toContain('AI生成约束')
  })
})
