import { describe, expect, it } from 'vitest'
import { cleanEntityName, entityTemplates } from './entityTemplates'

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

  describe('cleanEntityName', () => {
    it('strips quotation and bracket marks from selected text', () => {
      expect(cleanEntityName('“美杜莎女王”')).toBe('美杜莎女王')
      expect(cleanEntityName('《焚诀》')).toBe('焚诀')
      expect(cleanEntityName('【药尊者】')).toBe('药尊者')
      expect(cleanEntityName('「纳兰嫣然」')).toBe('纳兰嫣然')
      expect(cleanEntityName('"Xiao Yan"')).toBe('Xiao Yan')
      expect(cleanEntityName('\'萧炎\'')).toBe('萧炎')
    })

    it('strips trailing punctuation marks', () => {
      expect(cleanEntityName('云岚宗，')).toBe('云岚宗')
      expect(cleanEntityName('加玛帝国。')).toBe('加玛帝国')
      expect(cleanEntityName('魂殿！')).toBe('魂殿')
      expect(cleanEntityName('“丹王古河”？')).toBe('丹王古河')
    })

    it('falls back safely for quotes-only or empty strings and clamps length', () => {
      expect(cleanEntityName('')).toBe('')
      expect(cleanEntityName('   ')).toBe('')
      expect(cleanEntityName('“”')).toBe('“”')
      const longName = '超长设定名称'.repeat(15)
      expect(cleanEntityName(longName).length).toBe(40)
    })
  })
})
