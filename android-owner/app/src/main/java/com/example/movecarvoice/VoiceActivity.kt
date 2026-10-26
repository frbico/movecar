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
    private lateinit var duration: TextView
    private lateinit var speaker: Button
    private lateinit var hang: Button
    private var id = ""
    private var pendingAuth: String? = null
    private var openedAt = SystemClock.elapsedRealtime()
    private var callWasActive = false
    private val updateUi = object: Runnable {
        override fun run() {
            val activeId=OngoingCallService.currentCallId
            val matching=CallUiState.matchesActiveCall(id,activeId)
            if(matching)callWasActive=true
            if(!matching && pendingAuth==null &&
                (callWasActive || SystemClock.elapsedRealtime()-openedAt>9500L)){
                // A stale page must never control the next caller's session.
                finish()
                return
            }
            if(matching){
                val ui=CallUiState.display(OngoingCallService.state,
                    OngoingCallService.connectedAtElapsedMs,SystemClock.elapsedRealtime(),true)
                status.text=ui.detail
                duration.text=ui.duration
            }else{
                status.text="正在初始化本次通话…"
                duration.text="等待接通"
            }
            speaker.isEnabled=matching
            hang.isEnabled=matching
            speaker.alpha=if(matching)1f else 0.5f
            speaker.text=if(OngoingCallService.speakerEnabled)"关闭免提" else "开启免提"
            handler.postDelayed(this,350)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val d=resources.displayMetrics.density
        fun dp(x:Int)=(x*d+0.5f).toInt()
        window.statusBarColor=OwnerUi.canvas
        window.navigationBarColor=OwnerUi.canvas
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility=android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
            android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        val panel=OwnerUi.vertical(this).apply{
            gravity=Gravity.CENTER
            setBackgroundColor(OwnerUi.canvas)
            setPadding(dp(24),dp(35),dp(24),dp(35))
        }
        val avatar=OwnerUi.label(this,"☎",42f,OwnerUi.green,true).apply{
            gravity=Gravity.CENTER
            background=OwnerUi.gradient(this@VoiceActivity)
        }
        panel.addView(avatar,LinearLayout.LayoutParams(dp(132),dp(132)).apply{
            gravity=Gravity.CENTER_HORIZONTAL
            bottomMargin=dp(30)
        })
        panel.addView(OwnerUi.label(this,"挪车网络通话",25f,OwnerUi.navy,true).apply{
            gravity=Gravity.CENTER
        })
        duration=OwnerUi.label(this,"等待接通",32f,OwnerUi.green,true).apply{
            gravity=Gravity.CENTER
            setPadding(0,dp(24),0,dp(4))
        }
        panel.addView(duration)
        status=OwnerUi.label(this,"连接中…",15f,OwnerUi.muted).apply{
            gravity=Gravity.CENTER
            setPadding(0,dp(10),0,dp(44))
        }
        panel.addView(status)
        val actions=OwnerUi.horizontal(this)
        speaker=OwnerUi.flatCallButton(this,"开启免提",OwnerUi.blueDeep,OwnerUi.softBlue).apply{
            textSize=16f
            minHeight=dp(64)
        }
        hang=OwnerUi.flatCallButton(this,"挂断",OwnerUi.white,OwnerUi.red).apply{
            textSize=17f
            minHeight=dp(64)
        }
        actions.addView(speaker,LinearLayout.LayoutParams(0,dp(64),1f).apply{marginEnd=dp(9)})
        actions.addView(hang,LinearLayout.LayoutParams(0,dp(64),1f).apply{marginStart=dp(9)})
        panel.addView(actions,LinearLayout.LayoutParams(-1,-2))
        setContentView(panel)
        speaker.setOnClickListener {
            if(!CallUiState.matchesActiveCall(id,OngoingCallService.currentCallId))return@setOnClickListener
            startService(Intent(this,OngoingCallService::class.java)
                .setAction(OngoingCallService.ACTION_SPEAKER).putExtra("callId",id))
        }
        hang.setOnClickListener {
            if(!CallUiState.matchesActiveCall(id,OngoingCallService.currentCallId))return@setOnClickListener
            startService(Intent(this,OngoingCallService::class.java)
                .setAction(OngoingCallService.ACTION_END).putExtra("callId",id))
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
            // Return-to-call can outlive the notification's original session.
            val expected=intent.getStringExtra("callId")
            val active=OngoingCallService.currentCallId
            if(expected!=null && !CallUiState.matchesActiveCall(expected,active)){
                finish();return
            }
            id=active.orEmpty()
            if(id.isBlank()){finish();return}
            callWasActive=true
        }
    }
    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(updateUi)
        handler.post(updateUi)
    }
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
