# MoveCar · Linux / Docker 自部署版

在 Linux 一键部署 [lesnolie/movecar](https://github.com/lesnolie/movecar) 的挪车页面，保留原始 Worker 前端与状态处理，增加 SQLite 兼容层、**管理后台**、**Bark + 微信 Server酱 + Server酱³ 推送**。

> 本项目为第三方独立适配版，不是上游作者的官方 Docker 版本；上游代码由 `scripts/fetch-upstream.sh` 在首次安装时从 GitHub 下载。请自行审查后用于正式环境。

## 🚀 一键部署（默认 8888 端口）

前置要求：Docker Engine + Docker Compose 插件、网络可以访问 GitHub 上游源码（需要 `curl`）。

```bash
git clone https://github.com/frbico/movecar.git
cd movecar
./install.sh
```

**无需输入域名、Bark Key 或微信 SendKey，甚至不需要 `.env`。** 安装脚本会下载上游源码并构建容器，首次启动后自动生成随机管理密码，显示在终端。

- 用户扫码页面：`http://服务器IP:8888/`
- 管理后台：`http://服务器IP:8888/admin`
- 服务器上重新查看首次密码：`./show-admin-password.sh`
- 首次登录后建议立刻修改密码，修改后初始密码文件被删除。

### 后台配置

1. 打开 `/admin`，使用安装脚本显示的初始管理员密码登录。
2. 填入任一种推送渠道：
   - **Bark**（iPhone）：`https://api.day.app/你的DeviceKey`；支持自建 HTTPS Bark 服务。
   - **微信**：先在 [Server酱 Turbo](https://sct.ftqq.com) 用微信扫码登录，复制以 `SCT` 开头的 **SendKey**，粘贴到后台。免费版有日推送限额；这是第三方平台，非微信官方直接推送 API。
3. 点击**保存所有设置**，再点击**发送测试通知**。
4. 如果多个渠道都已配置，将同时发送；某个渠道失败而另一个成功时视为推送成功。
5. **公网访问地址**可以暂时不填：程序会使用当前访问使用的 IP/主机名生成车主确认链接。但是正式使用请填写 HTTPS 公网域名，例如 `https://car.example.com`，否则微信/Bark 中的确认链接可能无法从外网访问。

**配置保存到 Docker 数据卷的 SQLite 数据库中，重启后仍然存在。** 后台不回显 Bark / SendKey；留空表示不修改已有值，可显式清除。

## 🔒 安全建议

- 默认按你的要求开放 TCP `0.0.0.0:8888`。这是 **HTTP**，明文连接不适合直接跨公网输入管理员密码。正式上线请使用 HTTPS 反向代理，或者通过 SSH 隧道访问后台。请配置防火墙限制 8888 端口的访问来源。
- 正式页面位置授权需要 HTTPS（浏览器对 localhost 有部分例外）。收到微信通知不意味着 URL 已能在外网访问。
- 用 Nginx、Caddy、Traefik 或其他 HTTPS 反向代理指向宿主机 `127.0.0.1:8888`，后台填写 HTTPS 域名。确认反向代理入口及访问域名正确。也可将 `HOST_BIND` 设置为 `127.0.0.1`，只允许本地和反向代理访问。
- 管理员密码采用 scrypt 哈希，登录会话通过 HttpOnly、SameSite Cookie 管理，并校验 CSRF token。首次密码保存在持久化目录的 `admin-initial-password` 文件，权限 `0600`，密码修改后删除。
- 推送中使用**有效期一小时的签名车主确认链接**，而不是永久的车主 token；首次访问后会被换成一小时 HttpOnly Cookie。
- 没有推送渠道时可正常打开页面和后台，但扫码者发送通知会提示“尚未配置”；配置任何一个渠道后立即可用，无需重启。
- 限流默认按服务端看到的 TCP 来源 IP 实施。在统一反向代理之后，多个请求方可能共用一个限流身份；需要更精确的限流建议使用反向代理/WAF。
- 上游设计为单车/单状态共享，`/api/check-status` 会把车主确认位置返回给关注该状态的请求者。不要视作私有的多用户系统。

### HTTPS 反向代理示例（Caddy）

若解析了 `car.example.com`，可参考：

```caddyfile
car.example.com {
    reverse_proxy 127.0.0.1:8888
}
```

若无需公网直接访问 8888，可在项目根目录新建**可选** `.env` 文件：

```dotenv
HOST_BIND=127.0.0.1
HOST_PORT=8888
```

注意：`.env` 只决定 Docker 端口绑定，**不是**通知渠道配置文件。通知渠道只在后台配置。

## 日常管理

```bash
docker compose ps
docker compose logs --tail=80
docker compose restart
docker compose up -d --build
./show-admin-password.sh    # 仅管理员密码未修改时有效
```

更新代码：

```bash
cd ~/movecar
git pull --ff-only
./install.sh
```

数据保存在 `movecar_data` 命名数据卷里，`docker compose down` 不删除它。请勿使用 `docker compose down -v`，否则会清除设置、密码和通知状态。备份 SQLite 时应先停服务或使用 SQLite 一致性备份，数据库为 WAL 模式。

## 不用 Docker

Node.js 24+ 环境下：

```bash
bash scripts/fetch-upstream.sh
./run-linux.sh
```

同样默认监听 8888，初始密码保存在 `./data/admin-initial-password`；可设置环境变量 `DB_PATH`、`PORT` 调整数据库路径和端口。

## 自动测试

```bash
node --test tests/*.test.mjs
```

CI 执行语法测试、登录/配置/推送集成测试、脚本执行权限检查、上游代码下载和 Docker 构建。集成测试使用模拟原版 Worker 与本地推送接口，**不包含真实微信或 Bark 账号推送测试**。

## License

兼容层采用仓库内 `LICENSE` 所载许可。下载的上游项目使用其原始许可证，见 `upstream/LICENSE`。


## 📲 Server酱³ Android / iOS 原生推送

新版后台支持 **Bark、Server酱³ 和微信 Server酱 Turbo** 三种独立通知渠道，互不覆盖，可同时发送。

1. 在 [Server酱³](https://sc3.ft07.com) 获取 `sctp` 开头的 SendKey；这是独立于微信 Turbo 的 `SCT` 密钥。
2. 小米国行与三星美版安装 Server酱³ App，绑定同一个账户，确认厂商推送 / Google FCM 与通知权限正常。
3. 打开 `/admin` →「通知渠道」，输入 SendKey 后保存，并点击 **Server酱³ 单独测试**。
4. 可继续启用 Bark 和微信备用通道。后台会显示各渠道是否已配置；**密钥不回显**，留空保留已保存密钥，勾选「清除」可删除密钥。
5. 为方便车主点击通知中的链接，建议在「基本设置」填写可从手机访问的 HTTPS 公网域名。

SC3 使用官方 HTTPS API：`https://<uid>.push.ft07.com/send/<sendkey>.send`，请求体包含 `title`、`short`、`desp` 和 `tags`。请求成功仅说明推送服务接受消息，仍需要在两台手机上检查锁屏通知是否实际送达。

升级现有容器：

```sh
git pull --ff-only
docker compose up -d --build
```

**不要执行 `docker compose down -v`**，否则会删除原数据卷。旧的 SQLite 配置和管理员密码无需迁移或重设。

## 📷 照片与修复说明（2026-10-15）

- **通知立即发送**。已移除原始 Worker 无位置时同步等待 30 秒的逻辑，推送服务本身仍可能存在网络耗时。
- **Server酱³ 的正文换行**：把上游字面的 `\\n` 转换成真正换行；Markdown 正文不再显示转义符。
- **车主确认链接**：新消息携带 `/owner-confirm/<过期时间>/<HMAC签名>`，减少聊天客户端在打开链接时丢弃 URL 查询参数的风险；旧版 `?expires=...&sig=...` 链接仍可使用，过期链接依旧拒绝访问。收到仅有 `/owner-confirm` 的链接并不能绕过授权。
- **现场照片**：发起者在第一次挪车通知成功后，进入成功页才可见拍照按钮。浏览器选择/拍摄照片，自动压缩为不带原始 EXIF 元数据的 JPEG（最长边不超过 1200 像素、最多 1.5 MB），点击「发送现场照片给车主」将产生单独推送。每次首次成功通知只能上传一次，上传授权 20 分钟有效。
- **照片访问和保留期限**：照片数据保存在原 SQLite 数据卷中，通过不可猜测的随机链接访问，1 小时后自动拒绝读取，并按后台清理任务清理过期记录。持有照片链接的人在有效期内可以查看，请勿上传身份证、无关行人面孔等敏感信息。
- **Server酱³ 中的“图片”选项**：旧通知未上传任何照片，App 里的图片页空白是正常的；新的现场照片通知包含 HTTPS 图片 Markdown，实际预览取决于手机 App 与公网图片地址可访问性。
- **重要**：手机拍照与接收照片都建议通过有效 HTTPS 域名访问服务，HTTP 下可能受摄像头和图片加载限制。无推送配置或所有渠道失败不会签发照片上传凭据。

更新：`git pull --ff-only origin main && docker compose -f compose.yaml up -d --build`。请保留现有数据卷，不要执行 `docker compose down -v`。

## 2026-10-15：定位、拍照、确认和 SC3 排版修复

- 每次挪车请求都有 **独立确认 Token**，有效期 60 分钟；车主无须登录。打开链接只显示确认页，点「我已收到，正在前往」才真正确认。
- 发起人页面对每条请求单独查询状态，约每 1.2 秒检查一次；两条请求不会互相影响，手机锁屏暂停浏览器时更新可能延迟。
- **定位功能已在最新版移除**，无需位置权限，SC3 通知和车主确认页不再包含地图链接。
- SC3 使用 Markdown 完整正文 desp 和实际换行；short 只作通知摘要，所以系统通知栏折叠时通常仍是一行，打开消息详情才看到完整排版。
- 发送成功页面加入拍照按钮，照片通过浏览器 Canvas 压缩成 JPEG 后补发；照片凭证 20 分钟有效、每次请求最多补发一张，图片链接 60 分钟过期。
- 安全提示：拥有确认链接的人即有本次确认权限，不要转发该链接；照片使用随机限时 URL，请勿拍摄他人的敏感信息。
- 更新后请使用**新发起的挪车通知**测试，旧版失效链接不会自动恢复。后台「基本设置」应填写 HTTPS 公网地址。

### 升级服务器

```bash
cd ~/movecar
git pull --ff-only origin main
docker compose -f compose.yaml up -d --build
docker compose -f compose.yaml ps
```

出现 git pull 本地修改冲突时，请先备份对应文件或使用 git stash；不要执行 docker compose down -v。

## 原图直传与挪车记录保留上限

- 挪车成功页面支持直接上传 JPEG、PNG、WebP、HEIC/HEIF 原文件，**不再依赖浏览器的 Image/Canvas 解码及重编码**。选择文件后可预览的会预览，HEIC 在部分浏览器无法预览，但仍可直接上传并在车主通知里点击原图链接。
- 单张原图上限为 **10 MiB（10 × 1024 × 1024 字节）**。服务器会对文件头进行格式识别并与请求 Content-Type 交叉校验，拒绝不支持的格式；不再要求所有图片都必须是 JPEG。
- 原图含有相机原始 EXIF/GPS 等元数据，不会自动清除；建议避免拍到陌生人面孔、证件、车牌以外的敏感信息。
- 在 `/admin` → **基本设置** 中可以更改「保留最近挪车记录（条）」，默认 **50**，允许 1–500 条；修改后立刻清理超额记录。每次新挪车通知成功后也自动清理最旧记录。
- 与被删记录关联的照片及上传凭证会一起清除；照片独立的一小时访问期限仍然生效。已过期的记录和照片会定期清理。
- 挪车记录和照片主要占用 SQLite 数据库的磁盘空间，不是等量常驻 RAM。删除记录后 SQLite 通常会复用空闲页，但磁盘文件未必立即缩小；若需要实际回收文件体积，应在维护窗口备份数据库并执行 VACUUM。
- 设置很小的保留条数会让较早但仍在等待回复的请求失效。推荐常规使用保留 50 条。

## 2026-10-16 更新：禁用定位与 10 MiB 照片

- 挪车前台取消位置授权弹窗和位置状态卡片，不调用浏览器 Geolocation API；所有新挪车请求即使带有旧客户端传来的经纬度也会被忽略。
- SC3/Bark/微信通知不生成地图链接，车主确认页不显示位置。服务端在首次启动时清除现存挪车记录的经纬度字段。
- 照片上传支持原始 JPEG、PNG、WebP、HEIC/HEIF，允许单张 **最多 10 MiB**；超出会返回 HTTP 413。保持原图不压缩，因此相机写入图片的 EXIF/GPS 信息仍可能存在，请注意隐私。
- 如果使用 Nginx 反向代理，需要确保 `client_max_body_size` 至少为 `11m`（建议 `12m`），否则上传较大的照片可能在抵达 MoveCar 服务器前被代理直接拒绝。
- 其余挪车 Token 确认、状态反馈、后台最近记录条数管理均保留不变。

## 2026-10-16：联系按钮、历史管理和站点自定义

- **成功页精简**：移除拍照区的原图说明；车主确认时隐藏「通知已发送」卡片，仅显示「车主已收到通知」，不再堆叠两块大卡片。
- **电话延时开放**：首次挪车请求发送成功后开始倒计时 60 秒。若车主仍未确认并且后台配置了联系电话，页面才恢复电话链接；收到确认后电话保持不可点击。倒计时显示剩余秒数，重新通知不重置倒计时。
- **微信联系**：后台「基本设置」填写车主微信号，前台新增微信联系按钮。点击复制微信号并显示「已复制微信号，请添加车主微信」；未配置时按钮禁用。网站需要 HTTPS 或允许剪贴板操作的浏览器环境。
- **后台挪车记录**：侧边栏「挪车记录」显示所有仍被保留的请求（默认最新 50 条、可在基本设置调整为 1–500 条）。支持分页、刷新、查看留言和状态、查看尚未过期的现场照片、逐条删除或清空全部保留记录，清除时同时移除关联照片。
- **历史与链接有效期分离**：车主确认 Token 仍只在首次发送后的 1 小时内有效；过期后的历史记录可继续在后台查看，直到超出保留条数上限或被管理员删除。以前已由旧版本清理掉的记录无法恢复。
- **站点名称与图标**：后台可编辑站点名称（1–40 字）、上传图标（PNG、JPEG、WebP、ICO；最大 256 KiB），应用于前台站点标题、浏览器标签和 favicon；可恢复默认图标。
- **隐私与安全**：历史记录接口仅管理员可读；修改、删除、上传图标受管理员登录和 CSRF 校验保护。公开网站只返回显示所需的站点名称和微信号，不公开管理员密码及通知密钥。

升级 Docker 后如果出现页面缓存问题可强制刷新。首次启用微信联系请先在后台设置微信号并保存。

## MoveCar 安卓接收端

`android/` 是原生 Android 工程，包名为 `de.ssxi.movecar`，固定连接 `https://movecar.ssxi.de`。Redmi K70 和 Galaxy S24 Ultra 均通过自建 WebSocket 与常驻前台服务接收消息，无需 Firebase、Google 服务或 MQTT Broker。同一后台可绑定多台手机；App 显示近期请求、确认状态和未过期的照片，车主可在任一台确认。原有网页确认链接与其他通知渠道保留。

### 发布签名

发布签名在 `secrets/movecar-release.p12` 和 `secrets/signing.properties`。首次可用 `python scripts/generate-android-signing.py` 生成；**这两个文件必须私下备份**，否则以后无法覆盖升级已安装的 APK。已有文件时脚本拒绝覆盖。不要将签名文件提交到 Git。

### 构建与部署

在 JDK 17、Android SDK 35 可用的环境运行：

```sh
cd android
./gradlew :app:assembleRelease
```

有签名配置时，输出为 `android/app/build/outputs/apk/release/app-release.apk`。Windows 使用 `gradlew.bat`。CI 还会构建不含私密配置的调试 APK，以检查工程可编译。

服务端先按原方式升级，保留现有 SQLite 数据卷：

```sh
docker compose up -d --build
```

不要删除 `movecar_data` 数据卷。服务端的 WebSocket 入口与网页使用同一个域名和 443 端口。

在 1Panel/OpenResty 的 `movecar.ssxi.de` 反向代理中为 `/api/app/events` 允许 WebSocket Upgrade，并转发到 `127.0.0.1:8888`。配置要点：`proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 90s;`，保留原 Host 头。服务端每 20 秒 Ping；若 1Panel 提供“WebSocket 支持”开关，需开启。照片最大 10 MiB，反向代理请求体上限建议至少 12 MiB。

### 绑定与切换

1. 安装同一签名 APK，在网页后台「安卓设备」生成一次性二维码，分别用两台手机在 App 内扫码。扫码页无法打开时，可复制后台显示的配对链接，粘贴到 App 内绑定。二维码与链接共用同一个 5 分钟有效、使用一次即失效的凭证；两台手机须分别生成。
2. 两台手机均允许通知、自启动和后台运行，并将电池策略设为无限制。两台都应显示常驻通知和“已连接”状态。
3. 在后台「通知渠道」单独测试 App，然后从网页发起新请求，锁屏检查双机提醒、照片与确认同步。
4. 验证通过后，关闭 Bark/Server酱等旧渠道的「启用发送」开关并保存。旧密钥会保留，可随时重新启用。升级代码本身不会提前关闭旧渠道，以免设备绑定前中断通知。
5. 手机丢失或换机时在后台「安卓设备」逐台解绑；旧设备凭证会立即失效。

两台手机都依赖常驻连接。系统结束进程后即时送达无法保证；App 重连时从保留记录补取遗漏请求。WebSocket 的“发送成功”仅表示写入当前连接，实际锁屏显示仍需真机验证。
