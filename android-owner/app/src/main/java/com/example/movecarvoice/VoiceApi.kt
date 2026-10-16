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

    fun validCallId(value: String) = Regex("^[A-Za-z0-9_-]{24}$").matches(value)
}
