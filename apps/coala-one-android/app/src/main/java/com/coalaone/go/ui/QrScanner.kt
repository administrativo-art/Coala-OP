package com.coalaone.go.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable fun QrScanner(onCode: (String) -> Unit, onCancel: () -> Unit, previewModifier: Modifier = Modifier.fillMaxWidth().height(280.dp), dark: Boolean = false) {
    val context = LocalContext.current; val lifecycle = LocalLifecycleOwner.current
    var permission by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var error by remember { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permission = it }
    LaunchedEffect(Unit) { if (!permission) launcher.launch(Manifest.permission.CAMERA) }
    if (!permission) { Text("Permita a câmera ou digite o código do monitor.", color = if (dark) Tokens.onDark else Tokens.ink); Action("Fechar câmera", secondary = true, dark = dark, onClick = onCancel); return }
    val preview = remember { PreviewView(context) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val done = remember { AtomicBoolean(false) }
    val callback by rememberUpdatedState(onCode)
    DisposableEffect(lifecycle) {
        var provider: ProcessCameraProvider? = null
        var boundPreview: Preview? = null; var boundAnalysis: ImageAnalysis? = null
        var disposed = false
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (!disposed) try {
                provider = future.get()
                val cameraPreview = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                val reader = MultiFormatReader().apply { setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))) }
                analysis.setAnalyzer(executor) { image ->
                    try {
                        if (!done.get()) {
                            val plane = image.planes[0]; val buffer = plane.buffer; val bytes = ByteArray(image.width * image.height)
                            for (y in 0 until image.height) for (x in 0 until image.width) bytes[y * image.width + x] = buffer.get(y * plane.rowStride + x * plane.pixelStride)
                            val source = PlanarYUVLuminanceSource(bytes, image.width, image.height, 0, 0, image.width, image.height, false)
                            val result = reader.decodeWithState(BinaryBitmap(HybridBinarizer(source)))
                            if (result.text.startsWith("COALA-SIGNAGE:", ignoreCase = true) && com.coalaone.go.domain.Rules.pairingCode(result.text) != null && done.compareAndSet(false, true)) ContextCompat.getMainExecutor(context).execute { callback(result.text) }
                        }
                    } catch (_: NotFoundException) { /* Continue scanning. */ }
                    catch (_: Exception) { /* Bad frame; not a business failure. */ }
                    finally { reader.reset(); image.close() }
                }
                boundPreview = cameraPreview; boundAnalysis = analysis
                provider!!.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, cameraPreview, analysis)
            } catch (_: Exception) { error = "Câmera indisponível. Digite o código." }
        }, ContextCompat.getMainExecutor(context))
        onDispose { disposed = true; boundAnalysis?.clearAnalyzer(); boundPreview?.let { provider?.unbind(it) }; boundAnalysis?.let { provider?.unbind(it) }; executor.shutdown() }
    }
    AndroidView(factory = { preview }, modifier = previewModifier)
    error?.let { Text(it, color = Tokens.danger) }
    Action("Fechar câmera", secondary = true, dark = dark, onClick = onCancel)
}
