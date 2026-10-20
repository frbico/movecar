# MoveCar 稳定版更新 · 网页一键升级

本方案彻底取代过去针对每个 `feature/...` 分支重复运行安装器的方式。

## 为什么原命令始终报“存在未提交代码修改”？

香港终端反复出现的错误文字是旧版安装器的原文，而最新 GitHub 源码早已换成备份和 stash 逻辑。这表明实际执行到的脚本仍是旧版（可能是旧 URL 的缓存或旧工作目录调用）；从同一个 URL 反复下载不是可靠修复办法。

现在提供全新独立入口 `scripts/recover-install.sh`，下载独立的 `host-updater.sh`，跳过老安装器的 Git 分支判断。新更新器先保存已有的 `.env`、本地代码修改、SQLite 一致性快照和 App 数据，再通过固定的 `release/stable` 分支安装代码。它**不会执行清理数据卷、卸载 1Panel 或全局 Docker prune**。

## 一次性升级旧版

服务器需要 Docker Compose V2、Git、curl、Python3 和 systemd（用于后续自动化更新任务）。在香港 VPS 以 root 执行：

```bash
curl -fLsS -H 'Cache-Control: no-cache' \
  'https://raw.githubusercontent.com/frbico/movecar/release/stable/scripts/recover-install.sh' \
  -o /tmp/movecar-recover-install.sh &&
bash /tmp/movecar-recover-install.sh
```

该入口是新文件名，不经过原 `install-universal.sh` 的旧更新逻辑；首次升级后自动注册服务器的 `movecar-web-upgrade.timer`。

备份：`/root/movecar-update-backups/<日期>/<内容>`。本地 Git 修改会另外留下二进制补丁和 stash ID；不会直接删除。原数据库、账号、Firebase 和 TURN 数据卷保持原样。

**如果使用旧的单分支 Git checkout**，新脚本会显式拉取 `refs/heads/release/stable` 到远程跟踪引用后再切换。旧源码文件如果与未跟踪文件发生冲突，将停止升级以保护该文件，备份不会删除。

## v0.7.3 主机升级助手安全检查

后台在提交升级任务后显示「已排队」，主机助手每约 15 秒检查一次任务并写入心跳。若超过 2 分钟没有主机心跳，将提示「助手离线」；若任务超过 20 分钟仍未被取走，将显示「任务超时」，而不是悄悄覆盖旧队列。

从 v0.7.2 升级到 v0.7.3 时，主机助手可能还没有心跳功能，因此首次升级仍然允许使用旧助手，升级后才生效新的离线检查。必须先在服务器正确安装/启用主机 systemd timer。

升级会校验备份 SQLite 的 quick_check 与 settings 表，并在更新后再次检查数据库。部署失败或升级脚本异常时会恢复旧版 Git 代码和 .env，重建旧版容器，并核验旧版 SHA（如受支持）与 HTTP 健康状态。**如果恢复也失败，后台明确显示「自动回退未成功」，必须人工处理。**

升级器会保留一致性的原始 SQLite 快照在 root 私有备份目录，**默认不会自动把数据文件替换成旧快照**，因为自动覆盖可能丢失备份后刚收到的新挪车记录。若新版迁移与旧版数据库不兼容，需要管理员根据备份手动恢复，不得将「代码回滚」误认为「数据库已回滚」。

目前仍无权远程进入你的香港 VPS 核对 systemd 及真实 Docker 运行情况；GitHub Actions 只能验证源码、模拟接口与测试 Docker 容器。

## 以后所有升级

在网页后台登录 → **版本更新** → **检查更新**。将显示运行版本、稳定发布 SHA、更新内容以及是否存在新版本。需要升级时再次输入**当前管理员密码**，确认后服务器会排队执行：

1. 以只读方式对比 GitHub 官方固定的 `frbico/movecar` `release/stable` 引用；
2. 一致性备份 SQLite、保存用户代码差异与旧 `.env`，全部保留在 root 私有目录；
3. 更新固定稳定分支、构建 MoveCar/coturn 镜像、原地启动服务；
4. 检查本机 HTTP `/healthz`；如果失败会尝试恢复旧版本并显示错误，不覆盖数据卷；
5. 后台显示成功/失败和版本状态。

更新时可能中断正在进行的语音通话，请在无活跃呼叫时更新。

## 安全设计

- 网页后台不能调用 shell，也不持有 Docker socket 或 root 密码。
- 管理员 Cookie + CSRF + **密码二次确认**后，Node 才会创建严格格式的更新请求 JSON。
- 宿主机 systemd 定时检查任务，只使用固定官方 GitHub 仓库及稳定分支；不接受浏览器自定义代码/分支/命令。
- root 服务维护私有备份、健康检查、失败回滚状态。
- systemd 不存在时需要管理员配置 root cron；网页会显示缺少主机更新服务，不能假装一键更新成功。
- 后续有新功能或修复时，测试通过后发布到**同一** `release/stable` 分支，即可被后台发现，不再使用每个开发分支的独立安装命令。

**注意：GitHub CI 证明代码测试通过，不代表已经在你的香港 VPS 上运行。第一次迁移建议避开正在通话的时候并保留 SSH 会话；若服务器云安全组、代理或 Docker 权限异常，须查看主机升级日志。**
