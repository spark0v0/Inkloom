import { describe, expect, it } from 'vitest'
import { deriveBeatsFromOutline } from './sceneBeats'
import type { OutlineState } from './api'

describe('sceneBeats', () => {
  it('provides default 4-beat structure when outline is missing or empty', () => {
    const res = deriveBeatsFromOutline(null)
    expect(res.isFromOutline).toBe(false)
    expect(res.beats.length).toBe(4)
    expect(res.beats[0].phase).toBe('起')
    expect(res.beats[3].phase).toBe('结')
  })

  it('derives beats from structured outline when available', () => {
    const mockOutline: OutlineState = {
      chapter_id: 'ch-1',
      revision: 1,
      document: {
        kind: 'structured',
        title: '初入坊市',
        goal: '购买筑基丹药材',
        conflict: '黑市摊主坐地起价并有强人窥探',
        beats: [
          '主角易容潜入黑市，找到目标灵草摊位',
          '摊主反悔抬价，暗中引来执法队与盯梢修士',
          '主角施展假死符脱身，反杀跟上来的筑基散修'
        ],
        ending_hook: '在散修储物袋中发现针对主角宗门的密信'
      }
    }

    const res = deriveBeatsFromOutline(mockOutline)
    expect(res.isFromOutline).toBe(true)
    expect(res.beats.length).toBe(3)
    expect(res.beats[0].goal).toBe('主角易容潜入黑市，找到目标灵草摊位')
    expect(res.beats[0].conflict).toBe('黑市摊主坐地起价并有强人窥探')
    expect(res.beats[2].ending).toBe('在散修储物袋中发现针对主角宗门的密信')
  })
})
