# WB 图片生成器 · Edge 离线扩展

点击 Microsoft Edge 工具栏中的扩展图标，在新标签页打开 WB 图片生成器。无需启动服务器、注册或登录；舰船原图、缩略图、表格解析器和图片合成代码均随包提供，日常使用不再下载网站图库。

## 下载与安装

1. 下载 [1.0.0 完整安装包](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/releases/download/edge-v1.0.0/WB-image-generator-Edge-offline-1.0.0.zip)，完整解压到准备长期保留的目录。安装包约 267 MB，首次下载会产生相应流量并占用本机磁盘。
2. 在 Edge 地址栏输入 `edge://extensions`，开启「开发人员模式」。
3. 点击「加载解压缩的扩展」，选择解压后**包含 `manifest.json` 的目录**。不要选择 ZIP 文件或不含清单的上层目录，也不要直接双击 `index.html`。
4. 在工具栏的扩展菜单中找到「WB 图片生成器」，点击图标打开工作台；可按需将图标固定到工具栏。

安装步骤依据 [Microsoft 官方本地安装文档](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)。本版为桌面版 Edge 的 Manifest V3 扩展，尚未上架 Microsoft Edge Add-ons 商店，不会通过商店自动更新。

在 [Release 下载页](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/releases/tag/edge-v1.0.0)选择我们上传的 `WB-image-generator-Edge-offline-1.0.0.zip`。GitHub 自动生成的 `Source code (zip)` 和 `Source code (tar.gz)` 是开发者源码，需要构建后才能安装。

## 功能与本机数据

- 内置 256 张舰船原图、256 张缩略图及中英文名称和价格。资料为 2026-10-20 整理快照，不是实时官网报价，可在本机维护。
- 起点价格必须严格小于终点价格；选船支持搜索、默认顺序、价格升序和降序。
- 支持 WBCCU、涨价 CCU、普通 CCU，以及店铺名、标识、商品标题、中框文字、箭头样式和颜色的定制。
- 「外部导入」支持 CCUgame CSV 和星河避难所 XLSX。节约为 0 时生成普通 CCU，其余生成 WBCCU；输出语言默认中文，可选择英文。表格解析、图片生成和 ZIP 打包均在本机执行。
- 自定义图库与常用配置保存在当前 Edge 用户配置文件的扩展存储中，不上传网站、不改动线上图库，也不跨设备同步。手动添加的图片会额外占用本机存储。

扩展不提供账号、管理员角色或在线留言板。卸载扩展、删除浏览器用户配置文件或清除扩展存储会丢失本机配置和手动维护的图库；已下载到普通文件夹的成品图片不受影响。当前没有个人配置和图库的备份导入、导出功能。

## 更新时保留配置

先关闭生成器标签页，将新版文件放回原安装目录，再到 `edge://extensions` 点击该扩展的「重新加载」。保留同一扩展 ID，并使用同一 Edge 用户配置文件，才能继续访问原有本机数据。不要先卸载，也不要换目录重新安装。

## 从源码构建

需要 Node.js 24 或更新版本，以及 npm。在仓库根目录执行：

```sh
npm ci
npm run build:edge
```

生成的扩展位于 `dist/edge/`；在 `edge://extensions` 中加载该目录。构建会从仓库共享目录读取素材与模块，无需启动服务器或初始化网页数据库。

为避免误删已有文件，构建脚本在 `dist/edge/` 已存在时拒绝覆盖。重新构建前，请先将旧目录改名保留，例如改为 `dist/edge-previous/`，再执行构建命令。

验证离线功能：

```sh
npm run test:edge
```

该命令在临时目录构建扩展并运行 22 项离线测试。已有浏览器验证覆盖 PNG 导出、CSV/XLSX 导入、ZIP 下载及保存后重开恢复配置；尚未在真实 Edge 中试装，不能将这些检查视为商店审核或 Edge 兼容性认证。

源码布局：

| 位置 | 内容 |
| --- | --- |
| `extensions/edge/` | 扩展专用清单、入口、离线界面和本机存储代码 |
| `public/` | 网页与扩展共用的 Canvas 合成、导入、打包模块及界面素材 |
| `assets/ships/` | 唯一维护的舰船原图、缩略图及清单 |
| `dist/edge/` | 构建产物，不提交到 Git |

## 许可

项目自有代码采用 [AGPL-3.0-only](../../LICENSE)。官方舰船图片和缩略图保留原版权，**不适用代码的 AGPL 许可**；详见 [素材权利说明](../../ASSET_LICENSE.md)。第三方组件与图标许可见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。本项目为社区工具，不是 Star Citizen 官方产品。
