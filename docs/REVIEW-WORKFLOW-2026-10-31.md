# 连续创作流程复查

2026-10-31，适用于当前工作树的后续修复。**仍定位为 0.2.0 本地测试版，可以进入作者试写；尚不能认定已满足完全生产可用的结项条件。** 本次沿用用户“只做工程验证、暂不真实调用”的选择，没有真实模型或作者连续创作验收，也没有推送 GitHub。

前一轮的请求、备份及规划讨论边界见 [代码复查记录](REVIEW-CLOSEOUT-2026-10-31.md)；本次重点检查长期使用后的恢复、再次定稿和并发修改。

## 外部项目对照

本次阅读项目 README 和官方帮助，独立实现，未复制第三方代码。功能说明属于其文档描述，不表示本地实测过其效果，也不据此承诺 Inkloom 的文学质量。

| 项目及来源 | 可学习的做法 | 本项目的取舍 |
| --- | --- | --- |
| [AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator) | 分层规划、写作进度、章节修改记录，避免一次生成后丢失过程 | 保留全书、分卷、细纲和正文版本；本次改进任务摘要恢复，记录量增加后仍能找到对应类型的结果 |
| [MuMuAINovel](https://github.com/xiamuceer-j/MuMuAINovel) | 开书引导、世界人物与章节编辑结合，支持多种模型 | 现有主流程已覆盖相应入口；继续保持本机单作者范围，不在收尾阶段引入多用户服务 |
| [NovelForge](https://github.com/RhythmicWave/NovelForge) | 结构化资料、明确上下文、工作流进度与恢复 | 沿用可校验的细纲提案与任务，不让模型直接操作存储；修复跨分卷恢复与确认状态 |
| [Novelcrafter 官方聊天帮助](https://www.novelcrafter.com/help/docs/chat/the-chat-interface) | 明确选择章节、场景及资料作为讨论范围 | 已有选择一至三章细纲的规划讨论；全稿、多场景灵活聊天仍是能力差距。先保证现有范围明确、建议可比较后采纳 |

Inkloom 已有规划讨论、章内灵感、段落候选、定稿记忆与连载导出。尚未交付完整的“场景节拍 → 场景生成 → 场景调整 → 整章组合”闭环。该能力值得后续结合试写反馈评估，当前逐章流程不依赖它；不为追齐功能而把它标记为生产阻塞或已实现。

## 已修复的问题

| 发现 | 影响及修复 |
| --- | --- |
| P2：页面先取最多 150 条完整任务，再按用途筛选 | 大量讨论或其他任务会挤掉应恢复的写作候选。写作助手、细纲修改、记忆整理及全书/分卷生产改用摘要查询，在分页前按类型集合、分卷、正文版本及待处理状态过滤；只读取选中的任务详情。游标绑定完整筛选条件，分卷、版本先检查归属 |
| P2：未完成细纲按作品恢复，未绑定分卷 | 另一卷尚无完整结果的任务可能出现在当前卷；恢复时也不能从任意规划项猜分卷。摘要按分卷过滤，详情明确返回生成时的分卷 ID；旧快照从原始生产输入兼容读取，原分卷不存在则提示复核 |
| P2：重复确认相同正文和记忆仍然失效后章 | 同一正文、同一组记忆直接返回当前状态，不新增修订，不把后章改成待复核。比较忽略服务端补齐的引文元数据及人物集合顺序，仍检查真实原文依据 |
| P2：重新打开定稿没有可靠恢复作者选择 | 新增只读准备接口，恢复当前版本已确认的记忆和定稿修订；不以旧 AI 提议替换作者确认结果，也不把查询缓存中的旧空值当成最新内容。读取失败或正文版本变化时禁止确认 |
| P2：两个窗口可以互相覆盖已确认记忆 | 修改已有记忆需要定稿修订基线；变化后返回冲突，本页选择保留，展示当前记忆，由作者明确决定是否采用最新内容重新编辑。首次定稿保留旧调用兼容，新界面始终携带基线 |
| P2：定稿回执未确认时仍可修改参数 | 首次提交冻结版本、记忆、操作号与是否进入下一章；不确定失败后只重放同一请求，锁定编辑及关闭按钮。取得回执后重新读取实际定稿状态，拒绝用迟到回执自动跳过已变化的章节 |

定稿界面提取为 `ChapterFinalizeDialog.tsx`，编辑器继续负责正文和版本；没有调整主要页面布局或新建数据库迁移。实现契约见 [决策 0022](decisions/0022-workflow-resumption-finalization.md)。

## 本轮验证

| 检查 | 实际结果 |
| --- | --- |
| 后端相关回归 | 37 项通过：定稿、任务历史、全书与章纲生产、作品与正文版本；随后补充的引文元数据无变更确认和新旧快照分卷恢复 2 项通过，合计 39 项 |
| 前端 Vitest | 39 项通过，10 个文件，包含重复任务类型参数和工作区身份 |
| 构建与接口 | TypeScript/Vite 构建通过，OpenAPI 声明与后端契约一致 |
| 静态检查 | Ruff、`git diff --check` 均通过 |
| 桌面/手机浏览器 | 定稿回执丢失、重复确认、并发冲突、读取失败、记忆整理未确认和完整演示连载主流程共 10 条通过；分卷恢复首轮 2 条因测试使用了错误按钮名称超时，修正定位后单独复测 2 条通过。最终相关 12 条均有通过结果，未重跑浏览器全套 |

主要命令：

```powershell
# backend/，使用独立临时数据库
.venv/Scripts/python.exe -m pytest tests/test_canon_confirm.py tests/test_job_history.py tests/test_production.py tests/test_library.py --basetemp ../.tmp/review-core-20261031 -q
.venv/Scripts/python.exe -m pytest tests/test_canon_confirm.py::test_prepared_evidence_metadata_does_not_make_unchanged_memory_a_new_revision tests/test_production.py::test_outline_resume_keeps_the_requested_volume_in_new_and_old_snapshots --basetemp ../.tmp/review-new-core-20261031 -q
.venv/Scripts/python.exe -m ruff check app tests

# 仓库根目录
npm --prefix frontend run check:api
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run test:e2e -- e2e/finalization.spec.ts e2e/planning-resumption.spec.ts e2e/workshop.spec.ts e2e/review-boundaries.spec.ts --grep '定稿回执|并发修改定稿|定稿记忆读取|恢复第二卷|AI 建书|记忆整理未确认'
npm --prefix frontend run test:e2e -- e2e/planning-resumption.spec.ts
git -c core.safecrlf=false diff --check
```

测试只使用虚构内容、临时 SQLite 和 `127.0.0.1:9876` 的独立 `.tmp/e2e-*` 工作区；未读取作者密钥、作品或进行云模型调用。既有 Starlette/httpx 弃用提示及 Node 颜色环境提示仍存在；本次不因提示而进行无关依赖升级。没有重跑上一轮所有安全检查，也没有据此宣称全仓所有用例再次通过。

## 结项判断

本次已经发现并修复值得改进的流程缺陷。剩余的决定性证据，是使用作者准备采用的真实模型，在同一部作品完成至少前三章，再扩展到连续十章：通读因果、人物状态和伏笔，记录每章人工返工、失败恢复及供应商实际费用。还没有进行百万字规模的长期运行基准。

目前只能认定相关工程行为在所列验证范围内成立，不能据此认定小说可发表、可签约或可盈利。已有 [试写指南](START-WRITING.md) 可作为验收路径；用户此前未授权真实模型调用，本次不越过该边界。因“完全符合实际生产使用后再同步结项”的前提尚未证实，本轮保留本地修改，不提交或推送远程，也不把版本改成正式生产版。
