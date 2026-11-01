import { expect, it } from 'vitest'
import { canUseProvider } from './api'

it('distinguishes demo, configured cloud, and keyless local connections at every entry', () => {
  expect(canUseProvider()).toBe(false)
  expect(canUseProvider({ kind: 'demo', has_key: false, requires_key: false })).toBe(true)
  expect(canUseProvider({ kind: 'openai_compatible', has_key: false, requires_key: true })).toBe(false)
  expect(canUseProvider({ kind: 'openai_compatible', has_key: true, requires_key: true })).toBe(true)
  expect(canUseProvider({ kind: 'openai_compatible', has_key: false, requires_key: false })).toBe(true)
})
