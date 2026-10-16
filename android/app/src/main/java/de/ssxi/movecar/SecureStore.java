package de.ssxi.movecar;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore {
    private static final String ALIAS = "movecar-device-credential-v1";
    private final SharedPreferences prefs;

    SecureStore(Context context) { prefs=context.getApplicationContext().getSharedPreferences("movecar",Context.MODE_PRIVATE); }

    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey)store.getKey(ALIAS,null);
    }
    synchronized void save(String token,String platform) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] sealed=cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        prefs.edit().putString("token",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(sealed,Base64.NO_WRAP))
                .putString("platform",platform).apply();
    }
    synchronized String token() {
        String value=prefs.getString("token","");
        if (value.isEmpty()) return "";
        try {
            String[] parts=value.split(":",2);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
        } catch(Exception e) {clear();return "";}
    }
    synchronized String platform() {return prefs.getString("platform","");}
    synchronized void clear() {prefs.edit().remove("token").remove("platform").remove("seen").apply();}
    synchronized boolean markSeen(String id) {
        String seen=prefs.getString("seen","");
        if (seen.contains("|"+id+"|")) return false;
        String next=seen+"|"+id+"|";
        if (next.length()>12000) next=next.substring(next.length()-6000);
        prefs.edit().putString("seen",next).apply();return true;
    }
    synchronized void markInitialSeen(String id) {markSeen(id);}
    void setConnection(String status) {prefs.edit().putString("connection",status).apply();}
    String connection() {return prefs.getString("connection","未连接");}
}
