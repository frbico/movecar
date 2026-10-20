# MoveCar 原生车主 APP v0.3（开发测试版）

本功能位于 feature/owner-mobile-dashboard（PR #10）。不会自动部署到 movecar.ssxi.de，线上服务仍按当前版本运行。

## 功能和登录

- 网页扫码端继续负责留言、现场照片、匿名 WebRTC 通话。
- Android 原生 APP 包含：管理员账号密码登录、概览、挪车记录及确认/删除、照片查看、来电历史、Bark/SC3/Server酱与 APP FCM 通知渠道测试和开关、站点设置、图标管理、账户安全。
- 与网页 /admin 使用同一套管理员凭据；默认用户名 admin；原密码不变。
- APP 首次登录自动绑定 FCM Token，不再需要旧配对码。账号修改会撤销网页/APP 登录、FCM 设备绑定，之后需重新登录。
- 旧版 /api/voice/device/register 配对码注册默认关闭。仅测试兼容时显式配置 VOICE_ALLOW_LEGACY_PAIRING=1。

## GitHub Actions 构建与安装

1. GitHub Repo Settings → Secrets and variables → Actions：确认 MOVECAR_GOOGLE_SERVICES_JSON_B64 是客户端 google-services.json 的 Base64（包名 com.example.movecarvoice）。
2. GitHub Actions → Android debug APK → 分支 feature/owner-mobile-dashboard 最近成功的运行 → Artifacts：下载 movecar-owner-configured-debug。不要安装名为 CI-only-unconfigured 的构建产物。
3. GitHub 的 debug 签名可能随构建变动，若升级报签名不兼容，卸载旧 APK 后安装新 APK。正式长期升级需固定私有 release 签名。
4. 在三星 S24 Ultra 安装后使用 https://movecar.ssxi.de、管理员账号 admin 和已有网页登录密码登录；授权通知和麦克风权限。

## 服务器更新

请先保存原 Docker 数据卷备份，确认新 APK 可用，然后在服务器 SSH 终端执行：

    cd ~/movecar-voice-fresh
    git fetch origin feature/owner-mobile-dashboard
    git switch -c feature/owner-mobile-dashboard --track origin/feature/owner-mobile-dashboard
    docker compose up -d --build
    docker compose ps
    curl -fsS https://movecar.ssxi.de/healthz

如果已经在此分支，则用 git pull --ff-only 替代 git switch -c。原 Firebase 私钥保留在 Docker 持久化数据卷中，不要执行 docker compose down -v，也不要上传任何密钥到公开仓库。

## 验收

1. APP 输入同一管理员账户密码登录，首页显示 FCM 已绑定。
2. APP 测试原生通知，在系统锁屏期间检查消息到达。
3. 第二台手机打开 https://movecar.ssxi.de/voice/caller 呼叫，三星锁屏响铃、接听、双向通话并熄屏保持。
4. 网页端提交挪车留言，APP 显示新的普通通知和待确认请求；APP 确认后网页同步状态。
5. APP 和网页后台交替保存四个通知开关，逐通道测试，检查渠道密钥不回显。
6. 查看匿名来电历史、照片、网站图标，测试退出登录和重新登录。
7. 服务器可运行 node --test tests/*.test.mjs；CI 也会执行语法、接口、Docker 和 Android 构建测试。

当前仍为实验版本。FCM 不保证所有后台条件下即时送达，强行停止后可能无法收信。尚未实现系统 Telecom 的完整整合、网络切换时 ICE 自动恢复、持久 release 签名或多设备账户管理。
