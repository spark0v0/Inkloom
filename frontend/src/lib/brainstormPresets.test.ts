import { describe, expect, it } from 'vitest'
import { getPresetsByCategory, parseBrainstormText } from './brainstormPresets'

describe('Brainstorm Presets', () => {
  it('contains categorized brainstorm options', () => {
    const names = getPresetsByCategory('names')
    expect(names.length).toBeGreaterThanOrEqual(3)
    expect(names.some(p => p.label.includes('功法'))).toBe(true)

    const complications = getPresetsByCategory('complications')
    expect(complications.length).toBeGreaterThanOrEqual(1)

    const cliffhangers = getPresetsByCategory('cliffhangers')
    expect(cliffhangers.length).toBeGreaterThanOrEqual(1)
  })

  it('correctly parses numbered and bulleted brainstorm results into cards', () => {
    const sample = `1. 九霄御雷真诀 · 引动九天神雷淬体
2. 太虚截天剑典 · 剑意撕裂虚空
3. 幽罗噬魂指 · 幽冥死气凝聚指尖`

    const parsed = parseBrainstormText(sample)
    expect(parsed.length).toBe(3)
    expect(parsed[0]).toContain('九霄御雷真诀')
    expect(parsed[1]).toContain('太虚截天剑典')
    expect(parsed[2]).toContain('幽罗噬魂指')
  })

  it('handles bracketed items cleanly', () => {
    const sample = `【突发背叛】：同伴暗中引路
【第三方渔翁】：双方两败俱伤`

    const parsed = parseBrainstormText(sample)
    expect(parsed.length).toBe(2)
    expect(parsed[0]).toContain('突发背叛')
  })
})
