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
        versionCode = 13
        versionName = "0.7.1"
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
}
