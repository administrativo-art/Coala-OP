package com.coalaone.go

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Alignment
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import coil3.ImageLoader
import com.coalaone.go.domain.Rules
import com.coalaone.go.ui.*
import dagger.hilt.android.AndroidEntryPoint
import java.io.File
import javax.inject.Inject

@AndroidEntryPoint class MainActivity : FragmentActivity() {
    private val session: SessionViewModel by viewModels()
    @Inject lateinit var images: ImageLoader
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        setContent { CoalaTheme {
            val identity by session.state.collectAsStateWithLifecycle()
            SideEffect {
                val lightSurface = !identity.loading && identity.identity != null && !identity.locked
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = false // every screen now has a dark surface under the status bar
                    isAppearanceLightNavigationBars = lightSurface && !Tokens.isDark
                }
            }
            val update: UpdateViewModel = hiltViewModel()
            DisposableEffect(update) {
                val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
                    if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME && (!BuildConfig.DEBUG || BuildConfig.LOCAL_TEST)) update.check()
                }
                lifecycle.addObserver(observer)
                onDispose { lifecycle.removeObserver(observer) }
            }
            val release by update.release.collectAsStateWithLifecycle()
            val feedback by update.feedback.collectAsStateWithLifecycle()
            val progress by update.progress.collectAsStateWithLifecycle()
            CompositionLocalProvider(LocalImages provides images, LocalOwner provides (identity.identity?.uid ?: "anonymous")) {
                when {
                    Rules.updateRequired(release, BuildConfig.VERSION_CODE) -> Page("Atualização necessária", feedback, footer = { Action("Baixar atualização", feedback.busy) { update.download(::install) } }) { Text("Atualize o Coala Go para continuar."); LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth()) }
                    identity.loading || identity.identity == null || identity.locked -> AuthScreen(session, ::biometric)
                    else -> AppNavigation(session, update)
                }
            }
        } }
    }
    override fun onStop() { session.stopped(); super.onStop() }
    override fun onStart() { super.onStart(); session.resumed() }
    private fun biometric() {
        if (BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) return
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { session.unlockBiometric() }
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Desbloquear Coala Go").setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG).setNegativeButtonText("Usar senha").build())
    }
    private fun install(file: File) {
        runOnUiThread {
            if (!packageManager.canRequestPackageInstalls()) { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:$packageName"))); return@runOnUiThread }
            val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }
    }
}
@Composable private fun AppNavigation(session: SessionViewModel, update: UpdateViewModel) {
    val nav = rememberNavController()
    val back: () -> Unit = { nav.popBackStack(); Unit }
    val motion = LocalMotionEnabled.current
    NavHost(nav, startDestination = "home",
        enterTransition = { fadeIn(tween(if (motion) 280 else 0)) + slideInVertically(tween(if (motion) 280 else 0)) { if (motion) 6 else 0 } },
        exitTransition = { fadeOut(tween(if (motion) 160 else 0)) },
        popEnterTransition = { fadeIn(tween(if (motion) 280 else 0)) },
        popExitTransition = { fadeOut(tween(if (motion) 160 else 0)) + slideOutVertically(tween(if (motion) 160 else 0)) { if (motion) 6 else 0 } }) {
        composable("home") { HomeScreen(hiltViewModel(), session, update) { nav.navigate(it) } }
        // Same HomeViewModel as the home entry, so a new photo shows up when the user goes back.
        composable("profile") { entry -> ProfileScreen(hiltViewModel(remember(entry) { nav.getBackStackEntry("home") }), session, update, back) }
        composable("count") { CountScreen(hiltViewModel(), back) }
        composable("receive") { ReceiveScreen(hiltViewModel(), back) }
        composable("purchase") { PurchaseScreen(hiltViewModel(), back) }
        composable("schedule") { ScheduleScreen(hiltViewModel(), back) }
        composable("goals") { GoalsScreen(hiltViewModel(), back) }
        composable("signage") { SignageScreen(hiltViewModel(), back) }
    }
}
private fun installUpdate(context: android.content.Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    if (context.packageManager.canRequestPackageInstalls()) context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    else context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:${context.packageName}")))
}
@Composable private fun HomeScreen(vm: HomeViewModel, session: SessionViewModel, update: UpdateViewModel, navigate: (String) -> Unit) {
    val state by vm.profile.collectAsStateWithLifecycle(); val feedback by vm.feedback.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle(); val release by update.release.collectAsStateWithLifecycle()
    val updateFeedback by update.feedback.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    val today by vm.today.collectAsStateWithLifecycle()
    val owner = LocalOwner.current
    val goalUnit = remember(owner) { context.getSharedPreferences("goals", android.content.Context.MODE_PRIVATE).getString("unit:$owner", null) }
    LaunchedEffect(state?.modules) { state?.modules?.let { vm.loadToday(it, goalUnit) } }
    val greeting = when (java.time.LocalTime.now().hour) { in 5..11 -> "Bom dia"; in 12..17 -> "Boa tarde"; else -> "Boa noite" }
    Page("Início", feedback, onRefresh = { vm.refresh(); state?.modules?.let { vm.loadToday(it, goalUnit, force = true) } }, header = {
        // The greeting is the title; the small brand sits above it and the avatar, on the right, opens the profile.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Brand(compact = true, small = true)
                Text("$greeting, ${state?.profile?.name?.substringBefore(' ') ?: "humano"}", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge.copy(fontSize = 24.sp, lineHeight = 30.sp), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(state?.profile?.email?.takeIf(String::isNotBlank) ?: state?.profile?.role.orEmpty(), color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
            ProfileAvatar(state?.profile?.name.orEmpty(), state?.profile?.avatarUrl) { navigate("profile") }
        }
        if (today.loaded) TodayHeader(today, pending.size, navigate)
    }) {
        if (session.mode.simulation) Text("Simulação · nenhum dado é enviado", color = Tokens.warning, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp))
        release?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }?.let { target -> CardBlock(selected = true) {
            Text("Atualização ${target.versionName} disponível", style = MaterialTheme.typography.titleMedium)
            Action("Baixar atualização", updateFeedback.busy) { update.download { file -> installUpdate(context, file) } }
            updateFeedback.error?.let { Text(it, color = Tokens.danger) }
        } }
        state?.modules?.let { modules ->
            if (modules.localPurchase) HomeTile("Compra local", "purchase", Modifier.fillMaxWidth(), pending.size) { navigate("purchase") }
            val tiles = listOf(Triple(modules.stockCount, "Contagem de estoque", "count"), Triple(modules.repositionReceipt, "Recebimento", "receive"), Triple(modules.goals, "Metas", "goals"), Triple(modules.schedule, "Escala", "schedule"), Triple(modules.signage, "Signage", "signage")).filter { it.first }
            tiles.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { (_, title, route) ->
                        val badge = when (route) { "count" -> "Em curso".takeIf { today.openCounts.isNotEmpty() }; "receive" -> today.repositions?.takeIf { it > 0 }?.toString(); "schedule" -> today.shiftShort; "goals" -> today.goalPercent?.let { "${Math.round(it)}%" }; else -> null }
                        HomeTile(title, route, Modifier.weight(1f).fillMaxHeight(), badge = badge, badgeWarm = route == "count") { navigate(route) }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            if (!(modules.localPurchase || modules.stockCount || modules.repositionReceipt || modules.schedule || modules.goals || modules.signage)) EmptyState("Nenhum módulo liberado", "Seu perfil não tem módulos liberados para o aplicativo.")
        }
    }
}
/**
 * "Hoje" as a continuation of the dark bar: a handle on its lower edge and nothing else;
 * tapping it opens the detail (shift, the unit's goal for the day, what is waiting), each line leading to its module.
 */
@Composable private fun ColumnScope.TodayHeader(today: HomeToday, pendingNotes: Int, navigate: (String) -> Unit) {
    val whole = java.text.NumberFormat.getIntegerInstance(java.util.Locale.forLanguageTag("pt-BR"))
    val lines = listOfNotNull(
        if (today.hasSchedule) Triple("Seu turno", today.shift?.let { shift -> today.shiftUnit?.let { "$shift · $it" } ?: shift } ?: "Sem turno hoje", "schedule") else null,
        if (today.goalDaily != null && today.goalToday != null) Triple("Meta do dia · ${today.goalUnit.orEmpty()}", "R$ ${whole.format(Math.round(today.goalToday))} de R$ ${whole.format(Math.round(today.goalDaily))}", "goals") else null,
        today.openCounts.takeIf { it.isNotEmpty() }?.let { Triple("Contagem em curso", it.joinToString(", "), "count") },
        today.repositions?.takeIf { it > 0 }?.let { Triple("Reposição a receber", if (it == 1) "1 reposição chegou ou está a caminho" else "$it reposições chegaram ou estão a caminho", "receive") },
        pendingNotes.takeIf { it > 0 }?.let { Triple("Notas no aparelho", if (it == 1) "1 nota aguardando envio ou revisão" else "$it notas aguardando envio ou revisão", "purchase") })
    if (lines.isEmpty()) return
    var open by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    val motion = LocalMotionEnabled.current
    androidx.compose.animation.AnimatedVisibility(open, enter = androidx.compose.animation.expandVertically(tween(if (motion) 220 else 0)) + fadeIn(tween(if (motion) 220 else 0)), exit = androidx.compose.animation.shrinkVertically(tween(if (motion) 160 else 0)) + fadeOut(tween(if (motion) 160 else 0))) {
        Column {
            lines.forEach { (label, value, route) ->
                HorizontalDivider(color = Tokens.onDark.copy(alpha = .1f))
                Row(Modifier.fillMaxWidth().clickable(role = androidx.compose.ui.semantics.Role.Button) { navigate(route) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(label, color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall)
                        Text(value, color = Tokens.onDark, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                    }
                    Text("›", color = Tokens.onDark3, style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
    // Only the handle on the lower edge of the bar, with no text: tapping it opens or closes the detail.
    Box(Modifier.fillMaxWidth().clickable(role = androidx.compose.ui.semantics.Role.Button, onClickLabel = if (open) "Recolher o resumo de hoje" else "Ver o resumo de hoje") { open = !open }.padding(top = 14.dp, bottom = 2.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(36.dp, 4.dp).background(Tokens.onDark.copy(alpha = .28f), RoundedCornerShape(4.dp)))
    }
}
/** Account chores live here, off the home screen: photo, refresh, update check and sign-out. */
@Composable private fun ProfileScreen(vm: HomeViewModel, session: SessionViewModel, update: UpdateViewModel, onBack: () -> Unit) {
    val state by vm.profile.collectAsStateWithLifecycle(); val feedback by vm.feedback.collectAsStateWithLifecycle()
    val release by update.release.collectAsStateWithLifecycle(); val updateFeedback by update.feedback.collectAsStateWithLifecycle()
    var signOut by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    Page("Perfil", feedback, onBack, onRefresh = { vm.refresh() }) {
        CardBlock {
            Text(state?.profile?.name.orEmpty(), style = MaterialTheme.typography.titleLarge)
            Text(listOfNotNull(state?.profile?.role?.takeIf(String::isNotBlank), state?.profile?.email?.takeIf(String::isNotBlank)).joinToString(" · "), color = Tokens.muted)
        }
        CardBlock { CaptureButtons("Foto de perfil", !feedback.busy, imagesOnly = true, onDocument = vm::avatar) }
        CardBlock {
            Text("Aplicativo", style = MaterialTheme.typography.titleMedium)
            Text("Coala Go ${BuildConfig.VERSION_NAME} · Android ${BuildConfig.VERSION_CODE}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            val target = release?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }
            // The app checks for a release every time it comes to the foreground; the button only exists when there is one.
            if (target != null) Action("Baixar atualização ${target.versionName}", updateFeedback.busy) { update.download { file -> installUpdate(context, file) } }
            else Text("Você está na versão mais recente.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            updateFeedback.error?.let { Text(it, color = Tokens.danger) }
        }
        if (signOut) InlineConfirmation("Sair da conta? Os documentos pendentes permanecem protegidos e vinculados a ela.", feedback.busy, { signOut = false }, "Sair da conta", session::signOut)
        else TextButton({ signOut = true }) { Text("Sair da conta", color = Tokens.danger) }
    }
}
