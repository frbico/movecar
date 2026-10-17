package com.example.movecarvoice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("callId") ?: return
        if (!VoiceApi.validCallId(id)) return
        CarMessagingService.cancel(context)
        val pending = goAsync()
        Thread {
            try {
                val base = VoiceApi.base(context); val auth = VoiceApi.auth(context)
                if (base.isNotBlank() && auth.isNotBlank()) VoiceApi.post(base, "/api/voice/calls/$id/reject", JSONObject(), auth)
            } catch (_: Exception) { } finally { pending.finish() }
        }.start()
    }
}
