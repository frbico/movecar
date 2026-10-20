# MoveCar Owner v0.4 — 原生 UI 改造说明

这是基于 **v0.3.1 已通过登录验证的车主 APP** 的 Android 界面版本。无需修改现有 Firebase 项目、JSON、服务器认证接口和 WebRTC 通话架构。

## 设计改动
- 统一品牌色：蓝色主色 / 雾白背景 / 浅描边卡片 / 低饱和状态标签。
- 登录页：品牌渐变首屏、明确的登录反馈、保留“先登录，再异步绑定 FCM”逻辑。
- 主结构：固定底部五栏（概览、挪车、通话、通知、设置），二级账户安全由设置页进入。
- 首页：车主状态渐变卡、请求计数、快捷操作网格、设备 FCM 状态、管理后台入口。
- 挪车请求：独立卡片、待处理/已确认状态标签、确认/看图/删除、分页及清空确认。
- 通话记录：匿名来电卡片、未接听/拒绝/已结束等状态区分。
- 通知中心：APP FCM、Bark、Server酱³、微信四组卡片；单独测试、独立开关、密钥留空保留与删除逻辑不变。
- 设置与账户：站点设置、通知保留策略、图标、密码及退出登录按功能分组。
- 自定义 Android 自适应桌面图标和更明确的版本标识。

## 保留的行为
- 不修改 server.mjs / mobile-owner.mjs / voice-service.mjs。
- FCM 来电服务、Android 原生 WebRTC 后台音频服务、语音交互组件保持 v0.3 的实现。
- Android 调试包使用同一个 `com.example.movecarvoice` 包名与 Firebase 配置。
- GitHub 自动构建仍从 `MOVECAR_GOOGLE_SERVICES_JSON_B64` 注入配置。

## 安装与测试
1. GitHub Actions 中查找 `feature/owner-ui-v0.4` 的 `Android debug APK` 成功运行，下载 `movecar-owner-configured-debug`。
2. 如果手机提示签名不一致，卸载旧的调试 APK 后再安装（需重新登录）。**服务器数据和 Firebase 私钥不需要更改**。
3. 输入 `https://movecar.ssxi.de` 和现有管理员用户名/密码，测试底栏和各功能页。
4. 测试记录确认、推送渠道保存和 FCM Test 按钮，最后再验证锁屏来电及通话熄屏持续。
5. 建议使用三星 S24 Ultra 真机检查文字缩放、键盘遮挡、系统深色模式和通知权限。

## 注意
这是视觉与交互改造，不代表已经做过三星实机验收。GitHub 编译通过仅能证明 APK 构建成功，不保证所有屏幕/系统字体大小或 FCM 网络场景正常。

**本版本不自动部署服务器、不合并主分支。**
