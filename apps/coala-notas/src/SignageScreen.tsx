import { useEffect, useRef, useState } from "react";
import type { User } from "@firebase/auth";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ActivityIndicator, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { addSignageScreen, loadSignageUnits, ORIENTATION_LABEL, parsePairingCode, signageInstallUrl, simulationSignageUnits, type SignageOrientation, type SignageUnit, type SignageUnitScreen } from "./signage";
import { contentColumn } from "./theme";
import { AppButton, FadeIn, Pill, ScreenHeader, ui } from "./ui";

type Step = "list" | "unit" | "orientation" | "install" | "scan" | "done";
const FLOW: Step[] = ["unit", "orientation", "install", "scan"];
const TITLES: Record<Step, string> = { list: "Signage", unit: "Unidade", orientation: "Posição da tela", install: "Instalar no monitor", scan: "Ler o QR code", done: "Tela adicionada" };
type Added = { name: string; kioskName: string; orientation: SignageOrientation; created: boolean };

/** Desenho de uma TV na posição escolhida; `label` e `sub` imitam a arte de validação que o monitor mostra. */
function Tv({ orientation, size, label, sub, active }: { orientation: SignageOrientation; size: number; label?: string; sub?: string; active?: boolean }) {
  const wide = orientation === "landscape";
  const width = wide ? size : size * 0.5625;
  const height = wide ? size * 0.5625 : size;
  return <View style={styles.tvWrap}>
    <View style={[styles.tv, { width, height }, active && styles.tvActive]}>
      {label ? <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.tvLabel, { fontSize: width / 5 }]}>{label}</Text> : null}
      {sub ? <Text adjustsFontSizeToFit numberOfLines={2} style={[styles.tvSub, { fontSize: width / 13 }]}>{sub}</Text> : null}
    </View>
    <View style={styles.tvFoot} />
  </View>;
}

function Numbered({ number, children }: { number: number; children: React.ReactNode }) {
  return <View style={styles.numbered}><View style={styles.number}><Text style={styles.numberText}>{number}</Text></View><View style={styles.fill}>{children}</View></View>;
}

/**
 * Signage: liga um monitor a uma tela da unidade. A pessoa escolhe a unidade (o nome da tela é
 * automático), a posição do monitor, instala o app da tela pelo URL Launcher e lê o QR code que
 * ele mostra. As mídias continuam sendo montadas no sistema.
 */
export function SignageScreen({ user, simulation, onBack }: { user?: User; simulation: boolean; onBack: () => void }) {
  const [units, setUnits] = useState<SignageUnit[] | "loading" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("list");
  const [unit, setUnit] = useState<SignageUnit | null>(null);
  // `null` cria a próxima tela da unidade; uma tela escolhida troca o monitor dela.
  const [replace, setReplace] = useState<SignageUnitScreen | null>(null);
  const [showReplace, setShowReplace] = useState(false);
  const [orientation, setOrientation] = useState<SignageOrientation | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  // A câmera avisa várias vezes por segundo; só a primeira leitura de cada tentativa é enviada.
  const reading = useRef(false);

  async function refresh() {
    if (simulation || !user) { setUnits(simulationSignageUnits); return; }
    setUnits("loading"); setLoadError(null);
    try { setUnits((await loadSignageUnits(user)).units); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : null); setUnits("error"); }
  }
  useEffect(() => { void refresh(); }, [user?.uid, simulation]);

  function back() {
    if (sending) return;
    if (step === "list" || step === "done") { if (step === "done") restart(); else onBack(); return; }
    const index = FLOW.indexOf(step);
    setScanError(null);
    setStep(index <= 0 ? "list" : FLOW[index - 1]!);
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; });
    return () => subscription.remove();
  });

  function restart() {
    setStep("list"); setUnit(null); setReplace(null); setShowReplace(false); setOrientation(null); setScanError(null); setAdded(null);
    void refresh();
  }

  function chooseUnit(next: SignageUnit) {
    setUnit(next); setReplace(null); setShowReplace(false); setOrientation(null); setStep("orientation");
  }

  async function openScanner() {
    setScanError(null); reading.current = false;
    if (!simulation && !permission?.granted && !(await requestPermission()).granted) {
      setScanError("Autorize o uso da câmera para ler o QR code do monitor.");
      return;
    }
    setStep("scan");
  }

  async function submit(code: string) {
    if (!unit || !orientation) return;
    const name = replace?.name ?? unit.nextScreenName;
    if (simulation || !user) { setAdded({ name, kioskName: unit.name, orientation, created: !replace }); setStep("done"); return; }
    setSending(true);
    try {
      const result = await addSignageScreen(user, { kioskId: unit.id, ...(replace ? { screenId: replace.id } : {}), orientation, code });
      setAdded({ name: result.screen.name, kioskName: result.screen.kioskName, orientation: result.screen.orientation, created: result.created });
      setStep("done");
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : "Não foi possível adicionar a tela.");
      setStep("install");
    } finally { setSending(false); }
  }

  function onScanned(data: string) {
    if (reading.current || sending) return;
    const code = parsePairingCode(data);
    if (!code) { setScanError("Este QR code não é de uma tela do Coala Signage. Aponte para o QR code que o monitor está mostrando."); return; }
    reading.current = true; setScanError(null);
    void submit(code);
  }

  const targetName = replace?.name ?? unit?.nextScreenName ?? "";
  const flowIndex = FLOW.indexOf(step);
  const header = <ScreenHeader title={TITLES[step]} kicker={step === "list" || step === "done" ? "Coala Signage" : `Adicionar tela · etapa ${flowIndex + 1} de ${FLOW.length}`} onBack={back} backDisabled={sending}>
    {flowIndex >= 0 ? <View style={styles.progress}>{FLOW.map((item, index) => <View key={item} style={[styles.progressBar, index <= flowIndex && styles.progressOn]} />)}</View> : null}
  </ScreenHeader>;

  if (step === "scan") {
    return <View style={styles.screen}>{header}
      <View style={styles.scanArea}>
        {simulation ? <View style={styles.scanSim}><Text style={styles.scanSimText}>Na simulação não há monitor para ler.</Text><AppButton compact label="Simular leitura do QR code" onPress={() => onScanned(`${signageInstallUrl}?tela=ABCDEFGH`)} /></View>
          : <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={sending ? undefined : ({ data }) => onScanned(data)} />}
        {!simulation ? <View pointerEvents="none" style={styles.scanOverlay}><View style={styles.scanFrame} /></View> : null}
        {sending ? <View style={styles.scanBusy}><ActivityIndicator color={ui.pink} size="large" /><Text style={styles.scanBusyText}>Adicionando a tela…</Text></View> : null}
      </View>
      <View style={styles.footer}><View style={styles.footerInner}>
        <Text style={styles.footHint}>{scanError ?? `Aponte a câmera para o QR code que aparece no monitor. Ele será a ${targetName} de ${unit?.name ?? ""}.`}</Text>
        <AppButton secondary compact disabled={sending} label="Voltar às instruções" onPress={back} />
      </View></View>
    </View>;
  }

  return <View style={styles.screen}>{header}
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><FadeIn key={step} style={styles.stack}>
      {step === "list" ? <>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Adicionar uma tela</Text>
          <Text style={styles.text}>Ligue um monitor a uma unidade: você escolhe a unidade e a posição do monitor, instala o app da tela e lê o QR code que ele mostra.</Text>
          <AppButton label="Adicionar tela" disabled={units === "loading" || units === "error"} onPress={() => setStep("unit")} />
        </View>
        {units === "loading" ? <ActivityIndicator color={ui.accent} style={styles.loading} /> : null}
        {units === "error" ? <View style={styles.card}><Text style={styles.error}>{loadError ?? "Não foi possível carregar as telas. Confira a internet."}</Text><AppButton compact secondary label="Tentar de novo" onPress={() => void refresh()} /></View> : null}
        {Array.isArray(units) ? units.filter((item) => item.screens.some((screen) => screen.connected)).map((item) => <View key={item.id} style={styles.card}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          {item.screens.filter((screen) => screen.connected).map((screen) => <View key={screen.id} style={styles.row}>
            <Text style={styles.rowTitle}>{screen.name}</Text>
            <Pill tone={screen.orientation ? "info" : "neutral"} label={screen.orientation ? ORIENTATION_LABEL[screen.orientation] : "Posição não informada"} />
          </View>)}
        </View>) : null}
        {Array.isArray(units) && !units.length ? <Text style={styles.empty}>Sua conta não tem nenhuma unidade liberada para o Signage.</Text> : null}
        <Text style={styles.note}>As mídias de cada tela são montadas e publicadas no sistema, em Coala Signage.</Text>
      </> : null}

      {step === "unit" && units === "loading" ? <ActivityIndicator color={ui.accent} style={styles.loading} /> : null}
      {step === "unit" && units === "error" ? <View style={styles.card}><Text style={styles.error}>{loadError ?? "Não foi possível carregar as unidades. Confira a internet."}</Text><AppButton compact secondary label="Tentar de novo" onPress={() => void refresh()} /></View> : null}
      {step === "unit" && Array.isArray(units) ? <>
        <Text style={styles.lead}>Em qual unidade o monitor vai ficar?</Text>
        {units.map((item) => <Pressable key={item.id} accessibilityRole="button" disabled={item.full} onPress={() => chooseUnit(item)} style={({ pressed }) => [styles.option, item.full && styles.optionOff, pressed && styles.pressed]}>
          <View style={styles.fill}>
            <Text style={styles.optionTitle}>{item.name}</Text>
            <Text style={styles.text}>{item.full ? "Limite de telas atingido nesta unidade." : `A nova tela será a ${item.nextScreenName}.`}</Text>
          </View>
          {!item.full ? <Pill tone="accent" label={item.nextScreenName} /> : null}
        </Pressable>)}
      </> : null}

      {step === "orientation" && unit ? <>
        <View style={styles.summary}><Text style={styles.summaryKicker}>{replace ? "Trocar o monitor de" : "Você está adicionando"}</Text><Text style={styles.summaryTitle}>{targetName} · {unit.name}</Text></View>
        <Text style={styles.lead}>Como o monitor está instalado?</Text>
        <View style={styles.pair}>
          {(["landscape", "portrait"] as const).map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: orientation === option }} onPress={() => setOrientation(option)} style={({ pressed }) => [styles.tvCard, orientation === option && styles.tvCardOn, pressed && styles.pressed]}>
            <View style={styles.tvBox}><Tv orientation={option} size={96} active={orientation === option} /></View>
            <Text style={styles.optionTitle}>{ORIENTATION_LABEL[option]}</Text>
            <Text style={styles.tvHint}>{option === "landscape" ? "Deitado · artes 16:9" : "Em pé · artes 9:16"}</Text>
          </Pressable>)}
        </View>
        <Text style={styles.note}>A posição fica registrada na tela para as artes serem produzidas no formato certo. O sistema não gira nem estica a mídia.</Text>
        {unit.screens.some((screen) => screen.connected) ? (showReplace ? <View style={styles.card}>
          <Text style={styles.cardTitle}>Trocar o monitor de uma tela</Text>
          <Text style={styles.text}>O monitor novo assume a playlist da tela escolhida; o antigo deixa de atualizar.</Text>
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: !replace }} onPress={() => setReplace(null)} style={[styles.choice, !replace && styles.choiceOn]}><Text style={styles.rowTitle}>Tela nova · {unit.nextScreenName}</Text></Pressable>
          {unit.screens.filter((screen) => screen.connected).map((screen) => <Pressable key={screen.id} accessibilityRole="radio" accessibilityState={{ selected: replace?.id === screen.id }} onPress={() => setReplace(screen)} style={[styles.choice, replace?.id === screen.id && styles.choiceOn]}><Text style={styles.rowTitle}>{screen.name}</Text></Pressable>)}
        </View> : <Pressable accessibilityRole="button" onPress={() => setShowReplace(true)} hitSlop={6}><Text style={styles.link}>O monitor é para substituir uma tela que já existe?</Text></Pressable>) : null}
      </> : null}

      {step === "install" && unit && orientation ? <>
        <View style={styles.summary}><Text style={styles.summaryKicker}>{replace ? "Trocar o monitor de" : "Você está adicionando"}</Text><Text style={styles.summaryTitle}>{targetName} · {unit.name} · {ORIENTATION_LABEL[orientation]}</Text></View>
        <View style={styles.card}>
          <Numbered number={1}><Text style={styles.text}>No controle do monitor Samsung, aperte <Text style={styles.strong}>Home</Text> e abra <Text style={styles.strong}>URL Launcher</Text>.</Text></Numbered>
          <Numbered number={2}>
            <Text style={styles.text}>Em <Text style={styles.strong}>Install Web App</Text> (ou "Alterar URL"), digite este endereço e confirme:</Text>
            <Text selectable style={styles.url}>{signageInstallUrl}</Text>
          </Numbered>
          <Numbered number={3}><Text style={styles.text}>Aguarde: o monitor baixa e abre o Coala Signage sozinho e mostra um <Text style={styles.strong}>QR code</Text>.</Text></Numbered>
          <Numbered number={4}><Text style={styles.text}>Com o QR code na tela, toque em <Text style={styles.strong}>Ler QR code</Text> aqui embaixo e aponte a câmera para o monitor.</Text></Numbered>
        </View>
        {scanError ? <Text style={styles.errorBox}>{scanError}</Text> : null}
        {scanError && permission && !permission.granted && !permission.canAskAgain ? <AppButton compact secondary label="Abrir as configurações do aparelho" onPress={() => void Linking.openSettings()} /> : null}
      </> : null}

      {step === "done" && added ? <View style={styles.doneCard}>
        <Tv orientation={added.orientation} size={190} label={added.name.toUpperCase()} sub={`UNIDADE ${added.kioskName.toUpperCase()}`} />
        <Text style={styles.doneTitle}>{added.created ? "Tela adicionada" : "Monitor trocado"}</Text>
        <Text style={styles.doneText}>Em instantes o monitor mostra esta arte de conferência: {added.name} · {added.kioskName}. Ela sai sozinha quando houver mídia publicada.</Text>
        <Text style={styles.doneText}>Agora monte a playlist no sistema, em Coala Signage, com artes no formato {added.orientation === "portrait" ? "vertical (9:16)" : "horizontal (16:9)"}.</Text>
      </View> : null}
    </FadeIn></ScrollView>
    {step === "orientation" || step === "install" || step === "done" ? <View style={styles.footer}><View style={styles.footerInner}>
      {step === "orientation" ? <AppButton label="Continuar" disabled={!orientation} onPress={() => { setScanError(null); setStep("install"); }} /> : null}
      {step === "install" ? <AppButton label="Ler QR code" onPress={() => void openScanner()} /> : null}
      {step === "done" ? <><AppButton label="Adicionar outra tela" onPress={() => { restart(); setStep("unit"); }} /><AppButton secondary label="Concluir" onPress={restart} /></> : null}
    </View></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, screen: { flex: 1, backgroundColor: ui.page }, content: { ...contentColumn, paddingHorizontal: 20, paddingVertical: 18 }, stack: { gap: 12 }, loading: { marginVertical: 20 }, pressed: { opacity: 0.86 },
  progress: { flexDirection: "row", gap: 6, marginTop: 14 }, progressBar: { flex: 1, height: 4, borderRadius: 4, backgroundColor: ui.line }, progressOn: { backgroundColor: ui.pink },
  card: { gap: 12, padding: 16, borderRadius: 18, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border }, cardTitle: { color: ui.ink, fontSize: 15.5, fontWeight: "800" },
  text: { color: ui.inkMuted, fontSize: 13.5, lineHeight: 20 }, strong: { color: ui.ink, fontWeight: "800" }, lead: { color: ui.ink, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  note: { color: ui.inkMuted, fontSize: 12.5, lineHeight: 18 }, link: { color: ui.accentInk, fontSize: 13, fontWeight: "800", paddingVertical: 4 },
  error: { color: ui.danger, fontSize: 13, lineHeight: 19 }, errorBox: { color: ui.danger, backgroundColor: ui.dangerBg, borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  empty: { color: ui.inkMuted, backgroundColor: ui.muted, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, rowTitle: { color: ui.ink, fontSize: 14, fontWeight: "700" },
  option: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 18, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border }, optionOff: { opacity: 0.55 }, optionTitle: { color: ui.ink, fontSize: 15, fontWeight: "800" },
  summary: { gap: 2, padding: 14, borderRadius: 14, backgroundColor: ui.accentSoft }, summaryKicker: { color: ui.accentInk, fontSize: 10.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }, summaryTitle: { color: ui.ink, fontSize: 15, fontWeight: "800" },
  pair: { flexDirection: "row", gap: 10 }, tvCard: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 16, paddingHorizontal: 10, borderRadius: 18, backgroundColor: ui.surface, borderWidth: 1.5, borderColor: ui.border },
  tvCardOn: { borderColor: ui.accent, backgroundColor: ui.accentSoft }, tvBox: { height: 118, justifyContent: "center" }, tvHint: { color: ui.inkMuted, fontSize: 12 },
  tvWrap: { alignItems: "center" }, tv: { alignItems: "center", justifyContent: "center", gap: 4, padding: 6, borderRadius: 8, backgroundColor: ui.dark, borderWidth: 3, borderColor: "#3A3A45" }, tvActive: { borderColor: ui.accent },
  tvFoot: { width: 34, height: 5, marginTop: 3, borderRadius: 3, backgroundColor: "#3A3A45" }, tvLabel: { color: ui.onDark, fontWeight: "800", textAlign: "center" }, tvSub: { color: ui.onDark2, fontWeight: "700", textAlign: "center" },
  choice: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: ui.border, backgroundColor: ui.soft }, choiceOn: { borderColor: ui.accent, backgroundColor: ui.accentSoft },
  numbered: { flexDirection: "row", gap: 12 }, number: { width: 24, height: 24, borderRadius: 12, backgroundColor: ui.muted, alignItems: "center", justifyContent: "center" }, numberText: { color: ui.inkMuted, fontSize: 12, fontWeight: "800" },
  url: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: ui.dark, color: ui.onDark, fontSize: 15, fontWeight: "800", letterSpacing: 0.2, overflow: "hidden" },
  scanArea: { flex: 1, backgroundColor: "#000" }, camera: { flex: 1 }, scanOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  scanFrame: { width: 230, height: 230, borderRadius: 24, borderWidth: 3, borderColor: ui.pink }, scanBusy: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "rgba(21,21,28,0.82)" },
  scanBusyText: { color: ui.onDark, fontSize: 15, fontWeight: "700" }, scanSim: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }, scanSimText: { color: ui.onDark2, fontSize: 14, textAlign: "center" },
  footer: { borderTopWidth: 1, borderTopColor: ui.border, backgroundColor: ui.page }, footerInner: { ...contentColumn, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, gap: 8 }, footHint: { color: ui.inkMuted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  doneCard: { alignItems: "center", gap: 12, paddingVertical: 26, paddingHorizontal: 20, borderRadius: 24, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border },
  doneTitle: { color: ui.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, textAlign: "center" }, doneText: { color: ui.inkMuted, fontSize: 14, lineHeight: 21, textAlign: "center" },
});
