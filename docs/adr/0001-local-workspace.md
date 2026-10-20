# ADR 0001：首版本地工作区落地

日期：2026-10-20。状态：已采用；这是 0.1.0 的实际结构，`ARCHITECTURE.md` 中更细的分层目录仍属于可演进设计。

## 实际选择

- React 19 / TypeScript strict / Vite 8，Tailwind 4 构建集成与统一 CSS token，Radix Dialog 管理弹层，Phosphor 提供图标。Tiptap 3 开源核心只启用基本段落、换行与安全文本标记。
- TanStack Query 保存服务状态；编辑缓冲、待确认请求与恢复由专门 hook 管理。当前无需 Zustand，不为符合推荐清单增加依赖。
- FastAPI / Pydantic / SQLAlchemy / Alembic；SQLite WAL、FULL 同步、短事务与 FTS5 trigram。精确版本以 `backend/uv.lock`、`frontend/package-lock.json` 为准。
- `main.py` 负责本地会话、API/SSE 和静态资源；`library.py` 负责作者操作；`context.py` 冻结资料；`jobs.py` 管理任务状态；`providers.py` 负责传输；`storage.py` 和 `workspace_io.py` 负责持久化/恢复。领域函数不依赖 HTTP。
- worker 是应用生命周期内的异步执行器，Job、Attempt、事件、租约和 epoch 都在 SQLite；不是纯内存任务。尚未提供独立 worker CLI，不能称为独立进程部署。

## 关键契约

章节版本不可变。保存使用 `base_version_id + operation_id`，同键同内容返回已有版本，同键不同内容拒绝；冲突不覆盖工作指针。采纳候选也创建新版本，保留不受改写影响的基本格式。

段落指非空白逻辑行；相同或一一对应编辑保留 ID，拆分/合并产生新 ID。来源身份由作品、章节、版本、段落、正文 SHA-256 和精确 quote 决定。引用范围是段落内码点 `[start, end)`；改写选区是整章码点范围。换行统一 LF，Tiptap 段落间为两个 LF，段内 hardBreak 为一个 LF。共享字数样例在 `docs/contracts/text-fixtures.json`。

正史确认逐章检查前缀。修改已确认章会失效对应后缀的事实和全文索引，历史保留可查。任务额外冻结可信前缀的版本映射，防止“前文失效但正史修订号未增加”的竞态。

任务创建、事件追加和状态写入使用短事务。每书一个活动任务，当前 worker 按顺序执行。领取采用 `BEGIN IMMEDIATE` 与递增 epoch，网络期间不持有写事务。SSE 从数据库按序号重放；重连不创建任务。取消先改变状态和 epoch，再中止传输，旧执行器不能提交完成产物。暂停发生在调用结束边界，不声称暂停远端计费。

派发后的传输中断、租约过期或无法确认的持久化故障进入 `interrupted_uncertain`。结构/引用错误保留响应，拒绝写正史。没有自动付费重试；明确重试仍受调用次数、配置版本和可判断预算约束。数据库幂等不代表供应商计费恰好一次。

## 恢复与安全

IndexedDB 只保存浏览器待确认稿；“已保存”以服务提交为准。恢复副本与服务版本比较后由作者选择恢复。中文组合输入期间推迟保存与依赖基线的操作；实际输入法人工验收另记。

工作区默认在 `data/`。SQLite backup API 创建一致快照，不在线只复制主文件。ZIP 仅允许清单与数据库，限制大小，检查库完整性、版本/段落、引用和作品作用域，再重建检索。恢复生成新目录与工作区 ID，原目录保留；凭证和环境变量引用不自动激活。

本机 HTTP 校验 Host、Origin、Fetch Metadata 和 HttpOnly SameSite 会话。密钥只由后端保管；不记录带正文/密钥的异常细节，不接入第三方分析。自定义端点只接受明确配置的 HTTP(S)，关闭跳转与代理环境继承，不暗中切换中转商。

## 边界

检索是作品/正史约束的字面与别名匹配，没有嵌入向量或语义召回。近期两章作为必要来源，较早原文经 FTS/名称召回后按预算裁剪；必要上下文超预算则在调用前拒绝，不承诺任意长度都能塞进窗口。

无真实服务与文学评测时，只报告本机协议和演示流程。原生 Responses / Messages、多用户并发、完整剧情分支和模型自动工具执行不属于本版。
