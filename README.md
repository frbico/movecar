# MoveCar

**自部署挪车通知与车主联系系统。** 将网站链接制作成车内二维码，扫码者可以留言、补充现场照片，也可以在启用后发起匿名网络语音通话；车主通过通知或 Android App 查看请求并确认，扫码页面同步显示处理状态。项目提供 Web 管理后台、原生 Android 车主 App 和 SQLite 持久化服务。

## 功能概览

| 场景 | 能力 |
| --- | --- |
| 扫码联系 | 留言通知、电话和微信号联系、可选的匿名语音呼叫。 |
| 车主处理 | 每次请求独立的确认状态；可通过通知链接、Web 后台或 Android App 处理。 |
| 现场照片 | 首次通知成功后可补发一张 JPEG、PNG、WebP 或 HEIC/HEIF 原图，最大 10 MiB。 |
| 消息渠道 | Bark、Server酱 Turbo、Server酱³，以及基于 Firebase Cloud Messaging 的 Android App。 |
| 管理与运维 | 站点品牌、联系方式、通知渠道、挪车记录、语音规则、部署配置和服务端更新。 |

挪车请求的确认链接有效期为 **1 小时**；照片上传凭证有效期为 **20 分钟**，照片链接有效期为 **1 小时**。照片保留原始文件，可能包含 EXIF/GPS 元数据。网页挪车流程不采集位置。

## 部署

### 基础 Docker 部署

要求 Linux、Docker Engine、Docker Compose v2、Git、Bash、Curl，以及可访问 GitHub 源码下载地址的网络。

```bash
git clone https://github.com/frbico/movecar.git
cd movecar
./install.sh
```

脚本会获取页面运行所需的源码、构建容器、等待健康检查，并显示首次生成的管理员密码。默认挪车页面为 `http://服务器IP:8888/`，后台为 `http://服务器IP:8888/admin`。在服务器仓库目录可用 `./show-admin-password.sh` 再次查看初始密码；修改密码后该文件会删除。

首次进入后台后，请修改管理员密码，配置至少一个通知渠道，并填写手机能访问的 **HTTPS 公网地址**。随后用手机完成一次真实的扫码、通知和确认测试，再制作车内二维码。

### 完整部署与 HTTPS

匿名语音与 Android FCM 接收端还需要 Firebase、STUN/TURN、HTTPS 反向代理及相应网络配置。仓库提供 [通用安装与迁移指南](DEPLOY-ANYWHERE.md)，可在 Linux VPS 上安装应用及 TURN，并在后台配置域名、Firebase 服务账号和证书。基础安装无需启用语音功能；相关服务只有在配置完整后才可用。

默认 Compose 映射为 `0.0.0.0:8888` 的 HTTP 端口。对公网开放后台前，请使用 HTTPS 反向代理；同机代理可在根目录创建 `.env` 将其限制为本机访问：

```dotenv
HOST_BIND=127.0.0.1
HOST_PORT=8888
```

例如在同一主机上用 Caddy：

```caddyfile
car.example.com {
    reverse_proxy 127.0.0.1:8888
}
```

反向代理应保留原始 `Host` 头；上传照片时，请将代理请求体上限设为至少 **12 MiB**。语音通话还需独立配置 TURN 端口和中继端口，不能仅靠网站反向代理。具体端口、证书与迁移步骤见 [部署指南](DEPLOY-ANYWHERE.md)。

## Android 车主 App

正式签名 APK 从 [GitHub Releases](https://github.com/frbico/movecar/releases) 下载，文件名为 `MoveCar-Owner-vX.Y.Z.apk`，并提供 SHA-256 校验文件。App 支持挪车记录、通知渠道与站点设置、FCM 提醒、来电和通话界面，以及检查更新。服务器地址可在 App 登录时填写。

App 源码位于 `android-owner/`，构建需要 JDK 17、Android SDK 35、Gradle 8.9 和与包名 `com.example.movecarvoice` 匹配的 `google-services.json`。CI 可用占位 Firebase 配置验证编译；实际推送必须使用自己的 Firebase 配置。正式发布还需要长期保存的签名密钥，详见 [Android 发布说明](ANDROID-RELEASES.md)。

FCM 消息送达取决于手机的 Google Play 服务、通知权限、网络和系统后台策略。语音通话还需要麦克风权限，并建议在目标手机和实际网络下验证锁屏、蓝牙、重连与 TURN 中继。应用更新不会自动部署服务端代码。

## 后台配置

在 `/admin` 可以分别启停并测试 Bark、Server酱 Turbo、Server酱³和 Android App 推送。Bark 使用 HTTPS API 地址；Turbo 使用 `SCT` 开头的 SendKey；Server酱³使用 `sctp` 开头的 SendKey。已保存的密钥不会回显，输入框留空会保留原值，只有选择清除才会删除。

站点名称、图标、联系电话、微信号、通知间隔和记录保留数也可在后台设置。默认通知间隔为 **60 秒**，可设为 0–3600 秒；默认保留最近 **50 条**记录，可设为 1–500 条。记录被删除或超过保留上限时，关联照片会一并清理。保留条数设得过小，可能使尚待确认的旧请求提前失效。

多个启用的通知渠道可同时发送；至少一个渠道成功时请求即成立。服务端接受推送不代表手机已展示通知，正式使用前请在锁屏状态做端到端测试。电话联系按钮会在请求发出 **60 秒后且车主尚未确认时**开放；微信联系按钮复制后台设置的微信号。

## 数据、安全与更新

设置、账号、设备绑定和挪车记录保存在 Docker 的 `movecar_data` 命名数据卷。`docker compose down` 不会删除数据卷，`docker compose down -v` **会删除**。备份 SQLite 数据库时应先停服务或使用一致性备份；跨服务器迁移可参考 [部署指南](DEPLOY-ANYWHERE.md) 中的导出与恢复脚本。

管理员密码采用 scrypt 哈希；后台会话使用 HttpOnly Cookie，并对修改操作校验 CSRF。确认链接、照片链接及其他授权凭证均有有效期，但**持有有效链接的人仍可访问相应内容**，请不要转发或上传敏感照片。请求限流依据服务端看到的 TCP 来源 IP；统一反向代理下多位用户可能共享一个限流身份。

日常检查：

```bash
docker compose ps
docker compose logs --tail=80
curl -fsS http://127.0.0.1:8888/healthz
```

基础部署可在仓库目录运行 `git pull --ff-only` 和 `./install.sh` 更新。使用通用安装器或稳定发布通道的部署，请按 [网页后台更新说明](WEB-UPDATE.md) 操作；**`main` 分支的代码提交不会自动发布 Android APK，也不会自动更新使用 `release/stable` 的服务器**。

不用 Docker 时，Node.js 24+ 可执行 `bash scripts/fetch-upstream.sh` 后运行 `./run-linux.sh`。测试入口为 `node --test tests/*.test.mjs`；Android 工程另有 Gradle 单元测试。集成测试使用模拟通知与网络服务，不能代替真实设备验收。

## 项目结构

- `server.mjs`、`request-flow.mjs`：HTTP 服务、挪车请求、照片与后台接口。
- `mobile-owner.mjs`、`voice-service.mjs`：车主 App API、FCM 与匿名语音信令。
- `android-owner/`：原生 Android 车主 App。
- `scripts/`、`deployment/`：安装、更新、证书、备份及 TURN 配置。
- `tests/`：服务端集成测试。

## 致谢与许可

感谢 [lesnolie/movecar](https://github.com/lesnolie/movecar) 提供挪车页面与 Worker 实现，为本项目的页面交互提供基础。相关源码在安装时下载至 `upstream/`，其许可见下载后的 `upstream/LICENSE`。

本仓库新增代码采用 [MIT License](LICENSE)；第三方代码和依赖遵循各自许可证。
