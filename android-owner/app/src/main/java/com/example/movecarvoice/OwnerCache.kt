package com.example.movecarvoice

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Private, account-scoped, bounded offline snapshot cache.
 * Only GET response snapshots; bearer/FCM tokens and passwords are NEVER cached here.
 * UI renders immediately from disk, then refreshes when stale/on user request.
 */
internal object OwnerCache {
    private const val NAME = "movecar_owner_cache_v1"
    private const val FRESH_MS = 60_000L
    private fun id(context: Context, path: String): String {
        val account = VoiceApi.base(context) + "|" +
            VoiceApi.username(context) + "|" + VoiceApi.mobileAuth(context) + "|" + path
        return MessageDigest.getInstance("SHA-256")
            .digest(account.toByteArray(Charsets.UTF_8))
            .take(16).joinToString("") { "%02x".format(it) }
    }
    private fun prefs(context: Context) = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)
    fun get(context: Context, path: String): JSONObject? =
        runCatching { JSONObject(prefs(context).getString("v_" + id(context,path), "") ?: "") }.getOrNull()

    fun fresh(context: Context, path: String): Boolean {
        val timestamp=prefs(context).getLong("t_"+id(context,path),0L)
        return timestamp>0 && System.currentTimeMillis()-timestamp in 0..FRESH_MS && get(context,path)!=null
    }
    fun put(context: Context, path: String, value: JSONObject) {
        val raw=value.toString()
        if(raw.length>220_000) return
        prefs(context).edit().putString("v_"+id(context,path),raw)
            .putLong("t_"+id(context,path),System.currentTimeMillis()).apply()
    }
    fun invalidate(context: Context) = prefs(context).edit().clear().apply()
}
