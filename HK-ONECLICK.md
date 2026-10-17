# MoveCar · 1Panel 香港一键安装 / 换服务器

**最终架构：香港一台 VPS + 1Panel HTTPS / 泛域名证书 / 反向代理 + MoveCar + coturn。没有 Caddy，没有第二套证书签发。**

目标：大陆扫码者无需 VPN；三星车主 FCM 通过已有 VPN；扫码网页及 Android WebRTC 优先 P2P，失败经香港 TURN UDP、中继 TCP / TLS 5349。30 秒内建连失败时释放呼叫并支持最多两次快速重拨（软件已有相关实现）。VPN 里的 Google 与 MoveCar/TURN 分流由 VPN 客户端控制，服务端不会擅自更改手机 VPN。

## 新香港 VPS：最低操作

准备好已安装 1Panel 和 Docker Compose 的 Linux VPS，把 `turn.ssxi.de` 的 DNS A 记录设置成 **香港 VPS IP，DNS-only**。把已有 `movecar.ssxi.de` 最终指向香港（旧东京正在运行时，建议先迁移备份，然后再切 DNS）。香港安全组和 1Panel 防火墙至少开放 UDP+TCP 3478、TCP 5349（TLS 备用）、UDP 49160–49260；HTTPS 80/443 继续由 1Panel 管理。

下载项目：

```bash
git clone --branch feature/onepanel-turn-portable \
  https://github.com/frbico/movecar.git /opt/movecar
cd /opt/movecar
```

把 `firebase-service-account.json` 放在香港 VPS 的安全目录。已有泛域名证书由 1Panel 管理，**不必重新申请**；要启用 TURN/TLS 备用，第一次提供 1Panel 正在使用的证书与私钥的宿主机文件路径：

```bash
sudo bash scripts/deploy-hk.sh \
  --site movecar.ssxi.de \
  --turn turn.ssxi.de \
  --firebase-key /home/ubuntu/firebase-service-account.json \
  --tls-cert /你的1Panel证书路径/fullchain.pem \
  --tls-key /你的1Panel私钥路径/privkey.pem
```

你只需要在第一次指定 TLS 路径，以后同路径的 1Panel 自动续期会被定时同步给 coturn、发生变化才重启 TURN。**这不是第二套证书管理**。如果暂时不知道路径，可以省略最后两项，TURN UDP/TCP 3478 仍可用，但最重要的受限网络 TLS 5349 备用功能会关闭，建议后续补上。

## 1Panel 里仅需设置一次网站反向代理

1. 1Panel → 网站 → 创建或编辑 `movecar.ssxi.de` → 反向代理，**目标为下面两者之一**：
   - 如果 1Panel OpenResty 使用 host 网络：`http://127.0.0.1:8888`。
   - 如果 OpenResty 使用 `1panel-network`：`http://movecar:8888`。
   - 不确定可在服务器运行 `docker inspect -f '{{.HostConfig.NetworkMode}}' 1Panel-openresty`（先用 `docker ps` 查看实际名称）。同一 `1panel-network` 的 OpenResty 可通过 `movecar` 容器名访问。
2. 选你在 1Panel **现有的泛域名证书**启用网站 HTTPS；无需在项目里生成新证书。
3. `turn.ssxi.de` **只有 DNS 记录**，不要为它再建一个普通 HTTPS 反向代理。coturn 自己监听 3478/5349。TURN 的 TLS 证书复用同一套 1Panel 泛域名证书。

MoveCar 容器同时映射到宿主机 `127.0.0.1:8888` 并加入 `1panel-network`，避免 8888 暴露公网。可以复用现有 1Panel 站点/证书，不必删除重建。

## 一键自检

```bash
cd /opt/movecar
sudo bash scripts/check-hk.sh
```

自动检查：本地 MoveCar HTTP 和 voice/config、coturn UDP/STUN、TURN 临时 HMAC 凭据申请中继、TLS 5349（如启用），并输出容器状态。**它不会修改 1Panel 的网站配置或检查公网运营商线路**；还要实际从大陆移动/联通/电信分别测试，尤其晚高峰。

## 从东京迁往香港：保留账号、挪车数据、通知配置

东京服务器上安全导出 SQLite：

```bash
cd ~/movecar-voice-fresh
git fetch origin feature/onepanel-turn-portable
git show origin/feature/onepanel-turn-portable:scripts/export-db.sh >/tmp/export-movecar-db.sh
bash /tmp/export-movecar-db.sh ~/movecar-transfer.sqlite
```

把 `movecar-transfer.sqlite` 和 `firebase-service-account.json` 通过 SCP/SFTP 传到香港 VPS。香港**首次**运行部署脚本时带上 `--import-db`：

```bash
sudo bash scripts/deploy-hk.sh \
  --site movecar.ssxi.de --turn turn.ssxi.de \
  --firebase-key /home/ubuntu/firebase-service-account.json \
  --import-db /home/ubuntu/movecar-transfer.sqlite \
  --tls-cert /你的1Panel证书路径/fullchain.pem \
  --tls-key /你的1Panel私钥路径/privkey.pem
```

导入仅针对**尚无数据库的新 MoveCar 卷**，发现已有数据会停止，不会覆盖。迁移保留管理员登录数据、请求记录、通知配置和 FCM 设备绑定；建议手机再次登录，确认通知绑定成功。

将域名 A 记录切到香港并在 1Panel 设置反代后，打开原二维码网页、后台和 Android 车主 APP 测试。二维码如果指向**原来相同的域名**，一般不需要换打印的二维码；若更换域名，印刷二维码需改动或保留旧域名重定向。

## 以后更换服务器或域名

1. 在旧服务器通过 `scripts/export-db.sh` 导出数据库；安全转移数据库和 Firebase 私钥。
2. 新服务器克隆相同项目，部署时换 `--site`、`--turn`，加 `--import-db`，证书路径指向新 1Panel 现有证书。
3. 1Panel 新域名反代到 MoveCar；DNS A 记录指向新服务器。
4. APP v0.4.2 设置 → **更换服务器或域名**，在登录页输入新 HTTPS 地址，使用原账号密码登录。软件不需要重新打包 APK。
5. 运行 `scripts/check-hk.sh`，从大陆使用真实双端测试确认连通性。保留旧服务器直到新线路通过晚高峰测试。

**提醒：** 1Panel / 云厂商防火墙、域名 DNS 与 VPN 分流规则依然由你管理。脚本不会代替 1Panel 改网站配置，也不会用自签名证书冒充正式 TLS。
