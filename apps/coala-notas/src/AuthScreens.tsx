import { useEffect, useState, type ReactNode } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, signInWithEmailAndPassword, signOut, type User } from "@firebase/auth";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Avatar } from "./Avatar";
import { biometricUnlockEnabled, biometricUnlockReady, biometricsAvailable, promptBiometricUnlock, recordPasswordUnlock } from "./biometric-unlock";
import { auth } from "./firebase";
import type { AppProfile } from "./profile";
import { contentColumn } from "./theme";
import { AppButton, Aurora, BackButton, BiometricIcon, Brand, BusyOverlay, FadeIn, Slogan, ui } from "./ui";
import { requestPasswordReset } from "./upload";

// O servidor aceita um novo pedido de redefinição por e-mail a cada 60 segundos.
const RESEND_AFTER_SECONDS = 60;

export function friendlyAuthError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(code)) return "E-mail ou senha inválidos.";
  if (code === "auth/too-many-requests") return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (code === "auth/network-request-failed") return "Sem conexão. Você ainda pode abrir o modo de simulação.";
  return "Não foi possível entrar no Coala One.";
}

/** Moldura das telas escuras (login, redefinição, bloqueio): fundo com aurora e conteúdo centralizado. */
function DarkScreen({ children, busy, top }: { children: ReactNode; busy?: string | null; top?: ReactNode }) {
  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
    <Aurora />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      {top ? <View style={styles.top}>{top}</View> : null}
      <FadeIn style={styles.body}>{children}</FadeIn>
    </ScrollView>
    <BusyOverlay text={busy ?? null} />
  </KeyboardAvoidingView>;
}

function Field(props: { label: string; right?: ReactNode; children: ReactNode }) {
  return <View style={styles.field}><View style={styles.fieldHead}><Text style={styles.fieldLabel}>{props.label}</Text>{props.right}</View>{props.children}</View>;
}

export function LoginScreen({ onSimulate }: { onSimulate: () => void }) {
  const [view, setView] = useState<"login" | "reset" | "sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const go = (next: typeof view) => { setError(null); setView(next); };
  async function login() {
    if (!email.trim() || !password) { setError("Informe seu e-mail e sua senha."); return; }
    setBusy("Entrando…"); setError(null);
    try { await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password); }
    catch (cause) { setError(friendlyAuthError(cause)); }
    finally { setBusy(null); }
  }
  async function sendReset() {
    const target = email.trim().toLowerCase();
    if (!target.includes("@")) { setError("Informe o e-mail da sua conta."); return; }
    setBusy("Enviando…"); setError(null);
    try { await requestPasswordReset(target); setResendIn(RESEND_AFTER_SECONDS); setView("sent"); }
    catch { setError("Não foi possível solicitar a redefinição agora. Verifique a conexão e tente novamente."); }
    finally { setBusy(null); }
  }
  const emailInput = <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder="seuemail@empresa.com" placeholderTextColor={ui.onDarkFaint} style={styles.input} value={email} />;

  if (view === "reset") return <DarkScreen busy={busy} top={<BackButton onPress={() => go("login")} label="Voltar para o login" />}>
    <Text style={styles.heading}>Redefinir senha</Text>
    <Text style={styles.lead}>Informe o e-mail da sua conta. Enviaremos um link para criar uma nova senha.</Text>
    <Field label="E-mail">{emailInput}</Field>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <AppButton label="Enviar link" onPress={() => void sendReset()} disabled={!!busy} />
    <View style={styles.note}><Text style={styles.noteTitle}>Vale para todo o Coala One</Text><Text style={styles.noteText}>A nova senha passa a valer no sistema web e no aplicativo.</Text></View>
  </DarkScreen>;

  if (view === "sent") return <DarkScreen busy={busy}>
    <View style={styles.sentMark}><Text style={styles.sentMarkText}>✓</Text></View>
    <Text style={styles.heading}>Confira seu e-mail</Text>
    <Text style={styles.lead}>Se houver uma conta com <Text style={styles.strong}>{email.trim().toLowerCase()}</Text>, você vai receber o link em instantes.</Text>
    <Text style={styles.faint}>Não chegou? Veja a caixa de spam ou peça um novo link daqui a {RESEND_AFTER_SECONDS} segundos.</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <AppButton label="Voltar para o login" onPress={() => go("login")} />
    <AppButton label={resendIn > 0 ? `Reenviar em 0:${String(resendIn).padStart(2, "0")}` : "Reenviar o link"} onPress={() => void sendReset()} disabled={resendIn > 0 || !!busy} secondary dark />
  </DarkScreen>;

  return <DarkScreen busy={busy}>
    <View style={styles.center}><Brand size={40} /></View>
    <Slogan />
    <Field label="E-mail">{emailInput}</Field>
    <Field label="Senha" right={<Pressable accessibilityRole="button" onPress={() => go("reset")} hitSlop={8}><Text style={styles.link}>Esqueci minha senha</Text></Pressable>}>
      <TextInput autoCapitalize="none" autoComplete="current-password" onChangeText={setPassword} onSubmitEditing={() => void login()} placeholder="Sua senha" placeholderTextColor={ui.onDarkFaint} secureTextEntry style={styles.input} value={password} />
    </Field>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <AppButton label="Entrar no Coala One" onPress={() => void login()} disabled={!!busy} />
    {/* Fora do protótipo: o modo de simulação já existia e continua disponível para treino. */}
    <Pressable accessibilityRole="button" disabled={!!busy} onPress={onSimulate} style={styles.textButton}><Text style={styles.link}>Conhecer em modo de simulação</Text></Pressable>
    <Text style={styles.faintCenter}>A simulação funciona sem login e nunca envia nem registra dados.</Text>
  </DarkScreen>;
}

/** Cobre a tela sem desmontar o que estava em andamento; só a senha da própria conta, ou a biometria que ela ativou, libera. */
export function LockScreen({ user, profile, onUnlocked }: { user: User; profile: AppProfile | null; onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `ready`: a biometria já pode abrir. `available`: o aparelho tem leitor, então dá para ativar com a senha.
  const [biometric, setBiometric] = useState({ available: false, ready: false, enabled: false });
  async function unlockWithBiometrics() {
    setError(null);
    if (await promptBiometricUnlock()) onUnlocked();
  }
  useEffect(() => {
    let active = true;
    void Promise.all([biometricsAvailable(), biometricUnlockReady(user.uid), biometricUnlockEnabled(user.uid)]).then(([available, ready, enabled]) => {
      if (!active) return;
      setBiometric({ available, ready, enabled });
      if (ready) void unlockWithBiometrics();
    });
    return () => { active = false; };
  }, [user.uid]);
  async function unlock() {
    if (!password || !user.email) { setError("Informe sua senha."); return; }
    setBusy("Conferindo…"); setError(null);
    // Reautenticar no servidor também derruba a sessão de uma conta desativada ou com senha trocada.
    try { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password)); await recordPasswordUnlock(user.uid, biometric.enabled).catch(() => undefined); onUnlocked(); }
    catch (cause) {
      const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
      setError(code === "auth/network-request-failed" ? "Sem conexão. Conecte-se à internet para desbloquear o aplicativo." : friendlyAuthError(cause).replace("E-mail ou senha inválidos.", "Senha incorreta."));
      setBusy(null);
    }
  }
  const name = profile?.name ?? "Aplicativo bloqueado";
  const showPassword = usePassword || !biometric.ready;
  return <View style={styles.lock}><DarkScreen busy={busy}>
    <View style={styles.center}><Avatar name={name} url={profile?.avatarUrl} size={84} /></View>
    <Text style={styles.lockName}>{name}</Text>
    <Text style={styles.lead}>{biometric.ready ? `Use sua digital ou seu rosto, ou a senha de ${user.email}.` : `Confirme a senha de ${user.email} para continuar.`}</Text>
    {biometric.ready ? <>
      <View style={styles.bioRing}><BiometricIcon /></View>
      <AppButton label="Desbloquear com biometria" onPress={() => void unlockWithBiometrics()} disabled={!!busy} />
    </> : null}
    {showPassword ? <>
      <Field label="Senha"><TextInput autoCapitalize="none" autoComplete="current-password" autoFocus={usePassword} onChangeText={setPassword} onSubmitEditing={() => void unlock()} placeholder="Sua senha" placeholderTextColor={ui.onDarkFaint} secureTextEntry style={styles.input} value={password} /></Field>
      {biometric.available ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: biometric.enabled }} disabled={!!busy} onPress={() => setBiometric((current) => ({ ...current, enabled: !current.enabled }))} style={styles.checkRow}>
        <View style={[styles.checkBox, biometric.enabled && styles.checkBoxOn]}>{biometric.enabled ? <Text style={styles.checkMark}>✓</Text> : null}</View>
        <Text style={styles.checkLabel}>Usar digital ou rosto neste aparelho nas próximas vezes</Text>
      </Pressable> : null}
    </> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {showPassword ? <AppButton label="Desbloquear com senha" onPress={() => void unlock()} disabled={!!busy} secondary={biometric.ready} dark={biometric.ready} />
      : <AppButton label="Desbloquear com senha" onPress={() => setUsePassword(true)} disabled={!!busy} secondary dark />}
    <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => void signOut(auth)} style={styles.textButton}><Text style={styles.link}>Entrar com outra conta</Text></Pressable>
    {biometric.enabled ? <Text style={styles.faintCenter}>Por segurança, a senha é pedida de novo a cada 7 dias.</Text> : null}
  </DarkScreen></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ui.dark, overflow: "hidden" }, lock: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  scroll: { ...contentColumn, flexGrow: 1, paddingHorizontal: 24, paddingBottom: 24 }, top: { paddingTop: 8 }, body: { flexGrow: 1, justifyContent: "center", gap: 16, paddingVertical: 28 },
  center: { alignSelf: "center" }, heading: { color: ui.onDark, fontSize: 30, fontWeight: "800", letterSpacing: -0.9, textAlign: "center" }, lockName: { color: ui.onDark, fontSize: 26, fontWeight: "800", letterSpacing: -0.8, textAlign: "center" },
  lead: { color: ui.onDarkSub, fontSize: 14.5, lineHeight: 21, textAlign: "center" }, strong: { color: ui.onDark, fontWeight: "700" }, faint: { color: ui.onDarkFaint, fontSize: 12.5, lineHeight: 19, textAlign: "center" }, faintCenter: { color: ui.onDarkFaint, fontSize: 11.5, lineHeight: 17, textAlign: "center" },
  field: { gap: 6 }, fieldHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, fieldLabel: { color: ui.onDark2, fontSize: 13, fontWeight: "700" },
  input: { height: 50, borderRadius: 12, borderWidth: 1, borderColor: ui.fieldLine, backgroundColor: ui.field, paddingHorizontal: 14, fontSize: 15, color: ui.onDark },
  link: { color: ui.pink, fontSize: 12.5, fontWeight: "700" }, textButton: { alignSelf: "center", paddingVertical: 6 },
  error: { color: "#FFB4C0", backgroundColor: "rgba(190,18,60,0.22)", borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 19 },
  note: { gap: 4, padding: 14, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }, noteTitle: { color: ui.onDark, fontSize: 13, fontWeight: "700" }, noteText: { color: ui.onDarkSub, fontSize: 12.5, lineHeight: 19 },
  sentMark: { alignSelf: "center", width: 64, height: 64, borderRadius: 22, backgroundColor: "rgba(74,222,128,0.14)", alignItems: "center", justifyContent: "center" }, sentMarkText: { color: "#4ADE80", fontSize: 30, fontWeight: "900" },
  bioRing: { alignSelf: "center", width: 72, height: 72, borderRadius: 36, borderWidth: 1.5, borderColor: "rgba(240,139,177,0.5)", alignItems: "center", justifyContent: "center", marginVertical: 4 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }, checkBox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: ui.line, alignItems: "center", justifyContent: "center" }, checkBoxOn: { backgroundColor: ui.accent, borderColor: ui.accent },
  checkMark: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" }, checkLabel: { flex: 1, color: ui.onDark2, fontSize: 13.5, lineHeight: 19 },
});
