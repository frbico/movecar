package com.example.movecarvoice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingCallPolicyTest {
    @Test fun highAndMaximumPriorityBothAllowShortWakeFallback() {
        assertTrue(IncomingCallPolicy.mayUseWakeFallback(true, true, 4))
        assertTrue(IncomingCallPolicy.mayUseWakeFallback(true, true, 5))
        assertFalse(IncomingCallPolicy.mayUseWakeFallback(true, true, 3))
        assertFalse(IncomingCallPolicy.mayUseWakeFallback(false, true, 5))
        assertFalse(IncomingCallPolicy.mayUseWakeFallback(true, false, 5))
    }

    @Test fun changedPermissionStatePromptsAgainWithoutRepeatedDialogs() {
        val now = 1_000_000_000L
        assertTrue(IncomingCallPolicy.shouldPromptForPermissions(false,"true:3:false",null,0,now))
        assertFalse(IncomingCallPolicy.shouldPromptForPermissions(false,"true:3:false",
            "true:3:false",now,now+1000))
        assertTrue(IncomingCallPolicy.shouldPromptForPermissions(false,"true:4:false",
            "true:3:false",now,now+1000))
        assertFalse(IncomingCallPolicy.shouldPromptForPermissions(true,"true:4:true",
            "true:3:false",now,now+1000))
    }
}
