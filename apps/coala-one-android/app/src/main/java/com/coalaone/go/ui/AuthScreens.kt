package com.coalaone.go.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import com.coalaone.go.BuildConfig
import com.coalaone.go.auth.GoogleCredentialResult
import com.coalaone.go.auth.requestGoogleWorkspaceCredential
import kotlinx.coroutines.launch

@Composable fun AuthScreen(vm: SessionViewModel, biometricPrompt: () -> Unit) {
    val state by vm.state.collectAsState()
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var reset by rememberSaveable { mutableStateOf(false) }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var biometric by rememberSaveable { mutableStateOf(vm.biometricEnabled()) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    Aurora {
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Brand()
        Spacer(Modifier.height(18.dp))
        val locked = state.identity != null && state.locked
        // Whoever already opted in is asked for the fingerprint or face as soon as the app opens locked.
        val autoPrompt = locked && !state.loading && vm.biometricReady()
        LaunchedEffect(autoPrompt) { if (autoPrompt) biometricPrompt() }
        if (!locked && reset && !state.resetSent) Text("Redefinir senha", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
        if (state.loading || state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        val submit = { if (locked) { if (password.isNotEmpty()) { vm.unlock(password, biometric); password = "" } } else if (email.isNotBlank() && password.isNotBlank()) { vm.login(email, password); password = "" } }
        if (locked) Text(state.identity?.email.orEmpty(), color = Tokens.onDark2)
        else OutlinedTextField(email, onValueChange = { email = it }, label = { Text("E-mail") }, singleLine = true, shape = RoundedCornerShape(12.dp), enabled = !state.busy, modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Username }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = if (reset) ImeAction.Done else ImeAction.Next), colors = authFieldColors())
        if (!reset) OutlinedTextField(password, onValueChange = { password = it }, label = { Text("Senha") }, singleLine = true, shape = RoundedCornerShape(12.dp), visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }), trailingIcon = { EyeToggle(showPassword) { showPassword = !showPassword } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Password }, colors = authFieldColors())
        state.error?.let { Text(it, color = Tokens.pink) }
        if (reset && state.resetSent) {
            Text("Confira seu e-mail", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
            Text("Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.", color = Tokens.onDark2)
        }
        if (locked) {
            CheckRow("Ativar desbloqueio por biometria", biometric, !state.busy, dark = true) { biometric = it }
            Action("Desbloquear", state.busy, enabled = password.isNotEmpty(), dark = true) { submit() }
            if (vm.biometricReady()) Action("Usar biometria", secondary = true, dark = true, onClick = biometricPrompt)
            TextButton(vm::signOut) { Text("Sair da conta", color = Tokens.onDark2) }
        } else if (reset) {
            Text("Enviaremos um link para você escolher uma nova senha.", color = Tokens.onDark2)
            Action("Enviar link", state.busy, enabled = email.contains('@'), dark = true) { vm.reset(email) }
            Text("Vale para todo o Coala One", color = Tokens.onDark2, modifier = Modifier.fillMaxWidth().background(Tokens.onDark.copy(alpha = .06f), RoundedCornerShape(12.dp)).padding(14.dp))
            TextButton({ reset = false }) { Text("Voltar ao login", color = Tokens.onDark2) }
        } else {
            Action("Entrar no Coala Go", state.busy, enabled = email.isNotBlank() && password.isNotBlank(), dark = true) { submit() }
            if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()) Action("Continuar com Google", state.busy, secondary = true, dark = true) {
                scope.launch {
                    try {
                        when (val result = requestGoogleWorkspaceCredential(context, BuildConfig.GOOGLE_WEB_CLIENT_ID, authorizedOnly = false)) {
                            is GoogleCredentialResult.Token -> vm.loginGoogle(result.value)
                            GoogleCredentialResult.Cancelled -> Unit
                        }
                    } catch (cause: Exception) { vm.loginGoogleError(cause.message ?: "Não foi possível abrir o acesso Google.") }
                }
            }
            TextButton({ reset = true }) { Text("Esqueci minha senha", color = Tokens.pink) }
            if (BuildConfig.DEBUG) TextButton(vm::simulate) { Text("Explorar simulação", color = Tokens.pink) }
        }
    }
    }
    }
}

@Composable private fun authFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Tokens.onDark, unfocusedTextColor = Tokens.onDark,
    disabledTextColor = Tokens.onDark2, disabledLabelColor = Tokens.onDark2,
    focusedLabelColor = Tokens.pink, unfocusedLabelColor = Tokens.onDark2,
    cursorColor = Tokens.pink, focusedBorderColor = Tokens.pink,
    unfocusedBorderColor = Tokens.onDark.copy(alpha = .22f),
    focusedContainerColor = Tokens.onDark.copy(alpha = .06f),
    disabledContainerColor = Tokens.onDark.copy(alpha = .06f),
    unfocusedContainerColor = Tokens.onDark.copy(alpha = .06f))

/** Eye drawn in code: open shows the password, struck through hides it. */
@Composable private fun EyeToggle(visible: Boolean, onClick: () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = if (visible) "Ocultar senha" else "Mostrar senha" }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(22.dp)) {
            val stroke = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round)
            drawOval(Tokens.pink, Offset(size.width * .04f, size.height * .24f), Size(size.width * .92f, size.height * .52f), style = stroke)
            drawCircle(Tokens.pink, size.minDimension * .13f, Offset(size.width / 2, size.height / 2))
            if (visible) drawLine(Tokens.pink, Offset(size.width * .14f, size.height * .86f), Offset(size.width * .86f, size.height * .14f), 1.8.dp.toPx(), StrokeCap.Round)
        }
    }
}
