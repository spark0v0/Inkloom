import { describe, expect, it } from 'vitest'
import { rebaseWritingStyle, rewriteActions, rewriteTarget } from './writing'
import type { SelectionRewrite } from './writing'

describe('文风冲突按字段合并', () => {
  const base = { style: '原风格', preferences: { viewpoint: 'unspecified' as const, avoid: '', example: '' } }
  it('保留本页文风，接入另一窗口的视角、禁忌与示例', () => {
    const current = { ...base, style: '本页文风' }
    const latest = { style: '远端文风', preferences: { viewpoint: 'first_person' as const, avoid: '不说教', example: '海面起雾。' } }
    expect(rebaseWritingStyle(current, base, latest)).toEqual({ ...latest, style: '本页文风' })
  })
  it('连续冲突使用新基线，保留本页后来改动并接入其他最新字段', () => {
    const latest = { ...base, preferences: { ...base.preferences, example: '第一份示例' } }
    const current = rebaseWritingStyle({ ...base, style: '本页文风' }, base, latest)
    const second = { ...latest, preferences: { ...latest.preferences, avoid: '减少复述', example: '第二份示例' } }
    expect(rebaseWritingStyle({ ...current, preferences: { ...current.preferences, example: '本页示例' } }, latest, second))
      .toEqual({ style: '本页文风', preferences: { ...second.preferences, example: '本页示例' } })
  })
})

describe('Writing Craft Actions', () => {
  it('contains comprehensive specialized web novel craft actions', () => {
    expect(rewriteActions.combat).toBeDefined()
    expect(rewriteActions.combat.name).toBe('打斗强化')
    expect(rewriteActions.reaction).toBeDefined()
    expect(rewriteActions.reaction.name).toBe('围观反响')
    expect(rewriteActions.sensory).toBeDefined()
    expect(rewriteActions.sensory.name).toBe('五感细节')
    expect(rewriteActions.dialogue).toBeDefined()
    expect(rewriteActions.dialogue.name).toBe('对白打磨')
    expect(rewriteActions.polish).toBeDefined()
    expect(rewriteActions.expand).toBeDefined()
    expect(rewriteActions.shorten).toBeDefined()
  })

  it('calculates proper target lengths based on action ratios', () => {
    const baseRequest: SelectionRewrite = {
      id: 'test-1',
      base_version_id: 'v1',
      action: 'expand',
      selection: { start_codepoint: 0, end_codepoint: 100, text: 'a'.repeat(100) }
    }

    expect(rewriteTarget(baseRequest)).toBe(150)

    const shortenRequest: SelectionRewrite = {
      ...baseRequest,
      action: 'shorten'
    }
    expect(rewriteTarget(shortenRequest)).toBe(65)

    const combatRequest: SelectionRewrite = {
      ...baseRequest,
      action: 'combat'
    }
    expect(rewriteTarget(combatRequest)).toBe(140)
  })
})
