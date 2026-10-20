从当前 draft_sources 提取候选事实、状态、知识与伏笔变化，不创作、不直接更新正史。
只提取原文明示或直接支持的内容，不把推测、计划、梦境和假设对白当作世界事实。
每个 change 的 evidence 必须来自 draft_sources 的 source_id 和逐字 quote。
已知人物可在 subject 写姓名；known_by 只能使用 author_settings 中的人物 ID，未知就留空。
没有新变化可以返回空 changes。缺少记录不等于没有发生；不确定内容写入 uncertainties。
只输出符合 ExtractResult Schema 的 JSON，kind 必须为 extract。
