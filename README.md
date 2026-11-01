# WB 图片生成器

为 Star Citizen 的舰船升级商品生成图片。选择起点、终点舰船，调整店铺名称、商品类型、中框和箭头，即可预览并导出图片。前端使用原生 JavaScript 与 Canvas，服务端使用 Node.js 和 SQLite，无需构建步骤。

[GitHub 源码仓库](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create) · [问题与建议](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/issues)

## Edge 离线扩展下载

**只想在自己的电脑上使用？下载 [Edge 离线扩展 1.0.0 安装包](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/releases/download/edge-v1.0.0/WB-image-generator-Edge-offline-1.0.0.zip)。** 内含 256 张舰船原图和 256 张缩略图，约 267 MB；解压后通过 Edge 加载，无需登录或启动服务器，日常选船和生成图片从本地读取。

在 [Release 下载页](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/releases/tag/edge-v1.0.0)选择 `WB-image-generator-Edge-offline-1.0.0.zip`。GitHub 自动提供的 `Source code (zip)`、`Source code (tar.gz)`，以及绿色「Code → Download ZIP」下载的是项目源码，不是已打包的扩展。

安装：完整解压 → Edge 打开 `edge://extensions` → 开启「开发人员模式」→「加载解压缩的扩展」→ 选择含有 `manifest.json` 的目录。点击工具栏中的扩展图标即可在新标签页打开生成器。详见 [Edge 安装和使用说明](extensions/edge/README.md)。

| 使用方式 | 网页版 | Edge 离线扩展 |
| --- | --- | --- |
| 适合场景 | 多设备访问、共用图库 | 单机使用，减少网站图片流量 |
| 账号与配置 | 账号登录，配置保存在服务器 | 无需登录，配置保存在当前 Edge 用户配置文件中，不跨设备同步 |
| 舰船图片 | 按需从服务器加载 | 随安装包提供，运行时从本地读取 |
| 图库维护 | 管理员维护共用图库 | 自己维护本机图库 |
| 部署 | 需要 Node.js 服务端 | 解压并加载扩展，无需服务端 |

**网页开发者入口：** [本地运行](#本地运行) · [部署说明](docs/deployment.md)。**扩展开发者入口：** [源码与构建](extensions/edge/README.md#从源码构建) · [发布记录](docs/edge-release.md)。网页与扩展共用本仓库中的舰船素材和合成模块，不需要维护两份图片。

本项目为社区制作，与 Cloud Imperium Games / Roberts Space Industries 无隶属或官方合作关系。[Star Citizen 官方网站](https://robertsspaceindustries.com/)。

## 功能

- 中英文舰船名、美元价格、共用图库；选择时仅允许起点价格严格小于终点价格，支持按价格排序。
- WBCCU、涨价 CCU、普通 CCU；可调整店铺标识、商品标题、中框文字、箭头样式及颜色。
- 图片尺寸及格式可选，浏览图库使用缩略图，预览合成和导出按需读取选中的原图。
- 外部导入支持 CCUgame 的 CSV 和星河避难所的 XLSX；表格解析、图片合成、打包下载在浏览器执行，表格和生成结果不上传服务器。首次使用某艘舰船时仍需下载它的图片。
- 邮箱与密码注册、个人常用配置、留言板；普通用户共用图库，管理员维护舰船资料及账号权限。

## 本地运行

需要 Node.js 24 或更新版本，以及 npm。在项目根目录执行：

```sh
npm ci
npm run seed-catalog
npm start
```

打开 <http://127.0.0.1:4173/>。不设置 `APP_PASSWORD` 且仅监听回环地址时为本地开发模式，自动拥有管理权限。不要将此模式直接暴露到公网。

`seed-catalog` 将随附素材和清单初始化到运行数据目录。重复执行不会重复新增舰船，也不会覆盖已有舰船修改。默认目录为项目内的 `data/`，可以通过 `DATA_DIR` 更改；该目录不属于发布内容。

使用环境文件时，需显式加载；程序不会自动读取 `.env`：

```sh
node --env-file=.env server.mjs
```

`.env.example` 是公网部署的配置模板；填写独立的站点访问口令并配置 HTTPS 后再使用。参阅[部署说明](docs/deployment.md)。

## 随附舰船素材

`assets/ships/` 包含 256 张官方舰船缓存原图、对应的 256 张 WebP 缩略图，以及中英文名称、价格和校验信息清单。名称与价格来自 2026-10-20 整理快照，不保证与当前官方商店一致；管理员可以维护。

舰船图片的版权由 RSI / CIG 等原权利人保留，**不适用代码的 AGPL 许可**。本项目没有将缓存或署名说明视为公开再分发授权；公开分发这部分素材前应核实适用许可。详见[素材权利说明](ASSET_LICENSE.md)。不需要随附素材时，可不执行初始化，在管理员界面上传具有使用权限的图片。

## 外部导入

| 来源 | 必需字段 | 对应关系 |
| --- | --- | --- |
| CCUgame CSV | `from`、`to`、`saving` | 起点、终点、节约 |
| 星河避难所 XLSX | `起始船`、`终点船`、`节约` | 第一行为标题，第二行为表头 |

`saving` / `节约` 为 0 时生成普通 CCU，其余生成 WBCCU。输出语言默认中文，也可选择英文；自定义文字按原内容保留。导入后先检查舰船匹配结果，再开始生成。

## 数据与维护

- SQLite 数据库 `data/studio.sqlite` 保存舰船资料、账号、配置、权限变更与留言；原图位于 `data/images/`，缩略图位于 `data/thumbnails/`。
- 账号注册不验证邮箱所有权，普通账号密码为 8–128 个字符。会话保存在进程内存中，重启后需要重新登录。
- `data/backups/` 保存部分修改前快照；它不能替代独立备份。使用[备份和恢复说明](docs/maintenance.md)维护完整数据。
- 更新前先备份，再运行 `npm ci` 与 `npm test`。不要把 `.env`、真实账号、数据库或运行备份提交到仓库。

```sh
npm test
npm run thumbnails
```

第二条命令补齐运行图库的缩略图；原图不会被覆盖。

## 许可证与源码提供

项目自有代码采用 **AGPL-3.0-only**，全文见 [LICENSE](LICENSE)，版权与免责声明见 [NOTICE.md](NOTICE.md)。第三方依赖与图标保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；舰船图片另见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。

如果修改本程序并向用户提供网络服务，需按 AGPL 第 13 条向与该版本远程交互的用户提供获取对应源码的机会。部署者应在网站可见位置提供自己实际运行版本的源码链接，并保留许可与版权声明；链接应指向对应版本，不能仅指向未包含修改的上游仓库。具体要求以 [GNU AGPL v3 全文](https://www.gnu.org/licenses/agpl-3.0.html)为准。

贡献前请确认有权提交相应代码或素材，不要在 Issue、补丁或截图中包含凭据和用户资料。
