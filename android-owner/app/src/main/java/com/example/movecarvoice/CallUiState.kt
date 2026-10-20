package com.example.movecarvoice

/**
 * Pure call presentation and command identity rules, shared by UI and service.
 * No Android dependencies: regressions run with ordinary JVM unit tests.
 */
object CallUiState {
    data class View(
        val detail: String,
        val duration: String,
        val inProgress: Boolean,
        val connected: Boolean
    )

    fun matchesActiveCall(expected: String?, active: String?): Boolean =
        !expected.isNullOrBlank() && expected == active

    fun duration(seconds: Long): String {
        val safe = seconds.coerceAtLeast(0)
        val minutes = safe / 60
        val remainder = safe % 60
        return minutes.toString().padStart(2, '0') + ":" +
            remainder.toString().padStart(2, '0')
    }

    fun display(rawState: String, connectedAt: Long, now: Long, matches: Boolean): View {
        if (!matches) return View("通话已结束", "", false, false)
        val connected = connectedAt > 0 && now >= connectedAt
        val elapsed = if (connected) (now - connectedAt) / 1000 else 0
        val detail = when {
            rawState.contains("重连") || rawState.contains("恢复") -> "网络中断，正在尝试恢复…"
            rawState.contains("ICE") || rawState.contains("失败") -> "连接异常，请检查网络"
            connected && rawState == "通话中" -> "语音已接通"
            rawState.contains("结束") || rawState.contains("挂断") -> "通话已结束"
            else -> "正在建立安全语音连接…"
        }
        val ongoing = !rawState.contains("结束") && !rawState.contains("挂断")
        return View(detail, if (connected) duration(elapsed) else "等待接通", ongoing, connected)
    }
}
