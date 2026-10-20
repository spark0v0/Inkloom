# UI 生图提示词与产物记录

日期：2026-10-20（Asia/Shanghai）。方式：内置 `image_gen`，不是 CLI/API 备用路径。工具未提供可核验的模型版本，本记录不自行推断模型名称。

三张图片均为原创 UI 概念，未接入应用；示例小说、人物、字数、保存时间和版本号不代表真实数据。工作区保存的是生成原图的复制，保留了工具原始产物。

| 编号 | 项目产物 | 输入参考 | 背景 |
| --- | --- | --- | --- |
| G01 | [ui-editor.png](ui-editor.png) | 无，首次生成 | 不透明 |
| G02 | [ui-story-bible.png](ui-story-bible.png) | G01，延续同一产品视觉 | 不透明 |
| G03 | [ui-mobile-review.png](ui-mobile-review.png) | G01 与 G02，延续视觉并重新布局 | 不透明 |

下列为实际发送的完整 prompt；输入参考由工具的 `referenced_image_paths` 参数提供。重新生成时使用本项目中的对应参考文件，不依赖 Codex 缓存中的原路径。

## G01：桌面写作工作台

```text
Use case: ui-mockup
Asset type: original high fidelity product UI concept for a Chinese AI-assisted long-form novel writing web app.
Primary request: Design one exceptionally polished, genuinely usable DESKTOP WRITING WORKSPACE screenshot, 1920x1200 landscape. Working brand name "叙事工坊", English small wordmark "STORY WORKSHOP". This is a professional manuscript editing product for Chinese fiction authors who remain in control of the story. Render actual legible simplified Chinese text, realistic spacing and complete practical UI. Show a flat front-on application screenshot, no browser chrome, no device mockup, no perspective, no marketing hero.
Style/medium: restrained literary publishing software, precise Swiss information hierarchy, quiet manuscript layout. Off-white #F7F8F5 outer canvas, near-white #FCFCFA manuscript surface, ink #202823 text, single forest green #315847 accent, thin gray-green #DDE3DC dividers, muted #667269 secondary text. Small warm amber only for a real review warning. No purple, neon, gradients, glass, floating ornament or card-grid dashboard.
Composition/framing: 60px top header. Narrow 64px icon rail at far left, 228px chapter tree next, generous ~850px center writing area, 330px right assistant panel. Clean 32px outer whitespace. Bottom subtle save status. App should feel focused, functional, carefully crafted, calm.
Header exact labels: brand "叙事工坊", novel title "雾港来信", small breadcrumb "第一卷 / 第七章", top-right buttons "专注模式" and "导出". Small command search "搜索作品与设定  Ctrl K".
Navigation rail use tasteful coherent thin outline icons with compact labels: "创作", "故事档案", "剧情", "任务", "设置".
Left pane: heading "章节目录", small plus icon. Volume "第一卷 · 雾港", chapter rows "第五章 旧钟楼", "第六章 无人认领的信", selected pale green "第七章 雨夜的访客", "第八章 潮汐之前". Secondary word-count labels for saved chapters. Lower separated area "本章目标", short text "让林舟发现信封上的第二枚印记". A small calm line "线索：红色火漆" below, not a decoration card.
Center: small label "正文 · 草稿". Large graceful Chinese serif title "第七章 雨夜的访客". Manuscript in elegant readable Chinese Songti/Noto Serif SC, about 19px equivalent, 1.9 line height, long reading measure about 32 Chinese characters. Provide five natural paragraphs with ample whitespace, starting exactly:
"雨停在凌晨两点。林舟推开旧邮局的门，听见走廊深处传来一声很轻的咳嗽。"
"柜台后的女人没有抬头，只把一封信推到灯下。信封已经泛黄，红色火漆却像刚刚凝固。"
"那枚印记，他在父亲留下的航海图上见过。"
Then two more brief prose paragraphs in consistent Chinese literary style. Highlight just the phrase "红色火漆" with a subtle pale green underline to indicate a linked canon fact. Show a discreet adjacent margin note icon. Do not show a huge floating rewrite toolbar over the text. At bottom editor footer "2,340 字" and "已保存到本机".
Right pane tabs exact "写作助手" and "上下文". Active "写作助手". Small heading "下一段，从哪里开始？". A modest text area with real instruction "延续克制的悬疑感，让访客先说出一个只有父亲知道的细节。" Under it compact controls "续写一段" forest green main button, "润色选段" secondary, not repetitive CTAs. Distinct section "本次参考" with source rows "人物：林舟" / "第六章：信封上的印记" / "世界设定：旧邮局". A restrained amber review row "1 处待核对" and smaller description "访客是否知道林舟的身份？". Bottom of assistant panel shows "候选稿先预览，采纳后写入正文", compact "模型：自定义" and "费用：尚未估算". No invented quality score, no money estimate, no fabricated token chart.
Constraints: Perfectly aligned layout, ample room for writing, all text must have excellent contrast, action labels legible, use Chinese system sans for UI and Chinese serif only for manuscript. Selected and disabled states visibly distinct. Content not obstructed. No fake AI chat bubbles occupying manuscript. Concept is original and does not copy any existing app.
Avoid: hero sections, dashboards, stock images, decorative book covers, avatars, celebratory sparkles, unreadable microcopy, excessive rounded cards, glossy 3D, watermark.
```

## G02：故事档案与原文依据

```text
Use case: ui-mockup
Asset type: second original high fidelity Chinese novel writing product screen, a story bible and provenance inspector.
Input images: Image 1 is a reference for visual system, brand, colors, typography, top bar and left navigation only. Design a DIFFERENT page for the SAME product.
Primary request: one flat front-on desktop application screenshot 1920x1200 landscape, no device frame or browser chrome. Match reference "叙事工坊 / STORY WORKSHOP", forest green accent, off-white canvas, restrained dividers and legible Chinese typography. This is a functional author-facing story knowledge workspace. No marketing content.
Header: "叙事工坊", current novel "雾港来信", search "搜索作品与设定  Ctrl K", right "返回写作" and "导出". Left rail same outline icons and labels, select "故事档案".
Main heading: "故事档案". Subtitle "把设定和已发生的故事分开记录。每条记忆，都能回到原文。" Below horizontal tabs "人物" selected, "世界" "伏笔" "时间线".
Main content is three quiet columns, not a sea of cards. Left ~260px character list headed "人物 · 4", modest button "+ 新建人物", filter "搜索姓名或别名". Four rows with simple initial glyphs rather than photo avatars: selected "林舟 / 主视角", "沈知微 / 旧邮局值守人", "林远山 / 林舟的父亲", "雨夜访客 / 身份未知". Small separate footer note "正史更新至第六章".
Center largest character dossier: heading "林舟" and small label "主视角". Short natural description "一位回到雾港寻找父亲下落的地图修复师。". A quiet "编辑档案" action in header. Section "固定设定": field rows "职业  地图修复师", "行事习惯  先核实证据，再做决定", "核心目标  查清父亲失踪的原因". Section "当前状态 · 第六章结束时": rows "位置  雾港 · 旧邮局", "持有物  父亲的航海图、未拆封的信", "情绪  戒备，但愿意继续调查". Each state has small chapter provenance links "第六章 §12" or "第五章 §8", not unexplained AI confidence percentages.
Another center section "他知道什么": three semantic rows, positive outline check "信封的火漆与航海图上的印记相同" with citation "第六章 §12"; neutral hollow circle "访客的真实姓名" with explicit status "尚无原文证据"; neutral hollow circle "父亲目前的位置" with status "未知". Under, modest timeline "最近变化" with two clean dot-and-line records, "第五章  找到航海图" and "第六章  收到未署名的来信"; explanatory plain text "推测不会自动写入正史。".
Right 320px inspector headed "原文依据". Small label "已采纳版本 · 第六章". Quote the evidence in a readable neutral inset: "他把信封翻了过来。红色火漆中央，正是航海图上那个缺了一角的圆。" Under quote "第六章 · 第 12 段" and green text link "定位到正文". Separator. Section "待确认的变更", amber outline status "第七章草稿 · 1 项". Body "草稿出现访客姓名，但当前档案尚未记录林舟获知姓名的经过。". Small labels "可能的信息越界" and "需作者判断". Two practical buttons "查看上下文" primary outline and "标记为有意安排" secondary text. Final note "审核意见是建议，不会自动改写正文。".
Bottom status "所有档案保存在本机" and "引用绑定原文版本". Excellent contrast, balanced whitespace, compact functional labels, 8px consistent corner radii. No blue glow, purple, ornamental illustration, character portraits, avatars, fake numerical quality scores, token/cost charts or huge all-connected graph. Present this as a beautiful professional working tool, not promotional art.
```

## G03：移动端候选稿预览

```text
Use case: ui-mockup
Asset type: responsive mobile web UI concept for the same Chinese novel writing product.
Input images: Image 1 and Image 2 are visual-system references only. Keep the same product, forest-green accent, quiet near-white surfaces, Chinese UI sans and readable Songti manuscript. Create a different MOBILE view.
Primary request: one polished, narrow portrait mobile application screenshot, about 430 by 900 logical pixels shown at high resolution. Flat edge-to-edge UI only; no physical phone frame, no browser controls, no presentation board, no perspective. Brand "叙事工坊", novel "雾港来信". It must look realistic and directly implementable.
Composition: top compact bar with back arrow "雾港来信" and chapter-menu icon. Below header "第七章 雨夜的访客" in tasteful Chinese serif, tiny status row "草稿 · 已保存". Upper manuscript portion shows 2 short Chinese paragraphs:
"雨停在凌晨两点。林舟推开旧邮局的门，听见走廊深处传来一声很轻的咳嗽。"
"柜台后的女人没有抬头，只把一封信推到灯下。"
Readable 17-18px logical text, 1.85 line height, 22px side padding.
Lower ~60 percent is an OPEN candidate review sheet, same calm style. Opaque near-white surface and thin top divider, not blur. A small handle and heading "候选稿预览", close icon with comfortable tap area. One-line helper "采纳后保存为新版本，原稿保留。"
A clear stacked comparison suitable for a narrow phone screen: small heading "原文 · 版本 12", original passage in a pale gray inset "林舟拿起信，问她是谁。". Then heading "建议改写", green narrow left rule, new passage in a pale green inset "林舟没有碰那封信。他看着女人的手，问：‘你等的人，是我父亲？’". It is an intentional example, not generated metrics.
Below compact source chips "人物：林舟" and "语气：克制悬疑", natural line "当前原稿与生成时一致". Bottom two buttons on one row, left outlined "保留原稿", right forest green "采纳为新版本". Both comfortable >=44 logical pixel tap targets and equal visual weight except primary fill. Keep footer buttons above mobile safe area. A simple text action "继续调整要求" above buttons.
Constraints: Do NOT attempt side-by-side diff on mobile. No bottom tab bar behind/above the active sheet, no keyboard visible, no made-up cost or quality score, no floating chat bubbles or decorative images. Distinct visual hierarchy, generous but efficient whitespace, excellent text contrast, consistent 8px corner radii. Sheet must not obscure its own action buttons. Exact Chinese labels and natural Chinese prose. Original professional writing software design, faithful to references without being a shrunk desktop UI.
```

## 检视与适用边界

已查看三张生成图的层级、中文主要标签、内容区、来源区与操作位置。实施时需要修正示例字数、候选身份标识、确认正史入口、冲突状态与控件对比度等细节，见 [DESIGN.md](DESIGN.md)。

图片不能证明页面功能、可访问性或模型效果，不能用整图背景替代真实前端。后续变更保留新版本文件和对应 prompt，避免覆盖基线而丢失设计依据。
