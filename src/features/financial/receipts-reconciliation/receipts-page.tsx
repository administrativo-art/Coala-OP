"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Landmark } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { PageContainer } from "@/components/layout/page-container";
import { PageHero } from "@/components/patterns/page-hero";
import { HeroBackButton } from "@/components/patterns/hero-back-button";
import { HeroChip } from "@/components/patterns/hero-chip";
import { InfoPopover } from "@/components/ui/info-popover";
import type { CatalogPage, MappingView } from "../agent/configuration";
import { StoneAccountReceipts, type StoneAccountIndicators } from "./stone-account-panel";
import { StoneFeeReviewPanel, type FeeSummary, type FeeTarget } from "./fee-review-panel";
import { useStoneFeePending } from "./use-fee-pending";
import { centsLabel } from "./stone-account-format";
import { StoneReceiptFlowNavigation } from "./receipt-flow-navigation";
import { STONE_ALL_MAPPINGS, StoneScopeSelector } from "./stone-scope-selector";

type ReceiptTab = "fees" | "credit";

export function StoneReceiptsPage() {
  const { isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const searchParams = useSearchParams();
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [indicators, setIndicators] = useState<StoneAccountIndicators>(null);
  const onIndicators = useCallback((value: StoneAccountIndicators) => setIndicators(value), []);
  const [feeSummary, setFeeSummary] = useState<FeeSummary | null>(null);
  const [feeMonth, setFeeMonth] = useState("");
  const active = useRef<AbortController | null>(null);
  const requestedMapping = searchParams.get("mapping");
  const requestedCode = searchParams.get("stoneCode");
  const requestedKiosk=searchParams.get("kiosk");
  const tab: ReceiptTab = searchParams.get("tab") === "fees" ? "fees" : "credit";

  const everything = selected === STONE_ALL_MAPPINGS;
  const selectedMapping = mappings.find(item => item.id === selected);
  // Selo de pendências de taxa: em Recebido vem do resumo do mês; em Taxas, da própria conferência (atualiza a cada decisão).
  const { pending: feePending, setPending: setFeePending } = useStoneFeePending({ kioskId: selectedMapping?.kioskId, stoneCode: code, month: searchParams.get("month") ?? undefined, enabled: isDefaultAdmin && tab === "credit" });
  const feeTargets = useMemo<FeeTarget[]>(() => tab !== "fees" ? [] : everything ? mappings.flatMap(item => item.stoneCodes.map(stoneCode => ({ mapping: item, stoneCode }))) : selectedMapping && code ? [{ mapping: selectedMapping, stoneCode: code }] : [], [tab, everything, mappings, selectedMapping, code]);

  const applyMappings = (items: MappingView[], nextCursor: string | null, append = false) => {
    const nextItems = append ? [...new Map([...mappings, ...items].map(item => [item.id, item])).values()] : items;
    setMappings(nextItems); setCursor(nextCursor); setLoaded(true);
    const mapping = nextItems.find(item => item.id === requestedMapping) ?? nextItems.find(item=>item.kioskId===requestedKiosk) ?? ((!requestedMapping && !requestedKiosk && (tab==="fees" || nextItems.length === 1)) ? nextItems[0] : null);
    if (mapping) { setSelected(mapping.id); setCode(mapping.stoneCodes.includes(requestedCode ?? "") ? requestedCode ?? "" : mapping.stoneCodes[0] ?? ""); }
  };
  const load = async (next?: string, endpoint = "/api/financial/stone-mappings?resource=mappings") => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    try {
      const data = await api<CatalogPage<MappingView>>(`${endpoint}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { signal: controller.signal });
      if (!controller.signal.aborted) applyMappings(data.items, data.nextCursor, Boolean(next));
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível carregar os vínculos Stone.");
    } finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  };
  useEffect(() => {
    if (!isDefaultAdmin) return;
    const initialEndpoint = "/api/financial/stone-mappings?resource=mappings";
    void load(undefined, initialEndpoint);
    return () => { active.current?.abort(); active.current = null; };
  // O catálogo é carregado na entrada; a URL só decide o vínculo quando os itens chegam.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, isDefaultAdmin]);
  if (!isDefaultAdmin) return <PageContainer surface><p role="alert">Consulta restrita à administração.</p></PageContainer>;
  const mapping = selectedMapping;
  const onMappingChange = (mappingId: string) => { const next = mappings.find(item => item.id === mappingId); setSelected(mappingId); setCode(next?.stoneCodes[0] ?? ""); setFeeSummary(null); };
  const openUnit = (target: FeeTarget) => { setSelected(target.mapping.id); setCode(target.stoneCode); setFeeSummary(null); };

  return <PageContainer variant="wide" surface className="space-y-6 py-6">
    <PageHero kicker="Recebíveis Stone" title={tab === "fees" ? "Taxas" : "Recebido"} subtitle={tab === "fees" ? "Quanto a Stone reteve de taxa, para contabilizar." : "A Stone pagou na conta Stone o que vendemos no Pix e no cartão, com a taxa e no prazo certos?"} actions={<><TermsHelp /><HeroBackButton fallbackHref="/dashboard/financial" parentLabel="Financeiro" /></>}
      chips={tab === "fees" && feeSummary ? <>
        <HeroChip value={centsLabel(feeSummary.totalFeesCents)} label="taxas do mês" />
        <HeroChip value={feeSummary.feeRate === null ? "—" : `${(feeSummary.feeRate * 100).toFixed(2).replace(".", ",")}%`} label="sobre as vendas" />
        <HeroChip tone="danger" value={centsLabel(feeSummary.overchargeCents)} label="acima da taxa atual" />
        <HeroChip tone="warning" value={feeSummary.pending} label="a decidir" />
        <HeroChip tone="info" value={feeSummary.withStone} label="com a Stone" />
      </> : tab === "credit" && indicators ? <>
        <HeroChip tone="info" value={centsLabel(indicators.expectedCents)} label="previsto na competência" />
        <HeroChip value={centsLabel(indicators.paidCents)} label="caiu na conta Stone" />
        <HeroChip value={centsLabel(indicators.feeCents)} label="taxas das vendas" />
        <HeroChip tone="danger" value={indicators.pendingCount} label="parcelas pendentes" />
        <HeroChip tone="warning" value={indicators.pdvAttentionCount} label="vendas com atenção no PDV" />
      </> : undefined} />
    <StoneScopeSelector mappings={mappings} mappingId={selected} stoneCode={code} busy={busy} loaded={loaded} error={error} cursor={cursor} onMappingChange={onMappingChange} onStoneCodeChange={setCode} onRefresh={() => void load()} onLoadMore={cursor ? () => void load(cursor) : undefined} allowAll={tab === "fees"} />
    {(tab === "fees" && everything && mappings.length) || (mapping && code) ? <>
      <StoneReceiptFlowNavigation current={tab} mappingId={mapping?.id} stoneCode={code || undefined} feePending={tab === "fees" ? (feeSummary ? feeSummary.pending : null) : feePending} />
      {tab === "fees" ? <section className="space-y-4" aria-label="Taxas">
        <StoneFeeReviewPanel key={`fees-review:${everything ? "all" : `${selected}:${code}`}:${searchParams.get("month") ?? ""}`} targets={feeTargets} initialMonth={searchParams.get("month") ?? feeMonth ?? undefined}
          onSummary={setFeeSummary} onMonthChange={setFeeMonth} onOpenUnit={openUnit} onPendingChange={setFeePending} />
      </section> : null}
      {tab === "credit" && mapping && code ? <StoneAccountReceipts key={`stone-account:${mapping.id}:${code}`} mapping={mapping} stoneCode={code} onIndicators={onIndicators} /> : null}
    </> : <div className="rounded-2xl border border-dashed border-ds-border-input px-6 py-12 text-center"><Landmark className="mx-auto h-8 w-8 text-ds-accent-ink" aria-hidden="true" /><p className="mt-3 font-bold">Selecione a unidade primeiro; a conta vinculada vem junto</p><p className="mt-1 text-sm text-muted-foreground">Depois escolha o identificador Stone. Essa seleção acompanha as etapas de recebimentos.</p></div>}
  </PageContainer>;
}

/** Glossário da conciliação: ícone de informação no topo escuro (docs/design/ajuda-contextual). */
function TermsHelp() {
  return <InfoPopover title="Entenda os termos desta conciliação" className="h-10 w-10 border-white/[.14] bg-white/8 text-ds-on-dark-2 hover:border-white/30 hover:text-white">
    <dl className="space-y-2">
      <div><dt className="font-bold text-ds-ink">StoneCode</dt><dd>Identificador do estabelecimento na Stone.</dd></div>
      <div><dt className="font-bold text-ds-ink">Previsto pela Stone</dt><dd>Líquido que a Stone informou que pagaria naquele dia (PrevisionPaymentDate).</dd></div>
      <div><dt className="font-bold text-ds-ink">Caiu na conta Stone</dt><dd>Pagamento informado no arquivo diário da Stone. O extrato da conta Stone ainda não está no sistema.</dd></div>
      <div><dt className="font-bold text-ds-ink">Antecipação</dt><dd>Parcela paga antes do previsto, com desconto de antecipação.</dd></div>
      <div><dt className="font-bold text-ds-ink">Taxa praticada</dt><dd>Taxa ÷ bruto de cada venda: no cartão, bruto − líquido exato da Stone; no Pix, a Stone corta os centavos para baixo, então vendas pequenas pagam um pouco menos que a taxa. A taxa contratada ainda depende de uma tabela oficial.</dd></div>
      <div><dt className="font-bold text-ds-ink">Cruzamentos</dt><dd>As 12 conferências de cada venda: PDV × Stone, parcelas, taxa, líquido e data de pagamento.</dd></div>
      <div><dt className="font-bold text-ds-ink">Ocorrência</dt><dd>Item de taxa contestado e acompanhado com a Stone, com protocolo, contatos e resultado.</dd></div>
    </dl>
    <p>A consulta não cria lançamentos. A transferência da conta Stone para o Inter é a 2ª parte da conciliação.</p>
  </InfoPopover>;
}
