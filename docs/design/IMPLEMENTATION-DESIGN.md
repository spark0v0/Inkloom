> 本文保留第二版的历史设计。当前主要页面采用[第三版 UI](IMPLEMENTATION-V3.md)，用户已否定旧默认视觉。

# 从概念图到真实工作台

日期：2026-10-20。先使用内置生图生成 [写作工作台 v2](ui-workspace-v2.png) 与 [作品书架 v2](ui-library-v2.png)，查看后再落地。完整原始 prompt 见 [UI-V2-IMAGE-PROMPTS.md](UI-V2-IMAGE-PROMPTS.md)。已有 [故事档案图](ui-story-bible.png) 和 [移动候选图](ui-mobile-review.png) 继续作为相应页面的基线。

## 参考与取舍

| 用户提供的来源 | 实际借鉴 |
| --- | --- |
| [Awesome UI Design](https://chrichuang218.github.io/awesome-ui-design/) | 设计资料目录与参考筛选，不把目录当产品模板 |
| [MotionSites](https://motionsites.ai/) | 局部状态变化的节奏；长时间写作不加入背景动效 |
| [StyleKit](https://www.stylekit.top/zh/styles) / [Editorial](https://www.stylekit.top/zh/styles/editorial) | 编辑出版层级、细分隔线、安静纸面与正文阅读宽度 |
| [React Bits](https://reactbits.dev/) | 可交互组件的局部反馈；当前用独立 CSS/组件，没有复制其代码 |
| [Linux DO](https://linux.do/) | 清楚的文字导航、明确状态、列表信息密度；功能研究见调研报告 |

不以动画数量衡量设计。辅助文字经自动对比度扫描后加深；以真实内容、可读性与操作保护修正图片细节。正文使用本机宋体/思源宋体回退，界面使用中文无衬线字体，不依赖外部字体请求。

## 映射

| 图中区域 | 实现 |
| --- | --- |
| 文字侧栏与面包屑 | `App.tsx`：作品路由、搜索、导出、本地状态 |
| 章节列表 | `EditorPage.tsx / ChapterList`：真实字数与确认状态 |
| 纸稿与页脚 | Tiptap、`useManuscript.ts`：持久化确认、字号、专注、版本 |
| 写作助手 | `Assistant.tsx`：模型、上下文、限制、持久化流、候选比较和错误恢复 |
| 书架封面 | 原生文字排版，由书名/题材呈现，没有裁切概念图充当资产 |
| 人物与原文依据 | `StoryPage.tsx`、`EvidenceModal.tsx`：设定与正史分开，读取指定版本并标记引用 |
| 窄屏候选面板 | 单列正文与 Radix 抽屉，目录/助手分别打开，结束后恢复触发处焦点 |

模型配置、任务记录、备份等辅助页复用现有文字侧栏、表单和只读记录布局，没有另造主要视觉框架。按钮、分隔、状态和弹层使用统一 token。

断线、冲突、旧候选、未配置凭证、演示、费用未知与正史后缀失效都来自真实状态。异常靠近操作区，不依赖瞬时 toast。模型与导入内容通过文本节点渲染，不执行 HTML。

## 检查边界

真实页面截图在 `docs/screenshots/`，与概念图分开。Chrome 桌面和 390px 手机视口流程、自动 axe 检查见实现记录。自动扫描只证明已扫描范围的规则结果，不等于完整 WCAG、屏幕阅读器或实际 Windows 输入法验收。
