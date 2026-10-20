package com.example.movecarvoice

import org.junit.Assert.*
import org.junit.Test

class ReleaseUpdatesTest {
    @Test fun parsesStrictSemanticVersions() {
        assertEquals(ReleaseUpdates.Version(0,8,0),ReleaseUpdates.parseVersion("0.8.0"))
        assertEquals(ReleaseUpdates.Version(10,12,3),ReleaseUpdates.parseVersion("v10.12.3"))
        assertNull(ReleaseUpdates.parseVersion("android-v0.8.0"))
        assertNull(ReleaseUpdates.parseVersion("0.8"))
        assertNull(ReleaseUpdates.parseVersion("0.8.0-preview"))
        assertNull(ReleaseUpdates.parseVersion("evil/path/0.8.0"))
    }
    @Test fun onlyOffersStrictlyNewerStableVersions() {
        assertTrue(ReleaseUpdates.isNewer("0.7.2","0.8.0"))
        assertTrue(ReleaseUpdates.isNewer("0.8.9","0.9.0"))
        assertTrue(ReleaseUpdates.isNewer("0.9.9","1.0.0"))
        assertFalse(ReleaseUpdates.isNewer("0.8.0","0.8.0"))
        assertFalse(ReleaseUpdates.isNewer("0.8.1","0.8.0"))
        assertFalse(ReleaseUpdates.isNewer("0.8.0","0.8.0-beta"))
        assertFalse(ReleaseUpdates.isNewer("invalid","0.8.0"))
    }
}
