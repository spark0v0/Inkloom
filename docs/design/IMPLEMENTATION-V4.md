# V4：连续创作流程与稳定工作区

2026-10-22。本轮针对用户反馈的难用和交互混乱，在 0.2.0 上修正工作流；没有新增后端架构或数据库迁移。

## 参考与取舍

实际阅读 MuMuAINovel 开书向导和项目导航源码、NovelForge 主编辑器源码、Arboris 分支的阶段向导和写作状态组件，并阅读 LINUX DO 的使用反馈。来源、许可证和可核实范围见 [交互决策](../decisions/0005-workflow-ux.md)。没有运行竞品的完整模型流程；本项目独立实现，没有复制这些项目的代码。

使用内置 imagegen 先生成 [工作区概念图](ui-workflow-v4.png)，完整输入见 [提示词](UI-V4-IMAGE-PROMPT.md)。概念图里的数字是示例，右下角向导缩略图也不是实际写作界面的组件。

## 实际改动

- 新建作品收起篇幅选项；提交后直接显示页内全书策划，模型与费用说明可见。
- 全书方案采纳后直接进入章节规划；需要作者点击生成才调用模型。章节采纳后显示“开始写作”。生成结果和恢复任务不再挤在弹窗内。
- 生成中、失败、取消、重试、刷新后恢复继续使用已有持久化任务。阶段切换管理焦点和滚动，避免采纳后仍停在旧文档底部。
- 保留固定的文字导航，统一“大纲与章节”“章节写作”命名。没有作品时不显示无效的作品内操作。
- 桌面 AI 候选放在中央“AI 草稿”页签，正文仍独立保留。采纳切回正文；原有版本检查、选段改写和对比保留。手机采用单列助手，平板通过按钮打开助手。
- “继续写作”按叙事顺序进入第一章未定稿内容。全部定稿或空书回到规划，不因点击导航创建空章。
- 前章未定稿时，写作助手提供“去处理前章”按钮并阻止直接生成后章。
- 规划模型尊重已保存的默认选择，包括作者明确选择的演示模型。

## 本机实际截图

- [开书](../screenshots/setup-v4-desktop.png)、[全书候选](../screenshots/blueprint-v4-desktop.png)、[章节建立完成](../screenshots/chapters-v4-desktop.png)
- [桌面 AI 草稿](../screenshots/draft-v4-desktop.png)、[桌面正文](../screenshots/manuscript-v4-desktop.png)
- [平板写作](../screenshots/editor-v4-tablet.png)、[手机正文](../screenshots/manuscript-v4-mobile.png)、[手机候选](../screenshots/draft-v4-mobile.png)

`frontend/scripts/capture-workflow-ui.mjs` 仅允许在独立的 ui-v3-preview 工作区创建 Demo 样例，通过实际 UI 完成开书到采纳。9 个截图覆盖 1440、768、390 CSS px，未发现页面级横向溢出或页面运行错误，原始记录见 [尺寸报告](../screenshots/v4-viewport-checks.json)。截图中的 109 字是 Demo 的实际输出，不能当作真实模型整章能力。

测试结果见 [本轮实现与验证](../IMPLEMENTATION-UX-V4.md)。
