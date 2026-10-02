"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Landmark, Percent, RefreshCw, WalletCards } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcquirerFeesPanel } from "../acquirer-fees/fees-panel";
import { StoneBankReceiptReconciliation } from "./reconciliation-panel";
import type { CatalogPage, MappingView } from "../agent/configuration";

function FlowCard({ icon: Icon, title, description, status, href, action }: {
  icon: typeof WalletCards;
  title: string;
  description: string;
  status: string;
  href: string;
  action: string;
}) {
  return <Card className="rounded-2xl">
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50 text-pink-700"><Icon className="h-5 w-5" /></span>
        <Badge variant="outline" className="text-[11px]">{status}</Badge>
      </div>
      <CardTitle className="pt-2 text-base">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent>
      <Button variant="outline" className="w-full justify-between" asChild>
        <Link href={href}>{action}<ArrowUpRight className="h-4 w-4" /></Link>
      </Button>
    </CardContent>
  </Card>;
}

export function StoneReceiptsPage() {
  const { isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isDefaultAdmin) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    void api<CatalogPage<MappingView>>("/api/financial/stone-mappings?resource=mappings", { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        setMappings(data.items);
        setCursor(data.nextCursor);
        setLoaded(true);
        if (data.items.length === 1) {
          setSelected(data.items[0].id);
          setCode(data.items[0].stoneCodes[0] ?? "");
        }
      })
      .catch(caught => {
        if (!controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível carregar os vínculos Stone.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
        if (active.current === controller) active.current = null;
      });
    return () => {
      controller.abort();
      if (active.current === controller) active.current = null;
    };
  }, [api, isDefaultAdmin]);

  if (!isDefaultAdmin) return <PageContainer surface><p role="alert">Consulta restrita à administração.</p></PageContainer>;

  const mapping = mappings.find(item => item.id === selected);
  const load = async (next?: string) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const data = await api<CatalogPage<MappingView>>(`/api/financial/stone-mappings?resource=mappings${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setMappings(current => next
        ? [...new Map([...current, ...data.items].map(item => [item.id, item])).values()]
        : data.items);
      setCursor(data.nextCursor);
      setLoaded(true);
      if (!next && data.items.length === 1) {
        setSelected(data.items[0].id);
        setCode(data.items[0].stoneCodes[0] ?? "");
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível carregar os vínculos Stone.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (active.current === controller) active.current = null;
    }
  };

  const selectClass = "mt-1 w-full rounded-xl border bg-background p-2.5";

  return <PageContainer variant="wide" surface className="space-y-6 py-6">
    <PageHeader
      title="Conciliação de recebimentos"
      description="Agenda, parcelas pagas, taxas retidas e confirmação do crédito bancário em fluxos separados."
      back={{ fallbackHref: "/dashboard/financial", parentLabel: "Financeiro" }}
    />

    <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      Um pagamento informado pela Stone ainda não comprova o crédito no banco. Taxas só são apresentadas quando o arquivo traz a retenção de forma explícita; valores ausentes permanecem desconhecidos.
    </div>

    <section aria-label="Etapas dos recebimentos" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <FlowCard icon={WalletCards} title="Carteira e previsões" description="Parcelas previstas, pagas e antecipadas no período, sem presumir saldo bancário." status="Disponível" href="/dashboard/financial/cash-flow/receivables" action="Abrir recebíveis" />
      <FlowCard icon={RefreshCw} title="Antecipações" description="Compara parcelas originais com pagamentos antecipados e custos explícitos." status="Disponível" href="/dashboard/financial/stone-anticipations" action="Conferir antecipações" />
      <FlowCard icon={Percent} title="Taxas praticadas" description="Consulta MDR, Pix e antecipação quando a Stone informa a retenção." status="Disponível por fonte" href="#taxas-praticadas" action="Ir para taxas" />
      <FlowCard icon={Landmark} title="Crédito bancário" description="Conferir se o líquido pago pela Stone entrou na conta bancária do vínculo." status="Disponível" href="#credito-bancario" action="Conferir recebimentos" />
    </section>

    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Comparação das taxas de cartão</CardTitle>
        <CardDescription>A comparação será feita por modalidade e vigência quando as duas evidências estiverem disponíveis.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <p className="text-xs font-bold uppercase tracking-wide">Taxa praticada</p>
          <p className="mt-2 font-semibold">MDR explícito da Stone</p>
          <p className="mt-1 text-sm">Disponível por transação quando o arquivo informa o valor.</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <p className="text-xs font-bold uppercase tracking-wide">Taxa contratada</p>
          <p className="mt-2 font-semibold">Fonte oficial a configurar</p>
          <p className="mt-1 text-sm">O sistema ainda não possui tabela contratual versionada por modalidade.</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="text-xs font-bold uppercase tracking-wide">Resultado</p>
          <p className="mt-2 font-semibold">Comparação aguardando contrato</p>
          <p className="mt-1 text-sm text-muted-foreground">Nenhuma cobrança a maior será indicada sem a taxa contratada vigente e a regra de arredondamento comprovadas.</p>
        </div>
      </CardContent>
    </Card>

    <Card id="taxas-praticadas" className="scroll-mt-24 rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Vínculo para consultar taxas praticadas</CardTitle>
        <CardDescription>Selecione a unidade e o StoneCode usados pela origem.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />{loaded ? "Atualizar vínculos" : "Carregar vínculos"}</Button>
          {cursor ? <Button variant="outline" disabled={busy} onClick={() => void load(cursor)}>Mais vínculos</Button> : null}
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        {loaded && !mappings.length ? <p role="status">Nenhum vínculo disponível. Configure a unidade, a conta e o StoneCode antes da consulta.</p> : null}
        <fieldset disabled={busy} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">Unidade / conta
            <select aria-label="Vínculo oficial" className={selectClass} value={selected} onChange={event => {
              setSelected(event.target.value);
              setCode(mappings.find(item => item.id === event.target.value)?.stoneCodes[0] ?? "");
            }}>
              <option value="">Selecione</option>
              {mappings.map(item => <option key={item.id} value={item.id}>{item.kioskName} — {item.accountName}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">StoneCode
            <select disabled={!mapping} aria-label="StoneCode" className={selectClass} value={code} onChange={event => setCode(event.target.value)}>
              <option value="">{mapping ? "Selecione" : "Selecione a unidade primeiro"}</option>
              {mapping?.stoneCodes.map(item => <option key={item}>{item}</option>)}
            </select>
          </label>
        </fieldset>
        {mapping ? <p className="text-sm text-muted-foreground">Vínculo vigente de {mapping.validFrom} a {mapping.validTo ?? "sem data final"}.</p> : null}
      </CardContent>
    </Card>

    {mapping && code ? <AcquirerFeesPanel key={`${mapping.id}:${code}`} kioskId={mapping.kioskId} mappingId={mapping.id} stoneCode={code} /> : null}

    {mapping && code ? <StoneBankReceiptReconciliation key={`bank-receipts:${mapping.id}:${code}`} mapping={mapping} stoneCode={code} /> : null}

    <p className="text-sm text-muted-foreground">A exportação de evidências fica prevista para a próxima etapa. Este módulo não abre contestação na Stone.</p>
  </PageContainer>;
}
