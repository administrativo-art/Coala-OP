"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CatalogPage, MappingView } from "../agent/configuration";
import { formatStoneMoney } from "../agent/presentation";
import { financialDateKey } from "../lib/financial-dates";
import type { DailySalesResult } from "./query";
import type { SalesSourceIssue } from "./daily-review";
import type {
  ReconciliationSalesChannel,
  SalesMatchFact,
  SalesReconciliationCaseKind,
  SalesReconciliationMatchBasis,
} from "./types";

const channels: Record<ReconciliationSalesChannel, string> = {
  pix: "Pix",
  debit_card: "Débito",
  credit_card: "Crédito",
};

const kinds: Record<SalesReconciliationCaseKind, string> = {
  matched: "Conferida automaticamente",
  pdv_only: "Venda somente no PDV",
  stone_only: "Captura somente na Stone",
  amount_mismatch: "Valores diferentes",
  status_mismatch: "Estados diferentes",
  unit_mismatch: "Unidades diferentes",
  unit_unmapped: "Unidade não identificada",
  ambiguous: "Correspondência ambígua",
};

const caseReasons: Record<SalesReconciliationCaseKind, string> = {
  matched: "Valor, unidade e evidências são compatíveis dentro deste recorte.",
  pdv_only: "O pagamento aparece no PDV, mas não foi localizado na fonte Stone consultada.",
  stone_only: "A captura aparece na Stone, mas não foi localizada no PDV deste recorte.",
  amount_mismatch: "As evidências apontam para a mesma venda, porém os valores não coincidem.",
  status_mismatch: "A situação informada pelo PDV diverge do evento encontrado na Stone.",
  unit_mismatch: "As evidências relacionadas pertencem a unidades diferentes.",
  unit_unmapped: "Uma das fontes não possui vínculo oficial com a unidade selecionada.",
  ambiguous: "Há mais de uma combinação possível ou a evidência não identifica um par único.",
};

const bases: Record<SalesReconciliationMatchBasis, string> = {
  provider_transaction_id: "ID do provedor",
  nsu_authorization_terminal: "NSU + autorização + terminal",
  merchant_order: "Referência explícita do pedido",
  unique_amount_time: "Par único por valor e janela de cinco minutos",
  daily_amount_multiset: "Mesmo conjunto de valores e quantidades no dia",
  candidate_group: "Grupo de candidatos por horário",
  unmatched: "Sem par neste recorte",
};

const reasons: Record<SalesSourceIssue["reason"], string> = {
  invalid_coupon: "Cupom sem identificação válida",
  duplicate_coupon: "Cupom duplicado",
  invalid_payments: "Pagamentos incompletos ou total divergente",
  invalid_date: "Data inválida ou ausente",
  outside_day: "Registro fora do dia",
  unsupported_channel: "Meio de pagamento não comparável",
  invalid_amount: "Valor inválido ou com fração de centavo",
  non_capture_event: "Evento que não é uma nova venda",
  cancellation_event: "Cancelamento, estorno ou chargeback exige o histórico da venda",
  unsupported_capture: "Captura incompleta ou não suportada",
};

const statuses = {
  approved: "Captura informada",
  pending: "Aprovação não informada pelo PDV",
  partial_cancellation: "Cancelamento parcial no PDV",
  cancelled: "Cancelado",
  refunded: "Estornado",
  chargeback: "Chargeback",
};

const pixSourceLabels: Record<DailySalesResult["pix"]["status"], string> = {
  available: "arquivo recebido",
  requested: "solicitado à Stone; aguardando arquivo",
  pending: "arquivo recebido; processamento ou formato pendente",
  failed: "falha no recebimento ou processamento",
  unavailable: "arquivo ainda não recebido",
  not_configured: "integração não configurada",
};

const money = (cents: number) => {
  const absolute = BigInt(Math.abs(cents));
  return formatStoneMoney(`${cents < 0 ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`);
};

function Evidence({ ids, facts }: { ids: string[]; facts: SalesMatchFact[] }) {
  const selected = facts.filter(fact => ids.includes(fact.id));
  if (!selected.length) return <span className="text-muted-foreground">Não localizado</span>;
  return <details>
    <summary className="cursor-pointer font-medium">{ids.length} pagamento(s)</summary>
    <ul className="mt-2 space-y-2">
      {selected.map(fact => <li key={fact.id} className="break-all rounded-lg bg-muted/40 p-2">
        {fact.couponId ? `Cupom ${fact.couponId}` : `Transação ${fact.id}`} · {money(fact.grossAmountCents)}
        <br />{new Date(fact.soldAt).toLocaleString("pt-BR")} · {statuses[fact.status]}
        <br /><span className="text-xs text-muted-foreground">ID da evidência: {fact.id}</span>
      </li>)}
    </ul>
  </details>;
}

function MetricCard({ label, value, tone = "neutral", detail }: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
  detail?: string;
}) {
  const toneClass = tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-border bg-card";
  return <div className={`rounded-2xl border p-4 ${toneClass}`}>
    <p className="text-xs font-bold uppercase tracking-[0.12em] opacity-75">{label}</p>
    <p className="mt-2 font-mono text-2xl font-bold tabular-nums">{value}</p>
    {detail ? <p className="mt-1 text-xs opacity-80">{detail}</p> : null}
  </div>;
}

type CaseFilter = "attention" | "all" | "auto";

export function SalesReviewPage() {
  const { isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState(() => financialDateKey(new Date(Date.now() - 86_400_000)) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DailySalesResult | null>(null);
  const [channel, setChannel] = useState<"all" | ReconciliationSalesChannel>("all");
  const [caseFilter, setCaseFilter] = useState<CaseFilter>("attention");
  const [page, setPage] = useState(0);
  const [issuePage, setIssuePage] = useState(0);
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
  const clear = () => {
    setResult(null);
    setError("");
    setPage(0);
    setIssuePage(0);
    setChannel("all");
    setCaseFilter("attention");
  };
  const task = async (run: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    clear();
    try {
      await run(controller.signal);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível consultar. Tente novamente.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (active.current === controller) active.current = null;
    }
  };
  const load = (next?: string) => task(async signal => {
    const data = await api<CatalogPage<MappingView>>(`/api/financial/stone-mappings?resource=mappings${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { signal });
    if (signal.aborted) return;
    setMappings(current => next
      ? [...new Map([...current, ...data.items].map(item => [item.id, item])).values()]
      : data.items);
    if (!next) {
      if (data.items.length === 1) {
        setSelected(data.items[0].id);
        setCode(data.items[0].stoneCodes[0] ?? "");
      } else {
        setSelected("");
        setCode("");
      }
    }
    setCursor(data.nextCursor);
    setLoaded(true);
  });

  const allCases = result?.cases ?? [];
  const attentionCount = allCases.filter(row => row.reviewStatus === "attention_required").length;
  const autoCount = allCases.filter(row => row.reviewStatus === "auto_checked").length;
  const pdvTotal = allCases.reduce((sum, row) => sum + row.pdvGrossAmountCents, 0);
  const stoneTotal = allCases.reduce((sum, row) => sum + row.stoneGrossAmountCents, 0);
  const channelSummaries = (Object.entries(channels) as Array<[ReconciliationSalesChannel, string]>).map(([value, label]) => {
    const channelCases = allCases.filter(row => row.channel === value);
    const channelPdv = channelCases.reduce((sum, row) => sum + row.pdvGrossAmountCents, 0);
    const channelStone = channelCases.reduce((sum, row) => sum + row.stoneGrossAmountCents, 0);
    return {
      value,
      label,
      pdv: channelPdv,
      stone: channelStone,
      difference: channelStone - channelPdv,
      auto: channelCases.filter(row => row.reviewStatus === "auto_checked").length,
      attention: channelCases.filter(row => row.reviewStatus === "attention_required").length,
    };
  });
  const rows = allCases.filter(row => (
    (channel === "all" || row.channel === channel)
    && (caseFilter === "all" || caseFilter === "auto" && row.reviewStatus === "auto_checked"
      || caseFilter === "attention" && row.reviewStatus === "attention_required")
  ));
  const selectClass = "mt-1 w-full rounded-xl border bg-background p-2.5";

  return <PageContainer variant="wide" surface className="space-y-6 py-6">
    <PageHeader
      title="Conciliação de vendas"
      description="Comparação automática das vendas do PDV com as capturas da Stone, por unidade, dia e meio de pagamento."
      back={{ fallbackHref: "/dashboard/financial", parentLabel: "Financeiro" }}
    />

    <div role="note" className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      Pares individuais compatíveis e conjuntos diários com os mesmos valores e quantidades são conferidos automaticamente. A tela abre mostrando somente as divergências; use <strong>Todas</strong> para inspecionar cada venda. Esta conferência não confirma recebimento no banco e não lança valores no financeiro.
    </div>

    <Card className="rounded-2xl">
      <CardHeader className="pb-3"><CardTitle className="text-base">Recorte da comparação</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={busy} onClick={() => load()}>
            <RefreshCw className="mr-2 h-4 w-4" />{loaded ? "Atualizar vínculos" : "Carregar vínculos"}
          </Button>
          {cursor ? <Button variant="outline" disabled={busy} onClick={() => load(cursor)}>Mais vínculos</Button> : null}
        </div>
        {loaded && !mappings.length ? <p role="status">Cadastre o vínculo oficial entre unidade, StoneCode e conta antes de consultar.</p> : null}
        <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          if (!mapping) return;
          void task(async signal => {
            const data = await api<DailySalesResult>("/api/financial/pdv-stone-review", {
              method: "POST",
              signal,
              json: { kioskId: mapping.kioskId, mappingId: mapping.id, stoneCode: code, referenceDate: date },
            });
            if (signal.aborted) return;
            if (data.mappingId !== mapping.id || data.accountId !== mapping.accountId
              || data.scope.kioskId !== mapping.kioskId || data.scope.stoneCode !== code
              || data.scope.referenceDate !== date) {
              throw new AuthenticatedApiError("A resposta não corresponde à seleção. Recarregue os vínculos e consulte novamente.", 409, null);
            }
            setResult(data);
          });
        }}>
          <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3">
            <label className="text-sm font-medium">Unidade / conta
              <select required aria-label="Vínculo oficial" className={selectClass} value={selected} onChange={event => {
                setSelected(event.target.value);
                setCode(mappings.find(item => item.id === event.target.value)?.stoneCodes[0] ?? "");
                clear();
              }}>
                <option value="">Selecione</option>
                {mappings.map(item => <option key={item.id} value={item.id}>{item.kioskName} — {item.accountName}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">StoneCode
              <select required disabled={!mapping} aria-label="StoneCode" className={selectClass} value={code} onChange={event => { setCode(event.target.value); clear(); }}>
                <option value="">{mapping ? "Selecione" : "Selecione a unidade primeiro"}</option>
                {mapping?.stoneCodes.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Dia das vendas
              <Input className="mt-1" required aria-label="Dia das vendas" type="date" value={date} onChange={event => { setDate(event.target.value); clear(); }} />
            </label>
          </fieldset>
          <p className="text-sm text-muted-foreground">Um dia por consulta, até 500 cupons ou eventos por fonte. Arquivos Stone ficam disponíveis após as 05h do dia seguinte.</p>
          {mapping ? <p className="text-sm">Vigência do vínculo: {mapping.validFrom} a {mapping.validTo ?? "sem data final"}.</p> : null}
          <Button type="submit" disabled={busy || !mapping || !code || !date}>{busy ? "Comparando…" : "Comparar vendas"}</Button>
        </form>
      </CardContent>
    </Card>

    {error ? <p role="alert" className="text-destructive">{error}</p> : null}

    {result ? <section aria-label="Resultado da comparação" className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Vendas PDV comparadas" value={money(pdvTotal)} detail={`${result.pdvFacts.length} pagamentos digitais no PDV`} />
        <MetricCard label="Capturas Stone" value={money(stoneTotal)} detail={`${result.stoneSales.length} eventos comparáveis`} />
        <MetricCard label="Diferença Stone − PDV" value={money(stoneTotal - pdvTotal)} tone={stoneTotal === pdvTotal ? "success" : "danger"} />
        <MetricCard label="Conferidas automaticamente" value={String(autoCount)} tone="success" detail="Pares individuais compatíveis" />
        <MetricCard label="Divergências" value={String(attentionCount)} tone={attentionCount ? "danger" : "success"} detail={`${result.issues.length} apontamento(s) de fonte`} />
      </div>

      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="pb-3"><CardTitle className="text-base">Resumo por meio de pagamento</CardTitle></CardHeader>
        <CardContent className="p-0 sm:p-0">
          <div className="overflow-x-auto"><div className="min-w-[720px]">
            <div className="grid grid-cols-[1.2fr_repeat(3,1fr)_1.2fr] gap-3 border-y bg-muted/40 px-5 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <span>Meio</span><span className="text-right">PDV</span><span className="text-right">Stone</span><span className="text-right">Diferença</span><span className="text-right">Situação</span>
            </div>
            {channelSummaries.map(item => <button key={item.value} type="button" className="grid w-full grid-cols-[1.2fr_repeat(3,1fr)_1.2fr] gap-3 border-b px-5 py-3 text-left hover:bg-muted/30" onClick={() => { setChannel(item.value); setCaseFilter(item.attention ? "attention" : "all"); setPage(0); }}>
              <span className="font-semibold">{item.label}</span>
              <span className="text-right font-mono tabular-nums">{money(item.pdv)}</span>
              <span className="text-right font-mono tabular-nums">{money(item.stone)}</span>
              <span className={`text-right font-mono font-semibold tabular-nums ${item.difference ? "text-rose-700" : "text-emerald-700"}`}>{money(item.difference)}</span>
              <span className={`text-right text-sm font-semibold ${item.attention ? "text-rose-700" : "text-emerald-700"}`}>{item.attention ? `${item.attention} divergência(s)` : `${item.auto} conferida(s)`}</span>
            </button>)}
          </div></div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="gap-4 border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Conferência do dia</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{result.scope.referenceDate} · Filial PDV {result.pdvFilialId} · StoneCode {result.scope.stoneCode} · consulta {new Date(result.collectedAt).toLocaleString("pt-BR")}</p>
            </div>
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800"><Eye className="mr-1 h-3.5 w-3.5" />Somente leitura</Badge>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Filtrar situação">
            <Button size="sm" variant={caseFilter === "attention" ? "default" : "outline"} onClick={() => { setCaseFilter("attention"); setPage(0); }}>
              <AlertTriangle className="mr-2 h-4 w-4" />Divergências ({attentionCount})
            </Button>
            <Button size="sm" variant={caseFilter === "all" ? "default" : "outline"} onClick={() => { setCaseFilter("all"); setPage(0); }}>Todas ({allCases.length})</Button>
            <Button size="sm" variant={caseFilter === "auto" ? "default" : "outline"} onClick={() => { setCaseFilter("auto"); setPage(0); }}>
              <CheckCircle2 className="mr-2 h-4 w-4" />Conferidas ({autoCount})
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Filtrar meio de pagamento">
            <Button size="sm" variant={channel === "all" ? "secondary" : "ghost"} onClick={() => { setChannel("all"); setPage(0); }}>Todos</Button>
            {(Object.entries(channels) as Array<[ReconciliationSalesChannel, string]>).map(([value, label]) =>
              <Button key={value} size="sm" variant={channel === value ? "secondary" : "ghost"} onClick={() => { setChannel(value); setPage(0); }}>{label}</Button>)}
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {!rows.length ? <p className="p-6" role="status">{caseFilter === "attention" ? "Nenhuma divergência neste filtro." : "Nenhuma venda neste filtro."}</p> : <>
            <div className="overflow-x-auto">
              <table className="min-w-[940px] w-full text-sm">
                <caption className="sr-only">Comparação de pagamentos do PDV com capturas Stone</caption>
                <thead className="bg-muted/40"><tr>{["Meio", "PDV", "Stone", "Valor PDV", "Valor Stone", "Diferença", "Situação e motivo"].map(label => <th key={label} className="p-3 text-left text-xs uppercase tracking-wide text-muted-foreground">{label}</th>)}</tr></thead>
                <tbody>{rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.deterministicKey} className="border-t align-top">
                  <td className="p-3 font-semibold">{channels[row.channel]}</td>
                  <td className="p-3"><Evidence ids={row.pdvFactIds} facts={result.pdvFacts} /></td>
                  <td className="p-3"><Evidence ids={row.stoneSaleIds} facts={result.stoneSales} /></td>
                  <td className="p-3 font-mono tabular-nums">{money(row.pdvGrossAmountCents)}</td>
                  <td className="p-3 font-mono tabular-nums">{money(row.stoneGrossAmountCents)}</td>
                  <td className={`p-3 font-mono font-semibold tabular-nums ${row.differenceAmountCents ? "text-rose-700" : "text-emerald-700"}`}>{money(row.differenceAmountCents)}</td>
                  <td className="max-w-[300px] p-3">
                    <Badge variant="outline" className={row.reviewStatus === "auto_checked" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}>
                      {row.reviewStatus === "auto_checked" ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> : <AlertTriangle className="mr-1 h-3.5 w-3.5" />}
                      {row.kind === "matched" && row.matchBasis === "daily_amount_multiset"
                        ? "Conjunto diário conferido"
                        : kinds[row.kind]}
                    </Badge>
                    <p className="mt-2">{row.kind === "matched" && row.matchBasis === "daily_amount_multiset"
                      ? "Os valores e as quantidades coincidem no dia. A conferência vale para o conjunto e não identifica qual captura pertence a cada pagamento."
                      : caseReasons[row.kind]}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Critério: {bases[row.matchBasis]}</p>
                  </td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 border-t p-4">
              <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Anterior</Button>
              <span className="text-sm">Página {page + 1} de {Math.ceil(rows.length / 50)}</span>
              <Button variant="outline" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>Próxima</Button>
            </div>
          </>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Cobertura e apontamentos das fontes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <details>
            <summary className="cursor-pointer font-medium">Fonte Pix: {pixSourceLabels[result.pix.status]}
              {result.pix.coverage === "partial" ? " · cobertura parcial" : result.pix.coverage === "complete" ? " · cobertura completa" : ""}
              {` · PDV não comparado (${result.uncomparedPdvFacts.length})`}</summary>
            <p className="mt-2 text-sm text-muted-foreground">Arquivo: {result.pix.fileId ?? "não configurado"} · Registros excluídos: {result.pix.excludedCount}. Os dados recebidos ficam armazenados no Coala; a tela não solicita novamente um arquivo já processado. Sem arquivo íntegro e vínculo por StoneCode, pagamentos Pix não são classificados como ausentes na Stone.</p>
            <div className="mt-3"><Evidence ids={result.uncomparedPdvFacts.map(fact => fact.id)} facts={result.uncomparedPdvFacts} /></div>
          </details>
          <details open={result.issues.length > 0}>
            <summary className="cursor-pointer font-medium">Apontamentos fora da comparação ({result.issues.length})</summary>
            <ul className="space-y-2 py-3">{result.issues.slice(issuePage * 50, (issuePage + 1) * 50).map((issue, index) =>
              <li key={`${issuePage}:${index}`} className="break-all rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{issue.source.toUpperCase()} · {issue.reference}: {reasons[issue.reason]}</li>)}</ul>
            {result.issues.length > 50 ? <div className="flex items-center gap-3">
              <Button variant="outline" disabled={!issuePage} onClick={() => setIssuePage(issuePage - 1)}>Apontamentos anteriores</Button>
              <span>{issuePage + 1} / {Math.ceil(result.issues.length / 50)}</span>
              <Button variant="outline" disabled={(issuePage + 1) * 50 >= result.issues.length} onClick={() => setIssuePage(issuePage + 1)}>Mais apontamentos</Button>
            </div> : null}
          </details>
          <details>
            <summary className="cursor-pointer font-medium">Valores e contadores originais dos eventos Stone</summary>
            <p className="mt-2 text-sm text-muted-foreground">Decimais originais da fonte, sem arredondamento.</p>
            <ul className="mt-2 space-y-2">{result.stoneEvents.map(event => <li key={`${event.sourceSection}:${event.transactionId}`} className="break-all text-sm">{event.sourceSection} · {event.transactionId} · Bruto original: {event.capturedAmount ?? "Não informado"} · Cancelado original: {event.canceledAmount ?? "Não informado"}<br />{Object.entries(event.events).map(([name, count]) => `${name}: ${count}`).join(" · ")}</li>)}</ul>
          </details>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
        </CardContent>
      </Card>
    </section> : null}
  </PageContainer>;
}
