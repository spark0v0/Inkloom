import type { Novel, Selection, WritingPreferences } from './api'
import { countChars } from './api'

export const viewpointNames = {
  unspecified: '不限定，沿用本书要求', first_person: '第一人称',
  third_person_limited: '第三人称限知', omniscient: '全知视角',
} as const

export const emptyPreferences: WritingPreferences = { viewpoint: 'unspecified', avoid: '', example: '' }

export function writingStyleDraft(novel: Pick<Novel, 'style' | 'writing_preferences'>) {
  return { style: novel.style, preferences: { ...emptyPreferences, ...novel.writing_preferences } }
}

export function rebaseWritingStyle(current: ReturnType<typeof writingStyleDraft>, base: ReturnType<typeof writingStyleDraft>, latest: ReturnType<typeof writingStyleDraft>) {
  return {
    style: current.style === base.style ? latest.style : current.style,
    preferences: {
      viewpoint: current.preferences.viewpoint === base.preferences.viewpoint ? latest.preferences.viewpoint : current.preferences.viewpoint,
      avoid: current.preferences.avoid === base.preferences.avoid ? latest.preferences.avoid : current.preferences.avoid,
      example: current.preferences.example === base.preferences.example ? latest.preferences.example : current.preferences.example,
    },
  }
}

export const stylePresets = [
  { name: '修仙爽文', style: '节奏明快，矛盾直接，行文利落。突出境界压迫、交锋张力与反击爽点；对白杀伐果断，动作白描干脆，章末必留悬念钩子。', viewpoint: 'third_person_limited', avoid: '严禁倒吸一口凉气、恐怖如斯、嘴角勾起弧度；避免战力跨阶混乱与大段说明性设定灌水。' },
  { name: '都市系统', style: '语言现代轻快，代入感强。注重现实反差与即时反馈；金手指交互简明，人物动机真实。', viewpoint: 'third_person_limited', avoid: '避免生硬网络烂梗、反派无脑拉仇恨与数值设定前后打架。' },
  { name: '诡秘悬疑', style: '氛围压抑细腻，克制冷静。通过环境细节、感官异常和认知错位制造悬疑，层层递进剥开真相。', viewpoint: 'third_person_limited', avoid: '避免作者直接揭露谜底、人物降智忽视明显线索，以及无铺垫的机械降神。' },
  { name: '紧凑悬念', style: '围绕当前目标和阻力推进。用具体行动与对白交代信息，减少重复解释；场景结束保留与人物选择有关的悬念。', viewpoint: 'third_person_limited', avoid: '避免连续总结情绪、重复回顾设定和脱离人物动机的强行反转。' },
  { name: '细节叙事', style: '以人物感受和可观察的细节展开场景。选择少量有效的动作、声音与物件表现关系变化，给关键时刻留出停顿。', viewpoint: 'third_person_limited', avoid: '避免堆砌形容词、无关风景和直接替读者总结人物性格。' },
  { name: '轻松对白', style: '让人物通过有目标的交谈和动作推动场景。对白简洁，各人措辞有区别，幽默来自处境和反应。', viewpoint: 'third_person_limited', avoid: '避免旁白解释笑点、人人同一种口吻，以及与人物处境无关的网络梗。' },
] satisfies { name: string; style: string; viewpoint: WritingPreferences['viewpoint']; avoid: string }[]

export const negativeConstraintPills = [
  { label: '减少套话', value: '避免反复使用“倒吸凉气/恐怖如斯/嘴角弧度”等套话' },
  { label: '减少说教', value: '避免旁白替读者总结情绪或强行说教' },
  { label: '精简写景', value: '减少大段无关写景与成语堆砌，注重行动白描' },
  { label: '区分人物口吻', value: '避免人物千人一面、所有人同一种口吻' },
  { label: '保持能力一致', value: '避免战力境界前后矛盾与凭空掏出消耗品' },
]

export const rewriteActions = {
  combat: {
    name: '打斗强化',
    ratio: 1.4,
    instruction: '强化所选文字中已有的打斗交锋，写清动作、空间、攻防选择和代价。保留人物能力、装备、伤势与胜负走向；不要无依据提升战力、添加招式或破坏环境，不改变本书文风与视角。'
  },
  reaction: {
    name: '围观反响',
    ratio: 1.3,
    instruction: '打磨所选文字中已在场人物的可观察反应，使其符合各自立场和已知信息。没有旁观者时保持原场景，不凭空添加路人、同门或敌人，不强制所有人震惊或赞叹，不改变主视角。'
  },
  sensory: {
    name: '五感细节',
    ratio: 1.4,
    instruction: '为所选文字补充符合当前场景与主视角的感官细节，选择对行动和情绪有作用的声音、光线、触感或气味。保留已有事实，不凭空增加血腥、兵刃或超自然现象，避免堆砌形容词。'
  },
  dialogue: {
    name: '对白打磨',
    ratio: 1.0,
    instruction: '打磨所选文字中的人物对话，保留每个人的身份、动机、关系、已知信息和原有意图。改善潜台词、节奏与口吻区分，不把所有人改成冷酷或强势，不改变对白造成的情节结果。'
  },
  polish: {
    name: '润色精修',
    ratio: 1.0,
    instruction: '润色所选文字，保持篇幅接近原段，保留情节事实、人物动机、视角和关键信息。改善措辞与句子衔接，不为凑字数添加剧情。'
  },
  expand: {
    name: '扩写',
    ratio: 1.5,
    instruction: '扩写所选文字，补充有作用的动作、感官细节或对白，保留原有情节方向和视角。不要虚构前文已经交代的事件，不重复解释设定。'
  },
  shorten: {
    name: '精炼去水',
    ratio: 0.65,
    instruction: '压缩所选文字，删去重复解释、冗余修饰和无效过渡，保留关键行动、对白意图及因果。不要为凑字数扩写。'
  },
} as const

export type RewriteAction = keyof typeof rewriteActions
export type SelectionRewrite = { id: string; base_version_id: string; action: RewriteAction; selection: Selection; autoStart?: boolean }
export function rewriteTarget(request: SelectionRewrite) {
  const meta = rewriteActions[request.action]
  const ratio = meta?.ratio ?? 1.0
  return Math.min(6000, Math.max(50, Math.round(countChars(request.selection.text) * ratio)))
}
