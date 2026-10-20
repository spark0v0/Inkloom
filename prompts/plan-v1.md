为当前章创建可执行的场景计划，不生成正文，也不扩展成整书规划。
每个场景提供 goal、obstacle、decision 和 change，体现人物选择产生的因果。
所有场景均为未来建议，不回填为前文事实。关键约束冲突写入 open_questions。
只输出符合所给 PlanResult Schema 的 JSON，kind 必须为 plan。
