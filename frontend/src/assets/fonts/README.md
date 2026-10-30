# 本地界面字体

`ui-font.css` 与 `inkloom-ui-*.woff2` 是 Noto Sans SC 的 400–700 可变字重子集，采用 SIL Open Font License 1.1。完整许可见 [OFL-NotoSansSC.txt](OFL-NotoSansSC.txt)，上游与各文件来源见 [manifest.json](manifest.json)。

字体来自 [Google Fonts 的 Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)，通过官方 CSS2 接口按项目公开 UI 中出现的汉字、标点和 ASCII 制作子集。小说内容和用户数据不参与字体制作。运行时全部从本机服务加载，没有外部字体请求。

开发时可运行 `node frontend/scripts/update-ui-font.mjs` 更新资源；正常安装与构建不需要联网下载字体。字体与 CSS 通过 Vite 打包到 `/assets/`，许可同时保存在 `public/assets/fonts/OFL-NotoSansSC.txt`，保证构建产物包含许可。界面新增未覆盖的汉字、作品内容及特殊符号使用系统字体回退。宋体模式优先使用本机已安装的思源宋体、macOS 宋体或 SimSun，因此不同操作系统的外观可能略有差异。
