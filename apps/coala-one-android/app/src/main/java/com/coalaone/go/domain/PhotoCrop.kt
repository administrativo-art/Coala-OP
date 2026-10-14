package com.coalaone.go.domain

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Square of the photo, in photo pixels, that fills the round frame of the profile picture. */
data class CropSquare(val left: Int, val top: Int, val side: Int)

/**
 * Framing of the profile photo. Zoom 1 fits the shorter side of the photo in the frame; the offset is how far
 * the person dragged the photo, in frame pixels, away from the centred position.
 */
object PhotoCrop {
    const val MIN_ZOOM = 1f
    const val MAX_ZOOM = 5f
    /** Side of the uploaded picture: enough for every avatar of the app and the web, small enough to never hit the upload limit. */
    const val OUTPUT_SIDE = 720

    fun zoom(value: Float) = value.coerceIn(MIN_ZOOM, MAX_ZOOM)
    /** Frame pixels per photo pixel. */
    private fun scale(width: Int, height: Int, zoom: Float, frame: Float) = frame / min(width, height) * zoom
    /** The photo never leaves the frame uncovered: the drag stops at its edges. */
    fun clamp(width: Int, height: Int, zoom: Float, frame: Float, x: Float, y: Float): Pair<Float, Float> {
        val scale = scale(width, height, zoom, frame)
        val limitX = max(0f, (width * scale - frame) / 2); val limitY = max(0f, (height * scale - frame) / 2)
        return x.coerceIn(-limitX, limitX) to y.coerceIn(-limitY, limitY)
    }
    fun square(width: Int, height: Int, zoom: Float, frame: Float, x: Float, y: Float): CropSquare {
        val scale = scale(width, height, zoom, frame)
        val side = (frame / scale).roundToInt().coerceIn(1, min(width, height))
        val (offsetX, offsetY) = clamp(width, height, zoom, frame, x, y)
        // Dragging the photo to the right reveals what is to the left of its centre.
        val left = (width / 2f - offsetX / scale - side / 2f).roundToInt().coerceIn(0, width - side)
        val top = (height / 2f - offsetY / scale - side / 2f).roundToInt().coerceIn(0, height - side)
        return CropSquare(left, top, side)
    }
}
