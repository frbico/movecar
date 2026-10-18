package com.example.movecarvoice

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.app.KeyguardManager
import android.os.Build
import android.widget.*
import org.json.JSONObject

class IncomingCallActivity : Activity() {
    private var callId = ""
    private lateinit var state: TextView
    private var busy = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        @Suppress("DEPRECATION")
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD)
        if (Build.VERSION.SDK_INT >= 26)
            (getSystemService(KEYGUARD_SERVICE) as? KeyguardManager)
                ?.requestDismissKeyguard(this, null)
        callId = intent.getStringExtra("callId") ?: ""
        if (!VoiceApi.validCallId(callId)) { finish();return }
        val d=resources.displayMetrics.density
        fun dp(x:Int)=(x*d+0.5f).toInt()
        window.statusBarColor=OwnerUi.blueDeep
        window.navigationBarColor=OwnerUi.blueDeep
        val panel=OwnerUi.vertical(this).apply{
            gravity=Gravity.CENTER
            background=OwnerUi.gradient(this@IncomingCallActivity)
            setPadding(dp(24),dp(35),dp(24),dp(35))
        }
        panel.addView(OwnerUi.label(this,"MOVE CAR · 来电提醒",13f,0xFFD9E8FF.toInt(),true).apply{
            gravity=Gravity.CENTER
        },LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(30)})
        val caller=OwnerUi.label(this,"CAR",28f,OwnerUi.white,true).apply{
            gravity=Gravity.CENTER
            background=OwnerUi.bg(0xFF4D8BEE.toInt(),70,this@IncomingCallActivity)
        }
        panel.addView(caller,LinearLayout.LayoutParams(dp(108),dp(108)).apply{
            gravity=Gravity.CENTER_HORIZONTAL
            bottomMargin=dp(32)
        })
        state=OwnerUi.label(this,"有人请求你挪车",25f,OwnerUi.white,true).apply{
            gravity=Gravity.CENTER
        }
        panel.addView(state)
        panel.addView(OwnerUi.label(this,"匿名网络语音来电 · 不显示手机号",14f,0xFFDEE9FF.toInt()).apply{
            gravity=Gravity.CENTER
            setPadding(0,dp(12),0,dp(52))
        })
        val buttons=OwnerUi.horizontal(this)
        val accept=Button(this).apply{
            text="接听"
            isAllCaps=false
            textSize=18f
            setTextColor(OwnerUi.white)
            background=OwnerUi.pressable(this@IncomingCallActivity,OwnerUi.green,24)
            minHeight=dp(64)
        }
        val reject=Button(this).apply{
            text="拒绝"
            isAllCaps=false
            textSize=18f
            setTextColor(OwnerUi.white)
            background=OwnerUi.pressable(this@IncomingCallActivity,OwnerUi.red,24)
            minHeight=dp(64)
        }
        buttons.addView(reject,LinearLayout.LayoutParams(0,dp(64),1f).apply{marginEnd=dp(9)})
        buttons.addView(accept,LinearLayout.LayoutParams(0,dp(64),1f).apply{marginStart=dp(9)})
        panel.addView(buttons,LinearLayout.LayoutParams(-1,-2))
        setContentView(panel)
        accept.setOnClickListener { accept() }
        reject.setOnClickListener {
            if (busy) return@setOnClickListener
            busy=true;CarMessagingService.cancel(this)
            Thread { runCatching { VoiceApi.post(VoiceApi.base(this),"/api/voice/calls/$callId/reject",JSONObject(),VoiceApi.auth(this)) };runOnUiThread{finish()} }.start()
        }
        if (intent.getBooleanExtra("answer",false)) accept()
    }
    private fun accept() {
        if (busy) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 42);return
        }
        busy=true;state.text="正在接通…";CarMessagingService.cancel(this)
        Thread {
            val result=runCatching { VoiceApi.post(VoiceApi.base(this),"/api/voice/calls/$callId/answer",JSONObject(),VoiceApi.auth(this)) }
            runOnUiThread {
                result.onSuccess { r ->
                    startActivity(Intent(this,VoiceActivity::class.java).putExtra("callId",callId).putExtra("ownerToken",r.getString("ownerToken")))
                    finish()
                }.onFailure { busy=false;state.text="接听失败：${it.message}" }
            }
        }.start()
    }
    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,results:IntArray) {
        super.onRequestPermissionsResult(requestCode,permissions,results)
        if (requestCode==42 && results.firstOrNull()==PackageManager.PERMISSION_GRANTED) accept()
        else if(requestCode==42)state.text="需要麦克风权限才能接听"
    }
}
