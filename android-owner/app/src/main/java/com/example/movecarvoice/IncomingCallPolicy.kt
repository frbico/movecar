package com.example.movecarvoice

/** Small, permission-aware decisions shared by the incoming-call path. */
internal object IncomingCallPolicy {
    // Android NotificationManager.IMPORTANCE_HIGH is 4; MAX is 5.
    fun mayUseWakeFallback(fullScreenAllowed: Boolean, notificationsEnabled: Boolean,
                           channelImportance: Int): Boolean =
        fullScreenAllowed && notificationsEnabled && channelImportance >= 4

    fun shouldPromptForPermissions(allGranted: Boolean, currentState: String,
                                   promptedState: String?, promptedAt: Long,
                                   now: Long): Boolean =
        !allGranted && (currentState != promptedState || promptedAt <= 0L ||
            now < promptedAt || now - promptedAt >= 7L * 24 * 60 * 60 * 1000)
}
