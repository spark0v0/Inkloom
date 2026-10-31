import type { OutlineState } from './api'

export type SceneBeatItem = {
  index: number
  label: string
  phase: '起' | '承' | '转' | '结' | '节拍'
  goal: string
  conflict?: string
  turn?: string
  ending?: string
  suggestedTarget: number
  isFromOutline: boolean
}

export const defaultDramaBeats: SceneBeatItem[] = [
  {
    index: 0,
    label: '第 1 场 · 起 (开端)',
    phase: '起',
    goal: '推进场景开篇，交代当前处境与动机，主角采取行动',
    conflict: '遭遇初期的环境阻力、对手试探或异常疑点',
    turn: '',
    ending: '',
    suggestedTarget: 800,
    isFromOutline: false
  },
  {
    index: 1,
    label: '第 2 场 · 承 (交锋)',
    phase: '承',
    goal: '主要矛盾爆发，双方正面交锋博弈，局势全面升级',
    conflict: '对手展现强硬手段或底牌，主角陷入被动/对峙僵局',
    turn: '',
    ending: '',
    suggestedTarget: 1000,
    isFromOutline: false
  },
  {
    index: 2,
    label: '第 3 场 · 转 (高潮)',
    phase: '转',
    goal: '局势出现突变，主角做出决断，亮出底牌打破僵局',
    conflict: '',
    turn: '打破既定平衡，出乎对手意料的转折爆发，决出胜负',
    ending: '',
    suggestedTarget: 1000,
    isFromOutline: false
  },
  {
    index: 3,
    label: '第 4 场 · 结 (断章)',
    phase: '结',
    goal: '清算交锋影响与得失战果，平复情绪，为下一章留扣子',
    conflict: '',
    turn: '',
    ending: '在悬念爆发、未知危机、神秘来客或关键线索处停笔断章',
    suggestedTarget: 800,
    isFromOutline: false
  }
]

export function deriveBeatsFromOutline(outlineState?: OutlineState | null): {
  beats: SceneBeatItem[]
  isFromOutline: boolean
} {
  if (
    outlineState?.document &&
    outlineState.document.kind === 'structured' &&
    Array.isArray(outlineState.document.beats) &&
    outlineState.document.beats.length > 0
  ) {
    const doc = outlineState.document
    const beatsList = doc.beats || []
    const rawBeats = beatsList.filter(b => b && b.trim())
    if (rawBeats.length > 0) {
      const items: SceneBeatItem[] = rawBeats.map((beatText, idx) => {
        const isFirst = idx === 0
        const isLast = idx === rawBeats.length - 1
        const phase = isFirst ? '起' : isLast ? '结' : idx === 1 ? '承' : '转'
        return {
          index: idx,
          label: `第 ${idx + 1} 场 · ${phase}`,
          phase,
          goal: beatText,
          conflict: isFirst && doc.conflict ? doc.conflict : '',
          turn: '',
          ending: isLast && doc.ending_hook ? doc.ending_hook : '',
          suggestedTarget: isFirst || isLast ? 800 : 1000,
          isFromOutline: true
        }
      })
      return { beats: items, isFromOutline: true }
    }
  }

  return { beats: defaultDramaBeats, isFromOutline: false }
}
