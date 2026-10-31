export type EntityTemplate = {
  id: string
  name: string
  kind: 'character' | 'world'
  defaultSummary: string
  bodyTemplate: string
}

export const entityTemplates: EntityTemplate[] = [
  {
    id: 'protagonist',
    name: '主角状态与外挂',
    kind: 'character',
    defaultSummary: '主角 · 境界战力、核心外挂与当前状态',
    bodyTemplate: `【基础与身份】
- 身份定位：主角
- 当前境界/战力阶位：
- 明面身份（伪装/公开）：
- 隐秘马甲（暗中阵营）：

【核心金手指 / 外挂系统】
- 外挂形式与名称：
- 触发机制与限制条件：
- 代价/冷却/负面限制：
（提示：严格遵循此规则，不可自行发明未解锁的能力）

【核心持有物与战力】
- 核心功法/天赋特质：
- 本命兵器/关键秘宝：
- 储物空间重点资产：

【近期状态与目标】
- 当前首要目标：
- 身体与修为状态（如暗伤、瓶颈、突破契机）：`
  },
  {
    id: 'system_cheat',
    name: '金手指/系统规则',
    kind: 'world',
    defaultSummary: '外挂系统/核心法则运行逻辑与不可违背的红线',
    bodyTemplate: `【系统/法则运行机制】
- 运作逻辑与核心功能：
- 触发条件与产出机制：
- 升级/进阶途径：

【约束红线与禁止事项】
- 绝对不可逾越的规则：
- AI生成约束：严禁擅自发放未提及的新能力；每次触发必须具备明确的前置条件与逻辑依据。`
  },
  {
    id: 'faction',
    name: '宗门/势力组织',
    kind: 'world',
    defaultSummary: '宗门/势力阵营定位与核心利益冲突',
    bodyTemplate: `【势力基本盘】
- 势力级别与地理版图：
- 核心掌权者与关键高层：
- 宗门/组织行事风格与信条：

【阵营与利益关系】
- 友好同盟与核心利益：
- 敌对阵营与历史宿怨：
- 对待主角的态度与潜在博弈：`
  },
  {
    id: 'artifact',
    name: '秘宝/法宝道具',
    kind: 'world',
    defaultSummary: '关键道具法宝品阶、特性与使用限制',
    bodyTemplate: `【物品属性】
- 品阶等级与外观形态：
- 核心威能与独特效果：
- 消耗与使用限制/负面反噬：

【归属与争夺】
- 当前持有者：
- 各方势力对此物的图谋与已知情报：`
  }
]
