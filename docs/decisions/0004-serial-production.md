# 连载创作工作流（0.2）

用户目标是用所接入模型从创意创作可持续连载的长篇，而非学习内部记忆系统。默认主线调整为全书方案、按卷章节细纲、整章生成、审阅采纳、本章定稿、连载导出。

- 视觉采用 `ui-serial-studio-v3.png`、`ui-chapter-studio-v3.png`，完整生图输入见设计目录；大字号、白底墨蓝、列表优先、减少说明文案。写作时主导航收为图标栏。
- 新增 `blueprint` / `outline` 两种持久化生成任务，沿用已有 worker、租约、事件、费用、取消与版本检查。规划任务以首章作为版本锚点，作品设定修订和章节目录快照也参与失效判断。
- 全书方案生成简介、文风、卖点、主角/世界设定和分卷目标；章节细纲每次生成 3–20 章，受显式计数约束。全书目标字数与每章字数是作者计划，不声称实际输出必然达标。
- 规划结果先存候选；采纳由确定性事务创建规划/设定/章节，不覆盖已有正文或设定。重复采纳返回同一结果。全书方案已采纳后不支持用另一份方案覆盖；可以编辑现有规划并逐卷推进。
- `Plan` 增加父级和结构数据，仍统一存放规划，不把未来事件写成事实。数据库使用新增 Alembic 迁移，保留旧工作区和旧任务。
- 正文采纳仍生成新版本；定稿流程合并到一个面板，可调用 AI 整理带原文依据的记忆并确认。保持作者最终决定权；旧稿变动时仍阻止基于过时前文继续生成。
- 番茄/起点是可编辑的创作目标和导出用途，不内置未经验证的平台规则，不自动登录或发布到第三方。

## 参考及适用范围

2026-10-20 阅读：

- [MuMuAINovel](https://github.com/xiamuceer-j/MuMuAINovel)：建书向导自动生成大纲、人物、世界观；实际查看 README 项目管理截图。GitHub 当日页面约 3.2k stars。
- [RhythmicWave/NovelForge](https://github.com/RhythmicWave/NovelForge)：结构化规划、草稿先预览、分层上下文与审核。参考产品流程，未复制实现代码。
- [AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator) 及 [Linux DO 介绍](https://linux.do/t/topic/3034602)：从创意逐步规划到正文；帖子评论仅作为使用反馈，不作为平台规则依据。
- [StyleKit](https://www.stylekit.top/zh/styles/corporate-clean)：清楚的层级、组件一致性；采用简洁产品工具方向。
- [UI Design Guide](https://chrichuang218.github.io/awesome-ui-design/)：实际通过浏览器读取资源与任务选择指南；网页读取工具不支持该地址。
- [MotionSites](https://motionsites.ai/) 主要是展示页动效案例；[React Bits](https://reactbits.dev/) 提供动效组件。此处仅借鉴交互反馈，写作区不加持续运动背景，也不新增无必要动效依赖。
- [Linux DO](https://linux.do/) 已通过浏览器查看主题列表、侧边导航与层级，借鉴其 Discourse 的可读列表模式，不复制站点品牌。
