# MoveCar 匿名网络语音补丁包（第二版 / 原生熄屏通话 MVP）

适用上游：`https://github.com/frbico/movecar` 的 2026-10-16 版 `main` 目录结构。

这不是已编译 APK，也不是已部署的服务：当前运行环境无法从 GitHub 克隆完整仓库、无法访问 Firebase 凭据，也没有 Android SDK。已生成可应用于原仓库的代码、Android Studio 工程和 Node 自动化测试。**本版本已将车主端换成 Android 原生 WebRTC + microphone 前台服务，扫码者仍使用网页 WebRTC。通话中可以主动熄屏、返回桌面，但仍需三星真机与 Firebase 环境测试。** 锁屏后的音频已迁移到原生 WebRTC + microphone 前台服务；蓝牙耳机与 Android Telecom 的系统级通话整合仍待开发或实机验证。

## 1. 补丁内容

| 文件 | 用途 |
| --- | --- |
| `apply_to_movecar.py` | 将本补丁复制/挂接到原有 Node/Docker 项目，自动备份被修改的三个文件 |
| `voice-service.mjs` | 设备配对、FCM HTTP v1、匿名呼叫、防骚扰、WebRTC 信令 API、TURN 凭证生成 |
| `voice-entry.js` | 在已有挪车页面增加「网络语音呼叫车主」入口 |
| `voice-page.html` / `voice-page.js` | 扫码者浏览器以及三星 APP 原生 WebRTC 的双向语音通话界面 |
| `android-owner/` | Kotlin Android Studio 源码；FCM 来电 + 接听/拒接 + 原生 WebRTC + microphone 前台服务 |
| `tests/voice-service.test.mjs` | Node 接口与权限自动化测试 |

**没有替换原来的挪车通知、照片、微信、管理后台和 SQLite 记录功能**。语音设备注册只在 SQLite 中保存单个车主设备；活跃通话在 Node 内存中保存，容器重启会结束通话。

## 2. 将补丁应用到现有服务器项目

在自己的 Linux / Mac / Windows Python 环境中，分别下载已有 MoveCar 源码和本补丁包。不要覆盖现有的 `data`、`.env` 或 Docker 数据卷。

```bash
cd ~/movecar
# 先保存自己已有的改动和数据备份
# 把解压出来的 movecar-voice-addon 目录放到 ~/ 下面
python3 ~/movecar-voice-addon/apply_to_movecar.py ~/movecar
```

脚本会自动备份 `server.mjs`、`Dockerfile`、`compose.yaml` 到 `~/movecar/.voice-backups/<时间>/`，然后新增文件、把语音路由接入主服务器，并给 Docker Compose 增加四个环境变量。它会核验关键上游锚点；如果上游源码变化，脚本会拒绝盲目修改。

补丁可以单独复制进 **当前已有的仓库**，不要在原项目目录之外直接运行 `docker compose up`。

## 3. 创建 Firebase 项目（免费的基础 FCM 推送）

1. 到 <https://console.firebase.google.com/> 创建 Firebase 项目。
2. 添加 Android 应用，**包名填写 `com.example.movecarvoice`**（需要自定义包名时，先同步修改 Android Studio 工程）。
3. 下载 `google-services.json`，仅放在：`android-owner/app/google-services.json`。本压缩包不会包含它。
4. Firebase → 项目设置 → 服务账号 → 生成新的私钥，得到 Firebase 服务账号 JSON；确认项目的 FCM HTTP v1 API 已启用。**服务账号私钥只放服务器，不能打包到 APK，也不能提交 GitHub。**

## 4. 配置 Docker 服务器

为生产环境配好公网 HTTPS 域名。例如 Caddy：

```caddy
car.example.com {
    reverse_proxy 127.0.0.1:8888
}
```

在 MoveCar 后台的「公网访问地址」填写 `https://car.example.com`。浏览器麦克风需要 HTTPS；配对码也不能在明文 HTTP 下发送。若原来 `8888` 直接对公网开放，建议在 `.env` 追加 `HOST_BIND=127.0.0.1` 并使用 HTTPS 反向代理。

进入原 MoveCar 项目，编辑 **原有** `.env` 文件，添加（不要删除已有变量）：

```dotenv
VOICE_PAIRING_SECRET=替换成至少32个随机字符的私密配对码
# 初期可只用 STUN 测试两端通话；某些网络无法直连时必须配置 TURN
VOICE_TURN_URLS=
VOICE_TURN_SHARED_SECRET=
```

可用 `openssl rand -hex 32` 生成随机配对码。不要使用上面的中文占位符。`FCM_SERVICE_ACCOUNT` 在 Compose 中固定为容器内 `/app/data/firebase-service-account.json`。

重新构建并启动：

```bash
docker compose up -d --build
# 把 Firebase 服务账号私钥复制到项目当前持久化数据卷中的文件路径
docker cp /你的安全目录/firebase-service-account.json movecar:/app/data/firebase-service-account.json
docker exec -u root movecar sh -c 'chown node:node /app/data/firebase-service-account.json && chmod 600 /app/data/firebase-service-account.json'
docker compose restart
```

`docker cp` 的原始私钥请妥善保存，并避免复制到版本控制目录。不要运行 `docker compose down -v`，否则会删除已有数据卷。

检查接口：

```bash
curl https://car.example.com/api/voice/config
```

尚未配对时应返回 `{"enabled":true,"ready":false}`；手机完成配对后应变成 `{"enabled":true,"ready":true}`。如果 `enabled:false`，先检查 Compose 是否真正读取到了 `VOICE_PAIRING_SECRET`。

## 5. 在三星 S24 Ultra 构建和安装 APK

1. 用 Android Studio 打开补丁里的 `android-owner` 目录。
2. 按第 3 节放入 `app/google-services.json`；同步 Gradle（需要可访问 Google Maven / Maven Central）。
3. 使用 **Build > Build APK(s)** 构建 debug APK，或者连接手机点击 Run。
4. 在三星手机上允许安装此 APK、允许通知和麦克风权限，并检查「特殊应用权限 → 全屏提醒 / 全屏通知」是否允许（不同 One UI 版本名称可能不同）。
5. 打开 APP，填入网站 HTTPS 地址和 `.env` 中的 `VOICE_PAIRING_SECRET`，点击「配对并启用来电」。
6. 配对成功后，服务器会保存这部手机的 FCM Token。若重新配对，新设备会替换旧设备。

**要求手机有正常运行的 Google Play 服务、能够访问 FCM，且通知权限未被禁止。** APK 不需要提交 Google Play 商店。

## 6. 测试扫码电话

在另一部手机上打开你的二维码网址：

- 页面会在检测到已启用语音服务且有车主设备时，显示「网络语音呼叫车主」。
- 点击后进入语音页，允许浏览器使用麦克风。
- 服务器会通过 FCM 高优先级数据消息尝试唤起三星手机的来电通知。
- 三星上点击「接听」，APP 启动原生 WebRTC microphone 前台服务，并与网页交换 WebRTC SDP/ICE 后开始双向通话。
- 任意一方点击「挂断」可结束通话。

建议依次测试：APP 前台、APP 后台、三星锁屏、从最近任务划掉 APP、不同网络（Wi-Fi 对蜂窝）。手动在系统设置点击「强行停止」后不能保证收到 FCM。FCM 不能保证每次实时送达。

## 7. 不同网络无法通话：部署 TURN

WebRTC 默认使用 `stun:stun.l.google.com:19302` 尝试 P2P。扫码人使用移动流量、车主使用家庭网络时，部分 NAT / 防火墙组合需要 TURN 中继。建议在已有 VPS 上配置 coturn，使用 **共享密钥临时凭据**：

```ini
# coturn 示例片段（并非完整生产配置）
realm=turn.example.com
fingerprint
use-auth-secret
static-auth-secret=请用新的超长随机字符串
listening-port=3478
min-port=49160
max-port=49200
```

需要开放 TURN UDP/TCP 端口和中继端口，并正确设置公网 IP / NAT。然后在 `.env` 中追加：

```dotenv
VOICE_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
VOICE_TURN_SHARED_SECRET=与coturn的static-auth-secret完全相同
```

服务端根据共享密钥为每次页面请求生成 1 小时有效的 TURN 用户名、密码，避免在网页里长期暴露固定账户。正式部署建议限制带宽和并发、监控 coturn 滥用，TURN 软件免费但 VPS 流量可能收费。

## 8. 防骚扰、安全和当前限制

- 1 名车主 / 1 个设备；同时仅允许 1 个响铃或通话会话。
- 同一个服务端看到的 IP 90 秒内只允许创建一次呼叫、24 小时最多 8 次（反向代理后共享 IP 的用户可能彼此影响）。还没有验证码、黑名单和设备多账户功能。
- 未接听约 35 秒超时；单次通话最长 10 分钟。
- 呼叫、接听与信令使用不同的 256-bit 随机凭证，服务端校验发送方，网页不暴露电话号码。
- WebRTC 音频使用 DTLS-SRTP，优先端到端直连；TURN 中继转发加密媒体。
- 本次 MVP 实现“锁屏来电通知”和“**接听后原生 WebRTC 双向说话，支持熄屏持续通话**”，尚未实现系统 Telecom/ConnectionService 的完整电话整合与所有蓝牙路线的真机兼容性，但已有原生 WebRTC、mic 前台服务与听筒/扬声器控制。Android 全屏弹窗需要 Android 14+ 对应的特殊授权，系统也可能只展示横幅通知。
- Node 内存中保存的通话会话在服务进程重启时失效；不保证强制停止 APP、断网、Google 服务不可用时仍可响铃。
- 初次正式使用前建议增加验证码/人工验证、全站防爬与反向代理层限流；开放二维码意味着路人可呼叫。
- **不要把 Firebase 服务账号、Android `google-services.json`、配对码或设备授权 token 上传到公共仓库。**

## 9. 已完成的本地测试 / 还没验证的项目

- 语音服务 Node.js 语法检查通过。
- `node --test tests/voice-service.test.mjs`：通过「配对→呼叫→接听→SDP 双向交换→挂断」以及「无效身份、速率限制、超时与拒绝」。
- 补丁脚本已通过模拟仓库的锚点替换及语法检查。
- **未完成**：无法在当前容器内获取完整原仓库并运行其原有测试；没有 Android SDK、用户的 Firebase JSON 或三星真机，因此尚未构建 APK、验证真实 FCM 投递与实机 WebRTC 音频。

本版已经以原生 WebRTC SDK 和麦克风前台服务替换车主 WebView 音频；尚未在三星真机验证，不保证所有系统设置、蓝牙设备或网络情形都不中断。


## v0.2 熄屏通话升级说明

- 车主收到 FCM 后先响铃；用户在 IncomingCallActivity **点击接听**，授权麦克风后才启动 `OngoingCallService`，满足 Android 14+ 的 while-in-use 约束。
- Android 原生 `org.webrtc` 音频轨道、SDP/ICE 信令轮询均保存在 `OngoingCallService`。锁屏、离开 Activity 不会销毁连接。
- 接听后的常驻通知可返回通话页或挂断；通话页支持听筒/免提切换（蓝牙路由以系统当前可用路由为主）。
- 本阶段没有集成自管理 Telecom 电话账户、通话等待、音频焦点抢占后的重建、网络切换后的 ICE 重启、进程被强杀后的通话续接；这些应作为后续增强。
- 注意：Android 版本的 `FOREGROUND_SERVICE_MICROPHONE` 和 `RECORD_AUDIO` 必须具备，前台服务在用户接听后从可见 Activity 启动。
- Android 工程依赖 `io.github.webrtc-sdk:android:150.7871.01`（Maven Central）。构建需 Android Studio 联网同步依赖；本环境没有 SDK，源码未实机编译验证。

## 10. 仅使用 GitHub Actions 构建真正可安装的调试 APK

此分支额外包含两个 Actions 工作流：

- `Android debug APK`：每次修改 Android 工程自动编译。它使用假的 Firebase 占位配置，仅用于检查**能否编译**，生成的 APK **无法实际收到来电**。
- `Build configured MoveCar owner APK`：手动运行，从 GitHub Actions Secret 读取你真实的 `google-services.json`，编译并在 Action Artifacts 里提供可安装的调试 APK。**该流程不需要本地 Android Studio**。

手动构建准备步骤：

1. 用 Firebase 控制台添加包名 `com.example.movecarvoice` 的 Android APP，下载 `google-services.json`。
2. 在本地终端将文件转换为单行 Base64：`base64 -w 0 google-services.json`（macOS 使用 `base64 < google-services.json | tr -d '\\n'`）。不想用命令行也可用本机离线 Base64 工具处理；不要把配置贴到公开聊天或 issue。
3. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，名称填 `MOVECAR_GOOGLE_SERVICES_JSON_B64`，值为上一步整行 Base64。**不要**把 Firebase 的服务器端私钥上传到 Actions Secret 作为 Android 配置。
4. GitHub Actions → `Build configured MoveCar owner APK` → Run workflow，在 `feature/native-screen-off-voip` 分支运行。完成后从运行结果的 Artifacts 下载 `movecar-owner-configured-debug-apk`。
5. 该构建产生的 debug APK 由 GitHub 临时签名，重新构建可能因签名变化需要卸载旧版本。要稳定升级应使用私有、持久化的 release 签名。

`main` 分支未合并前，请在开发分支上运行手动构建。以上过程仍不等于真机验证，需按第 6 节亲自测试锁屏、移动数据及通话超时。
