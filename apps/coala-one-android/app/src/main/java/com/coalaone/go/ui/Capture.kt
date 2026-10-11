package com.coalaone.go.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.coalaone.go.data.Document
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

private suspend fun readDocument(context: Context, uri: Uri): Document = withContext(Dispatchers.IO) {
    val type = context.contentResolver.getType(uri) ?: "image/jpeg"
    val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(16 * 1024)
        while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size() + count <= 15 * 1024 * 1024) { "Arquivo maior que 15 MB." }; output.write(buffer, 0, count) }
        output.toByteArray()
    } ?: error("Arquivo indisponível")
    val extension = when (type) { "application/pdf" -> "pdf"; "image/png" -> "png"; "image/webp" -> "webp"; else -> "jpg" }
    Document("documento-${UUID.randomUUID()}.$extension", type, bytes)
}
@Composable fun CaptureButtons(label: String, enabled: Boolean, imagesOnly: Boolean = false, onDocument: (Document) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var capture by rememberSaveable { mutableStateOf<String?>(null) }
    var capturePath by rememberSaveable { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    fun read(uri: Uri, capturedFile: String? = null) { scope.launch {
        try { onDocument(readDocument(context, uri)); error = null }
        catch (cause: Exception) { error = if (cause is IllegalArgumentException) cause.message else "Não foi possível abrir o documento." }
        finally { capturedFile?.let { File(it).delete() } }
    } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { read(it) } }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success -> if (success) capture?.let { read(Uri.parse(it), capturePath) } else capturePath?.let { File(it).delete() } }
    fun takePicture() {
        val file = File(context.cacheDir, "capture/${UUID.randomUUID()}.jpg").apply { parentFile!!.mkdirs() }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        capture = uri.toString(); capturePath = file.path; camera.launch(uri)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) takePicture() else error = "Permita a câmera ou escolha um arquivo." }
    TextLabel(label)
    Action("Fotografar", enabled = enabled, secondary = true) { if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) takePicture() else permission.launch(Manifest.permission.CAMERA) }
    Action("Escolher arquivo", enabled = enabled, secondary = true) { picker.launch(if (imagesOnly) arrayOf("image/jpeg", "image/png", "image/webp") else arrayOf("image/jpeg", "image/png", "image/webp", "application/pdf")) }
    error?.let { androidx.compose.material3.Text(it, color = Tokens.danger) }
}
@Composable private fun TextLabel(text: String) { androidx.compose.material3.Text(text, style = androidx.compose.material3.MaterialTheme.typography.titleMedium) }
