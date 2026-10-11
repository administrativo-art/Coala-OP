package com.coalaone.go.data

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import javax.inject.Inject

fun interface InstallerDownloader { suspend fun download(release: Release, progress: (Float) -> Unit): File }
class AppUpdater @Inject constructor(@ApplicationContext private val context: Context, private val client: OkHttpClient) : InstallerDownloader {
    override suspend fun download(release: Release, progress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val packagePath = requireNotNull(release.packagePath) { "Atualização ainda não publicada." }
        require(packagePath.startsWith('/') && !packagePath.startsWith("//"))
        val destination = File(context.cacheDir, "updates/CoalaGo-atualizacao.apk").apply { parentFile!!.mkdirs() }
        try {
            destination.outputStream().use { output ->
                var written = 0L; var expectedTotal: Long? = null
                while (expectedTotal == null || written < expectedTotal) {
                    val request = Request.Builder().url(com.coalaone.go.BuildConfig.API_BASE_URL.trimEnd('/') + packagePath).header("Range", "bytes=$written-${written + 8 * 1024 * 1024 - 1}").build()
                    client.newCall(request).execute().use { response ->
                        val range = Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(response.header("Content-Range").orEmpty()) ?: error("O servidor não entregou o instalador em partes.")
                        val (start, end, total) = range.destructured.toList().map(String::toLong)
                        require(response.code == 206 && start == written && end >= start && end < total && end - start + 1 <= 8 * 1024 * 1024 && total in 1..300 * 1024 * 1024 && (expectedTotal == null || expectedTotal == total))
                        val bytes = response.body!!.bytes()
                        require(bytes.size.toLong() == end - start + 1) { "Download incompleto." }
                        output.write(bytes); written += bytes.size; expectedTotal = total; progress(written.toFloat() / total)
                    }
                }
            }
            val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val archive = context.packageManager.getPackageArchiveInfo(destination.path, flags) ?: error("APK inválido")
            val installed = context.packageManager.getPackageInfo(context.packageName, flags)
            @Suppress("DEPRECATION") fun signatures(info: android.content.pm.PackageInfo): Set<List<Byte>> = (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)?.map { it.toByteArray().toList() }?.toSet().orEmpty()
            @Suppress("DEPRECATION") val version = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
            require(archive.packageName == context.packageName && version == release.versionCode.toLong() && signatures(archive).isNotEmpty() && signatures(archive) == signatures(installed)) { "O instalador não corresponde ao aplicativo e à assinatura atuais." }
            destination
        } catch (cause: Exception) { destination.delete(); throw cause }
    }
}
