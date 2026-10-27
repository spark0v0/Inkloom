import type { Selection, WritingPreferences } from './api'
import { countChars } from './api'

export const viewpointNames = {
  unspecified: '不限定，沿用本书要求', first_person: '第一人称',
  third_person_limited: '第三人称限知', omniscient: '全知视角',
} as const

export const emptyPreferences: WritingPreferences = { viewpoint: 'unspecified', avoid: '', example: '' }

export const stylePresets = [
  { name: '紧凑悬念', style: '围绕当前目标和阻力推进。用具体行动与对白交代信息，减少重复解释；场景结束保留与人物选择有关的悬念。', viewpoint: 'third_person_limited', avoid: '避免连续总结情绪、重复回顾设定和脱离人物动机的强行反转。' },
  { name: '细节叙事', style: '以人物感受和可观察的细节展开场景。选择少量有效的动作、声音与物件表现关系变化，给关键时刻留出停顿。', viewpoint: 'third_person_limited', avoid: '避免堆砌形容词、无关风景和直接替读者总结人物性格。' },
  { name: '轻松对白', style: '让人物通过有目标的交谈和动作推动场景。对白简洁，各人措辞有区别，幽默来自处境和反应。', viewpoint: 'third_person_limited', avoid: '避免旁白解释笑点、人人同一种口吻，以及与人物处境无关的网络梗。' },
] satisfies { name: string; style: string; viewpoint: WritingPreferences['viewpoint']; avoid: string }[]

export const rewriteActions = {
  polish: { name: '润色', instruction: '润色所选文字，保持篇幅接近原段，保留情节事实、人物动机、视角和关键信息。改善措辞与句子衔接，不为凑字数添加剧情。' },
  expand: { name: '扩写', instruction: '扩写所选文字，补充有作用的动作、感官细节或对白，保留原有情节方向和视角。不要虚构前文已经交代的事件，不重复解释设定。' },
  shorten: { name: '缩写', instruction: '压缩所选文字，删去重复解释、冗余修饰和无效过渡，保留关键行动、对白意图及因果。不要为凑字数扩写。' },
} as const

export type RewriteAction = keyof typeof rewriteActions
export type SelectionRewrite = { id: string; base_version_id: string; action: RewriteAction; selection: Selection }
export function rewriteTarget(request: SelectionRewrite) {
  const ratio = request.action === 'expand' ? 1.5 : request.action === 'shorten' ? .65 : 1
  return Math.min(6000, Math.max(100, Math.round(countChars(request.selection.text) * ratio)))
}
