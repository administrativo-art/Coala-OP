import { useEffect, useState, type ReactNode } from "react";
import type { User } from "@firebase/auth";
import * as ImagePicker from "expo-image-picker";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Avatar } from "./Avatar";
import { loadOfflineQueue } from "./offline-queue";
import { uploadProfilePhoto, type AppModules, type AppProfile } from "./profile";
import { contentColumn } from "./theme";
import { AppButton, Brand, FadeIn, GoalsIcon, Pill, PurchaseArt, ScheduleIcon, StockIcon, TruckIcon, ui } from "./ui";

export type AppModule = "local-purchase" | "stock-count" | "reposition-receipt" | "goals" | "schedule";

function greeting(name: string) {
  const hour = new Date().getHours();
  const salute = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${salute}, ${first}` : salute;
}

const SMALL: Array<{ id: AppModule; module: keyof AppModules; title: string; hint: string; icon: ReactNode }> = [
  { id: "stock-count", module: "stockCount", title: "Contagem de estoque", hint: "Saídas e sobras do turno", icon: <StockIcon /> },
  { id: "reposition-receipt", module: "repositionReceipt", title: "Recebimento", hint: "O que chegou da reposição", icon: <TruckIcon /> },
  { id: "goals", module: "goals", title: "Metas", hint: "O que falta e o placar da equipe", icon: <GoalsIcon /> },
  { id: "schedule", module: "schedule", title: "Escala", hint: "Quem trabalha e suas folgas", icon: <ScheduleIcon /> },
];

/** Tela de entrada: saudação no cabeçalho escuro e um cartão por função liberada no perfil da pessoa. */
export function HomeScreen({ user, simulation, profile, modules, onOpen, onExit, onPhotoChanged }: { user?: User; simulation: boolean; profile: AppProfile | null; modules: AppModules | null; onOpen: (module: AppModule) => void; onExit: () => void; onPhotoChanged: (avatarUrl: string) => void }) {
  const [pending, setPending] = useState(0);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  useEffect(() => { if (!simulation && user?.uid) void loadOfflineQueue(user.uid).then((queue) => setPending(queue.length)); }, [simulation, user?.uid]);
  const name = simulation ? "Simulação" : profile?.name ?? "";
  const canChangePhoto = !simulation && !!user && !!profile;
  // Sem a lista de permissões (falha de rede), todos os módulos aparecem; o servidor continua barrando o que não for permitido.
  const allowed = (module: keyof AppModules) => simulation || !modules || modules[module];
  const small = SMALL.filter((card) => allowed(card.module));

  // Foto quadrada e leve: é exibida pequena e viaja em toda lista de equipe.
  async function changePhoto(source: "camera" | "library") {
    if (!user || photoBusy) return;
    setPhotoError(null);
    try {
      if (source === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) { setPhotoError("Autorize o uso da câmera para tirar a foto."); return; }
      const options = { mediaTypes: ["images"] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.6 };
      const result = source === "camera" ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) { setPhotoError("A foto deve ter no máximo 5 MB."); return; }
      setPhotoBusy(true);
      onPhotoChanged(await uploadProfilePhoto(user, { uri: asset.uri, mimeType: asset.mimeType || "image/jpeg" }));
      setPhotoMenu(false);
    } catch (cause) { setPhotoError(cause instanceof Error ? cause.message : "Não foi possível salvar a foto."); }
    finally { setPhotoBusy(false); }
  }

  return <View style={styles.fill}>
    <View style={styles.header}><View style={styles.headerInner}>
      <View style={styles.brandRow}><Brand size={20} /><Pressable accessibilityRole="button" onPress={onExit} hitSlop={8}><Text style={styles.exit}>{simulation ? "Sair do teste" : "Sair"}</Text></Pressable></View>
      <View style={styles.who}>
        <Pressable accessibilityRole="button" accessibilityLabel="Trocar foto de perfil" disabled={!canChangePhoto} onPress={() => { setPhotoError(null); setPhotoMenu((open) => !open); }}>
          <Avatar key={profile?.avatarUrl ?? "sem-foto"} name={name || "Coala One"} url={simulation ? null : profile?.avatarUrl} size={54} />
          {canChangePhoto ? <View style={styles.photoBadge}><Text style={styles.photoBadgeText}>✎</Text></View> : null}
        </Pressable>
        <View style={styles.whoText}><Text numberOfLines={1} style={styles.hello}>{simulation ? "Modo de simulação" : greeting(name)}</Text><Text numberOfLines={1} style={styles.email}>{simulation ? "Nada é enviado ao Coala One" : profile?.role ?? user?.email ?? ""}</Text></View>
      </View>
    </View></View>
    <ScrollView contentContainerStyle={styles.content}><FadeIn style={styles.stack}>
      {photoMenu ? <View style={styles.card}>
        <Text style={styles.cardTitle}>Foto de perfil</Text>
        <Text style={styles.hint}>A foto aparece para a equipe na escala, nas metas e no Coala One.</Text>
        {photoError ? <Text style={styles.error}>{photoError}</Text> : null}
        <AppButton compact disabled={photoBusy} label={photoBusy ? "Salvando…" : "Tirar foto"} onPress={() => void changePhoto("camera")} />
        <AppButton compact secondary disabled={photoBusy} label="Escolher da galeria" onPress={() => void changePhoto("library")} />
        <AppButton compact secondary disabled={photoBusy} label="Cancelar" onPress={() => setPhotoMenu(false)} />
      </View> : null}
      {allowed("localPurchase") ? <Pressable accessibilityRole="button" onPress={() => onOpen("local-purchase")} style={({ pressed }) => [styles.hero, pressed && styles.pressed]}>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>Compra local</Text>
          <Text style={styles.hint}>Nota de sangria ou de compra paga pela empresa.</Text>
          {pending ? <View style={styles.pills}><Pill label={`${pending} ${pending === 1 ? "nota" : "notas"} no aparelho`} /></View> : null}
        </View>
        <View style={styles.heroArt}><PurchaseArt /></View>
      </Pressable> : null}
      <View style={styles.grid}>{small.map((card) => <Pressable key={card.id} accessibilityRole="button" onPress={() => onOpen(card.id)} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
        <View style={styles.tileIcon}>{card.icon}</View>
        <Text style={styles.tileTitle}>{card.title}</Text>
        <Text style={styles.tileHint}>{card.hint}</Text>
      </Pressable>)}</View>
      {!allowed("localPurchase") && !small.length ? <Text style={styles.empty}>Seu perfil ainda não tem nenhuma função do aplicativo liberada. Peça ao responsável para ajustar as permissões em "Coala One · APP".</Text> : null}
    </FadeIn></ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: ui.page }, header: { backgroundColor: ui.dark, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, headerInner: { ...contentColumn, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 22, gap: 16 },
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, exit: { color: ui.onDarkSub, fontSize: 12.5, fontWeight: "700" },
  who: { flexDirection: "row", alignItems: "center", gap: 14 }, whoText: { flex: 1, gap: 2 }, hello: { color: ui.onDark, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 }, email: { color: ui.onDarkSub, fontSize: 12.5 },
  photoBadge: { position: "absolute", right: -3, bottom: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: ui.dark, borderWidth: 2, borderColor: ui.dark, alignItems: "center", justifyContent: "center" }, photoBadgeText: { color: ui.onDark, fontSize: 11 },
  content: { ...contentColumn, paddingHorizontal: 20, paddingVertical: 16 }, stack: { gap: 10 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 22, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border, shadowColor: ui.accent, shadowOpacity: 0.14, shadowRadius: 30, shadowOffset: { width: 0, height: 14 }, elevation: 4 },
  heroText: { flex: 1, gap: 5 }, heroTitle: { color: ui.ink, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 }, pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 4 },
  heroArt: { width: 84, height: 104, borderRadius: 16, backgroundColor: ui.accentSoft, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, tile: { flexGrow: 1, flexBasis: "47%", gap: 8, padding: 14, borderRadius: 20, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border },
  tileIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#F6F4EF", alignItems: "center", justifyContent: "center", overflow: "hidden" }, tileTitle: { color: ui.ink, fontSize: 14, fontWeight: "800", lineHeight: 17 }, tileHint: { color: ui.inkMuted, fontSize: 11.5, lineHeight: 16 },
  card: { gap: 10, padding: 16, borderRadius: 18, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border }, cardTitle: { color: ui.ink, fontSize: 15, fontWeight: "800" }, hint: { color: ui.inkMuted, fontSize: 12, lineHeight: 17 },
  error: { color: ui.danger, fontSize: 13, lineHeight: 19 }, empty: { color: ui.inkMuted, backgroundColor: ui.muted, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 }, pressed: { opacity: 0.86 },
});
