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
import com.coalaone.go.BuildConfig

@Composable fun AuthScreen(vm: SessionViewModel, biometricPrompt: () -> Unit) {
    val state by vm.state.collectAsState()
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var reset by rememberSaveable { mutableStateOf(false) }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var biometric by rememberSaveable { mutableStateOf(vm.biometricEnabled()) }
    Aurora {
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Brand()
        Spacer(Modifier.height(18.dp))
        val locked = state.identity != null && state.locked
        if (locked || reset && !state.resetSent) Text(if (locked) "Desbloquear aplicativo" else "Redefinir senha", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
        if (state.loading || state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (locked) {
            if (vm.biometricReady()) ModuleIcon("biometric", Modifier.size(72.dp))
            Text(state.identity?.email.orEmpty(), color = Tokens.onDark2)
        }
        else OutlinedTextField(email, onValueChange = { email = it }, label = { Text("E-mail") }, singleLine = true, shape = RoundedCornerShape(12.dp), enabled = !state.busy, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), colors = authFieldColors())
        if (!reset) OutlinedTextField(password, onValueChange = { password = it }, label = { Text("Senha") }, singleLine = true, shape = RoundedCornerShape(12.dp), visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), trailingIcon = { TextButton({ showPassword = !showPassword }) { Text(if (showPassword) "Ocultar" else "Mostrar", color = Tokens.pink) } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth(), colors = authFieldColors())
        state.error?.let { Text(it, color = Tokens.pink) }
        if (reset && state.resetSent) {
            Text("Confira seu e-mail", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
            Text("Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.", color = Tokens.onDark2)
        }
        if (locked) {
            Row { Checkbox(biometric, { biometric = it }); Text("Ativar desbloqueio por biometria por 7 dias", color = Tokens.onDark2) }
            Action("Desbloquear", state.busy, enabled = password.isNotEmpty(), dark = true) { vm.unlock(password, biometric); password = "" }
            if (vm.biometricReady()) Action("Usar biometria", secondary = true, dark = true, onClick = biometricPrompt)
            TextButton(vm::signOut) { Text("Sair da conta", color = Tokens.onDark2) }
        } else if (reset) {
            Text("Enviaremos um link para você escolher uma nova senha.", color = Tokens.onDark2)
            Action("Enviar link", state.busy, enabled = email.contains('@'), dark = true) { vm.reset(email) }
            Text("Vale para todo o Coala One", color = Tokens.onDark2, modifier = Modifier.fillMaxWidth().background(Tokens.onDark.copy(alpha = .06f), RoundedCornerShape(12.dp)).padding(14.dp))
            TextButton({ reset = false }) { Text("Voltar ao login", color = Tokens.onDark2) }
        } else {
            Action("Entrar no Coala Go", state.busy, enabled = email.isNotBlank() && password.isNotBlank(), dark = true) { vm.login(email, password); password = "" }
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
