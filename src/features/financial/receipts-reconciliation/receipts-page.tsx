"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Landmark } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { PageContainer } from "@/components/layout/page-container";
import { PageHero } from "@/components/patterns/page-hero";
import { HeroBackButton } from "@/components/patterns/hero-back-button";
import { HeroChip } from "@/components/patterns/hero-chip";
import { AcquirerFeesPanel } from "../acquirer-fees/fees-panel";
import type { CatalogPage, MappingView } from "../agent/configuration";
import { StoneAccountReceipts, type StoneAccountIndicators } from "./stone-account-panel";
import { StoneFeeReviewPanel } from "./fee-review-panel";
import { centsLabel } from "./stone-account-format";
import { StoneReceiptFlowNavigation } from "./receipt-flow-navigation";
import { StoneScopeSelector } from "./stone-scope-selector";

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
  const [feePending, setFeePending] = useState<number | null>(null);
  const active = useRef<AbortController | null>(null);
  const requestedMapping = searchParams.get("mapping");
  const requestedCode = searchParams.get("stoneCode");
  const tab: ReceiptTab = searchParams.get("tab") === "fees" ? "fees" : "credit";

  const applyMappings = (items: MappingView[], nextCursor: string | null, append = false) => {
    const nextItems = append ? [...new Map([...mappings, ...items].map(item => [item.id, item])).values()] : items;
    setMappings(nextItems); setCursor(nextCursor); setLoaded(true);
    const mapping = nextItems.find(item => item.id === requestedMapping) ?? (nextItems.length === 1 ? nextItems[0] : null);
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
  const mapping = mappings.find(item => item.id === selected);
  const onMappingChange = (mappingId: string) => { const next = mappings.find(item => item.id === mappingId); setSelected(mappingId); setCode(next?.stoneCodes[0] ?? ""); };

  return <PageContainer variant="wide" surface className="space-y-6 py-6">
    <PageHero kicker="Recebíveis Stone" title={tab === "fees" ? "Taxas" : "Recebido"} subtitle={tab === "fees" ? "Quanto a Stone reteve de taxa, para contabilizar." : "A Stone pagou na conta Stone o que vendemos no Pix e no cartão, com a taxa e no prazo certos?"} actions={<HeroBackButton fallbackHref="/dashboard/financial" parentLabel="Financeiro" />}
      chips={tab === "credit" && indicators ? <>
        <HeroChip tone="info" value={centsLabel(indicators.expectedCents)} label="previsto na competência" />
        <HeroChip value={centsLabel(indicators.paidCents)} label="caiu na conta Stone" />
        <HeroChip value={centsLabel(indicators.feeCents)} label="taxas das vendas" />
        <HeroChip tone="danger" value={indicators.pendingCount} label="parcelas pendentes" />
        <HeroChip tone="warning" value={indicators.pdvAttentionCount} label="vendas com atenção no PDV" />
      </> : undefined} />
    <details className="rounded-xl border border-ds-border bg-white px-4 py-3 text-sm text-ds-ink-2">
      <summary className="cursor-pointer font-bold">Entenda os termos desta conciliação</summary>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-bold">StoneCode</dt><dd>Identificador do estabelecimento na Stone.</dd></div>
        <div><dt className="font-bold">Previsto pela Stone</dt><dd>Líquido que a Stone informou que pagaria naquele dia (PrevisionPaymentDate).</dd></div>
        <div><dt className="font-bold">Caiu na conta Stone</dt><dd>Pagamento informado no arquivo diário da Stone. O extrato da conta Stone ainda não está no sistema.</dd></div>
        <div><dt className="font-bold">Antecipação</dt><dd>Parcela paga antes do previsto, com desconto de antecipação.</dd></div>
        <div><dt className="font-bold">Taxa praticada</dt><dd>MDR ÷ bruto de cada venda. A taxa contratada ainda depende de uma tabela oficial.</dd></div>
        <div><dt className="font-bold">Cruzamentos</dt><dd>As 12 conferências de cada venda: PDV × Stone, parcelas, taxa, líquido e data de pagamento.</dd></div>
      </dl>
      <p className="mt-3 text-muted-foreground">A consulta não cria lançamentos. A transferência da conta Stone para o Inter é a 2ª parte da conciliação.</p>
    </details>
    <StoneScopeSelector mappings={mappings} mappingId={selected} stoneCode={code} busy={busy} loaded={loaded} error={error} cursor={cursor} onMappingChange={onMappingChange} onStoneCodeChange={setCode} onRefresh={() => void load()} onLoadMore={cursor ? () => void load(cursor) : undefined} />
    {mapping && code ? <>
      <StoneReceiptFlowNavigation current={tab} mappingId={mapping.id} stoneCode={code} />
      {tab === "fees" ? <section className="space-y-4" aria-label="Taxas">
        <StoneFeeReviewPanel key={`fees-review:${mapping.id}:${code}`} mapping={mapping} stoneCode={code} onPending={setFeePending} />
        <section className="rounded-ds-card border border-ds-border bg-ds-surface px-[18px] py-4" aria-label="Despesa do mês">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Despesa do mês</p>
          <h2 className="mt-0.5 text-[15.5px] font-extrabold text-ds-ink">Lançar as taxas como despesa</h2>
          <p className="text-[12.5px] text-ds-ink-muted">A despesa já foi paga na origem: a Stone descontou do repasse, então não haverá outra saída no banco. Taxa praticada é o que a Stone reteve; Taxa contratada não é usada como referência enquanto não houver tabela oficial: a conferência compara com a taxa atual recorrente, confirmada pelo operador.{feePending ? ` Ainda há ${feePending} pendência(s) acima; o recomendado é resolvê-las antes de lançar.` : ""}</p>
        </section>
        <AcquirerFeesPanel key={`fees:${mapping.id}:${code}`} kioskId={mapping.kioskId} mappingId={mapping.id} stoneCode={code} />
      </section> : null}
      {tab === "credit" ? <StoneAccountReceipts key={`stone-account:${mapping.id}:${code}`} mapping={mapping} stoneCode={code} onIndicators={onIndicators} /> : null}
    </> : <div className="rounded-2xl border border-dashed border-ds-border-input px-6 py-12 text-center"><Landmark className="mx-auto h-8 w-8 text-ds-accent-ink" aria-hidden="true" /><p className="mt-3 font-bold">Selecione a unidade primeiro; a conta vinculada vem junto</p><p className="mt-1 text-sm text-muted-foreground">Depois escolha o identificador Stone. Essa seleção acompanha as etapas de recebimentos.</p></div>}
  </PageContainer>;
}
