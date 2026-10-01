"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Info, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import type { CatalogPage, MappingView } from "../agent/configuration";
import { financialDateKey } from "../lib/financial-dates";
import type { DailySalesApiResult } from "./review-state";
import type { ReconciliationSalesChannel, SalesMatchFact, SuggestedSalesReconciliationCase } from "./types";
import { CaseDetailPanel, StatusBadge } from "./review-case-panel";
import {
  addDays, bases, caseBadgeLabel, caseTime, channelOrder, channels, factLabel, filterCases, formatDateKey, isAttention,
  issueReasons, kindsShort, money, pixSourceLabels, reviewStatuses, saleStatuses, stoneEventLabels,
  summarizeChannel,
} from "./review-view";
import type { CaseFilter, ChannelFilter, KindFilter } from "./review-view";

const PAGE_SIZE = 20;
const ISSUE_PAGE_SIZE = 50;
const UNCOMPARED_PREVIEW = 6;

type CoverageTab = "pix" | "issues" | "events" | "limits";

const label = "mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#9a9ba1]";
const field = "h-[50px] w-full rounded-xl border border-[#e3ded3] bg-[#faf9f6] px-3.5 text-[13.5px] font-semibold text-[#1a1b1f] disabled:cursor-not-allowed disabled:opacity-55";
const pager = "h-8 rounded-[9px] border border-[#e3ded3] bg-white px-3 text-xs font-bold text-[#374151] hover:bg-[#faf9f6] disabled:cursor-default disabled:opacity-45";
const rowGrid = "grid min-w-[780px] grid-cols-[52px_64px_minmax(0,1fr)_minmax(0,1fr)_96px_minmax(0,1.25fr)] items-center gap-3.5 px-[18px]";
const mono = "font-mono tabular-nums";

function Panel({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-[#e9e5dc] bg-white", className)} {...props}>{children}</div>;
}

function Metric({ title, value, detail, tone = "neutral" }: { title: string; value: string; detail: string; tone?: "neutral" | "ok" | "bad" }) {
  return <div className={cn("rounded-2xl border px-[18px] py-4", tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : tone === "bad" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-[#e9e5dc] bg-white")}>
    <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] opacity-75">{title}</p>
    <p className={cn(mono, "mt-2.5 text-[22px] font-bold tracking-tight")}>{value}</p>
    <p className="mt-1 text-[11.5px] opacity-80">{detail}</p>
  </div>;
}

function SideCell({ ids, facts, missing }: { ids: string[]; facts: Map<string, SalesMatchFact>; missing: string }) {
  const list = ids.map(id => facts.get(id)).filter((fact): fact is SalesMatchFact => !!fact);
  if (!list.length) return <div className="min-w-0"><p className="text-xs italic text-[#b8b3a9]">Não localizado</p><p className="mt-0.5 truncate text-[11px] text-[#9a9ba1]">{missing}</p></div>;
  return <div className="min-w-0">
    <p className={cn(mono, "text-[12.5px] font-semibold")}>{money(list.reduce((sum, fact) => sum + fact.grossAmountCents, 0))}</p>
    <p className="mt-0.5 truncate text-[11px] text-[#9a9ba1]">{list.length > 1 ? `${list.length} pagamento(s) · ${factLabel(list[0])}…` : factLabel(list[0])}</p>
  </div>;
}

export function SalesReviewPage() {
  const { isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const yesterday = useMemo(() => financialDateKey(new Date(Date.now() - 86_400_000)) ?? "", []);
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState(yesterday);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DailySalesApiResult | null>(null);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [caseFilter, setCaseFilter] = useState<CaseFilter>("attention");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [page, setPage] = useState(0);
  const [issuePage, setIssuePage] = useState(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [unitOpen, setUnitOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [coverageTab, setCoverageTab] = useState<CoverageTab>("pix");
  const [showAllUncompared, setShowAllUncompared] = useState(false);
  const catalogActive = useRef<AbortController | null>(null);
  const reviewActive = useRef<AbortController | null>(null);
  const unitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDefaultAdmin) return;
    const controller = new AbortController();
    catalogActive.current = controller;
    setCatalogBusy(true);
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
        if (!controller.signal.aborted) setCatalogBusy(false);
        if (catalogActive.current === controller) catalogActive.current = null;
      });
    return () => {
      controller.abort();
      if (catalogActive.current === controller) catalogActive.current = null;
    };
  }, [api, isDefaultAdmin]);

  const mapping = mappings.find(item => item.id === selected);

  useEffect(() => {
    if (!isDefaultAdmin || !mapping || !code || !date) {
      setResult(null);
      setReviewBusy(false);
      return;
    }
    const controller = new AbortController();
    reviewActive.current?.abort();
    reviewActive.current = controller;
    setReviewBusy(true);
    setError("");
    setResult(null);
    setPage(0);
    setIssuePage(0);
    setChannel("all");
    setKindFilter("all");
    setDetailKey(null);
    setShowAllUncompared(false);
    void api<DailySalesApiResult>("/api/financial/pdv-stone-review", {
      method: "POST",
      signal: controller.signal,
      json: { kioskId: mapping.kioskId, mappingId: mapping.id, stoneCode: code, referenceDate: date },
    }).then(data => {
      if (controller.signal.aborted) return;
      if (data.mappingId !== mapping.id || data.accountId !== mapping.accountId
        || data.scope.kioskId !== mapping.kioskId || data.scope.stoneCode !== code
        || data.scope.referenceDate !== date) {
        throw new AuthenticatedApiError("A resposta não corresponde à seleção. Recarregue os vínculos e consulte novamente.", 409, null);
      }
      setResult(data);
      setCaseFilter(data.review.status === "closed" ? "auto" : "attention");
      setCoverageTab(data.pix.status === "available" ? "issues" : "pix");
    }).catch(caught => {
      if (!controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível consultar. Tente novamente.");
    }).finally(() => {
      if (!controller.signal.aborted) setReviewBusy(false);
      if (reviewActive.current === controller) reviewActive.current = null;
    });
    return () => {
      controller.abort();
      if (reviewActive.current === controller) reviewActive.current = null;
    };
  }, [api, code, date, isDefaultAdmin, mapping?.accountId, mapping?.id, mapping?.kioskId, refreshVersion]);

  const allCases = result?.cases;
  const view = useMemo(() => filterCases(allCases ?? [], { channel, caseFilter, kind: kindFilter }), [allCases, channel, caseFilter, kindFilter]);
  const facts = useMemo(() => new Map<string, SalesMatchFact>([...(result?.pdvFacts ?? []), ...(result?.stoneSales ?? [])].map(fact => [fact.id, fact])), [result]);
  const { rows } = view;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const detailIndex = detailKey ? rows.findIndex(row => row.deterministicKey === detailKey) : -1;
  const detail = detailIndex >= 0 ? rows[detailIndex] : null;

  const moveDetail = (delta: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, detailIndex + delta));
    if (detailIndex < 0 || next === detailIndex) return;
    setDetailKey(rows[next].deterministicKey);
    setPage(Math.floor(next / PAGE_SIZE));
  };

  const moveDetailRef = useRef(moveDetail);
  moveDetailRef.current = moveDetail;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (unitOpen) setUnitOpen(false);
        else if (detailKey) setDetailKey(null);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!detailKey || target?.closest("input, select, textarea")) return;
      if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault(); moveDetailRef.current(1); }
      if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault(); moveDetailRef.current(-1); }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (unitOpen && unitRef.current && !unitRef.current.contains(event.target as Node)) setUnitOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [detailKey, unitOpen]);

  if (!isDefaultAdmin) {
    return <PageContainer surface>
      <div role="alert" className="mx-auto my-24 max-w-[420px] rounded-2xl border border-[#e9e5dc] bg-white px-[30px] py-7 text-center">
        <p className="text-[15px] font-extrabold">Consulta restrita à administração.</p>
        <p className="mt-1.5 text-[12.5px] text-[#7c8189]">Peça acesso a um administrador da conta para conferir vendas PDV × Stone.</p>
      </div>
    </PageContainer>;
  }

  const busy = catalogBusy || reviewBusy;
  const clear = () => {
    setResult(null);
    setError("");
    setPage(0);
    setIssuePage(0);
    setChannel("all");
    setCaseFilter("attention");
    setKindFilter("all");
    setDetailKey(null);
  };
  const load = async (next?: string) => {
    if (catalogActive.current) return;
    const controller = new AbortController();
    catalogActive.current = controller;
    setCatalogBusy(true);
    setError("");
    try {
      const data = await api<CatalogPage<MappingView>>(`/api/financial/stone-mappings?resource=mappings${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
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
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível consultar. Tente novamente.");
    } finally {
      if (!controller.signal.aborted) setCatalogBusy(false);
      if (catalogActive.current === controller) catalogActive.current = null;
    }
  };
  const changeDate = (next: string) => { setDate(next); clear(); };
  const nextDayDisabled = busy || !date || date >= yesterday;
  const goCoverage = (tab: CoverageTab) => {
    setCoverageTab(tab);
    window.setTimeout(() => document.getElementById("cobertura-fontes")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };
  const pickChannel = (value: ChannelFilter) => {
    const next = summarizeChannel(allCases ?? [], value);
    setChannel(value);
    setCaseFilter(next.attention ? "attention" : "all");
    setKindFilter("all");
    setPage(0);
    setDetailKey(null);
  };
  const pickCaseFilter = (value: CaseFilter) => { setCaseFilter(value); setKindFilter("all"); setPage(0); setDetailKey(null); };

  const pixPending = !!result && result.pix.status !== "available";
  const uncompared = result?.uncomparedPdvFacts ?? [];
  const uncomparedSum = uncompared.reduce((sum, fact) => sum + fact.grossAmountCents, 0);
  const totals = summarizeChannel(allCases ?? [], "all");
  const issues = result?.issues ?? [];
  const issuePages = Math.max(1, Math.ceil(issues.length / ISSUE_PAGE_SIZE));
  const currentIssuePage = Math.min(issuePage, issuePages - 1);
  const reviewStatus = result?.review.status;
  const verdictTone = reviewStatus === "closed" ? "ok" : reviewStatus === "awaiting_source" ? "warn" : "bad";
  const verdictTitle = reviewStatus === "closed" ? reviewStatuses.closed
    : totals.attention ? `${totals.attention} divergência(s) para revisar`
      : result ? reviewStatuses[result.review.status] : "";
  const mappingLabel = mapping ? `${mapping.kioskName} — ${mapping.accountName}` : "";
  const statusLabel = reviewBusy ? "Comparando…" : catalogBusy ? "Carregando vínculos…" : error ? "⚠ Falha na consulta"
    : result ? `✓ Atualizado ${new Date(result.collectedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
      : !mapping ? "Aguardando unidade" : !code ? "Aguardando StoneCode" : "Atualizando…";

  const coverageTabs: Array<{ id: CoverageTab; label: string; dot: boolean }> = [
    { id: "pix", label: "Fonte Pix", dot: pixPending },
    { id: "issues", label: `Apontamentos fora da comparação (${issues.length})`, dot: issues.length > 0 },
    { id: "events", label: `Eventos Stone originais (${result?.stoneEvents.length ?? 0})`, dot: false },
    { id: "limits", label: "Limitações", dot: false },
  ];

  return <PageContainer variant="wide" surface className="space-y-4 py-6">
    <PageHeader
      title="Conciliação de vendas"
      description="Comparação automática das vendas do PDV com as capturas da Stone, por unidade, dia e meio de pagamento."
      back={{ fallbackHref: "/dashboard/financial", parentLabel: "Financeiro" }}
      actions={<span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 text-xs font-bold text-sky-700">◉ Somente leitura</span>}
    />

    <div role="note" className="flex items-start gap-2.5 rounded-xl border border-[#d3ecfb] bg-sky-50 px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-sky-950">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">
        Pares individuais compatíveis e conjuntos diários com os mesmos valores e quantidades são conferidos automaticamente.
        {howOpen ? <> A tela abre nas divergências quando existem e nas conferidas quando o dia está íntegro; use <b>Todas</b> para inspecionar cada venda. Esta conferência não confirma recebimento no banco e não lança valores no financeiro.</>
          : " Esta conferência não confirma recebimento no banco."}
      </p>
      <button type="button" aria-expanded={howOpen} onClick={() => setHowOpen(value => !value)} className="shrink-0 text-xs font-bold text-sky-700">{howOpen ? "Menos" : "Como funciona"}</button>
    </div>

    <Panel className="p-4 sm:px-[18px]">
      <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div ref={unitRef} className="relative min-w-0">
          <p className={label}>Unidade / conta</p>
          <button type="button" aria-label="Vínculo oficial" aria-haspopup="listbox" aria-expanded={unitOpen} disabled={busy}
            onClick={() => setUnitOpen(value => !value)}
            className={cn(field, "flex items-center justify-between gap-2.5 text-left", unitOpen && "border-[#db2777] shadow-[0_0_0_3px_rgba(219,39,119,.12)]")}>
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className={cn("max-w-full truncate text-[13.5px]", mapping ? "font-bold" : "font-medium text-[#8a8f99]")}>
                {catalogBusy ? "Carregando vínculos…" : mapping ? mappingLabel : mappings.length ? "Selecione" : "Nenhum vínculo carregado"}
              </span>
              <span className="max-w-full truncate text-[11px] font-normal text-[#9a9ba1]">
                {mapping ? `${mapping.stoneCodes.length} StoneCode(s)` : `${mappings.length} vínculo(s) oficial(is)`}
              </span>
            </span>
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#9a9ba1]" />
          </button>
          {unitOpen && !busy ? <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-[14px] border border-[#e3ded3] bg-white shadow-[0_18px_40px_rgba(0,0,0,.14)]">
            <div className="flex items-center justify-between border-b border-[#f0ece4] px-3.5 pb-2 pt-2.5">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#9a9ba1]">Vínculos oficiais · {mappings.length}</span>
              <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs font-bold text-[#db2777]"><RefreshCw className="h-3 w-3" />{loaded ? "Atualizar vínculos" : "Carregar vínculos"}</button>
            </div>
            <div role="listbox" aria-label="Vínculos oficiais" className="max-h-[290px] overflow-auto p-1.5">
              {mappings.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === selected}
                onClick={() => { setSelected(item.id); setCode(item.stoneCodes[0] ?? ""); setUnitOpen(false); clear(); }}
                className={cn("flex w-full items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left hover:bg-[#fdf2f8]", item.id === selected && "bg-[#fdf2f8]")}>
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="text-[13px] font-bold">{item.kioskName}</span>
                  <span className="text-[11px] text-[#9a9ba1]">{item.accountName} · {item.stoneCodes.length} StoneCode(s)</span>
                </span>
                <Check aria-hidden="true" className={cn("h-4 w-4 text-[#db2777]", item.id === selected ? "opacity-100" : "opacity-0")} />
              </button>)}
            </div>
            {cursor ? <button type="button" onClick={() => void load(cursor)} className="h-10 w-full border-t border-[#f0ece4] bg-[#faf9f6] text-[12.5px] font-bold text-[#5f646c]">Mais vínculos</button> : null}
          </div> : null}
        </div>

        <div className="min-w-0">
          <p className={label}>StoneCode</p>
          <select aria-label="StoneCode" className={cn(field, "cursor-pointer")} disabled={busy || !mapping} value={code}
            onChange={event => { setCode(event.target.value); clear(); }}>
            <option value="">{mapping ? "Selecione" : "Selecione a unidade primeiro"}</option>
            {mapping?.stoneCodes.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div className="min-w-0">
          <p className={label}>Dia das vendas</p>
          <div className="flex h-[50px] overflow-hidden rounded-xl border border-[#e3ded3] bg-[#faf9f6]">
            <button type="button" aria-label="Dia anterior" disabled={busy || !date} onClick={() => changeDate(addDays(date, -1))}
              className="flex w-[38px] items-center justify-center border-r border-[#ebe7de] text-[#5f646c] hover:bg-[#f1eee7] disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
            <input type="date" aria-label="Dia das vendas" required disabled={busy} value={date} max={yesterday}
              onChange={event => changeDate(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-2.5 text-[13.5px] font-semibold outline-none" />
            <button type="button" aria-label="Próximo dia" disabled={nextDayDisabled} onClick={() => changeDate(addDays(date, 1))}
              className="flex w-[38px] items-center justify-center border-l border-[#ebe7de] text-[#5f646c] hover:bg-[#f1eee7] disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div role="status" aria-live="polite" className={cn("flex h-[50px] min-w-[200px] items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 text-[12.5px] font-bold",
          error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-[#ebe7de] bg-[#faf9f6]", !error && result ? "text-emerald-700" : !error && "text-[#8a8f99]")}>
          {busy ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-[#db2777]" /> : null}
          <span className="flex-1">{statusLabel}</span>
          {mapping && code && date ? <button type="button" aria-label="Reconsultar fontes" title="Reconsultar fontes" disabled={busy}
            onClick={() => setRefreshVersion(value => value + 1)} className="rounded-md p-1 text-[#5f646c] hover:bg-[#efebe3] disabled:opacity-40">
            <RefreshCw className={cn("h-3.5 w-3.5", reviewBusy && "animate-spin")} />
          </button> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-col justify-between gap-1 text-[11.5px] leading-normal sm:flex-row sm:gap-4">
        <span className="text-[#374151]">{mapping ? `Vigência do vínculo: ${formatDateKey(mapping.validFrom)} a ${mapping.validTo ? formatDateKey(mapping.validTo) : "sem data final"}.` : ""}</span>
        <span className="text-[#9a9ba1] sm:text-right">Um dia por consulta, até 500 cupons ou eventos por fonte. Arquivos Stone ficam disponíveis após as 05h do dia seguinte. A conferência é executada e registrada automaticamente.</span>
      </div>
    </Panel>

    {loaded && !mappings.length && !busy ? <div role="status" className="flex items-center justify-between gap-4 rounded-[14px] border border-amber-200 bg-amber-50 px-[18px] py-4">
      <span className="text-[13px] text-amber-900">Cadastre o vínculo oficial entre unidade, StoneCode e conta antes de consultar.</span>
      <button type="button" onClick={() => void load()} className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-amber-300 bg-white px-3 text-xs font-bold text-amber-800"><RefreshCw className="h-3.5 w-3.5" />Atualizar vínculos</button>
    </div> : null}

    {error && !busy ? <div role="alert" className="flex items-center justify-between gap-4 rounded-[14px] border border-rose-200 bg-rose-50 px-[18px] py-4">
      <div>
        <p className="text-[13.5px] font-extrabold text-rose-800">Não foi possível comparar</p>
        <p className="mt-[3px] text-[12.5px] text-rose-800">{error}</p>
      </div>
      {mapping && code && date ? <button type="button" onClick={() => setRefreshVersion(value => value + 1)} className="h-[34px] shrink-0 rounded-[10px] border border-rose-300 bg-white px-3 text-xs font-bold text-rose-700">Tentar novamente</button> : null}
    </div> : null}

    {!result && !error && !busy && mappings.length > 0 && !(mapping && code && date) ? <div className="rounded-2xl border-[1.5px] border-dashed border-[#dcd8cf] px-6 py-14 text-center">
      <p className="text-[14.5px] font-extrabold">{mapping ? "Selecione o StoneCode" : "Escolha o recorte da comparação"}</p>
      <p className="mt-[5px] text-[12.5px] text-[#8a8f99]">{mapping ? "A comparação carrega automaticamente assim que unidade, StoneCode e dia estiverem definidos." : "Selecione unidade / conta, StoneCode e dia das vendas. A comparação carrega automaticamente."}</p>
    </div> : null}

    {reviewBusy ? <div aria-hidden="true" className="grid animate-pulse gap-3 md:grid-cols-4">
      {[0, 1, 2, 3].map(index => <div key={index} className="h-[132px] rounded-2xl bg-[#ebe7de]" />)}
      <div className="h-[300px] rounded-2xl bg-[#ebe7de] md:col-span-4" />
    </div> : null}

    {result && !reviewBusy ? <section aria-label="Resultado da comparação" className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,1fr))]">
        <div className={cn("rounded-2xl border bg-white px-[18px] py-4 md:col-span-2 xl:col-span-1", verdictTone === "ok" ? "border-emerald-200" : verdictTone === "warn" ? "border-amber-200" : "border-rose-200")}>
          <div className="flex items-center gap-3">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] font-extrabold",
              verdictTone === "ok" ? "bg-emerald-50 text-emerald-700" : verdictTone === "warn" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700")}>{verdictTone === "ok" ? "✓" : verdictTone === "warn" ? "…" : "⚠"}</span>
            <div className="min-w-0">
              <p className="text-[17px] font-extrabold tracking-tight">{verdictTitle}</p>
              <p className="mt-0.5 text-[12.5px] text-[#5f646c]">{totals.auto} de {totals.list.length} casos conferidos automaticamente</p>
            </div>
          </div>
          <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-[#efe9e2]" aria-hidden="true">
            <div className="bg-emerald-500" style={{ width: `${totals.list.length ? totals.auto / totals.list.length * 100 : 0}%` }} />
            <div className="bg-rose-600" style={{ width: `${totals.list.length ? totals.attention / totals.list.length * 100 : 0}%` }} />
          </div>
          <div className="mt-[9px] flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#5f646c]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />{totals.auto} conferidas automaticamente</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-600" />{totals.attention} divergências</span>
            <button type="button" onClick={() => goCoverage("issues")} className="ml-auto font-bold text-amber-700">{issues.length} apontamento(s) de fonte →</button>
          </div>
          <p className="mt-2 text-[11px] text-[#9a9ba1]">Revisão {result.review.revision} · registrada em {new Date(result.review.reviewedAt).toLocaleString("pt-BR")}</p>
          {result.review.sourceChanged ? <p className="mt-1 text-[11px] font-medium text-amber-800">As fontes mudaram desde a revisão anterior; o estado foi recalculado.</p> : null}
        </div>
        <Metric title="Vendas PDV comparadas" value={money(totals.pdv)} detail={`${result.pdvFacts.length} pagamentos digitais no PDV`} />
        <Metric title="Capturas Stone" value={money(totals.stone)} detail={`${result.stoneSales.length} eventos comparáveis`} />
        <Metric title="Diferença Stone − PDV" value={money(totals.difference)} tone={totals.difference === 0 ? "ok" : "bad"}
          detail={totals.difference === 0 ? "Totais do dia batem" : "Totais do dia não batem"} />
      </div>

      <div>
        <div className="mb-[9px] mt-1 flex items-baseline gap-2.5">
          <span className={cn(label, "mb-0")}>Resumo por meio de pagamento</span>
          <span className="text-[11.5px] text-[#a3a099]">clique para filtrar a conferência</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(["all", ...channelOrder] as ChannelFilter[]).map(value => {
            const item = summarizeChannel(result.cases, value);
            const active = channel === value;
            const pixOff = value === "pix" && pixPending;
            const chip = pixOff ? { tone: "warn" as const, text: "Não comparado" }
              : item.attention ? { tone: "bad" as const, text: `${item.attention} divergência(s)` }
                : item.auto ? { tone: "ok" as const, text: `${item.auto} conferida(s)` }
                  : { tone: "muted" as const, text: "Sem vendas" };
            return <button key={value} type="button" aria-pressed={active} onClick={() => pickChannel(value)}
              className={cn("block w-full rounded-[14px] border bg-white px-[15px] py-[13px] text-left", active ? "border-[1.5px] border-[#db2777] shadow-[0_0_0_3px_rgba(219,39,119,.1)]" : "border-[#e9e5dc] hover:border-[#d8d2c6]")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold">{value === "all" ? "Todos os meios" : channels[value as ReconciliationSalesChannel]}</span>
                <StatusBadge tone={chip.tone}>{chip.text}</StatusBadge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5 text-left">
                {[["PDV", item.pdv], ["Stone", item.stone]].map(([title, amount]) => <div key={title}>
                  <p className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#9a9ba1]">{title}</p>
                  <p className={cn(mono, "mt-[3px] text-[13.5px] font-semibold")}>{money(amount as number)}</p>
                </div>)}
              </div>
              <div className="mt-[11px] flex items-center justify-between gap-2 border-t border-dashed border-[#ebe6dc] pt-[9px]">
                <span className="text-[11.5px] text-[#8a8f99]">{pixOff ? "Fora da comparação" : "Diferença"}</span>
                <span className={cn(mono, "text-[12.5px] font-bold", pixOff ? "text-amber-700" : item.difference ? "text-rose-700" : "text-emerald-700")}>
                  {pixOff ? `${uncompared.length} pag. · ${money(uncomparedSum)}` : money(item.difference)}
                </span>
              </div>
            </button>;
          })}
        </div>
      </div>

      <div className={cn("grid items-start gap-4", detail ? "xl:grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1")}>
        <Panel className="min-w-0 overflow-hidden">
          <div className="border-b border-[#f0ece4] px-[18px] pb-3.5 pt-4">
            <h3 className="text-base font-extrabold tracking-tight">Conferência do dia</h3>
            <p className="mt-1 text-xs text-[#7c8189]">
              {formatDateKey(result.scope.referenceDate)} · Filial PDV {result.pdvFilialId} · StoneCode {result.scope.stoneCode} · consulta {new Date(result.collectedAt).toLocaleString("pt-BR")}
            </p>
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
              <div role="group" aria-label="Filtrar situação" className="flex gap-[3px] rounded-[11px] bg-[#f4f2ec] p-[3px]">
                {([
                  { id: "attention", icon: "⚠ ", text: "Divergências", count: view.attention.length, tone: "bg-rose-50 text-rose-700" },
                  { id: "all", icon: "", text: "Todas", count: view.inChannel.length, tone: "bg-[#efebe3] text-[#5f646c]" },
                  { id: "auto", icon: "✓ ", text: "Conferidas", count: view.auto, tone: "bg-emerald-50 text-emerald-700" },
                ] as const).map(tab => <button key={tab.id} type="button" aria-pressed={caseFilter === tab.id} onClick={() => pickCaseFilter(tab.id)}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-bold", caseFilter === tab.id ? "bg-white text-[#1a1b1f] shadow-sm" : "text-[#7c8189]")}>
                  {tab.icon}{tab.text}
                  <span className={cn("inline-flex h-[18px] min-w-5 items-center justify-center rounded-full px-1.5 text-[10.5px]", tab.tone)}>{tab.count}</span>
                </button>)}
              </div>
              <div role="group" aria-label="Filtrar meio de pagamento" className="flex gap-0.5">
                {(["all", ...channelOrder] as ChannelFilter[]).map(value => <button key={value} type="button" aria-pressed={channel === value}
                  onClick={() => { setChannel(value); setKindFilter("all"); setPage(0); setDetailKey(null); }}
                  className={cn("h-[30px] rounded-lg px-[11px] text-[12.5px]", channel === value ? "bg-[#f1eee7] font-bold text-[#1a1b1f]" : "font-semibold text-[#7c8189]")}>
                  {value === "all" ? "Todos" : channels[value as ReconciliationSalesChannel]}
                </button>)}
              </div>
            </div>
            {caseFilter === "attention" && view.kindCounts.size > 1 ? <div role="group" aria-label="Filtrar tipo de divergência" className="mt-[11px] flex flex-wrap gap-1.5">
              {([["all", "Todos os tipos", view.attention.length], ...[...view.kindCounts].map(([kind, count]) => [kind, kindsShort[kind as keyof typeof kindsShort], count])] as Array<[KindFilter, string, number]>).map(([kind, text, count]) =>
                <button key={kind} type="button" aria-pressed={view.kind === kind} onClick={() => { setKindFilter(kind); setPage(0); setDetailKey(null); }}
                  className={cn("inline-flex h-[26px] items-center gap-[5px] whitespace-nowrap rounded-full border px-[11px] text-[11.5px] font-bold",
                    view.kind === kind ? "border-[#1a1b1f] bg-[#1a1b1f] text-white" : "border-[#e3ded3] bg-white text-[#4b5058]")}>
                  {text} <span className="opacity-60">{count}</span>
                </button>)}
            </div> : null}
          </div>

          {rows.length ? <>
            <div className="overflow-x-auto">
              <div role="table" aria-label="Comparação de pagamentos do PDV com capturas Stone">
                <div role="row" className={cn(rowGrid, "h-[34px] bg-[#faf9f6] text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#9a9ba1]")}>
                  <span role="columnheader">Hora</span><span role="columnheader">Meio</span><span role="columnheader">PDV</span><span role="columnheader">Stone</span>
                  <span role="columnheader" className="text-right">Diferença</span><span role="columnheader">Situação</span>
                </div>
                {rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((row: SuggestedSalesReconciliationCase) => {
                  const on = row.deterministicKey === detailKey;
                  const attention = isAttention(row);
                  return <div key={row.deterministicKey} role="row" tabIndex={0} aria-selected={on}
                    onClick={() => setDetailKey(on ? null : row.deterministicKey)}
                    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDetailKey(on ? null : row.deterministicKey); } }}
                    className={cn(rowGrid, "min-h-[58px] cursor-pointer border-t border-[#f4f1ea] py-[9px] hover:bg-[#fdf7fa]", on ? "bg-[#fdf2f8] shadow-[inset_3px_0_0_#db2777]" : "bg-white")}>
                    <span role="cell" className="font-mono text-xs text-[#7c8189]">{caseTime(row, facts)}</span>
                    <span role="cell" className="text-[12.5px] font-bold">{channels[row.channel]}</span>
                    <div role="cell" className="min-w-0"><SideCell ids={row.pdvFactIds} facts={facts} missing="sem pagamento no PDV" /></div>
                    <div role="cell" className="min-w-0"><SideCell ids={row.stoneSaleIds} facts={facts} missing="sem captura na Stone" /></div>
                    <span role="cell" className={cn(mono, "text-right text-[12.5px] font-bold", row.differenceAmountCents ? "text-rose-700" : "text-emerald-700")}>{money(row.differenceAmountCents)}</span>
                    <div role="cell" className="flex min-w-0 flex-col items-start gap-[3px]">
                      <StatusBadge tone={attention ? "bad" : "ok"}>{attention ? "⚠" : "✓"} {caseBadgeLabel(row)}</StatusBadge>
                      <span className="max-w-full truncate text-[11px] text-[#9a9ba1]">{bases[row.matchBasis]}</span>
                    </div>
                  </div>;
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0ece4] px-[18px] py-3">
              <span className="text-xs text-[#8a8f99]">{currentPage * PAGE_SIZE + 1}–{Math.min(rows.length, (currentPage + 1) * PAGE_SIZE)} de {rows.length}</span>
              <div className="flex items-center gap-2">
                <button type="button" className={pager} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
                <span className="text-xs font-semibold text-[#5f646c]">Página {currentPage + 1} de {pageCount}</span>
                <button type="button" className={pager} disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Próxima</button>
              </div>
            </div>
          </> : <div role="status" className="px-6 py-11 text-center">
            <p className="text-[13.5px] font-bold">
              {channel === "pix" && pixPending ? "Pix não foi comparado neste dia." : caseFilter === "attention" ? "Nenhuma divergência neste filtro." : "Nenhuma venda neste filtro."}
            </p>
            {channel === "pix" && pixPending ? <>
              <p className="mt-[5px] text-xs text-[#8a8f99]">{uncompared.length} pagamento(s) Pix do PDV ({money(uncomparedSum)}) aguardam o arquivo da fonte Pix.</p>
              <button type="button" onClick={() => goCoverage("pix")} className="mt-3.5 h-[34px] rounded-[10px] border border-[#e3ded3] bg-white px-3.5 text-xs font-bold text-[#374151]">Ver fonte Pix</button>
            </> : caseFilter === "attention" && view.auto ? <>
              <p className="mt-[5px] text-xs text-[#8a8f99]">Todas as vendas deste recorte foram conferidas automaticamente.</p>
              <button type="button" onClick={() => pickCaseFilter("auto")} className="mt-3.5 h-[34px] rounded-[10px] border border-[#e3ded3] bg-white px-3.5 text-xs font-bold text-[#374151]">Ver conferidas ({view.auto})</button>
            </> : null}
          </div>}
        </Panel>

        {detail ? <CaseDetailPanel row={detail} facts={facts} position={detailIndex} total={rows.length}
          onPrev={() => moveDetail(-1)} onNext={() => moveDetail(1)} onClose={() => setDetailKey(null)} /> : null}
      </div>

      <Panel className="scroll-mt-4 overflow-hidden" id="cobertura-fontes">
        <div className="px-[18px] pt-4">
          <h3 className="text-base font-extrabold tracking-tight">Cobertura e apontamentos das fontes</h3>
          <div role="tablist" className="mt-3 flex gap-0.5 overflow-x-auto border-b border-[#f0ece4]">
            {coverageTabs.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={coverageTab === tab.id} onClick={() => setCoverageTab(tab.id)}
              className={cn("-mb-px h-[38px] shrink-0 whitespace-nowrap border-b-2 px-[13px] text-[12.5px] font-bold", coverageTab === tab.id ? "border-[#db2777] text-[#1a1b1f]" : "border-transparent text-[#8a8f99]")}>
              {tab.label}{tab.dot ? <span className="ml-[7px] inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" /> : null}
            </button>)}
          </div>
        </div>
        <div className="px-[18px] pb-[18px] pt-4">
          {coverageTab === "pix" ? <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusBadge tone={pixPending ? "warn" : "ok"}>{pixPending ? "Pendente ou indisponível" : "Disponível no recorte"}</StatusBadge>
              <span className="text-[12.5px] text-[#4b5058]">
                Fonte: {pixSourceLabels[result.pix.status]}{result.pix.coverage === "partial" ? " · cobertura parcial" : result.pix.coverage === "complete" ? " · cobertura completa" : ""}
                {" · "}Arquivo: <span className="font-mono">{result.pix.fileId ?? "não configurado"}</span> · Registros excluídos: {result.pix.excludedCount}
              </span>
            </div>
            <p className="text-[12.5px] leading-[1.55] text-[#7c8189]">Os dados recebidos ficam armazenados no Coala; a tela não solicita novamente um arquivo já processado. Sem arquivo íntegro e vínculo por StoneCode, pagamentos Pix não são classificados como ausentes na Stone.</p>
            <p className={cn(label, "mb-0 mt-1")}>PDV não comparado ({uncompared.length}){uncompared.length ? ` · ${money(uncomparedSum)}` : ""}</p>
            {uncompared.length ? <div className="overflow-x-auto rounded-xl border border-[#efebe3]"><div className="min-w-[640px]">
              <div className="grid grid-cols-[80px_120px_minmax(0,1fr)_160px_120px] gap-3 bg-[#faf9f6] px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#9a9ba1]">
                <span>Hora</span><span>Cupom</span><span>ID da evidência</span><span>Situação</span><span className="text-right">Valor</span>
              </div>
              {(showAllUncompared ? uncompared : uncompared.slice(0, UNCOMPARED_PREVIEW)).map(fact => <div key={fact.id} className="grid grid-cols-[80px_120px_minmax(0,1fr)_160px_120px] items-center gap-3 border-t border-[#f4f1ea] px-3.5 py-2 text-xs">
                <span className="font-mono text-[#7c8189]">{new Date(fact.soldAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="font-semibold">{fact.couponId ? `Cupom ${fact.couponId}` : "—"}</span>
                <span className="truncate font-mono text-[11px] text-[#a3a099]">{fact.id}</span>
                <span className="text-[#5f646c]">{saleStatuses[fact.status]}</span>
                <span className="text-right font-mono font-semibold">{money(fact.grossAmountCents)}</span>
              </div>)}
              {uncompared.length > UNCOMPARED_PREVIEW ? <button type="button" onClick={() => setShowAllUncompared(value => !value)} className="h-[38px] w-full border-t border-[#f0ece4] bg-[#faf9f6] text-xs font-bold text-[#5f646c]">
                {showAllUncompared ? "Mostrar menos" : `Mostrar todos (${uncompared.length})`}
              </button> : null}
            </div></div> : null}
          </div> : null}

          {coverageTab === "issues" ? <div className="flex flex-col gap-1.5">
            {issues.slice(currentIssuePage * ISSUE_PAGE_SIZE, (currentIssuePage + 1) * ISSUE_PAGE_SIZE).map((issue, index) =>
              <div key={`${currentIssuePage}:${index}`} className="grid items-center gap-x-3 gap-y-1 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-[9px] text-[12.5px] text-amber-950 sm:grid-cols-[62px_minmax(0,260px)_minmax(0,1fr)]">
                <span className="rounded-md bg-amber-100 py-[3px] text-center text-[10px] font-extrabold tracking-[0.1em]">{issue.source.toUpperCase()}</span>
                <span className="break-all font-mono text-[11.5px]">{issue.reference}</span>
                <span>{issueReasons[issue.reason]}</span>
              </div>)}
            {issues.length > ISSUE_PAGE_SIZE ? <div className="mt-2 flex items-center gap-2.5">
              <button type="button" className={pager} disabled={currentIssuePage === 0} onClick={() => setIssuePage(currentIssuePage - 1)}>Apontamentos anteriores</button>
              <span className="text-xs font-semibold text-[#5f646c]">{currentIssuePage + 1} / {issuePages}</span>
              <button type="button" className={pager} disabled={currentIssuePage >= issuePages - 1} onClick={() => setIssuePage(currentIssuePage + 1)}>Mais apontamentos</button>
            </div> : null}
            {!issues.length ? <p className="text-[12.5px] text-[#8a8f99]">Nenhum apontamento fora da comparação.</p> : null}
          </div> : null}

          {coverageTab === "events" ? <>
            <p className="mb-2.5 text-[12.5px] text-[#7c8189]">Decimais originais da fonte, sem arredondamento.</p>
            <div className="max-h-[360px] overflow-auto rounded-xl border border-[#efebe3]"><div className="min-w-[760px]">
              <div className="sticky top-0 grid grid-cols-[170px_minmax(0,1fr)_130px_130px_minmax(0,1.2fr)] gap-3 bg-[#faf9f6] px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#9a9ba1]">
                <span>Seção</span><span>Transação</span><span className="text-right">Bruto original</span><span className="text-right">Cancelado original</span><span>Contadores</span>
              </div>
              {result.stoneEvents.map(event => <div key={`${event.sourceSection}:${event.transactionId}`} className="grid grid-cols-[170px_minmax(0,1fr)_130px_130px_minmax(0,1.2fr)] items-center gap-3 border-t border-[#f4f1ea] px-3.5 py-[7px] text-[11.5px]">
                <span className="text-[#5f646c]">{event.sourceSection}</span>
                <span className="break-all font-mono text-[#374151]">{event.transactionId}</span>
                <span className="text-right font-mono">{event.capturedAmount ?? "Não informado"}</span>
                <span className="text-right font-mono text-[#7c8189]">{event.canceledAmount ?? "Não informado"}</span>
                <span className="font-mono text-[11px] text-[#7c8189]">{Object.entries(event.events).map(([name, count]) => `${stoneEventLabels[name] ?? name}: ${count}`).join(" · ")}</span>
              </div>)}
            </div></div>
          </> : null}

          {coverageTab === "limits" ? <ul className="list-disc space-y-1.5 pl-[18px] text-[12.5px] leading-normal text-[#5f646c]">
            {result.limitations.map(text => <li key={text}>{text}</li>)}
          </ul> : null}
        </div>
      </Panel>
    </section> : null}
  </PageContainer>;
}
