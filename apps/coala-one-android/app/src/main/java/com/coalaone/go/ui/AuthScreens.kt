package com.coalaone.go.ui

import androidx.compose.foundation.background
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
import com.coalaone.go.BuildConfig

@Composable fun AuthScreen(vm: SessionViewModel, biometricPrompt: () -> Unit) {
    val state by vm.state.collectAsState()
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var reset by rememberSaveable { mutableStateOf(false) }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var biometric by rememberSaveable { mutableStateOf(vm.biometricEnabled()) }
    Column(Modifier.fillMaxSize().background(Tokens.dark).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Brand()
        val locked = state.identity != null && state.locked
        Text(if (locked) "Desbloquear aplicativo" else if (reset) "Recuperar senha" else "Entrar no aplicativo", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
        if (state.loading || state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (locked) Text(state.identity?.email.orEmpty(), color = Tokens.onDark2)
        else OutlinedTextField(email, onValueChange = { email = it }, label = { Text("E-mail") }, enabled = !state.busy, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Tokens.onDark, unfocusedTextColor = Tokens.onDark, focusedLabelColor = Tokens.pink, unfocusedLabelColor = Tokens.onDark2))
        if (!reset) OutlinedTextField(password, onValueChange = { password = it }, label = { Text("Senha") }, visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), trailingIcon = { TextButton({ showPassword = !showPassword }) { Text(if (showPassword) "Ocultar" else "Mostrar", color = Tokens.pink) } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth(), colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Tokens.onDark, unfocusedTextColor = Tokens.onDark, focusedLabelColor = Tokens.pink, unfocusedLabelColor = Tokens.onDark2))
        state.error?.let { Text(it, color = Tokens.pink) }
        if (state.resetSent) Text("Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.", color = Tokens.onDark)
        if (locked) {
            Row { Checkbox(biometric, { biometric = it }); Text("Ativar desbloqueio por biometria por 7 dias", color = Tokens.onDark2) }
            Action("Desbloquear", state.busy, enabled = password.isNotEmpty()) { vm.unlock(password, biometric); password = "" }
            if (vm.biometricReady()) Action("Usar biometria", secondary = true, onClick = biometricPrompt)
            TextButton(vm::signOut) { Text("Sair da conta", color = Tokens.onDark2) }
        } else if (reset) {
            Action("Solicitar redefinição", state.busy, enabled = email.contains('@')) { vm.reset(email) }
            TextButton({ reset = false }) { Text("Voltar ao login", color = Tokens.onDark2) }
        } else {
            Action("Entrar", state.busy, enabled = email.isNotBlank() && password.isNotBlank()) { vm.login(email, password); password = "" }
            TextButton({ reset = true }) { Text("Esqueci minha senha", color = Tokens.onDark2) }
            if (BuildConfig.DEBUG) TextButton(vm::simulate) { Text("Explorar simulação", color = Tokens.pink) }
        }
    }
}
