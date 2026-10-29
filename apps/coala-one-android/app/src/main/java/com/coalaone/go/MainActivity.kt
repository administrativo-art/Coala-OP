package com.coalaone.go

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.navigation.NavType
import androidx.navigation.navArgument
import coil3.ImageLoader
import com.coalaone.go.domain.Rules
import com.coalaone.go.domain.TimeRules
import com.coalaone.go.data.Modules
import com.coalaone.go.ui.*
import android.Manifest
import android.os.Build
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import java.io.File
import javax.inject.Inject

private val SCREEN_CAPTURE_ACCOUNTS = setOf(
    "administrativo@coalashakes.com",
    "tiagobrasill@yahoo.com",
)
@AndroidEntryPoint class MainActivity : FragmentActivity() {
    private val session: SessionViewModel by viewModels()
    @Inject lateinit var images: ImageLoader
    @Inject lateinit var timeOfflineScheduler: com.coalaone.go.offline.TimeOfflineScheduler
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        setContent { CoalaTheme {
            val identity by session.state.collectAsStateWithLifecycle()
            val online = rememberOnline()
            val viewAs by session.developerViewAs.collectAsStateWithLifecycle()
            LaunchedEffect(identity.identity?.uid, identity.loading, identity.locked, viewAs.targetUserId, online) {
                val uid = identity.identity?.uid
                if (uid != null && !identity.loading && !identity.locked && viewAs.targetUserId == null && !session.mode.simulation)
                    timeOfflineScheduler.prepare(uid)
            }
            // Screens stay out of screenshots and recents, except for the accounts that send captures for app review.
            val captureAllowed = !identity.locked && identity.identity?.email?.lowercase() in SCREEN_CAPTURE_ACCOUNTS
            LaunchedEffect(captureAllowed) {
                if (captureAllowed) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
            // Local unlock is part of the first successful sign-in flow, so offline access is
            // offered without requiring the person to discover a setup card in Profile.
            LaunchedEffect(identity.identity?.uid, identity.loading, identity.locked, identity.localUnlockEnabled) {
                if (!identity.loading && identity.identity != null && !identity.locked
                    && !identity.localUnlockEnabled && !session.mode.simulation) {
                    biometric(enroll = true)
                }
            }
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
                    else -> AppNavigation(session, update) { biometric(enroll = true) }
                }
            }
        } }
    }
    override fun onStop() { session.stopped(); super.onStop() }
    override fun onStart() { super.onStart(); session.resumed() }
    private fun biometric(enroll: Boolean = false) {
        if (BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) return
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { if (enroll) session.enableBiometricUnlock() else session.unlockBiometric() }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(if (enroll) "Ativar acesso offline" else "Desbloquear Coala Go")
            .setSubtitle(if (enroll) "Use a biometria para abrir o app sem conexão" else null)
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText("Usar senha")
            .build()
        prompt.authenticate(info)
    }
    private fun install(file: File) {
        runOnUiThread {
            if (!packageManager.canRequestPackageInstalls()) { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:$packageName"))); return@runOnUiThread }
            val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }
    }
}
@Composable private fun AppNavigation(session: SessionViewModel, update: UpdateViewModel, onPrepareBiometric: () -> Unit) {
    val nav = rememberNavController()
    val developerViewAs by session.developerViewAs.collectAsStateWithLifecycle()
    val back: () -> Unit = { nav.popBackStack(); Unit }
    val motion = LocalMotionEnabled.current
    CompositionLocalProvider(LocalDeveloperViewAsName provides developerViewAs.targetName) { NavHost(nav, startDestination = "home",
        enterTransition = { fadeIn(tween(if (motion) 280 else 0)) + slideInVertically(tween(if (motion) 280 else 0)) { if (motion) 6 else 0 } },
        exitTransition = { fadeOut(tween(if (motion) 160 else 0)) },
        popEnterTransition = { fadeIn(tween(if (motion) 280 else 0)) },
        popExitTransition = { fadeOut(tween(if (motion) 160 else 0)) + slideOutVertically(tween(if (motion) 160 else 0)) { if (motion) 6 else 0 } }) {
        composable("home") { HomeScreen(hiltViewModel(), session, update) { nav.navigate(it) } }
        // Same HomeViewModel as the home entry, so a new photo shows up when the user goes back.
        composable("profile") { entry -> ProfileScreen(hiltViewModel(remember(entry) { nav.getBackStackEntry("home") }), session, update, back, onPrepareBiometric) }
        composable("count") { CountScreen(hiltViewModel(), back) }
        composable("receive") { ReceiveScreen(hiltViewModel(), back) }
        composable("purchase") { PurchaseScreen(hiltViewModel(), back) }
        composable("schedule") { ScheduleScreen(hiltViewModel(), back,
            onRequestAbsence = { date -> nav.navigate("requests/absence/$date") },
            onRequestSwap = { date -> nav.navigate("requests/swap/$date") }) }
        composable("goals") { GoalsScreen(hiltViewModel(), back) }
        composable("signage") { SignageScreen(hiltViewModel(), back) }
        composable("time") { TimeScreen(hiltViewModel(), back) }
        composable("time/register") { TimeScreen(hiltViewModel(), back, startConfirming = true) }
        composable("time/day/{date}", arguments = listOf(navArgument("date") { type = NavType.StringType })) { entry ->
            TimeScreen(hiltViewModel(), back, startDayDetail = entry.arguments?.getString("date"))
        }
        composable("requests") { RequestsScreen(hiltViewModel(), back) }
        composable("requests/{tab}/{date}", arguments = listOf(
            navArgument("tab") { type = NavType.StringType }, navArgument("date") { type = NavType.StringType }
        )) { entry -> RequestsScreen(hiltViewModel(), back, entry.arguments?.getString("tab") ?: "absence", entry.arguments?.getString("date")) }
    } }
}
private fun installUpdate(context: android.content.Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    if (context.packageManager.canRequestPackageInstalls()) context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    else context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:${context.packageName}")))
}
@Composable private fun HomeTimeSummary(today: HomeToday, onRecord: () -> Unit, onDetails: (String) -> Unit) {
    val options = today.timeOptions
    val unitId = today.timeShift?.unitId ?: options?.executionUnits?.firstOrNull()?.id
    val zone = TimeRules.unitZone(options, unitId)
    var official by remember { mutableLongStateOf(android.os.SystemClock.elapsedRealtime() + (today.timeClockOffset ?: 0)) }
    LaunchedEffect(today.timeClockOffset) {
        while (true) {
            official = android.os.SystemClock.elapsedRealtime() + (today.timeClockOffset ?: 0)
            delay(1000 - official % 1000)
        }
    }
    // The permit anchor is never presented as a Hora Legal confirmed now.
    val local = today.timeClockSource == com.coalaone.go.domain.ClockSource.LOCAL_PERMIT
    val showTime = today.timeClockSource != com.coalaone.go.domain.ClockSource.NONE && today.timeClockOffset != null
    val pilot = options?.mode == "pilot"
    val workDate = today.timeWorkDate ?: options?.workDate ?: java.time.LocalDate.now().toString()
    val summary = TimeRules.homeDaySummary(workDate, today.timePunches, today.timeShift, today.timeTreatments,
        today.timeTreatmentsAvailable, today.timeOfflinePending)
    val punches = TimeRules.journeyDay(workDate, today.timeShift, today.timePunches, today.timeTreatments).filter { !it.discarded }
    val planned = TimeRules.plannedPunchTimes(today.timeShift)
    val classified = today.timePunches.all { it.classification?.purpose != null }
    val nextPurpose = if (classified) TimeRules.suggestedPurpose(today.timePunches.sortedBy { it.markedAt }, today.timeShift) else null
    val breakStatus = if (showTime) TimeRules.breakStatus(today.timeShift, today.timePunches, official, zone) else null
    var summaryExpanded by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(Tokens.dark, RoundedCornerShape(20.dp)).padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (local) "HORÁRIO DO REGISTRO" else "HORA LEGAL BRASILEIRA", color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp), modifier = Modifier.weight(1f))
            if (pilot) Text("ENSAIO · SEM VALIDADE REP-P", color = Tokens.accentSoft, style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, letterSpacing = .5.sp))
            if (showTime) Text(TimeRules.utcOffsetLabel(zone, official), color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
        }
        if (showTime) {
            Text(TimeRules.clockText(official, zone), color = Tokens.onDark,
                style = MaterialTheme.typography.displaySmall.copy(fontFamily = CodeFont, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
            val unitName = today.shiftUnit ?: options?.executionUnits?.firstOrNull { it.id == unitId }?.name
            listOfNotNull(unitName, TimeRules.shiftText(today.timeShift)).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                Text(it, color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall)
            }
        } else {
            Text(if (!today.loaded) "Carregando…" else "Indisponível", color = Tokens.onDark2, style = MaterialTheme.typography.titleLarge)
            Text("Puxe para atualizar ou abra Ponto para consultar a situação.", color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall)
        }
        breakStatus?.takeIf { it.inPause }?.let { BreakTimerPill(it, dark = true, modifier = Modifier.padding(top = 5.dp)) }
        HorizontalDivider(color = Tokens.onDark4.copy(alpha = .45f), modifier = Modifier.padding(vertical = 7.dp))
        Row(Modifier.fillMaxWidth().heightIn(min = 40.dp)
            .clickable(role = androidx.compose.ui.semantics.Role.Button,
                onClickLabel = if (summaryExpanded) "Recolher resumo da jornada" else "Expandir resumo da jornada") { summaryExpanded = !summaryExpanded },
            verticalAlignment = Alignment.CenterVertically) {
            Text("RESUMO DA JORNADA", color = Tokens.onDark4,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp), modifier = Modifier.weight(1f))
            DropdownChevron(summaryExpanded, Tokens.onDark3)
        }
        if (summaryExpanded) {
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = androidx.compose.ui.semantics.Role.Button, onClickLabel = "Ver o dia") { onDetails(workDate) },
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                val state = summary?.state
                Text(when {
                    punches.isEmpty() && today.timeMarkingsAvailable == false -> "Batidas ainda não consultadas"
                    punches.isEmpty() -> "Nenhuma batida hoje"
                    state == com.coalaone.go.domain.DaySummaryState.COMPLETE -> "Jornada encerrada às ${punches.last().time}"
                    state == com.coalaone.go.domain.DaySummaryState.IN_PROGRESS && punches.last().purpose == "break_start" -> "Em intervalo desde ${punches.last().time}"
                    state == com.coalaone.go.domain.DaySummaryState.IN_PROGRESS -> "Em jornada desde ${punches.first().time}"
                    else -> "${punches.size} ${if (punches.size == 1) "batida" else "batidas"} hoje"
                }, color = Tokens.onDark, style = MaterialTheme.typography.titleMedium)
                when {
                    state == com.coalaone.go.domain.DaySummaryState.IN_PROGRESS && showTime -> TimeRules.workedSoFarMinutes(punches, official)?.let {
                        Text("${TimeRules.durationText(it)} trabalhadas até agora · ${if (local) "prévia aproximada" else "prévia"}", color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall)
                    }
                    state == com.coalaone.go.domain.DaySummaryState.PENDING -> Text(summary.message.orEmpty(), color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                    else -> Unit
                }
            }
            Text("Ver dia ›", color = Tokens.onDark2, style = MaterialTheme.typography.labelMedium)
        }
        // The day's sequence: done punches, the next one and the planned rest.
        val slots = maxOf(planned.size, punches.size + if (planned.isEmpty() && punches.isNotEmpty() && summary?.state != com.coalaone.go.domain.DaySummaryState.COMPLETE) 1 else 0)
        if (today.timeMarkingsAvailable != false && slots > 0) Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            (0 until slots).forEach { index ->
                val done = punches.getOrNull(index)
                val next = done == null && index == punches.size
                val label = when { index == 0 -> "Início"; index == slots - 1 && planned.isNotEmpty() -> "Fim"; index % 2 == 1 -> "Intervalo"; else -> "Volta" }
                Column(Modifier.weight(1f).background(if (next) Tokens.pink.copy(alpha = .12f) else Tokens.onDark.copy(alpha = .06f), RoundedCornerShape(12.dp)).padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(done?.time ?: planned.getOrNull(index) ?: "—", color = when { done != null -> Tokens.onDark; next -> Tokens.pink; else -> Tokens.onDark4 },
                        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = CodeFont, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                    Text(if (next) "Próxima" else label, color = if (next) Tokens.pink else Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp), maxLines = 1)
                }
            }
        }
        summary?.takeIf { it.state == com.coalaone.go.domain.DaySummaryState.COMPLETE }?.let { day ->
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HomeTimeMetric("Trabalhado", TimeRules.durationText(day.workedMinutes ?: 0), Modifier.weight(1f))
                HomeTimeMetric("Intervalo", TimeRules.durationText(day.breakMinutes ?: 0), Modifier.weight(1f))
                HomeTimeMetric("Dif. da escala", day.shiftDifferenceMinutes?.let { TimeRules.durationText(it, true) } ?: "—", Modifier.weight(1f))
            }
            day.plannedBreakMinutes?.takeIf { it > 0 }?.let {
                Text("Intervalo previsto: ${TimeRules.durationText(it)}", color = Tokens.onDark3, style = MaterialTheme.typography.labelSmall)
            }
            Text("Prévia; banco e folha são apurados no fechamento.", color = Tokens.onDark3, style = MaterialTheme.typography.labelSmall)
        }
        }
        Spacer(Modifier.height(5.dp))
        if (today.timeMarkingsAvailable != false && summary?.state != com.coalaone.go.domain.DaySummaryState.COMPLETE && (showTime || punches.isNotEmpty()))
            Text("Próxima: " + TimeRules.nextPunchText(punches.size, today.timeShift, nextPurpose), color = Tokens.onDark3,
                style = MaterialTheme.typography.bodySmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth())
        // Keep the shortcut available: the Ponto screen can recover cached offline options or explain a server block.
        Action("Registrar ponto", dark = true, onClick = onRecord)
    }
}
@Composable private fun HomeTimeMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(value, color = Tokens.onDark, style = MaterialTheme.typography.titleMedium)
        Text(label, color = Tokens.onDark3, style = MaterialTheme.typography.labelSmall, maxLines = 1)
    }
}
@Composable private fun HomeScreen(vm: HomeViewModel, session: SessionViewModel, update: UpdateViewModel, navigate: (String) -> Unit) {
    val profileState by vm.profile.collectAsStateWithLifecycle(); val feedback by vm.feedback.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle(); val release by update.release.collectAsStateWithLifecycle()
    val updateFeedback by update.feedback.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    val today by vm.today.collectAsStateWithLifecycle()
    val developerViewAs by session.developerViewAs.collectAsStateWithLifecycle()
    val owner = LocalOwner.current
    val dataOwner = developerViewAs.targetUserId ?: owner
    // A recomposição ocorre antes do LaunchedEffect: filtre perfil e resumo antigos de forma síncrona.
    val state = profileState.visibleFor(dataOwner)
    val visibleToday = today.visibleFor(dataOwner)
    // When the profile cannot be refreshed offline, keep only the Point entry. Opening it
    // never grants access by itself: TimeViewModel still requires a valid local permit.
    val visibleModules = profileState.modulesForHome(dataOwner, developerViewAs.targetUserId != null)
    val visiblePendingCount = if (developerViewAs.targetUserId == null) pending.size else 0
    val goalUnit = remember(owner) { context.getSharedPreferences("goals", android.content.Context.MODE_PRIVATE).getString("unit:$owner", null) }
    // A entrada e o retorno de qualquer módulo refazem o resumo; o contexto impede vazamento entre alvo DEV e ator real.
    LaunchedEffect(state?.modules, dataOwner) { state?.modules?.let { vm.loadToday(it, goalUnit, dataOwner, force = true) } }
    val online = rememberOnline()
    LaunchedEffect(dataOwner, online) {
        vm.refresh(dataOwner)
        state?.modules?.let { vm.loadToday(it, goalUnit, dataOwner, force = true) }
    }
    val currentModules by rememberUpdatedState(state?.modules)
    val currentDataOwner by rememberUpdatedState(dataOwner)
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, vm) {
        var paused = false
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_STOP) paused = true
            if (event == androidx.lifecycle.Lifecycle.Event.ON_START && paused) {
                paused = false
                vm.refresh(currentDataOwner)
                currentModules?.let { vm.loadToday(it, goalUnit, currentDataOwner, force = true) }
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val greeting = when (java.time.LocalTime.now().hour) { in 5..11 -> "Bom dia"; in 12..17 -> "Boa tarde"; else -> "Boa noite" }
    Page("Início", feedback.copy(error = feedback.error?.takeUnless { it.startsWith("Sem conexão.") }), onRefresh = { vm.refresh(dataOwner); state?.modules?.let { vm.loadToday(it, goalUnit, dataOwner, force = true) } }, showConnectivityNotice = false, header = {
        // The greeting is the title; the small brand sits above it and the avatar, on the right, opens the profile.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Brand(compact = true, small = true)
                val greetingName = state?.profile?.name?.let(::personDisplayName)?.takeIf(String::isNotBlank)
                Text("$greeting, ${greetingName ?: "humano"}", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge.copy(fontSize = 24.sp, lineHeight = 30.sp), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(homeRoleSubtitle(state?.profile?.role), color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
            ProfileAvatar(state?.profile?.name.orEmpty(), state?.profile?.avatarUrl) { navigate("profile") }
        }
    }) {
        if (session.mode.simulation) Text("Simulação · nenhum dado é enviado", color = Tokens.warning, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp))
        release?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }?.let { target -> CardBlock(selected = true) {
            Text("Atualização ${target.versionName} disponível", style = MaterialTheme.typography.titleMedium)
            Action("Baixar atualização", updateFeedback.busy) { update.download { file -> installUpdate(context, file) } }
            updateFeedback.error?.let { Text(it, color = Tokens.danger) }
        } }
        HomeModuleContent(visibleModules, visibleToday, visiblePendingCount, navigate)
    }
}
@Composable internal fun HomeModuleContent(modules: Modules?, visibleToday: HomeToday, visiblePendingCount: Int,
    navigate: (String) -> Unit) {
    modules ?: return
    if (modules.timeRecording) HomeTimeSummary(visibleToday, { navigate("time/register") }) { date -> navigate("time/day/$date") }
    val journey = listOf(Triple(modules.timeRecording, "Ponto", "time"), Triple(modules.schedule, "Escala", "schedule")).filter { it.first }
    if (journey.isNotEmpty()) {
        Text("JORNADA DE TRABALHO", color = Tokens.wine, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp), modifier = Modifier.padding(top = 4.dp))
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            journey.forEach { (_, title, route) ->
                val badge = if (route == "time") visibleToday.timePunches.takeIf { it.isNotEmpty() }?.size?.let { "$it batida${if (it == 1) "" else "s"}" } else visibleToday.shiftShort
                val subtitle = if (route == "schedule") when {
                    !visibleToday.loaded -> "Carregando turno de hoje"
                    visibleToday.scheduleAvailable == false -> "Turno de hoje indisponível · atualizar"
                    visibleToday.shift != null -> "Hoje · ${visibleToday.shift}"
                    else -> "Sem turno hoje · ver escala"
                } else null
                HomeTile(title, route, Modifier.weight(1f).fillMaxHeight(), badge = badge, subtitle = subtitle) { navigate(route) }
            }
            if (journey.size == 1) Spacer(Modifier.weight(1f))
        }
    }
    val tiles = listOf(Triple(modules.requests, "Solicitações", "requests"), Triple(modules.localPurchase, "Compra local", "purchase"), Triple(modules.stockCount, "Contagem de estoque", "count"), Triple(modules.repositionReceipt, "Recebimento", "receive"), Triple(modules.goals, "Metas", "goals"), Triple(modules.signage, "Signage", "signage")).filter { it.first }
    if (tiles.isNotEmpty()) Text("OUTROS SERVIÇOS", color = Tokens.wine, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp), modifier = Modifier.padding(top = 4.dp))
    tiles.chunked(2).forEach { row ->
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            row.forEach { (_, title, route) ->
                val badge = when (route) { "count" -> "Em curso".takeIf { visibleToday.openCounts.isNotEmpty() }; "receive" -> visibleToday.repositions?.takeIf { it > 0 }?.toString(); "goals" -> visibleToday.goalPercent?.let { "${Math.round(it)}%" }; else -> null }
                HomeTile(title, route, Modifier.weight(1f).fillMaxHeight(), pending = if (route == "purchase") visiblePendingCount else 0, badge = badge, badgeWarm = route == "count") { navigate(route) }
            }
            if (row.size == 1) Spacer(Modifier.weight(1f))
        }
    }
    if (!(modules.localPurchase || modules.stockCount || modules.repositionReceipt || modules.schedule || modules.goals || modules.signage || modules.timeRecording || modules.requests)) EmptyState("Nenhum módulo liberado", "Seu perfil não tem módulos liberados para o aplicativo.")
}
/** Account chores live here, off the home screen: photo, refresh, update check and sign-out. */
@Composable private fun ProfileScreen(vm: HomeViewModel, session: SessionViewModel, update: UpdateViewModel, onBack: () -> Unit, onPrepareBiometric: () -> Unit) {
    val profileState by vm.profile.collectAsStateWithLifecycle(); val feedback by vm.feedback.collectAsStateWithLifecycle()
    val release by update.release.collectAsStateWithLifecycle(); val updateFeedback by update.feedback.collectAsStateWithLifecycle()
    var signOut by remember { mutableStateOf(false) }
    var framing by remember { mutableStateOf<com.coalaone.go.data.Document?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val push by session.push.state.collectAsStateWithLifecycle()
    val sessionState by session.state.collectAsStateWithLifecycle()
    val developerViewAs by session.developerViewAs.collectAsStateWithLifecycle()
    val canDeveloperViewAs = sessionState.identity?.email?.trim()?.lowercase() == com.coalaone.go.data.DEVELOPER_VIEW_AS_EMAIL
    LaunchedEffect(canDeveloperViewAs) { if (canDeveloperViewAs) session.loadDeveloperViewAs() }
    val owner = LocalOwner.current
    val dataOwner = developerViewAs.targetUserId ?: owner
    val state = profileState.visibleFor(dataOwner)
    LaunchedEffect(dataOwner) { vm.refresh(dataOwner) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) session.push.enable(owner)
        else session.push.reflect(owner)
    }
    Page("Perfil", feedback, onBack, onRefresh = { vm.refresh(dataOwner) }) {
        CardBlock {
            Text(personDisplayName(state?.profile?.name.orEmpty()), style = MaterialTheme.typography.titleLarge)
            Text(listOfNotNull(state?.profile?.role?.takeIf(String::isNotBlank), state?.profile?.email?.takeIf(String::isNotBlank)).joinToString(" · "), color = Tokens.muted)
        }
        if (canDeveloperViewAs) CardBlock(selected = developerViewAs.targetUserId != null) {
            Text("Visualizar como usuário", style = MaterialTheme.typography.titleMedium)
            Text("A navegação usa o perfil escolhido, mas alterações ficam bloqueadas. Seu login real continua registrado para auditoria.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            if (developerViewAs.targetUserId != null) {
                Text("Visualizando como ${developerViewAs.targetName ?: "usuário selecionado"}", color = Tokens.warning, style = MaterialTheme.typography.bodyMedium)
                Action("Voltar ao meu perfil", developerViewAs.busy, onClick = session::stopDeveloperViewAs)
            } else if (developerViewAs.users.isNotEmpty()) {
                Picker("Usuário", developerViewAs.users.map { user -> user.id to "${user.username} · ${user.jobRoleName ?: user.email}" }, "", !developerViewAs.busy && !feedback.busy, session::selectDeveloperViewAs)
            } else if (!developerViewAs.busy) {
                Text("Nenhum usuário ativo disponível.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            developerViewAs.error?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall) }
        }
        if (developerViewAs.targetUserId == null) CardBlock { CaptureButtons("Foto de perfil", !feedback.busy, imagesOnly = true) { framing = it } }
        // The chosen photo is framed by the person before it is sent; only the framed square leaves the phone.
        framing?.let { photo -> PhotoCropDialog(photo, { framing = null }) { framed -> framing = null; vm.avatar(framed) } }
        if (developerViewAs.targetUserId == null) CardBlock {
            Text("Aplicativo", style = MaterialTheme.typography.titleMedium)
            Text("Coala Go ${BuildConfig.VERSION_NAME} · Android ${BuildConfig.VERSION_CODE}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            val target = release?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }
            // The app checks for a release every time it comes to the foreground; the button only exists when there is one.
            if (target != null) Action("Baixar atualização ${target.versionName}", updateFeedback.busy) { update.download { file -> installUpdate(context, file) } }
            else Text("Você está na versão mais recente.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            updateFeedback.error?.let { Text(it, color = Tokens.danger) }
        }
        if (developerViewAs.targetUserId == null) CardBlock {
            Text("Acesso sem internet", style = MaterialTheme.typography.titleMedium)
            Text(
                if (sessionState.localUnlockEnabled) "Use a biometria para abrir o Coala Go mesmo sem conexão."
                else "O app oferece a biometria após o login para liberar o acesso sem conexão. Se você pulou essa etapa, pode ativá-la aqui.",
                color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            if (!sessionState.localUnlockEnabled) Action("Ativar biometria", sessionState.busy, enabled = !sessionState.busy, onClick = onPrepareBiometric)
        }
        if (developerViewAs.targetUserId == null) CardBlock {
            Text("Notificações", style = MaterialTheme.typography.titleMedium)
            val settingsRequired = com.coalaone.go.push.PushPolicy.requiresSystemSettings(Build.VERSION.SDK_INT, push.permitted, session.push.permissionRequested)
            Text(if (push.enabled && !push.permitted) "Autorizadas nesta conta, mas bloqueadas no Android." else if (push.enabled) "Ativadas para esta conta." else "Receba avisos gerais do Coala Go neste aparelho.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            if (push.enabled) Action("Desativar notificações", push.busy) { session.push.disable(owner) }
            else Action("Ativar notificações", push.busy, enabled = !session.mode.simulation && !settingsRequired) {
                if (Build.VERSION.SDK_INT >= 33 && !session.push.permissionGranted()) { session.push.markPermissionRequested(); permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }
                else session.push.enable(owner)
            }
            if (settingsRequired) {
                TextButton({ context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${context.packageName}"))) }) { Text("Abrir configurações do Android") }
            }
            push.error?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall) }
        }
        if (signOut) InlineConfirmation("Sair da conta? Os documentos pendentes permanecem protegidos e vinculados a ela.", feedback.busy, { signOut = false }, "Sair da conta") {
            listOf("receipts", "time-documents").forEach { File(context.cacheDir, it).deleteRecursively() }
            session.signOut()
        }
        else TextButton({ signOut = true }) { Text("Sair da conta", color = Tokens.danger) }
    }
}
