package com.example.movecarvoice

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.*
import org.json.JSONObject

class IncomingCallActivity : Activity() {
    private var callId = ""
    private lateinit var state: TextView
    private var busy = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true);setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        callId = intent.getStringExtra("callId") ?: ""
        if (!VoiceApi.validCallId(callId)) { finish();return }
        val panel = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(42,75,42,45);gravity=Gravity.CENTER }
        state = TextView(this).apply { text="📞 收到挪车语音来电";textSize=23f;gravity=Gravity.CENTER }
        val accept=Button(this).apply { text="接听语音" }
        val reject=Button(this).apply { text="拒绝" }
        listOf(state,accept,reject).forEach { panel.addView(it,LinearLayout.LayoutParams(-1,-2)) }
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
