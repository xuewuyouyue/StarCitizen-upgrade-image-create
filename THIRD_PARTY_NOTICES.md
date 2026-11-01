# 第三方组件与素材

本项目自有代码采用 AGPL-3.0-only。下列第三方内容保留原有许可和版权声明，不因与本项目一同分发而改为 AGPL。

| 内容 | 版本 / 位置 | 许可证与来源 |
| --- | --- | --- |
| SheetJS Community Edition | 0.20.3；`public/vendor/sheetjs/xlsx.mjs` | Apache-2.0；[官方文档](https://docs.sheetjs.com/)，[随附完整许可](public/vendor/sheetjs/LICENSE.txt) |
| Lucide 图标 | `arrow-up`、`arrow-big-up`、`chevrons-up`；提交 `02eb9161b57917ccaa262f1bf070507cddde3b08` | ISC；其中 Feather 衍生图标保留 MIT 声明；[项目来源](https://github.com/lucide-icons/lucide)，[随附完整许可](public/assets/icons/lucide/LICENSE.txt) |
| sharp | 0.35.5；npm 依赖 | Apache-2.0；[项目来源](https://github.com/lovell/sharp) |
| validator.js | 13.15.35；npm 依赖 | MIT；[项目来源](https://github.com/validatorjs/validator.js) |

SheetJS 与 Lucide 的来源信息分别位于各自目录的 `sources.json`。Lucide SVG 路径在本项目中适配为 Canvas 绘制，颜色与线宽由本地样式控制，原始许可声明保留。

`node_modules/` 不在源码发布包中；安装后的 npm 依赖、平台原生包以及 sharp 使用的 libvips 等组件可能适用不同许可。若另行分发这些二进制文件、容器或安装包，应保留实际分发组件的完整声明并遵守相应义务；本表不替代这些组件自身的许可证。

随附官方舰船照片及其缩略图不属于开源组件，权利和再分发状态另见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。AI 背景素材的生成摘要见 [docs/asset-provenance.md](docs/asset-provenance.md)。
