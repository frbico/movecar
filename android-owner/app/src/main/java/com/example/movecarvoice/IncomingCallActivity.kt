package com.example.movecarvoice

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.*
import org.json.JSONObject

class IncomingCallActivity : Activity() {
    private var callId = ""
    private var testIncoming = false
    private lateinit var state: TextView
    private var busy = false
    private var verifying = false
    private var acceptButton: Button? = null
    private var rejectButton: Button? = null
    private val refreshHandler=Handler(Looper.getMainLooper())
    private val refreshIncoming=object:Runnable {
        override fun run() {
            if(!isFinishing&&!isDestroyed&&!testIncoming&&!busy) {
                val accept=acceptButton
                val reject=rejectButton
                if(accept!=null&&reject!=null)verifyIncoming(accept,reject,false)
            }
            if(!isFinishing&&!isDestroyed&&!testIncoming)
                refreshHandler.postDelayed(this,2500L)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        @Suppress("DEPRECATION")
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        testIncoming=intent.getBooleanExtra("testIncoming",false)
        callId = intent.getStringExtra("callId") ?: ""
        if (!testIncoming && !VoiceApi.validCallId(callId)) { finish();return }
        if(testIncoming && intent.getBooleanExtra("dismissTest",false)){
            (getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .cancel(CarMessagingService.TEST_NOTIFICATION_ID)
            finish();return
        }
        val health=getSharedPreferences("movecar_call_health",MODE_PRIVATE)
        if(!testIncoming && health.getString("lastIncomingCallId","")==callId) {
            health.edit().putLong("lastUiOpenedAt",System.currentTimeMillis()).apply()
        }
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
        state=OwnerUi.label(this,if(testIncoming)"测试：来电界面已显示" else "有人请求你挪车",25f,OwnerUi.white,true).apply{
            gravity=Gravity.CENTER
        }
        panel.addView(state)
        panel.addView(OwnerUi.label(this,if(testIncoming)"可关闭此界面，测试不会真的呼叫" else "匿名网络语音来电 · 不显示手机号",14f,0xFFDEE9FF.toInt()).apply{
            gravity=Gravity.CENTER
            setPadding(0,dp(12),0,dp(52))
        })
        val buttons=OwnerUi.horizontal(this)
        val accept=Button(this).apply{
            text=if(testIncoming)"完成测试" else "接听"
            isAllCaps=false
            textSize=18f
            setTextColor(OwnerUi.white)
            background=OwnerUi.pressable(this@IncomingCallActivity,OwnerUi.green,24)
            minHeight=dp(64)
        }
        val reject=Button(this).apply{
            text=if(testIncoming)"关闭" else "拒绝"
            isAllCaps=false
            textSize=18f
            setTextColor(OwnerUi.white)
            background=OwnerUi.pressable(this@IncomingCallActivity,OwnerUi.red,24)
            minHeight=dp(64)
        }
        acceptButton=accept
        rejectButton=reject
        if(!testIncoming){accept.isEnabled=false;reject.isEnabled=false}
        buttons.addView(reject,LinearLayout.LayoutParams(0,dp(64),1f).apply{marginEnd=dp(9)})
        buttons.addView(accept,LinearLayout.LayoutParams(0,dp(64),1f).apply{marginStart=dp(9)})
        panel.addView(buttons,LinearLayout.LayoutParams(-1,-2))
        setContentView(panel)
        accept.setOnClickListener { accept() }
        reject.setOnClickListener {
            if(testIncoming){
                (getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager)
                    .cancel(CarMessagingService.TEST_NOTIFICATION_ID)
                finish()
                return@setOnClickListener
            }
            if (busy) return@setOnClickListener
            busy=true
            state.text="正在拒接…"
            accept.isEnabled=false
            reject.isEnabled=false
            Thread {
                val result=runCatching {
                    VoiceApi.post(VoiceApi.base(this),"/api/voice/calls/$callId/reject",JSONObject(),VoiceApi.auth(this))
                }
                runOnUiThread {
                    if(isFinishing||isDestroyed)return@runOnUiThread
                    result.onSuccess {
                        CarMessagingService.cancel(this,callId)
                        finish()
                    }.onFailure {
                        busy=false
                        state.text="拒接未送达："+(it.message?:"网络异常")+"，请重试"
                        accept.isEnabled=true
                        reject.isEnabled=true
                    }
                }
            }.start()
        }
        if(!testIncoming)verifyIncoming(accept,reject,intent.getBooleanExtra("answer",false))
    }

    private fun verifyIncoming(acceptButton:Button,rejectButton:Button,autoAnswer:Boolean){
        if(verifying||busy)return
        verifying=true
        if(!acceptButton.isEnabled)state.text="正在确认来电状态…"
        Thread {
            val result=runCatching {
                VoiceApi.post(VoiceApi.base(this),
                    "/api/voice/calls/$callId/incoming",JSONObject(),VoiceApi.auth(this))
            }
            runOnUiThread {
                verifying=false
                if(isFinishing||isDestroyed||busy)return@runOnUiThread
                result.onSuccess { data ->
                    if(data.optBoolean("ringing",false)){
                        state.text="有人请求你挪车"
                        acceptButton.isEnabled=true
                        rejectButton.isEnabled=true
                        if(autoAnswer)accept()
                    }else{
                        state.text="此通来电已结束"
                        CarMessagingService.cancel(this,callId)
                        finish()
                    }
                }.onFailure {
                    // Keep manual controls available on transient mobile network
                    // errors. The authoritative answer/reject API still enforces
                    // that the call exists and is currently ringing.
                    state.text="无法确认来电状态，请检查网络后重试"
                    acceptButton.isEnabled=true
                    rejectButton.isEnabled=true
                }
            }
        }.start()
    }

    private fun accept() {
        if(testIncoming){
            (getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .cancel(CarMessagingService.TEST_NOTIFICATION_ID)
            finish()
            return
        }
        if (busy) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 42);return
        }
        busy=true;state.text="正在接通…"
        acceptButton?.isEnabled=false
        rejectButton?.isEnabled=false
        Thread {
            val result=runCatching { VoiceApi.post(VoiceApi.base(this),"/api/voice/calls/$callId/answer",JSONObject(),VoiceApi.auth(this)) }
            runOnUiThread {
                if(isFinishing||isDestroyed)return@runOnUiThread
                result.onSuccess { r ->
                    CarMessagingService.cancel(this,callId)
                    startActivity(Intent(this,VoiceActivity::class.java)
                        .putExtra("callId",callId).putExtra("ownerToken",r.getString("ownerToken")))
                    finish()
                }.onFailure {
                    busy=false
                    state.text="接听失败："+(it.message?:"网络异常")
                    acceptButton?.isEnabled=true
                    rejectButton?.isEnabled=true
                }
            }
        }.start()
    }
    override fun onResume(){
        super.onResume()
        refreshHandler.removeCallbacks(refreshIncoming)
        if(!testIncoming)refreshHandler.postDelayed(refreshIncoming,2500L)
    }

    override fun onPause(){
        refreshHandler.removeCallbacks(refreshIncoming)
        super.onPause()
    }

    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,results:IntArray) {
        super.onRequestPermissionsResult(requestCode,permissions,results)
        if (requestCode==42 && results.firstOrNull()==PackageManager.PERMISSION_GRANTED) accept()
        else if(requestCode==42)state.text="需要麦克风权限才能接听"
    }
}
