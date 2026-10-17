package com.example.movecarvoice

import android.Manifest
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.*
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 60, 40, 40)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val title = TextView(this).apply { text = "MoveCar 车主接听端"; textSize = 24f }
        val help = TextView(this).apply { text = "首次安装：填写网站地址和服务器配对码。配对完成后，手机可接收 FCM 来电通知。"; textSize = 15f }
        val server = EditText(this).apply { hint = "https://car.example.com"; setSingleLine(); setText(VoiceApi.base(this@MainActivity)) }
        val pairing = EditText(this).apply { hint = "服务器 VOICE_PAIRING_SECRET"; setSingleLine(); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val state = TextView(this).apply { text = if (VoiceApi.auth(this@MainActivity).isNotBlank()) "已配对（可重新配对）" else "尚未配对" }
        val button = Button(this).apply { text = "配对并启用来电" }
        listOf(title, help, server, pairing, button, state).forEach { panel.addView(it, LinearLayout.LayoutParams(-1, -2)) }
        setContentView(ScrollView(this).apply { addView(panel) })
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
        }
        button.setOnClickListener {
            val base = try { VoiceApi.normalizeBase(server.text.toString()) } catch (e: Exception) { state.text = e.message; return@setOnClickListener }
            val code = pairing.text.toString()
            if (code.length < 20) { state.text = "配对码至少 20 个字符"; return@setOnClickListener }
            button.isEnabled = false; state.text = "正在获取 FCM Token…"
            FirebaseMessaging.getInstance().token.addOnSuccessListener { fcm ->
                Thread {
                    val result = runCatching {
                        VoiceApi.post(base, "/api/voice/device/register", JSONObject().put("pairingSecret", code).put("fcmToken", fcm))
                    }
                    runOnUiThread {
                        button.isEnabled = true
                        result.onSuccess { obj ->
                            VoiceApi.prefs(this).edit().putString("base", base).putString("auth", obj.getString("deviceAuth")).apply()
                            pairing.text.clear()
                            state.text = "✅ 配对完成。请测试锁屏来电通知和全屏权限。"
                        }.onFailure { state.text = "配对失败：${it.message}" }
                    }
                }.start()
            }.addOnFailureListener { button.isEnabled = true; state.text = "无法获取 Google 推送 Token：${it.message}" }
        }
    }
}
