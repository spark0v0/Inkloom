# 开发阶段 UI 概念图：原始生图提示词

日期：2026-10-20。使用内置 image_gen，先生成并查看概念图，再实现组件。图片没有充当页面背景。工具未给出可核验模型版本。

写作图重新确定文字侧栏与编辑器布局；书架图使用写作图为同一视觉系统的参考。概念中的字数、状态和人物为示例，实际应用从本机服务读取。下列提示词从本次会话的原始生图调用恢复，未凭记忆重写。

## 写作工作台 v2

图片：[ui-workspace-v2.png](ui-workspace-v2.png)。

```text
Use case: ui-mockup
Asset: revised desktop UI concept for a real Chinese local-first AI novel writing application, brand "叙事工坊". One flat front-on screenshot, landscape about 1680x1050, no browser chrome or device frame.
Design direction: editorial manuscript reading plus the practical sidebar/list hierarchy of a Discourse community and Notion-like document utility. Inspired by the content-first advice in awesome-ui-design, StyleKit editorial and corporate minimalism, and React Bits' responsive micro-interactions. This is professional writing software, not a marketing landing page.
Visual system: white #FDFEFC main surfaces, cool very pale gray-green #F4F6F2 navigation, ink #202922, muted sage #66736B, deep forest green #24634E actions, subtle green-gray borders. Warm amber only for a real pending item. UI uses clean Chinese sans; manuscript uses elegant readable Songti Chinese serif. 8px controls, restrained corners, virtually no shadows. No gradients, glow, decorative illustrations, fake graphs or stock photos.
Composition: 190px full-height primary navigation at left, 216px chapter directory beside it, generous center manuscript ~720px, 310px right AI assistant. Main topbar 64px tall. At top of left navigation an original simple book-outline mark and "叙事工坊". Below a back link "我的作品", then current project "雾港来信" with small explicit "示例作品". Navigation items with consistent Phosphor-style outline icons: "创作空间" selected soft green, "故事档案", "剧情规划", "生成任务". Bottom "模型设置" and "工作区备份", quiet health text "工作区已连接".
Main header across content: breadcrumb "雾港来信 / 第一卷", right command search icon button with Ctrl K, "专注模式" and outlined "导出作品".
Chapter pane heading "章节" and plus action; a volume row "第一卷 · 雾港". Five clean chapter rows:
"第五章 旧钟楼" small "已确认"
"第六章 无人认领的信" small "已确认"
selected "第七章 雨夜的访客" small "草稿"
"第八章 潮汐之前" small "待写作"
"第九章 来自北岸" small "待写作"
At bottom separated modest section "本章目标" with text "让访客带来一个与父亲有关的线索。", editable pencil icon. No statistics dashboard.
Center writing header: small inline state "正文" and gray "草稿", right "版本历史". Main chapter title "第七章 雨夜的访客" left-aligned, 30px serif, modest label above "第一卷". Under title generous manuscript whitespace, readable body 19-20px logical and 1.9 line height. Show these 5 coherent Chinese paragraphs:
"雨停在凌晨两点。林舟推开旧邮局的门，听见走廊深处传来一声很轻的咳嗽。"
"柜台后的女人没有抬头，只把一封信推到灯下。信封已经泛黄，红色火漆却像刚刚凝固。"
"那枚印记，他在父亲留下的航海图上见过。"
"林舟没有立刻伸手去拿。他看着女人干枯的手指，指节上有细小的墨渍。油灯在她侧脸投下一道模糊的影子。"
"“你来得比我想的要晚。”她终于开口，声音很轻，却像在空旷的房间里回荡。"
Subtle margin source indicator beside red-seal paragraph, nothing floating over words.
Center bottom status bar "已保存" green check, count "按实际正文统计" in this concept instead of fictional numerical count. Right outlined "确认正史" with small explanation in tooltip style not giant caption.
Assistant pane header "写作助手" and explicit amber little badge "演示". Mode tabs "续写" selected, "改写", "审稿". Heading "这一段，你想如何推进？". Real textarea "保持克制的悬疑感，让访客先提到父亲的一个习惯。". Compact fields "目标字数 300–600" and "模型 演示模型". Full-width green button "生成候选稿" with a small pen icon, no sparkles. Under button quiet note "先预览，再决定是否采纳".
Further section "本次参考" small count 3, bordered source rows with icons "人物 / 林舟", "前章 / 未署名的来信", "设定 / 旧邮局"; a text link "查看完整上下文". Lower area a subtle empty candidate state headed "候选稿会显示在这里", short supporting "原稿会完整保留。". Footer "演示响应，不调用真实模型" and no invented price/quality values.
Constraints: complete functional product layout, all Chinese readable, strong alignment and moderate information density, source-aware author-controlled feel. The manuscript is the visual focus. No huge title slogans, avatars, decorative numbers, cover images, dark sidebar, all-caps eyebrows, bright AI purple or bento feature marketing.
```

## 作品书架 v2

图片：[ui-library-v2.png](ui-library-v2.png)。

```text
Use case: ui-mockup
Asset: the library page for the same real Chinese novel writing web app. Image 1 is the visual system reference only. Keep the forest green, neutral white, typography, sidebar width and restrained editorial hierarchy.
One full flat landscape desktop screenshot, about 1680x1050, no physical device, no browser frame, no perspective.
Left 190px full-height navigation with book outline brand "叙事工坊". Selected "我的作品" with book icon, then "生成任务", "模型设置", "工作区备份". Lower small actual-state area "本地工作区" with green status "已连接". Quiet gray-green nav background #F4F6F2 and dark green #24634E accent. Main canvas white.
Top of main content: breadcrumb small "工作区 / 我的作品", right compact command search "搜索作品" and outline "导入手稿" plus green "新建作品". Main left-aligned heading 34px "我的作品". Subtitle "把灵感写成故事，把故事慢慢写完。" understated and product-relevant. Under a tab row "全部作品" selected, "已归档"; right sort "最近编辑".
Hero content is one functional featured work row, not a marketing hero: book-cover-shaped typographic rectangle ~145x205 left, ink green and misty paper design made of simple typography, title "雾港来信", small "示例作品"; no picture or complex illustration. To its right a calm medium heading "雾港来信" and small pills "悬疑" and "示例作品". Description two lines "一封没有署名的信，把离开故乡多年的林舟带回了雾港。有人知道他父亲失踪的真相。". Below actual-looking metadata labels "10 章" / "含已确认章节与草稿" / "演示数据". A primary outlined button "继续创作" and secondary text "查看故事档案". To the far right a small bordered last-chapter summary with "上次编辑" and "第七章 雨夜的访客", short line "原稿会保留每一次修改的版本。". This is clearly an example project rather than real user content.
Below separated section "开始一个新故事". Three varied-width simple actionable rows or quiet tiles, not three flashy equal feature cards: "空白作品" subtitle "直接进入编辑器，从第一段开始。", "从创意开始" subtitle "写下一句话，再逐步补全人物和故事方向。", "导入已有手稿" subtitle "支持 TXT 和 Markdown，导入前可预览章节。". Consistent outline icons, subtle hover treatment implied, generous whitespace.
Lower quiet full-width informational strip with book/file icon "作品保存在你的工作区" and text "没有模型也可以写作。连接云端模型时，选定上下文会发送到你配置的服务。". Small link "管理模型连接". Do not show fake activity charts, goals, streaks, or counts of uncreated books. No avatars, no made-up user name, no current clock, no giant metrics.
Design should feel like a polished author workspace blending a Notion-style document library with community-style navigation and editorial breathing room. UI sans serif, Chinese serif only on the typographic book cover. Strong alignment, 8px control radius, no beige/clay palette, no gradients or glows, no purple, no content-obscuring floating buttons.
```
