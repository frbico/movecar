package com.example.movecarvoice

import org.junit.Assert.*
import org.junit.Test

class CallUiStateTest {
    @Test fun oldNotificationCannotControlAnotherCall() {
        assertTrue(CallUiState.matchesActiveCall("call-001","call-001"))
        assertFalse(CallUiState.matchesActiveCall("call-old","call-new"))
        assertFalse(CallUiState.matchesActiveCall(null,"call-new"))
        assertFalse(CallUiState.matchesActiveCall("call-old",null))
        assertFalse(CallUiState.matchesActiveCall("",""))
    }

    @Test fun durationUsesConnectedTimeAndNeverGoesNegative() {
        assertEquals("00:00",CallUiState.duration(-8))
        assertEquals("00:07",CallUiState.duration(7))
        assertEquals("01:01",CallUiState.duration(61))
        assertEquals("60:00",CallUiState.duration(3600))
        val connecting=CallUiState.display("正在连接…",0,120000,true)
        assertEquals("等待接通",connecting.duration)
        assertFalse(connecting.connected)
        val connected=CallUiState.display("通话中",100000,161800,true)
        assertEquals("01:01",connected.duration)
        assertEquals("语音已接通",connected.detail)
        assertTrue(connected.connected)
    }

    @Test fun recoveryIsVisibleWithoutResettingElapsedTime() {
        val recovering=CallUiState.display("正在恢复语音…",40000,80000,true)
        assertEquals("网络中断，正在尝试恢复…",recovering.detail)
        assertEquals("00:40",recovering.duration)
        assertTrue(recovering.inProgress)
        val stale=CallUiState.display("通话中",40000,80000,false)
        assertEquals("通话已结束",stale.detail)
        assertFalse(stale.inProgress)
    }
}
