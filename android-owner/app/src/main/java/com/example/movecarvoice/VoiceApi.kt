package com.example.movecarvoice

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object VoiceApi {
    private const val PREFS = "movecar_voice_private"
    fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun base(context: Context): String = prefs(context).getString("base", "") ?: ""
    fun auth(context: Context): String = prefs(context).getString("auth", "") ?: ""

    fun normalizeBase(value: String): String {
        val trimmed = value.trim().trimEnd('/')
        val url = URL(trimmed)
        require(url.protocol == "https" && url.userInfo == null && url.query == null && url.ref == null && (url.path == "" || url.path == "/")) {
            "必须填写站点 HTTPS 根地址，例如 https://car.example.com"
        }
        return trimmed
    }

    /** Must be invoked from a worker thread, never on the UI thread. */
    fun post(base: String, path: String, body: JSONObject, auth: String? = null): JSONObject {
        require(base.startsWith("https://")) { "必须使用 HTTPS" }
        val url = URL(base + path)
        val con = url.openConnection() as HttpURLConnection
        try {
            con.requestMethod = "POST"
            con.connectTimeout = 10000
            con.readTimeout = 10000
            con.instanceFollowRedirects = false
            con.doOutput = true
            con.setRequestProperty("Content-Type", "application/json")
            if (!auth.isNullOrEmpty()) con.setRequestProperty("Authorization", "Bearer $auth")
            con.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = con.responseCode
            val text = (if (code in 200..299) con.inputStream else con.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            val response = runCatching { JSONObject(text) }.getOrNull()
            if (code !in 200..299) {
                val serverMessage = response?.optString("error", "") ?: ""
                val readable = when {
                    code == 404 && path.startsWith("/api/mobile/") ->
                        "HTTP 404：服务器尚未部署支持账号登录的 v0.3 服务端"
                    code == 401 -> serverMessage.ifBlank { "HTTP 401：账号或密码不正确" }
                    code == 429 -> serverMessage.ifBlank { "HTTP 429：操作太频繁，请稍后再试" }
                    code in 500..599 -> serverMessage.ifBlank { "HTTP $code：服务器内部错误，请检查 Docker 日志" }
                    else -> serverMessage.ifBlank { "HTTP $code：服务器拒绝了本次请求" }
                }
                throw IllegalStateException(readable)
            }
            return response ?: throw IllegalStateException(
                "服务器返回的不是 JSON（HTTP $code）。请检查 HTTPS 域名和反向代理。")

        } finally { con.disconnect() }
    }

    fun mobileAuth(context: Context): String = prefs(context).getString("mobileAuth", "") ?: ""
    fun username(context: Context): String = prefs(context).getString("username", "admin") ?: "admin"

    fun get(base: String, path: String, auth: String): JSONObject {
        require(base.startsWith("https://"))
        val con = URL(base + path).openConnection() as HttpURLConnection
        try {
            con.requestMethod = "GET"
            con.connectTimeout = 10000
            con.readTimeout = 10000
            con.instanceFollowRedirects = false
            con.setRequestProperty("Accept", "application/json")
            con.setRequestProperty("Authorization", "Bearer $auth")
            val status = con.responseCode
            val body = (if (status in 200..299) con.inputStream else con.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: "{}"
            val obj = JSONObject(body)
            if (status !in 200..299) throw IllegalStateException(obj.optString("error", "HTTP $status"))
            return obj
        } finally { con.disconnect() }
    }

    fun putBytes(base: String, path: String, bytes: ByteArray, mime: String, auth: String): JSONObject {
        require(base.startsWith("https://")) { "HTTPS required" }
        require(bytes.size <= 262144) { "图片太大" }
        val con = URL(base + path).openConnection() as HttpURLConnection
        try {
            con.requestMethod = "PUT"
            con.connectTimeout = 10000
            con.readTimeout = 15000
            con.instanceFollowRedirects = false
            con.doOutput = true
            con.setRequestProperty("Authorization", "Bearer $auth")
            con.setRequestProperty("Content-Type", mime)
            con.outputStream.use { it.write(bytes) }
            val status = con.responseCode
            val text = (if (status in 200..299) con.inputStream else con.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: "{}"
            val result = JSONObject(text)
            if (status !in 200..299) throw IllegalStateException(result.optString("error", "HTTP $status"))
            return result
        } finally { con.disconnect() }
    }

    fun validCallId(value: String) = Regex("^[A-Za-z0-9_-]{24}$").matches(value)
}
