package de.ssxi.movecar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()))return;
        SecureStore store=new SecureStore(context);
        if(store.token().isEmpty())return;
        try{context.startForegroundService(new Intent(context,MoveService.class));}
        catch(Exception e){store.setConnection("开机后需打开 App 恢复接收");}
    }
}
