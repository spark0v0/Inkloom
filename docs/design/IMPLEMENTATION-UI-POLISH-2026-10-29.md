# Inkloom 工作台视觉优化

2026-10-29。沿用 V4 的创作流程和文字导航，优化书架、写作区、助手及共用视觉样式。

## 设计依据与实际实现

先使用内置 imagegen 生成 [概念图](ui-polish-2026-10-29.png)，[完整提示词](UI-POLISH-2026-10-29-PROMPT.md)随项目保存。采用 design-taste-frontend 的 framed-sheet 方向（seed 925073162），选择灰白外框、白色稿纸和深青色主要操作。保留本项目中文系统字体与固定文字导航，没有采用技能示例中的无全局导航图形编辑器。概念图仅提供布局和视觉参考；模型名称、字数、章节状态等来自现有 API。

- 共用框架：统一边框、背景和按钮层级，降低蓝色选中态的视觉强度。状态徽标保留语义颜色；移除背景模糊和封面的装饰线。
- 书架：大卡片收紧为作品条目，桌面将继续写作放在右侧，手机放在底部。去掉重复的新建作品占位块，保留顶部新建按钮和首次使用入口。手机保留已定稿数量。
- 写作区：固定文字导航、正文/AI 草稿页签不变。目录可独立收起，与助手开关组合使用；折叠仅改变显示，正文编辑器保持挂载。目录与助手的桌面按钮有文字、可访问名称和展开状态，支持键盘操作。
- 助手：写作模式提前，文风与本章参考合并为紧凑的并排入口；细纲、补充要求与生成按阅读顺序排列。手机助手去掉重复内边距，增加可用内容宽度；手机工具按钮为 44px。
- 样式放在 `frontend/src/workbench.css`，在基础与功能布局后载入；已有交互的蓝色硬编码改为共享 token。无需数据库迁移或新依赖。

书架回答“继续哪本作品”，写作区回答“当前章节写到哪里、下一步做什么”，助手回答“这次让 AI 做什么”。正文区域优先分配空间，短示例留下的空白不填充虚构统计或无关内容。

## 实际检查

- `npm --prefix frontend run build`：TypeScript 与生产构建通过，最终 Vite 构建 471ms。
- `node frontend/scripts/capture-workbench-ui.mjs`：隔离工作区、固定 Demo 数据，13 张截图覆盖 1440、768、390 CSS px；无页面级横向溢出、无页面运行错误。检查目录折叠前后文本保持、正文空间、键盘展开，以及手机目录和助手打开/关闭。
- 同一脚本的 axe 检查覆盖 10 个页面状态，未报告违规；这是自动检查结果，不表示完整 WCAG 认证。
- `npm --prefix frontend run test:e2e -- workshop.spec.ts --grep 'AI 建书、章节细纲'`：2 passed (46.7s)。桌面/手机均完成固定 Demo 的方案→细纲→正文→采纳→记忆→定稿→下一章→导出。
- design-taste-frontend 浏览器检查：0 FAIL，2 WARN 为单本示例书架下方留白；保留真实小数据量。样式 lint：0 FAIL，3 WARN 均命中 `backdrop-filter: none` 或 `box-shadow: none`，属于字面扫描误报。
- 截图脚本首次运行发现 axe 要求显式浏览器 context，及 `innerText`/`textContent` 段落空白比较差异，已修正脚本后重新完成上述检查。规划截图也增加加载结束等待。
- E2E 日志仍出现 Windows asyncio `ConnectionResetError: [WinError 10054]` 连接关闭诊断，以及 NO_COLOR/FORCE_COLOR 提示；测试断言均通过。
- `git diff --check` 通过；没有真实写作模型调用，没有写入作者工作区。

完整截图尺寸与 axe 结果见 [checks.json](../screenshots/ui-polish/checks.json)。可查看 [桌面写作](../screenshots/ui-polish/editor-desktop.png)、[收起两侧面板](../screenshots/ui-polish/editor-focused-panes.png)、[手机正文](../screenshots/ui-polish/editor-mobile.png)、[手机助手](../screenshots/ui-polish/assistant-mobile.png)、[书架](../screenshots/ui-polish/library-desktop.png)。
