# MoveCar Owner — GitHub Releases 正式分发

下载地址：https://github.com/frbico/movecar/releases

本项目将维护者构建的 Android 正式 APK 发布到 GitHub Releases。版本标签格式为 `android-vX.Y.Z`，附件名为 `MoveCar-Owner-vX.Y.Z.apk`，另附同名 `.sha256` 文件。服务器版与手机 APP 分别管理版本。APP 的检查更新入口指向本项目的公开 Releases，安装仍需本人确认。

**自部署者使用自己的 Firebase 项目时，必须用自己的 `google-services.json` 构建 APK。** 公共 APK 编译时使用维护者的 Firebase 配置，不能只给自建服务器上传另一项目的服务账号来接收 FCM。两份 JSON 的获取和绑定测试步骤见 [README](README.md#四创建-firebase-项目分清两份-json)。

## 自部署者使用自己的 Firebase 项目

1. 按 README 在 Firebase 中注册包名 `com.example.movecarvoice`，把该项目下载的 `google-services.json` 放到 `android-owner/app/google-services.json`；同项目的 Admin SDK 服务账号 JSON 上传到自己的 MoveCar 后台。服务账号私钥绝不能放进 APK。
2. 先在电脑上运行 `gradle :app:assembleDebug`，用 `android-owner/app/build/outputs/apk/debug/app-debug.apk` 验证实际 FCM 收发。调试签名只适合验证；更换构建电脑或改装正式包时可能无法覆盖安装。
3. 长期使用时，在可信电脑生成并离线备份**自己的** JKS 签名密钥，例如在 Linux/macOS 上运行：

   ```bash
   keytool -genkeypair -v -keystore "$HOME/movecar-owner-release.jks" -alias movecar-owner -keyalg RSA -keysize 3072 -validity 3650
   ```

   `keytool` 会交互式询问密码。请保存 JKS、别名和密码；丢失密钥后，已有安装包将无法用新签名直接覆盖。不要把 JKS 或密码提交到仓库、Issue 或聊天。
4. 在 `android-owner` 目录设置本项目 `build.gradle.kts` 实际读取的环境变量，然后构建：

   ```bash
   export MOVECAR_SIGNING_KEYSTORE_FILE="$HOME/movecar-owner-release.jks"
   export MOVECAR_SIGNING_KEY_ALIAS=movecar-owner
   read -rsp 'JKS 密码: ' MOVECAR_SIGNING_STORE_PASSWORD; echo
   export MOVECAR_SIGNING_STORE_PASSWORD
   read -rsp '私钥密码: ' MOVECAR_SIGNING_KEY_PASSWORD; echo
   export MOVECAR_SIGNING_KEY_PASSWORD
   gradle :app:assembleRelease
   ```

   输出文件为 `android-owner/app/build/outputs/apk/release/app-release.apk`。上面命令适用于 Bash；Windows 用户可在 Android Studio 的终端使用 Git Bash，或为相同的四个环境变量配置值后执行 `gradle.bat :app:assembleRelease`。密码不要写入公开脚本。
5. 今后每次发自己的新版本，都要保持相同 Firebase 项目、包名和 JKS，并在 `android-owner/app/build.gradle.kts` 中递增 `versionCode` 与 `versionName`。APP 内置更新检查只看**本项目公共 Releases**，不会自动找到你的私有 APK；请自行保存和分发自建安装包。

本仓库的自动发布工作流限制为 `frbico/movecar` 仓库运行；Fork 后即使配置了 Secrets，也不会自动替你发布自己的 APK。自行分发前应验证 APK 签名和 SHA-256。

## 仓库维护者公开发布：必须设置永久签名

为了保证公开 APK 能持续覆盖安装，仓库维护者需要在可信电脑生成并离线保存长期稳定的 JKS 文件和密码。JDK 的交互式命令为：

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
- Android 与服务端分别管理版本，需分别更新；当前公开 APK 版本以 [Releases](https://github.com/frbico/movecar/releases) 页面为准。

## 从已有 Debug 包迁移

历史 Actions 生成的 Debug APK 可能使用不同签名，系统会拒绝用新正式包直接覆盖原有安装。这是 Android 安全要求，不能强行绕过。应先对比新旧 APK 的证书指纹，妥善保留服务器登录信息和需要的本地设置，再决定是否需要卸载旧的 Debug 包、重新安装正式 APK，重新授予通知和麦克风权限并绑定 FCM。服务器 SQLite 数据不因用户手机卸载而自动删除。

## 实机验收

1. Releases 有正式签名 APK 和 SHA256 文件，文件摘要一致。
2. 三星等 Android 手机安装正式版本并正常登录、接收 FCM。
3. 后续使用同一 JKS、递增 versionCode 的正式版本能直接覆盖安装且不丢本地 APP 状态。
4. APP 设置里检查更新能识别新版本并跳到官方 Releases，不能从任意网址自动安装。
5. 锁屏接听、弱网重连、蓝牙和听筒仍需手机真机测试。

缺少签名 Secrets 时，自动工作流会拒绝发布新 APK；不会降级为临时 Debug 签名包。
