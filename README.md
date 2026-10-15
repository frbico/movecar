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

- **不分享定位也会立即发送通知**。原始 Cloudflare Worker 无位置时同步等待 30 秒，容易造成「发送中」卡住；现在由适配层显式取消延迟。推送服务本身的响应仍会有网络耗时。
- **Server酱³ 的正文换行**：把上游字面的 `\\n` 转换成真正换行；Markdown 正文不再显示转义符。
- **车主确认链接**：新消息携带 `/owner-confirm/<过期时间>/<HMAC签名>`，减少聊天客户端在打开链接时丢弃 URL 查询参数的风险；旧版 `?expires=...&sig=...` 链接仍可使用，过期链接依旧拒绝访问。收到仅有 `/owner-confirm` 的链接并不能绕过授权。
- **现场照片**：发起者在第一次挪车通知成功后，进入成功页才可见拍照按钮。浏览器选择/拍摄照片，自动压缩为不带原始 EXIF 元数据的 JPEG（最长边不超过 1200 像素、最多 1.5 MB），点击「发送现场照片给车主」将产生单独推送。每次首次成功通知只能上传一次，上传授权 20 分钟有效。
- **照片访问和保留期限**：照片数据保存在原 SQLite 数据卷中，通过不可猜测的随机链接访问，1 小时后自动拒绝读取，并按后台清理任务清理过期记录。持有照片链接的人在有效期内可以查看，请勿上传身份证、无关行人面孔等敏感信息。
- **Server酱³ 中的“图片”选项**：旧通知未上传任何照片，App 里的图片页空白是正常的；新的现场照片通知包含 HTTPS 图片 Markdown，实际预览取决于手机 App 与公网图片地址可访问性。
- **重要**：手机拍照与接收照片都建议通过有效 HTTPS 域名访问服务，HTTP 下可能受摄像头和图片加载限制。无推送配置或所有渠道失败不会签发照片上传凭据。

更新：`git pull --ff-only origin main && docker compose -f compose.yaml up -d --build`。请保留现有数据卷，不要执行 `docker compose down -v`。
