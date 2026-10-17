# MoveCar 中国大陆网络优化（当前推荐：1Panel 香港单机）

**最新通用安装入口：[DEPLOY-ANYWHERE.md](DEPLOY-ANYWHERE.md)。** 项目已改为与服务器地区、1Panel、Nginx 和 Caddy 解耦的一键安装。网站 HTTPS、TURN 域名、Firebase 和证书统一在网页登录后台的「部署与迁移」页面设置；本文件后面的两地网络拓扑只是可选优化方案，不是安装前置条件。


目标：**Google FCM 继续通过 VPN 收到来电**，网页和 Android WebRTC 尽量直连；无法 P2P 时，经香港/东京 **TURN 中继**。**不保证绕过所有网络限制或永远成功**，需跨运营商和晚高峰真机验证。

## 一、推荐网络拓扑

```
中国大陆扫码用户（HTTPS/Chrome）----+---- 香港/东京 MoveCar API (HTTPS 信令)
                                   |
                                   +--- WebRTC 直连（两边的 NAT/防火墙允许时）
                                   |     或
                                   +--- 香港 TURN [3478 UDP/TCP, 443 TLS/TCP]
                                         |
三星 S24 Ultra 中国大陆（VPN 承载 FCM）---+
   FCM / Google Play 服务 ---- VPN/代理 ---- Google FCM
   APP API 域名、TURN 域名 ---- VPN 客户端 DIRECT 策略（如支持）
```

**注意**：域名分流能控制 MoveCar HTTP 信令和 TURN；真正 P2P 的远端候选是 IP 地址，不能只靠域名规则控制。可使用支持 IP/GEOIP 分流的 VPN 客户端做进一步测试。VPN 软件不支持细分策略时，不要盲目把整个 APP 排除在 VPN 外。Android `VpnService.Builder.allowBypass` 是否允许绕过，取决于 VPN 客户端本身。

## 二、部署 TURN：香港优先，东京备用

先保留现有 HTTPS API 在东京，**单独**增加一台香港小型服务器用作 TURN；不要先迁移整个业务和 Firebase 账号。TURN 若要使用 TCP/TLS 443，应采用独立公网 IP，或者确保目标机器没有 Caddy/Nginx 占用该端口。

- 新增 DNS-only 记录：`turn-hk.example.com` → 香港 TURN 公网 IPv4；`turn-tokyo.example.com` → 东京 TURN IPv4。
- 不要在通常的 Cloudflare HTTP 代理（橙云）后面挂 STUN/TURN。它们不是普通 HTTPS 服务。
- 服务器开放 **3478/udp、3478/tcp、443/tcp、49160–49260/udp**，以及供应商的云安全组相应规则。放行出口流量。可按并发规模适当扩大 UDP 中继端口范围。
- TLS 使用和 TURN 域名匹配的有效证书（cert / pkey）。TURN TLS 不是 HTTPS 反向代理路径，**不要**直接在 Caddy 中添加一条 HTTP `reverse_proxy` 来替代 TURN。
- 配置 `use-auth-secret`、`static-auth-secret`，确保与主应用 `VOICE_TURN_SHARED_SECRET` 字节完全一致；两个地区 TURN 使用同一个密钥，才能接收同一批短期动态凭据。私钥不上传到仓库。
- 参考 `deployment/coturn.conf.example`。私钥、真实域名、公网 IP 均需根据服务器修改。
- 建议优先用 UDP P2P / TURN；`turns:...:443?transport=tcp` 作为丢 UDP 时的兜底路径。TURN/TCP 的延迟可能更高，但通常比连接失败更有用。

## 三、主 MoveCar 的 .env 配置示例

**下面均为占位域名，必须替换为你拥有的真实 TURN 域名。**

```dotenv
VOICE_STUN_URLS=stun:turn-hk.example.com:3478,stun:turn-tokyo.example.com:3478
VOICE_TURN_URLS=turn:turn-hk.example.com:3478?transport=udp,turn:turn-hk.example.com:3478?transport=tcp,turns:turn-hk.example.com:443?transport=tcp,turn:turn-tokyo.example.com:3478?transport=udp,turns:turn-tokyo.example.com:443?transport=tcp
VOICE_TURN_SHARED_SECRET=<在服务器生成、与两个 coturn 一致的长随机密钥>
```

**不要覆盖原 .env 已有的 Firebase / 配对码字段**，只追加/修改以上字段；配置后执行：

```bash
cd ~/movecar-voice-fresh
git fetch origin feature/voice-network-reliability
git switch --track -c feature/voice-network-reliability origin/feature/voice-network-reliability
docker compose up -d --build
docker compose exec movecar printenv VOICE_STUN_URLS
docker compose exec movecar printenv VOICE_TURN_URLS
```

如果本地分支已存在，`git switch feature/voice-network-reliability && git pull --ff-only`。**不要打印/共享 `VOICE_TURN_SHARED_SECRET`。** 不要运行 `docker compose down -v`。

## 四、VPN 路由策略

在支持域名/IP 分流的 VPN 客户端中（不同软件的语法各不相同）：

1. FCM / Google Play 服务相关流量 → VPN 代理；避免将 Google Play 服务排除在 VPN 之外。
2. `movecar.ssxi.de` 的 HTTP 信令 → `DIRECT`，前提是国内网络能够可靠访问该 HTTPS 域名。
3. `turn-hk.example.com` / `turn-tokyo.example.com` 的目标流量 → `DIRECT`。
4. 真正 P2P 远端候选是 IP 地址，若希望中国大陆公网候选直连，需要软件支持 IP/路由策略，**不能只配置域名 DIRECT 就保证 P2P 直连**。
5. VPN 设置中的强制全局代理、禁止 bypass、系统“始终开启 VPN / 阻止不使用 VPN 的连接”等机制可能覆盖上面规则。

对扫描者来说，没有 VPN；他们直接用浏览器访问 MoveCar HTTPS 并连接 TURN。让**他们**尽量直连香港 TURN，通常比经过美国等远端代理更可控。

## 五、v0.4.1 的代码变动

- `VOICE_STUN_URLS`：自行配置区域 STUN，避免依赖 Google STUN。
- `VOICE_TURN_URLS`：容纳最多 10 个 TURN 地址，配合单一短期动态 HMAC 密钥。
- Android：首次 SDP 建立前使用服务器指定 ICE，不再首先硬编码 Google STUN；短暂 ICE FAILED 持续 4 秒则报告失败并释放占线；失败信令自动排队重发。
- 扫码网页：语音建连超时改为 30 秒，信令失败重传 SDP，展示连接类型与 RTT。
- 同一呼叫如果**已接听但 ICE / 信令建连失败**，经服务端验证可申请一次性快速重拨：最多连续两次，无需等 90 秒；正常挂断/拒接仍限流，日总量 8 次不变。

## 六、验收矩阵

按以下顺序测试，分别记录工作日中午和晚上 20:00–23:00：

| 三星网络 | VPN 出口 | TURN | 期望 |
|---|---|---|---|
| 国内 Wi-Fi | 东京 | 香港 UDP+TLS | 优先 P2P；否则香港 relay |
| 国内 Wi-Fi | 香港 | 香港 UDP+TLS | 检查低延迟与稳定性 |
| 国内 Wi-Fi | 美国 | 香港 UDP+TLS | 即使振铃，媒体仍应尽量 DIRECT 香港 |
| 国内 4G/5G | 东京 | 香港 UDP+TLS | 检查蜂窝 CGNAT、网络切换 |
| 国内 4G/5G | 香港 | 香港 UDP+TLS | 晚高峰连续 10 次拨打成功率 |

每次记录 **通知到达时间、接听到可通话时长、是否选中 TURN/直连、RTT、丢包情况、失败后立即重拨能否成功**。使用网页通话页面的路径信息判别实际候选类型。

如果未选出 `relay` 候选，要检查 TURN 鉴权、TLS 证书、端口映射、公网 IP 及云安全组；光能 ping 通域名并不能证明 TURN 正常。
