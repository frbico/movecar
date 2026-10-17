# 🇭🇰 MoveCar + coturn 香港单机一键部署

此方案与 [PR #12](https://github.com/frbico/movecar/pull/12) 的 VPN/网络优化配套。运行 `scripts/deploy-hk.sh`，会在 **同一台香港 Ubuntu/Debian VPS** 部署：

- MoveCar：Docker / SQLite，内部 **127.0.0.1:8888**；
- Caddy：主机网络，公开 **TCP 80/443**，代理 `https://movecar.ssxi.de` → MoveCar；
- coturn：主机网络，公开 **3478 UDP/TCP + 5349 TCP + 49160–49260 UDP 中继端口**；
- Caddy 同时为 `turn.ssxi.de` 申请证书（该域名的 HTTPS :443 仅返回说明文本），自动同步给 coturn TLS :5349；
- systemd 定时任务每 6 小时检查并同步续期证书，有变化才重启 coturn；
- 共用一个短期 TURN REST 密钥，由 MoveCar 动态签发 HMAC TURN 凭据，密钥不发送给浏览器或 APK；
- 最后自检 HTTPS / STUN / TURN Allocate / TURN TLS。

**注意：TURN 不通过普通 HTTP 反向代理。** 虽然两个域名可以指向同一个 IPv4，只有 MoveCar 网站使用 Caddy `reverse_proxy`。TURN 是独立的 UDP/TCP/TLS 服务。Caddy 为 TURN 域名申请证书并不意味着 TURN 数据经过 Caddy 443。

## 一、必须事先完成的三件事

1. 有一台 **香港 Ubuntu/Debian VPS**，公网 IPv4，Docker Engine + Compose v2。没有 Docker 时请先根据 Docker 官方文档安装，脚本不会自行运行不受审查的安装器。
2. DNS A 记录：
   - `movecar.ssxi.de` → 香港 VPS IP（网站可以使用 CDN，但第一轮建议直连）；
   - `turn.ssxi.de` → 同一个香港公网 IP，必须 DNS-only，不能用普通 Cloudflare 橙云 HTTP 代理。
3. 服务器提供 Firebase Admin SDK 私钥 `firebase-service-account.json`，**不要上传 GitHub**。现有东京数据库如需迁移，另外准备使用 SQLite backup 命令导出的 `state.sqlite`；新服务器无法凭空获得东京服务器数据。

云控制台安全组/防火墙必须放行：

| 端口 | 协议 | 功能 |
|---|---|---|
| 80 | TCP | Caddy ACME HTTP 验证与跳转 |
| 443 | TCP | MoveCar / TURN hostname 的公开 HTTPS 证书申请 |
| 3478 | UDP + TCP | STUN、TURN UDP/TCP |
| 5349 | TCP | TURN/TLS |
| 49160–49260 | UDP | TURN 媒体中继分配 |

**特别提醒：** 已经使用 80/443 的香港现有网站，不能直接用本脚本接管，脚本会停止并提示，而不是覆盖 Nginx/Caddy。可将本方案的 TURN 配置手动整合到已有代理，或者部署在一台空的香港 VPS。

## 二、第一次安装

在香港 VPS SSH 中（示例路径要替换成真实位置）：

```bash
git clone --branch feature/hk-oneclick-stack --single-branch \
  https://github.com/frbico/movecar.git /opt/movecar-hk
cd /opt/movecar-hk

sudo bash scripts/deploy-hk.sh \
  --site movecar.ssxi.de \
  --turn turn.ssxi.de \
  --firebase-key /home/ubuntu/firebase-service-account.json
```

如果你的公网 IPv4 检测失败，可追加 `--public-ip 你的公网IPv4`。

执行过程自动：
1. 核对 TURN 域名解析到本机公网 IP、端口空闲、依赖存在；
2. 保留已有 `.env` 设置、用户会话/数据库与旧 TURN 密钥，缺失时随机生成安全密钥；
3. 生成 Caddyfile 与 coturn.conf（均在 `.gitignore` 中）；
4. 视实际启用的 UFW 状态添加本机防火墙规则（**云安全组必须自行配置**）；
5. 构建/启动 MoveCar + Caddy，申请两个域名的有效证书；
6. 将 Firebase JSON 复制到 MoveCar 的数据卷，校正权限；
7. 检查两站 HTTPS，再同步 coturn TLS 证书并启动 TURN；
8. 安装 systemd TLS 同步 timer，输出状态和检测命令。

**不执行** `docker compose down -v`，也不会主动清空已有 Docker 数据卷。若目标主机已有名为 `movecar` 的其他容器，请先检查，以免 Compose 容器名冲突。

## 三、一键检查

```bash
cd /opt/movecar-hk
sudo bash scripts/check-hk.sh
```

包括：
- `https://movecar.ssxi.de/healthz`；
- `https://movecar.ssxi.de/api/voice/config`；
- `turn.ssxi.de:3478` 的 UDP STUN Binding；
- coturn REST HMAC 401 challenge 后的真实 **UDP Allocate**；
- `turn.ssxi.de:5349` 经 CA 校验的 TLS 握手和 STUN Binding。

检查成功仍不能保证中国大陆联通/移动/电信晚高峰低丢包，必须用大陆手机公网链路再进行真实通话。可以从大陆另外一台 Linux/Windows 主机运行 `python3 scripts/turn-probe.py --host turn.ssxi.de`，进一步判断 3478 UDP、5349 TLS 是否可达。

## 四、Android 客户端与 VPN

保留已经构建的 MoveCar Owner v0.4.1 网络优化 APK。手机 FCM/Google Play 服务流量继续经 VPN；当 VPN 客户端支持基于目标域名/IP 分流时：

```
DOMAIN,movecar.ssxi.de,DIRECT
DOMAIN,turn.ssxi.de,DIRECT
Google FCM / Play services -> 代理/VPN
```

以上仅表达规则意图，并非可以直接导入所有 VPN 的统一语法。P2P 的另一端 ICE 候选往往是 IP 地址，规则必须视 VPN 客户端具体能力调整；绕过 VPN 需考虑 `VpnService.allowBypass`、始终开启 VPN 等限制。

## 五、从东京迁往香港时怎样保留账号及二维码配置？

**必须复制东京数据库，不然新的香港 MoveCar 会生成新的管理员密码和新的设备注册记录。**

在东京现有 MoveCar 容器中，使用 Node SQLite 的一致性备份能力或 sqlite3 `.backup` 功能导出 `state.sqlite`（不要在 SQLite 仍写入时直接拷贝底层 DB 文件且忽略 WAL）。

准备好快照后，在香港 **第一次启动之前** 将快照恢复进 MoveCar 的持久化数据卷，并提供同一个 Firebase JSON。数据库保留了网站设置、登录账户、挪车记录和 FCM 设备绑定等信息；短期登录会话可按需要重新登录。这里没有自动跨主机复制，因为脚本不能/不应该无凭据读取你的东京服务器。

如果东京部署并未实际使用、无需保留旧数据，直接全新安装即可；新的管理员密码可用项目已有的 `show-admin-password.sh` 查询。

切换时，先备份东京数据，在香港部署并完成服务器检查，再将 `movecar.ssxi.de` DNS 切换香港。由于部分设备有 DNS 缓存，可能短暂访问旧地址。切换前建议将 TTL 降低。

## 六、维护/更新

```bash
cd /opt/movecar-hk
sudo bash scripts/check-hk.sh

# 查看进程状态
docker compose -f compose.yaml -f compose.hk.yaml ps

# 查看近期错误（不得公开包含用户信息的原始日志）
docker compose -f compose.yaml -f compose.hk.yaml logs --tail=80 coturn caddy movecar

# 查看自动续期检查
sudo systemctl status movecar-hk-turn-cert.timer
```

重新运行相同的 `deploy-hk.sh` 参数是幂等更新方式，不会重置管理员密码、Firebase/配对数据和 TURN 密钥。部署脚本不执行任何自动数据库迁移或覆写。

首次投产前强烈建议用同一张二维码分别测试：大陆无 VPN 扫码者、大陆三星 VPN 东京/香港/美国节点、Wi-Fi/4G/5G、晚高峰，以及网络失败后立即重拨。
