package com.example.movecarvoice

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

/** Read-only GitHub Releases discovery. Explicit user action required for install. */
object ReleaseUpdates {
    const val RELEASES_PAGE = "https://github.com/frbico/movecar/releases"
    private const val API_URL = "https://api.github.com/repos/frbico/movecar/releases?per_page=25"
    data class Version(val major:Int,val minor:Int,val patch:Int):Comparable<Version> {
        override fun compareTo(other:Version):Int =
            compareValuesBy(this,other,Version::major,Version::minor,Version::patch)
    }
    data class Release(val version:String,val apkUrl:String,val pageUrl:String,val notes:String)

    fun parseVersion(text:String):Version? {
        val match=Regex("^v?(\\d{1,5})\\.(\\d{1,5})\\.(\\d{1,5})$").matchEntire(text)?:return null
        return runCatching {
            Version(match.groupValues[1].toInt(),match.groupValues[2].toInt(),match.groupValues[3].toInt())
        }.getOrNull()
    }
    fun isNewer(installed:String,candidate:String):Boolean {
        val current=parseVersion(installed)?:return false
        val latest=parseVersion(candidate)?:return false
        return latest>current
    }

    fun check():Release? {
        val connection=URL(API_URL).openConnection() as HttpURLConnection
        try {
            connection.requestMethod="GET"
            connection.connectTimeout=10000
            connection.readTimeout=10000
            connection.instanceFollowRedirects=false
            connection.setRequestProperty("Accept","application/vnd.github+json")
            connection.setRequestProperty("User-Agent","MoveCar-Owner-Android")
            if(connection.responseCode!=200)throw IllegalStateException(
                "GitHub 返回 HTTP ${connection.responseCode}，请稍后重试")
            val releases=connection.inputStream.bufferedReader().use{it.readText()}
            val list=JSONArray(releases)
            var newest:Release?=null
            for(i in 0 until list.length()){
                val item=list.optJSONObject(i)?:continue
                if(item.optBoolean("draft",false)||item.optBoolean("prerelease",false))continue
                val tag=item.optString("tag_name")
                if(!Regex("^android-v\\d+\\.\\d+\\.\\d+$").matches(tag))continue
                val version=tag.removePrefix("android-v")
                val name="MoveCar-Owner-v$version.apk"
                val expected="https://github.com/frbico/movecar/releases/download/$tag/$name"
                val assets=item.optJSONArray("assets")?:continue
                var found=false
                for(j in 0 until assets.length()){
                    val asset=assets.optJSONObject(j)?:continue
                    if(asset.optString("name")==name && asset.optString("browser_download_url")==expected &&
                        asset.optLong("size")>0){
                        found=true;break
                    }
                }
                if(!found)continue
                val page="https://github.com/frbico/movecar/releases/tag/$tag"
                val candidate=Release(version,expected,page,item.optString("body","").take(1000))
                if(newest==null || isNewer(newest.version,version))newest=candidate
            }
            return newest
        }finally{connection.disconnect()}
    }
}
