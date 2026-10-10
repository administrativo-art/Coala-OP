import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@firebase/auth";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { confirmLocalPurchase, formatCents, loadLocalPurchaseContext, type CompanyPaymentMethod, type FundingSource, type LocalPurchaseContext, type OpenWithdrawal, type ReceiptAnalysis } from "./upload";
import { withdrawalLabel } from "./WithdrawalList";
import { emptyItemStock, expiryToIso, isoToBrDate, ItemStockEditor, maskDate, type ItemStock } from "./ItemStock";
import { colors, contentColumn } from "./theme";
import { AppButton, BusyOverlay, FadeIn, ScreenHeader, ui } from "./ui";

type EditableItem = { description: string; quantity: string; unit: string; unitPrice: string; total: string; stock: ItemStock; stockSuggested: boolean };
export type StockOutcome = { count: number; status: "done" | "pending" | "not_needed" };
// Valores em reais no padrão brasileiro: 1.234,56. Guardados em centavos para não depender de ponto flutuante.
const centsToInput = (value: number | null | undefined) => value == null ? "" : `${String(Math.trunc(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${String(Math.abs(value) % 100).padStart(2, "0")}`;
const inputToCents = (value: string) => Number(value.replace(/\D/g, "") || "0");
/** Máscara de moeda: os dígitos entram pela direita e a vírgula e os pontos se ajustam sozinhos. */
const maskMoney = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits ? centsToInput(Number(digits)) : "";
};

function Choice(props: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={props.onPress} style={[styles.choice, props.selected && styles.choiceSelected]}><Text style={[styles.choiceText, props.selected && styles.choiceTextSelected]}>{props.label}</Text></Pressable>;
}

export function ReviewScreen(props: {
  user?: User;
  submissionId: string;
  note: string;
  analysis: ReceiptAnalysis;
  fundingSource: FundingSource;
  /** Sangria escolhida na tela inicial: fixa a unidade e limita o total da nota. */
  withdrawal?: OpenWithdrawal | null;
  previewContext?: LocalPurchaseContext;
  previewOnly?: boolean;
  simulation?: boolean;
  onCancel: () => void;
  onDone: (status: string, changeCents: number, stock: StockOutcome) => void;
}) {
  const [context, setContext] = useState<LocalPurchaseContext | null>(props.previewContext ?? null);
  const withdrawal = props.withdrawal ?? null;
  const [unitId, setUnitId] = useState(withdrawal?.unitId ?? "");
  const [supplierName, setSupplierName] = useState(props.analysis.supplierName ?? "");
  // Exibida e digitada como DD/MM/AAAA; só vira AAAA-MM-DD ao enviar. "Hoje" é o dia local do aparelho.
  const [purchaseDateText, setPurchaseDateText] = useState(() => {
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return isoToBrDate(props.analysis.purchaseDate ?? localToday);
  });
  const purchaseDate = expiryToIso(purchaseDateText);
  const [total, setTotal] = useState(centsToInput(props.analysis.amountCents));
  const fundingSource = props.fundingSource;
  const detectedMethod = props.analysis.payment?.method;
  const [companyPaymentMethod, setCompanyPaymentMethod] = useState<CompanyPaymentMethod | null>(detectedMethod && detectedMethod !== "unknown" ? detectedMethod : null);
  const [accountPlanId, setAccountPlanId] = useState("");
  const [choosingAccount, setChoosingAccount] = useState(false);
  // Abre na parte do pagamento, onde ficam a sangria, o troco e a categoria sugerida.
  const [open, setOpen] = useState<"purchase" | "payment" | "items" | null>("payment");
  const [accountSearch, setAccountSearch] = useState("");
  const [resultCenterId, setResultCenterId] = useState("");
  const [items, setItems] = useState<EditableItem[]>(() => props.analysis.items.length ? props.analysis.items.map((item) => ({
    description: item.description,
    quantity: item.quantity == null ? "1" : String(item.quantity).replace(".", ","),
    unit: item.unit || "un",
    unitPrice: centsToInput(item.unitPriceCents),
    total: centsToInput(item.totalCents),
    stock: item.productId ? { ...emptyItemStock, productId: item.productId, quantity: String(item.packages ?? item.quantity ?? "").replace(".", ",") } : { ...emptyItemStock },
    stockSuggested: Boolean(item.productId),
  })) : [{ description: "", quantity: "1", unit: "un", unitPrice: "", total: centsToInput(props.analysis.amountCents), stock: { ...emptyItemStock }, stockSuggested: false }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (props.previewContext) {
      if (!withdrawal && props.previewContext.units.length === 1) setUnitId(props.previewContext.units[0]!.id);
      return;
    }
    if (!props.user) return;
    void loadLocalPurchaseContext(props.user)
      .then((value) => {
        setContext(value);
        if (!withdrawal && value.units.length === 1) setUnitId(value.units[0]!.id);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar os cadastros."));
  }, [props.previewContext, props.user]);

  // A sugestão da IA só entra se a conta existir na lista liberada e o operador ainda não tiver escolhido.
  const suggestedAccount = context?.accounts.find((account) => account.id === props.analysis.suggestedAccountId) ?? null;
  useEffect(() => {
    if (suggestedAccount) setAccountPlanId((current) => current || suggestedAccount.id);
  }, [suggestedAccount?.id]);
  const selectedAccount = context?.accounts.find((account) => account.id === accountPlanId) ?? null;
  const visibleAccounts = useMemo(() => {
    const term = accountSearch.trim().toLocaleLowerCase("pt-BR");
    return (context?.accounts ?? []).filter((account) => !term || account.name.toLocaleLowerCase("pt-BR").includes(term));
  }, [context, accountSearch]);

  const centers = useMemo(() => context?.resultCenters.filter((center) => center.unitId === unitId) ?? [], [context, unitId]);
  useEffect(() => {
    setResultCenterId(centers.length === 1 ? centers[0]!.id : "");
  }, [unitId, centers.length]);

  const typedTotalCents = inputToCents(total);
  const changeCents = withdrawal && Number.isFinite(typedTotalCents) ? withdrawal.amountCents - typedTotalCents : 0;

  const stockProducts = context?.products ?? [];

  function patchItem(index: number, patch: Partial<EditableItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function save() {
    const totalCents = inputToCents(total);
    const normalizedItems = items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity.replace(",", ".")),
      unit: item.unit.trim(),
      unitPriceCents: inputToCents(item.unitPrice),
      totalCents: inputToCents(item.total),
      baseItemId: null as null,
      // Só vale o produto que existe no catálogo recebido; sem ele o item é consumo direto.
      ...(item.stock.productId && stockProducts.some((product) => product.id === item.stock.productId) ? { stock: {
        productId: item.stock.productId,
        quantity: Number(item.stock.quantity.replace(",", ".")),
        expiryDate: item.stock.noExpiry ? null : expiryToIso(item.stock.expiry),
      } } : {}),
    }));
    const invalidStock = items.find((item, index) => normalizedItems[index]!.stock && (!(normalizedItems[index]!.stock!.quantity > 0) || !item.stock.noExpiry && !expiryToIso(item.stock.expiry)));
    if (invalidStock) {
      setError(`Estoque de "${invalidStock.description || "item"}": informe a quantidade e a validade (DD/MM/AAAA) ou marque "Produto sem validade".`); return;
    }
    const stockCount = normalizedItems.filter((item) => item.stock).length;
    if (!purchaseDate) { setError("Informe a data da compra no formato DD/MM/AAAA."); return; }
    if (!unitId || supplierName.trim().length < 2 || totalCents <= 0) {
      setError("Confira unidade, fornecedor e total."); return;
    }
    if (normalizedItems.some((item) => !item.description || !item.unit || item.quantity <= 0 || item.unitPriceCents < 0 || item.totalCents <= 0)
      || normalizedItems.reduce((sum, item) => sum + item.totalCents, 0) !== totalCents) {
      setError("Confira os itens: a soma deve ser exatamente igual ao total da nota."); return;
    }
    if (withdrawal && totalCents > withdrawal.amountCents) {
      setError(`O total da nota é maior que a sangria de ${formatCents(withdrawal.amountCents)}. Confira o valor ou escolha outra sangria.`); return;
    }
    if (!accountPlanId || !resultCenterId) {
      setError("Selecione a categoria e o centro de resultado da compra."); return;
    }
    if (fundingSource === "company_payment" && !companyPaymentMethod) {
      setError("O comprovante não permitiu identificar o meio de pagamento. Selecione-o para continuar."); return;
    }
    setBusy(true); setError("");
    try {
      if (props.previewOnly) {
        props.onDone(fundingSource === "cash_withdrawal" ? "awaiting_cash_withdrawal" : "awaiting_company_payment", Math.max(0, changeCents), { count: stockCount, status: stockCount ? "done" : "not_needed" });
        return;
      }
      if (!props.user) throw new Error("Sessão não disponível.");
      const payload = {
        submissionId: props.submissionId,
        unitId,
        supplierName: supplierName.trim(),
        supplierTaxId: props.analysis.supplierTaxId,
        purchaseDate,
        totalCents,
        fundingSource,
        companyPaymentMethod: fundingSource === "company_payment" ? companyPaymentMethod : null,
        accountPlanId,
        resultCenterId,
        note: props.note.trim() || undefined,
        items: normalizedItems,
        ...(withdrawal ? { withdrawal: { sourceId: withdrawal.sourceId, date: withdrawal.date } } : {}),
      };
      let result = await confirmLocalPurchase(props.user, payload);
      // O estoque fica em outro banco: se a entrada não concluiu, repetir a confirmação a termina sem duplicar a compra.
      if (result.purchase.stockEntry === "pending") result = await confirmLocalPurchase(props.user, payload).catch(() => result);
      props.onDone(result.purchase.status, Math.max(0, changeCents), { count: result.purchase.stockItemCount ?? stockCount, status: result.purchase.stockEntry ?? "not_needed" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar a compra.");
    } finally { setBusy(false); }
  }

  const unitName = withdrawal?.unitName ?? context?.units.find((unit) => unit.id === unitId)?.name ?? "";
  const itemsCents = items.reduce((sum, item) => sum + inputToCents(item.total), 0);
  const totalsMatch = typedTotalCents > 0 && itemsCents === typedTotalCents;
  const stockLinked = items.filter((item) => item.stock.productId).length;
  const paymentReady = !!accountPlanId && !!resultCenterId && (fundingSource !== "company_payment" || !!companyPaymentMethod) && changeCents >= 0;
  const purchaseReady = !!unitId && supplierName.trim().length >= 2 && !!purchaseDate && typedTotalCents > 0;
  const methodLabel = PAYMENT_METHODS.find(([value]) => value === companyPaymentMethod)?.[1];

  if (!context && !error) return <View style={styles.loading}><ActivityIndicator color={ui.pink} /><Text style={styles.loadingText}>Carregando unidade e categorias…</Text></View>;
  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
    <ScreenHeader flat kicker={props.simulation ? "REVISÃO OBRIGATÓRIA · SIMULAÇÃO" : "REVISÃO OBRIGATÓRIA"} title={supplierName.trim() || "Fornecedor a confirmar"} onBack={props.onCancel} backLabel="Voltar para os anexos" backDisabled={busy}>
      <View><Text style={styles.totalLabel}>Total da nota</Text><Text style={styles.total}>{total ? `R$ ${total}` : "R$ —"}</Text><Text style={styles.totalMeta}>{[purchaseDateText, unitName].filter(Boolean).join(" · ") || "Data e unidade a confirmar"}</Text></View>
    </ScreenHeader>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled"><FadeIn style={styles.stack}>
      <Text style={styles.hint}>A leitura da nota é só uma sugestão. Confira as três partes antes de confirmar.</Text>

      <Section index={1} title="Compra" summary={[unitName || "Unidade a escolher", total ? `R$ ${total}` : null].filter(Boolean).join(" · ")} done={purchaseReady} open={open === "purchase"} onToggle={() => setOpen(open === "purchase" ? null : "purchase")}>
        <Text style={styles.label}>Unidade</Text>
        {withdrawal ? <View style={styles.fixed}><Text style={styles.fixedTitle}>{withdrawal.unitName}</Text><Text style={styles.small}>Fixada pela sangria escolhida</Text></View>
          : <View style={styles.choices}>{context?.units.map((unit) => <Choice key={unit.id} selected={unitId === unit.id} label={unit.name} onPress={() => setUnitId(unit.id)} />)}</View>}
        <Text style={styles.label}>Fornecedor</Text><TextInput value={supplierName} onChangeText={setSupplierName} style={styles.input} />
        <View style={styles.row}>
          <View style={styles.flex}><Text style={styles.label}>Data da compra</Text><TextInput value={purchaseDateText} onChangeText={(value) => setPurchaseDateText(maskDate(value))} keyboardType="number-pad" placeholder="DD/MM/AAAA" style={styles.input} /></View>
          <View style={styles.flex}><Text style={styles.label}>Total (R$)</Text><TextInput value={total} onChangeText={(value) => setTotal(maskMoney(value))} keyboardType="number-pad" placeholder="0,00" style={styles.input} /></View>
        </View>
      </Section>

      <Section index={2} title="Pagamento" summary={[withdrawal ? `Sangria de ${formatCents(withdrawal.amountCents)}` : fundingSource === "cash_withdrawal" ? "Sangria fora da lista" : methodLabel ?? "Meio a escolher", selectedAccount?.name ?? "Categoria a escolher"].join(" · ")} done={paymentReady} open={open === "payment"} onToggle={() => setOpen(open === "payment" ? null : "payment")}>
        <View style={styles.fixed}><Text style={styles.fixedTitle}>{withdrawal ? `Sangria de ${formatCents(withdrawal.amountCents)}` : fundingSource === "cash_withdrawal" ? "Sangria fora da lista" : "Compra normal"}</Text><Text style={styles.small}>{withdrawal ? withdrawalLabel(withdrawal) : fundingSource === "cash_withdrawal" ? "Dinheiro do caixa" : "Recurso da empresa"}</Text></View>
        {withdrawal && changeCents > 0 ? <Text style={styles.warn}>Troco de {formatCents(changeCents)}: devolva ao caixa por suprimento no PDV (fundo de caixa), no mesmo dia e nesse valor exato. Sem ele a sangria não concilia.</Text> : null}
        {withdrawal && changeCents < 0 ? <Text style={styles.error}>O total da nota passa da sangria em {formatCents(-changeCents)}.</Text> : null}
        {fundingSource === "company_payment" ? <>
          <Text style={styles.label}>Meio de pagamento identificado</Text>
          <View style={styles.choices}>{PAYMENT_METHODS.map(([value, label]) => <Choice key={value} selected={companyPaymentMethod === value} label={label} onPress={() => setCompanyPaymentMethod(value)} />)}</View>
          {!companyPaymentMethod ? <Text style={styles.note}>Não foi possível comprovar o meio automaticamente. Selecione após conferir o comprovante.</Text> : null}
          {props.analysis.payment?.amountMatchesReceipt === false ? <Text style={styles.error}>O valor do comprovante diverge do total identificado na nota.</Text> : null}
          {props.analysis.payment?.payeeMatchesSupplier === false ? <Text style={styles.note}>O favorecido do comprovante parece diferente do fornecedor da nota. Confira antes de continuar.</Text> : null}
        </> : null}
        {props.analysis.warnings.map((warning, index) => <Text key={`${warning}-${index}`} style={styles.note}>{warning}</Text>)}
        <Text style={styles.label}>Categoria</Text>
        {selectedAccount && !choosingAccount ? <View style={styles.fixed}>
          <Text style={styles.fixedTitle}>{selectedAccount.name}</Text>
          <Text style={styles.small}>{selectedAccount.id === suggestedAccount?.id ? "Sugestão da leitura da nota. Confira antes de registrar." : "Escolhida por você"}</Text>
          <Pressable accessibilityRole="button" onPress={() => setChoosingAccount(true)} hitSlop={6}><Text style={styles.link}>Trocar categoria</Text></Pressable>
        </View> : <>
          {!selectedAccount ? <Text style={styles.note}>Não foi possível sugerir a categoria. Escolha uma para continuar.</Text> : null}
          {(context?.accounts.length ?? 0) > 8 ? <TextInput value={accountSearch} onChangeText={setAccountSearch} placeholder="Buscar categoria" style={styles.input} /> : null}
          <View style={styles.choices}>{visibleAccounts.map((account) => <Choice key={account.id} selected={accountPlanId === account.id} label={account.name} onPress={() => { setAccountPlanId(account.id); setChoosingAccount(false); setAccountSearch(""); }} />)}</View>
        </>}
        {centers.length !== 1 ? <><Text style={styles.label}>Centro de resultado</Text><View style={styles.choices}>{centers.map((center) => <Choice key={center.id} selected={resultCenterId === center.id} label={center.name} onPress={() => setResultCenterId(center.id)} />)}</View></> : null}
        <Text style={styles.note}>{withdrawal ? "A despesa é paga por esta sangria, sem segundo pagamento. A conciliação é automática: na hora, se o caixa do dia já estiver sincronizado, ou assim que for." : fundingSource === "cash_withdrawal" ? "A compra fica aguardando a sangria. Concilie pelo aplicativo quando ela aparecer na lista." : "A nota e o comprovante seguem para o Financeiro, no meio de pagamento escolhido."}</Text>
      </Section>

      <Section index={3} title="Itens" summary={`${items.length} ${items.length === 1 ? "item" : "itens"}${stockLinked ? ` · ${stockLinked} no estoque` : ""}${props.analysis.items.length ? " · sugeridos pela IA" : ""}`} done={totalsMatch} open={open === "items"} onToggle={() => setOpen(open === "items" ? null : "items")}>
        {stockProducts.length ? <Text style={styles.small}>Itens vinculados a um produto entram no estoque {unitName ? `de ${unitName}` : "da unidade"} ao confirmar. Os demais ficam como consumo direto.</Text> : null}
        {items.map((item, index) => <View key={index} style={styles.item}>
          <View style={styles.itemHead}><Text style={styles.itemTitle}>Item {index + 1}</Text>{items.length > 1 ? <Pressable accessibilityRole="button" onPress={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} hitSlop={6}><Text style={styles.remove}>Remover</Text></Pressable> : null}</View>
          <TextInput value={item.description} onChangeText={(value) => patchItem(index, { description: value })} placeholder="Descrição" style={styles.input} />
          <View style={styles.row}>
            <TextInput value={item.quantity} onChangeText={(value) => patchItem(index, { quantity: value })} placeholder="Qtd." keyboardType="decimal-pad" style={[styles.input, styles.flex]} />
            <TextInput value={item.unit} onChangeText={(value) => patchItem(index, { unit: value })} placeholder="Un." style={[styles.input, styles.flex]} />
          </View>
          <View style={styles.row}>
            <TextInput value={item.unitPrice} onChangeText={(value) => patchItem(index, { unitPrice: maskMoney(value) })} placeholder="Unitário R$" keyboardType="number-pad" style={[styles.input, styles.flex]} />
            <TextInput value={item.total} onChangeText={(value) => patchItem(index, { total: maskMoney(value) })} placeholder="Total R$" keyboardType="number-pad" style={[styles.input, styles.flex]} />
          </View>
          <ItemStockEditor value={item.stock} products={stockProducts} suggested={item.stockSuggested} onChange={(stock) => patchItem(index, { stock, stockSuggested: false })} />
        </View>)}
        <AppButton compact secondary label="Adicionar item" onPress={() => setItems((current) => [...current, { description: "", quantity: "1", unit: "un", unitPrice: "", total: "", stock: { ...emptyItemStock }, stockSuggested: false }])} />
      </Section>
    </FadeIn></ScrollView>
    <View style={styles.footer}><View style={styles.footerInner}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.footerRow}>
        <View style={styles.flex}><Text style={styles.footLabel}>Itens × total</Text><Text style={[styles.footValue, totalsMatch ? styles.ok : styles.bad]}>{formatCents(itemsCents)} · {totalsMatch ? "confere" : "não confere"}</Text></View>
        <View style={styles.confirm}><AppButton label={props.simulation ? "Concluir" : "Confirmar"} onPress={() => void save()} disabled={busy} /></View>
      </View>
    </View></View>
    <BusyOverlay text={busy ? "Registrando a compra…" : null} />
  </KeyboardAvoidingView>;
}

const PAYMENT_METHODS = [["pix", "Pix / conta"], ["card_credit", "Cartão de crédito"], ["card_debit", "Cartão de débito"], ["boleto", "Boleto"], ["term", "A prazo"], ["cash", "Dinheiro da empresa"]] as const;

/** Parte da revisão em sanfona: fechada mostra o resumo e se está completa; aberta ganha o contorno rosa. */
function Section(props: { index: number; title: string; summary: string; done: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <View style={[styles.section, props.open && styles.sectionOpen]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: props.open }} onPress={props.onToggle} style={styles.sectionHead}>
      <View style={[styles.badge, props.done ? styles.badgeDone : props.open ? styles.badgeOpen : null]}><Text style={[styles.badgeText, props.done ? styles.ok : props.open ? styles.badgeTextOpen : null]}>{props.done ? "✓" : props.index}</Text></View>
      <View style={styles.flex}><Text style={styles.sectionTitle}>{props.title}</Text>{!props.open ? <Text numberOfLines={1} style={styles.small}>{props.summary}</Text> : null}</View>
      <Text style={[styles.chevron, props.open && styles.chevronOpen]}>{props.open ? "⌃" : "⌄"}</Text>
    </Pressable>
    {props.open ? <View style={styles.sectionBody}>{props.children}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ui.page }, loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: ui.page }, loadingText: { color: ui.inkMuted, fontSize: 14 },
  totalLabel: { color: ui.onDarkFaint, fontSize: 11, fontWeight: "700" }, total: { color: ui.onDark, fontSize: 30, fontWeight: "800", letterSpacing: -0.9 }, totalMeta: { color: ui.onDark2, fontSize: 12 },
  page: { ...contentColumn, paddingHorizontal: 16, paddingVertical: 14 }, stack: { gap: 8 }, hint: { color: ui.inkMuted, fontSize: 12.5, lineHeight: 18 },
  section: { borderRadius: 16, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border, paddingVertical: 14, paddingHorizontal: 16 }, sectionOpen: { borderWidth: 2, borderColor: ui.accent, paddingVertical: 13, paddingHorizontal: 15 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10 }, sectionTitle: { color: ui.ink, fontSize: 14, fontWeight: "800" }, sectionBody: { gap: 10, paddingTop: 12 },
  badge: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F6F4EF", alignItems: "center", justifyContent: "center" }, badgeDone: { backgroundColor: ui.okBg }, badgeOpen: { backgroundColor: ui.accentSoft }, badgeText: { color: ui.inkMuted, fontSize: 12, fontWeight: "900" }, badgeTextOpen: { color: ui.accentInk },
  chevron: { color: ui.inkFaint, fontSize: 16 }, chevronOpen: { color: ui.accentInk }, small: { color: ui.inkMuted, fontSize: 12, lineHeight: 17 },
  label: { color: ui.ink, fontSize: 12.5, fontWeight: "700" }, input: { minHeight: 46, borderWidth: 1, borderColor: ui.borderInput, backgroundColor: ui.soft, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, color: ui.ink },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, choice: { borderWidth: 1, borderColor: ui.borderInput, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }, choiceSelected: { borderColor: ui.accent, backgroundColor: ui.accentSoft }, choiceText: { color: ui.inkMuted, fontSize: 12.5, fontWeight: "700" }, choiceTextSelected: { color: ui.accentInk },
  fixed: { gap: 2, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.border }, fixedTitle: { color: ui.ink, fontSize: 14, fontWeight: "800" }, link: { color: ui.accentInk, fontSize: 13, fontWeight: "800", paddingTop: 6 },
  warn: { color: ui.warn, backgroundColor: ui.warnBg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, fontSize: 12.5, lineHeight: 18, fontWeight: "700" }, note: { color: colors.alertInk, backgroundColor: colors.alertBg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, fontSize: 12, lineHeight: 17 },
  error: { color: ui.danger, backgroundColor: ui.dangerBg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 12.5, lineHeight: 18, fontWeight: "600" },
  item: { borderTopWidth: 1, borderTopColor: ui.border, paddingTop: 12, gap: 8 }, itemHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, itemTitle: { color: ui.ink, fontSize: 13, fontWeight: "800" }, remove: { color: ui.danger, fontSize: 12.5, fontWeight: "700" },
  row: { flexDirection: "row", gap: 8 }, flex: { flex: 1 },
  footer: { backgroundColor: ui.surface, borderTopWidth: 1, borderTopColor: ui.border }, footerInner: { ...contentColumn, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 8 }, footerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  footLabel: { color: ui.inkMuted, fontSize: 11, fontWeight: "700" }, footValue: { fontSize: 14, fontWeight: "800" }, ok: { color: ui.ok }, bad: { color: ui.danger }, confirm: { minWidth: 132 },
});
