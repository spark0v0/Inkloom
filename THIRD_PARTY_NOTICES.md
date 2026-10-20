# 第三方依赖与来源

本版独立实现产品代码，没有复制调研中的小说生成项目或论坛附件代码。精确安装版本与传递依赖见 `frontend/package-lock.json`、`backend/uv.lock`；以下信息读取自已安装依赖的包元数据（2026-10-20）。

| 直接使用的组件 | 版本 | 包元数据中的许可证 |
| --- | --- | --- |
| React / React DOM | 19.3.1 | MIT |
| Tiptap 开源核心 / StarterKit | 3.32.0 | MIT |
| Radix Dialog | 1.3.1 | MIT |
| TanStack Query | 5.104.5 | MIT |
| Phosphor React | 2.1.10 | MIT |
| Tailwind CSS | 4.3.3 | MIT |
| Vite | 8.3.4 | MIT |
| FastAPI | 0.149.0 | MIT |
| Uvicorn | 0.54.0 | BSD-3-Clause |
| SQLAlchemy | 2.1.5 | MIT |
| Alembic | 1.20.0 | MIT |
| Pydantic | 2.14.1 | MIT |
| HTTPX | 0.28.1 | BSD-3-Clause |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause |

依赖的原始许可证保留在安装包中。此表不是传递依赖完整的发行清单；公开发行或打包前应按实际产物保留全部适用声明。本项目自身的发行许可证尚待作者确定，本文件不为本项目自动授予 MIT 或其他许可。

UI 参考网站只作为视觉研究。新版概念图使用内置生图工具生成，提示词在 `docs/design/UI-V2-IMAGE-PROMPTS.md`。实际图标来自 Phosphor；封面排版与 favicon 为本项目的原生实现。没有引用竞品图片、付费 Tiptap 功能或 React Bits 组件源码。
