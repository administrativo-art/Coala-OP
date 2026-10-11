import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import * as Application from "expo-application";

import { downloadAndInstall, installedVersionCode, loadRelease, updateState, type AppRelease } from "./app-update";
import { AppButton, FillBar, ui } from "./ui";

/** Baixa e abre o instalador; devolve o estado da ação para a faixa e a tela cheia mostrarem igual. */
function useUpdate(release: AppRelease) {
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setError(null);
    setPercent(0);
    try {
      await downloadAndInstall(release, setPercent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível baixar a atualização. Confira a internet.");
    } finally {
      setPercent(null);
    }
  }
  return { percent, error, run };
}

const hint = "Ao terminar o download, o Android pede para você tocar em Instalar. Se pedir, permita a instalação por esta fonte.";

/** Versão abaixo da mínima: o aplicativo só oferece a atualização. */
export function UpdateRequired({ release }: { release: AppRelease }) {
  const { percent, error, run } = useUpdate(release);
  const busy = percent !== null;
  return <View style={styles.full}>
    <Text style={styles.title}>Atualização necessária</Text>
    <Text style={styles.text}>Esta versão do Coala One não funciona mais. Instale a versão {release.versionName} para continuar.</Text>
    {busy ? <View style={styles.progress}><FillBar percent={percent} height={8} color={ui.pink} track="#2B2B30" /><Text style={styles.text}>Baixando… {percent}%</Text></View> : <AppButton label="Atualizar agora" onPress={() => void run()} />}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Text style={styles.small}>{hint}</Text>
  </View>;
}

/** Há versão nova, mas a atual ainda serve: faixa no topo, sem travar o uso. */
export function UpdateBanner({ release, onDismiss }: { release: AppRelease; onDismiss: () => void }) {
  const { percent, error, run } = useUpdate(release);
  const busy = percent !== null;
  return <View style={styles.banner}>
    <Text style={styles.bannerTitle}>Nova versão {release.versionName} disponível</Text>
    {busy ? <FillBar percent={percent} height={6} /> : null}
    <Text style={styles.bannerText}>{busy ? `Baixando… ${percent}%` : error ?? hint}</Text>
    {busy ? null : <View style={styles.row}>
      <View style={styles.fill}><AppButton compact label="Atualizar" onPress={() => void run()} /></View>
      <View style={styles.fill}><AppButton compact secondary label="Depois" onPress={onDismiss} /></View>
    </View>}
  </View>;
}

/** Rodapé da tela inicial: versão instalada e botão que confere (e instala) a atualização a qualquer hora. */
export function VersionRow({ release, onChecked }: { release: AppRelease | null; onChecked: (release: AppRelease) => void }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { percent, error, run } = useUpdate(release ?? { versionCode: 0, versionName: "", minVersionCode: 0, packagePath: "" });
  const hasUpdate = updateState(release, installedVersionCode()) !== "current";
  async function check() {
    setChecking(true);
    setMessage(null);
    const next = await loadRelease();
    setChecking(false);
    if (!next) { setMessage("Não foi possível consultar. Confira a internet."); return; }
    onChecked(next);
    if (updateState(next, installedVersionCode()) === "current") setMessage("Você está na versão mais recente.");
  }
  const busy = percent !== null;
  return <View style={styles.version}>
    <Text style={styles.versionText}>Coala One · versão {Application.nativeApplicationVersion ?? "?"}</Text>
    {busy ? <FillBar percent={percent} height={6} /> : null}
    {message || error ? <Text style={styles.bannerText}>{error ?? message}</Text> : null}
    {busy ? <Text style={styles.bannerText}>Baixando… {percent}%</Text>
      : hasUpdate && release ? <AppButton compact label={`Atualizar para ${release.versionName}`} onPress={() => void run()} />
      : <AppButton compact secondary disabled={checking} label={checking ? "Consultando…" : "Verificar atualização"} onPress={() => void check()} />}
  </View>;
}

const styles = StyleSheet.create({
  version: { gap: 8, marginTop: 18, alignItems: "stretch" }, versionText: { color: ui.inkMuted, fontSize: 12, textAlign: "center" },
  full: { flex: 1, alignItems: "stretch", justifyContent: "center", gap: 14, padding: 24, backgroundColor: ui.dark },
  title: { color: ui.onDark, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  text: { color: ui.onDarkSub, fontSize: 15, lineHeight: 22 },
  small: { color: ui.onDarkFaint, fontSize: 12.5, lineHeight: 18 },
  error: { color: "#FCA5A5", fontSize: 13, lineHeight: 19, fontWeight: "600" },
  progress: { gap: 10 },
  banner: { gap: 8, padding: 14, margin: 12, borderRadius: 16, backgroundColor: ui.infoBg, borderWidth: 1, borderColor: ui.border },
  bannerTitle: { color: ui.ink, fontSize: 14.5, fontWeight: "800" },
  bannerText: { color: ui.inkMuted, fontSize: 12.5, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10 }, fill: { flex: 1 },
});
