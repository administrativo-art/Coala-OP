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
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
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
    NavHost(nav, startDestination = "home") {
        composable("home") { HomeScreen(hiltViewModel(), session, update) { nav.navigate(it) } }
        composable("count") { CountScreen(hiltViewModel(), back) }
        composable("receive") { ReceiveScreen(hiltViewModel(), back) }
        composable("purchase") { PurchaseScreen(hiltViewModel(), back) }
        composable("schedule") { ScheduleScreen(hiltViewModel(), back) }
        composable("goals") { GoalsScreen(hiltViewModel(), back) }
        composable("signage") { SignageScreen(hiltViewModel(), back) }
    }
}
@Composable private fun HomeScreen(vm: HomeViewModel, session: SessionViewModel, update: UpdateViewModel, navigate: (String) -> Unit) {
    val state by vm.profile.collectAsStateWithLifecycle(); val feedback by vm.feedback.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle(); val release by update.release.collectAsStateWithLifecycle()
    val updateFeedback by update.feedback.collectAsStateWithLifecycle()
    var profileOpen by remember { mutableStateOf(false) }
    var signOut by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    Page("Olá, ${state?.profile?.name?.substringBefore(' ') ?: "humano"}", feedback) {
        if (session.mode.simulation) Text("SIMULAÇÃO · nenhum dado é enviado", color = Tokens.warning)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { ProductPhoto(state?.profile?.avatarUrl, "Foto de perfil", 64); Column { Text(state?.profile?.name.orEmpty(), style = MaterialTheme.typography.titleMedium); Text(state?.profile?.role.orEmpty()); TextButton({ profileOpen = !profileOpen }) { Text("Alterar foto de perfil") } } }
        if (profileOpen) CaptureButtons("Foto de perfil", !feedback.busy, imagesOnly = true, onDocument = vm::avatar)
        Action("Atualizar perfil", feedback.busy, secondary = true) { vm.refresh() }
        if (pending.isNotEmpty()) Text("${pending.count { it.state != "UPLOADED" }} envios pendentes · ${pending.count { it.state == "UPLOADED" }} revisões pendentes")
        state?.modules?.let { modules ->
            listOf(Triple(modules.localPurchase, "Compra local", "purchase"), Triple(modules.stockCount, "Contagem de estoque", "count"), Triple(modules.repositionReceipt, "Recebimento de reposição", "receive"), Triple(modules.schedule, "Escala", "schedule"), Triple(modules.goals, "Metas", "goals"), Triple(modules.signage, "Signage", "signage")).filter { it.first }.forEach { (_, title, route) -> Action(title, secondary = true) { navigate(route) } }
            if (!(modules.localPurchase || modules.stockCount || modules.repositionReceipt || modules.schedule || modules.goals || modules.signage)) Text("Seu perfil não tem módulos liberados para o aplicativo.")
        }
        release?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }?.let { target ->
            Text("Atualização ${target.versionName} disponível")
            Action("Baixar atualização", updateFeedback.busy) { update.download { file ->
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                if (context.packageManager.canRequestPackageInstalls()) context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                else context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:${context.packageName}")))
            } }
            updateFeedback.error?.let { Text(it, color = Tokens.danger) }
        }
        if (signOut) InlineConfirmation("Sair da conta? Os documentos pendentes permanecem protegidos e vinculados a ela.", feedback.busy, { signOut = false }, "Sair da conta", session::signOut)
        else TextButton({ signOut = true }) { Text("Sair da conta") }
        Text("Coala Go ${BuildConfig.VERSION_NAME} · Android ${BuildConfig.VERSION_CODE}", style = MaterialTheme.typography.bodySmall)
        Action("Verificar atualização", updateFeedback.busy, secondary = true, onClick = { update.check() })
    }
}
