package com.coalaone.go.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.CachePolicy
import androidx.compose.ui.platform.LocalContext
import com.coalaone.go.BuildConfig
import com.coalaone.go.auth.RuntimeMode
import java.text.NumberFormat
import java.util.Locale

val LocalImages = staticCompositionLocalOf<ImageLoader> { error("ImageLoader unavailable") }
val LocalOwner = staticCompositionLocalOf { "anonymous" }
fun money(cents: Long) = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR")).format(cents / 100.0)
fun moneyValue(value: Double) = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR")).format(value)

@Composable fun Page(title: String, feedback: Feedback = Feedback(), onBack: (() -> Unit)? = null, footer: @Composable ColumnScope.() -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(Tokens.page).safeDrawingPadding().imePadding()) {
        Column(Modifier.fillMaxWidth().background(Tokens.dark).padding(20.dp)) {
            Text("COALA GO", color = Tokens.onDark2, style = MaterialTheme.typography.labelSmall)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (onBack != null) TextButton(onClick = onBack, enabled = !feedback.busy) { Text("← Voltar", color = Tokens.onDark) }
                Text(title, color = Tokens.onDark, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            }
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 600.dp).fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (feedback.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                feedback.error?.let { Text(it, color = Tokens.danger, modifier = Modifier.fillMaxWidth().background(Tokens.dangerBg).padding(12.dp)) }
                feedback.notice?.let { Text(it, color = Tokens.ok, modifier = Modifier.fillMaxWidth().background(Tokens.okBg).padding(12.dp)) }
                content()
            }
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 600.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp), content = footer)
        }
    }
}
@Composable fun Action(label: String, busy: Boolean = false, enabled: Boolean = true, secondary: Boolean = false, onClick: () -> Unit) {
    if (secondary) OutlinedButton(onClick, enabled = enabled && !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp)) { Text(label) }
    else Button(onClick, enabled = enabled && !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp)) { Text(if (busy) "Aguarde…" else label) }
}
@Composable fun Field(label: String, value: String, enabled: Boolean = true, decimal: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(value, onValueChange = onChange, enabled = enabled, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Text))
}
@OptIn(ExperimentalLayoutApi::class)
@Composable fun Choices(label: String, values: List<Pair<String, String>>, selected: String, enabled: Boolean = true, onSelect: (String) -> Unit) {
    Text(label, style = MaterialTheme.typography.titleMedium)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { values.forEach { (id, name) -> FilterChip(selected == id, onClick = { onSelect(id) }, enabled = enabled, label = { Text(name) }) } }
}
@Composable fun CardBlock(content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content) }
}
@Composable fun ProductPhoto(url: String?, label: String, size: Int = 52) {
    val context = LocalContext.current
    val uri = url?.let { if (it.startsWith('/') && !it.startsWith("//")) BuildConfig.API_BASE_URL.trimEnd('/') + it else it.takeIf { candidate -> candidate.startsWith("https://") || BuildConfig.LOCAL_TEST && candidate.startsWith("http://") } }
    if (uri == null) Text("Sem foto", style = MaterialTheme.typography.bodySmall)
    else AsyncImage(model = ImageRequest.Builder(context).data(uri).memoryCacheKey("${LocalOwner.current}:$uri").diskCachePolicy(CachePolicy.DISABLED).build(), contentDescription = label, imageLoader = LocalImages.current, modifier = Modifier.size(size.dp))
}
@Composable fun InlineConfirmation(message: String, busy: Boolean, onCancel: () -> Unit, label: String, onConfirm: () -> Unit) {
    CardBlock { Text(message); Action("Voltar", busy, secondary = true, onClick = onCancel); Action(label, busy, onClick = onConfirm) }
}
