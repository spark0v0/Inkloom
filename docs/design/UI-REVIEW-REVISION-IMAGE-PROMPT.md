# 审稿到段落修订：概念图提示词

2026-10-25。先生成概念图，沿用 V4 白底、蓝色、固定文字导航与中央候选页签；不是新的全站视觉系统。运行数据和作者控制以决策 0009 为准。

## 完整输入

Use case: ui-mockup. Asset type: a desktop UI concept for the existing Chinese writing app Inkloom. Create a restrained, readable, high fidelity screenshot style concept, wide landscape 16:10. Keep its established V4 layout: fixed narrow text navigation on the far left (我的作品、大纲与章节、章节写作、人物与设定、连载导出、模型设置、备份、生成记录), chapter directory beside it, a wide central manuscript/results panel, right AI writing assistant. White surfaces, pale blue-gray sidebar, ink navy text, cobalt blue primary actions, fine borders, small 6-8px corners, Chinese sans-serif UI, no gradients or decorative illustrations. Central top tabs 正文 / 审稿意见, with 审稿意见 active. Show two readable review cards about fictional chapter 第4章 雨夜来信. Card one has amber 需要关注 badge, title 物件状态, a short original quote 罗盘的指针重新转动起来, explanation 前文确认罗盘已经损坏，本段缺少修复经过, and a concrete suggestion 改为向商队问路，保留罗盘损坏的事实. Main action 准备改写这一段. Secondary text action 查看依据. A collapsed disclosure 作者判断与说明 keeps four equal status buttons out of the primary reading flow. The second card is a small suggestion about repeated descriptions, with its own paragraph target and separate action. Right assistant has tabs 写作 / 找灵感 / 审稿, a clear model selector and 本章参考 entry. Show an inline prepared revision state 已准备段落改写 with a short read-only full paragraph excerpt, the selected review advice, and a small 取消 link. Primary button 按建议改写 starts generation only after author click. Below, use a subtle text link 返回审稿意见. Do not use a modal for this flow; do not replace the manuscript automatically. Footer note may say 候选稿采纳后才修改正文, very short. Any visible numbers and prose are illustrative. Keep existing navigation and manuscript space practical, avoid dashboards, scores, fake progress, technical hashes, giant introductory copy or five prominent buttons per card. A tiny mobile inset is optional only if it does not crowd the main concept; mobile should be one column with comfortable touch targets, not squeezed desktop columns.

## 落地与差异

[生成概念图](ui-review-revision-v1.png) 保存后才开始改动界面。实际保留 V4 导航顺序与真实模型选择，不实现图片中虚构的模型名、状态数字或章数；四种作者判断收在“作者判断与说明”内。准备会显示实际段落，选中意见旁保留定位正文与前文依据入口；手机使用现有助手抽屉单列，不压缩桌面四栏。该图覆盖本轮审稿流程；生成记录沿用既有列表，仅增加原位搜索、筛选和分页。

运行截图：[桌面审稿](../screenshots/review-rewrite-desktop.png)、[手机准备修稿](../screenshots/review-rewrite-mobile.png)、[桌面历史](../screenshots/job-history-desktop.png)、[手机历史](../screenshots/job-history-mobile.png)。截图中的正文、模型、调用记录均来自独立工程验收样例，不是作者作品或真实模型成稿。
