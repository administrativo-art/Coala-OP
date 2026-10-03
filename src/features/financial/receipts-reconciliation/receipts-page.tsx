"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Landmark, Percent } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcquirerFeesPanel } from "../acquirer-fees/fees-panel";
import type { CatalogPage, MappingView } from "../agent/configuration";
import { StoneBankReceiptReconciliation } from "./reconciliation-panel";
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
    <PageHeader title="Conciliação de recebimentos" description="Agenda, parcelas pagas, taxas retidas e confirmação do crédito bancário em fluxos separados." back={{ fallbackHref: "/dashboard/financial", parentLabel: "Financeiro" }} />
    <div role="note" className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><span>Um pagamento informado pela Stone ainda não comprova o crédito no banco. Taxas só aparecem quando a retenção é explícita; valores ausentes permanecem desconhecidos.</span><Badge variant="outline" className="border-amber-300 bg-white text-amber-950">Não abre contestação na Stone</Badge></div>
    <StoneScopeSelector mappings={mappings} mappingId={selected} stoneCode={code} busy={busy} loaded={loaded} error={error} cursor={cursor} onMappingChange={onMappingChange} onStoneCodeChange={setCode} onRefresh={() => void load()} onLoadMore={cursor ? () => void load(cursor) : undefined} />
    {mapping && code ? <>
      <StoneReceiptFlowNavigation current={tab} mappingId={mapping.id} stoneCode={code} />
      {tab === "fees" ? <section className="space-y-4" aria-label="Taxas praticadas"><Card className="rounded-2xl border-[#e6e3dc] bg-[#faf9f6]"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Percent className="h-4 w-4 text-[#bd185c]" />Taxas praticadas, com contrato separado</CardTitle><CardDescription>A Taxa praticada usa apenas retenção explícita da Stone. A Taxa contratada ainda exige uma fonte oficial versionada por modalidade e vigência; por isso esta tela não aponta cobrança a maior.</CardDescription></CardHeader></Card><AcquirerFeesPanel key={`fees:${mapping.id}:${code}`} kioskId={mapping.kioskId} mappingId={mapping.id} stoneCode={code} /></section> : null}
      {tab === "credit" ? <StoneBankReceiptReconciliation key={`bank-receipts:${mapping.id}:${code}`} mapping={mapping} stoneCode={code} /> : null}
    </> : <div className="rounded-2xl border border-dashed border-[#d8d3c8] px-6 py-12 text-center"><Landmark className="mx-auto h-8 w-8 text-[#bd185c]" aria-hidden="true" /><p className="mt-3 font-bold">Selecione a unidade primeiro, depois a conta e o StoneCode</p><p className="mt-1 text-sm text-muted-foreground">O mesmo vínculo será preservado entre as quatro etapas de recebimentos.</p></div>}
    <p className="text-sm text-muted-foreground">A exportação de evidências fica prevista para a próxima etapa. Este módulo não abre contestação na Stone.</p>
  </PageContainer>;
}
