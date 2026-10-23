# Inkloom 第三版 UI

用户否定了第二版的视觉与围绕内部机制展开的功能。本轮选择内容工具的清晰导航与列表层级，移除营销式说明和默认展示的内部任务术语。

## 先生成、后实现

使用内置 imagegen 生成 [创作台概念](ui-serial-studio-v3.png) 和 [章节写作概念](ui-chapter-studio-v3.png)，之后实现真实组件。完整提示词保存在 [UI-V3-IMAGE-PROMPTS.md](UI-V3-IMAGE-PROMPTS.md)。未将概念图用作页面背景。

参考项目与链接见 [工作流决策](../decisions/0004-serial-production.md)。MuMuAINovel 提供 AI 建书的流程参考，NovelForge 提供结构化方案与预览采纳参考；Linux DO / Discourse 提供可读导航与列表层级参考。StyleKit 的简洁产品方向用于收敛视觉。没有复制竞品源码。

## 视觉与组件

- 白色工作面、`#f7f8fb` 辅助背景、`#202631` 正文、`#616b7b` 次要文字、`#315be8` 主操作；常用控件 14–15px，正文可调。
- 创作台：作品信息、真正的创作步骤、全书设定与分卷、章节列表。由 `PlanningPage.tsx` 实现，与持久化方案、章节直接关联。
- 写作区：64px 主导航栏、240px 章节目录、弹性正文、350px AI 面板。由 `App.tsx`、`EditorPage.tsx` 和 `Assistant.tsx` 实现；沿用已验证的保存与编辑缓冲机制。
- 手机：主导航、目录、AI 通过独立面板进入，正文保留可读宽度；不缩放桌面三栏。
- 新建作品由 `LibraryPage.tsx` 实现，先输入想法、题材和篇幅，再进入 AI 策划。默认不再展示重复入口和长段解释。
- 样式补充在 `studio.css`；原有次要工具组件沿用现有基础样式。焦点、空状态、失败、Demo、候选、冲突、离线恢复继续保留。

## 真实运行截图

- [创作台桌面](../screenshots/serial-studio-v3-desktop.png) / [手机](../screenshots/serial-studio-v3-mobile.png)
- [章节桌面](../screenshots/chapter-studio-v3-desktop.png) / [平板](../screenshots/chapter-studio-v3-tablet.png) / [手机](../screenshots/chapter-studio-v3-mobile.png)
- [手机 AI 面板](../screenshots/assistant-v3-mobile.png)
- [作品库](../screenshots/library-v3-desktop.png)

截图由 `frontend/scripts/capture-serial-ui.mjs` 从独立本机预览工作区采集，仅使用示例内容。字数来自实际数据：Demo 样例只有短文本，不伪造整章字数。采集检查 1440、768、390 CSS px，无文档级横向溢出或页面异常，记录见 [v3-viewport-checks.json](../screenshots/v3-viewport-checks.json)。自动 axe 检查不等于完整人工无障碍认证。
