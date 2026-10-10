import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@firebase/auth";
import { ActivityIndicator, BackHandler, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import {
  clearLocalDrafts, createSimulationCountSession, DEFAULT_EXIT_REASON, draftChanged, draftFromItem, finalQuantity, formatQuantity,
  loadCountContext, loadLocalDrafts, OTHER_EXIT_REASON, parseQuantity, saveCount, saveLocalDrafts, simulationCountContext, startCount,
  type CountContext, type CountDraft, type CountDrafts, type CountItem, type CountSession,
} from "./count";
import { isoToBrDate } from "./ItemStock";
import { colors, contentColumn } from "./theme";
import { AppButton, BusyOverlay, FadeIn, FillBar, HeaderAction, ScreenHeader, ui } from "./ui";

// A contagem anda em etapas curtas: poucos insumos por tela, para o operador não se perder numa lista longa.
const PRODUCTS_PER_STEP = 3;
const emptyDraft: CountDraft = { exit: "", reason: DEFAULT_EXIT_REASON, exitNotes: "", entry: "", entryNotes: "" };
const maskQuantity = (value: string) => value.replace(/[^\d,]/g, "").replace(/(,.*),/g, "$1").slice(0, 12);

/** Cabeçalho do insumo: foto do cadastro (toque para ampliar), nome e a instrução de contagem, quando houver. */
function ProductHeader({ name, imageUrl, instruction }: { name: string; imageUrl: string | null; instruction: string | null }) {
  const [enlarged, setEnlarged] = useState(false);
  const [failed, setFailed] = useState(false);
  const photo = imageUrl && !failed ? imageUrl : null;
  return <View style={styles.productHeader}>
    <View style={styles.row}>
      {photo ? <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar a foto de ${name}`} onPress={() => setEnlarged((open) => !open)}><Image source={{ uri: photo }} onError={() => setFailed(true)} style={styles.productThumb} /></Pressable>
        : <View style={[styles.productThumb, styles.productThumbEmpty]}><Text style={styles.productThumbText}>sem foto</Text></View>}
      <View style={styles.fill}><Text style={styles.lotName}>{name}</Text>{instruction ? <Text style={styles.instruction}>Como contar: {instruction}</Text> : null}</View>
    </View>
    {photo && enlarged ? <Pressable accessibilityRole="button" accessibilityLabel="Fechar a foto" onPress={() => setEnlarged(false)}><Image resizeMode="contain" source={{ uri: photo }} style={styles.productPhoto} /></Pressable> : null}
  </View>;
}

/** Um lote do insumo: quantidade do sistema e os dois lançamentos do turno, a saída (com um motivo) e a sobra. */
function LotRow(props: { item: CountItem; draft: CountDraft | undefined; reasons: CountContext["exitReasons"]; problem: string | null; onChange: (draft: CountDraft) => void }) {
  const { item } = props;
  const draft = props.draft ?? emptyDraft;
  const changed = draftChanged(props.draft);
  const final = finalQuantity(item, props.draft);
  return <View style={[styles.lot, changed && styles.lotChanged, props.problem ? styles.lotProblem : null]}>
    <View>
      <Text style={styles.lotMeta}>Lote {item.lotNumber}{item.expiryDate ? ` · val. ${isoToBrDate(item.expiryDate)}` : ""}</Text>
      <View style={styles.lotNumbers}>
        <Text style={styles.lotSystem}>Sistema: <Text style={styles.lotSystemValue}>{formatQuantity(item.systemQuantity)} {item.displayUnit}</Text></Text>
        <Text style={[styles.lotFinal, changed && styles.lotFinalChanged, props.problem ? styles.lotFinalProblem : null]}>{changed ? `Final: ${formatQuantity(final)} ${item.displayUnit}` : "Sem alteração"}</Text>
      </View>
    </View>
    <View style={styles.editor}>
      <View style={styles.row}>
        <View style={styles.fill}><Text style={styles.label}>Saída do turno</Text><TextInput value={draft.exit} onChangeText={(exit) => props.onChange({ ...draft, exit: maskQuantity(exit) })} keyboardType="decimal-pad" placeholder="0" style={styles.input} /></View>
        <View style={styles.fill}><Text style={styles.label}>Sobra encontrada</Text><TextInput value={draft.entry} onChangeText={(entry) => props.onChange({ ...draft, entry: maskQuantity(entry) })} keyboardType="decimal-pad" placeholder="0" style={styles.input} /></View>
      </View>
      {parseQuantity(draft.exit) > 0 ? <>
        <View style={styles.chips}>{props.reasons.map((reason) => <Pressable key={reason.value} accessibilityRole="radio" accessibilityState={{ selected: draft.reason === reason.value }} onPress={() => props.onChange({ ...draft, reason: reason.value })} style={[styles.reason, draft.reason === reason.value && styles.reasonOn]}><Text style={[styles.chipText, draft.reason === reason.value && styles.reasonTextOn]}>{reason.label}</Text></Pressable>)}</View>
        <TextInput value={draft.exitNotes} onChangeText={(exitNotes) => props.onChange({ ...draft, exitNotes })} maxLength={240} placeholder={draft.reason === OTHER_EXIT_REASON ? "Descreva o motivo (obrigatório)" : "Observação (opcional)"} style={styles.input} />
      </> : null}
      {parseQuantity(draft.entry) > 0 ? <TextInput value={draft.entryNotes} onChangeText={(entryNotes) => props.onChange({ ...draft, entryNotes })} maxLength={240} placeholder="Observação da sobra (opcional)" style={styles.input} /> : null}
      {props.problem ? <Text style={styles.error}>{props.problem}</Text> : null}
      {changed ? <Pressable accessibilityRole="button" onPress={() => props.onChange({ ...emptyDraft })}><Text style={styles.link}>Limpar lançamentos deste lote</Text></Pressable> : null}
    </View>
  </View>;
}

function lotProblem(item: CountItem, draft: CountDraft | undefined) {
  if (!draftChanged(draft)) return null;
  if (finalQuantity(item, draft) < 0) return "A saída é maior que a quantidade em estoque.";
  if (parseQuantity(draft!.exit) > 0 && draft!.reason === OTHER_EXIT_REASON && draft!.exitNotes.trim().length < 3) return "Descreva o motivo da saída marcada como Outros.";
  return null;
}

/** Contagem de estoque do turno, com as mesmas regras do Coala One: saídas e entradas sobre a quantidade do sistema. */
export function CountScreen({ user, simulation, onBack }: { user?: User; simulation: boolean; onBack: () => void }) {
  const [context, setContext] = useState<CountContext | null>(simulation ? simulationCountContext : null);
  const [session, setSession] = useState<CountSession | null>(null);
  const [drafts, setDrafts] = useState<CountDrafts>({});
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [search, setSearch] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ adjustedLots: number; unitName: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refreshContext() {
    if (simulation || !user) return;
    setError(null);
    try { setContext(await loadCountContext(user)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar as contagens."); }
  }
  useEffect(() => { void refreshContext(); }, [user?.uid, simulation]);

  async function open(kioskId: string) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null); setDone(null);
    try {
      const opened = simulation || !user ? createSimulationCountSession() : (await startCount(user, kioskId)).session;
      const server: CountDrafts = Object.fromEntries(opened.items.filter((item) => item.exitQuantity > 0 || item.entryQuantity > 0).map((item) => [item.lotId, draftFromItem(item)]));
      // O que ficou só no aparelho (sem internet na hora de salvar) vale sobre o rascunho do servidor.
      const local = simulation ? null : await loadLocalDrafts(opened.id);
      const known = new Set(opened.items.map((item) => item.lotId));
      setDrafts({ ...server, ...Object.fromEntries(Object.entries(local ?? {}).filter(([lotId]) => known.has(lotId))) });
      setSession(opened); setStep(0); setSearch(""); setOnlyChanged(false); setConfirming(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a contagem."); }
    finally { setBusy(false); }
  }

  function change(lotId: string, draft: CountDraft) {
    setDrafts((current) => {
      const next = { ...current, [lotId]: draft };
      if (session && !simulation) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void saveLocalDrafts(session.id, next), 600);
      }
      return next;
    });
    setConfirming(false); setError(null);
  }

  const problems = useMemo(() => new Map((session?.items ?? []).flatMap((item) => { const problem = lotProblem(item, drafts[item.lotId]); return problem ? [[item.lotId, problem] as const] : []; })), [session, drafts]);
  const changedCount = useMemo(() => (session?.items ?? []).filter((item) => draftChanged(drafts[item.lotId])).length, [session, drafts]);
  const visible = useMemo(() => {
    const words = search.trim().toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean);
    return (session?.items ?? []).filter((item) => (!onlyChanged || draftChanged(drafts[item.lotId]))
      && words.every((word) => `${item.productName} ${item.lotNumber}`.toLocaleLowerCase("pt-BR").includes(word)));
  }, [session, drafts, search, onlyChanged]);

  // Cada etapa mostra poucos insumos; um insumo com vários lotes aparece inteiro na mesma etapa.
  const products = useMemo(() => {
    const groups = new Map<string, CountItem[]>();
    for (const item of visible) groups.set(item.productName, [...(groups.get(item.productName) ?? []), item]);
    return [...groups.entries()].map(([name, lots]) => ({ name, lots }));
  }, [visible]);
  const stepCount = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_STEP));
  const currentStep = Math.min(step, stepCount - 1);
  const stepProducts = products.slice(currentStep * PRODUCTS_PER_STEP, (currentStep + 1) * PRODUCTS_PER_STEP);
  const stepHasProblem = stepProducts.some((product) => product.lots.some((lot) => problems.has(lot.lotId)));
  const lastStep = currentStep === stepCount - 1;
  function goToStep(next: number) {
    if (next > currentStep && stepHasProblem) { setError("Corrija o lote marcado em vermelho antes de avançar."); return; }
    setError(null); setConfirming(false); setStep(Math.max(0, Math.min(next, stepCount - 1)));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }
  function filter(nextSearch: string, nextOnlyChanged: boolean) { setSearch(nextSearch); setOnlyChanged(nextOnlyChanged); setStep(0); setConfirming(false); }

  async function leave() {
    if (session && !simulation) await saveLocalDrafts(session.id, drafts);
    setSession(null); setConfirming(false);
    void refreshContext();
  }
  async function save(complete: boolean) {
    if (!session || busy) return;
    if (problems.size) { setError(`Corrija ${problems.size === 1 ? "o lote marcado" : `os ${problems.size} lotes marcados`} em vermelho.`); filter("", true); return; }
    setBusy(true); setError(null);
    try {
      if (simulation || !user) {
        if (complete) setDone({ adjustedLots: changedCount, unitName: session.kioskName });
        setSession(null);
        return;
      }
      await saveLocalDrafts(session.id, drafts);
      const result = await saveCount(user, session, drafts, complete);
      if (complete) { await clearLocalDrafts(session.id); setDone({ adjustedLots: result.adjustedLots, unitName: session.kioskName }); }
      else setNotice("Contagem salva. Você pode continuar depois, neste ou em outro aparelho.");
      setSession(null); setConfirming(false);
      void refreshContext();
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Não foi possível salvar a contagem."} O que você digitou continua guardado neste aparelho.`);
      setConfirming(false);
    } finally { setBusy(false); }
  }

  // Voltar do Android: fecha a confirmação, volta uma etapa e, na primeira, sai da contagem guardando o rascunho.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy) return true;
      if (confirming) { setConfirming(false); return true; }
      if (session && currentStep > 0) { goToStep(currentStep - 1); return true; }
      if (session) { void leave(); return true; }
      onBack(); return true;
    });
    return () => subscription.remove();
  }, [busy, confirming, currentStep, session, drafts]);

  if (session) {
    return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
      <ScreenHeader kicker={simulation ? "CONTAGEM DE ESTOQUE · SIMULAÇÃO" : "CONTAGEM DE ESTOQUE"} title={session.kioskName} onBack={() => void leave()} backLabel="Voltar para as unidades" backDisabled={busy} right={<HeaderAction label="Salvar e sair" onPress={() => void save(false)} disabled={busy} />}>
        <View style={styles.stepBlock}>
          <View style={styles.progress}><Text style={styles.progressText}>Etapa {currentStep + 1} de {stepCount}</Text><Text style={styles.progressMeta}>{changedCount} {changedCount === 1 ? "lote com lançamento" : "lotes com lançamento"}</Text></View>
          <FillBar key={`${currentStep}-${stepCount}`} percent={Math.round(((currentStep + 1) / stepCount) * 100)} color={ui.pink} track={ui.line} height={5} />
        </View>
      </ScreenHeader>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><FadeIn key={currentStep} style={styles.stack}>
        {currentStep === 0 ? <Text style={styles.hint}>Confira cada insumo. Se a quantidade bater com a do sistema, só avance; se não, lance a saída do turno (com o motivo) ou a sobra encontrada.</Text> : null}
        <TextInput value={search} onChangeText={(value) => filter(value, onlyChanged)} placeholder="Buscar insumo ou lote" placeholderTextColor={ui.inkFaint} style={[styles.input, styles.searchInput]} />
        <View style={styles.chips}>
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: !onlyChanged }} onPress={() => filter(search, false)} style={[styles.chip, !onlyChanged && styles.chipOn]}><Text style={[styles.chipText, !onlyChanged && styles.chipTextOn]}>Todos</Text></Pressable>
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: onlyChanged }} onPress={() => filter(search, true)} style={[styles.chip, onlyChanged && styles.chipOn]}><Text style={[styles.chipText, onlyChanged && styles.chipTextOn]}>Só com lançamento · {changedCount}</Text></Pressable>
        </View>
        {!products.length ? <Text style={styles.empty}>{onlyChanged ? "Nenhum lote com lançamento ainda." : "Nenhum insumo encontrado com essa busca."}</Text> : null}
        {stepProducts.map((product) => <View key={product.name} style={styles.product}>
          <ProductHeader name={product.name} imageUrl={product.lots.find((lot) => lot.imageUrl)?.imageUrl ?? null} instruction={product.lots.find((lot) => lot.countingInstruction)?.countingInstruction ?? null} />
          {product.lots.map((lot) => <LotRow key={lot.lotId} item={lot} draft={drafts[lot.lotId]} reasons={context?.exitReasons ?? []} problem={problems.get(lot.lotId) ?? null} onChange={(draft) => change(lot.lotId, draft)} />)}
        </View>)}
      </FadeIn></ScrollView>
      <View style={styles.footer}><View style={styles.footerInner}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {confirming ? <View style={styles.confirm}>
          <Text style={styles.confirmText}>Concluir a contagem de {session.kioskName}? {changedCount === 0 ? "Nenhum lote será ajustado." : `${changedCount} ${changedCount === 1 ? "lote terá" : "lotes terão"} o estoque ajustado.`} Depois de concluída, não é possível alterar pelo aplicativo.</Text>
          <View style={styles.row}><View style={styles.fill}><AppButton compact secondary label="Voltar" onPress={() => setConfirming(false)} disabled={busy} /></View><View style={styles.fill}><AppButton compact label="Concluir" onPress={() => void save(true)} disabled={busy} /></View></View>
        </View> : <View style={styles.row}>
          <View style={styles.fill}><AppButton compact secondary label="Anterior" onPress={() => goToStep(currentStep - 1)} disabled={busy || currentStep === 0} /></View>
          <View style={styles.fill}>{lastStep
            ? <AppButton compact label="Concluir contagem" onPress={() => { if (stepHasProblem) { setError("Corrija o lote marcado em vermelho antes de concluir."); return; } setError(null); setConfirming(true); }} disabled={busy || search.trim().length > 0 || onlyChanged} />
            : <AppButton compact label="Próximo" onPress={() => goToStep(currentStep + 1)} disabled={busy} />}</View>
        </View>}
        {lastStep && !confirming && (search.trim() || onlyChanged) ? <Text style={styles.footnote}>Limpe a busca e volte para "Todos" para concluir a contagem.</Text> : null}
      </View></View>
      <BusyOverlay text={busy ? (confirming ? "Concluindo…" : "Salvando…") : null} />
    </KeyboardAvoidingView>;
  }

  const openByUnit = new Map(context?.openSessions.map((open) => [open.kioskId, open]) ?? []);
  return <View style={styles.fill}>
    <ScreenHeader kicker={simulation ? "COALA ONE · SIMULAÇÃO" : "COALA ONE"} title="Contagem de estoque" onBack={onBack} backLabel="Voltar para o início" backDisabled={busy} />
    <FlatList
    data={context?.units ?? []}
    keyExtractor={(unit) => unit.id}
    contentContainerStyle={styles.content}
    ItemSeparatorComponent={() => <View style={styles.gap} />}
    ListHeaderComponent={<View style={styles.headerBlock}>
      {done ? <View style={styles.success}><Text style={styles.successTitle}>{simulation ? "Simulação concluída" : "Contagem concluída"}</Text><Text style={styles.successText}>{simulation ? "Nada foi enviado ao Coala One." : `${done.unitName}: ${done.adjustedLots === 0 ? "nenhum lote precisou de ajuste." : `${done.adjustedLots} ${done.adjustedLots === 1 ? "lote ajustado" : "lotes ajustados"} no estoque.`}`}</Text></View> : null}
      {notice ? <View style={styles.success}><Text style={styles.successText}>{notice}</Text></View> : null}
      {error ? <Text style={styles.errorBox}>{error}</Text> : null}
      {!context && !error ? <View style={styles.loading}><ActivityIndicator color={ui.accent} /><Text style={styles.hint}>Carregando unidades…</Text></View> : null}
      {context ? <Text style={styles.hint}>Escolha a unidade. A contagem parte da quantidade que o sistema tem agora em cada lote.</Text> : null}
      {context && !context.units.length ? <Text style={styles.empty}>Sua conta não tem unidade liberada para contagem.</Text> : null}
    </View>}
    renderItem={({ item: unit }) => {
      const pending = openByUnit.get(unit.id);
      return <Pressable accessibilityRole="button" disabled={busy} onPress={() => void open(unit.id)} style={[styles.unit, busy && styles.disabled]}>
        <View style={styles.fill}><Text style={styles.unitName}>{unit.name}</Text><Text style={styles.lotMeta}>{pending ? `Contagem em andamento · iniciada em ${isoToBrDate(pending.startedAt)} · ${pending.itemCount} lotes` : "Nenhuma contagem em andamento"}</Text></View>
        <Text style={[styles.unitAction, pending && styles.unitActionOn]}>{pending ? "Continuar" : "Iniciar"}</Text>
      </Pressable>;
    }}
  />
    <BusyOverlay text={busy ? "Aguarde…" : null} />
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: ui.page }, content: { ...contentColumn, paddingHorizontal: 16, paddingVertical: 14 }, stack: { gap: 10 }, gap: { height: 10 }, headerBlock: { gap: 10, marginBottom: 10 },
  stepBlock: { gap: 8 }, progress: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }, progressText: { color: ui.onDark, fontSize: 14, fontWeight: "800" }, progressMeta: { color: ui.onDarkSub, fontSize: 12 },
  hint: { color: ui.inkMuted, fontSize: 12.5, lineHeight: 18 }, loading: { alignItems: "center", gap: 8, paddingVertical: 24 },
  input: { height: 44, borderWidth: 1, borderColor: ui.borderInput, backgroundColor: ui.soft, borderRadius: 12, paddingHorizontal: 12, color: ui.ink, fontSize: 15 }, searchInput: { backgroundColor: ui.surface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, chip: { borderWidth: 1, borderColor: ui.borderInput, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: ui.surface }, chipOn: { borderColor: ui.dark, backgroundColor: ui.dark }, chipText: { color: ui.inkMuted, fontSize: 12.5, fontWeight: "700" }, chipTextOn: { color: "#FFFFFF" },
  reason: { borderWidth: 1, borderColor: ui.borderInput, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: ui.surface }, reasonOn: { borderColor: ui.accent, backgroundColor: ui.accentSoft }, reasonTextOn: { color: ui.accentInk },
  productHeader: { gap: 10 }, productThumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: ui.muted }, productThumbEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: ui.border },
  productThumbText: { color: ui.inkFaint, fontSize: 10, fontWeight: "700" }, productPhoto: { width: "100%", height: 200, borderRadius: 12, backgroundColor: ui.muted }, instruction: { color: ui.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  product: { backgroundColor: ui.surface, borderRadius: 18, borderWidth: 1, borderColor: ui.border, padding: 14, gap: 10 },
  lot: { backgroundColor: ui.soft, borderRadius: 14, borderWidth: 1, borderColor: ui.border, padding: 12, gap: 9 }, lotChanged: { borderWidth: 2, borderColor: ui.accent, backgroundColor: "#FFF8FA", padding: 11 }, lotProblem: { borderWidth: 2, borderColor: ui.danger, backgroundColor: "#FFF5F6", padding: 11 },
  lotName: { color: ui.ink, fontSize: 15, fontWeight: "800", lineHeight: 19 }, lotMeta: { color: ui.inkMuted, fontSize: 11.5, fontFamily: "monospace" }, lotNumbers: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 6 }, lotSystem: { color: ui.ink, fontSize: 13 }, lotSystemValue: { fontWeight: "800" }, lotFinal: { color: ui.inkFaint, fontSize: 13, fontWeight: "600" }, lotFinalChanged: { color: ui.accentInk, fontWeight: "800" }, lotFinalProblem: { color: ui.danger },
  editor: { gap: 8 }, label: { color: "#4A4F57", fontSize: 12, fontWeight: "700", marginBottom: 4 }, link: { color: ui.accentInk, fontSize: 12.5, fontWeight: "700", paddingVertical: 4 }, row: { flexDirection: "row", gap: 8 },
  error: { color: ui.danger, fontSize: 12.5, lineHeight: 18, fontWeight: "600" }, errorBox: { color: ui.danger, backgroundColor: ui.dangerBg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 12.5, lineHeight: 18, fontWeight: "600" }, empty: { color: ui.inkMuted, backgroundColor: ui.muted, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 },
  footer: { borderTopWidth: 1, borderTopColor: ui.border, backgroundColor: ui.surface }, footerInner: { ...contentColumn, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 8 }, footnote: { color: ui.inkMuted, fontSize: 11.5, lineHeight: 16, textAlign: "center" },
  confirm: { gap: 10, borderRadius: 14, backgroundColor: colors.alertBg, borderWidth: 1, borderColor: colors.alertBorder, padding: 12 }, confirmText: { color: colors.alertInk, fontSize: 13, lineHeight: 19 },
  success: { borderRadius: 14, backgroundColor: ui.okBg, borderWidth: 1, borderColor: "#BFE3CC", paddingVertical: 14, paddingHorizontal: 16, gap: 3 }, successTitle: { color: "#0F5A2B", fontSize: 14, fontWeight: "800" }, successText: { color: "#14532D", fontSize: 13, lineHeight: 19 },
  unit: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: ui.surface, borderRadius: 16, borderWidth: 1, borderColor: ui.border, padding: 16 }, unitName: { color: ui.ink, fontSize: 15.5, fontWeight: "800" }, unitAction: { color: ui.ink, fontSize: 13.5, fontWeight: "800" }, unitActionOn: { color: ui.accentInk }, disabled: { opacity: 0.55 },
});
