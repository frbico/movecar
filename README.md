# MoveCar

**自部署挪车通知系统**。将站点链接制作成车内二维码后，扫码者可发送留言；车主通过通知查看请求并确认，发起页面同步显示确认状态。项目包含 Web 管理后台、SQLite 服务和可选的 Android 接收端。

## 功能

| 模块 | 能力 |
| --- | --- |
| 挪车页面 | 扫码留言、通知车主、查看当前请求的确认状态；支持电话和微信号联系。 |
| 通知渠道 | Bark、Server酱 Turbo、Server酱³及自带 Android App；可分别启停、单独测试，也可同时发送。 |
| 车主确认 | 每次请求生成独立的限时确认链接；车主主动确认后，发起页面显示结果。 |
| 现场照片 | 通知发送成功后可补发一张 JPEG、PNG、WebP 或 HEIC/HEIF 原图，单张上限 10 MiB。 |
| 管理后台 | 管理通知渠道、站点名称与图标、联系方式、通知间隔、保留记录、已绑定 Android 设备和管理员密码。 |
| Android 接收端 | 通过 WebSocket 接收提醒、查看近期请求和照片、在 App 内确认；支持绑定多台设备。 |

新请求的确认链接有效期为 **1 小时**，照片上传凭证有效期为 **20 分钟**，照片链接有效期为 **1 小时**。照片按原文件上传，**不会自动删除 EXIF/GPS 等元数据**。系统不请求或保存挪车者的位置。

一次挪车请求的流程是：扫码者提交留言 → 服务端保存独立请求并向已启用渠道推送 → 车主通过链接或 Android App 确认 → 扫码者页面查询并显示该请求的状态。现场照片是首次通知成功后的可选补充通知。

## 快速部署

需要一台可运行 Docker Engine 和 Docker Compose 插件的 Linux 主机，安装脚本还需要 `bash`、`curl` 以及能访问 GitHub 源码下载地址的网络。首次安装会获取页面运行所需的源码；后续构建默认沿用本地副本。

```bash
git clone https://github.com/frbico/movecar.git
cd movecar
./install.sh
```

安装脚本会构建并启动容器，等待健康检查通过，然后在终端显示随机生成的初始管理员密码。默认入口：

- 挪车页面：`http://服务器IP:8888/`
- 管理后台：`http://服务器IP:8888/admin`

以后可在服务器的项目目录执行 `./show-admin-password.sh` 再次查看初始密码。修改管理员密码后，初始密码文件会被删除，此命令不再显示新密码。

首次登录 `/admin` 后，建议依次完成：

1. 在“账户安全”修改管理员密码。
2. 在“基本设置”填写手机可访问的 **HTTPS 公网访问地址**，例如 `https://car.example.com`。通知中的确认链接和照片链接会使用这个地址。
3. 在“通知渠道”配置至少一种渠道并启用，保存后使用“单独测试”或“测试全部”验证。
4. 用手机打开挪车页面，发送一条真实请求，检查通知、确认状态及可选的照片功能，再将页面链接制作成二维码。

没有可用通知渠道时，挪车页面仍能打开，但无法成功发出请求。多个渠道同时启用时，只要其中一个发送成功，请求就会创建；测试通知被服务端接受并不保证手机系统已实际展示，正式使用前请在锁屏状态验证。

### HTTPS 与端口绑定

默认 Compose 配置将 HTTP 服务绑定到 `0.0.0.0:8888`。公网部署时，请用 HTTPS 反向代理保护管理后台，并确保反向代理保留原始 `Host` 头。若反向代理与容器在同一台主机，可在项目根目录创建 `.env`，仅让本机访问 8888 端口：

```dotenv
HOST_BIND=127.0.0.1
HOST_PORT=8888
```

然后运行 `docker compose up -d`。`.env` 仅配置 Docker 端口映射；通知密钥和站点设置在管理后台保存。Caddy 示例：

```caddyfile
car.example.com {
    reverse_proxy 127.0.0.1:8888
}
```

使用 Nginx 等代理时，照片上传请求体上限建议设为至少 **12 MiB**；启用 Android App 时还需允许 `/api/app/events` 的 WebSocket Upgrade，并给长连接足够的读取超时。浏览器相机和剪贴板功能也建议通过 HTTPS 使用。

## 管理配置

### 通知渠道

| 渠道 | 后台填写内容 | 使用说明 |
| --- | --- | --- |
| Bark | HTTPS API 地址，例如 `https://api.day.app/DeviceKey` | 面向 iOS，也支持自建 Bark 服务。 |
| Server酱 Turbo | `SCT` 开头的 SendKey | 通过该服务向微信发送通知。 |
| Server酱³ | `sctp` 开头的 SendKey | 与 Turbo 的密钥不通用。 |
| MoveCar Android App | 在“安卓设备”生成配对二维码 | 无需填写第三方推送密钥，需保持 App 与服务器的连接。 |

各渠道可以独立启停。后台不会回显已保存的密钥：输入框留空表示保留原配置，勾选“清除”才会删除。第三方渠道可能有自己的额度、设备注册和送达限制。

“基本设置”还可设置站点名称（1–40 字）、图标（PNG/JPEG/WebP/ICO，最大 256 KiB）、联系电话、微信号、通知间隔（默认 60 秒，可设为 0–3600 秒）和保留记录条数（默认 50，可设为 1–500）。联系电话会在请求发出 **60 秒后且车主尚未确认时**开放；微信按钮用于复制后台填写的微信号。

### 数据与访问控制

配置、设备绑定和挪车记录保存在 SQLite 数据库中。Docker 部署使用 `movecar_data` 命名数据卷；普通的容器重建和 `docker compose down` 不会删除它。执行 `docker compose down -v` **会删除数据卷**，升级和排障时请避免使用。

管理员会话使用 HttpOnly Cookie，管理操作校验 CSRF；初始密码随机生成并以 scrypt 哈希保存。确认链接、照片上传凭证和配对码均有有效期。**任何获得有效确认链接或照片链接的人都可能访问相应内容**，请不要转发链接或上传敏感照片。历史记录仅管理员可查看，可逐条删除或清空；超过保留上限的记录及关联照片会清理。保留条数设得过小可能使仍待确认的旧请求提前失效。

请求限流依据服务端看到的 TCP 来源 IP。若流量经过统一反向代理，多位访问者可能共享同一个限流身份。项目适用于车主自行部署的挪车场景，请根据部署环境限制后台和服务端的访问范围。

## Android 接收端

`android/` 是原生 Android 工程，要求 **JDK 17**、**Android SDK 35**。当前 `android/app/build.gradle` 中的 `BASE_URL` 固定为 `https://movecar.ssxi.de`；部署到自己的域名时，**必须先改为自己的 HTTPS 公网地址并重新构建 APK**。后台“基本设置”中的公网访问地址也应与之保持一致，否则 App 会拒绝配对链接。

构建调试包：

```bash
cd android
./gradlew :app:assembleDebug
```

发布包需要自己的签名文件。可以在仓库根目录运行 `python scripts/generate-android-signing.py` 首次生成（需要 Python 的 `cryptography` 包），然后执行：

```bash
cd android
./gradlew :app:assembleRelease
```

Windows 可使用 `gradlew.bat`。签名文件位于 `secrets/`，已被 Git 忽略；请离线备份。后续覆盖安装必须使用同一签名，生成脚本不会覆盖已有文件。

安装后，在后台“安卓设备”为每台手机分别生成二维码并扫码绑定；配对码 **5 分钟有效且只能使用一次**。手机应授予通知权限，允许后台运行，并确认 App 显示已连接。服务端使用 WebSocket 推送，同时在重连时从保留记录补取遗漏请求；手机系统结束后台进程或网络断开时，实时送达仍可能延迟。丢失手机后可在后台解绑，使原设备凭证失效。

## 运维与开发

```bash
docker compose ps
docker compose logs --tail=80
docker compose up -d --build
```

更新时在仓库目录执行 `git pull --ff-only`，然后重新运行 `./install.sh`。部署前请备份 `movecar_data`；SQLite 使用 WAL 模式，制作数据库备份时应先停止服务或使用 SQLite 的一致性备份方式。健康检查地址为 `/healthz`。

不用 Docker 时，可在 **Node.js 24+** 环境运行：

```bash
npm ci
bash scripts/fetch-upstream.sh
./run-linux.sh
```

默认监听 8888 端口，数据库位于 `./data/state.sqlite`，初始密码位于 `./data/admin-initial-password`。可通过 `PORT`、`DB_PATH`、`SOURCE_PATH` 环境变量调整服务端配置；`PUBLIC_URL` 和 `PHONE_NUMBER` 仅在数据库尚无对应设置时用于初始化。非 Docker 运行时请自行配置进程守护、HTTPS 代理和数据备份。

运行测试：

```bash
npm test
```

仓库的 CI 运行 Node 集成测试、Docker 构建与启动检查，以及 Android 调试包构建。集成测试使用模拟推送服务，不能替代真实设备的通知送达测试。

主要代码位于 `server.mjs`（HTTP 服务、后台与通知渠道）、`request-flow.mjs`（每次挪车请求的状态和照片）、`app-channel.mjs`（设备绑定与 WebSocket）、`android/`（原生接收端）和 `tests/`（集成测试）。

## 致谢与许可

感谢 [lesnolie/movecar](https://github.com/lesnolie/movecar) 提供挪车页面与 Worker 实现，为本项目的页面交互提供了基础。相关源码在安装时下载至 `upstream/`，其许可见下载后的 `upstream/LICENSE`。

本仓库新增代码采用 [MIT License](LICENSE)。第三方代码及依赖分别遵循各自的许可证。

