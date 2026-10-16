package de.ssxi.movecar;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

final class CrashReporter {
    private static final String PREFS = "movecar-diagnostics";
    private static final String LAST_CRASH = "last-crash";
    private static boolean installed;

    private CrashReporter() {}

    static synchronized void install(Context context) {
        if (installed) return;
        installed = true;
        Context application = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                String report = "MoveCar " + BuildConfig.VERSION_NAME + " · " + android.os.Build.MANUFACTURER
                        + " " + android.os.Build.MODEL + " · Android " + android.os.Build.VERSION.RELEASE
                        + "\n" + Log.getStackTraceString(error);
                if (report.length() > 12000) report = report.substring(0, 12000);
                application.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString(LAST_CRASH, report).commit();
            } catch (Exception ignored) {
                // Preserve the original Android crash handling even if diagnostics fail.
            } finally {
                if (previous != null) previous.uncaughtException(thread, error);
            }
        });
    }

    static String lastCrash(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return prefs.getString(LAST_CRASH, "");
    }

    static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(LAST_CRASH).apply();
    }
}
