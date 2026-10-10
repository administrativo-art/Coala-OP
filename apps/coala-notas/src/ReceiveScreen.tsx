import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@firebase/auth";
import { ActivityIndicator, BackHandler, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { formatQuantity, parseQuantity } from "./count";
import { isoToBrDate } from "./ItemStock";
import { confirmRepositionReceipt, createSimulationRepositions, loadRepositionsToReceive, receiptRowKey, type ReceiptDraft, type RepositionRow, type RepositionToReceive } from "./reposition";
import { colors, contentColumn } from "./theme";
import { AppButton, BusyOverlay, FadeIn, FillBar, Pill, ScreenHeader, ui } from "./ui";

// Mesmo ritmo da contagem: poucos insumos por tela.
const PRODUCTS_PER_STEP = 3;
const maskQuantity = (value: string) => value.replace(/[^\d,]/g, "").replace(/(,.*),/g, "$1").slice(0, 12);

function rowProblem(row: RepositionRow, draft: ReceiptDraft) {
  if (!draft.received.trim()) return "Informe a quantidade recebida (use 0 se não chegou).";
  if (parseQuantity(draft.received) !== row.sentQuantity && draft.notes.trim().length < 3) return "Explique a diferença em relação ao que foi enviado.";
  return null;
}

/** Recebimento da reposição na unidade de destino. Só esta etapa existe no aplicativo; o estoque entra quando a reposição é efetivada no Coala One. */
export function ReceiveScreen({ user, simulation, onBack }: { user?: User; simulation: boolean; onBack: () => void }) {
  const [activities, setActivities] = useState<RepositionToReceive[] | null>(simulation ? createSimulationRepositions() : null);
  const [truncated, setTruncated] = useState(false);
  const [activity, setActivity] = useState<RepositionToReceive | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [step, setStep] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ unitName: string; hasDivergence: boolean } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  async function refresh() {
    if (simulation || !user) return;
    setError(null);
    try { const result = await loadRepositionsToReceive(user); setActivities(result.activities); setTruncated(result.truncated); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar as reposições."); }
  }
  useEffect(() => { void refresh(); }, [user?.uid, simulation]);

  function open(next: RepositionToReceive) {
    // Parte do que foi enviado: quem recebeu tudo certo só confere e avança.
    setDrafts(Object.fromEntries(next.rows.map((row) => [receiptRowKey(row), { received: formatQuantity(row.sentQuantity), notes: "" }])));
    setActivity(next); setStep(0); setConfirming(false); setShowProblems(false); setError(null); setDone(null);
  }

  const products = useMemo(() => {
    const groups = new Map<string, RepositionRow[]>();
    for (const row of activity?.rows ?? []) groups.set(row.productName, [...(groups.get(row.productName) ?? []), row]);
    return [...groups.entries()].map(([name, rows]) => ({ name, rows }));
  }, [activity]);
  const stepCount = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_STEP));
  const currentStep = Math.min(step, stepCount - 1);
  const stepProducts = products.slice(currentStep * PRODUCTS_PER_STEP, (currentStep + 1) * PRODUCTS_PER_STEP);
  const lastStep = currentStep === stepCount - 1;
  const problemOf = (row: RepositionRow) => rowProblem(row, drafts[receiptRowKey(row)] ?? { received: "", notes: "" });
  const stepHasProblem = stepProducts.some((product) => product.rows.some((row) => problemOf(row)));
  const divergent = (activity?.rows ?? []).filter((row) => parseQuantity(drafts[receiptRowKey(row)]?.received ?? "") !== row.sentQuantity).length;

  function goToStep(next: number) {
    if (next > currentStep && stepHasProblem) { setShowProblems(true); setError("Complete os lotes marcados antes de avançar."); return; }
    setShowProblems(false); setError(null); setConfirming(false); setStep(Math.max(0, Math.min(next, stepCount - 1)));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }
  function change(row: RepositionRow, patch: Partial<ReceiptDraft>) {
    const key = receiptRowKey(row);
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { received: "", notes: "" }), ...patch } }));
    setConfirming(false); setError(null);
  }
  async function confirm() {
    if (!activity || busy) return;
    setBusy(true); setError(null);
    try {
      const hasDivergence = simulation || !user ? divergent > 0 : (await confirmRepositionReceipt(user, activity.id, activity.rows.map((row) => {
        const draft = drafts[receiptRowKey(row)]!;
        return { baseProductId: row.baseProductId, lotId: row.lotId, receivedQuantity: parseQuantity(draft.received), notes: draft.notes.trim() };
      }))).hasDivergence;
      setDone({ unitName: activity.destinationName, hasDivergence });
      setActivities((current) => current?.filter((row) => row.id !== activity.id) ?? null);
      setActivity(null); setConfirming(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar o recebimento."); setConfirming(false); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy) return true;
      if (confirming) { setConfirming(false); return true; }
      if (activity && currentStep > 0) { goToStep(currentStep - 1); return true; }
      if (activity) { setActivity(null); return true; }
      onBack(); return true;
    });
    return () => subscription.remove();
  }, [busy, confirming, activity, currentStep, drafts]);

  if (activity) {
    return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
      <ScreenHeader title="Recebimento" onBack={() => setActivity(null)} backLabel="Voltar para a lista" backDisabled={busy}>
        <Text style={styles.headerMeta}>{activity.originName} → {activity.destinationName}{activity.dispatchedAt ? ` · despachada em ${isoToBrDate(activity.dispatchedAt)}` : ""}{simulation ? " · simulação" : ""}</Text>
      </ScreenHeader>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><FadeIn key={currentStep} style={styles.stack}>
        <View style={styles.progress}><Text style={styles.progressText}>Etapa {currentStep + 1} de {stepCount}</Text><Text style={styles.meta}>{divergent === 0 ? "Sem diferença até aqui" : `${divergent} ${divergent === 1 ? "lote com diferença" : "lotes com diferença"}`}</Text></View>
        <View style={styles.segments}>{Array.from({ length: stepCount }, (_, index) => <View key={index} style={[styles.segment, index <= currentStep && styles.segmentOn]} />)}</View>
        {currentStep === 0 ? <Text style={styles.hint}>A quantidade recebida já vem igual à enviada. Altere só o que chegou diferente e explique o motivo.</Text> : null}
        {stepProducts.map((product) => <View key={product.name} style={styles.product}>
          <View style={styles.productHead}>
            {product.rows.find((row) => row.imageUrl) ? <Image source={{ uri: product.rows.find((row) => row.imageUrl)!.imageUrl! }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]}><Text style={styles.thumbText}>sem foto</Text></View>}
            <Text style={[styles.productName, styles.fillText]}>{product.name}</Text>
          </View>
          {product.rows.map((row) => {
            const draft = drafts[receiptRowKey(row)] ?? { received: "", notes: "" };
            const differs = draft.received.trim() !== "" && parseQuantity(draft.received) !== row.sentQuantity;
            const problem = showProblems ? problemOf(row) : null;
            return <View key={receiptRowKey(row)} style={[styles.lot, differs && styles.lotDiffers, problem ? styles.lotProblem : null]}>
              <View style={styles.lotHead}><Text style={styles.mono}>{row.lotNumber}</Text>{differs ? <Pill tone="warn" label="Diferença" /> : null}</View>
              <View style={styles.row}>
                <View style={styles.fill}><Text style={styles.label}>Enviado</Text><Text style={styles.sent}>{formatQuantity(row.sentQuantity)}</Text></View>
                <View style={styles.fill}><Text style={styles.label}>Recebido</Text><TextInput value={draft.received} onChangeText={(received) => change(row, { received: maskQuantity(received) })} keyboardType="decimal-pad" placeholder="0" selectTextOnFocus style={styles.input} /></View>
              </View>
              {differs ? <TextInput value={draft.notes} onChangeText={(notes) => change(row, { notes })} maxLength={240} placeholder="Explique a diferença (obrigatório)" style={styles.input} /> : null}
              {problem ? <Text style={styles.error}>{problem}</Text> : null}
            </View>;
          })}
        </View>)}
      </FadeIn></ScrollView>
      <View style={styles.footer}><View style={styles.footerInner}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {confirming ? <View style={styles.confirm}>
          <Text style={styles.confirmText}>Confirmar o recebimento em {activity.destinationName}? {divergent === 0 ? "Tudo chegou como enviado." : `${divergent} ${divergent === 1 ? "lote será registrado" : "lotes serão registrados"} com diferença.`} Depois de confirmado, não é possível alterar pelo aplicativo.</Text>
          <View style={styles.row}><View style={styles.fill}><AppButton compact secondary label="Voltar" onPress={() => setConfirming(false)} disabled={busy} /></View><View style={styles.fill}><AppButton compact label="Confirmar" onPress={() => void confirm()} disabled={busy} /></View></View>
        </View> : <View style={styles.row}>
          <View style={styles.fill}><AppButton compact secondary label="Anterior" onPress={() => goToStep(currentStep - 1)} disabled={busy || currentStep === 0} /></View>
          <View style={styles.fill}>{lastStep
            ? <AppButton compact label="Confirmar recebimento" onPress={() => { if (stepHasProblem) { setShowProblems(true); setError("Complete os lotes marcados antes de confirmar."); return; } setError(null); setConfirming(true); }} disabled={busy} />
            : <AppButton compact label="Próximo" onPress={() => goToStep(currentStep + 1)} disabled={busy} />}</View>
        </View>}
      </View></View>
      <BusyOverlay text={busy ? "Confirmando recebimento…" : null} />
    </KeyboardAvoidingView>;
  }

  return <View style={styles.fill}>
    <ScreenHeader kicker={simulation ? "COALA ONE · SIMULAÇÃO" : "COALA ONE"} title="Recebimento" onBack={onBack} backLabel="Voltar para o início" />
    <FlatList
    data={activities ?? []}
    keyExtractor={(row) => row.id}
    contentContainerStyle={styles.content}
    ItemSeparatorComponent={() => <View style={styles.gap} />}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void refresh().finally(() => setRefreshing(false)); }} />}
    ListHeaderComponent={<View style={styles.headerBlock}>
      {done ? <View style={styles.success}><Text style={styles.successTitle}>{simulation ? "Simulação concluída" : "Recebimento registrado"}</Text><Text style={styles.successText}>{simulation ? "Nada foi enviado ao Coala One." : `${done.unitName}: ${done.hasDivergence ? "recebido com diferença, que será analisada antes da entrada no estoque." : "recebido sem diferença."} O estoque é atualizado quando a reposição for efetivada no Coala One.`}</Text></View> : null}
      {error ? <Text style={styles.errorBox}>{error}</Text> : null}
      {!activities && !error ? <View style={styles.loading}><ActivityIndicator color={ui.accent} /><Text style={styles.hint}>Carregando reposições…</Text></View> : null}
      {activities?.length ? <Text style={styles.hint}>Reposições enviadas para as suas unidades e ainda não recebidas. Puxe para atualizar.</Text> : null}
      {activities && !activities.length ? <Text style={styles.empty}>Nenhuma reposição aguardando recebimento nas suas unidades. Puxe para atualizar.</Text> : null}
      {truncated ? <Text style={styles.empty}>Há mais reposições em trânsito do que o aplicativo lista. Receba as mais antigas primeiro.</Text> : null}
    </View>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => open(item)} style={styles.card}>
      <View style={styles.fill}>
        <Text style={styles.cardTitle}>{item.destinationName}</Text>
        <Text style={styles.meta}>De {item.originName}{item.dispatchedAt ? ` · enviada em ${isoToBrDate(item.dispatchedAt)}` : ""}</Text>
        <Text style={styles.meta}>{item.rows.length} {item.rows.length === 1 ? "lote" : "lotes"}</Text>
      </View>
      <Text style={styles.cardAction}>Receber ›</Text>
    </Pressable>}
  />
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: ui.page }, content: { ...contentColumn, paddingHorizontal: 20, paddingVertical: 16 }, stack: { gap: 10 }, gap: { height: 10 }, headerBlock: { gap: 10, marginBottom: 10 },
  headerMeta: { color: ui.onDarkSub, fontSize: 12.5 }, hint: { color: ui.inkMuted, fontSize: 12, lineHeight: 17 }, meta: { color: ui.inkMuted, fontSize: 12, lineHeight: 17 }, loading: { alignItems: "center", gap: 8, paddingVertical: 24 },
  progress: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }, progressText: { color: ui.ink, fontSize: 14, fontWeight: "800" },
  segments: { flexDirection: "row", gap: 4 }, segment: { flex: 1, height: 4, borderRadius: 4, backgroundColor: ui.border }, segmentOn: { backgroundColor: ui.accent },
  product: { gap: 8 }, productName: { color: ui.ink, fontSize: 14, fontWeight: "800" }, productHead: { flexDirection: "row", alignItems: "center", gap: 10 }, fillText: { flex: 1 },
  thumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: ui.muted }, thumbEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: ui.border }, thumbText: { color: ui.inkFaint, fontSize: 9, fontWeight: "700" },
  lot: { backgroundColor: ui.surface, borderRadius: 16, borderWidth: 1, borderColor: ui.border, padding: 14, gap: 8 }, lotDiffers: { borderWidth: 2, borderColor: ui.warn, padding: 13 }, lotProblem: { borderWidth: 2, borderColor: ui.danger, backgroundColor: "#FFF5F6", padding: 13 },
  lotHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }, mono: { color: ui.inkFaint, fontSize: 11, fontFamily: "monospace" },
  row: { flexDirection: "row", gap: 8 }, label: { color: ui.inkMuted, fontSize: 11.5, fontWeight: "700", marginBottom: 3 }, sent: { color: ui.ink, fontSize: 16, fontWeight: "800", paddingTop: 9 },
  input: { height: 40, borderWidth: 1, borderColor: ui.borderInput, backgroundColor: ui.soft, borderRadius: 11, paddingHorizontal: 12, color: ui.ink, fontSize: 15, fontWeight: "700" },
  error: { color: ui.danger, fontSize: 12.5, lineHeight: 18, fontWeight: "600" }, errorBox: { color: ui.danger, backgroundColor: ui.dangerBg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 12.5, lineHeight: 18, fontWeight: "600" }, empty: { color: ui.inkMuted, backgroundColor: ui.muted, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 },
  footer: { borderTopWidth: 1, borderTopColor: ui.border, backgroundColor: ui.page }, footerInner: { ...contentColumn, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, gap: 8 },
  confirm: { gap: 10, borderRadius: 14, backgroundColor: colors.alertBg, borderWidth: 1, borderColor: colors.alertBorder, padding: 12 }, confirmText: { color: colors.alertInk, fontSize: 13, lineHeight: 19 },
  success: { borderRadius: 14, backgroundColor: ui.okBg, borderWidth: 1, borderColor: "#BFE3CC", paddingVertical: 14, paddingHorizontal: 16, gap: 3 }, successTitle: { color: "#0F5A2B", fontSize: 14, fontWeight: "800" }, successText: { color: "#14532D", fontSize: 13, lineHeight: 19 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: ui.surface, borderRadius: 16, borderWidth: 1, borderColor: ui.border, padding: 16 }, cardTitle: { color: ui.ink, fontSize: 15.5, fontWeight: "800" }, cardAction: { color: ui.accentInk, fontSize: 13.5, fontWeight: "800" },
});
