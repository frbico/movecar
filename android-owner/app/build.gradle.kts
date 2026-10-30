plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}
android {
    namespace = "com.example.movecarvoice"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.example.movecarvoice"
        minSdk = 26
        targetSdk = 35
        versionCode = 22
        versionName = "0.8.7"
    }
    // Release builds use a persistent keystore supplied via Actions secrets.
    // Local debug builds do not need it; we never publish debug-signed APKs.
    val signingKeyFile = System.getenv("MOVECAR_SIGNING_KEYSTORE_FILE")
    if (!signingKeyFile.isNullOrBlank()) {
        signingConfigs {
            create("distribution") {
                storeFile = file(signingKeyFile)
                storePassword = System.getenv("MOVECAR_SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("MOVECAR_SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("MOVECAR_SIGNING_KEY_PASSWORD")
            }
        }
        buildTypes {
            getByName("release") {
                signingConfig = signingConfigs.getByName("distribution")
                isDebuggable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("io.github.webrtc-sdk:android:150.7871.01")
    testImplementation("junit:junit:4.13.2")
}
