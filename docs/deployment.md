# 公网部署示例

本示例使用 Linux、Node.js 24、systemd 和 Nginx。配置文件是手工安装模板，不会自动改动服务器。部署到已有服务器时，先检查现有服务、端口及配置，使用独立站点配置和数据目录。

## 安装与初始化

创建专用服务用户 `wb-image-generator`，将源码放在 `/opt/wb-image-generator`，数据放在 `/var/lib/wb-image-generator`。程序无需写入源码目录；服务用户需要读取源码并读写数据目录。

在源码目录执行 `npm ci`。将 `.env.example` 复制到 `/etc/wb-image-generator.env`，由 root 管理，只允许 root 和专用服务账号读取（例如属主 `root:wb-image-generator`、权限 `640`），并按实际情况填写：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=4173
DATA_DIR=/var/lib/wb-image-generator
COOKIE_SECURE=true
APP_PASSWORD=请替换为至少12个字符的独立随机口令
```

`APP_PASSWORD` 是隐藏维护入口 `/owner` 的站点口令，不是普通用户密码。不要使用示例文字、提交到 Git，或公开分发这份环境文件。

以服务账号并使用同一个环境文件初始化图库：

```sh
node --env-file=/etc/wb-image-generator.env scripts/seed-catalog.mjs
```

将 [systemd 模板](../deploy/wb-image-generator.service)安装到 `/etc/systemd/system/`，核实 Node.js 可执行文件路径、服务用户、目录和环境文件。启动前运行 `node --check server.mjs` 与 `npm test`。随后加载并启动服务：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now wb-image-generator
```

模板假定 Node.js 位于 `/usr/bin/node`；使用其他安装方式时需修改 `ExecStart`。

## HTTPS 与反向代理

为自己的域名配置 DNS 并取得有效的 TLS 证书。将 [Nginx 模板](../deploy/nginx.conf)中的 `example.com` 和证书路径替换为真实值。**不要用这个文件整体覆盖已有 Nginx 主配置。**它只应作为新增站点纳入现有配置。

模板将 HTTPS 请求代理到 `127.0.0.1:4173`，保留原始 Host，并由本机代理重设 `X-Real-IP`。应用应始终只监听回环地址，避免公网客户端绕过代理伪造该头。检查 `nginx -t` 通过后再重新加载 Nginx。

生产模式下普通账号注册和登录需要 `COOKIE_SECURE=true`；浏览器只有通过 HTTPS 才会发送 Secure Cookie。不要关闭这一项来解决 HTTP 无法登录的问题。

## 管理员与账号

完成 HTTPS 后，可在 `/owner` 使用独立站点口令登录。用户先在首页注册邮箱账号，再由管理员按邮箱授予管理权限；管理员维护入口不显示在普通账号界面。不要将站点口令分享给普通用户。

可选的 `scripts/create-initial-admin.mjs` 从标准输入读取单行 JSON，在尚无账号管理员时初始化一个管理员；它需要站点已创建账号数据表，且要求该初始密码为 10–128 个字符。它不替换已注册用户的密码。普通网页注册的密码要求为 8–128 个字符。若使用该脚本，应通过受保护的交互输入，不要把密码放到命令行、Git 或日志中。

邮箱注册不验证邮箱归属，也未配置找回密码邮件服务。账号会话在服务重启后失效；配置和账号数据保留在 SQLite 中。

## 验证与更新

```sh
curl --fail http://127.0.0.1:4173/health
sudo systemctl status wb-image-generator
sudo journalctl -u wb-image-generator -n 50 --no-pager
```

还需在浏览器确认 HTTPS 登录、角色权限、图库缩略图、选中原图与导出、保存配置和留言都可用。健康检查通过只说明服务和数据库可访问。

更新前按[维护说明](maintenance.md)备份。修改后运行相关测试、重启应用，检查接口、页面与日志；不需要改动其他站点或服务。

## 网络服务的源码链接

上游源码位于 [xuewuyouyue/StarCitizen-upgrade-image-create](https://github.com/xuewuyouyue/StarCitizen-upgrade-image-create)。将实际运行版本的完整对应源码放到用户可访问的位置，并在网站可见位置添加“源代码”链接；未修改部署可链接到上游相应提交或版本，自行修改部署则应链接到包含实际变更的对应版本。程序的 AGPL 义务不包含授予官方舰船图片再分发许可，另见 [ASSET_LICENSE.md](../ASSET_LICENSE.md)。
