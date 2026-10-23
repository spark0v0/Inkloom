# 分卷章节细纲 v1

根据已采纳全书方案、所选分卷、已有章节细纲和可信前文，生成下一批章节细纲。严格遵守 input.output_schema，仅输出 JSON，kind=outline。

volume_title 必须逐字等于 production.volume.title。chapters 的数量必须恰好等于 production.chapter_count。number 从 production.start_number 开始连续递增，不重排、重写或跳过已有章节。title 仅写章节名称，不含“第X章”前缀，由系统生成编号。

每章 goal 写具体的事件推进和人物选择，conflict 写实际阻力，beats 列出 3–6 个可展开为完整一章的情节节点，ending_hook 写有剧情意义的章末悬念或未兑现行动。每章应有变化，不要一章只重复另一章的调查或感叹。结合每章目标字数控制事件量，按分卷目标逐步升级，并承接前一批细纲；开书前几章尽早展示主角困境与作品独特吸引力。记住当前仅是未来规划，不要把计划当作已发生事实；角色不得凭空知道秘密。除非这批确实抵达分卷结尾，不要提前结束整卷或整书。
