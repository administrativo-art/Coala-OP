"use client";

import { Archive, ChevronDown, FolderOpen, Loader2, Plus, RefreshCw, Search } from "lucide-react";

import { applicableOnboardingDocuments } from "@/features/hr/onboarding/document-applicability";
import {
  ONBOARDING_HEALTH_META,
  onboardingProgress,
  resolveOnboardingOperationalStatus,
  type OnboardingHealth,
  type OnboardingSortMode,
} from "@/features/hr/onboarding/operational-status";
import type { OnboardingProcess, OnboardingStageId } from "@/types";

type ProcessStateFilter = "active" | "completed" | "cancelled";

type ProductionLineProps = {
  processes: OnboardingProcess[];
  now: number;
  processStateFilter: ProcessStateFilter;
  phaseFilter: string;
  healthFilter: "all" | OnboardingHealth;
  sortMode: OnboardingSortMode;
  search: string;
  canManage: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onProcessStateFilterChange: (value: ProcessStateFilter) => void;
  onPhaseFilterChange: (value: string) => void;
  onHealthFilterChange: (value: "all" | OnboardingHealth) => void;
  onSortModeChange: (value: OnboardingSortMode) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onOpen: (process: OnboardingProcess) => void;
  onNew: () => void;
  onLoadMore?: () => void;
};

type FunnelStage = {
  id: string;
  label: string;
  short: string;
  stageIds: OnboardingStageId[];
  filterId?: string;
};

const FUNNEL_STAGES: FunnelStage[] = [
  { id: "documents", label: "Dados, documentos e ASO", short: "Dados e ASO", stageIds: ["documents", "document_review"], filterId: "documents" },
  { id: "accountant", label: "Formalização com o contador", short: "Contador", stageIds: ["accountant"], filterId: "accountant" },
  { id: "signature", label: "Documentação admissional", short: "Documentos", stageIds: ["signature_preparation", "signature"], filterId: "signature_preparation" },
  { id: "validation", label: "Validação da formalização", short: "Validação", stageIds: ["formalization_validation"], filterId: "formalization_validation" },
  { id: "access", label: "Criação de usuário e integrações", short: "Acessos", stageIds: ["integration"], filterId: "integration" },
  { id: "experience", label: "Experiência e treinamento", short: "Experiência", stageIds: ["probation"], filterId: "probation" },
  { id: "done", label: "Integração finalizada", short: "Finalizado", stageIds: ["done"], filterId: "done" },
];

const ACCENT_COLORS = ["#df2f78", "#7c3aed", "#2563eb", "#008f83", "#d17400", "#c026d3"];

function candidateInitials(name?: string | null) {
  return (name ?? "IN")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "IN";
}

function profilePhotoUrl(process: OnboardingProcess) {
  return process.documents?.find((document) => (
    document.status === "approved"
    && (document.id === "profile_photo" || document.documentTypeCode === "PROFILE_PHOTO")
    && typeof document.fileUrl === "string"
    && document.fileUrl.trim().length > 0
  ))?.fileUrl?.trim() || null;
}

function dateOnly(value?: string | null) {
  const match = value?.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function startOfWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function dayDiff(left: Date, right: Date) {
  const leftUtc = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate());
  const rightUtc = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((leftUtc - rightUtc) / 86_400_000);
}

function formatDate(value?: string | null) {
  const date = dateOnly(value);
  return date ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "Sem data";
}

function admissionDeadline(value: string | null | undefined, now: Date) {
  const date = dateOnly(value);
  if (!date) return { label: "—", detail: "Sem data", tone: "text-slate-400" };
  const difference = dayDiff(date, now);
  if (difference < 0) return { label: `${Math.abs(difference)}d`, detail: "após previsão", tone: "text-rose-600" };
  if (difference === 0) return { label: "Hoje", detail: formatDate(value), tone: "text-rose-600" };
  if (difference === 1) return { label: "Amanhã", detail: formatDate(value), tone: "text-amber-600" };
  return { label: `${difference}d`, detail: formatDate(value), tone: difference <= 7 ? "text-amber-600" : "text-slate-700" };
}

function stageIndex(process: OnboardingProcess) {
  if (process.status === "completed" || process.currentStage === "done") return FUNNEL_STAGES.length - 1;
  const found = FUNNEL_STAGES.findIndex((stage) => stage.stageIds.includes(process.currentStage ?? "documents"));
  return found < 0 ? 0 : found;
}

function processDocuments(process: OnboardingProcess) {
  const documents = applicableOnboardingDocuments(process.documents ?? [], process.publicFormAnswers)
    .filter((document) => document.id !== "aso_admission" && document.documentTypeCode !== "ASO_ADMISSION");
  return {
    approved: documents.filter((document) => document.status === "approved").length,
    total: documents.length,
  };
}

type AdmissionGroup = {
  id: string;
  label: string;
  meta: string;
  badgeClass: string;
  processes: OnboardingProcess[];
};

function admissionGroups(processes: OnboardingProcess[], now: Date): AdmissionGroup[] {
  const currentWeek = startOfWeek(now);
  const definitions = [
    { id: "past", label: "Já admitidos", meta: "Data prevista já alcançada", badgeClass: "bg-rose-50 text-rose-700" },
    { id: "current", label: "Esta semana", meta: "Admissões desta semana", badgeClass: "bg-pink-50 text-pink-700" },
    { id: "next", label: "Próxima semana", meta: "Admissões da próxima semana", badgeClass: "bg-violet-50 text-violet-700" },
    { id: "two", label: "Em duas semanas", meta: "Admissões em duas semanas", badgeClass: "bg-blue-50 text-blue-700" },
    { id: "future", label: "Próximas admissões", meta: "Datas posteriores", badgeClass: "bg-emerald-50 text-emerald-700" },
    { id: "none", label: "Admissão sem data", meta: "Data precisa ser definida", badgeClass: "bg-amber-50 text-amber-700" },
  ] as const;
  const buckets = new Map(definitions.map((definition) => [definition.id, [] as OnboardingProcess[]]));
  for (const process of processes) {
    const admission = dateOnly(process.expectedAdmissionDate);
    if (!admission) {
      buckets.get("none")?.push(process);
      continue;
    }
    const weekDistance = Math.floor(dayDiff(startOfWeek(admission), currentWeek) / 7);
    if (weekDistance < 0 || dayDiff(admission, now) < 0) buckets.get("past")?.push(process);
    else if (weekDistance === 0) buckets.get("current")?.push(process);
    else if (weekDistance === 1) buckets.get("next")?.push(process);
    else if (weekDistance === 2) buckets.get("two")?.push(process);
    else buckets.get("future")?.push(process);
  }
  return definitions
    .map((definition) => ({ ...definition, processes: buckets.get(definition.id) ?? [] }))
    .filter((group) => group.processes.length > 0);
}

function responsibilityLabel(value: ReturnType<typeof resolveOnboardingOperationalStatus>["responsible"]) {
  if (value === "person") return "Pessoa";
  if (value === "third_party") return "Terceiro";
  if (value === "system") return "Sistema";
  if (value === "none") return "Concluído";
  return "RH";
}

export function OnboardingProductionLine({
  processes,
  now,
  processStateFilter,
  phaseFilter,
  healthFilter,
  sortMode,
  search,
  canManage,
  hasMore = false,
  loadingMore = false,
  onProcessStateFilterChange,
  onPhaseFilterChange,
  onHealthFilterChange,
  onSortModeChange,
  onSearchChange,
  onRefresh,
  onOpen,
  onNew,
  onLoadMore,
}: ProductionLineProps) {
  const nowDate = new Date(now);
  const groups = admissionGroups(processes, nowDate);
  const funnel = FUNNEL_STAGES.map((stage, index) => ({
    ...stage,
    index,
    count: processes.filter((process) => stageIndex(process) === index).length,
    attentionCount: processes.filter((process) => {
      if (stageIndex(process) !== index) return false;
      return ["overdue", "blocked", "hr_action"].includes(resolveOnboardingOperationalStatus(process, nowDate).health);
    }).length,
  }));
  const maxFunnelCount = Math.max(1, ...funnel.map((stage) => stage.count));
  const bottlenecks = [...funnel]
    .filter((stage) => stage.attentionCount > 0 && stage.id !== "done")
    .sort((left, right) => right.attentionCount - left.attentionCount || right.count - left.count)
    .slice(0, 2);

  return (
    <div className="min-w-0 space-y-4 text-slate-950">
      <header className="sticky top-[-1px] z-20 -mx-4 flex flex-wrap items-center gap-3 border-b border-[#e0dcd4] bg-[#f5f3ee]/95 px-4 py-3 backdrop-blur-xl md:-mx-8 md:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[#df2f78]">Pessoal</span>
          <span className="h-1 w-1 rounded-full bg-[#c9c3b8]" />
          <span className="text-[13px] font-bold text-[#57534a]">Integração</span>
        </div>
        <div className="flex-1" />
        {canManage ? (
          <a href="/dashboard/settings?department=pessoal&tab=recruitment&section=integration" className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#d8d3c9] bg-white px-3.5 text-xs font-bold text-[#44403a] hover:border-pink-300 hover:text-pink-700">
            <FolderOpen className="h-4 w-4" /> Modelos de integração
          </a>
        ) : null}
        {canManage ? (
          <button type="button" onClick={onNew} className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3.5 text-xs font-black text-white hover:bg-[#df2f78]">
            <Plus className="h-4 w-4" /> Nova integração
          </button>
        ) : null}
      </header>

      <div className="flex flex-wrap items-end justify-between gap-4 pt-1">
        <div>
          <h1 className="text-[28px] font-black tracking-[-0.035em] text-slate-950">Linha de produção</h1>
          <p className="mt-1 max-w-2xl text-[13px] font-medium leading-relaxed text-[#6b665c]">
            {processes.length} pessoa{processes.length === 1 ? "" : "s"} nesta visão. Dentro de cada semana, atrasos, bloqueios e ações do RH sobem automaticamente.
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2 lg:flex-none">
          <label className="relative min-w-[230px] flex-1 lg:w-[270px] lg:flex-none">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar candidato, cargo ou unidade…" className="h-10 w-full rounded-xl border border-[#dad5cb] bg-white pl-9 pr-3 text-xs font-medium outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100" />
          </label>
          <label className="relative">
            <select value={processStateFilter} onChange={(event) => onProcessStateFilterChange(event.target.value as ProcessStateFilter)} className="h-10 appearance-none rounded-xl border border-[#dad5cb] bg-white pl-3 pr-8 text-xs font-bold text-stone-600 outline-none">
              <option value="active">Em andamento</option>
              <option value="completed">Concluídas</option>
              <option value="cancelled">Encerradas</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          </label>
          <label className="relative">
            <select value={phaseFilter} onChange={(event) => onPhaseFilterChange(event.target.value)} className="h-10 appearance-none rounded-xl border border-[#dad5cb] bg-white pl-3 pr-8 text-xs font-bold text-stone-600 outline-none">
              <option value="all">Todas as fases</option>
              {FUNNEL_STAGES.filter((stage) => stage.filterId).map((stage) => <option key={stage.id} value={stage.filterId}>{stage.short}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          </label>
          {processStateFilter === "active" ? (
            <label className="relative">
              <select value={healthFilter} onChange={(event) => onHealthFilterChange(event.target.value as "all" | OnboardingHealth)} className="h-10 appearance-none rounded-xl border border-[#dad5cb] bg-white pl-3 pr-8 text-xs font-bold text-stone-600 outline-none">
                <option value="all">Todas as situações</option>
                <option value="overdue">Atrasados</option><option value="blocked">Bloqueados</option><option value="hr_action">Ação do RH</option><option value="waiting_person">Aguardando pessoa</option><option value="on_track">Em dia</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            </label>
          ) : null}
          <label className="relative">
            <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as OnboardingSortMode)} className="h-10 appearance-none rounded-xl border border-[#dad5cb] bg-white pl-3 pr-8 text-xs font-bold text-stone-600 outline-none">
              <option value="priority">Prioridade</option><option value="admission">Admissão</option><option value="stalled">Tempo parado</option><option value="name">Nome</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          </label>
          <button type="button" onClick={onRefresh} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dad5cb] bg-white text-stone-500 hover:bg-stone-50" aria-label="Atualizar integrações"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      <section className="rounded-[20px] border border-[#e2ded6] bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <p className="text-[10px] font-black uppercase tracking-[0.11em] text-[#8a857b]">Onde as pessoas estão paradas</p>
          <span className="flex-1" />
          <p className="text-[11.5px] font-bold text-[#df2f78]">
            {bottlenecks.length ? `${bottlenecks.length} gargalo${bottlenecks.length === 1 ? "" : "s"}: ${bottlenecks.map((stage) => stage.short.toLowerCase()).join(" e ")}` : "Nenhum gargalo nesta visão"}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
          {funnel.map((stage) => {
            const active = stage.filterId === phaseFilter;
            const isBottleneck = bottlenecks.some((item) => item.id === stage.id);
            return (
              <button key={stage.id} type="button" disabled={!stage.filterId} onClick={() => stage.filterId && onPhaseFilterChange(active ? "all" : stage.filterId)} className={`min-w-0 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:border-pink-300 ${active ? "border-pink-300 bg-pink-50" : isBottleneck ? "border-amber-200 bg-amber-50/60" : "border-[#e8e3db] bg-[#faf9f6]"} disabled:cursor-default`} title={`${stage.label}${stage.attentionCount ? ` · ${stage.attentionCount} com impedimento ou ação do RH` : ""}`}>
                <span className="font-mono text-[9.5px] font-bold text-stone-400">ETAPA {stage.index + 1}</span>
                <span className="mt-1 flex items-end gap-1.5"><span className={`text-2xl font-black tracking-[-0.04em] ${isBottleneck ? "text-amber-700" : active ? "text-pink-700" : "text-slate-950"}`}>{stage.count}</span><span className="pb-0.5 text-[10px] font-bold text-stone-400">pessoa{stage.count === 1 ? "" : "s"}</span></span>
                <span className="mt-1 block truncate text-[11px] font-bold text-stone-700">{stage.short}</span>
                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[#eeebe4]"><span className={`block h-full rounded-full ${isBottleneck ? "bg-amber-500" : active ? "bg-pink-600" : "bg-slate-400"}`} style={{ width: `${Math.max(stage.count ? 10 : 0, (stage.count / maxFunnelCount) * 100)}%` }} /></span>
              </button>
            );
          })}
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.id} className="space-y-2.5">
          <div className="flex items-center gap-3">
            <span className={`rounded-lg px-3 py-1.5 text-[10.5px] font-black uppercase tracking-[0.05em] ${group.badgeClass}`}>{group.label}</span>
            <span className="text-xs font-semibold text-stone-400">{group.processes.length} pessoa{group.processes.length === 1 ? "" : "s"} · {group.meta}</span>
            <span className="h-px flex-1 bg-[#e2ded6]" />
          </div>
          <div className="overflow-x-auto rounded-[18px] border border-[#e2ded6] bg-white shadow-sm">
            <div className="min-w-[930px]">
              {group.processes.map((process, processIndex) => {
                const operational = resolveOnboardingOperationalStatus(process, nowDate);
                const health = ONBOARDING_HEALTH_META[operational.health];
                const progress = onboardingProgress(process);
                const docs = processDocuments(process);
                const currentIndex = stageIndex(process);
                const deadline = admissionDeadline(process.expectedAdmissionDate, nowDate);
                const photo = profilePhotoUrl(process);
                const accent = ACCENT_COLORS[processes.findIndex((item) => item.id === process.id) % ACCENT_COLORS.length] ?? ACCENT_COLORS[0];
                return (
                  <button key={process.id} type="button" onClick={() => onOpen(process)} className={`grid w-full grid-cols-[minmax(210px,1.2fr)_minmax(320px,2fr)_minmax(220px,1.2fr)_96px] items-center gap-4 px-4 py-3.5 text-left transition hover:bg-[#fbfaf7] ${processIndex ? "border-t border-[#f3f1ec]" : ""}`}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl text-xs font-black text-white" style={{ backgroundColor: accent }}>
                        {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : candidateInitials(process.candidateName)}
                      </span>
                      <span className="min-w-0"><span className="block truncate text-[13.5px] font-bold tracking-[-0.01em]">{process.candidateName ?? "Pessoa sem nome"}</span><span className="mt-0.5 block truncate text-[11px] font-medium text-stone-400">{process.functionName ?? process.jobRoleName ?? "Função não informada"} · {process.unitName ?? "Unidade não informada"}</span></span>
                    </span>
                    <span className="min-w-0">
                      <span className="flex gap-1">{FUNNEL_STAGES.map((stage, index) => <span key={stage.id} className={`relative grid h-[22px] flex-1 place-items-center overflow-hidden rounded-md font-mono text-[9.5px] font-bold ${index < currentIndex ? "bg-emerald-100 text-emerald-700" : index === currentIndex ? "bg-pink-600 text-white" : "bg-stone-100 text-stone-400"}`}>{index + 1}{index === currentIndex && process.status !== "completed" ? <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse bg-gradient-to-r from-transparent via-white/50 to-transparent" /> : null}</span>)}</span>
                      <span className="mt-1.5 flex items-center gap-2"><span className={`truncate text-[11.5px] font-bold ${health.textClass}`}>{progress.label}</span><span className="h-1 w-1 rounded-full bg-stone-300" /><span className="text-[11px] font-semibold text-stone-400">{operational.daysInStage}d · {docs.approved}/{docs.total} docs</span></span>
                    </span>
                    <span className="min-w-0"><span className={`inline-flex rounded-lg border px-2.5 py-1 text-[9.5px] font-black uppercase tracking-[0.03em] ${health.badgeClass}`}>{health.label}</span><span className="mt-1 block line-clamp-2 text-xs font-semibold leading-snug text-stone-600">{operational.headline}</span><span className="mt-0.5 block text-[10px] font-bold text-stone-400">Responsável: {responsibilityLabel(operational.responsible)}</span></span>
                    <span className="text-right"><span className={`block font-mono text-sm font-bold ${deadline.tone}`}>{deadline.label}</span><span className="mt-0.5 block text-[10.5px] font-semibold text-stone-400">{deadline.detail}</span></span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ))}

      {hasMore && onLoadMore ? (
        <div className="flex justify-center pt-1">
          <button type="button" disabled={loadingMore} onClick={onLoadMore} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#d8d3c9] bg-white px-4 text-xs font-black text-stone-700 shadow-sm hover:border-pink-300 hover:text-pink-700 disabled:opacity-60">
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {loadingMore ? "Carregando…" : "Carregar mais integrações"}
          </button>
        </div>
      ) : null}

      {!processes.length ? (
        <div className="rounded-[20px] border border-dashed border-[#d8d3c9] bg-white px-6 py-14 text-center">
          <Archive className="mx-auto h-9 w-9 text-stone-300" />
          <p className="mt-3 text-sm font-black text-slate-800">Nenhuma integração nesta visão</p>
          <p className="mt-1 text-xs font-medium text-stone-500">Altere os filtros ou inicie uma nova integração.</p>
        </div>
      ) : null}
    </div>
  );
}
