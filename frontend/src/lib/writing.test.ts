import { describe, expect, it } from 'vitest'
import { rewriteActions, rewriteTarget } from './writing'
import type { SelectionRewrite } from './writing'

describe('Writing Craft Actions', () => {
  it('contains comprehensive specialized web novel craft actions', () => {
    expect(rewriteActions.combat).toBeDefined()
    expect(rewriteActions.combat.name).toBe('打斗强化')
    expect(rewriteActions.reaction).toBeDefined()
    expect(rewriteActions.reaction.name).toBe('围观反响')
    expect(rewriteActions.sensory).toBeDefined()
    expect(rewriteActions.sensory.name).toBe('五感细节')
    expect(rewriteActions.dialogue).toBeDefined()
    expect(rewriteActions.dialogue.name).toBe('霸气对白')
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
