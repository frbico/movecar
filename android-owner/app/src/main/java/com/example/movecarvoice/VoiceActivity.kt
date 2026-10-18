package com.example.movecarvoice

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.widget.*

/** The Activity owns only controls. Audio & signaling outlive Activity/screen. */
class VoiceActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var speaker: Button
    private var id = ""
    private var pendingAuth: String? = null
    private var openedAt = SystemClock.elapsedRealtime()
    private var callWasActive = false
    private val updateUi = object: Runnable {
        override fun run() {
            val activeId = OngoingCallService.currentCallId
            if (activeId != null && activeId == id) callWasActive = true
            if (activeId == null && pendingAuth == null &&
                (callWasActive || SystemClock.elapsedRealtime() - openedAt > 4500L)) {
                // Server ended the call or the service has already stopped.
                // Dismiss the call UI automatically; no extra Hang Up tap.
                finish()
                return
            }
            status.text = OngoingCallService.state
            speaker.text = if (OngoingCallService.speakerEnabled) "关闭免提" else "开启免提"
            handler.postDelayed(this,350)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val d=resources.displayMetrics.density
        fun dp(x:Int)=(x*d+0.5f).toInt()
        window.statusBarColor=0xFF075E54.toInt()
        window.navigationBarColor=0xFF075E54.toInt()
        val panel=OwnerUi.vertical(this).apply{
            gravity=Gravity.CENTER
            background=OwnerUi.gradient(this@VoiceActivity)
            setPadding(dp(24),dp(35),dp(24),dp(35))
        }
        panel.addView(OwnerUi.label(this,"MOVE CAR · 通话中",13f,0xFFD9E8FF.toInt(),true).apply{
            gravity=Gravity.CENTER
        },LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(30)})
        val avatar=OwnerUi.label(this,"CAR",28f,OwnerUi.white,true).apply{
            gravity=Gravity.CENTER
            background=OwnerUi.bg(0xFF4D8BEE.toInt(),70,this@VoiceActivity)
        }
        panel.addView(avatar,LinearLayout.LayoutParams(dp(108),dp(108)).apply{
            gravity=Gravity.CENTER_HORIZONTAL
            bottomMargin=dp(32)
        })
        panel.addView(OwnerUi.label(this,"挪车网络通话",25f,OwnerUi.white,true).apply{
            gravity=Gravity.CENTER
        })
        status=OwnerUi.label(this,"连接中…",15f,0xFFDEE9FF.toInt()).apply{
            gravity=Gravity.CENTER
            setPadding(0,dp(12),0,dp(52))
        }
        panel.addView(status)
        val actions=OwnerUi.horizontal(this)
        speaker=Button(this).apply{
            text="开启免提"
            isAllCaps=false
            textSize=16f
            setTextColor(OwnerUi.blueDeep)
            background=OwnerUi.pressable(this@VoiceActivity,OwnerUi.white,20)
            minHeight=dp(64)
        }
        val hang=Button(this).apply{
            text="挂断"
            isAllCaps=false
            textSize=17f
            setTextColor(OwnerUi.white)
            background=OwnerUi.pressable(this@VoiceActivity,OwnerUi.red,20)
            minHeight=dp(64)
        }
        actions.addView(speaker,LinearLayout.LayoutParams(0,dp(64),1f).apply{marginEnd=dp(9)})
        actions.addView(hang,LinearLayout.LayoutParams(0,dp(64),1f).apply{marginStart=dp(9)})
        panel.addView(actions,LinearLayout.LayoutParams(-1,-2))
        panel.addView(OwnerUi.label(this,"锁屏后语音仍由后台通话服务维护",12f,0xFFDAE7FF.toInt()).apply{
            gravity=Gravity.CENTER
            setPadding(0,dp(28),0,0)
        })
        setContentView(panel)
        speaker.setOnClickListener {
            startService(Intent(this,OngoingCallService::class.java).setAction(OngoingCallService.ACTION_SPEAKER))
        }
        hang.setOnClickListener {
            startService(Intent(this,OngoingCallService::class.java).setAction(OngoingCallService.ACTION_END))
            finish()
        }
        val callId = intent.getStringExtra("callId")
        val auth = intent.getStringExtra("ownerToken")
        if (callId != null && auth != null) {
            // Start only while this Activity is visible, immediately after the user tapped "Answer".
            if (!VoiceApi.validCallId(callId) || !Regex("^[A-Za-z0-9_-]{43}$").matches(auth)) { finish(); return }
            id=callId
            pendingAuth=auth
            // Do not keep private bearer tokens in the Activity intent after handoff.
            intent.removeExtra("ownerToken")
        } else {
            // Return-to-call from the ongoing notification carries no bearer
            // token. Reattach to the already running foreground service.
            id = OngoingCallService.currentCallId.orEmpty()
            if (id.isBlank()) status.text="暂无进行中的通话"
            else callWasActive=true
        }
    }
    override fun onResume() { super.onResume();handler.post(updateUi) }
    override fun onPostResume() {
        super.onPostResume()
        // API 34+ requires the microphone foreground service to start while this
        // Activity is visible. onCreate() is too early on some devices.
        val auth = pendingAuth ?: return
        pendingAuth = null
        try {
            startForegroundService(Intent(this,OngoingCallService::class.java)
                .setAction(OngoingCallService.ACTION_START)
                .putExtra("callId",id).putExtra("ownerToken",auth))
        } catch (e: Exception) {
            status.text = "无法开始后台通话：${e.javaClass.simpleName}"
        }
    }
    override fun onPause() { handler.removeCallbacks(updateUi);super.onPause() }
    // Deliberately no hangup in onPause/onStop/onDestroy: the foreground service owns the call.
}
