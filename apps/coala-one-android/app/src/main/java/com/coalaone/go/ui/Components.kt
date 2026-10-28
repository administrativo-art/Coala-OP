package com.coalaone.go.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.border
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.selection.selectable
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.font.FontWeight
import com.coalaone.go.domain.Rules
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
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
val LocalDeveloperViewAsName = staticCompositionLocalOf<String?> { null }
fun money(cents: Long) = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR")).format(cents / 100.0)
fun moneyValue(value: Double) = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR")).format(value)

private val ptBR: Locale = Locale.forLanguageTag("pt-BR")
/** dd/MM/yyyy for an ISO date or instant; the original text survives when it is not a date. */
fun fullDate(value: String?): String {
    if (value.isNullOrBlank()) return ""
    return try { java.time.LocalDate.parse(value.take(10)).format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy", ptBR)) } catch (_: Exception) { value }
}
fun percentText(value: Double): String = NumberFormat.getNumberInstance(ptBR).apply { maximumFractionDigits = 1 }.format(value) + "%"
/** Short pt-BR date for list rows; the API sends ISO instants or plain dates. */
fun shortDate(value: String?): String? {
    if (value.isNullOrBlank()) return null
    val locale = Locale.forLanguageTag("pt-BR")
    return try { java.time.Instant.parse(value).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("dd/MM 'às' HH:mm", locale)) }
    catch (_: Exception) { try { java.time.LocalDate.parse(value.take(10)).format(java.time.format.DateTimeFormatter.ofPattern("dd/MM", locale)) } catch (_: Exception) { null } }
}
@Composable private fun BarButton(label: String, enabled: Boolean, onClick: () -> Unit, glyph: DrawScope.(Color) -> Unit) {
    val tint = if (enabled) Tokens.onDark2 else Tokens.onDark2.copy(alpha = .4f)
    // 38dp bordered square from the prototype, inside a 44dp touch target.
    Box(Modifier.size(44.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Box(Modifier.size(38.dp).border(1.dp, Tokens.onDark.copy(alpha = .14f), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) { Canvas(Modifier.size(18.dp)) { glyph(tint) } }
    }
}
/** One navigation bar for every screen: back on the left, optional kicker, title, actions on the right. */
@Composable fun TopBar(title: String, subtitle: String = "", busy: Boolean = false, onBack: (() -> Unit)? = null, onRefresh: (() -> Unit)? = null, action: Pair<String, () -> Unit>? = null, kicker: String = "") {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (onBack != null) BarButton("Voltar", !busy, onBack) { tint ->
            val stroke = 1.8.dp.toPx(); val mid = size.height / 2
            drawLine(tint, Offset(size.width * .2f, mid), Offset(size.width * .82f, mid), stroke, StrokeCap.Round)
            drawLine(tint, Offset(size.width * .2f, mid), Offset(size.width * .48f, size.height * .24f), stroke, StrokeCap.Round)
            drawLine(tint, Offset(size.width * .2f, mid), Offset(size.width * .48f, size.height * .76f), stroke, StrokeCap.Round)
        }
        Column(Modifier.weight(1f)) {
            if (kicker.isNotBlank()) Text(kicker.uppercase(Locale.forLanguageTag("pt-BR")), color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.4.sp))
            Text(title, color = Tokens.onDark, style = if (action != null) MaterialTheme.typography.titleLarge.copy(fontSize = 19.sp, lineHeight = 23.sp) else MaterialTheme.typography.titleLarge, maxLines = if (action != null) 2 else 1, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotBlank()) Text(subtitle, color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (onRefresh != null) BarButton("Atualizar", !busy, onRefresh) { tint ->
            val inset = size.width * .16f
            drawArc(tint, 30f, 300f, false, Offset(inset, inset), Size(size.width - inset * 2, size.height - inset * 2), style = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round))
            drawPath(androidx.compose.ui.graphics.Path().apply { moveTo(size.width * .87f, size.height * .5f); lineTo(size.width * .93f, size.height * .24f); lineTo(size.width * .66f, size.height * .38f); close() }, tint)
        }
        action?.let { (label, run) -> Box(Modifier.heightIn(min = 34.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, Tokens.onDark.copy(alpha = .14f), RoundedCornerShape(10.dp)).clickable(enabled = !busy, role = Role.Button, onClick = run).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) { Text(label, color = Tokens.onDark, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp)) } }
    }
}
@Composable fun Page(title: String, feedback: Feedback = Feedback(), onBack: (() -> Unit)? = null, footer: (@Composable ColumnScope.() -> Unit)? = null, header: (@Composable ColumnScope.() -> Unit)? = null, onRefresh: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val online = rememberOnline()
    CompositionLocalProvider(LocalContentColor provides Tokens.ink) {
    Box(Modifier.fillMaxSize().background(Tokens.page).imePadding()) {
        Column(Modifier.fillMaxSize()) {
            // The dark bar runs under the status bar, so no strip of page colour shows above it.
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp)).background(Tokens.dark).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 18.dp)) {
                if (header != null) header() else TopBar(title, busy = feedback.busy, onBack = onBack)
            }
            LocalDeveloperViewAsName.current?.let { targetName ->
                Text("Visualizando como $targetName · somente leitura", color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                    modifier = Modifier.fillMaxWidth().background(Tokens.warningBg).padding(horizontal = 20.dp, vertical = 10.dp))
            }
            // What survives without a connection is said in words, not left for the person to guess.
            if (!online) Text("Sem conexão. Os registros salvos neste aparelho serão enviados quando a conexão voltar. Algumas consultas precisam de internet.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 10.dp).background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp))
            val body: @Composable () -> Unit = {
                // Cada rota começa no topo. Sem a chave, o mesmo slot do Compose herdava a
                // rolagem da lista anterior ao abrir, por exemplo, o Detalhe do dia.
                key(title) {
                    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)).verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                        Column(Modifier.widthIn(max = 600.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
                    }
                }
            }
            // Lists refresh by pulling down; there is no refresh button in the bar.
            @OptIn(ExperimentalMaterial3Api::class)
            if (onRefresh != null) {
                // The indicator only shows for a pull the person made, and always goes away: tying it straight to
                // "busy" left it stuck on screen when a load finished within a frame.
                var pulled by remember { mutableStateOf(false) }
                LaunchedEffect(pulled, feedback.busy) { if (pulled && !feedback.busy) { kotlinx.coroutines.delay(350); pulled = false } }
                androidx.compose.material3.pulltorefresh.PullToRefreshBox(isRefreshing = pulled, onRefresh = { pulled = true; onRefresh() }, modifier = Modifier.weight(1f).fillMaxWidth()) { body() }
            }
            else Box(Modifier.weight(1f).fillMaxWidth()) { body() }
            val hasFooter = footer != null || feedback.error != null || feedback.notice != null
            if (hasFooter && footer != null) HorizontalDivider(color = Tokens.border)
            Column(Modifier.fillMaxWidth().then(if (footer != null) Modifier.background(Tokens.surface) else Modifier).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)).padding(horizontal = 16.dp, vertical = if (hasFooter) 12.dp else 0.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Column(Modifier.widthIn(max = 600.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Messages sit next to the actions, so they stay visible wherever the list is scrolled.
                    feedback.error?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp), modifier = Modifier.fillMaxWidth().background(Tokens.dangerBg, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 10.dp)) }
                    feedback.notice?.let { Text(it, color = Tokens.onDark, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 13.sp), modifier = Modifier.fillMaxWidth().background(Tokens.dark, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 12.dp)) }
                    footer?.invoke(this)
                }
            }
        }
        // Prototype busy state: a scrim with a spinner over the whole phone.
        if (feedback.busy) Column(Modifier.fillMaxSize().background(Tokens.dark.copy(alpha = .72f)).clickable(enabled = false) {}, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            CircularProgressIndicator(color = Tokens.pink, trackColor = Tokens.onDark.copy(alpha = .18f), strokeWidth = 3.dp, modifier = Modifier.size(38.dp))
            Spacer(Modifier.height(14.dp)); Text("Aguarde…", color = Tokens.onDark, style = MaterialTheme.typography.titleMedium)
        }
    }
    }
}
/** Follows the default network of the phone; without the system service the app assumes it is online. */
@Composable fun rememberOnline(): Boolean {
    val context = LocalContext.current
    val manager = remember { context.getSystemService(android.net.ConnectivityManager::class.java) }
    fun connected() = manager?.let { service -> service.getNetworkCapabilities(service.activeNetwork)?.let { capabilities ->
        capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    } == true } ?: true
    var online by remember { mutableStateOf(connected()) }
    DisposableEffect(manager) {
        val callback = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) { online = connected() }
            override fun onCapabilitiesChanged(network: android.net.Network, capabilities: android.net.NetworkCapabilities) { online = connected() }
            override fun onLost(network: android.net.Network) { online = connected() }
        }
        runCatching { manager?.registerDefaultNetworkCallback(callback) }
        onDispose { runCatching { manager?.unregisterNetworkCallback(callback) } }
    }
    return online
}
/** "Anterior | Próximo" footer pair from the prototype. */
@Composable fun FooterPair(back: String, backEnabled: Boolean, onBack: () -> Unit, next: String, nextEnabled: Boolean, onNext: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.weight(1f)) { Action(back, enabled = backEnabled, secondary = true, onClick = onBack) }
        Box(Modifier.weight(1f)) { Action(next, enabled = nextEnabled, onClick = onNext) }
    }
}
@Composable fun StatusChip(text: String, ink: Color, background: Color) { Text(text, color = ink, style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, letterSpacing = 0.sp, fontWeight = FontWeight.ExtraBold), modifier = Modifier.background(background, RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 3.dp)) }
/** Pill filter from the prototype: dark when selected, outlined otherwise. */
@Composable fun PillChoice(label: String, selected: Boolean, enabled: Boolean = true, accent: Boolean = false, onClick: () -> Unit) {
    val ink = when { selected && accent -> Tokens.wine; selected -> Tokens.pillInk; else -> Tokens.muted }
    val fill = when { selected && accent -> Tokens.accentSoft; selected -> Tokens.pillFill; else -> Tokens.surface }
    val line = when { selected && accent -> Tokens.accent; selected -> Tokens.pillFill; else -> Tokens.fieldBorder }
    Text(label, color = ink, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp), modifier = Modifier.clip(RoundedCornerShape(50)).background(fill).border(1.dp, line, RoundedCornerShape(50)).selectable(selected, enabled, Role.RadioButton, onClick).padding(horizontal = 13.dp, vertical = 8.dp))
}
/** Label above a plain input, as the prototype draws quantities and notes. */
@Composable fun LabeledInput(label: String, value: String, enabled: Boolean = true, decimal: Boolean = false, placeholder: String = "", alert: Color? = null, modifier: Modifier = Modifier, keyboardType: KeyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Text, visualTransformation: VisualTransformation = VisualTransformation.None, onChange: (String) -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (label.isNotBlank()) Text(label, color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold))
        OutlinedTextField(value, onValueChange = onChange, enabled = enabled, singleLine = true, shape = RoundedCornerShape(12.dp), placeholder = { if (placeholder.isNotBlank()) Text(placeholder, color = Tokens.faint) },
            colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Tokens.soft, focusedContainerColor = Tokens.soft, disabledContainerColor = Tokens.soft, unfocusedBorderColor = alert ?: Tokens.fieldBorder, focusedBorderColor = alert ?: Tokens.accent),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label.ifBlank { placeholder } }, keyboardOptions = KeyboardOptions(keyboardType = keyboardType), visualTransformation = visualTransformation)
    }
}
@Composable fun SectionLabel(text: String) { Text(text.uppercase(Locale.forLanguageTag("pt-BR")), color = Tokens.muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 6.dp, start = 4.dp)) }
/** Whole-row tap target for lists of units and deliveries. */
@Composable fun ListRow(title: String, subtitle: String, enabled: Boolean = true, badge: String? = null, highlight: Boolean = false, leading: String? = null, onClick: () -> Unit) {
    Card(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, if (highlight) Tokens.pink.copy(alpha = .5f) else Tokens.border), colors = CardDefaults.cardColors(containerColor = Tokens.surface, disabledContainerColor = Tokens.surface)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 68.dp).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).background(if (highlight) Tokens.accentSoft else Tokens.soft, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                Text(leading ?: unitInitials(title), color = if (highlight) Tokens.accent else Tokens.ink, style = MaterialTheme.typography.titleMedium)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (subtitle.isNotBlank()) Text(subtitle, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            badge?.let { Text(it, color = Tokens.accent, style = MaterialTheme.typography.labelLarge.copy(fontSize = 12.sp), modifier = Modifier.background(Tokens.accentSoft, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 5.dp)) }
            Canvas(Modifier.size(14.dp)) {
                val stroke = 2.dp.toPx()
                drawLine(Tokens.muted, Offset(size.width * .3f, size.height * .1f), Offset(size.width * .75f, size.height / 2), stroke, StrokeCap.Round)
                drawLine(Tokens.muted, Offset(size.width * .75f, size.height / 2), Offset(size.width * .3f, size.height * .9f), stroke, StrokeCap.Round)
            }
        }
    }
}
@Composable fun Action(label: String, busy: Boolean = false, enabled: Boolean = true, secondary: Boolean = false, dark: Boolean = false, onClick: () -> Unit) {
    if (secondary) OutlinedButton(onClick, enabled = enabled && !busy, colors = ButtonDefaults.outlinedButtonColors(containerColor = if (dark) Color.Transparent else Tokens.surface, contentColor = if (dark) Tokens.onDark else Tokens.ink, disabledContentColor = if (dark) Tokens.onDark2 else Tokens.muted), shape = RoundedCornerShape(13.dp), border = BorderStroke(1.dp, if (dark) Tokens.onDark.copy(alpha = .14f) else Tokens.fieldBorder), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(label) }
    else Button(onClick, enabled = enabled && !busy, colors = ButtonDefaults.buttonColors(disabledContainerColor = if (dark) Tokens.accent.copy(alpha = .32f) else Tokens.ink.copy(alpha = .12f), disabledContentColor = if (dark) Tokens.onDark.copy(alpha = .6f) else Tokens.muted), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (busy) "Aguarde…" else label) }
}

@Composable fun Field(label: String, value: String, enabled: Boolean = true, decimal: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(value, onValueChange = onChange, enabled = enabled, shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Tokens.soft, focusedContainerColor = Tokens.soft), label = { Text(label) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Text))
}
@OptIn(ExperimentalLayoutApi::class)
@Composable fun Choices(label: String, values: List<Pair<String, String>>, selected: String, enabled: Boolean = true, onSelect: (String) -> Unit) {
    when {
        // A single option that is already chosen is information, not a choice.
        values.size == 1 && values[0].first == selected -> Column { Text(label, color = Tokens.muted, style = MaterialTheme.typography.bodySmall); Text(values[0].second, style = MaterialTheme.typography.titleMedium) }
        values.size > 6 -> Picker(label, values, selected, enabled, onSelect)
        else -> {
            Text(label, style = MaterialTheme.typography.titleMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { values.forEach { (id, name) -> FilterChip(selected == id, onClick = { onSelect(id) }, enabled = enabled, label = { Text(name) }) } }
        }
    }
}
/**
 * The one arrow for anything that opens a list or unfolds a section: it points down while closed and up
 * while open. Drawn, not typed: the arrow character changed weight and height from one phone font to another.
 */
@Composable fun DropdownChevron(open: Boolean, color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(width = 11.dp, height = 7.dp)) {
        val stroke = 1.8.dp.toPx(); val inset = stroke / 2
        val tip = Offset(size.width / 2, if (open) inset else size.height - inset); val base = if (open) size.height - inset else inset
        drawLine(color, Offset(inset, base), tip, stroke, cap = StrokeCap.Round)
        drawLine(color, Offset(size.width - inset, base), tip, stroke, cap = StrokeCap.Round)
    }
}
@Composable private fun SelectorCard(label: String, value: String?, placeholder: String, enabled: Boolean, onClick: () -> Unit) {
    Card(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Tokens.fieldBorder), colors = CardDefaults.cardColors(containerColor = Tokens.soft, disabledContainerColor = Tokens.soft)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Text(label, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                Text(value ?: placeholder, color = if (value == null) Tokens.muted else Tokens.ink, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            DropdownChevron(false, Tokens.muted)
        }
    }
}
/** Long lists (categories, products, units) open in a sheet with search instead of a wall of chips. */
@Composable fun Picker(label: String, values: List<Pair<String, String>>, selected: String, enabled: Boolean = true, onSelect: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    SelectorCard(label, values.firstOrNull { it.first == selected }?.second, "Selecionar", enabled) { open = true }
    if (open) PickerSheet(label, values, selected, onSelect) { open = false }
}
/** Compact switcher in a dark page header: the unit in Metas and Escala, the organization in Compra local. */
@Composable fun UnitPickerHeader(values: List<Pair<String, String>>, selected: String, busy: Boolean, label: String = "Unidade", action: String = "Trocar unidade", onSelect: (String) -> Unit) {
    if (values.isEmpty()) return
    var choosingUnit by rememberSaveable { mutableStateOf(false) }
    val several = values.size > 1
    if (choosingUnit) PickerSheet(label, values, selected, onSelect) { choosingUnit = false }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).border(1.dp, Tokens.onDark.copy(alpha = .14f), RoundedCornerShape(14.dp)).clickable(enabled = several && !busy, role = Role.Button, onClickLabel = action) { choosingUnit = true }.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f)) {
            Text(label.uppercase(), color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp))
            Text(values.firstOrNull { it.first == selected }?.second ?: "Escolher ${label.lowercase()}", color = Tokens.onDark, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (several) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(action, color = Tokens.pink, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp))
            DropdownChevron(choosingUnit, Tokens.pink)
        }
    }
}
/** Searchable unit list used by the shared header switcher and other pickers. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PickerSheet(label: String, values: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, onDismiss: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tokens.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(label, style = MaterialTheme.typography.titleLarge)
            if (values.size > 6) Field("Buscar", query) { query = it }
            val shown = values.filter { it.second.contains(query.trim(), ignoreCase = true) }
            if (shown.isEmpty()) Text("Nada encontrado.", color = Tokens.muted)
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
                items(shown) { (id, name) ->
                    Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { onSelect(id); onDismiss() }.heightIn(min = 52.dp).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(name, modifier = Modifier.weight(1f), fontWeight = if (id == selected) FontWeight.Bold else FontWeight.Normal)
                        if (id == selected) Text("Selecionado", color = Tokens.accent, style = MaterialTheme.typography.bodySmall)
                    }
                    HorizontalDivider(color = Tokens.border)
                }
            }
        }
    }
}
/** ISO date chosen on a calendar; the value sent to the API stays AAAA-MM-DD. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun DateField(label: String, iso: String, enabled: Boolean = true, optional: Boolean = false, onChange: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val parsed = runCatching { java.time.LocalDate.parse(iso) }.getOrNull()
    SelectorCard(label, parsed?.let { fullDate(iso) }, if (optional) "Sem data" else "Selecionar data", enabled) { open = true }
    if (open) {
        val picker = rememberDatePickerState(initialSelectedDateMillis = parsed?.atStartOfDay(java.time.ZoneOffset.UTC)?.toInstant()?.toEpochMilli())
        DatePickerDialog(onDismissRequest = { open = false },
            confirmButton = { TextButton({ picker.selectedDateMillis?.let { onChange(java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneOffset.UTC).toLocalDate().toString()) }; open = false }) { Text("Confirmar") } },
            dismissButton = { if (optional) TextButton({ onChange(""); open = false }) { Text("Sem data") } else TextButton({ open = false }) { Text("Cancelar") } }) { DatePicker(picker) }
    }
}
@Composable private fun StepButton(glyph: String, label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(Tokens.surface).border(1.dp, Tokens.fieldBorder, RoundedCornerShape(12.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Text(glyph, color = if (enabled) Tokens.ink else Tokens.muted, style = MaterialTheme.typography.titleLarge)
    }
}
/** Quantity with one-hand − and + next to the keyboard field. */
@Composable fun QuantityField(label: String, value: String, enabled: Boolean = true, emptyAtZero: Boolean = true, onChange: (String) -> Unit) {
    fun bump(delta: Double) { val next = (Rules.quantity(value) + delta).coerceAtLeast(0.0); onChange(if (next == 0.0 && emptyAtZero) "" else Rules.quantityText(next)) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StepButton("−", "Diminuir $label", enabled && Rules.quantity(value) > 0) { bump(-1.0) }
        Box(Modifier.weight(1f)) { Field(label, value, enabled, decimal = true, onChange = onChange) }
        StepButton("+", "Aumentar $label", enabled) { bump(1.0) }
    }
}
@Composable fun CheckRow(label: String, checked: Boolean, enabled: Boolean = true, dark: Boolean = false, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(checked, enabled, Role.Checkbox, onChange), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Checkbox(checked, null, enabled = enabled, colors = if (dark) CheckboxDefaults.colors(checkedColor = Tokens.pink, uncheckedColor = Tokens.onDark2, checkmarkColor = Tokens.dark) else CheckboxDefaults.colors())
        Text(label, color = if (dark) Tokens.onDark2 else Tokens.ink)
    }
}
@Composable fun EmptyState(title: String, hint: String = "") {
    Column(Modifier.fillMaxWidth().background(Tokens.surface.copy(alpha = .6f), RoundedCornerShape(18.dp)).border(1.dp, Tokens.border, RoundedCornerShape(18.dp)).padding(horizontal = 20.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (hint.isNotBlank()) Text(hint, color = Tokens.muted, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
    }
}
@Composable fun StatBox(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.background(Tokens.soft, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}
@Composable fun CardBlock(selected: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth().then(if (LocalMotionEnabled.current) Modifier.animateContentSize() else Modifier), shape = RoundedCornerShape(18.dp), border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) Tokens.accent else Tokens.border), colors = CardDefaults.cardColors(containerColor = Tokens.surface)) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content) }
}
@Composable fun StepHeader(title: String, subtitle: String, step: Int, steps: Int, busy: Boolean, onBack: () -> Unit, labels: List<String> = emptyList(), backLabel: String = "Voltar", onRefresh: (() -> Unit)? = null, kicker: String = "", aside: String = "") {
    TopBar(title, subtitle, busy, onBack, onRefresh, action = if (backLabel != "Voltar") backLabel to onBack else null, kicker = kicker)
    Spacer(Modifier.height(12.dp))
    if (labels.isNotEmpty()) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        labels.forEachIndexed { index, label -> Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.fillMaxWidth().height(4.dp).background(if (index <= step) Tokens.pink else Tokens.onDark.copy(alpha = .14f), RoundedCornerShape(4.dp)))
            Text("${index + 1} $label", color = if (index == step) Tokens.onDark else Tokens.onDark4, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 11.5.sp))
        } }
    } else {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text("Etapa ${step + 1} de $steps", color = Tokens.onDark, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp), modifier = Modifier.weight(1f))
            if (aside.isNotBlank()) Text(aside, color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        AnimatedProgress((step + 1).toFloat() / steps, duration = 300, height = 5, track = Tokens.onDark.copy(alpha = .14f), fill = androidx.compose.ui.graphics.SolidColor(Tokens.pink))
    }
}
@Composable fun ProductPhoto(url: String?, label: String, size: Int = 52) {
    val context = LocalContext.current
    val uri = url?.let { if (it.startsWith('/') && !it.startsWith("//")) BuildConfig.API_BASE_URL.trimEnd('/') + it else it.takeIf { candidate -> candidate.startsWith("https://") || BuildConfig.LOCAL_TEST && candidate.startsWith("http://") } }
    Box(Modifier.size(size.dp).clip(RoundedCornerShape(12.dp)).background(Tokens.soft), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size((size * .42f).dp)) {
            val stroke = 1.6.dp.toPx()
            drawRoundRect(Tokens.fieldBorder, cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()), style = Stroke(stroke))
            drawCircle(Tokens.fieldBorder, this.size.minDimension * .1f, Offset(this.size.width * .3f, this.size.height * .32f))
            drawLine(Tokens.fieldBorder, Offset(this.size.width * .12f, this.size.height * .82f), Offset(this.size.width * .45f, this.size.height * .5f), stroke, StrokeCap.Round)
            drawLine(Tokens.fieldBorder, Offset(this.size.width * .45f, this.size.height * .5f), Offset(this.size.width * .88f, this.size.height * .82f), stroke, StrokeCap.Round)
        }
        if (uri != null) AsyncImage(model = ImageRequest.Builder(context).data(uri).memoryCacheKey("${LocalOwner.current}:$uri").diskCachePolicy(CachePolicy.DISABLED).build(), contentDescription = label, imageLoader = LocalImages.current, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}
@Composable fun InlineConfirmation(message: String, busy: Boolean, onCancel: () -> Unit, label: String, onConfirm: () -> Unit) {
    InlineConfirmation(message, busy, onCancel, "Voltar", label, onConfirm)
}
@Composable fun InlineConfirmation(message: String, busy: Boolean, onCancel: () -> Unit, cancelLabel: String, label: String, onConfirm: () -> Unit) {
    CardBlock { Text(message); Action(cancelLabel, busy, secondary = true, onClick = onCancel); Action(label, busy, onClick = onConfirm) }
}
