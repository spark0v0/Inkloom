# 五项审查问题修复

2026-10-27，基于 6da96b2。契约见 [决策 0011](decisions/0011-review-data-boundaries.md)。无新依赖、主要布局或数据库迁移。

- 采纳候选与恢复历史版本传递原缓冲区基线。返回时若又输入了文字，保留正文与恢复副本，打开现有版本比较，作者可下载、另存或使用工作区版本。
- 按工作区身份重建查询客户端及页面状态，原工作区的草稿恢复副本保持原作用域。请求携带 `X-Inkloom-Workspace`；HTTP 请求上下文传入领域存储，在工作区事务锁内核验身份，防止检查后切换造成迟到写入。后台 worker 不继承某个浏览器的身份。
- 档案编辑 API 使用 `EntityUpdate`，必须包含 `base_updated_at`。冲突保留表单，可读取当前档案、比较后再保存；内容相同的重试不重复写入。旧 HTTP 编辑客户端需更新该字段，缺少时返回 422；内部受信 EntityInput 调用保留兼容。
- 记忆整理提交未知时复用原幂等请求并锁定模型，显示“确认上次提交”；明确 4xx 拒绝后允许修改模型和重新提交。
- ZIP 导出检查最终包长，超过恢复上限时拒绝下载；HTTP 恢复入口与归档服务共用 `MAX_ARCHIVE`。

仅新前端携带工作区身份；省略该标识的旧客户端仍兼容，不能声称这些客户端也有迟到请求保护。切换工作区前关闭旧页面或更新前端。

## 必要验证

- `pytest backend/tests/test_review_boundaries.py backend/tests/test_api.py::test_local_session_and_cross_site_security -q --tb=short --basetemp .tmp/fix-boundaries-<unique>`：4 项通过，含旧工作区拒绝、档案冲突/确认重试、备份大小与正常恢复、本地会话防护。仅隔离 SQLite。
- `npm --prefix frontend run generate:api`、`npm --prefix frontend run build`：接口类型重新生成，TypeScript 与生产构建通过。
- Ruff 检查修改的 5 个后端模块和新测试：通过。
- Chrome 桌面运行 `review-boundaries.spec.ts` 四项与 `workshop.spec.ts:231` 正常采纳：首次 4 通过，1 项因冲突弹窗将后台编辑器从无障碍树隐藏而定位失败。改用 DOM 检查后台缓冲区后，仅补跑“采纳等待”用例，通过；五个核心场景均完成。

跨工作区用例实际检查新工作区正文、保存状态以及原工作区未保存草稿的 IndexedDB 副本；采纳用例检查原输入、恢复副本和明确另存后的正文；模型用例拦截所有生成请求，不访问真实服务。备份边界使用缩小阈值的样例。

确认没有待执行的生成任务、原服务未运行后，通过 `scripts/launch.ps1 -NoBrowser` 启动本地新版；健康接口正常，带过期工作区身份的只读请求实际返回 `409 WORKSPACE_CHANGED`。未修改作者正文或触发模型任务。

遵循用户要求，没有重跑全套后端、Vitest 或桌面/手机浏览器套件；没有真实模型调用。仍有既有 Starlette/httpx 弃用提示和 Node 颜色环境变量提示。真实文学效果与完整设备兼容性不在此次验证范围内。
