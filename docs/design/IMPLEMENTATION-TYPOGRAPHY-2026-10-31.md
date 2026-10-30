# Inkloom 配色与字体细化

2026-10-31。复用 [工作台概念图](ui-polish-2026-10-29.png)与 V4 布局，本轮只细化颜色、字体和阅读控件，没有建立新页面或重新设计创作流程。参考 design-taste-frontend 的 framed-sheet 方向（seed 1063958842）与 ui-ux-pro-max 的中文无衬线字体建议，最终取舍以现有中文写作场景为准。

## 实际改动

- 在 `workbench.css` 统一近白稿纸、浅灰外框、墨色正文和深青绿主操作，统一成功、提醒、错误状态色。同步浏览器主题色与图标，去掉标题的中文负字距。
- UI 使用本地 Noto Sans SC 可变字体子集，常规、操作和标题以 400、500、600 字重区分。四个 WOFF2 共 213,236 字节，覆盖 ASCII 及从公开前端代码收集的 656 个汉字和标点；未覆盖字符回退至系统字体。字体通过 Vite 打包到既有 `/assets/` 路径，运行时不访问 Google Fonts。
- 默认正文采用黑体、18px、2 倍行高；工具栏可切换宋体及 16/18/20/22px 字号。阅读偏好仅保存在当前浏览器，不修改正文、版本或作品设置。中央 AI 草稿沿用所选字体和字号。
- 偏好读取校验值域，存储不可用或数据损坏时退回默认值。手机工具栏允许窄屏换行，字体和字号控件保留 44px 高度。
- 字体刷新脚本、上游资源清单及 SIL OFL 1.1 许可随仓库保存，构建产物也包含许可。正常构建不需要重新下载字体。详见 [字体说明](../../frontend/src/assets/fonts/README.md)。

| 用途 | 颜色 | 对应文字对比度 |
| --- | --- | --- |
| 稿纸 / 正文 | `#fffefb` / `#252c28` | 14.17:1 |
| 外框 / 辅助文字 | `#f1f3f2` / `#626d66` | 4.83:1 |
| 主操作 / 按钮文字 | `#286657` / `#ffffff` | 6.71:1 |

这些数值按 sRGB 相对亮度公式计算，只说明列出的颜色组合。

## 实际验证

- `npm.cmd --prefix frontend run build`：类型检查及生产构建通过。
- `node frontend/scripts/capture-typography-ui.mjs`：使用单独的 `typography-*` 临时工作区与虚构示例，完成桌面、平板和手机共六张截图；页面宽度分别为 1440、768、390px，无页面横向溢出，写作工具栏的可见按钮与字体选项均未超出视口。
- 字体、字号切换后刷新仍保留偏好，正文文本保持一致；四份本地字体加载成功，无外部网络请求和页面脚本错误。
- 五个页面状态的 axe WCAG 2/2.1/2.2 A/AA 规则检查均为零违规。这属于自动检查，未证明所有状态、操作系统及完整 WCAG 合规。
- design-taste-frontend 对 `workbench.css` 的 app lint：0 FAIL、4 WARN，提示涉及显式关闭的 blur/shadow 及编辑焦点线；浏览器 inspector：0 FAIL、1 WARN，提示近白底色偏暖。保留该底色用于与浅灰框架区分，未采用大面积米黄色面板。
- 已查看实际桌面、平板、手机及书架、模型设置截图，修正了手机右侧助手按钮被字体选项挤出的情况。所有截图均为演示作品；没有读取作者工作区或调用真实模型。

截图与报告位于 [typography](../screenshots/typography/verification.json)：[桌面写作](../screenshots/typography/editor-desktop.png)、[手机写作](../screenshots/typography/editor-mobile.png)、[平板写作](../screenshots/typography/editor-tablet.png)、[手机助手](../screenshots/typography/assistant-mobile.png)、[书架](../screenshots/typography/library-desktop.png)、[模型设置](../screenshots/typography/settings-desktop.png)。

宋体模式使用本机字体，未覆盖汉字也依赖系统回退，因此不同系统的字形会有差异。本轮没有数据库迁移或模型行为变更。
