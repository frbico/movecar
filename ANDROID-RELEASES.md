# MoveCar Owner — GitHub Releases 正式分发

下载地址：https://github.com/frbico/movecar/releases

本项目将 Android 正式 APK 统一发布到 GitHub Releases。版本标签格式 android-vX.Y.Z，APK 附件名格式 MoveCar-Owner-vX.Y.Z.apk，另附同名 .sha256 文件。服务器版与手机 APP 分别管理版本。APP 设置页新增检查更新入口，用户确认后跳转官方 GitHub 下载，Android 安装仍需本人确认，不执行静默安装。Debug 编译继续用于 CI，但不作为可下载安装包发布。

## 初次发布前：必须设置永久签名

仓库此前仅有 Debug APK 工作流，而 GitHub Releases 目前为空。为了保证以后能覆盖安装，首先需要在可信电脑生成并离线保存长期稳定的 JKS 文件和密码。JDK 的交互式命令为：

    keytool -genkeypair -v -keystore movecar-owner-release.jks -alias movecar-owner -keyalg RSA -keysize 3072 -validity 3650
    keytool -list -v -keystore movecar-owner-release.jks -alias movecar-owner

进入仓库 Settings → Secrets and variables → Actions，创建这些 Actions Secrets：

| 名称 | 说明 |
| --- | --- |
| MOVECAR_GOOGLE_SERVICES_JSON_B64 | 真实 Firebase google-services.json 的 Base64（已配置可保留） |
| MOVECAR_ANDROID_KEYSTORE_B64 | JKS 文件 Base64 |
| MOVECAR_ANDROID_KEY_ALIAS | 密钥别名，如 movecar-owner |
| MOVECAR_ANDROID_STORE_PASSWORD | JKS 密码 |
| MOVECAR_ANDROID_KEY_PASSWORD | 私钥密码 |
| MOVECAR_ANDROID_CERT_SHA256 | keytool 显示的证书 SHA256 指纹 |

在 Linux 或 macOS 用下面命令获取 Base64：

    base64 < movecar-owner-release.jks | tr -d '\n'

Windows PowerShell：

    [Convert]::ToBase64String([IO.File]::ReadAllBytes('movecar-owner-release.jks'))

不要把 keystore 或密码提交到仓库、聊天或 Issue。请妥善保管加密的离线备份。失去签名密钥可能导致已经安装的 APP 无法无缝升级。

## 发布流程

- 同步 Android 代码至 release/stable 后，GitHub Actions 自动使用固定签名构建正式 APK；也可在 Actions 页面手动运行 Publish signed Android APP to GitHub Releases。
- 构建严格校验 Firebase 包名、签名证书 SHA256、APK 数字版本及包名，未通过时拒绝发布。缺 Secret 会明确失败，不会降级发布测试包。
- 同一 Android 版本标签如果已发布，流程不会自动覆盖原有 APK。每次发布新版本必须增加 Android versionCode 和 versionName。
- 新 Android 正式版均从 Releases 安装，服务器网页后台的版本更新仍负责服务器，不会自动更新手机。
- Android 正式版 0.8.2（versionCode 17）包含新版界面；服务端版本 0.7.4。两者分别管理版本，需分别更新。

## 从已有 Debug 包迁移

历史 Actions 生成的 Debug APK 可能使用不同签名，系统会拒绝用新正式包直接覆盖原有安装。这是 Android 安全要求，不能强行绕过。应先对比新旧 APK 的证书指纹，妥善保留服务器登录信息和需要的本地设置，再决定是否需要卸载旧的 Debug 包、重新安装正式 APK，重新授予通知和麦克风权限并绑定 FCM。服务器 SQLite 数据不因用户手机卸载而自动删除。

## 实机验收

1. Releases 有正式签名 APK 和 SHA256 文件，文件摘要一致。
2. 三星等 Android 手机安装正式版本并正常登录、接收 FCM。
3. 后续使用同一 JKS、递增 versionCode 的正式版本能直接覆盖安装且不丢本地 APP 状态。
4. APP 设置里检查更新能识别新版本并跳到官方 Releases，不能从任意网址自动安装。
5. 锁屏接听、弱网重连、蓝牙和听筒仍需手机真机测试。

首次未配置所有签名 Secrets 时，Releases 可能仍为空；这比发布一个以后无法覆盖升级的错误签名 APK 更安全。
