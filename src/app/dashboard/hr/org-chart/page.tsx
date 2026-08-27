"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Search,
  Users,
  ChevronDown,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  GripVertical,
  X,
  Briefcase,
  ListChecks,
  Award,
  Pencil,
  Save,
  ShieldCheck,
  FileText,
  ClipboardCheck,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import { updateHrFunction, updateHrRole } from "@/features/hr/lib/client";
import {
  DEFAULT_ONBOARDING_DOCUMENTS,
  normalizeOnboardingDocumentTemplates,
  normalizeOnboardingStages,
} from "@/lib/recruitment-onboarding";
import { normalizeRecruitmentStages } from "@/lib/recruitment-pipeline";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type {
  CandidateStatus,
  HrFormQuestion,
  JobDepartment,
  JobFunction,
  JobRole,
  OnboardingDocumentTemplate,
  OnboardingStage,
  OnboardingStageId,
  RecruitmentStage,
  User,
} from "@/types";

interface OrgNode {
  role: JobRole;
  employees: User[];
  children: OrgNode[];
}

function buildTree(roles: JobRole[], allUsers: User[]): OrgNode[] {
  const nodesMap = new Map<string, OrgNode>();
  roles.forEach((role) => {
    nodesMap.set(role.id, {
      role,
      employees: allUsers.filter((u) => u.jobRoleId === role.id && u.isActive !== false),
      children: [],
    });
  });

  const roots: OrgNode[] = [];
  nodesMap.forEach((node) => {
    if (node.role.reportsTo && nodesMap.has(node.role.reportsTo)) {
      nodesMap.get(node.role.reportsTo)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function nodeMatchesSearch(node: OrgNode, search: string): boolean {
  const q = search.toLowerCase();
  if (node.role.name.toLowerCase().includes(q)) return true;
  if (node.role.publicTitle?.toLowerCase().includes(q)) return true;
  if (node.employees.some((e) => e.username.toLowerCase().includes(q))) return true;
  return node.children.some((c) => nodeMatchesSearch(c, search));
}

const STAGE_LABELS: Record<CandidateStatus, string> = {
  applied: "Inscrição",
  screening: "Triagem",
  interview: "Entrevista",
  technical_test: "Avaliação prática",
  offer: "Proposta",
  hired: "Contratação",
  rejected: "Reprovado",
  withdrawn: "Desistência",
  talent_pool: "Banco de talentos",
};

function stageModelDiffersFromDefault(stages: RecruitmentStage[]) {
  const defaults = normalizeRecruitmentStages(null);
  return stages.some((stage, index) => {
    const fallback = defaults[index];
    return !fallback ||
      stage.id !== fallback.id ||
      stage.label !== fallback.label ||
      stage.order !== fallback.order ||
      stage.required !== fallback.required ||
      stage.dueDays !== fallback.dueDays;
  });
}

function RecruitmentStageModelEditor({
  stages,
  onChange,
  accent = "indigo",
}: {
  stages: RecruitmentStage[];
  onChange: (stages: RecruitmentStage[]) => void;
  accent?: "indigo" | "sky";
}) {
  const accentClass = accent === "sky"
    ? "focus:border-sky-400 focus:ring-sky-100"
    : "focus:border-indigo-400 focus:ring-indigo-100";

  function updateStage(stageId: CandidateStatus, patch: Partial<RecruitmentStage>) {
    onChange(stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage));
  }

  function moveStage(stageId: CandidateStatus, direction: -1 | 1) {
    const index = stages.findIndex((stage) => stage.id === stageId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= stages.length) return;
    const next = [...stages];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    onChange(next.map((stage, stageIndex) => ({ ...stage, order: stageIndex })));
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-800">Modelo de etapas do recrutamento</p>
        <p className="mt-1 text-xs text-slate-500">Usado como base ao abrir vaga para este cargo ou função.</p>
      </div>
      <div className="space-y-2">
        {stages.map((stage, index) => (
          <div key={stage.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[2rem_1fr_7rem_8rem] md:items-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
              {index + 1}
            </div>
            <div>
              <input
                value={stage.label}
                onChange={(event) => updateStage(stage.id, { label: event.target.value })}
                className={`h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 ${accentClass}`}
              />
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{STAGE_LABELS[stage.id]}</p>
            </div>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Prazo</span>
              <input
                type="number"
                min="0"
                value={stage.dueDays ?? ""}
                onChange={(event) => updateStage(stage.id, { dueDays: event.target.value === "" ? null : Number(event.target.value) })}
                placeholder="dias"
                className={`h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 ${accentClass}`}
              />
            </label>
            <div className="flex justify-end gap-1">
              <button type="button" disabled={index === 0} onClick={() => moveStage(stage.id, -1)} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                Subir
              </button>
              <button type="button" disabled={index === stages.length - 1} onClick={() => moveStage(stage.id, 1)} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                Descer
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ONBOARDING_LABELS: Record<OnboardingStageId, string> = {
  documents: "Coleta",
  document_review: "Revisão",
  accountant: "Contador",
  signature_preparation: "Preparar assinatura",
  signature: "Assinatura",
  formalization_validation: "Validação",
  integration: "Acessos",
  probation: "Experiência",
  done: "Finalizado",
};

function OnboardingModelEditor({
  stages,
  documents,
  onStagesChange,
  onDocumentsChange,
  accent = "indigo",
}: {
  stages: OnboardingStage[];
  documents: OnboardingDocumentTemplate[];
  onStagesChange: (stages: OnboardingStage[]) => void;
  onDocumentsChange: (documents: OnboardingDocumentTemplate[]) => void;
  accent?: "indigo" | "sky";
}) {
  const accentClass = accent === "sky"
    ? "focus:border-sky-400 focus:ring-sky-100"
    : "focus:border-indigo-400 focus:ring-indigo-100";

  function updateStage(stageId: OnboardingStageId, patch: Partial<OnboardingStage>) {
    onStagesChange(stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage));
  }

  function updateDocument(documentId: string, patch: Partial<OnboardingDocumentTemplate>) {
    onDocumentsChange(documents.map((document) => document.id === documentId ? { ...document, ...patch } : document));
  }

  function addDocument() {
    const nextId = `documento_${Date.now().toString(36)}`;
    onDocumentsChange([
      ...documents,
      { id: nextId, label: "Novo documento", required: true, order: documents.length },
    ]);
  }

  function removeDocument(documentId: string) {
    onDocumentsChange(documents.filter((document) => document.id !== documentId).map((document, index) => ({ ...document, order: index })));
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-800">Modelo de integração</p>
        <p className="mt-1 text-xs text-slate-500">Define as etapas e documentos ao aprovar contratação.</p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {stages.map((stage) => (
          <div key={stage.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{ONBOARDING_LABELS[stage.id]}</p>
            <input
              value={stage.label}
              onChange={(event) => updateStage(stage.id, { label: event.target.value })}
              className={`mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 ${accentClass}`}
            />
            <label className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Prazo em dias
              <input
                type="number"
                min="0"
                value={stage.dueDays ?? ""}
                onChange={(event) => updateStage(stage.id, { dueDays: event.target.value === "" ? null : Number(event.target.value) })}
                className={`mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 ${accentClass}`}
              />
            </label>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-700">Documentos exigidos</p>
          <button type="button" onClick={addDocument} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-white">
            Adicionar
          </button>
        </div>
        <div className="space-y-2">
          {documents.map((document) => (
            <div key={document.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
              <input
                value={document.label}
                onChange={(event) => updateDocument(document.id, { label: event.target.value })}
                className={`h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 ${accentClass}`}
              />
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={document.required !== false}
                  onChange={(event) => updateDocument(document.id, { required: event.target.checked })}
                />
                Obrigatório
              </label>
              <button type="button" onClick={() => removeDocument(document.id)} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-red-50 hover:text-red-500">
                Remover
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type RecruitmentModelCarrier = {
  formQuestions?: HrFormQuestion[];
  pipelineStages?: RecruitmentStage[];
  onboardingStages?: OnboardingStage[];
  onboardingDocuments?: OnboardingDocumentTemplate[];
};

function getRecruitmentModelSummary(item: RecruitmentModelCarrier, options?: { useDefaultDocuments?: boolean }) {
  const questions = item.formQuestions ?? [];
  const visibleQuestions = questions.filter((question) => question.active !== false).length;
  const pipelineStages = normalizeRecruitmentStages(item.pipelineStages);
  const integrationStages = normalizeOnboardingStages(item.onboardingStages);
  const documentSource = item.onboardingDocuments?.length
    ? item.onboardingDocuments
    : options?.useDefaultDocuments
      ? DEFAULT_ONBOARDING_DOCUMENTS
      : [];
  const integrationDocuments = normalizeOnboardingDocumentTemplates(documentSource);

  return {
    questions: questions.length,
    visibleQuestions,
    pipelineStages: pipelineStages.length,
    integrationStages: integrationStages.length,
    integrationDocuments: integrationDocuments.length,
  };
}

function ModelSummaryCards({ summary }: { summary: ReturnType<typeof getRecruitmentModelSummary> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <FileText className="h-3.5 w-3.5" />
          <span>Formulário</span>
        </div>
        <p className="text-sm font-bold text-slate-900">
          {summary.visibleQuestions}/{summary.questions}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">campos visíveis</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <ListChecks className="h-3.5 w-3.5" />
          <span>Vaga</span>
        </div>
        <p className="text-sm font-bold text-slate-900">{summary.pipelineStages}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">etapas do Kanban</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <ClipboardCheck className="h-3.5 w-3.5" />
          <span>Integração</span>
        </div>
        <p className="text-sm font-bold text-slate-900">{summary.integrationDocuments}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{summary.integrationStages} etapas</p>
      </div>
    </div>
  );
}

// ─── Role Detail Modal ──────────────────────────────────────────────────────

function RoleDetailModal({
  role,
  employees,
  functions,
  canEdit,
  onEdit,
  onEditFunction,
  onClose,
}: {
  role: JobRole | null;
  employees: User[];
  functions: JobFunction[];
  canEdit: boolean;
  onEdit: (role: JobRole) => void;
  onEditFunction: (item: JobFunction) => void;
  onClose: () => void;
}) {
  if (!role) return null;
  const roleModelSummary = getRecruitmentModelSummary(role, { useDefaultDocuments: true });

  return (
    <Dialog open={!!role} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg border border-slate-200 bg-white text-slate-900">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900">{role.name}</DialogTitle>
              {role.publicTitle && (
                <p className="text-sm font-medium uppercase tracking-wider text-pink-500">{role.publicTitle}</p>
              )}
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => onEdit(role)}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="mt-2 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {role.description && (
            <p className="text-sm leading-relaxed text-slate-600">{role.description}</p>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">CBO do cargo</p>
            <p className={cn("mt-1 font-semibold", role.cbo ? "text-slate-900" : "text-amber-700")}>
              {role.cbo || "Não cadastrado — a geração de documentos trabalhistas será bloqueada."}
            </p>
          </div>

          {employees.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                <Users className="h-3 w-3" />
                <span>Colaboradores ({employees.length})</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {employees.map((emp) => (
                  <div key={emp.id} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1">
                    <div
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ backgroundColor: emp.color || "#4f46e5" }}
                    >
                      {emp.avatarUrl ? (
                        <img src={emp.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                      ) : (
                        emp.username.substring(0, 2).toUpperCase()
                      )}
                    </div>
                    <span className="text-xs text-slate-700">{emp.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {functions.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                <ShieldCheck className="h-3 w-3" />
                <span>Funções vinculadas ({functions.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {functions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => canEdit && onEditFunction(item)}
                    className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-default"
                    disabled={!canEdit}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                <FileText className="h-3 w-3" />
                <span>Modelos vinculados</span>
              </div>
              <a
                href="/dashboard/settings?department=pessoal&tab=recruitment"
                className="text-xs font-bold text-pink-600 hover:text-pink-500"
              >
                Gerenciar
              </a>
            </div>
            <ModelSummaryCards summary={roleModelSummary} />

            {functions.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Funções</p>
                {functions.map((item) => {
                  const summary = getRecruitmentModelSummary(item);
                  return (
                    <div key={item.id} className="rounded-xl border border-sky-100 bg-sky-50/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-sky-800">{item.name}</span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => onEditFunction(item)}
                            className="text-[11px] font-bold text-sky-700 hover:text-sky-600"
                          >
                            Editar
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-600">
                        <span className="rounded-full bg-white px-2 py-1 shadow-sm">{summary.visibleQuestions}/{summary.questions} campos</span>
                        <span className="rounded-full bg-white px-2 py-1 shadow-sm">{summary.pipelineStages} etapas</span>
                        <span className="rounded-full bg-white px-2 py-1 shadow-sm">{summary.integrationDocuments} docs</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {role.responsibilities && role.responsibilities.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                <Briefcase className="h-3 w-3" />
                <span>Responsabilidades</span>
              </div>
              <ul className="space-y-1">
                {role.responsibilities.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-0.5 text-indigo-500">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {role.requirements && role.requirements.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                <ListChecks className="h-3 w-3" />
                <span>Requisitos</span>
              </div>
              <ul className="space-y-1">
                {role.requirements.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-0.5 text-indigo-500">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {role.competencies && role.competencies.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                <Award className="h-3 w-3" />
                <span>Competências</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {role.competencies.map((c, i) => (
                  <span key={i} className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {role.salaryRange?.visible && (role.salaryRange.min || role.salaryRange.max) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">Faixa Salarial</p>
              <p className="font-semibold text-slate-900">
                {role.salaryRange.currency}{" "}
                {role.salaryRange.min?.toLocaleString("pt-BR")}
                {role.salaryRange.min && role.salaryRange.max ? " – " : ""}
                {role.salaryRange.max?.toLocaleString("pt-BR")}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Role Edit Modal ─────────────────────────────────────────────────────────

function RoleEditModal({
  role,
  roles,
  departments,
  profiles,
  saving,
  onClose,
  onSave,
}: {
  role: JobRole | null;
  roles: JobRole[];
  departments: JobDepartment[];
  profiles: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = React.useState({
    name: "",
    cbo: "",
    publicTitle: "",
    departmentId: "",
    parentId: "",
    defaultProfileId: "",
    loginRestricted: false,
    pipelineStages: normalizeRecruitmentStages(null),
    onboardingStages: normalizeOnboardingStages(null),
    onboardingDocuments: normalizeOnboardingDocumentTemplates(DEFAULT_ONBOARDING_DOCUMENTS),
    isActive: true,
  });

  React.useEffect(() => {
    if (!role) return;
    setValues({
      name: role.name ?? "",
      cbo: role.cbo ?? "",
      publicTitle: role.publicTitle ?? "",
      departmentId: role.departmentId ?? "",
      parentId: role.parentId ?? role.reportsTo ?? "",
      defaultProfileId: role.defaultProfileId ?? "",
      loginRestricted: role.loginRestricted ?? false,
      pipelineStages: normalizeRecruitmentStages(role.pipelineStages),
      onboardingStages: normalizeOnboardingStages(role.onboardingStages),
      onboardingDocuments: normalizeOnboardingDocumentTemplates(
        role.onboardingDocuments?.length ? role.onboardingDocuments : DEFAULT_ONBOARDING_DOCUMENTS
      ),
      isActive: role.isActive !== false,
    });
  }, [role]);

  if (!role) return null;

  const parentOptions = roles.filter((item) => item.id !== role.id);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const department = departments.find((item) => item.id === values.departmentId);
    await onSave({
      name: values.name.trim(),
      cbo: values.cbo.trim() || undefined,
      publicTitle: values.publicTitle.trim() || undefined,
      departmentId: values.departmentId || null,
      departmentName: department?.name ?? null,
      parentId: values.parentId || null,
      reportsTo: values.parentId || null,
      defaultProfileId: values.defaultProfileId || undefined,
      loginRestricted: values.loginRestricted,
      pipelineStages: values.pipelineStages.map((stage, index) => ({ ...stage, order: index })),
      onboardingStages: values.onboardingStages.map((stage, index) => ({ ...stage, order: index })),
      onboardingDocuments: values.onboardingDocuments.map((document, index) => ({ ...document, order: index })),
      isActive: values.isActive,
    });
  }

  return (
    <Dialog open={!!role} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl border border-slate-200 bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Editar cargo</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-semibold text-slate-700">Nome do cargo</span>
              <input
                value={values.name}
                onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                required
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-semibold text-slate-700">CBO do cargo</span>
              <input
                value={values.cbo}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                  const cbo = digits.length > 4
                    ? `${digits.slice(0, 4)}-${digits.slice(4)}`
                    : digits;
                  setValues((current) => ({ ...current, cbo }));
                }}
                inputMode="numeric"
                maxLength={7}
                pattern="\d{4}-\d{2}"
                placeholder="Ex.: 5134-15"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <span className="text-xs text-slate-500">
                Herdado por todas as funções vinculadas a este cargo e usado nos documentos.
              </span>
            </label>
          </div>

          <label className="block space-y-1.5 text-sm">
            <span className="font-semibold text-slate-700">Título público</span>
            <input
              value={values.publicTitle}
              onChange={(event) => setValues((current) => ({ ...current, publicTitle: event.target.value }))}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-semibold text-slate-700">Departamento</span>
              <select
                value={values.departmentId}
                onChange={(event) => setValues((current) => ({ ...current, departmentId: event.target.value }))}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-indigo-400"
              >
                <option value="">Sem departamento</option>
                {departments.filter((item) => item.isActive !== false).map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-semibold text-slate-700">Superior direto</span>
              <select
                value={values.parentId}
                onChange={(event) => setValues((current) => ({ ...current, parentId: event.target.value }))}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-indigo-400"
              >
                <option value="">Cargo raiz</option>
                {parentOptions.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-1.5 text-sm">
            <span className="font-semibold text-slate-700">Perfil de acesso padrão</span>
            <select
              value={values.defaultProfileId}
              onChange={(event) => setValues((current) => ({ ...current, defaultProfileId: event.target.value }))}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-indigo-400"
              required={values.isActive}
            >
              <option value="">Selecione um perfil</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <span className="text-xs text-slate-500">Obrigatório para cargos ativos. A função pode definir um perfil mais específico.</span>
          </label>

          <RecruitmentStageModelEditor
            stages={values.pipelineStages}
            onChange={(pipelineStages) => setValues((current) => ({ ...current, pipelineStages }))}
          />

          <OnboardingModelEditor
            stages={values.onboardingStages}
            documents={values.onboardingDocuments}
            onStagesChange={(onboardingStages) => setValues((current) => ({ ...current, onboardingStages }))}
            onDocumentsChange={(onboardingDocuments) => setValues((current) => ({ ...current, onboardingDocuments }))}
          />

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <span>
                <span className="block font-semibold text-slate-800">Login restrito por escala</span>
                <span className="text-xs text-slate-500">Aplica janela de acesso do DP.</span>
              </span>
              <input
                type="checkbox"
                checked={values.loginRestricted}
                onChange={(event) => setValues((current) => ({ ...current, loginRestricted: event.target.checked }))}
                className="h-5 w-5"
              />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <span>
                <span className="block font-semibold text-slate-800">Cargo ativo</span>
                <span className="text-xs text-slate-500">Aparece no cadastro e organograma.</span>
              </span>
              <input
                type="checkbox"
                checked={values.isActive}
                onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
                className="h-5 w-5"
              />
            </label>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-600 disabled:opacity-60">
              <Save className="h-4 w-4" />
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Function Edit Modal ─────────────────────────────────────────────────────

function FunctionEditModal({
  item,
  roles,
  departments,
  profiles,
  saving,
  onClose,
  onSave,
}: {
  item: JobFunction | null;
  roles: JobRole[];
  departments: JobDepartment[];
  profiles: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = React.useState({
    name: "",
    publicTitle: "",
    departmentId: "",
    defaultProfileId: "",
    compatibleRoleIds: [] as string[],
    pipelineStages: normalizeRecruitmentStages(null),
    onboardingStages: normalizeOnboardingStages(null),
    onboardingDocuments: [] as OnboardingDocumentTemplate[],
    isActive: true,
  });

  React.useEffect(() => {
    if (!item) return;
    setValues({
      name: item.name ?? "",
      publicTitle: item.publicTitle ?? "",
      departmentId: item.departmentId ?? "",
      defaultProfileId: item.defaultProfileId ?? "",
      compatibleRoleIds: item.compatibleRoleIds ?? [],
      pipelineStages: normalizeRecruitmentStages(item.pipelineStages),
      onboardingStages: normalizeOnboardingStages(item.onboardingStages),
      onboardingDocuments: normalizeOnboardingDocumentTemplates(item.onboardingDocuments ?? []),
      isActive: item.isActive !== false,
    });
  }, [item]);

  if (!item) return null;

  function toggleRole(roleId: string) {
    setValues((current) => ({
      ...current,
      compatibleRoleIds: current.compatibleRoleIds.includes(roleId)
        ? current.compatibleRoleIds.filter((id) => id !== roleId)
        : [...current.compatibleRoleIds, roleId],
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const department = departments.find((departmentItem) => departmentItem.id === values.departmentId);
    await onSave({
      name: values.name.trim(),
      publicTitle: values.publicTitle.trim() || undefined,
      departmentId: values.departmentId || null,
      departmentName: department?.name ?? null,
      compatibleRoleIds: values.compatibleRoleIds,
      defaultProfileId: values.defaultProfileId || undefined,
      pipelineStages: stageModelDiffersFromDefault(values.pipelineStages)
        ? values.pipelineStages.map((stage, index) => ({ ...stage, order: index }))
        : [],
      onboardingStages: values.onboardingStages.map((stage, index) => ({ ...stage, order: index })),
      onboardingDocuments: values.onboardingDocuments.map((document, index) => ({ ...document, order: index })),
      isActive: values.isActive,
    });
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl border border-slate-200 bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Editar função</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-semibold text-slate-700">Nome da função</span>
              <input value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" required />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-semibold text-slate-700">Título público</span>
              <input value={values.publicTitle} onChange={(event) => setValues((current) => ({ ...current, publicTitle: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-semibold text-slate-700">Departamento</span>
              <select value={values.departmentId} onChange={(event) => setValues((current) => ({ ...current, departmentId: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-sky-400">
                <option value="">Sem departamento</option>
                {departments.filter((department) => department.isActive !== false).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-semibold text-slate-700">Perfil de acesso padrão</span>
              <select value={values.defaultProfileId} onChange={(event) => setValues((current) => ({ ...current, defaultProfileId: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-sky-400">
                <option value="">Sem perfil automático</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">Cargos compatíveis</p>
            <div className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={values.compatibleRoleIds.includes(role.id)} onChange={() => toggleRole(role.id)} />
                  <span>{role.name}</span>
                </label>
              ))}
            </div>
          </div>

          <RecruitmentStageModelEditor
            stages={values.pipelineStages}
            accent="sky"
            onChange={(pipelineStages) => setValues((current) => ({ ...current, pipelineStages }))}
          />

          <OnboardingModelEditor
            stages={values.onboardingStages}
            documents={values.onboardingDocuments}
            accent="sky"
            onStagesChange={(onboardingStages) => setValues((current) => ({ ...current, onboardingStages }))}
            onDocumentsChange={(onboardingDocuments) => setValues((current) => ({ ...current, onboardingDocuments }))}
          />

          <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <span>
              <span className="block font-semibold text-slate-800">Função ativa</span>
              <span className="text-xs text-slate-500">Aparece no cadastro de colaboradores.</span>
            </span>
            <input type="checkbox" checked={values.isActive} onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))} className="h-5 w-5" />
          </label>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white hover:bg-sky-600 disabled:opacity-60">
              <Save className="h-4 w-4" />
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Draggable/Droppable Node Card ─────────────────────────────────────────

const FUNC_LIMIT = 4;

function DraggableDroppableCard({
  node,
  functions,
  usersByFunctionId,
  canDrag,
  onOpenModal,
  onEdit,
  onEditFunction,
  isDraggingOver,
  hasChildren,
  isExpanded,
  onToggle,
}: {
  node: OrgNode;
  functions: JobFunction[];
  usersByFunctionId: Map<string, User[]>;
  canDrag: boolean;
  onOpenModal: (node: OrgNode) => void;
  onEdit: (role: JobRole) => void;
  onEditFunction: (item: JobFunction) => void;
  isDraggingOver: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: node.role.id,
    disabled: !canDrag,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: node.role.id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const isDropTarget = isOver || isDraggingOver;
  const modelSummary = getRecruitmentModelSummary(node.role, { useDefaultDocuments: true });

  const employeeFunctions = (employee: User) =>
    functions.filter((item) => {
      if ((employee.jobFunctionIds ?? []).includes(item.id)) return true;
      if ((employee.jobFunctionNames ?? []).includes(item.name)) return true;
      return (usersByFunctionId.get(item.id) ?? []).some((user) => user.id === employee.id);
    });

  return (
    <div
      ref={(el) => { setDragRef(el); setDropRef(el); }}
      style={style}
      className={`group/card relative w-64 overflow-hidden rounded-xl border bg-white text-slate-950 shadow-md transition-shadow duration-200 ${
        isDropTarget
          ? "border-pink-500 ring-4 ring-pink-500/15"
          : "border-slate-200 hover:border-pink-300"
      }`}
    >
      <div className="h-2 bg-gradient-to-r from-pink-500 via-sky-400 to-emerald-400" />
      {canDrag && (
        <div
          {...listeners}
          {...attributes}
          className="absolute bottom-4 right-4 z-10 cursor-grab rounded-full bg-white p-2 text-slate-400 opacity-0 shadow-sm transition-opacity hover:text-slate-900 active:cursor-grabbing group-hover/card:opacity-100"
          title="Arrastar cargo"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      <div className="p-5">
        <div className="flex items-start gap-3">
          <button
            onClick={() => onOpenModal(node)}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-500 transition-colors hover:bg-pink-100"
          >
            <Briefcase className="h-5 w-5" />
          </button>
          <button className="min-w-0 flex-1 text-left" onClick={() => onOpenModal(node)}>
            <h3 className="text-[17px] font-black leading-tight text-slate-950">{node.role.name}</h3>
            <p className="mt-0.5 text-[11px] font-black uppercase tracking-[0.16em] text-pink-500">
              {node.role.publicTitle || "Cargo interno"}
            </p>
            {node.role.cbo ? (
              <p className="mt-1 text-[11px] font-semibold text-slate-500">CBO {node.role.cbo}</p>
            ) : null}
          </button>
          <div className="flex shrink-0 items-center gap-1">
            {hasChildren && (
              <button
                type="button"
                onClick={onToggle}
                className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-pink-50 hover:text-pink-500"
                title={isExpanded ? "Recolher filhos" : "Expandir filhos"}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            )}
            {canDrag && (
              <button
                type="button"
                onClick={() => onEdit(node.role)}
                className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-pink-50 hover:text-pink-600"
                title="Editar cargo"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1.5 rounded-2xl border border-slate-100 bg-white p-1.5 shadow-sm">
          <div className="rounded-xl bg-slate-50 px-2 py-2 text-center">
            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Campos</p>
            <p className="mt-0.5 text-xs font-black text-slate-800">{modelSummary.visibleQuestions}/{modelSummary.questions}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-2 py-2 text-center">
            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Etapas</p>
            <p className="mt-0.5 text-xs font-black text-slate-800">{modelSummary.pipelineStages}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-2 py-2 text-center">
            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Integração</p>
            <p className="mt-0.5 text-xs font-black text-slate-800">{modelSummary.integrationDocuments}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Colaboradores</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-black text-slate-700 shadow-sm">{node.employees.length}</span>
          </div>
          <div className="space-y-2">
            {node.employees.length > 0 ? (
              node.employees.map((emp) => {
                const assignedFunctions = employeeFunctions(emp);
                const hasFunction = assignedFunctions.length > 0;
                return (
                  <div
                    key={emp.id}
                    className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${
                      hasFunction ? "border border-sky-200 bg-white shadow-sm ring-2 ring-sky-100" : ""
                    }`}
                  >
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: emp.color || "#4f46e5" }}
                    >
                      {emp.avatarUrl ? (
                        <img src={emp.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                      ) : (
                        emp.username.substring(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-700">{emp.username}</span>
                      {hasFunction && (
                        <span className="block truncate text-[10px] font-black uppercase tracking-[0.12em] text-sky-600">
                          {assignedFunctions.map((item) => item.name).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex items-center gap-2 py-1 text-xs italic text-slate-400">
                <Users className="h-3 w-3" />
                <span>Vago</span>
              </div>
            )}
          </div>
        </div>

        {functions.length > 0 && (
          <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-600">Funções</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-black text-sky-700 shadow-sm">{functions.length}</span>
            </div>
            <div className="space-y-1.5">
              {functions.slice(0, FUNC_LIMIT).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => canDrag ? onEditFunction(item) : onOpenModal(node)}
                  className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-left text-[11px] font-black text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-50"
                >
                  {item.name}
                </button>
              ))}
              {functions.length > FUNC_LIMIT && (
                <button
                  type="button"
                  onClick={() => onOpenModal(node)}
                  className="w-full rounded-xl border border-dashed border-sky-200 px-3 py-2 text-center text-[11px] font-bold text-sky-500 transition-colors hover:border-sky-400 hover:bg-white hover:text-sky-700"
                >
                  +{functions.length - FUNC_LIMIT} mais · ver todas
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root Drop Zone ─────────────────────────────────────────────────────────

function RootDropZone({ visible }: { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "__root__" });
  if (!visible) return null;
  return (
    <div
      ref={setNodeRef}
      className={`mb-6 flex w-full items-center justify-center rounded-2xl border-2 border-dashed py-3 text-sm font-bold transition-all duration-200 ${
        isOver
          ? "border-pink-400 bg-pink-100 text-pink-700"
          : "border-slate-300 bg-white/60 text-slate-400"
      }`}
    >
      Soltar aqui para tornar cargo raiz (sem hierarquia superior)
    </div>
  );
}

// ─── Org Tree Node ──────────────────────────────────────────────────────────

function OrgTreeNode({
  node,
  expandedNodes,
  onToggle,
  search,
  canDrag,
  functionsByRoleId,
  usersByFunctionId,
  onOpenModal,
  onEdit,
  onEditFunction,
  activeId,
}: {
  node: OrgNode;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
  search: string;
  canDrag: boolean;
  functionsByRoleId: Map<string, JobFunction[]>;
  usersByFunctionId: Map<string, User[]>;
  onOpenModal: (node: OrgNode) => void;
  onEdit: (role: JobRole) => void;
  onEditFunction: (item: JobFunction) => void;
  activeId: string | null;
}) {
  const isExpanded = expandedNodes.has(node.role.id);
  const hasChildren = node.children.length > 0;

  if (search !== "" && !nodeMatchesSearch(node, search)) return null;

  return (
    <div className="flex flex-col items-center">
      <DraggableDroppableCard
        node={node}
        functions={functionsByRoleId.get(node.role.id) ?? []}
        usersByFunctionId={usersByFunctionId}
        canDrag={canDrag}
        onOpenModal={onOpenModal}
        onEdit={onEdit}
        onEditFunction={onEditFunction}
        isDraggingOver={false}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        onToggle={() => onToggle(node.role.id)}
      />

      {hasChildren && isExpanded && (
        <>
          <div className="h-5 w-px border-l-4 border-dotted border-pink-400/70" />
          <div className="relative flex gap-8">
            {node.children.length > 1 && (
              <div className="absolute left-6 right-6 top-0 border-t-4 border-dotted border-pink-400/60" />
            )}
            {node.children.map((child) => (
              <div key={child.role.id} className="flex flex-col items-center">
                <div className="h-5 w-px border-l-4 border-dotted border-pink-400/60" />
                <OrgTreeNode
                  node={child}
                  expandedNodes={expandedNodes}
                  onToggle={onToggle}
                  search={search}
                  canDrag={canDrag}
                  functionsByRoleId={functionsByRoleId}
                  usersByFunctionId={usersByFunctionId}
                  onOpenModal={onOpenModal}
                  onEdit={onEdit}
                  onEditFunction={onEditFunction}
                  activeId={activeId}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function OrgChartPage() {
  const { firebaseUser, users: allUsers } = useAuth();
  const { roles, departments, functions, access, loading, error, refresh } = useHrBootstrap();
  const { profiles } = useProfiles();

  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(0.62);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<OrgNode | null>(null);
  const [editingRole, setEditingRole] = useState<JobRole | null>(null);
  const [editingFunction, setEditingFunction] = useState<JobFunction | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const panStartRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);

  const canDrag = access.canManageCatalog;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const tree = useMemo(() => buildTree(roles, allUsers ?? []), [roles, allUsers]);

  React.useEffect(() => {
    if (tree.length > 0 && expandedNodes.size === 0) {
      setExpandedNodes(new Set(tree.map((n) => n.role.id)));
    }
  }, [tree]);

  const collectAllIds = useCallback((nodes: OrgNode[]): string[] => {
    const ids: string[] = [];
    function walk(list: OrgNode[]) {
      for (const n of list) {
        ids.push(n.role.id);
        walk(n.children);
      }
    }
    walk(nodes);
    return ids;
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandedNodes(new Set(collectAllIds(tree)));
  }, [tree, collectAllIds]);

  const handleCollapseAll = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.min(Math.max(z * factor, 0.4), 2));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const roleId = String(active.id);
    const newParentId = over.id === "__root__" ? null : String(over.id);

    setSaving(true);
    try {
      await updateHrRole(firebaseUser!, roleId, { reportsTo: newParentId });
      await refresh();
    } catch (err) {
      console.error("Falha ao atualizar hierarquia:", err);
    } finally {
      setSaving(false);
    }
  }, [firebaseUser, refresh]);

  const activeRole = useMemo(
    () => roles.find((r) => r.id === activeId) ?? null,
    [roles, activeId]
  );

  const selectedRoleFunctions = useMemo(() => {
    const roleId = selectedNode?.role.id;
    if (!roleId) return [];
    return functions.filter((item) => (item.compatibleRoleIds ?? []).includes(roleId));
  }, [functions, selectedNode]);

  const functionsByRoleId = useMemo(() => {
    const map = new Map<string, JobFunction[]>();
    for (const item of functions) {
      for (const roleId of item.compatibleRoleIds ?? []) {
        const bucket = map.get(roleId) ?? [];
        bucket.push(item);
        map.set(roleId, bucket);
      }
    }
    for (const bucket of map.values()) {
      bucket.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
    }
    return map;
  }, [functions]);

  const usersByFunctionId = useMemo(() => {
    const map = new Map<string, User[]>();
    const functionIdByName = new Map(
      functions.map((item) => [item.name.toLowerCase(), item.id])
    );

    for (const user of allUsers ?? []) {
      if (user.isActive === false) continue;

      for (const functionId of user.jobFunctionIds ?? []) {
        const bucket = map.get(functionId) ?? [];
        bucket.push(user);
        map.set(functionId, bucket);
      }

      for (const functionName of user.jobFunctionNames ?? []) {
        const functionId = functionIdByName.get(functionName.toLowerCase());
        if (!functionId || (user.jobFunctionIds ?? []).includes(functionId)) continue;
        const bucket = map.get(functionId) ?? [];
        bucket.push(user);
        map.set(functionId, bucket);
      }
    }

    for (const bucket of map.values()) {
      bucket.sort((left, right) => left.username.localeCompare(right.username, "pt-BR"));
    }

    return map;
  }, [allUsers, functions]);

  const handleSaveRole = useCallback(async (payload: Record<string, unknown>) => {
    if (!firebaseUser || !editingRole) return;
    setSaving(true);
    try {
      await updateHrRole(firebaseUser, editingRole.id, payload);
      setEditingRole(null);
      setSelectedNode(null);
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [editingRole, firebaseUser, refresh]);

  const handleSaveFunction = useCallback(async (payload: Record<string, unknown>) => {
    if (!firebaseUser || !editingFunction) return;
    setSaving(true);
    try {
      await updateHrFunction(firebaseUser, editingFunction.id, payload);
      setEditingFunction(null);
      setSelectedNode(null);
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [editingFunction, firebaseUser, refresh]);

  const resetView = useCallback(() => {
    setZoom(0.62);
    setPan({ x: 0, y: 0 });
  }, []);

  const handlePanPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activeId) return;
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;

    panStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [activeId, pan.x, pan.y]);

  const handlePanPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    setPan({
      x: start.panX + event.clientX - start.x,
      y: start.panY + event.clientY - start.y,
    });
  }, []);

  const handlePanPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (panStartRef.current?.pointerId === event.pointerId) {
      panStartRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-pink-500 border-t-transparent" />
          <p className="animate-pulse font-medium text-slate-500">Carregando organograma...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="personal-org-density flex h-full flex-col gap-2.5 bg-[#eef5f2] p-3 text-slate-950">
        {/* Header */}
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-2.5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-pink-500">Corporativo</p>
              <h1 className="mt-0.5 text-xl font-black uppercase leading-none tracking-tight text-slate-800">Organograma</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExpandAll}
                className="h-7 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-pink-600"
              >
                Expandir todos
              </button>
              <button
                type="button"
                onClick={handleCollapseAll}
                className="h-7 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-pink-600"
              >
                Recolher todos
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saving && (
              <span className="animate-pulse text-xs font-bold text-pink-500">Salvando...</span>
            )}

            <div className="group relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-pink-500" />
              <input
                type="text"
                placeholder="Buscar cargo ou colaborador..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-800 shadow-sm placeholder-slate-400 transition-all focus:border-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-100"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-800"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex h-8 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.15, 2))}
                className="rounded-md p-1.5 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-950"
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <span className="w-11 text-center text-xs font-bold tabular-nums text-slate-600">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
                className="rounded-md p-1.5 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-950"
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <div className="mx-1 my-1 w-px bg-slate-200" />
              <button
                onClick={resetView}
                className="rounded-md p-1.5 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-950"
                title="Centralizar"
              >
                <Maximize className="h-4 w-4" />
              </button>
            </div>

            {canDrag && (
              <div className="flex h-8 items-center gap-1 rounded-lg border border-pink-200 bg-pink-50 px-2.5 text-[11px] font-bold text-pink-600">
                <GripVertical className="h-3 w-3" />
                <span>Arrastar para reorganizar</span>
              </div>
            )}
          </div>
        </div>

        {/* Chart canvas */}
        <div
          className="flex-1 cursor-grab overflow-hidden rounded-xl border border-white bg-white/55 p-4 shadow-inner active:cursor-grabbing"
          onPointerDown={handlePanPointerDown}
          onPointerMove={handlePanPointerMove}
          onPointerUp={handlePanPointerEnd}
          onPointerCancel={handlePanPointerEnd}
          onWheel={handleWheel}
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top center",
              minWidth: "max-content",
            }}
          >
            <RootDropZone visible={canDrag && !!activeId} />
            <div className="flex justify-center gap-12">
              {tree.map((node) => (
                <OrgTreeNode
                  key={node.role.id}
                  node={node}
                  expandedNodes={expandedNodes}
                  onToggle={toggleExpand}
                  search={search}
                  canDrag={canDrag}
                  functionsByRoleId={functionsByRoleId}
                  usersByFunctionId={usersByFunctionId}
                  onOpenModal={setSelectedNode}
                  onEdit={setEditingRole}
                  onEditFunction={setEditingFunction}
                  activeId={activeId}
                />
              ))}
            </div>
            {tree.length === 0 && (
              <div className="py-16 text-center text-slate-400">
                <Users className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>Nenhum cargo cadastrado.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drag overlay — matches real card style */}
      <DragOverlay>
        {activeRole && (
          <div className="w-80 overflow-hidden rounded-[2rem] border border-pink-300 bg-white shadow-2xl ring-4 ring-pink-100/60">
            <div className="h-2 bg-gradient-to-r from-pink-500 via-sky-400 to-emerald-400" />
            <div className="flex items-center gap-3 p-5">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-500">
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-black text-slate-950">{activeRole.name}</h3>
                <p className="mt-0.5 text-xs font-black uppercase tracking-wider text-pink-500">{activeRole.publicTitle || "Cargo interno"}</p>
              </div>
            </div>
          </div>
        )}
      </DragOverlay>

      <RoleDetailModal
        role={selectedNode?.role ?? null}
        employees={selectedNode?.employees ?? []}
        functions={selectedRoleFunctions}
        canEdit={canDrag}
        onEdit={(role) => {
          setSelectedNode(null);
          setEditingRole(role);
        }}
        onEditFunction={(item) => {
          setSelectedNode(null);
          setEditingFunction(item);
        }}
        onClose={() => setSelectedNode(null)}
      />
      <RoleEditModal
        role={editingRole}
        roles={roles}
        departments={departments}
        profiles={profiles}
        saving={saving}
        onClose={() => setEditingRole(null)}
        onSave={handleSaveRole}
      />
      <FunctionEditModal
        item={editingFunction}
        roles={roles}
        departments={departments}
        profiles={profiles}
        saving={saving}
        onClose={() => setEditingFunction(null)}
        onSave={handleSaveFunction}
      />
    </DndContext>
  );
}
