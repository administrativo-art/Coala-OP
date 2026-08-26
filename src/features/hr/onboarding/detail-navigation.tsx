"use client";

import { ArrowRight, Check, GraduationCap, Milestone, ShieldCheck } from "lucide-react";

import type { OnboardingProcess, OnboardingStageId } from "@/types";

type PhaseId = OnboardingStageId | "training";

type DetailNavigationProps = {
  process: OnboardingProcess;
  activePhaseId: PhaseId | null;
  onSelect: (phase: PhaseId) => void;
};

type NavigationStage = {
  id: PhaseId;
  label: string;
  short: string;
  owner: string;
  focus: string;
};

const FORMALIZATION_STAGES: NavigationStage[] = [
  { id: "documents", label: "Dados, documentos e ASO", short: "Dados e ASO", owner: "Candidato + RH", focus: "Coleta dos dados, conferência documental e conclusão do ASO admissional." },
  { id: "accountant", label: "Formalização com o contador", short: "Contador", owner: "RH + Contador", focus: "Revisão do formulário, composição do pacote e retorno da Ficha de Registro." },
  { id: "signature_preparation", label: "Documentação admissional", short: "Documentos", owner: "RH + Candidato", focus: "Geração, revisão, assinatura e arquivamento dos documentos admissionais." },
  { id: "formalization_validation", label: "Validação da formalização", short: "Validação", owner: "RH", focus: "Definição de turno, benefícios, metas e regras operacionais." },
  { id: "integration", label: "Criação de usuário e integrações", short: "Acessos", owner: "RH + Liderança", focus: "Primeiro acesso, Bizneo, PDV Legal e demais integrações da rotina." },
];

const EXPERIENCE_STAGES: NavigationStage[] = [
  { id: "probation", label: "Avaliações de experiência", short: "Experiência", owner: "Liderança", focus: "Acompanhamento dos marcos de 30, 60 e 90 dias." },
  { id: "training", label: "Treinamento", short: "Treinamento", owner: "Liderança", focus: "Trilhas e atividades de capacitação dos primeiros dias." },
];

function normalizedPhase(value?: PhaseId | null): PhaseId {
  if (value === "document_review") return "documents";
  if (value === "signature") return "signature_preparation";
  if (value === "done") return "integration";
  return value ?? "documents";
}

function actualTarget(process: OnboardingProcess, value: PhaseId): PhaseId {
  if (value === "documents" && process.currentStage === "document_review") return "document_review";
  if (value === "signature_preparation" && process.currentStage === "signature") return "signature";
  return value;
}

export function OnboardingDetailNavigation({ process, activePhaseId, onSelect }: DetailNavigationProps) {
  const active = normalizedPhase(activePhaseId);
  const current = normalizedPhase(process.currentStage);
  const formalizationOpen = !EXPERIENCE_STAGES.some((stage) => stage.id === active);
  const currentIndex = process.status === "completed"
    ? FORMALIZATION_STAGES.length
    : FORMALIZATION_STAGES.findIndex((stage) => stage.id === current);
  const selectedStage = [...FORMALIZATION_STAGES, ...EXPERIENCE_STAGES].find((stage) => stage.id === active)
    ?? FORMALIZATION_STAGES[0];
  const selectedIndex = FORMALIZATION_STAGES.findIndex((stage) => stage.id === active);
  const selectedIsExperience = EXPERIENCE_STAGES.some((stage) => stage.id === active);
  const selectedState = selectedIsExperience
    ? process.status === "completed" ? "Disponível" : "Prévia"
    : selectedIndex < currentIndex ? "Concluída" : selectedIndex === currentIndex ? "Etapa atual" : "Etapa futura";
  const isPreview = selectedState === "Etapa futura" || selectedState === "Prévia";

  const renderTab = (stage: NavigationStage, index: number, experience = false) => {
    const selected = stage.id === active;
    const done = !experience && (process.status === "completed" || index < currentIndex);
    const currentStage = !experience && index === currentIndex;
    const availableExperience = experience && process.status === "completed";
    return (
      <button
        key={stage.id}
        type="button"
        onClick={() => onSelect(actualTarget(process, stage.id))}
        className={`min-w-[132px] flex-1 rounded-[13px] border-b-[3px] px-3.5 py-3 text-left transition ${
          selected
            ? "border-b-[#df2f78] bg-pink-50 text-pink-800"
            : done || availableExperience
              ? "border-b-emerald-500 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-50"
              : currentStage
                ? "border-b-[#df2f78] bg-pink-50/70 text-pink-800 hover:bg-pink-50"
                : "border-b-stone-200 bg-[#faf9f6] text-stone-500 hover:bg-stone-50"
        }`}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold opacity-70">0{index + 1}</span>
          <span className={`h-1.5 w-1.5 rounded-full ${done || availableExperience ? "bg-emerald-500" : currentStage || selected ? "bg-[#df2f78]" : "bg-stone-300"}`} />
        </span>
        <span className="mt-1.5 block text-[13px] font-black leading-snug tracking-[-0.01em]">{stage.short}</span>
        <span className="mt-1 block text-[10.5px] font-bold opacity-70">
          {done ? "Concluída" : currentStage ? "Etapa atual" : availableExperience ? "Disponível" : experience ? "Após a admissão" : "A seguir"}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {formalizationOpen ? (
          <section className="min-w-[720px] flex-1 rounded-[18px] border border-[#e2ded6] bg-white p-4 shadow-sm">
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <span className="h-6 w-1.5 rounded-full bg-[#df2f78]" />
              <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-[0.09em] text-stone-600">Formalização</span><span className="mt-0.5 block text-[11.5px] font-medium text-stone-500">Da coleta dos dados à criação dos acessos.</span></span>
              <span className="rounded-full bg-pink-50 px-2.5 py-1 text-[10px] font-black uppercase text-pink-700">Momento atual</span>
              <span className="font-mono text-[10px] font-bold text-stone-400">{Math.min(Math.max(currentIndex + 1, 1), FORMALIZATION_STAGES.length)}/{FORMALIZATION_STAGES.length}</span>
            </div>
            <div className="flex gap-1 overflow-x-auto">{FORMALIZATION_STAGES.map((stage, index) => renderTab(stage, index))}</div>
          </section>
        ) : (
          <button type="button" onClick={() => onSelect(actualTarget(process, current))} className="flex w-[90px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-2xl border border-[#e2ded6] bg-[#faf9f6] px-2 py-4 text-stone-600 hover:bg-white">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-4 w-4" /></span>
            <span className="text-[10px] font-black uppercase tracking-[0.09em] [writing-mode:vertical-rl] [transform:rotate(180deg)]">Formalização</span>
            <span className="font-mono text-[10px] font-bold">5/5</span>
          </button>
        )}

        <div className={`flex w-[74px] shrink-0 flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed px-2 text-center ${process.status === "completed" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-stone-300 bg-[#faf9f6] text-stone-400"}`}>
          <span className={`grid h-6 w-6 place-items-center rounded-full ${process.status === "completed" ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-500"}`}><Milestone className="h-3.5 w-3.5" /></span>
          <span className="text-[9px] font-black uppercase leading-tight tracking-[0.05em]">Marco da admissão</span>
        </div>

        {!formalizationOpen ? (
          <section className="min-w-[360px] flex-1 rounded-[18px] border border-violet-200 bg-white p-4 shadow-sm">
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5"><span className="h-6 w-1.5 rounded-full bg-violet-600" /><span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-[0.09em] text-stone-600">Experiência e treinamento</span><span className="mt-0.5 block text-[11.5px] font-medium text-stone-500">Acompanhamento posterior à formalização.</span></span><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black uppercase text-violet-700">Paralelo</span></div>
            <div className="flex gap-1">{EXPERIENCE_STAGES.map((stage, index) => renderTab(stage, index, true))}</div>
          </section>
        ) : (
          <button type="button" onClick={() => onSelect("probation")} className="flex w-[90px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-2xl border border-violet-200 bg-violet-50/40 px-2 py-4 text-violet-700 hover:bg-violet-50">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-600 text-white"><GraduationCap className="h-4 w-4" /></span>
            <span className="text-[10px] font-black uppercase tracking-[0.09em] [writing-mode:vertical-rl] [transform:rotate(180deg)]">Experiência</span>
            <span className="font-mono text-[10px] font-bold">2 trilhas</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#e2ded6] bg-white px-4 py-3 shadow-sm">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-950 font-mono text-sm font-bold text-white">
          {selectedIsExperience ? selectedStage.id === "probation" ? "6A" : "6B" : selectedIndex + 1}
        </span>
        <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="text-[15px] font-black tracking-[-0.02em]">{selectedStage.label}</span><span className={`rounded-lg px-2.5 py-1 text-[9.5px] font-black uppercase tracking-[0.05em] ${isPreview ? "bg-amber-50 text-amber-700" : selectedState === "Concluída" ? "bg-emerald-50 text-emerald-700" : "bg-pink-50 text-pink-700"}`}>{selectedState}</span><span className="text-[10px] font-black uppercase tracking-[0.05em] text-stone-400">{selectedStage.owner}</span></span><span className="mt-1 block text-xs font-medium text-stone-600">{selectedStage.focus}</span></span>
        <span className="flex-1" />
        {isPreview ? (
          <button type="button" onClick={() => onSelect(actualTarget(process, current))} className="inline-flex h-9 items-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-3 text-xs font-black text-pink-700 hover:bg-pink-100">
            Voltar à etapa atual <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-[11px] font-black text-white"><ShieldCheck className="h-4 w-4" />{selectedState === "Concluída" ? "Consulta auditável" : "Você está na etapa atual"}</span>
        )}
      </div>
    </div>
  );
}
