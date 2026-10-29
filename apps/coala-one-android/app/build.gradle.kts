import java.util.Properties
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
    id("com.google.dagger.hilt.android")
}

val releaseRequested = gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }
val publicFirebase = mutableMapOf<String, String>()
val firebaseConfig = file(providers.environmentVariable("COALA_FIREBASE_CONFIG_FILE")
    .orElse(providers.gradleProperty("COALA_FIREBASE_CONFIG_FILE")).getOrElse("google-services.json"))
if (releaseRequested && firebaseConfig.isFile) {
    val config = JsonSlurper().parse(firebaseConfig) as Map<*, *>
    val project = config["project_info"] as Map<*, *>
    val client = (config["client"] as List<*>).map { it as Map<*, *> }.single {
        val info = it["client_info"] as Map<*, *>
        (info["android_client_info"] as Map<*, *>)["package_name"] == "coalaone.go"
    }
    publicFirebase["COALA_FIREBASE_APP_ID"] = (client["client_info"] as Map<*, *>)["mobilesdk_app_id"].toString()
    publicFirebase["COALA_FIREBASE_API_KEY"] = ((client["api_key"] as List<*>).first() as Map<*, *>)["current_key"].toString()
    publicFirebase["COALA_FIREBASE_PROJECT_ID"] = project["project_id"].toString()
    publicFirebase["COALA_FIREBASE_SENDER_ID"] = project["project_number"].toString()
}
fun configured(name: String, fallback: String = ""): String =
    providers.environmentVariable(name).orElse(providers.gradleProperty(name)).getOrElse(publicFirebase[name] ?: fallback)
fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// Public prerequisites are checked before invoking the existing signing process.
if (gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }) {
    require(configured("COALA_FIREBASE_API_KEY").isNotBlank() && configured("COALA_FIREBASE_PROJECT_ID").isNotBlank() && configured("COALA_FIREBASE_APP_ID").contains(":android:") && configured("COALA_FIREBASE_SENDER_ID").toLongOrNull() != null) { "Release exige configuração pública Firebase Android (COALA_FIREBASE_*)." }
}

android {
    namespace = "com.coalaone.go"
    compileSdk = 36
    defaultConfig {
        applicationId = "coalaone.go"
        minSdk = 26
        targetSdk = 36
        versionCode = configured("COALA_VERSION_CODE", "38").toInt()
        versionName = configured("COALA_VERSION_NAME", "0.3.33")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", quoted(configured("COALA_API_BASE_URL", "https://op.coalashakes.com")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(configured("COALA_FIREBASE_API_KEY")))
        buildConfigField("String", "FIREBASE_APP_ID", quoted(configured("COALA_FIREBASE_APP_ID")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(configured("COALA_FIREBASE_PROJECT_ID")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(configured("COALA_FIREBASE_SENDER_ID")))
        buildConfigField("boolean", "LOCAL_TEST", configured("COALA_LOCAL_TEST", "false"))
        manifestPlaceholders["allowCleartext"] = configured("COALA_LOCAL_TEST", "false")
        ksp { arg("room.schemaLocation", "$projectDir/schemas") }
    }
    // The existing signing process remains authoritative. Properties are consumed
    // in memory only, never copied into the repository or printed by this build.
    val signingFile = file(configured("COALA_ONE_KEYSTORE_PROPERTIES", "${System.getProperty("user.home")}/.coala-one/keystore.properties"))
    if (signingFile.isFile && gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }) {
        signingConfigs.create("existingRelease") {
            val props = Properties().apply { signingFile.inputStream().use { load(it) } }
            storeFile = file(props.getProperty("storeFile"))
            storePassword = props.getProperty("storePassword")
            keyAlias = props.getProperty("keyAlias")
            keyPassword = props.getProperty("keyPassword")
        }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            buildConfigField("String", "API_BASE_URL", quoted(configured("COALA_API_BASE_URL", "https://localhost:3000")))
            // Even a mixed debug/release invocation must not put real SDK-file
            // configuration in the debug app. Only explicit debug overrides apply.
            for (field in listOf("API_KEY", "APP_ID", "PROJECT_ID", "SENDER_ID")) {
                val name = "COALA_FIREBASE_$field"
                val value = providers.environmentVariable(name).orElse(providers.gradleProperty(name)).getOrElse("")
                buildConfigField("String", "FIREBASE_$field", quoted(value))
            }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.findByName("existingRelease")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
}

gradle.taskGraph.whenReady {
    if (allTasks.any { it.name.contains("Release", ignoreCase = true) }) {
        require(configured("COALA_FIREBASE_API_KEY").isNotBlank() && configured("COALA_FIREBASE_PROJECT_ID").isNotBlank() && configured("COALA_FIREBASE_APP_ID").contains(":android:") && configured("COALA_FIREBASE_SENDER_ID").toLongOrNull() != null) { "Release exige configuração pública Firebase Android (COALA_FIREBASE_*)." }
        require(configured("COALA_LOCAL_TEST", "false") == "false" && configured("COALA_API_BASE_URL", "https://op.coalashakes.com").startsWith("https://")) { "Release não pode usar configuração de teste ou HTTP." }
        require(configured("COALA_VERSION_CODE", "5").toInt() > 0) { "VersionCode do Coala Go precisa ser positivo." }
        require(android.signingConfigs.findByName("existingRelease") != null) { "Release exige a chave existente de ~/.coala-one via o processo de assinatura." }
    }
}

dependencies {
    val compose = platform("androidx.compose:compose-bom:2025.04.01")
    implementation(compose)
    androidTestImplementation(compose)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.fragment:fragment-ktx:1.8.6")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.navigation:navigation-compose:2.8.9")
    implementation("com.google.dagger:hilt-android:2.56.2")
    ksp("com.google.dagger:hilt-compiler:2.56.2")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")
    implementation("androidx.hilt:hilt-work:1.2.0")
    ksp("androidx.hilt:hilt-compiler:1.2.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
    implementation("io.coil-kt.coil3:coil-compose:3.1.0")
    implementation("androidx.exifinterface:exifinterface:1.4.1")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.1.0")
    implementation("androidx.room:room-runtime:2.7.1")
    implementation("androidx.room:room-ktx:2.7.1")
    ksp("androidx.room:room-compiler:2.7.1")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation(platform("com.google.firebase:firebase-bom:33.13.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    // CameraX captures frames but does not decode QR. ZXing core is the small,
    // offline decoder for the existing COALA-SIGNAGE contract (no network SDK).
    implementation("com.google.zxing:core:3.5.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.espresso:espresso-intents:3.6.1")
    androidTestImplementation("androidx.work:work-testing:2.10.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
