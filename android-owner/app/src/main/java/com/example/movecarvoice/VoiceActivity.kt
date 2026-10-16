package com.example.movecarvoice

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.*

/** The Activity owns only controls. Audio & signaling outlive Activity/screen. */
class VoiceActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var speaker: Button
    private var id = ""
    private var starting = false
    private val updateUi = object: Runnable {
        override fun run() {
            status.text = OngoingCallService.state
            speaker.text = if (OngoingCallService.speakerEnabled) "关闭免提" else "开启免提"
            handler.postDelayed(this,700)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val panel = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; gravity=Gravity.CENTER; setPadding(30,50,30,50) }
        val title = TextView(this).apply { text="挪车网络通话";textSize=24f;gravity=Gravity.CENTER }
        status = TextView(this).apply { text="连接中…";textSize=18f;gravity=Gravity.CENTER }
        speaker = Button(this).apply { text="开启免提" }
        val hang = Button(this).apply { text="挂断" }
        listOf(title,status,speaker,hang).forEach { panel.addView(it,LinearLayout.LayoutParams(-1,-2)) }
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
            id=callId; starting=true
            try {
                startForegroundService(Intent(this,OngoingCallService::class.java)
                    .setAction(OngoingCallService.ACTION_START)
                    .putExtra("callId",callId).putExtra("ownerToken",auth))
            } catch(e:Exception) { status.text="无法开始后台通话：${e.javaClass.simpleName}" }
            // Do not keep private bearer tokens in Activity intent after handoff.
            intent.removeExtra("ownerToken")
        } else if (OngoingCallService.currentCallId==null) {
            status.text="暂无进行中的通话"
        }
    }
    override fun onResume() { super.onResume();handler.post(updateUi) }
    override fun onPause() { handler.removeCallbacks(updateUi);super.onPause() }
    // Deliberately no hangup in onPause/onStop/onDestroy: the foreground service owns the call.
}
