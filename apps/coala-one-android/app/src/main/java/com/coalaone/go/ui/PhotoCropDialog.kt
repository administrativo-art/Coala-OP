package com.coalaone.go.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.graphics.scale
import androidx.exifinterface.media.ExifInterface
import com.coalaone.go.data.Document
import com.coalaone.go.domain.CropSquare
import com.coalaone.go.domain.PhotoCrop
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID

/** Longest side kept in memory while framing; a camera photo is several times larger than the picture that is sent. */
private const val WORKING_SIDE = 3072

/** Decodes the photo already reduced and upright: the camera records the rotation apart from the pixels. */
private fun decodeUpright(bytes: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > WORKING_SIDE) sample *= 2
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val orientation = runCatching { ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
        else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
}
private fun cropToDocument(bitmap: Bitmap, crop: CropSquare): Document {
    val side = minOf(crop.side, PhotoCrop.OUTPUT_SIDE)
    val square = Bitmap.createBitmap(bitmap, crop.left, crop.top, crop.side, crop.side).scale(side, side)
    val output = ByteArrayOutputStream().also { square.compress(Bitmap.CompressFormat.JPEG, 90, it) }
    return Document("perfil-${UUID.randomUUID()}.jpg", "image/jpeg", output.toByteArray())
}

/**
 * The person frames their own profile picture: drag to move, pinch or use the slider to zoom. What is inside the
 * circle is exactly what is sent, so a large photo can be chosen and adjusted here.
 */
@Composable fun PhotoCropDialog(photo: Document, onCancel: () -> Unit, onConfirm: (Document) -> Unit) {
    val scope = rememberCoroutineScope()
    var bitmap by remember(photo) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(photo) { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var frame by remember { mutableFloatStateOf(0f) }
    var zoom by remember(photo) { mutableFloatStateOf(PhotoCrop.MIN_ZOOM) }
    var offset by remember(photo) { mutableStateOf(Offset.Zero) }
    LaunchedEffect(photo) { bitmap = withContext(Dispatchers.Default) { runCatching { decodeUpright(photo.bytes) }.getOrNull() }; failed = bitmap == null }
    fun move(nextZoom: Float, pan: Offset) {
        val image = bitmap ?: return
        val target = PhotoCrop.zoom(nextZoom)
        // Zooming keeps the point at the centre of the frame where it is.
        val (x, y) = PhotoCrop.clamp(image.width, image.height, target, frame, offset.x * target / zoom + pan.x, offset.y * target / zoom + pan.y)
        zoom = target; offset = Offset(x, y)
    }
    Dialog(onDismissRequest = { if (!saving) onCancel() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Tokens.dark).safeDrawingPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Ajuste a foto", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
            Text("Arraste para posicionar e use dois dedos ou a barra para aproximar.", color = Tokens.onDark2, style = MaterialTheme.typography.bodySmall)
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                val image = bitmap
                when {
                    failed -> Text("Não foi possível abrir a foto. Escolha outra imagem.", color = Tokens.onDark)
                    image == null -> Text("Abrindo a foto…", color = Tokens.onDark2)
                    else -> {
                        val pixels = remember(image) { image.asImageBitmap() }
                        Canvas(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(20.dp)).onSizeChanged { frame = it.width.toFloat() }
                            .semantics { contentDescription = "Recorte da foto de perfil" }
                            .pointerInput(image) { detectTransformGestures { _, pan, gesture, _ -> move(zoom * gesture, pan) } }) {
                            val crop = PhotoCrop.square(image.width, image.height, zoom, size.width, offset.x, offset.y)
                            drawImage(pixels, IntOffset(crop.left, crop.top), IntSize(crop.side, crop.side), dstSize = IntSize(size.width.toInt(), size.height.toInt()), filterQuality = FilterQuality.Medium)
                            // Everything outside the circle is dimmed: the circle is how the picture appears in the app.
                            val radius = size.minDimension / 2
                            drawPath(Path().apply { fillType = PathFillType.EvenOdd; addRect(Rect(Offset.Zero, size)); addOval(Rect(center, radius)) }, Tokens.dark.copy(alpha = .72f))
                            drawCircle(Tokens.onDark.copy(alpha = .85f), radius = radius - 1.dp.toPx(), style = Stroke(2.dp.toPx()))
                        }
                    }
                }
            }
            if (bitmap != null) Slider(zoom, { move(it, Offset.Zero) }, enabled = !saving, valueRange = PhotoCrop.MIN_ZOOM..PhotoCrop.MAX_ZOOM,
                colors = SliderDefaults.colors(thumbColor = Tokens.pink, activeTrackColor = Tokens.pink, inactiveTrackColor = Tokens.track),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Aproximação da foto" })
            Action("Usar esta foto", busy = saving, enabled = bitmap != null && frame > 0f, dark = true) {
                val image = bitmap ?: return@Action
                val crop = PhotoCrop.square(image.width, image.height, zoom, frame, offset.x, offset.y)
                saving = true
                scope.launch {
                    val result = withContext(Dispatchers.Default) { runCatching { cropToDocument(image, crop) }.getOrNull() }
                    saving = false
                    if (result == null) failed = true else onConfirm(result)
                }
            }
            Action("Cancelar", enabled = !saving, secondary = true, dark = true, onClick = onCancel)
        }
    }
}
