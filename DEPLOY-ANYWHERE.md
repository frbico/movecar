# MoveCar · 通用一键安装与后台部署向导

**目标：在任何有 Docker Engine + Docker Compose v2 的 Linux VPS 上，零配置命令安装；域名、Firebase、证书在管理员后台填写。** 不要求 1Panel，不自带第二个 Caddy/ACME，也不接管你自己的网站证书系统。

## 1. 安装（无需输入参数）

SSH 登录新服务器，确保 Docker Compose v2、Git、Curl、Python3、OpenSSL 已安装。执行：

```bash
curl -fsSL https://raw.githubusercontent.com/frbico/movecar/feature/universal-setup-wizard/scripts/install-universal.sh | sudo bash
```

该命令会从 GitHub 下载项目到 `/opt/movecar`，随机生成 TURN 长密钥和语音配对码，自动检测 VPS 公网/内网 IP、启动 `movecar` 与 `movecar-turn`，在 UFW 已启用的情况下开放 TURN 必要端口；生成的密钥和私钥不会上传 GitHub，已有账号数据库和数据卷保留。

安装**不需要**输入域名、服务器地区、1Panel 路径、Firebase 私钥、证书或管理员密码。已有 Docker Compose 安装可重新执行同一命令更新，但不会覆盖本地已修改的受 Git 跟踪文件。

## 2. 首次打开后台

若当前还没有 HTTPS 域名反代，在自己的电脑建立 SSH 隧道：

```bash
ssh -L 8888:127.0.0.1:8888 你的SSH账号@服务器IP
```

然后浏览器打开 `http://127.0.0.1:8888/admin`。安装结束输出初始管理员账号和随机密码（若是迁移数据库则使用原账号）。

**不要**直接开放 `8888` 公网访问端口，不要从公共 HTTP 传送 Firebase 私钥、TLS 私钥或管理员密码。

登录后进入左侧 **部署与迁移**，依次填写：
1. 网站 HTTPS 地址（例如 `https://movecar.ssxi.de`）和 TURN 域名（例如 `turn.ssxi.de`，只填主机名，不填协议/端口）。TURN 域名必须在 DNS 中以 **DNS only** 指向本 VPS 公网 IP；
2. Firebase Admin SDK `firebase-service-account.json`（本地选文件），由后台保存到受保护 Docker 数据卷；Android APP 本身仍需要已经通过 Firebase 编译的版本；
3. **可选但推荐**：网站证书管理器已经签发的 `fullchain.pem` 与 `privkey.pem`（本地选文件）。它必须匹配 TURN 域名。上传后自动启用 TURN TLS 5349 并重载 coturn，不需要 SSH 命令。不上传也能使用 TURN UDP/TCP 3478；受限网络下连接稳定性可能低些。

注：本方案不接管第三方证书的**自动续期**，因此如果你使用 1Panel、Nginx 或 Caddy 的自动续期，**当证书更新时仍要在后台重新上传新的 PEM 文件**，否则 TURN TLS 最终会因证书到期失败。未来可以实现特定证书管理器的可选只读自动同步插件，而不把它作为安装前置条件。

## 3. 给现有网站反向代理

现在只需在你自己喜欢的 HTTPS 反向代理里配一个站点：
- 主机环境 Nginx/Caddy/OpenResty：`http://127.0.0.1:8888`；
- 1Panel OpenResty 已连接 `1panel-network`：`http://movecar:8888`，安装时如果发现该网络会自动把 MoveCar 接进去；
- 使用其他 Docker 网络的代理：按自己的 Docker 网络把 MoveCar 连接到代理所在网络，再以容器名和 8888 端口反代。

保证 Web 服务器向后端保留真实 `Host`，通过公网 HTTPS 访问 `/admin`，否则后台可能拒绝跨来源管理员登录。

**TURN 不属于普通 HTTP 服务**：TURN 的 DNS 域名无需添加“网站反向代理”。域名解析后它直接在 3478 UDP/TCP、5349 TCP/TLS 收包及提供 UDP 媒体中继。网站与 TURN 域名可在同一公网 IP 上共存。

必须在 VPS 云安全组 / 服务器防火墙允许：
- `3478 UDP + TCP`；
- `49160–49191 UDP` 中继端口；
- `5349 TCP` 只在启用 TLS 时需要；
- 网站的 `443 TCP` 依然由现有反代使用。

Docker TURN 使用 Linux host 网络以减少 UDP 中继 NAT 转发。项目默认使用有效期限一小时的 HMAC 临时凭据，避免开放匿名中继。

## 4. 检查运行状态

```bash
cd /opt/movecar
sudo docker compose -f compose.yaml -f compose.portable.yaml ps
sudo bash scripts/check-portable.sh
```

网页版后台「部署与迁移」可核对网站地址、FCM 已导入、TURN 已配置及 TLS 已启用状态。这些只是服务端状态，**不等于**验证了从中国大陆到香港的实际链路。

大陆三星手机需要自己的 VPN 客户端让 Google Play 服务/FCM 走代理；MoveCar HTTPS 与 TURN 走 DIRECT 的规则取决于 VPN 客户端能否分流。手机 APP 在设置里可以更换服务器域名，重新登录即可。

## 5. 换服务器 / 换域名

新服务器继续运行**同一条安装命令**，在后台填写新的域名即可，不需要重写代码或重新打 APK。

如果还需要原账号、通知密钥、记录和手机 FCM 绑定：在旧服务器用 `scripts/export-db.sh` 导出一致性的 SQLite 备份，再通过 SCP/SFTP 安全传输到新服务器。新服务器完成一键安装后执行 `sudo bash /opt/movecar/scripts/restore-db.sh /安全路径/movecar-transfer.sqlite`；脚本会先备份新服务器现有数据库，停止服务、校验文件并导入，失败则尝试自动恢复本机备份。这个操作属于高风险的**数据库整体替换**，故不会放在普通网页配置按钮中，以防误删数据。Firebase 服务账号 JSON 可以在新后台重新上传，TLS 证书同理。正式切 DNS 前完成香港机的连通性、晚高峰和快速重拨测试。

如果更换印在二维码中的域名，需要保持旧域名跳转到新域名或重新打印二维码；只更换 VPS、仍使用旧域名，不需要重新打印。

## 6. 目标质量

- 中国大陆扫码者无需 VPN，浏览器直接访问 HTTPS；
- FCM 来电经车主三星已启用的 VPN；
- WebRTC 优先直连，失败经距离较近的香港 TURN UDP，必要时 TCP/TLS；
- 建连超时/ICE 失败释放占线、允许有限的即时重拨；
- 使用网页端连接路径、RTT，以及移动 / 联通 / 电信网络实测数据比较香港和东京线路。

**未知运营商网络阻断、VPN 分流限制、真实公网端口和云安全组无法由单个 Docker 安装脚本完全控制。**
