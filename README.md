# Inkloom

面向中文长篇连载的 AI 小说创作工作台。接入自己的模型，从故事想法开始，规划全书、生成章节、审稿修稿、整理记忆，最后导出稿件。作者决定采用什么，已有正文保留版本。

**当前为 0.2.0 本地测试版。** 支持面向番茄、起点等平台的创作目标和稿件导出，发布由作者自行完成。真实长篇成稿质量与费用仍待评测；演示模型只用于体验固定流程。

[本地启动](#本地运行) · [三章试写指南](docs/START-WRITING.md) · [结项交付与竞品对照](docs/PROJECT-CLOSEOUT-2026-10-31.md) · [当前限制](#当前限制)

## 可以做什么

| 创作环节 | 当前能力 |
| --- | --- |
| 开书与规划 | AI 全书方案、人物与世界设定，按卷分批规划章节；细纲可手动编辑、查看历史，或让 AI 修改指定字段 |
| 整章写作 | 按细纲生成整章、续写、重写；输出先进入候选，作者采纳后才形成正文新版本 |
| 卡剧情与修稿 | 比较三个剧情方向，再按选定方向续写；选段润色、扩写、缩写；从单条审稿意见准备对应段落改写 |
| 长篇资料 | 本章必读参考、作品文风、带原文依据的记忆，以及伏笔埋设/推进/回收；故事脉络支持按章查看、筛选和进入细纲编辑 |
| 保存与交付 | 自动保存、浏览器恢复副本、版本冲突保护、生成历史与中断片段；按章节范围预览并导出 TXT/Markdown/按章 TXT 压缩包，支持备份与恢复 |

最近修复了后续章纲未读取最近定稿、自然中文细纲漏召回旧线索、无关人物卡占满预算及目录加载完整正文的问题；模型请求新增整次时限和无正文输出时限。实现边界与实际验证见 [工程改进记录](docs/IMPLEMENTATION-CONTEXT-BOUNDARIES.md)。

继续修复了较长前文和自动记忆占满上下文、导致无法续章的问题：预算不足时自动资料按优先级让出空间，保留最近章末、明确必读和伏笔依据，预览说明实际未纳入的资料。见 [本轮 review](docs/REVIEW-2026-10-31.md)。

本轮收尾补齐连载范围导出：默认选择定稿，显示实际纳入章节、字数和排除原因，下载前检查稿件是否仍与预览一致；修复空稿 TXT/Markdown 下载，并合并字体与配色优化。详见 [最终对照、验证与使用边界](docs/PROJECT-CLOSEOUT-2026-10-31.md)。

## 开始创作

可以先按 [三章试写指南](docs/START-WRITING.md) 完成一部作品的开头，再根据通读、返工和实际费用判断是否继续扩大。

1. **连接模型**：在“模型设置”填写服务地址、模型 ID 和 API Key；首次保存可同时设为策划、写作、记忆与审稿的默认模型。
2. **AI 开书**：新建小说，填写想法、题材、目标平台、全书篇幅和每章字数。书名可以稍后由 AI 起名。
3. **规划与写作**：在页面内生成全书方案，采纳后直接进入章节细纲；确认章节后点击开始写作。桌面可在中央 AI 草稿页签通读和采纳，支持续写、选段润色与审稿。
4. **定稿与连载**：采纳正文后，在“本章定稿”中整理带原文依据的记忆，确认后进入下一章。导出时可选择章序范围，检查纳入清单，再下载 TXT、Markdown 或每章一个 TXT 的 ZIP 压缩包。

番茄小说、起点中文网和自由创作是可编辑的创作目标。导出稿件由作者自行上传；不自动发布到平台。目标字数属于计划，界面显示实际生成字数。

没有 API Key 时仍能手写、自动保存、查看版本、导入导出与备份。演示模型是明确标注的固定本地样例；不代表真实 AI 的文学效果。

## 实际界面

以下为实际运行截图，内容使用虚构测试材料。工作台与故事脉络的概念图、提示词和实现分别见 [工作台设计](docs/design/IMPLEMENTATION-UI-POLISH-2026-10-29.md) / [脉络设计](docs/design/UI-STORY-MAP-2026-10-30-PROMPT.md)。

![章节写作工作台](docs/screenshots/typography/editor-desktop.png)

![故事脉络：细纲、定稿与伏笔](docs/screenshots/story-map-desktop.png)

![章节细纲编辑与 AI 建议](docs/screenshots/chapter-outline-ai-desktop.png)

![连载范围与导出预览](docs/screenshots/export-final-desktop.png)

## 本地运行

Windows 使用 PowerShell 7，需要 Node.js 22.12+、Python 3.13+ 和 uv。

**一键启动：双击根目录的 [`启动 Inkloom.cmd`](启动%20Inkloom.cmd)。** 首次自动准备项目依赖并构建网页，服务就绪后打开默认浏览器；后续启动按依赖锁文件和源码变化决定是否重新安装或构建。重复打开会复用同一工作区已运行的服务；默认端口被其他程序占用时，会在 8765—8774 中寻找空闲端口。

保留首次启动窗口，按 Ctrl+C 停止服务。缺少系统工具时按窗口提示安装后重试，启动器不会自动安装系统软件或更改执行策略的永久设置。[启动验收记录](docs/verification/2026-10-25-launcher.txt)。

也可在 PowerShell 中运行以下命令；`-Port` 指定新服务的端口（同一工作区已运行时仍复用原地址），`-NoBrowser` 禁用自动打开网页，`-Rebuild` 强制重新构建（先停止已运行的服务）：

```powershell
pwsh -File .\scripts\launch.ps1
pwsh -File .\scripts\launch.ps1 -Port 8766 -NoBrowser -DataDirectory D:\StoryWorkspace
```

原有分步安装与启动入口仍可使用：

```powershell
pwsh -File .\scripts\setup.ps1
pwsh -File .\scripts\start.ps1
```

打开 **http://127.0.0.1:8765**。已有依赖时用 `start.ps1 -Build` 更新前端并启动。作品保存在 `data/`，不要删除该目录来解决启动问题。

```powershell
pwsh -File .\scripts\dev.ps1           # 前后端开发
pwsh -File .\scripts\test.ps1          # 静态检查、后端测试、接口契约、前端测试与构建
pwsh -File .\scripts\test.ps1 -Browser # 加上 Chrome 桌面与手机流程
pwsh -File .\scripts\start.ps1 -Port 8766 -DataDirectory D:\StoryWorkspace
```

测试使用独立的 `.tmp/` 工作区。技术栈为 React、TypeScript、Vite、Tiptap、FastAPI 和 SQLite；精确依赖版本见锁文件。API 类型由后端 OpenAPI 生成。

## 模型与数据

支持 Chat Completions 兼容接口。请按所用服务的实际能力填写上下文容量、输出上限、流式、JSON mode 等选项。写长章时应为模型保留足够的输出上限；遇到截断会保留片段，不能直接当作完整稿采纳。

密钥仅交给本机后端，Windows 使用 DPAPI 加密保管，不读回前端，不随备份导出。**选中的小说上下文会发送到配置的模型服务。** 费用缺少价格或 usage 时显示未知；生成中断且上游状态未知时，不自动重发付费请求。

模型请求默认最长 15 分钟；连续 3 分钟没有有效正文输出时停止等待，已有片段仍保留。另有网络阶段超时和响应大小限制。慢模型可在启动前调整 `INKLOOM_REQUEST_TIMEOUT_SECONDS`、`INKLOOM_PROGRESS_TIMEOUT_SECONDS`，取值 1—3600 秒；新任务会记录本次时限，详见 [配置说明](docs/IMPLEMENTATION-CONTEXT-BOUNDARIES.md#模型时限)。

正文、候选稿、规划和记忆分别保存。旧稿修改后，相关记忆与候选会失效；定稿会检查章节顺序与原文版本。备份使用一致性快照，恢复先校验到新目录，保留原工作区；0.1.0 工作区及备份支持升级。

## 当前限制

- 以作者审阅、逐章定稿推进；修改早期定稿后，后续章节需要复核。尚无精细的影响范围分析和批量复核助手。
- 中文资料召回使用有范围与预算限制的词法检索；不是完整的语义记忆系统，也不能保证自动发现全部剧情矛盾。
- 尚未实现带作品上下文的持续规划聊天、完整的场景级生成、多章自动改纲、云同步或多人协作。
- 真实模型连续十章的成稿、人物一致性、返工量和费用，以及百万字性能、完整 Windows 输入法人工体验与跨浏览器表现，仍待独立验证。

## 开发文档

- [结项交付、最终竞品对照与实际验证](docs/PROJECT-CLOSEOUT-2026-10-31.md)
- [当前实现、验证和限制](docs/IMPLEMENTATION-V0.2.md)
- [最新竞品对照、主流程 review 与修复](docs/REVIEW-2026-10-31.md) / [此前工程修复与配置](docs/IMPLEMENTATION-CONTEXT-BOUNDARIES.md)
- [项目规范 AGENTS.md](AGENTS.md)
- [产品方案](docs/PRODUCT.md) / [技术方案](docs/ARCHITECTURE.md) / [路线](docs/ROADMAP.md)
- [新版工作流与调研取舍](docs/decisions/0004-serial-production.md)
- [新版 UI、概念图与真实截图](docs/design/IMPLEMENTATION-V4.md)
- [最初的开源与论坛调研](docs/RESEARCH.md)
- [新增热门项目调研与长篇改进取舍](docs/decisions/0006-longform-navigation-context.md)
- [模型接入审查、开源反馈与后续优先级](docs/REVIEW-2026-10-23.md)
- [本章必读参考、重试恢复与验证](docs/IMPLEMENTATION-REFERENCES.md) / [连续性工程评测](evals/README.md)
- [审稿修稿、完整生成历史与验证](docs/IMPLEMENTATION-REVIEW-REVISION.md) / [热门项目对照与剩余缺口](docs/REVIEW-2026-10-25.md)
- [伏笔计划、正文进展与验证](docs/IMPLEMENTATION-THREAD-TRACKING.md)
- [作品写作风格、选段快捷操作与验证](docs/IMPLEMENTATION-WRITING-ASSISTANCE.md) / [开源交互对照](docs/REVIEW-2026-10-27.md)
- [生成进度读取优化、断线补偿与验证](docs/IMPLEMENTATION-LIVE-PROGRESS.md)
- [章节细纲编辑、历史恢复与 AI 局部修改](docs/IMPLEMENTATION-CHAPTER-OUTLINES.md)
- [故事脉络、伏笔依据与截图](docs/IMPLEMENTATION-STORY-MAP.md)
- [编辑入口并发、迟到回执修复与开源实现对照](docs/REVIEW-2026-10-28.md)
- [多窗口恢复副本、原始基线与作品设置保护](docs/IMPLEMENTATION-RECOVERY-BOUNDARIES.md)
- [工作台 UI 优化、概念图与浏览器截图](docs/design/IMPLEMENTATION-UI-POLISH-2026-10-29.md)
- [大纲、人物与模型设置的长内容和手机界面优化](docs/design/IMPLEMENTATION-UI-DETAIL-2026-10-30.md)
- [配色、本地中文字体和阅读偏好](docs/design/IMPLEMENTATION-TYPOGRAPHY-2026-10-31.md)
- [开发启动提示词](START_PROMPT.md) / [运行时提示词](prompts/)

技术栈为 React + TypeScript + Vite + Tiptap、FastAPI + SQLAlchemy + SQLite。项目独立实现，运行数据和密钥不进入源码仓库。
