# MoveCar · 呼叫车主挪车

把一个网页地址印成车内二维码，路人扫码后即可给车主留言、补充现场照片；配置语音功能后，还可以发起匿名网络通话。车主可以通过 Android APP 接收提醒、查看并确认挪车请求。项目包含网页管理后台、原生 Android 车主端、SQLite 数据库和自部署更新工具。

这份教程以 **一台全新的 Ubuntu 24.04/22.04 服务器 + 一个域名 + 一部 Android 手机** 为例。已有 1Panel、Nginx 或其他反向代理时，跳过 Caddy 安装，按文中的反代目标配置即可。

> **先看 FCM 的关键限制：** 自己部署服务器并使用自己的 Firebase 项目时，必须给 Android APP 使用**同一项目**的 `google-services.json` 重新构建 APK。GitHub Releases 中的公共 APK 使用本仓库发布者的 Firebase 配置；只把你自己的服务账号上传到服务器，无法让那个 APK 接收你项目的 FCM 消息。下文分别说明两份 JSON 的用途和自建 APK 的步骤。

## 完成后会得到什么

| 地址或组件 | 用途 |
| --- | --- |
| `https://car.example.com/` | 印在二维码里的挪车页面。 |
| `https://car.example.com/admin` | 管理后台和首次部署向导。 |
| `turn.example.com` | 匿名语音使用的 TURN 主机名；它**不是**网站，不做 HTTP 反向代理。 |
| Android 车主 APP | 登录后台账号，绑定一部手机的 FCM，接收留言和来电。 |

网页留言与语音是两条不同的路径。FCM 用于把留言或来电提醒送到 Android 手机；语音接通后，媒体流还需要 TURN 网络。后台的“APP 原生留言推送”开关只控制普通留言，语音来电由独立流程处理。

当前版本的首次部署向导把 **HTTPS 网站、Firebase 服务账号和 TURN 基础连通性**都列为必需检查，即使你暂时只打算使用留言，也请按下文配置这三项。

## 一、准备服务器、域名和手机

请先准备：

1. 一台有公网 IPv4 的 Ubuntu 24.04 或 22.04 VPS，能够通过 SSH 登录，服务器可以访问 GitHub、Docker 镜像源和 Google 的 OAuth/FCM 接口。
2. 一个由你管理 DNS 的域名。下面统一用 `car.example.com` 和 `turn.example.com` 举例，**执行时换成你自己的域名**。
3. 一部 Android 8.0 及以上、安装了 Google Play 服务和 Google Play 商店的手机。FCM 还要求手机网络能够连接 Google 服务；没有该条件的手机可考虑 Bark、Server酱等其他留言渠道，但本项目当前的首次部署向导仍要求配置 Firebase 服务账号。Google 对 FCM 设备条件的说明见 [Android FCM 入门](https://firebase.google.com/docs/cloud-messaging/android/get-started)。
4. 电脑上有 SSH 客户端、浏览器；如果要用自己的 Firebase 项目接收 APP 推送，还需能构建 Android APK 的电脑。

在域名 DNS 控制台添加两条 **A 记录**，都指向服务器公网 IPv4：

| 主机记录 | 记录值 | 说明 |
| --- | --- | --- |
| `car` | 服务器公网 IPv4 | 网站和后台。 |
| `turn` | 同一个公网 IPv4 | TURN 直连；如果使用 Cloudflare，应设为 **DNS only／仅 DNS**。 |

在云厂商的**安全组／防火墙入站规则**放行下表。不要把 `8888` 开放到公网；它只供服务器本机的反向代理使用。安装脚本会尝试配置常见主机防火墙，但**不会代替云厂商安全组**。

| 协议与端口 | 用途 |
| --- | --- |
| TCP `22`（或你实际使用的 SSH 端口） | 管理服务器，保持现有访问。 |
| TCP `80`、`443` | 网站 HTTPS 证书申请和访问。 |
| UDP `3478`、TCP `3478` | TURN 连接。 |
| UDP `49160–49191` | TURN 媒体中继，整段放行。 |
| TCP `5349` | 可选的 TURN TLS 备用连接。 |

DNS 生效后，可用 `nslookup car.example.com` 和 `nslookup turn.example.com` 检查解析。网站与 TURN 可以共用一台服务器和同一个 IP。

## 二、安装 Docker 和 MoveCar

先从自己的电脑运行 `ssh 你的SSH账号@服务器IP` 登录服务器。以下命令都在 **服务器 SSH 终端**执行。如果已安装 Docker Engine 和 Compose v2，先用 `sudo docker compose version` 验证，通过后直接进入“安装 MoveCar”。

### 1. 在全新 Ubuntu 上安装 Docker

使用 [Docker 官方 Ubuntu 安装方法](https://docs.docker.com/engine/install/ubuntu/)的 `apt` 仓库：

```bash
sudo apt update
sudo apt install -y ca-certificates curl git python3 openssl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker compose version
sudo docker run --rm hello-world
```

最后一条命令显示 Docker 欢迎信息即安装成功。如果遇到旧版 `docker.io`/`docker-compose` 包冲突，先按上面的 Docker 官方文档处理，不要盲目删除现有容器数据。

### 2. 安装 MoveCar

在服务器下载并执行项目的稳定版安装器：

```bash
curl -fL https://raw.githubusercontent.com/frbico/movecar/release/stable/scripts/install-universal.sh -o /tmp/movecar-install.sh
sudo bash /tmp/movecar-install.sh
```

安装器把代码放在 `/opt/movecar`，构建 `movecar` 和 `movecar-turn` 容器，生成 TURN 密钥与首次管理员密码，并注册主机更新助手。**记下终端显示的 `admin` 初始密码。** 中途失败时先看终端最后一条错误；可检查：

```bash
cd /opt/movecar
sudo docker compose -f compose.yaml -f compose.portable.yaml ps
sudo docker logs --tail=80 movecar
curl -fsS http://127.0.0.1:8888/healthz
```

健康检查正常会输出 `ok`。忘记尚未修改的初始密码，可在服务器运行 `cd /opt/movecar && sudo ./show-admin-password.sh`；修改管理员密码后，初始密码文件不再可用。

## 三、为网站配置 HTTPS

MoveCar 默认仅在服务器的 `127.0.0.1:8888` 提供 HTTP，需要由**现有或新建的 HTTPS 反向代理**对外提供网站。只选下面一种方式：

### 方式 A：新服务器使用 Caddy

确认 TCP `80/443` 没有被 1Panel、Nginx 等程序占用后，按 [Caddy 官方安装说明](https://caddyserver.com/docs/install)安装：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

运行 `sudo nano /etc/caddy/Caddyfile` 编辑配置，在全新服务器上可使用如下内容。已有其他网站时，请**增加站点块**，不要覆盖原有配置：

```caddyfile
car.example.com {
    reverse_proxy 127.0.0.1:8888
}
```

随后运行：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -fsS https://car.example.com/healthz
```

最后应输出 `ok`。Caddy 在域名解析正确且公网 TCP `80/443` 可达时，会自动申请并续期 HTTPS 证书；参见 [Caddy 反向代理说明](https://caddyserver.com/docs/quick-starts/reverse-proxy)。

### 方式 B：已有 1Panel、Nginx 或其他反向代理

在原有管理面板新建 `car.example.com` 的 HTTPS 网站，反向代理到：

- 代理安装在服务器主机上：`http://127.0.0.1:8888`。
- 1Panel OpenResty 与 MoveCar 同在自动接入的 `1panel-network`：`http://movecar:8888`。

反向代理需保留原始 `Host`，并允许至少 **12 MiB** 的请求体，以便上传现场照片。完成后同样检查 `https://car.example.com/healthz` 是否返回 `ok`。`turn.example.com` 只做 DNS A 记录，**不要**将其配置成 HTTP 网站反代。

## 四、创建 Firebase 项目：分清两份 JSON

这是自部署 FCM 最容易出错的一步。**两份文件必须来自同一个 Firebase 项目，但用途完全不同。**

| 文件 | 从哪里获取 | 放在哪里 | 是否含私钥 |
| --- | --- | --- | --- |
| `google-services.json` | Firebase 项目中注册 Android APP 后下载 | 构建电脑的 `android-owner/app/google-services.json`，编译进自己的 APK | 不含服务账号私钥，但仍不必提交到仓库。 |
| Admin SDK **服务账号 JSON** | Firebase 项目设置 → 服务账号 → 生成新的私钥 | 在 MoveCar 后台“部署与迁移”上传；服务器保存在受保护数据卷 | **包含私钥；绝不提交 GitHub 或发给别人。** |

按下面顺序操作：

1. 打开 [Firebase 控制台](https://console.firebase.google.com/)，登录 Google 账号并创建项目。记住项目 ID。Google Analytics 对本项目的基本 FCM 收发不是必需选项。
2. 在项目首页点 **添加应用 → Android**。Android 软件包名称必须填写 **`com.example.movecarvoice`**，与本仓库 `android-owner/app/build.gradle.kts` 中的 `applicationId` 完全一致，区分大小写。注册后下载 `google-services.json`，文件名不要带 `(1)` 等后缀。Firebase 官方步骤见 [将 Firebase 添加到 Android 项目](https://firebase.google.com/docs/android/setup)。
3. 在同一 Firebase 项目的 **项目设置（齿轮）→ 服务账号 → 生成新的私钥**，下载服务账号 JSON。该文件通常包含 `type: service_account`、`project_id`、`client_email`、`private_key`；它**不是** `google-services.json`。[FCM HTTP v1 官方说明](https://firebase.google.com/docs/cloud-messaging/send/v1-api)介绍了服务账号授权。
4. 核对两个文件的 `project_id` 相同：客户端文件在 `project_info.project_id`，服务账号文件在顶层 `project_id`。只需在自己的电脑检查，不要把包含 `private_key` 的 JSON 粘贴到聊天、Issue 或公开日志。
5. 在 Firebase 项目设置的 **Cloud Messaging** 页确认 FCM HTTP v1 API 可用。服务器需要出站 HTTPS 访问 `oauth2.googleapis.com` 和 `fcm.googleapis.com`；手机也需要能连接 Google 的 FCM 服务。

服务器使用服务账号换取短期 OAuth 令牌，再向 FCM HTTP v1 发送消息。Android 客户端用 `google-services.json` 获取设备的 FCM Token，登录后把 Token 交给 MoveCar 服务器。凭据与 Token 不属于同一 Firebase 项目时，服务器可能接受 APP 登录，却无法把通知送达该设备。[Firebase 错误码说明](https://firebase.google.com/docs/cloud-messaging/error-codes)也要求发送凭据与注册 Token 属于同一项目。

## 五、用自己的 Firebase 配置构建 Android APP

**使用自建 Firebase 项目时，请做这一节；只下载本项目公共 Releases APK 无法替代它。** 建议先在自己的电脑构建调试 APK，验证 FCM 全链路，再按 [Android 正式版与固定签名说明](ANDROID-RELEASES.md)制作长期使用的安装包。

1. 在电脑安装 Android Studio、JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0；命令行构建还需要 **Gradle 8.9**。本仓库目前没有提交 `gradlew` 包装器。Gradle 安装方式见 [Gradle 官方文档](https://docs.gradle.org/8.9/userguide/installation.html)。
2. 在电脑下载本项目稳定分支，并把第四节下载的**客户端**文件复制到准确位置：

   ```text
   movecar/android-owner/app/google-services.json
   ```

   在电脑终端运行下面的 Git 命令，然后用文件管理器把下载的 `google-services.json` 复制到上述路径：

   ```bash
   git clone --branch release/stable https://github.com/frbico/movecar.git
   cd movecar/android-owner
   ```

   `google-services.json` 已列入 `.gitignore`，不要强行提交。**不要**把 Admin SDK 服务账号放进 Android 项目或 APK。构建电脑也需要能访问 Google Maven 仓库下载依赖。
3. 在当前 `android-owner` 目录检查 `gradle --version` 显示 8.9，然后构建：

   ```bash
   gradle :app:assembleDebug
   ```

   成功后 APK 在 `android-owner/app/build/outputs/apk/debug/app-debug.apk`。Windows PowerShell 中使用已安装 Gradle 的 `gradle.bat :app:assembleDebug`。把 APK 传到手机，按 Android 安装提示完成安装。调试 APK 的签名仅适合个人验证；在另一台电脑重新构建可能无法直接覆盖安装。
4. 若手机上已装本仓库 Releases 的正式 APK，自己构建的调试 APK **签名不同，Android 通常会拒绝覆盖**。先记录 APP 中的服务器地址和账号，再决定是否卸载旧包并安装自建包。需要长期无缝升级时，应使用自己的固定签名密钥构建正式包，参见 [Android 发布说明](ANDROID-RELEASES.md)中的“自部署者使用自己的 Firebase 项目”一节。

APP 当前一次只保存**一部**车主手机的 FCM 绑定；新手机重新绑定会替换旧手机。APP 的“检查更新”查看本项目公共 Releases，**不会自动生成或更新你用私有 Firebase 配置构建的 APK**；不要用该入口的公共 APK 覆盖自建包。

## 六、完成后台首次部署向导

在浏览器打开 `https://car.example.com/admin`，用安装时显示的 `admin` 账号与初始密码登录。HTTPS 尚未配好时，可在**自己的电脑**执行 `ssh -L 18888:127.0.0.1:8888 你的SSH账号@服务器IP`，保持窗口打开，再访问 `http://127.0.0.1:18888/admin`；不要通过公网明文 HTTP 上传私钥。

首次登录会停在 **“部署与迁移”** 四步向导：

1. **网站与 TURN 地址：** 网站填 `https://car.example.com`（只填根地址，不带 `/admin`）；TURN 填 `turn.example.com`（不带 `https://`、端口或路径）。保存后进入下一步。
2. **Firebase 消息与来电：** 上传第四节生成的 **Admin SDK 服务账号 JSON**，不是 `google-services.json`。页面应显示 Firebase 已导入及项目 ID。后续可在“部署与迁移”更新该文件。
3. **TURN TLS：** 先测试基础 UDP/TCP 3478 即可；TLS 5349 是可选增强。若已有覆盖 `turn.example.com` 的 PEM 证书，可以选择自动查找、指定服务器证书目录，或手动上传 `fullchain.pem` 与 `privkey.pem`。证书续期后，手动上传模式需再次上传。
4. **环境检测：** 点击“重新检测”，确认必需项通过，再点击“检查合格，进入后台”。检测会核对 HTTPS、Firebase 文件、TURN DNS 和本机 TURN 鉴权分配；**云厂商安全组与真实手机网络仍需自己实测**。本机 TURN 健康检测由安装器设置的定时任务执行，刚安装后可稍等一分钟再重试。

进入后台后，先到 **“账户安全”** 修改初始密码；到 **“基本设置”** 确认网站名称、HTTPS 公网地址及可选的电话、微信号。服务端设置、记录和设备绑定保存在 Docker 的 `movecar_data` 数据卷中。

## 七、登录 APP 并验证 FCM

建议用**另一部手机**打开挪车网页，车主手机用于接收通知，这样能真正检验锁屏和网络条件。

1. 打开第五节安装的自建 APP，允许 Android 的通知权限。登录页服务器地址填 `https://car.example.com`，输入与网页后台相同的管理员账号和密码。APP 必须使用 HTTPS 根地址。
2. 登录后 APP 会尝试获取 FCM Token 并自动绑定服务器。在 APP **“设置 → 设备与服务”** 确认显示 **“FCM 消息推送已启用”**；后台“通知渠道”中的 APP 状态应为已绑定。若只显示登录成功、推送未就绪，点 **“重新绑定设备推送”**。
3. 在后台 **“通知渠道”** 保持“启用 APP 原生留言推送”，点“测试 APP 推送”；也可在 APP **“设置 → 设备与服务”** 点“发送测试通知”。锁屏后再测一次。服务器返回发送成功表示 FCM 接受请求，**不等于**系统已在手机上展示通知。
4. 用第二部手机访问 `https://car.example.com/`，提交一条真实挪车留言。车主手机应出现留言通知，点开后能看到记录并确认；扫码页面应同步显示处理状态。
5. 若要用匿名语音，再从第二部手机发起真实通话。APP 内“来电亮屏与通知权限”检查通知开关、来电渠道高优先级和全屏来电权限（Android 14 及以上尤其要检查）；测试锁屏接听和双向声音。APP 的“模拟锁屏来电”**不经过 FCM 或服务器**，只能用来检查系统来电界面权限。

普通留言通知与来电提醒使用不同的 Android 通知渠道。Android 13 及以上要允许通知运行时权限；Google 的说明见 [FCM Android 客户端文档](https://firebase.google.com/docs/cloud-messaging/android/get-started)。部分手机还需在系统里允许后台运行、关闭过严的省电限制。处于无法连接 Google 服务的网络时，APP 登录和网页打开成功也不代表 FCM 能及时到达。

### FCM 故障按顺序排查

| 现象 | 先检查什么 |
| --- | --- |
| APP 能登录，但显示“FCM 推送尚未就绪” | 手机 Google Play 服务、网络、`google-services.json` 是否是自己的项目；在“设置 → 设备与服务”点“重新绑定设备推送”。 |
| 后台显示“APP 尚未配对” | APP 是否登录并完成绑定；新手机登录会替换旧手机绑定。 |
| 测试按钮提示 Google 授权失败 | 服务器是否能访问 `oauth2.googleapis.com`；后台上传的是否为同项目 Admin SDK 服务账号；服务器时间是否正确。 |
| 测试按钮提示 FCM 发送失败 | 核对两份 JSON 的 `project_id`、Android 包名及设备重新绑定；检查项目的 FCM HTTP v1 API。 |
| 后台显示发送成功，但手机无通知 | 检查手机 Google Play 服务/VPN、系统通知权限、留言通知渠道、后台电池限制；先用 APP 实测，不要只看服务器返回值。 |
| 留言通知正常，真实来电不亮屏 | 检查来电通知渠道、全屏意图权限与锁屏设置；用 APP 的模拟来电区分系统权限与真实 FCM 链路。 |
| 来电会响，但接通后无声音 | FCM 已送达，应检查 TURN DNS、3478 和 `49160–49191/UDP`、云安全组、双方网络；参考 [语音网络说明](VOICE-NETWORK-CN.md)。 |
| 手机能打开网站，但向导显示公网 HTTPS 检测失败 | 在服务器执行 `curl -fsS https://car.example.com/healthz`，检查 DNS、反代目标和证书；部分 VPS 不支持访问自己的公网 IP，需要处理公网回环。 |

不要把 Firebase 控制台发送的普通测试通知当作本项目的完整验收；本项目发送的是带 `move_request` 或 `incoming_call` 类型的 **data 消息**，应以后台测试按钮及真实扫码流程为准。

## 八、制作二维码与日常使用

在确认公网 HTTPS、真实留言通知与确认流程都成功后，将 `https://car.example.com/` 制作成二维码并印在车内。不要把 `/admin`、服务器 IP 或 TURN 地址印成二维码。更换服务器但保持域名不变时，通常无需重新印；更换二维码中的域名时，需要重新印或保留旧域名跳转。

后台可分别启用 Bark、Server酱 Turbo、Server酱³及 APP 原生留言推送。多个启用渠道会并行尝试；密钥输入框留空表示保留原值，勾选清除才删除。挪车请求确认链接有效期为 **1 小时**；照片上传凭证有效期为 **20 分钟**，照片链接有效期为 **1 小时**。照片保留原图，可能包含 EXIF/GPS 信息，不要上传敏感内容。

## 九、更新、备份和排障

- **更新服务器：** 后台“检查更新”读取 `release/stable`，输入当前管理员密码后由主机更新助手备份并升级。升级前避开正在进行的语音通话；详见 [网页后台更新说明](WEB-UPDATE.md)。推送到 GitHub 不代表你的 VPS 已升级。
- **更新自建 Android APP：** 继续使用**同一个 Firebase 项目、相同包名和相同签名密钥**构建新版本；本仓库公共 Releases 不会携带你的 Firebase 客户端配置。签名与分发细节见 [Android 发布说明](ANDROID-RELEASES.md)。
- **查看服务状态：** 在服务器运行 `cd /opt/movecar && sudo docker compose -f compose.yaml -f compose.portable.yaml ps`、`sudo docker logs --tail=80 movecar`、`sudo bash scripts/check-portable.sh`。
- **备份与迁移：** 数据在 Compose 逻辑卷 `movecar_data`（实际 Docker 卷名可能带项目名前缀）；`docker compose down` 不删除数据卷，`docker compose down -v` 会删除。跨服务器迁移请使用 [部署与迁移说明](DEPLOY-ANYWHERE.md)中的 `scripts/export-db.sh` 和 `scripts/restore-db.sh`，不要直接在运行中的服务上复制 SQLite 文件。

## 项目结构

- `server.mjs`、`request-flow.mjs`：HTTP 服务、挪车请求、照片和后台 API。
- `mobile-owner.mjs`、`voice-service.mjs`：车主 APP API、FCM 与语音信令。
- `android-owner/`：原生 Android 车主 APP。
- `scripts/`、`deployment/`：安装、更新、证书、备份及 TURN 配置。
- `tests/`：服务端自动测试。

## 致谢与许可

感谢 [lesnolie/movecar](https://github.com/lesnolie/movecar) 提供挪车页面与 Worker 实现，为本项目的页面交互提供基础。相关源码在安装时下载至 `upstream/`，其许可见下载后的 `upstream/LICENSE`。

本仓库新增代码采用 [MIT License](LICENSE)；第三方代码和依赖遵循各自许可证。
