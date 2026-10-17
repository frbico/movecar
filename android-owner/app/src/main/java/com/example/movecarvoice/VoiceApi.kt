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
            val text = (if (con.responseCode in 200..299) con.inputStream else con.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: "{}"
            val response = JSONObject(text)
            if (con.responseCode !in 200..299) throw IllegalStateException(response.optString("error", "HTTP ${con.responseCode}"))
            return response
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
