# 第三方组件与素材

本项目自有代码采用 AGPL-3.0-only。下列第三方内容保留原有许可和版权声明，不因与本项目一同分发而改为 AGPL。

| 内容 | 版本 / 位置 | 许可证与来源 |
| --- | --- | --- |
| SheetJS Community Edition | 0.20.3；`vendor/sheetjs/xlsx.mjs` | Apache-2.0；[官方文档](https://docs.sheetjs.com/)，[随附完整许可](vendor/sheetjs/LICENSE.txt) |
| Lucide 图标 | `arrow-up`、`arrow-big-up`、`chevrons-up`；提交 `02eb9161b57917ccaa262f1bf070507cddde3b08` | ISC；其中 Feather 衍生图标保留 MIT 声明；[项目来源](https://github.com/lucide-icons/lucide)，[随附完整许可](assets/icons/lucide/LICENSE.txt) |

SheetJS 与 Lucide 的来源信息分别位于各自目录的 `sources.json`。Lucide SVG 路径在本项目中适配为 Canvas 绘制，颜色与线宽由本地样式控制，原始许可声明保留。

离线扩展不附带原网站 Node.js 服务端或 `node_modules/`；不运行 sharp、validator.js 或 libvips。新上传图片在浏览器本机读取处理，XLSX 通过随附的 SheetJS 读取，不从 CDN 下载代码。

随附官方舰船照片及其缩略图不属于开源组件；AI 背景素材的生成摘要、官方图片权利和再分发状态另见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。
