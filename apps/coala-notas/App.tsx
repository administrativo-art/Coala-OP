import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "@firebase/auth";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Network from "expo-network";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, AppState, BackHandler, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { recordPasswordLogin } from "./src/biometric-unlock";
import { CountScreen } from "./src/CountScreen";
import { HomeScreen, type AppModule } from "./src/HomeScreen";
import { SignageScreen } from "./src/SignageScreen";
import { LockScreen, LoginScreen } from "./src/AuthScreens";
import { auth } from "./src/firebase";
import { GoalsScreen } from "./src/GoalsScreen";
import { enqueueReceipt, loadOfflineQueue, markQueuedReceiptFailed, removeQueuedReceipt, withOpenDocuments, type QueuedReceipt } from "./src/offline-queue";
import { loadAppProfile, type AppModules, type AppProfile } from "./src/profile";
import { ReceiveScreen } from "./src/ReceiveScreen";
import { ReviewScreen, type StockOutcome } from "./src/ReviewScreen";
import { ScheduleScreen } from "./src/ScheduleScreen";
import { createSimulationAnalysis, createSimulationWithdrawals, simulationContext } from "./src/simulation";
import { colors, contentColumn } from "./src/theme";
import { AppButton, BusyOverlay, FadeIn, Pill, ScreenHeader, ui } from "./src/ui";
import { formatCents, formatDay, linkPurchaseToWithdrawal, loadOpenWithdrawals, MAX_FILES_PER_DOCUMENT, uploadReceipt, type FundingSource, type AwaitingPurchase, type OpenWithdrawal, type ReceiptAnalysis, type SelectedReceipt } from "./src/upload";
import { WithdrawalList, withdrawalLabel } from "./src/WithdrawalList";

const MAX_BYTES = 15 * 1024 * 1024;
// O servidor guarda a consulta ao PDV por 1 min; atualizar mais rápido que isso não traz sangria nova.
const WITHDRAWALS_REFRESH_MS = 2 * 60 * 1000;
// Celular compartilhado: depois deste tempo fora do app, a senha do Coala One é exigida de novo.
// Fotografar ou escolher um arquivo também tira o app da frente, por isso o prazo não pode ser de segundos.
const LOCK_AFTER_BACKGROUND_MS = 5 * 60 * 1000;
type AppMode = "real" | "simulation";

function normalizeReceipt(input: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null }): SelectedReceipt {
  const mimeType = input.mimeType || (input.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  return { uri: input.uri, name: input.name || (mimeType === "application/pdf" ? "nota.pdf" : "nota.jpg"), mimeType, size: input.size ?? null, previewUri: mimeType.startsWith("image/") ? input.uri : null };
}

function DocumentSlot(props: { title: string; hint: string; documents: SelectedReceipt[]; onPhoto: () => void; onFile: () => void; onRemove: (index: number) => void }) {
  const count = props.documents.length;
  return <View style={[styles.slot, !count && styles.slotEmpty]}>
    <View style={styles.slotHead}><View style={styles.fill}><Text style={styles.slotTitle}>{props.title}</Text><Text style={styles.small}>{props.hint}</Text></View>{count ? <Pill tone="ok" label={`${count} DE ${MAX_FILES_PER_DOCUMENT}`} /> : null}</View>
    {props.documents.map((document, index) => <View key={document.uri} style={styles.fileRow}>
      {document.previewUri ? <Image resizeMode="cover" source={{ uri: document.previewUri }} style={styles.fileThumb} /> : <View style={[styles.fileThumb, styles.fileThumbPdf]}><Text style={styles.fileThumbText}>PDF</Text></View>}
      <Text numberOfLines={2} style={styles.fileName}>{document.name}</Text>
      <Pressable accessibilityRole="button" onPress={() => props.onRemove(index)} hitSlop={8}><Text style={styles.remove}>Remover</Text></Pressable>
    </View>)}
    {count < MAX_FILES_PER_DOCUMENT ? <View style={styles.pair}>
      <View style={styles.fill}><AppButton compact secondary={count > 0} label={count ? "+ Outra imagem" : "Fotografar"} onPress={props.onPhoto} /></View>
      <View style={styles.fill}><AppButton compact secondary label={count ? "+ Outro arquivo" : "Arquivo"} onPress={props.onFile} /></View>
    </View> : null}
    {count === 1 ? <Text style={styles.small}>Não coube em uma foto? Adicione a segunda imagem do mesmo documento.</Text> : null}
  </View>;
}

function UploadScreen({ user, mode, onBack }: { user?: User; mode: AppMode; onBack?: () => void }) {
  const [fundingSource, setFundingSource] = useState<FundingSource | null>(null);
  const [receipts, setReceipts] = useState<SelectedReceipt[]>([]);
  const [paymentProofs, setPaymentProofs] = useState<SelectedReceipt[]>([]);
  const attachedBytes = [...receipts, ...paymentProofs].reduce((sum, document) => sum + (document.size ?? 0), 0);
  const attachmentsReady = receipts.length > 0 && (fundingSource !== "company_payment" || paymentProofs.length > 0);
  const [submissionId, setSubmissionId] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedReceipt[]>([]);
  const [review, setReview] = useState<{ analysis: ReceiptAnalysis; submissionId: string; note: string; fundingSource: FundingSource; withdrawal: OpenWithdrawal | null } | null>(null);
  const [success, setSuccess] = useState<{ status: string; simulated: boolean; withdrawal: OpenWithdrawal | null; changeCents: number; stock: StockOutcome } | null>(null);
  const [withdrawal, setWithdrawal] = useState<OpenWithdrawal | null>(null);
  const [linking, setLinking] = useState(false);
  const [withdrawals, setWithdrawals] = useState<OpenWithdrawal[] | null>(null);
  const [awaitingPurchases, setAwaitingPurchases] = useState<AwaitingPurchase[]>([]);
  const [withdrawalsMeta, setWithdrawalsMeta] = useState<{ loading: boolean; error: string | null; partial: boolean; since: string | null }>({ loading: false, error: null, partial: false, since: null });
  const automaticAttempts = useRef(new Set<string>());
  const wasOnline = useRef<boolean | null>(null);

  async function refreshQueue() { if (mode === "real" && user) setQueue(await loadOfflineQueue(user.uid)); }
  useEffect(() => {
    if (mode !== "real") return;
    void refreshQueue();
    void Network.getNetworkStateAsync().then((state) => setOnline(state.isInternetReachable ?? state.isConnected ?? null)).catch(() => setOnline(null));
    const subscription = Network.addNetworkStateListener((state) => {
      const next = state.isInternetReachable ?? state.isConnected ?? null;
      if (next === true && wasOnline.current === false) automaticAttempts.current.clear();
      wasOnline.current = next; setOnline(next);
    });
    return () => subscription.remove();
  }, [mode, user?.uid]);

  async function refreshWithdrawals() {
    if (mode === "simulation") { setWithdrawals((current) => current ?? createSimulationWithdrawals()); return; }
    if (!user || typeof user.getIdToken !== "function" || online === false) return;
    setWithdrawalsMeta((current) => ({ ...current, loading: true }));
    try {
      const result = await loadOpenWithdrawals(user);
      setWithdrawals(result.withdrawals); setAwaitingPurchases(result.awaitingPurchases ?? []); setWithdrawalsMeta({ loading: false, error: null, partial: result.partial, since: result.window.from });
    } catch (cause) {
      setWithdrawalsMeta((current) => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : "Não foi possível consultar as sangrias." }));
    }
  }
  // A lista só é atualizada com a tela inicial visível: ao abrir, ao voltar ao app, após cada registro e a cada 2 min.
  const onHome = !fundingSource && !review && !busy;
  useEffect(() => {
    if (!onHome) return;
    void refreshWithdrawals();
    const timer = setInterval(() => { if (AppState.currentState === "active") void refreshWithdrawals(); }, WITHDRAWALS_REFRESH_MS);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void refreshWithdrawals(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [onHome, mode, user?.uid, online]);

  const sizeLabel = useMemo(() => {
    if (!attachedBytes) return null;
    return attachedBytes >= 1024 * 1024 ? `${(attachedBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(attachedBytes / 1024)} KB`;
  }, [attachedBytes]);
  function clearSelection() { setFundingSource(null); setWithdrawal(null); setReceipts([]); setPaymentProofs([]); setSubmissionId(""); setCapturedAt(""); setNote(""); setProgress(0); }
  function selectFundingSource(next: FundingSource, chosen: OpenWithdrawal | null = null) {
    setFundingSource(next); setWithdrawal(chosen); setReceipts([]); setPaymentProofs([]); setSubmissionId(Crypto.randomUUID()); setCapturedAt(new Date().toISOString()); setError(null); setNotice(null); setSuccess(null);
  }
  function select(next: SelectedReceipt, target: "receipt" | "paymentProof") {
    if (next.size && next.size > MAX_BYTES) { setError("Cada documento deve ter no máximo 15 MB."); return; }
    const current = target === "receipt" ? receipts : paymentProofs;
    if (current.length >= MAX_FILES_PER_DOCUMENT) { setError(`Cada documento aceita no máximo ${MAX_FILES_PER_DOCUMENT} imagens.`); return; }
    if ([...receipts, ...paymentProofs].some((document) => document.uri === next.uri)) { setError("Este arquivo já foi anexado."); return; }
    if (target === "receipt") setReceipts([...current, next]); else setPaymentProofs([...current, next]);
    setSuccess(null); setNotice(null); setError(null); setProgress(0);
  }
  async function takePhoto(target: "receipt" | "paymentProof") {
    setError(null); const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setError("Autorize o uso da câmera para fotografar os documentos."); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.85 }); const asset = result.assets?.[0];
    if (!result.canceled && asset) select(normalizeReceipt({ uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType, size: asset.fileSize }), target);
  }
  async function chooseFile(target: "receipt" | "paymentProof") {
    setError(null); const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp", "application/pdf"], copyToCacheDirectory: true }); const asset = result.assets?.[0];
    if (!result.canceled && asset) select(normalizeReceipt({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size }), target);
  }
  async function saveCurrentToQueue() {
    if (!fundingSource || !receipts.length || !submissionId || !capturedAt) throw new Error("Informe o tipo da compra e anexe a nota.");
    if (fundingSource === "company_payment" && !paymentProofs.length) throw new Error("A compra normal exige o comprovante de pagamento.");
    if (attachedBytes > 25 * 1024 * 1024) throw new Error("Nota e comprovante devem somar no máximo 25 MB.");
    if (!user) throw new Error("Entre no Coala One antes de guardar uma nota real.");
    const queued = await enqueueReceipt({ ownerUid: user.uid, fundingSource, receipts, paymentProofs, withdrawal, submissionId, capturedAt, note }); await refreshQueue(); return queued;
  }
  async function uploadQueued(queued: QueuedReceipt) {
    if (!user) throw new Error("Entre no Coala One para sincronizar as notas pendentes.");
    setBusy(true); setError(null); setNotice(null); setProgress(0.02);
    try {
      const result = await withOpenDocuments(queued, (documents) => uploadReceipt({ user, fundingSource: queued.fundingSource, ...documents, submissionId: queued.submissionId, capturedAt: queued.capturedAt, note: queued.note, onProgress: setProgress }));
      await removeQueuedReceipt(user.uid, queued.submissionId); await refreshQueue();
      setReview({ submissionId: queued.submissionId, note: queued.note, fundingSource: queued.fundingSource, withdrawal: queued.withdrawal ?? null, analysis: result.submission.analysis ?? { supplierName: null, supplierTaxId: null, purchaseDate: null, amountCents: null, items: [], confidence: "low", suggestedAccountId: null, payment: null, warnings: [] } }); clearSelection();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível sincronizar a nota."; automaticAttempts.current.add(queued.submissionId);
      await markQueuedReceiptFailed(user.uid, queued.submissionId, message); await refreshQueue(); clearSelection(); setError(message); setNotice("A nota continua salva no aparelho e pode ser reenviada sem duplicidade.");
    } finally { setBusy(false); }
  }
  useEffect(() => {
    const next = queue[0];
    if (mode !== "real" || online !== true || !user || !next || busy || receipts.length || paymentProofs.length || review || fundingSource || automaticAttempts.current.has(next.submissionId)) return;
    automaticAttempts.current.add(next.submissionId); void uploadQueued(next);
  }, [mode, online, user, queue, busy, receipts, paymentProofs, review, fundingSource]);

  async function send() {
    if (!fundingSource || !receipts.length || !submissionId || !capturedAt) { setError("Informe o tipo da compra e anexe a nota."); return; }
    if (fundingSource === "company_payment" && !paymentProofs.length) { setError("Anexe também o comprovante de pagamento."); return; }
    if (mode === "simulation") { const analysis = createSimulationAnalysis(); setReview({ submissionId, note, fundingSource, withdrawal, analysis: fundingSource === "company_payment" ? { ...analysis, payment: { method: "pix", amountCents: analysis.amountCents, paidAt: analysis.purchaseDate, payeeName: analysis.supplierName, transactionId: "SIMULACAO", confidence: "medium", amountMatchesReceipt: true, payeeMatchesSupplier: true } } : analysis }); return; }
    try {
      const queued = await saveCurrentToQueue();
      if (online === false) { clearSelection(); setNotice("Sem internet. A nota foi guardada com segurança e será sincronizada quando a conexão voltar."); return; }
      await uploadQueued(queued);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível guardar a nota no aparelho."); }
  }
  async function keepForLater() {
    setError(null);
    try { await saveCurrentToQueue(); clearSelection(); setNotice("Nota guardada no aparelho. Ela será sincronizada automaticamente quando houver internet."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível guardar a nota."); }
  }
  // Voltar do Android desfaz um passo por vez; nunca interrompe um envio nem descarta a revisão.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy || review) return true;
      if (fundingSource) { clearSelection(); return true; }
      if (!onBack) return false;
      onBack(); return true;
    });
    return () => subscription.remove();
  }, [busy, review, fundingSource, onBack]);
  // Compras já enviadas que cabem na sangria escolhida: mesma unidade e total até o valor retirado.
  const linkable = withdrawal ? awaitingPurchases.filter((purchase) => purchase.unitId === withdrawal.unitId && purchase.totalCents <= withdrawal.amountCents) : [];
  async function linkExisting(purchase: AwaitingPurchase) {
    if (!user || !withdrawal || busy) return;
    setBusy(true); setLinking(true); setError(null);
    try {
      const result = await linkPurchaseToWithdrawal(user, { purchaseId: purchase.id, withdrawal: { sourceId: withdrawal.sourceId, date: withdrawal.date } });
      const linked = withdrawal;
      setWithdrawals((current) => current?.filter((row) => row.sourceId !== linked.sourceId) ?? null);
      setAwaitingPurchases((current) => current.filter((row) => row.id !== purchase.id));
      clearSelection();
      setSuccess({ status: result.purchase.status, simulated: false, withdrawal: linked, changeCents: Math.max(0, result.purchase.changeCents), stock: { count: 0, status: "not_needed" } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível conciliar a compra com a sangria."); }
    finally { setBusy(false); setLinking(false); }
  }
  function reset() { clearSelection(); setError(null); setNotice(null); setSuccess(null); setReview(null); }

  if (review) return <ReviewScreen user={mode === "real" ? user : undefined} submissionId={review.submissionId} note={review.note} analysis={review.analysis} fundingSource={review.fundingSource} withdrawal={review.withdrawal} previewOnly={mode === "simulation"} previewContext={mode === "simulation" ? simulationContext : undefined} simulation={mode === "simulation"} onCancel={() => setReview(null)} onDone={(status, changeCents, stock) => { const linked = review.withdrawal; setReview(null); if (linked) setWithdrawals((current) => current?.filter((row) => row.sourceId !== linked.sourceId) ?? null); setSuccess({ status, simulated: mode === "simulation", withdrawal: linked, changeCents, stock }); }} />;

  const step = fundingSource ? 2 : 1;
  const busyText = busy ? (linking ? "Conciliando…" : progress >= 1 ? "Analisando a nota…" : progress > 0.02 ? `Enviando ${Math.round(progress * 100)}%` : "Enviando…") : null;
  const typeLabel = withdrawal ? `Sangria · ${formatCents(withdrawal.amountCents)}` : fundingSource === "cash_withdrawal" ? "Sangria fora da lista" : "Compra normal";
  return <View style={styles.screen}>
    <ScreenHeader title="Compra local" onBack={fundingSource && !success ? clearSelection : onBack} backLabel={fundingSource ? "Voltar para o tipo da compra" : "Voltar para o início"} backDisabled={busy}
      right={mode === "simulation" ? <Text style={styles.online}>Simulação</Text> : <View style={styles.onlineRow}><View style={[styles.dot, online === false ? styles.dotOff : styles.dotOn]} /><Text style={styles.online}>{online === false ? "Offline" : online === true ? "Online" : "…"}</Text></View>}>
      {!success ? <View style={styles.steps}>{["Tipo", "Anexos", "Finalizar"].map((label, index) => <View key={label} style={styles.fill}>
        <View style={[styles.stepBar, index < step && styles.stepBarOn]} /><Text style={[styles.stepText, index === step - 1 && styles.stepTextOn]}>{index + 1} {label}</Text>
      </View>)}</View> : null}
    </ScreenHeader>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} refreshControl={onHome ? <RefreshControl refreshing={false} onRefresh={() => void refreshWithdrawals()} /> : undefined}><FadeIn key={success ? "done" : fundingSource ? "anexos" : "tipo"} style={styles.stack}>
      {mode === "simulation" && !success ? <View style={styles.banner}><Text style={styles.bannerText}>Simulação: use qualquer foto. A leitura é demonstrativa e nada é enviado ao Coala One.</Text></View> : null}
      {mode === "real" && queue.length && !success ? <View style={styles.cardRow}>
        <View style={styles.fill}><Text style={styles.cardTitle}>{queue.length} {queue.length === 1 ? "nota guardada" : "notas guardadas"} no aparelho</Text><Text style={styles.small}>{online === false ? "A sincronização começa quando a internet voltar." : "Sincronize a próxima para revisar antes do registro."}</Text>{queue[0]?.lastError ? <Text numberOfLines={3} style={styles.errorText}>{queue[0].lastError}</Text> : null}</View>
        <Pressable accessibilityRole="button" disabled={busy || online === false} onPress={() => void uploadQueued(queue[0]!)} hitSlop={8}><Text style={[styles.action, (busy || online === false) && styles.actionOff]}>Sincronizar</Text></Pressable>
      </View> : null}
      {success ? <>
        <View style={styles.doneCard}>
          <View style={styles.doneMark}><Text style={styles.doneMarkText}>✓</Text></View>
          <Text style={styles.doneTitle}>{success.simulated ? "Simulação concluída" : "Compra registrada"}</Text>
          <Text style={styles.doneText}>{success.simulated ? "Você percorreu o fluxo completo. Nenhum dado foi enviado ou salvo no Coala One." : success.withdrawal ? (success.status === "reconciled" ? "A despesa já foi paga por esta sangria, sem segundo pagamento." : "A conciliação com a sangria é concluída sozinha quando o caixa do dia for sincronizado.") : success.status === "awaiting_cash_withdrawal" ? "Concilie com a sangria quando ela aparecer na lista." : "A nota e o comprovante seguem para o Financeiro."}</Text>
          {!success.simulated ? <View style={styles.doneRows}>
            {success.withdrawal ? <View style={styles.doneRow}><Text style={styles.doneKey}>Sangria</Text><Text style={styles.doneValue}>{formatCents(success.withdrawal.amountCents)}</Text></View> : null}
            {success.changeCents > 0 ? <View style={[styles.doneRow, styles.doneRowLine]}><Text style={styles.doneKey}>Troco a devolver</Text><Text style={[styles.doneValue, styles.warnText]}>{formatCents(success.changeCents)}</Text></View> : null}
            {success.stock.count ? <View style={[styles.doneRow, styles.doneRowLine]}><Text style={styles.doneKey}>Estoque</Text><Text style={[styles.doneValue, success.stock.status === "pending" && styles.warnText]}>{success.stock.status === "done" ? `${success.stock.count} ${success.stock.count === 1 ? "item entrou" : "itens entraram"}` : "entrada não concluída"}</Text></View> : null}
            <View style={[styles.doneRow, (success.withdrawal || success.changeCents > 0 || success.stock.count > 0) && styles.doneRowLine]}><Text style={styles.doneKey}>Situação</Text><Pill tone={success.status === "reconciled" ? "ok" : "warn"} label={success.status === "reconciled" ? "Conciliada" : success.withdrawal ? "Vinculada à sangria" : success.status === "awaiting_cash_withdrawal" ? "Aguardando sangria" : "Enviada ao Financeiro"} /></View>
          </View> : null}
          {!success.simulated && success.changeCents > 0 ? <Text style={styles.warnNote}>Devolva o troco ao caixa por suprimento no PDV (fundo de caixa), hoje e nesse valor exato: sem ele a sangria não concilia.</Text> : null}
          {!success.simulated && success.stock.status === "pending" ? <Text style={styles.warnNote}>A entrada no estoque não foi concluída. Avise o responsável pelo estoque.</Text> : null}
        </View>
        <AppButton label={success.simulated ? "Simular outra nota" : "Enviar outra nota"} onPress={reset} />
        {onBack ? <AppButton secondary label="Voltar ao início" onPress={onBack} /> : null}
      </> : !fundingSource ? <>
        <WithdrawalList withdrawals={withdrawals} loading={withdrawalsMeta.loading} error={withdrawalsMeta.error} partial={withdrawalsMeta.partial} since={mode === "simulation" ? null : withdrawalsMeta.since} offline={mode === "real" && online === false} onSelect={(chosen) => selectFundingSource("cash_withdrawal", chosen)} onRefresh={() => void refreshWithdrawals()} />
        <Text style={styles.sectionTitle}>Outra compra</Text>
        <Text style={styles.small}>Se a sangria ainda não apareceu na lista, ou a compra não foi paga com o caixa, informe como ela foi paga.</Text>
        <View style={styles.pair}>
          <Pressable accessibilityRole="button" onPress={() => selectFundingSource("cash_withdrawal")} style={({ pressed }) => [styles.typeCard, pressed && styles.pressed]}><Text style={styles.kicker}>SANGRIA</Text><Text style={styles.typeTitle}>Dinheiro do caixa</Text><Text style={styles.typeHint}>Sangria fora da lista. Só a nota da compra.</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => selectFundingSource("company_payment")} style={({ pressed }) => [styles.typeCard, pressed && styles.pressed]}><Text style={styles.kicker}>COMPRA NORMAL</Text><Text style={styles.typeTitle}>Recurso da empresa</Text><Text style={styles.typeHint}>Nota e comprovante de pagamento.</Text></Pressable>
        </View>
        {notice ? <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View> : null}
        {error ? <Text style={styles.errorBox}>{error}</Text> : null}
      </> : <>
        <View style={styles.tipo}><View style={styles.fill}><Text style={styles.tipoKicker}>TIPO DA COMPRA</Text><Text style={styles.cardTitle}>{typeLabel}</Text>{withdrawal ? <Text style={styles.small}>{withdrawalLabel(withdrawal)}</Text> : null}</View><Pressable accessibilityRole="button" disabled={busy} onPress={clearSelection} hitSlop={8}><Text style={styles.action}>Alterar</Text></Pressable></View>
        <Text style={styles.small}>{fundingSource === "company_payment" ? "Anexe a nota e o comprovante. Os dois são analisados juntos e cruzados antes da revisão." : withdrawal ? "Anexe a nota da compra. A sangria já comprova o pagamento; se sobrar troco, o valor aparece na revisão." : "Anexe a nota da compra. Ela é conciliada com a sangria quando esta aparecer na lista."}</Text>
        <DocumentSlot title="Nota da compra" hint="Cupom, nota fiscal ou recibo" documents={receipts} onPhoto={() => void takePhoto("receipt")} onFile={() => void chooseFile("receipt")} onRemove={(index) => setReceipts(receipts.filter((_, position) => position !== index))} />
        {withdrawal && linkable.length && !receipts.length ? <View style={styles.slot}>
          <Text style={styles.slotTitle}>Já enviou a nota desta compra?</Text>
          <Text style={styles.small}>Concilie a sangria com uma compra registrada antes de ela aparecer aqui.</Text>
          {linkable.map((purchase) => <Pressable key={purchase.id} accessibilityRole="button" disabled={busy} onPress={() => void linkExisting(purchase)} style={styles.fileRow}>
            <View style={styles.fill}><Text numberOfLines={1} style={styles.fileName}>{purchase.supplierName}</Text><Text style={styles.small}>{formatCents(purchase.totalCents)} · {formatDay(purchase.purchaseDate)}{purchase.totalCents < withdrawal.amountCents ? ` · troco ${formatCents(withdrawal.amountCents - purchase.totalCents)}` : ""}</Text></View>
            <Text style={styles.action}>Conciliar ›</Text>
          </Pressable>)}
        </View> : null}
        {fundingSource === "company_payment" ? <DocumentSlot title="Comprovante de pagamento" hint="Pix, cartão, boleto ou outro comprovante" documents={paymentProofs} onPhoto={() => void takePhoto("paymentProof")} onFile={() => void chooseFile("paymentProof")} onRemove={(index) => setPaymentProofs(paymentProofs.filter((_, position) => position !== index))} /> : null}
        {receipts.length ? <View style={styles.slot}>
          <Text style={styles.slotTitle}>Observação <Text style={styles.small}>(opcional)</Text></Text>
          <TextInput editable={!busy} maxLength={240} multiline onChangeText={setNote} placeholder="Ex.: compra de insumos da unidade Centro" placeholderTextColor={ui.inkFaint} style={styles.noteInput} value={note} />
          <Text style={styles.counter}>{sizeLabel ? `${receipts.length + paymentProofs.length} ${receipts.length + paymentProofs.length === 1 ? "anexo" : "anexos"} · ${sizeLabel} · ` : ""}{note.length}/240</Text>
        </View> : null}
        {notice ? <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View> : null}
      </>}
    </FadeIn></ScrollView>
    {fundingSource && !success ? <View style={styles.footer}><View style={styles.footerInner}>
      {error ? <Text style={styles.errorBox}>{error}</Text> : null}
      <AppButton label={mode === "simulation" ? "Simular análise" : online === false ? "Guardar para sincronizar" : "Analisar e continuar"} onPress={() => void send()} disabled={busy || !attachmentsReady} />
      {mode === "real" && online !== false && attachmentsReady ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void keepForLater()} style={styles.textButton}><Text style={styles.action}>Guardar e enviar depois</Text></Pressable> : null}
      {!attachmentsReady ? <Text style={styles.footHint}>{receipts.length ? "Anexe o comprovante para continuar." : "Anexe a nota para continuar."}</Text> : null}
    </View></View> : null}
    <BusyOverlay text={busyText} />
  </View>;
}

function AppContent() {
  // Atalho de desenvolvimento para abrir uma tela sem login; inexistente no APK de produção.
  const previewMode = __DEV__ ? process.env.EXPO_PUBLIC_UI_PREVIEW : undefined;
  const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true); const [simulation, setSimulation] = useState(false); const [module, setModule] = useState<AppModule | null>(null);
  const [locked, setLocked] = useState(false);
  const insets = useSafeAreaInsets();
  const [appProfile, setAppProfile] = useState<{ profile: AppProfile; modules: AppModules } | null>(null);
  // Foto, nome e módulos liberados vêm do cadastro no Coala One; sem resposta, o app segue com o que tem.
  useEffect(() => {
    setAppProfile(null);
    if (!user || typeof user.getIdToken !== "function") return;
    void loadAppProfile(user).then(setAppProfile).catch(() => undefined);
  }, [user?.uid]);
  const restored = useRef(false); const sessionUid = useRef<string | null>(null); const leftAt = useRef<number | null>(null);
  useEffect(() => { if (previewMode) { setLoading(false); return; } return onAuthStateChanged(auth, (next) => {
    // O primeiro aviso é a sessão restaurada do aparelho: ninguém digitou a senha agora, então abre bloqueado.
    if (!restored.current) { restored.current = true; setLocked(Boolean(next)); } else if (!next) setLocked(false);
    else if (next.uid !== sessionUid.current) void recordPasswordLogin(next.uid).catch(() => undefined);
    if ((next?.uid ?? null) !== sessionUid.current) setModule(null);
    sessionUid.current = next?.uid ?? null; setUser(next); setLoading(false);
  }); }, [previewMode]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") { leftAt.current ??= Date.now(); return; }
      if (leftAt.current !== null && Date.now() - leftAt.current > LOCK_AFTER_BACKGROUND_MS && auth.currentUser) setLocked(true);
      leftAt.current = null;
    });
    return () => subscription.remove();
  }, []);
  const content = previewMode === "review" ? <ReviewScreen submissionId="preview" note="Compra local de insumos" fundingSource="cash_withdrawal" previewOnly simulation previewContext={simulationContext} analysis={createSimulationAnalysis()} onCancel={() => undefined} onDone={() => undefined} />
    : previewMode === "capture" ? <UploadScreen user={{} as User} mode="real" />
    : loading ? <View style={styles.loading}><ActivityIndicator color={ui.pink} size="large" /><Text style={styles.loadingText}>Abrindo o Coala One…</Text></View>
    : !simulation && !user ? <LoginScreen onSimulate={() => setSimulation(true)} />
    : module === "signage" ? <SignageScreen user={user ?? undefined} simulation={simulation} onBack={() => setModule(null)} />
    : module === "schedule" ? <ScheduleScreen user={user ?? undefined} simulation={simulation} onBack={() => setModule(null)} />
    : module === "goals" ? <GoalsScreen user={user ?? undefined} simulation={simulation} onBack={() => setModule(null)} />
    : module === "reposition-receipt" ? <ReceiveScreen user={user ?? undefined} simulation={simulation} onBack={() => setModule(null)} />
    : module === "stock-count" ? <CountScreen user={user ?? undefined} simulation={simulation} onBack={() => setModule(null)} />
    : module === "local-purchase" ? <UploadScreen user={user ?? undefined} mode={simulation ? "simulation" : "real"} onBack={() => setModule(null)} />
    : <HomeScreen user={user ?? undefined} simulation={simulation} profile={appProfile?.profile ?? null} modules={appProfile?.modules ?? null}
      onPhotoChanged={(avatarUrl) => setAppProfile((current) => current ? { ...current, profile: { ...current.profile, avatarUrl } } : current)}
      onOpen={setModule} onExit={() => { setModule(null); if (simulation) setSimulation(false); else void signOut(auth); }} />;
  const showLock = locked && !!user && !simulation && !previewMode;
  // Login, bloqueio e carregamento são telas escuras de ponta a ponta; as demais têm o cabeçalho escuro sobre fundo claro.
  const darkScreen = loading || showLock || (!simulation && !user && !previewMode);
  return <View style={styles.root}>
    <StatusBar style="light" />
    <View style={[styles.inset, { height: insets.top }]} />
    <View style={styles.fill}>{content}{showLock ? <LockScreen user={user!} profile={appProfile?.profile ?? null} onUnlocked={() => setLocked(false)} /> : null}</View>
    <View style={{ height: insets.bottom, backgroundColor: darkScreen ? ui.dark : ui.page }} />
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, root: { flex: 1, backgroundColor: ui.page }, inset: { backgroundColor: ui.dark }, loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: ui.dark }, loadingText: { color: ui.onDarkSub, fontSize: 15 },
  screen: { flex: 1, backgroundColor: ui.page }, content: { ...contentColumn, paddingHorizontal: 20, paddingVertical: 18 }, stack: { gap: 10 },
  onlineRow: { flexDirection: "row", alignItems: "center", gap: 6 }, online: { color: ui.onDarkSub, fontSize: 11.5, fontWeight: "700" }, dot: { width: 7, height: 7, borderRadius: 4 }, dotOn: { backgroundColor: "#4ADE80" }, dotOff: { backgroundColor: "#FB923C" },
  steps: { flexDirection: "row", gap: 6 }, stepBar: { height: 4, borderRadius: 4, backgroundColor: ui.line, marginBottom: 6 }, stepBarOn: { backgroundColor: ui.pink }, stepText: { color: ui.onDarkFaint, fontSize: 11.5, fontWeight: "700" }, stepTextOn: { color: ui.onDark },
  banner: { padding: 12, borderRadius: 12, backgroundColor: colors.alertBg, borderWidth: 1, borderColor: colors.alertBorder }, bannerText: { color: colors.alertInk, fontSize: 12.5, lineHeight: 18, fontWeight: "600" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: ui.infoBg }, cardTitle: { color: ui.ink, fontSize: 15, fontWeight: "800" }, small: { color: ui.inkMuted, fontSize: 12.5, lineHeight: 18 },
  action: { color: ui.accentInk, fontSize: 13, fontWeight: "800" }, actionOff: { color: ui.disabled }, sectionTitle: { color: ui.ink, fontSize: 15, fontWeight: "800", marginTop: 8 }, kicker: { color: ui.accentInk, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  pair: { flexDirection: "row", gap: 10 }, typeCard: { flex: 1, gap: 4, padding: 14, borderRadius: 16, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border }, typeTitle: { color: ui.ink, fontSize: 14.5, fontWeight: "800" }, typeHint: { color: ui.inkMuted, fontSize: 11.5, lineHeight: 16 }, pressed: { opacity: 0.86 },
  tipo: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: "#FFFDF9", borderWidth: 1, borderColor: ui.border }, tipoKicker: { color: ui.inkMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  slot: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border }, slotEmpty: { borderWidth: 1.5, borderStyle: "dashed", borderColor: ui.borderInput }, slotHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, slotTitle: { color: ui.ink, fontSize: 14, fontWeight: "800" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10 }, fileThumb: { width: 40, height: 50, borderRadius: 8, backgroundColor: "#F6F4EF" }, fileThumbPdf: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: ui.borderInput }, fileThumbText: { color: ui.accentInk, fontSize: 10, fontWeight: "900" },
  fileName: { flex: 1, color: ui.ink, fontSize: 13, fontWeight: "700" }, remove: { color: ui.danger, fontSize: 12.5, fontWeight: "700" },
  noteInput: { minHeight: 72, borderRadius: 12, borderWidth: 1, borderColor: ui.borderInput, backgroundColor: ui.soft, paddingHorizontal: 12, paddingTop: 11, fontSize: 15, color: ui.ink, textAlignVertical: "top" }, counter: { color: ui.inkFaint, fontSize: 11.5, textAlign: "right" },
  notice: { padding: 14, borderRadius: 14, backgroundColor: ui.okBg, borderWidth: 1, borderColor: "#BFE3CC" }, noticeText: { color: "#14532D", fontSize: 13, lineHeight: 19 },
  errorText: { color: ui.danger, fontSize: 12, lineHeight: 17, marginTop: 4 }, errorBox: { color: ui.danger, backgroundColor: ui.dangerBg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 12.5, lineHeight: 18, fontWeight: "600" },
  footer: { borderTopWidth: 1, borderTopColor: ui.border, backgroundColor: ui.page }, footerInner: { ...contentColumn, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, gap: 8 }, footHint: { color: ui.inkMuted, fontSize: 12, textAlign: "center" }, textButton: { alignSelf: "center", paddingVertical: 4 },
  doneCard: { alignItems: "center", gap: 10, paddingVertical: 28, paddingHorizontal: 22, borderRadius: 24, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border }, doneMark: { width: 64, height: 64, borderRadius: 22, backgroundColor: ui.okBg, alignItems: "center", justifyContent: "center" }, doneMarkText: { color: ui.ok, fontSize: 30, fontWeight: "900" },
  doneTitle: { color: ui.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, textAlign: "center" }, doneText: { color: ui.inkMuted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  doneRows: { alignSelf: "stretch", marginTop: 6, borderRadius: 14, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.border }, doneRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14 }, doneRowLine: { borderTopWidth: 1, borderTopColor: "#F1EEE8" },
  doneKey: { color: ui.inkMuted, fontSize: 13 }, doneValue: { color: ui.ink, fontSize: 13, fontWeight: "800" }, warnText: { color: ui.warn }, warnNote: { alignSelf: "stretch", color: ui.warn, backgroundColor: ui.warnBg, borderRadius: 12, padding: 12, fontSize: 12.5, lineHeight: 18, fontWeight: "700" },
});

/** O provedor mede as áreas do sistema (entalhe, barra de gestos) para o SafeAreaView de cada tela. */
export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>;
}
