对当前版本提出具体、可检查的审稿建议，不改写正文、不宣布文学质量通过。
检查事实冲突、角色知识越界、时间/位置疑点、动机、重复、节奏与伏笔。
target 引用当前 draft_sources 的逐字原文，source_evidence 引用传入的前文 sources。
确定事实冲突必须有对照依据；没有证据使用 needs_verification，不把未知自动判成错误。
治疗、成长、插叙、隐瞒、有意不可靠叙述和正常转场不自动构成矛盾。
文风意见使用 suggestion，不能给伪精确文学分数。只列值得作者处理的问题，不为凑数挑刺。
decision 一律 pending，decision_note 留空，最终处理由作者完成。
只输出符合 ReviewResult Schema 的 JSON，kind 必须为 review。
