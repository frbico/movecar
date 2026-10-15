# MoveCar 私有部署版（Docker / Linux）

> 这是一个 **独立制作的兼容层**，用于在 Linux 运行 [lesnolie/movecar](https://github.com/lesnolie/movecar) 的原始 `movecar.js`，**不是原作者发布的 Docker 版本**，也不代表该项目已经经过生产安全审计。
>
> 安装脚本会从 GitHub **另行获取**上游 `movecar.js` 与其 MIT License；本下载包不附带原项目全部源码。运行时保留原版网页 HTML/CSS/JavaScript 与挪车接口。

## 功能与边界

- 原版扫码通知、Bark 推送、车主确认、双向位置共享（高德/Apple 地图）、不授权位置时延迟 30 秒。
- Node.js 24 兼容层将 Workers KV 的 `get/put(expirationTtl)` 适配为 **本地 SQLite**，数据落盘保存，**不需 Redis、Cloudflare、数据库服务**。
- 对车主确认页及提交确认 API 附加令牌验证：推送链接内附带车主令牌（在重新生成 `OWNER_TOKEN` 前会一直有效），打开后设置 1 小时 HttpOnly Cookie；首次访问时通过重定向清理页面地址里的 token。
- 基础限流（按服务器实际 TCP 来源 IP；如果部署在统一反代后，所有扫码者会共享限流；需要更精确的限流请在反代或 WAF 中配置）。
- 保留上游单车主 / 单会话设计：**不是多租户版**。`/api/check-status` 仍会将车主确认后分享的位置返回给查看状态的扫码者，属于原版业务逻辑。

## 准备条件

- Docker Engine + Docker Compose 插件（推荐）；或 Node.js **24+**（本机直接运行）。
- 一个能访问的 HTTPS 域名及反向代理（正式部署/手机定位必需；localhost 测试除外）。
- iPhone Bark 客户端，以及 Bark API 地址，如 `https://api.day.app/你的DeviceKey`。
- 初始化时能访问 `raw.githubusercontent.com`，以获取原版代码；若服务器不能连接 GitHub，可在个人电脑下载 [上游 movecar.js](https://github.com/lesnolie/movecar/blob/main/movecar.js) 后手动上传为 `upstream/movecar.js`，然后继续安装。

## Docker 一键安装（推荐）

将本压缩包解压到 Linux 或 NAS 上，在项目根目录执行（首次安装会从 GitHub 拉取 `upstream/movecar.js`，因此**不要直接跳过脚本运行 `docker build`**）：

```bash
chmod +x install.sh scripts/fetch-upstream.sh
./install.sh
```

安装程序会询问：

1. `PUBLIC_URL`：外部访问的 HTTPS 地址，如 `https://car.example.com`；只做本机测试则填 `http://127.0.0.1:8080`。
2. `BARK_URL`：你的 Bark 推送接口地址。

它会自动生成 `OWNER_TOKEN` 并创建 `.env`，使用 `docker compose up -d --build` 启动。**不要公开 `.env` 文件**。

### HTTPS 反向代理

Docker 默认只监听本机 `127.0.0.1:8080`，请使用你已有的 Nginx / Caddy / 宝塔 / Lucky / Cloudflare Tunnel 做 HTTPS 反向代理。二维码网址为 `PUBLIC_URL`。

Caddy 示例（域名已解析到本机且 80/443 可达时可自动签发证书）：

```caddyfile
car.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Nginx 示例（证书需另配）：

```nginx
server {
    listen 443 ssl;
    server_name car.example.com;
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_read_timeout 75s;  # 原版无位置通知延迟 30 秒
    }
}
```

**不要把 `OWNER_TOKEN` 放在扫码二维码中**。车主确认链接仅通过 Bark 通知接收。

### 日常管理

```bash
docker compose ps                  # 查看容器状态
docker compose logs -f --tail=100  # 查看日志（可能包含请求错误信息）
docker compose restart             # 重启
docker compose down                # 停止，默认保留数据卷
docker compose up -d --build       # 重新构建/更新兼容层
```

编辑 `.env` 后需执行 `docker compose up -d` 重建容器以使设置生效。原始代码下载文件不纳入本仓库的 Git 提交。原始代码更新需先备份再执行 `FORCE_UPSTREAM=1 ./scripts/fetch-upstream.sh`，然后 `docker compose up -d --build`。不要在未经审查的情况下自动更新上游代码；可设置 `UPSTREAM_REF=<审核过的CommitSHA>` 固定源码版本。

备份：SQLite 数据位于 `movecar_data` Docker 命名卷，使用 `docker compose down` 后备份该卷；`.env` 也必须单独保管。切勿把原始 SQLite 文件在服务运行时直接复制作为唯一的备份方式（WAL 可能仍有未合并数据）。

### 硬盘目录保存数据（而不是 Docker 卷）

把 `compose.yaml` 的 `volumes` 修改为：

```yaml
    volumes:
      - ./data:/app/data
```

提前 `mkdir -p data` 并确保宿主目录能够被容器内的 node 用户（通常 UID 1000）读写；目录内数据库文件请勿公开共享。

## 不用 Docker，在 Linux 上直接运行

适用于已经安装 Node.js 24+ 的 Linux；无 `npm install` 步骤；`run-linux.sh` 使用 Node.js 的 `--env-file` 安全读取环境配置：

```bash
./scripts/fetch-upstream.sh
cp .env.example .env
# 修改 .env 中 PUBLIC_URL、BARK_URL、OWNER_TOKEN、HOST_PORT
chmod 600 .env
./run-linux.sh
```

设置随机 token 的命令（任选其一）：

```bash
openssl rand -hex 32
# 或者：od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
```

要后台常驻可以配置 `systemd` service（示例）：

```ini
[Unit]
Description=MoveCar self-hosted
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=movecar
WorkingDirectory=/opt/movecar-linux
ExecStart=/opt/movecar-linux/run-linux.sh
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
ReadWritePaths=/opt/movecar-linux/data

[Install]
WantedBy=multi-user.target
```

需先自行创建普通用户 `movecar`、`/opt/movecar-linux/data` 并赋予目录读写权限；该配置只是示例，**不要复制后直接以 root 运行**。

## 测试

```bash
curl -i http://127.0.0.1:8080/healthz
# 应输出 HTTP 200 和 ok
node --test tests/*.test.mjs
```

测试使用单独的最小 Worker 模拟原项目的 HTTP 和 KV 接口，覆盖 SQLite、Bark 链接注入、车主认证与重启后状态持久化；**不等于已对完整上游 1080 行前端源码执行端到端测试**。正式使用前请在手机上扫码完整测试。

## 安全提示与未实现项

- 单车场景。多个车主同时通知会共用上游固定的 KV 状态键；不能直接商用作多用户服务。
- 请在 HTTPS 下访问，否则手机浏览器的地理定位可能不可用。
- 车主 token 会通过 Bark 通知 URL 传递。泄露 token 就等于授予车主确认权限；**通知链接本身不会自动过期**，即使 Cookie 仅保存 1 小时也不代表链接失效。发现泄露后应在 `.env` 重新生成 `OWNER_TOKEN` 并重建容器。
- 原始设计允许发送方查看车主分享的位置信息；为避免暴露私人位置，应仅在你接受该设计时启用位置分享。
- 防刷建议在反向代理或 Cloudflare 上启用 WAF / 请求频率限制。自带 TCP IP 限流在单反向代理场景中会误把多名用户当作同一 IP，必要时设置 `RATE_LIMIT_SECONDS=0`，交给可信反代做准确限流。
- 此兼容层没有实现 PushPlus、微信推送、多车辆管理、管理员登录界面；如需要这些功能，应另行开发而不是把原版当作已有。
- 原版 Bark `level=critical` 取决于 Bark 应用及系统通知授权。
- Docker 镜像使用 `node:24-alpine`，首次构建需要从镜像仓库下载 Node.js 镜像。

## 项目与授权

- 原项目：[lesnolie/movecar](https://github.com/lesnolie/movecar)，MIT License。上游源文件和许可证由 `fetch-upstream.sh` 获取，版权归原作者。
- 兼容层：此目录下的 `server.mjs`、部署脚本和说明由本次任务生成，按 MIT License 授权使用，不提供任何担保。


## 发布到 GitHub

本仓库仅存放 Linux / Docker 兼容层源码与安装脚本。**`.env`、数据库和下载的上游 `movecar.js` / `LICENSE` 已在 `.gitignore` 排除**。安装时将获取对应的上游源文件与原作者许可证，首次运行要求能够访问 `raw.githubusercontent.com`。

新建空仓库（不要在 GitHub 上预先初始化 README 或 LICENSE），在项目目录中使用 GitHub CLI：

```bash
git init -b main
git add .
git commit -m "Initial Linux Docker adapter release"
gh auth login
gh repo create frbico/movecar --public --source=. --remote=origin --push
```

如果仓库已经存在但为空：

```bash
git remote add origin https://github.com/frbico/movecar.git
git push -u origin main
```

`--public` 表示公开仓库；需要仅自己可见则将其改为 `--private`。请先检查 `git status` 和 `git ls-files`，避免提交真实的 Bark Key、`OWNER_TOKEN` 和 SQLite 数据。
