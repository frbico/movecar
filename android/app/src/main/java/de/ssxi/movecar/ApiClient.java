package de.ssxi.movecar;

import android.content.Context;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ApiClient {
    static final class ApiError extends Exception {
        final int status;
        ApiError(int status,String message){super(message);this.status=status;}
    }
    private final SecureStore store;
    ApiClient(Context context){store=new SecureStore(context);}
    private HttpURLConnection open(String method,String path) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(BuildConfig.BASE_URL+path).openConnection();
        c.setRequestMethod(method);c.setConnectTimeout(12000);c.setReadTimeout(20000);
        c.setRequestProperty("Accept","application/json");
        String token=store.token();if(!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);
        return c;
    }
    private static byte[] read(InputStream stream) throws Exception {
        if(stream==null)return new byte[0];
        try(InputStream input=stream;ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);return output.toByteArray();
        }
    }
    JSONObject json(String method,String path,JSONObject body) throws Exception {
        HttpURLConnection c=open(method,path);
        try {
            if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=c.getResponseCode();byte[] data=read(status>=400?c.getErrorStream():c.getInputStream());
            JSONObject result=data.length==0?new JSONObject():new JSONObject(new String(data,StandardCharsets.UTF_8));
            if(status>=400)throw new ApiError(status,result.optString("error","请求失败 HTTP "+status));
            return result;
        } finally {c.disconnect();}
    }
    byte[] photo(String id) throws Exception {
        HttpURLConnection c=open("GET","/api/app/requests/"+id+"/photo");
        try {int status=c.getResponseCode();if(status>=400)throw new ApiError(status,"照片已过期或无法访问");return read(c.getInputStream());}
        finally {c.disconnect();}
    }
}
