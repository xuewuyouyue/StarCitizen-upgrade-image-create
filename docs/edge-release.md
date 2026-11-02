# 星际公民CCU图片生成器 · Edge 离线扩展 1.0.2

网页版和 Edge 离线扩展维护在同一仓库。扩展专用代码位于 `extensions/edge/`，舰船素材与合成模块直接复用仓库共享目录；无需重复提交 256 张原图和 256 张缩略图。网页服务端仍可按原有方式运行。

## 1.0.2 更名内容

扩展显示名称统一为「星际公民CCU图片生成器」，版本更新为 1.0.2；英文安装包文件名保留 `WB-image-generator-Edge-offline` 前缀。继续使用 1.0.1 的单一根清单结构，同一个包既可供商店上传，也可解压后本地加载。网站名称与图库清单不变。

1.0.2 提供简体中文与英文商店元数据，默认简体中文；英文名称为「Star Citizen CCU Image Generator」。工作台界面主要为简体中文，批量输出可选择中文或英文舰船名，不包含整个工作台的英文界面切换。

- 发布标签：`edge-v1.0.2`
- [Release 下载页](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/releases/tag/edge-v1.0.2)
- [完整扩展安装包](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/releases/download/edge-v1.0.2/WB-image-generator-Edge-offline-1.0.2.zip)：`WB-image-generator-Edge-offline-1.0.2.zip`，约 267 MB。
- [SHA-256 校验文件](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/releases/download/edge-v1.0.2/WB-image-generator-Edge-offline-1.0.2.zip.sha256)：`WB-image-generator-Edge-offline-1.0.2.zip.sha256`。

初次使用请下载完整扩展安装包，完整解压后在 Edge 的 `edge://extensions` 中开启「开发人员模式」，点击「加载解压缩的扩展」，选择含 `manifest.json` 的目录。点击工具栏扩展图标即可打开生成器。

GitHub 在每个 Release 下自动列出的 `Source code (zip)`、`Source code (tar.gz)` 是仓库源码，不是已打包的安装文件。安装时请选择上方我们上传的专名 ZIP；完整步骤见 [Edge 扩展说明](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/blob/edge-v1.0.2/extensions/edge/README.md)。

本版本内置舰船素材，无需登录，常用配置和自定义图库保存在本机。日常生成及表格批量导出均在浏览器本地完成；初次下载安装包仍需流量，数据不会跨设备同步。

此前已通过浏览器检查 PNG 导出、CSV/XLSX 导入、ZIP 下载和配置保存重开恢复。尚未在真实 Edge 中试装，尚未通过商店审核，也尚未上架 Edge Add-ons 商店。打包结构修复不代表审核成功。

## 1.0.1 历史修复

修复商店因根目录与图库目录各有一份 `manifest.json` 拒绝上传的问题：扩展图库清单改为 `assets/ships/catalog.json`，ZIP 根目录只保留唯一的 `manifest.json`，不再包裹额外扩展目录；网站清单不变。用户手动上传的 1.0.1 包已通过商店包验证，但不代表审核或上架完成。

## 1.0.0 历史版本

首个完全离线版本，内置 256 张原图、256 张缩略图及本机配置。其安装包不符合商店上传检查，不要继续上传；请使用当前 1.0.2 版本。历史源码与发布记录保留。

## 维护与重新发布

仓库提供 **Publish Edge offline extension** 工作流：在 GitHub 的 Actions 页面选择它，点击「Run workflow」，填写与扩展清单版本一致的标签（例如 `edge-v1.0.2`）。它会在 GitHub 的标准 Ubuntu runner 上安装依赖、运行网页及离线测试、构建完整扩展，上传 ZIP 和 SHA-256 文件并验证后公开发行版。无需从本机重新上传整包图片，也不需要配置个人访问令牌或上传服务器凭据。

工作流仅允许手动触发，使用当次运行的仓库令牌写入发行版；不会改动网站部署。已公开的同名版本不会被覆盖；草稿若存在未完成的附件，需要先检查并清理该次失败上传，再重新运行。

在仓库根目录安装依赖并验证：

```sh
npm ci
npm test
npm run test:edge
npm run build:edge
```

`build:edge` 输出 `dist/edge/`；若目录已存在，会拒绝覆盖，请先改名保留旧输出再构建。发布包只应包含构建后的扩展文件，不应包含运行数据库、账号、网站配置、`node_modules/` 或部署凭据。

为新版本使用新的 `edge-vX.Y.Z` 标签，将对应的完整 ZIP 和 SHA-256 校验文件作为 Release 附件上传，并同步更新下载入口与版本说明。不要把约 267 MB 的安装 ZIP 提交到 Git 历史；源码和共享素材留在仓库，安装包放在 Release 附件中。

更新本机扩展时应保持原安装目录和扩展 ID，在 `edge://extensions` 中重新加载，不应先卸载。详见 [保留配置的方法](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/blob/edge-v1.0.2/extensions/edge/README.md#更新时保留配置)。

自有代码采用 AGPL-3.0-only；官方舰船图片及缩略图另见 [素材权利说明](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/blob/edge-v1.0.2/ASSET_LICENSE.md)，第三方组件另见 [第三方许可](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create/blob/edge-v1.0.2/THIRD_PARTY_NOTICES.md)。发布新版本时仍需保留这些声明。
