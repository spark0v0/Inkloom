# 长篇目录与按章检索

调研于 2026-10-22，实施于 2026-10-23。延续 V4 的页面和概念图，独立实现；没有复制竞品代码、安装竞品依赖或调用其在线模型。

## 新增参考

下列 stars 是本次读取 GitHub API 的快照，不是质量排名。与上一轮 MuMuAINovel、NovelForge 的参考分开记录。

| 项目 | stars | 许可证核查 | 阅读内容与取舍 |
| --- | ---: | --- | --- |
| [AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator) | 6,312 | GitHub 标识 AGPL-3.0 | 当前 main 已重写；阅读新版中文 README、`writing_context.py` 与 `ChapterContinuation.tsx`。参考按叙事位置选取前章、保存版本依据的思路，不混用旧版 Tkinter 文档，也不引入其 MongoDB 栈。 |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | 34,772 | GitHub 标识 AGPL-3.0 | 阅读官方 [World Info 文档](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) 和 `public/scripts/world-info.js` 关键词匹配、预算相关代码。借鉴相关设定按需进入上下文；它主要面向对话，不等同于连载小说系统。本轮不采用递归激活或英语单词边界匹配中文。 |
| [novelWriter](https://github.com/saga-soft/novelWriter) | 3,188 | GitHub 标识 GPL-3.0 | 阅读官方 [功能说明](https://novelwriter.io/features.html) 和 `novelwriter/gui/projtree.py`。参考章节树折叠、当前文档定位和写作区优先；它不是 AI 小说生成器。 |
| [Manuskript](https://github.com/olivierkes/manuskript) | 2,461 | GitHub 标识 GPL-3.0 | 核查项目目录与 `manuskript/models/searchFilter.py` 的独立筛选职责；本轮只作传统写作工具的辅助参考，未运行完整应用。官方网站功能页读取失败，不据此补造功能结论。 |
| [Arboris 原仓库](https://github.com/t59688/arboris-novel) | 1,617 | API 未识别许可证，未确认复用许可 | 阅读 `backend/app/services/writer_context_builder.py`：从当前细纲和正文识别人物，区分计划登场与已发生。本轮只研究机制，不复用源码；与此前仅 3 stars 的同名分支区分。 |

可核查的具体源码：

- [AI_NovelGenerator 写作上下文](https://github.com/YILING0013/AI_NovelGenerator/blob/main/backend/services/novel/writing_context.py)
- [SillyTavern 设定匹配](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/world-info.js)
- [novelWriter 章节树](https://github.com/saga-soft/novelWriter/blob/main/novelwriter/gui/projtree.py)
- [Manuskript 筛选模型](https://github.com/olivierkes/manuskript/blob/develop/manuskript/models/searchFilter.py)
- [Arboris 人物可见性构造](https://github.com/t59688/arboris-novel/blob/main/backend/app/services/writer_context_builder.py)

## 在 Inkloom 发现的问题

1. 章节目录没有搜索、状态筛选和折叠。百章作品需要反复滚动；写作区缺少相邻章节入口。
2. 上下文先取最近更新的 60 条设定，再匹配人物；老人物及其别名可能完全消失。章节目标虽然用于匹配已有实体，却没有直接进入检索词；没有建立人物/物品卡片的中文短词容易漏检。
3. 旧全文索引查询先 LIMIT 再由后续代码剔除不合格来源。检索应在 SQL 限制前绑定本书、当前采纳版本和前文顺序，减少无效记录挤占候选。

前两项资料问题已用临时 SQLite 复现：修改前两项断言失败，修改后通过。详见 `backend/tests/test_longform_context.py`。

## 实际决策

- 复用 `ui-workflow-v4.png` 的现有章节栏与正文区域，不新增主要页面、布局或生成弹窗。
- 目录按章序形成连续分卷，默认展开当前卷。搜索标题、卷名和细纲；纯数字按章序精确匹配，支持全角数字。状态与搜索可叠加，过滤时展开匹配结果；定位当前章会清除筛选。换章后重新定位当前卷，不持久化跨章筛选偏好。
- 章节底部提供前后章导航；不会自动创建下一章、确认定稿或调用模型。沿用保存屏障，保存失败不离开当前稿。移动目录仍使用已有抽屉。
- 在全部作者设定中先匹配当前指令、标题、细纲、绑定的章计划与正文尾部，再选择附加设定。匹配到的设定与世界规则保留，其余按最近更新补充到 60 条；未纳入的设定数量在已有参考预览中说明。
- 相关人物的本名和别名优先成为检索词，再补充本章短语。最多检索 40 个词，超过时明确提示。两字中文走字面匹配，较长词走已有 FTS5；没有引入向量服务或声称这是语义理解。
- 全文搜索在 LIMIT 前验证本书、定稿状态、采纳版本与前文顺序。来源仍以不可变版本和段落绑定；排除资料、失效处理和硬预算检查继续生效。
- 未来大纲不用于激活当前章人物检索；计划、设定、已经发生的事实仍分别传入。名字出现不代表角色已获知某条秘密。

## 范围与后续

没有数据库迁移、API Schema 变更或新增第三方依赖。上下文预览和实际生成共用同一构造函数。本轮未执行真实云模型写作，不能由检索测试推出长篇文学质量。

当前仍是字面检索。未建立别名的隐称、同义改写和中文长句拆词存在召回限制；大量硬规则可能超预算，此时会阻止请求而非静默删减。后续应先建立真实小说的检索与连续性评测样例，再决定是否增加语义检索。结构化伏笔回收、批量连载队列和更完整的模型配置向导尚未在本轮实现。

验证与实际截图见 [实现记录](../IMPLEMENTATION-LONGFORM.md)。
