"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { format, differenceInDays, differenceInMonths, differenceInYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Globe2,
  IdCard,
  Loader2,
  Lock,
  MapPin,
  Menu,
  Pencil,
  Settings,
  Shirt,
  TrendingUp,
  Umbrella,
  UserX,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { BackButton } from "@/components/navigation/back-button";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { useProfiles } from "@/hooks/use-profiles";
import { createAuditLog } from "@/features/audit/client";
import type { DPVacationRecord, User } from "@/types";
import { CollaboratorUniforms } from "@/components/collaborator-uniforms";
import { useEmployeeProfile, useFieldMap } from "@/features/rh/hooks/useEmployeeProfile";
import { SectionEditModal } from "@/features/rh/components/SectionEditModal";
import type { EmployeeFieldValue, FieldMapEntry, FieldVisibility, NormalizedFieldVisibility, RhRole } from "@/types/rh";
import { canViewField, normalizeFieldVisibility } from "@/types/rh";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CYCLE_STATUS_CONFIG, getVacationCycleHistory, type VacationCycle } from "@/lib/utils/vacation-logic";
import { FieldValue } from "@/features/rh/components/FieldValue";
import { callOnFieldUpdate } from "@/features/rh/lib/rh-client";
import { DEFAULT_PROFILE_BLOCKS } from "@/features/rh/lib/default-field-map";
import {
  SYSTEM_BLOCK_KEYS,
  SYSTEM_FIELD_DEFAULTS,
  SYSTEM_FIELD_KEYS,
  SYSTEM_NAV_LINKS,
  defaultFieldLgpd,
  isSystemPanelProfileField,
  isSystemStaticField,
  systemField,
} from "@/features/hr/lib/collaborator-system-fields";
import {
  type AsoControlSummary,
  type AsoPanelRecord,
  asoRecordKey,
  asoStatus,
  asoTypeLabel,
} from "@/features/hr/lib/aso-control";
import {
  type ChildDraft,
  type FamilyDocumentStatus,
  type FamilySalaryControlSummary,
  buildFamilySalarySummary,
  childCountLabel,
  childDraftsFromRecords,
  childEntitlementEndsAt,
  childRecordsFromDrafts,
  childRecordsFromSource,
  countChildrenUnder14,
  dependentAge,
  familyDocPresent,
  familyDocStatusItems,
  familyRequiredDocs,
  resizeChildDrafts,
} from "@/features/hr/lib/family-salary";
import {
  type TransportVoucherStatus,
  defaultTransportVoucherReason,
  formatTransportVoucherAction,
  getTransportVoucherStatus,
  resolveTransportVoucherChange,
  transportVoucherStatusLabel,
} from "@/features/hr/lib/transport-voucher";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { JUST_CAUSE_TYPES, requiresTerminationSubtype } from "@/lib/hr/termination-options";
import {
  employmentRelationshipLabel,
  terminationCopyForRelationship,
  terminationReasonsForRelationship,
  type EmploymentTerminationReason,
} from "@/lib/hr/employment-relationship";

const DAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const FIELD_VISIBILITIES: NormalizedFieldVisibility[] = ["public", "restricted_partial", "restricted_total", "confidential"];
const FIELD_VISIBILITY_LABELS: Record<NormalizedFieldVisibility, string> = {
  public: "Sem restrição",
  restricted_partial: "Restrito parcial",
  restricted_total: "Restrito total",
  confidential: "Confidencial",
};

const FIELD_VISIBILITY_HELP: Record<NormalizedFieldVisibility, string> = {
  public: "Visível para todos os usuários que já têm acesso geral ao cadastro.",
  restricted_partial: "Visível para gestão, administração, colaboradora titular e liberações explícitas.",
  restricted_total: "Visível para gestão, administração e cargos, funções ou pessoas explicitamente liberados.",
  confidential: "Visível para administração/RH autorizado e liberações explícitas de alta confiança.",
};

const FIELD_VISIBILITY_TONE: Record<NormalizedFieldVisibility, string> = {
  public: "border-emerald-100 bg-emerald-50 text-emerald-700",
  restricted_partial: "border-sky-100 bg-sky-50 text-sky-700",
  restricted_total: "border-amber-100 bg-amber-50 text-amber-700",
  confidential: "border-rose-100 bg-rose-50 text-rose-700",
};

const AVATAR_COLORS = [
  "bg-[#f4a7d8]",
  "bg-[#a7c7e7]",
  "bg-[#b7d77a]",
  "bg-[#f6c453]",
  "bg-[#9ec5ab]",
  "bg-[#d7aefb]",
  "bg-[#f4a261]",
  "bg-[#86c5da]",
];

const VACATION_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pendente", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Aprovado", className: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Rejeitado", className: "bg-rose-100 text-rose-800" },
  PLANNED: { label: "Planejado", className: "bg-sky-100 text-sky-800" },
};

type TerminationPayload = {
  terminationReason: EmploymentTerminationReason;
  terminationCause?: string;
  terminationNotes?: string;
  terminationDate: string;
};

const RH_SECTION_LABELS: Record<string, string> = {
  identity: "Identificação",
  contact: "Contato",
  address: "Endereço",
  documents: "Documentos",
  employment: "Vínculo e trabalho",
  compensation: "Benefícios",
  banking: "Bancário",
  health: "Saúde - ASOs",
  emergency: "Contatos de emergência",
  uniforms: "Uniformes",
  onboarding: "Onboarding",
  diversity: "Diversidade",
  "Dados pessoais": "Dados pessoais",
  "Dados Pessoais": "Dados pessoais",
  "Dados pessoais e documentos": "Dados pessoais",
  "Dados Pessoais e Documentos": "Dados pessoais",
  "Documentos": "Documentos",
  "Dados contratuais": "Dados contratuais",
  "Dados Contratuais": "Dados contratuais",
  "Beneficios": "Benefícios",
  "Benefícios": "Benefícios",
  "Formacao Academica": "Formação acadêmica",
  "Formação acadêmica": "Formação acadêmica",
  "Contatos de Emergencia": "Contatos de emergência",
  "Contatos de emergência": "Contatos de emergência",
  "Inclusao & Diversidade": "Inclusão e diversidade",
  "Inclusão e diversidade": "Inclusão e diversidade",
  "Dependentes": "Salário-família",
  "Dependentes e salario familia": "Salário-família",
  "Dependentes e salário-família": "Salário-família",
  "Controle de ASOs": "Controle de ASOs",
  "Dados Bancarios": "Dados bancários",
  "Dados bancários": "Dados bancários",
  "Salario Familia": "Salário-família",
  "Salário-família": "Salário-família",
};

const MERGED_PERSONAL_DOCUMENTS_SECTION = "Dados pessoais";

const FIELD_LABEL_FIXES: Record<string, string> = {
  "GRAU DE INSTRUCAO": "Grau de instrução",
  "GRAU DE INSTRUÇÃO": "Grau de instrução",
  "INSTITUICAO": "Instituição",
  "INSTITUIÇÃO": "Instituição",
  "FORMACAO ACADEMICA": "Formação acadêmica",
  "FORMACAO ACADÊMICA": "Formação acadêmica",
  "EXP. - 1A AVALIACAO": "Fim do 1º período de experiência",
  "EXP. - 1ª AVALIACAO": "Fim do 1º período de experiência",
  "EXP. - 1ª AVALIAÇÃO": "Fim do 1º período de experiência",
  "EXP. - 2A AVALIACAO": "Fim do 2º período de experiência",
  "EXP. - 2ª AVALIACAO": "Fim do 2º período de experiência",
  "EXP. - 2ª AVALIAÇÃO": "Fim do 2º período de experiência",
  "CARGO / FUNCAO": "Cargo / função",
  "CARGO / FUNÇÃO": "Cargo / função",
  "RAZAO SOCIAL": "Razão social",
  "RAZÃO SOCIAL": "Razão social",
  "DATA DE NASCIMENTO": "Data de nascimento",
  "DATA DE CONCLUSAO": "Data de conclusão",
  "DATA DE CONCLUSÃO": "Data de conclusão",
  "NOME DA MAE": "Nome da mãe",
  "NOME DA MÃE": "Nome da mãe",
  "NUMERO": "Número",
  "ORIENTACAO SOCIAL": "Orientação sexual",
  "ORIENTAÇÃO SOCIAL": "Orientação sexual",
  "DEFICIENCIA": "Deficiência",
  "DEFICIÊNCIA": "Deficiência",
  "E PCD?": "É PCD?",
  "É PCD?": "É PCD?",
};

function fieldVisibilityIcon(visibility: FieldVisibility) {
  const normalized = normalizeFieldVisibility(visibility);
  if (normalized === "public") return Globe2;
  if (normalized === "restricted_partial") return Eye;
  if (normalized === "restricted_total") return Lock;
  return EyeOff;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  try {
    if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
      return (value as { toDate: () => Date }).toDate();
    }
    const parsed = new Date(value as string | number | Date);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

function fmtDate(value: unknown, pattern = "dd/MM/yyyy") {
  const date = toDate(value);
  if (!date) return "-";
  return format(date, pattern, { locale: ptBR });
}

function tenure(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  const years = differenceInYears(new Date(), date);
  const months = differenceInMonths(new Date(), date) % 12;
  if (years > 0) return `${years} ano${years > 1 ? "s" : ""}${months > 0 ? ` e ${months} mes${months > 1 ? "es" : ""}` : ""}`;
  const totalMonths = differenceInMonths(new Date(), date);
  return `${totalMonths} mes${totalMonths === 1 ? "" : "es"}`;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function avatarColor(name: string) {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

function displayName(name: string) {
  const lowercaseParticles = new Set(["da", "de", "do", "das", "dos", "e"]);
  return name
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .filter(Boolean)
    .map((part, index) => (
      index > 0 && lowercaseParticles.has(part)
        ? part
        : part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1)
    ))
    .join(" ");
}

function fieldHasValue(fv?: EmployeeFieldValue) {
  if (!fv) return false;
  if (typeof fv.value_text === "string") return fv.value_text.trim().length > 0;
  if (typeof fv.value_number === "number") return true;
  if (typeof fv.value_boolean === "boolean") return true;
  if (fv.value_date) return true;
  if (Array.isArray(fv.value_json)) return fv.value_json.length > 0;
  if (fv.value_json && typeof fv.value_json === "object") return Object.keys(fv.value_json).length > 0;
  return fv.value_json !== undefined && fv.value_json !== null;
}

function profileFieldValue(fv?: EmployeeFieldValue) {
  if (!fv) return undefined;
  if (typeof fv.value_boolean === "boolean") return fv.value_boolean;
  if (typeof fv.value_number === "number") return fv.value_number;
  if (typeof fv.value_text === "string") return fv.value_text;
  if (fv.value_date) return fv.value_date;
  if (fv.value_json !== undefined) return fv.value_json;
  return undefined;
}

function conditionalMatches(entry: FieldMapEntry, values: Record<string, EmployeeFieldValue>) {
  const rules = entry.conditionals?.filter((rule) => rule.kind === "show_if") ?? [];
  if (rules.length === 0) return true;
  return rules.every((rule) => {
    const value = profileFieldValue(values[rule.field]);
    if (rule.operator === "truthy") return Boolean(value);
    if (rule.operator === "eq") return value === rule.value;
    if (rule.operator === "neq") return value !== rule.value;
    return true;
  });
}

function isLegacyUniformField(key: string, entry: FieldMapEntry) {
  return key.startsWith("employee.uniform_") || entry.section.toLowerCase() === "uniforme";
}

function profileSectionDomId(section: string) {
  return `profile-section-${section
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function sectionDisplayLabel(section: string) {
  const normalized = section.replace(/\s*&\s*/g, " e ").trim();
  return RH_SECTION_LABELS[section]
    ?? RH_SECTION_LABELS[normalized]
    ?? RH_SECTION_LABELS[normalized.replace(/\b\w/g, (char) => char.toLocaleUpperCase("pt-BR"))]
    ?? normalized;
}

function fieldDisplayLabel(label: string) {
  const normalized = label
    .replace(/\s*&\s*/g, " e ")
    .replace(/\b1A\b/gi, "1ª")
    .replace(/\b2A\b/gi, "2ª")
    .trim();
  const key = normalized.toLocaleUpperCase("pt-BR");
  if (FIELD_LABEL_FIXES[key]) return FIELD_LABEL_FIXES[key];

  const hasLetters = /[A-ZÀ-Ú]/i.test(normalized);
  const isUpperCaseLabel = hasLetters && normalized === normalized.toLocaleUpperCase("pt-BR");
  if (!isUpperCaseLabel) return normalized;

  const lower = normalized.toLocaleLowerCase("pt-BR");
  return (lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1))
    .replace(/\bcpf\b/gi, "CPF")
    .replace(/\bpis\b/gi, "PIS")
    .replace(/\bctps\b/gi, "CTPS")
    .replace(/\bcnh\b/gi, "CNH")
    .replace(/\baso\b/gi, "ASO")
    .replace(/\buf\b/gi, "UF")
    .replace(/\bpcd\b/gi, "PCD");
}

function profileDisplaySection(section: string) {
  const label = sectionDisplayLabel(section);
  if (label === "Dados pessoais" || label === "Documentos" || label === "Dados pessoais e documentos") {
    return MERGED_PERSONAL_DOCUMENTS_SECTION;
  }
  return label;
}

function pdvRegistrationLabel(user: User) {
  const values = [
    user.registrationIdPdv,
    ...Object.values(user.pdvOperatorIds ?? {}).map((value) => String(value)),
  ]
    .map((value) => value?.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join(", ") || "-";
}

function Panel({ title, icon: Icon, children, className = "", action }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-[#dedfe4] bg-white shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e8ec] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#fff0f6] text-[#df2f78]">
            <Icon className="h-5 w-5" />
          </span>
          <h2 className="min-w-0 text-sm font-black leading-tight text-[#1d1d26]">{title}</h2>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const tones = {
    default: "bg-[#f3f3f5] text-[#6f6f7c]",
    good: "bg-[#eafaf2] text-[#008963]",
    warn: "bg-[#fff3c4] text-[#a35a00]",
    bad: "bg-[#ffe9ef] text-[#d9275f]",
  };
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${tones[tone]}`}>{children}</span>;
}

function FieldVisibilityButton({
  entry,
  disabled,
  saving,
  onChange,
}: {
  entry: FieldMapEntry;
  disabled?: boolean;
  saving?: boolean;
  onChange: (visibility: FieldVisibility) => void;
}) {
  const normalizedVisibility = normalizeFieldVisibility(entry.visibility);
  const Icon = fieldVisibilityIcon(normalizedVisibility);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || saving}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60 ${FIELD_VISIBILITY_TONE[normalizedVisibility]}`}
          title="Alterar visibilidade do campo"
        >
          <Icon className="h-3.5 w-3.5" />
          {saving ? "Salvando..." : FIELD_VISIBILITY_LABELS[normalizedVisibility]}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-lg p-2">
        <div className="mb-2 flex items-start gap-2 rounded-md bg-slate-50 p-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-slate-500 ring-1 ring-slate-200">
            <Eye className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-black text-slate-950">Visibilidade do campo</p>
            <p className="mt-0.5 text-[10px] font-semibold leading-4 text-slate-500">
              Essa alteração vale para este campo em todos os colaboradores.
            </p>
          </div>
        </div>
        <div className="space-y-1">
          {FIELD_VISIBILITIES.map((visibility) => {
            const OptionIcon = fieldVisibilityIcon(visibility);
            const selected = normalizedVisibility === visibility;
            return (
              <button
                key={visibility}
                type="button"
                disabled={disabled || saving || selected}
                onClick={() => onChange(visibility)}
                className={`flex w-full items-start gap-2 rounded-md border p-2 text-left transition ${
                  selected
                    ? FIELD_VISIBILITY_TONE[visibility]
                    : "border-slate-100 bg-white text-slate-700 hover:bg-slate-50"
                } disabled:cursor-not-allowed disabled:opacity-70`}
              >
                <OptionIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-xs font-black">{FIELD_VISIBILITY_LABELS[visibility]}</span>
                  <span className="mt-0.5 block text-[10px] font-semibold leading-4 opacity-75">{FIELD_VISIBILITY_HELP[visibility]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getVisibilitySummary(entries: FieldMapEntry[]) {
  const visibility = normalizeFieldVisibility(entries[0]?.visibility ?? "confidential");
  return {
    visibility,
    mixed: entries.some((entry) => normalizeFieldVisibility(entry.visibility) !== visibility),
  };
}

function CardVisibilityButton({
  visibility,
  mixed,
  disabled,
  saving,
  onChange,
}: {
  visibility: NormalizedFieldVisibility;
  mixed?: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: (visibility: FieldVisibility) => void;
}) {
  const normalizedVisibility = normalizeFieldVisibility(visibility);
  const Icon = mixed ? Eye : fieldVisibilityIcon(normalizedVisibility);
  const tone = mixed
    ? "border-slate-200 bg-slate-50 text-slate-600"
    : FIELD_VISIBILITY_TONE[normalizedVisibility];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || saving}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60 ${tone}`}
          title="Alterar visibilidade do card"
        >
          <Icon className="h-3.5 w-3.5" />
          {saving ? "Salvando..." : mixed ? "Visibilidade mista" : FIELD_VISIBILITY_LABELS[normalizedVisibility]}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-lg p-2">
        <div className="mb-2 flex items-start gap-2 rounded-md bg-slate-50 p-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-slate-500 ring-1 ring-slate-200">
            <Eye className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-black text-slate-950">Visibilidade do card</p>
            <p className="mt-0.5 text-[10px] font-semibold leading-4 text-slate-500">
              Aplica a mesma visibilidade a todos os campos deste card.
            </p>
          </div>
        </div>
        <div className="space-y-1">
          {FIELD_VISIBILITIES.map((option) => {
            const OptionIcon = fieldVisibilityIcon(option);
            const selected = !mixed && normalizedVisibility === option;
            return (
              <button
                key={option}
                type="button"
                disabled={disabled || saving || selected}
                onClick={() => onChange(option)}
                className={`flex w-full items-start gap-2 rounded-md border p-2 text-left transition ${
                  selected
                    ? FIELD_VISIBILITY_TONE[option]
                    : "border-slate-100 bg-white text-slate-700 hover:bg-slate-50"
                } disabled:cursor-not-allowed disabled:opacity-70`}
              >
                <OptionIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-xs font-black">{FIELD_VISIBILITY_LABELS[option]}</span>
                  <span className="mt-0.5 block text-[10px] font-semibold leading-4 opacity-75">{FIELD_VISIBILITY_HELP[option]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatVacationDate(value?: string) {
  if (!value) return "-";
  const parsed = toDate(`${value}T12:00:00`);
  return parsed ? format(parsed, "dd/MM/yyyy", { locale: ptBR }) : value;
}

function isDateInVacationAcquisitiveCycle(date: Date, cycle: VacationCycle) {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const start = new Date(cycle.acquisitivePeriod.start);
  const end = new Date(cycle.acquisitivePeriod.end);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return target >= start && target <= end;
}

function isOpenVacationConcessiveCycle(cycle: VacationCycle) {
  return cycle.status !== "GOZADO" && cycle.status !== "AQUISITIVO" && cycle.balance > 0;
}

function VacationRows({ vacations }: { vacations: DPVacationRecord[] }) {
  if (vacations.length === 0) {
    return <p className="rounded-2xl bg-[#f4f4f6] p-4 text-sm font-semibold text-[#777784]">Nenhum registro neste ciclo.</p>;
  }

  return (
    <div className="space-y-2">
      {vacations.slice(0, 5).map((vacation) => {
        const status = VACATION_STATUS[vacation.status] ?? { label: vacation.status, className: "bg-slate-100 text-slate-700" };
        return (
          <div key={vacation.id} className="rounded-2xl border border-[#ececf0] bg-[#fbfbfc] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black text-[#25231f]">
                  {vacation.recordType === "gozo" ? "Gozo" : "Venda"} - {vacation.days} dia{vacation.days === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-[#817762]">
                  {formatVacationDate(vacation.startDate)} {vacation.endDate ? `até ${formatVacationDate(vacation.endDate)}` : ""}
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-black ${status.className}`}>{status.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VacationCycleOverview({
  admissionDate,
  cycle,
  acquisitionCycle,
  overdueCycles,
}: {
  admissionDate: Date | null;
  cycle: VacationCycle | null;
  acquisitionCycle: VacationCycle | null;
  overdueCycles: VacationCycle[];
}) {
  if (!admissionDate) {
    return (
      <div className="mb-4 rounded-2xl bg-[#f4f4f6] p-4 text-sm font-semibold text-[#777784]">
        Informe a data de admissão para calcular o ciclo de férias.
      </div>
    );
  }

  if (!cycle) return null;

  const status = CYCLE_STATUS_CONFIG[cycle.status];
  const today = new Date();
  const isAcquisitive = cycle.status === "AQUISITIVO";
  const progressStart = isAcquisitive ? cycle.acquisitivePeriod.start : cycle.concessivePeriod.start;
  const progressEnd = isAcquisitive ? cycle.acquisitivePeriod.end : cycle.concessivePeriod.end;
  const totalDays = Math.max(differenceInDays(progressEnd, progressStart), 1);
  const elapsedDays = Math.max(differenceInDays(today, progressStart), 0);
  const progress = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  const periodLabel = isAcquisitive ? "Ciclo de aquisição" : "Período de gozo";
  const periodStart = isAcquisitive ? cycle.acquisitivePeriod.start : cycle.concessivePeriod.start;
  const periodEnd = isAcquisitive ? cycle.acquisitivePeriod.end : cycle.concessivePeriod.end;

  return (
    <div className="mb-4 space-y-3">
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-slate-400">{periodLabel}</p>
            <p className="mt-1 text-sm font-black text-slate-950">
              {format(periodStart, "dd/MM/yyyy", { locale: ptBR })} - {format(periodEnd, "dd/MM/yyyy", { locale: ptBR })}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-black ${status.bg} ${status.text}`}>
            {status.label}
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-pink-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-3">
          <span>{isAcquisitive ? "Progresso da aquisição" : "Prazo de gozo"}: {progress}%</span>
          <span>Saldo: {cycle.balance}d</span>
          <span>
            {isAcquisitive
              ? `Início do concessivo: ${format(cycle.concessivePeriod.start, "dd/MM/yyyy", { locale: ptBR })}`
              : `Aquisição: ${format(cycle.acquisitivePeriod.start, "dd/MM/yyyy", { locale: ptBR })} - ${format(cycle.acquisitivePeriod.end, "dd/MM/yyyy", { locale: ptBR })}`}
          </span>
        </div>
      </div>
      {!isAcquisitive && acquisitionCycle ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-3 text-xs font-semibold text-slate-500">
          <span className="font-black uppercase text-slate-400">Aquisição atual: </span>
          {format(acquisitionCycle.acquisitivePeriod.start, "dd/MM/yyyy", { locale: ptBR })} - {format(acquisitionCycle.acquisitivePeriod.end, "dd/MM/yyyy", { locale: ptBR })}
        </div>
      ) : null}
      {overdueCycles.length > 0 ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm">
          <p className="font-black text-rose-800">
            {overdueCycles.length === 1 ? "Há 1 ciclo vencido" : `Há ${overdueCycles.length} ciclos vencidos`}
          </p>
          <p className="mt-1 text-xs font-semibold text-rose-700">
            Existe saldo de férias que já deveria ter sido gozado.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {overdueCycles.slice(0, 2).map((item) => (
              <div key={item.id} className="rounded-xl bg-white/75 p-3 text-xs font-bold text-rose-800">
                <p>
                  Ciclo {format(item.acquisitivePeriod.start, "dd/MM/yyyy", { locale: ptBR })} - {format(item.acquisitivePeriod.end, "dd/MM/yyyy", { locale: ptBR })}
                </p>
                <p className="mt-1 text-rose-600">Saldo vencido: {item.balance}d</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fieldJsonValue(fv?: EmployeeFieldValue): unknown {
  return fv?.value_json;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function profileJson<T>(fieldValues: Record<string, EmployeeFieldValue>, key: string): T | null {
  const raw = fieldJsonValue(fieldValues[key]);
  return isObjectRecord(raw) ? raw as T : null;
}

function fieldDateIso(fv?: EmployeeFieldValue) {
  const raw = fv?.value_date ?? fv?.value_text;
  if (!raw) return null;
  const value = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
  const date = toDate(value);
  return date ? format(date, "yyyy-MM-dd") : null;
}

function fieldTextLabel(fv?: EmployeeFieldValue) {
  if (!fv) return null;
  if (typeof fv.value_text === "string" && fv.value_text.trim()) return fv.value_text.trim();
  if (typeof fv.value_number === "number") return String(fv.value_number);
  if (typeof fv.value_boolean === "boolean") return fv.value_boolean ? "Sim" : "Não";
  if (Array.isArray(fv.value_json)) return fv.value_json.filter(Boolean).join(", ") || null;
  if (typeof fv.value_json === "string" && fv.value_json.trim()) return fv.value_json.trim();
  return null;
}

function formatIsoDate(value?: string | null) {
  if (!value) return "-";
  return formatVacationDate(value);
}

function dateDistanceLabel(value?: string | null) {
  if (!value) return "";
  const target = toDate(`${value}T12:00:00`);
  if (!target) return "";
  const diff = differenceInDays(target, new Date());
  if (diff < 0) return `${Math.abs(diff)}d em atraso`;
  if (diff === 0) return "vence hoje";
  return `em ${diff}d`;
}

function childRecordsFromProfile(fieldValues: Record<string, EmployeeFieldValue>, summary: FamilySalaryControlSummary | null) {
  const rawChildren = fieldValues["employee.children"]?.value_json;
  const source = Array.isArray(rawChildren) ? rawChildren : summary?.dependents ?? [];
  return childRecordsFromSource(source);
}

function familyDocumentStatusClassName(status: FamilyDocumentStatus) {
  if (status === "Enviada") return "bg-emerald-50 text-emerald-700";
  if (status === "Pendente") return "bg-amber-50 text-amber-700";
  return "bg-white text-[#777784] ring-1 ring-[#e8e8ec]";
}

function EmployeeAsoControlPanel({
  employeeId,
  reloadKey,
  action,
}: {
  employeeId: string;
  reloadKey?: number;
  action?: React.ReactNode;
}) {
  const profileState = useEmployeeProfile(employeeId, reloadKey);

  if (profileState.status === "idle" || profileState.status === "loading") {
    return (
      <Panel title="Controle de ASOs" icon={FileText} action={action}>
        <div className="h-36 animate-pulse rounded-2xl bg-slate-100" />
      </Panel>
    );
  }

  const summary = profileState.status === "error"
    ? null
    : profileJson<AsoControlSummary>(profileState.data.fieldValues, SYSTEM_FIELD_KEYS.asoSummary);
  const profileFieldValues: Record<string, EmployeeFieldValue> = profileState.status === "error" ? {} : profileState.data.fieldValues;
  const summaryRecords: AsoPanelRecord[] = (summary?.records ?? []).map((record) => ({ ...record, source: "summary" }));
  const summaryRecordKeys = new Set(summaryRecords.map(asoRecordKey));
  const legacyRecords: AsoPanelRecord[] = [
    { key: "employee.aso_admission_date", type: "admission" },
    { key: "employee.aso_dismissal_date", type: "dismissal" },
    { key: "employee.aso_periodic_1", type: "periodic" },
    { key: "employee.aso_periodic_2", type: "periodic" },
  ].flatMap(({ key, type }) => {
    const examDate = fieldDateIso(profileFieldValues[key]);
    if (!examDate) return [];
    const record = { type, examDate, source: "legacy_field" as const };
    return summaryRecordKeys.has(asoRecordKey(record)) ? [] : [record];
  });
  const status = asoStatus(summary, legacyRecords.some((record) => record.type === "admission"));
  const records = [...summaryRecords, ...legacyRecords].slice(0, 5);

  return (
    <Panel title="Controle de ASOs" icon={FileText} action={action}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-4">
          <div>
            <p className="text-sm font-black text-[#1d1d26]">Prazos ocupacionais</p>
            <p className="mt-1 text-xs font-semibold text-[#777784]">Periodicidade padrão: 24 meses, contado do último ASO válido.</p>
          </div>
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStat label="Último ASO válido" value={formatIsoDate(summary?.lastValidExamDate)} />
          <MiniStat label="Próximo periódico" value={formatIsoDate(summary?.nextPeriodicDue)} />
          <MiniStat label="Prazo" value={dateDistanceLabel(summary?.nextPeriodicDue) || "-"} />
        </div>

        {!summary || summary.admissionMissing ? (
          <p className="rounded-2xl border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">
            Colaborador sem ASO admissional registrado. Ao arquivar o ASO admissional, o copiloto usará a data real do exame para iniciar a previsão do periódico.
          </p>
        ) : null}

        {records.length > 0 ? (
          <div className="space-y-2">
            {records.map((record, index) => (
              <div key={`${record.type}-${record.examDate}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-[#e8e8ec] bg-white p-3">
                <div>
                  <p className="text-sm font-black text-[#24242e]">{asoTypeLabel(record.type)}</p>
                  <p className="mt-0.5 text-xs font-semibold text-[#777784]">{formatIsoDate(record.examDate)}</p>
                  {record.source === "legacy_field" ? (
                    <p className="mt-1 text-[11px] font-bold text-amber-700">Campo antigo/manual: confirme pelo ASO anexado.</p>
                  ) : null}
                </div>
                {record.fitnessStatus ? <Chip tone="default">{record.fitnessStatus}</Chip> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-[#f4f4f6] p-4 text-sm font-semibold text-[#777784]">Nenhum ASO arquivado pelo copiloto ainda.</p>
        )}
      </div>
    </Panel>
  );
}

function EmployeeFamilySalaryPanel({
  employeeId,
  reloadKey,
  action,
  canEdit,
}: {
  employeeId: string;
  reloadKey?: number;
  action?: React.ReactNode;
  canEdit?: boolean;
}) {
  const [profileReloadKey, setProfileReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<ChildDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const profileState = useEmployeeProfile(employeeId, (reloadKey ?? 0) + profileReloadKey);

  if (profileState.status === "idle" || profileState.status === "loading") {
    return (
      <Panel title="Salário-família" icon={IdCard} action={action}>
        <div className="h-36 animate-pulse rounded-2xl bg-slate-100" />
      </Panel>
    );
  }

  const summary = profileState.status === "error"
    ? null
    : profileJson<FamilySalaryControlSummary>(profileState.data.fieldValues, SYSTEM_FIELD_KEYS.familySalarySummary);
  const profileFieldValues: Record<string, EmployeeFieldValue> = profileState.status === "error" ? {} : profileState.data.fieldValues;
  const children = childRecordsFromProfile(profileFieldValues, summary);
  const childrenUnder14 = fieldTextLabel(profileFieldValues["employee.children_under_14"]);
  const limit = summary?.salaryLimit?.monthlyRemunerationLimit ?? 1980.38;
  const quota = summary?.salaryLimit?.quotaPerDependent ?? 67.54;
  const statusTone = (summary?.eligibleDependentsCount ?? 0) > 0
    ? "good"
    : (summary?.pendingDependentsCount ?? 0) > 0
      ? "warn"
      : "default";
  const statusLabel = (summary?.eligibleDependentsCount ?? 0) > 0
    ? "Possível direito"
    : (summary?.pendingDependentsCount ?? 0) > 0
      ? "Pendente documentação"
      : "Sem filho elegível";
  const childCount = editing ? drafts.length : countChildrenUnder14(children);

  const startEditing = () => {
    setDrafts(childDraftsFromRecords(children));
    setMessage(null);
    setEditing(true);
  };

  const updateDraft = (index: number, patch: Partial<ChildDraft>) => {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...patch } : draft));
  };

  const updateChildCount = (count: number) => {
    setDrafts((current) => resizeChildDrafts(current, count));
  };

  const saveChildren = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const records = childRecordsFromDrafts(drafts);
      const nextSummary = buildFamilySalarySummary(summary, records);
      const under14Count = countChildrenUnder14(records);
      const eligibleCount = nextSummary.eligibleDependentsCount ?? 0;
      await callOnFieldUpdate({ employee_id: employeeId, field_key: "employee.children", value: records });
      await callOnFieldUpdate({ employee_id: employeeId, field_key: "employee.children_under_14", value: childCountLabel(under14Count) });
      await callOnFieldUpdate({ employee_id: employeeId, field_key: "employee.has_family_salary", value: eligibleCount > 0 });
      await callOnFieldUpdate({ employee_id: employeeId, field_key: SYSTEM_FIELD_KEYS.familySalarySummary, value: nextSummary });
      setEditing(false);
      setProfileReloadKey((value) => value + 1);
      setMessage("Filhos atualizados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar filhos.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Salário-família" icon={IdCard} action={action}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-4">
          <div>
            <p className="text-sm font-black text-[#1d1d26]">Controle por filho</p>
            <p className="mt-1 text-xs font-semibold text-[#777784]">Cota 2026: R$ {quota.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por filho elegível.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Chip tone={statusTone}>{statusLabel}</Chip>
            {canEdit && !editing ? (
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#df2f78] shadow-sm ring-1 ring-[#f5d5e2] hover:bg-[#fff0f6]"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar filhos
              </button>
            ) : null}
          </div>
        </div>

        <p className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-800">
          Atenção: em 2026, o benefício depende de remuneração mensal até R$ {limit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, considerada como salário de contribuição total antes dos descontos.
        </p>

        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStat label="Elegíveis" value={String(summary?.eligibleDependentsCount ?? 0)} />
          <MiniStat label="Pendentes" value={String(summary?.pendingDependentsCount ?? 0)} />
          <MiniStat label="Filhos < 14" value={editing ? String(childCount) : (childrenUnder14 ?? String(childCount))} />
        </div>

        {editing ? (
          <div className="space-y-3 rounded-2xl border border-[#e8e8ec] bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
              <div>
                <label className="text-xs font-black text-[#777784]">Quantidade de filhos</label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={drafts.length}
                  onChange={(event) => updateChildCount(Number(event.target.value))}
                  className="mt-1 h-11 w-full rounded-xl border border-[#dedfe4] bg-[#fbfbfc] px-3 text-sm font-black text-[#1d1d26] outline-none focus:border-[#df2f78] focus:ring-2 focus:ring-[#f8bfd7]"
                />
              </div>
              <p className="text-xs font-semibold text-[#777784]">
                A idade define os requisitos de certidão, vacinação e frequência escolar. O upload dos documentos atualiza os comprovantes do filho.
              </p>
            </div>

            {drafts.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {drafts.map((draft, index) => {
                  const age = dependentAge(draft.birthDate);
                  const required = familyRequiredDocs(draft.birthDate);
                  const documentStatuses = familyDocStatusItems(draft.birthDate, draft.documents);
                  const entitlementEndsAt = childEntitlementEndsAt(draft.birthDate);
                  return (
                    <div key={draft.key} className="rounded-2xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-[#1d1d26]">Filho {index + 1}</p>
                        <Chip tone={age != null && age >= 14 ? "default" : required.length > 0 ? "warn" : "default"}>
                          {age == null ? "Nascimento pendente" : age >= 14 ? "Fora da idade" : `${age} ano${age === 1 ? "" : "s"}`}
                        </Chip>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-black text-[#777784]">
                          Nome
                          <input
                            value={draft.name}
                            onChange={(event) => updateDraft(index, { name: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-[#dedfe4] bg-white px-3 text-sm font-bold text-[#1d1d26] outline-none focus:border-[#df2f78] focus:ring-2 focus:ring-[#f8bfd7]"
                          />
                        </label>
                        <label className="text-xs font-black text-[#777784]">
                          Data de nascimento
                          <input
                            type="date"
                            value={draft.birthDate}
                            onChange={(event) => updateDraft(index, { birthDate: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-[#dedfe4] bg-white px-3 text-sm font-bold text-[#1d1d26] outline-none focus:border-[#df2f78] focus:ring-2 focus:ring-[#f8bfd7]"
                          />
                        </label>
                        <label className="text-xs font-black text-[#777784]">
                          CPF
                          <input
                            value={draft.cpf}
                            onChange={(event) => updateDraft(index, { cpf: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-[#dedfe4] bg-white px-3 text-sm font-bold text-[#1d1d26] outline-none focus:border-[#df2f78] focus:ring-2 focus:ring-[#f8bfd7]"
                          />
                        </label>
                        <label className="text-xs font-black text-[#777784]">
                          RG
                          <input
                            value={draft.rg}
                            onChange={(event) => updateDraft(index, { rg: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-[#dedfe4] bg-white px-3 text-sm font-bold text-[#1d1d26] outline-none focus:border-[#df2f78] focus:ring-2 focus:ring-[#f8bfd7]"
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entitlementEndsAt ? <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-[#777784] ring-1 ring-[#e8e8ec]">Até {formatIsoDate(entitlementEndsAt)}</span> : null}
                        {documentStatuses.map((item) => (
                          <span
                            key={item.label}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-black ${familyDocumentStatusClassName(item.status)}`}
                          >
                            {item.label}: {item.status}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-2xl bg-[#f4f4f6] p-4 text-sm font-semibold text-[#777784]">Sem filhos cadastrados.</p>
            )}

            {message ? (
              <p className={`rounded-xl px-3 py-2 text-xs font-bold ${message.startsWith("Falha") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                {message}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setMessage(null);
                }}
                disabled={saving}
                className="rounded-xl border border-[#dedfe4] bg-white px-4 py-2 text-sm font-black text-[#555563] hover:bg-[#f7f7f9] disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveChildren()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-[#df2f78] px-4 py-2 text-sm font-black text-white hover:bg-[#c92768] disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Salvar filhos
              </button>
            </div>
          </div>
        ) : children.length > 0 ? (
          <div className="space-y-2">
            {children.map((dependent, index) => {
              const age = dependentAge(dependent.birthDate);
              const required = familyRequiredDocs(dependent.birthDate);
              const missing = required.filter((label) => !familyDocPresent(dependent.documents, label));
              const documentStatuses = familyDocStatusItems(dependent.birthDate, dependent.documents);
              const eligibleByAge = age != null && age >= 0 && age < 14;
              return (
                <div key={dependent.key ?? `${dependent.name}-${index}`} className="rounded-xl border border-[#e8e8ec] bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-[#24242e]">{dependent.name ?? "Filho sem nome"}</p>
                      <p className="mt-0.5 text-xs font-semibold text-[#777784]">
                        {dependent.birthDate ? `${formatIsoDate(dependent.birthDate)} · ${age ?? "-"} ano${age === 1 ? "" : "s"}` : "Nascimento pendente"}
                      </p>
                      {dependent.entitlementEndsAt ? (
                        <p className="mt-0.5 text-[11px] font-bold text-[#777784]">Conta para salário-família até {formatIsoDate(dependent.entitlementEndsAt)}</p>
                      ) : null}
                    </div>
                    <Chip tone={!eligibleByAge ? "default" : missing.length === 0 ? "good" : "warn"}>
                      {!eligibleByAge ? "Fora da idade" : missing.length === 0 ? "Documentação ok" : "Pendente"}
                    </Chip>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {documentStatuses.map((item) => (
                      <span
                        key={item.label}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-black ${familyDocumentStatusClassName(item.status)}`}
                      >
                        {item.label}: {item.status}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-2xl bg-[#f4f4f6] p-4 text-sm font-semibold text-[#777784]">Nenhum filho cadastrado para salário-família ainda.</p>
        )}

        {!editing && message ? (
          <p className={`rounded-xl px-3 py-2 text-xs font-bold ${message.startsWith("Falha") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {message}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function getMonthlyShiftSummary(daysOfWeek: number[] = []) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const days: Array<{ day: number; label: string; weekday: string; week: number }> = [];

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month, day);
    if (!daysOfWeek.includes(date.getDay())) continue;
    days.push({
      day,
      label: format(date, "dd/MM", { locale: ptBR }),
      weekday: DAYS_PT[date.getDay()],
      week: Math.ceil((day + firstWeekday) / 7),
    });
  }

  return {
    monthLabel: format(today, "MMMM yyyy", { locale: ptBR }),
    days,
    weeks: Array.from({ length: 6 }, (_, index) => days.filter((item) => item.week === index + 1)),
  };
}

function MonthSchedulePopover({ shiftDef }: {
  shiftDef?: { name?: string; startTime?: string; endTime?: string; daysOfWeek?: number[] } | null;
}) {
  if (!shiftDef) return null;
  const summary = getMonthlyShiftSummary(shiftDef.daysOfWeek ?? []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Ver mês
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-lg p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-950">Escala do mês</p>
            <p className="mt-0.5 text-xs font-semibold capitalize text-slate-500">{summary.monthLabel}</p>
          </div>
          <span className="rounded-full bg-pink-50 px-2.5 py-1 text-xs font-black text-pink-600">
            {summary.days.length} turno{summary.days.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-2 rounded-md bg-slate-50 p-2">
          <p className="text-xs font-black text-slate-950">{shiftDef.name}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">
            {shiftDef.startTime ?? "--:--"} - {shiftDef.endTime ?? "--:--"}
          </p>
        </div>

        <div className="mt-2 space-y-1">
          {summary.weeks.map((weekDays, index) => (
            <div key={index} className="grid grid-cols-[64px_1fr] gap-2 text-xs">
              <span className="py-1 font-black text-slate-400">Semana {index + 1}</span>
              {weekDays.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {weekDays.map((item) => (
                    <span key={item.day} className="rounded-full bg-slate-950 px-2 py-1 font-black text-white">
                      {item.weekday} {item.label}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="py-1 font-semibold text-slate-400">Sem turno</span>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GoalsSummaryPopover({ participates }: { participates?: boolean }) {
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - index);
    return format(date, "MMM/yy", { locale: ptBR });
  }).reverse();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
        >
          12 meses
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] rounded-lg p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-950">Resumo de metas</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">Últimos 12 meses</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-black ${participates ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {participates ? "Participa" : "Não participa"}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <MiniStat label="Mês atual" value={participates ? "92%" : "-"} />
          <MiniStat label="Média 12m" value="-" />
          <MiniStat label="Meses batidos" value="-" />
        </div>

        <div className="mt-2 space-y-1">
          {months.map((month) => (
            <div key={month} className="grid grid-cols-[56px_1fr_32px] items-center gap-2 text-xs">
              <span className="font-black capitalize text-slate-500">{month}</span>
              <div className="h-1.5 rounded-full bg-slate-100" />
              <span className="text-right font-black text-slate-400">-</span>
            </div>
          ))}
        </div>

        <p className="mt-2 rounded-md bg-slate-50 p-2 text-[10px] font-semibold leading-4 text-slate-500">
          O histórico consolidado depende dos fechamentos mensais de metas do colaborador.
        </p>
      </PopoverContent>
    </Popover>
  );
}

type EmployeeProfileFieldRow = {
  key: string;
  entry: FieldMapEntry;
  fv?: EmployeeFieldValue;
  staticValue?: React.ReactNode;
  staticHasValue?: boolean;
  readOnly?: boolean;
};

function EmployeeProfileFields({ user, profileName, reloadKey = 0 }: { user: User; profileName?: string; reloadKey?: number }) {
  const { firebaseUser, permissions, user: currentUser } = useAuth();
  const employeeId = user.registrationIdBizneo || user.id;
  const [editKey, setEditKey] = useState<string | null>(null);
  const [profileReloadKey, setProfileReloadKey] = useState(0);
  const [visibilitySavingKey, setVisibilitySavingKey] = useState<string | null>(null);
  const [visibilityMessage, setVisibilityMessage] = useState<string | null>(null);
  const profileState = useEmployeeProfile(employeeId, profileReloadKey + reloadKey);

  if (profileState.status === "idle" || profileState.status === "loading") {
    return (
      <Panel title="Perfil do colaborador" icon={IdCard}>
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </Panel>
    );
  }

  if (profileState.status === "error") {
    return (
      <Panel title="Perfil do colaborador" icon={IdCard}>
        <div className="rounded-2xl bg-[#fffaf0] p-4">
          <p className="text-sm font-black text-slate-900">Campos do perfil indisponíveis</p>
          <p className="mt-1 text-xs font-semibold text-[#817762]">
            Não foi possível carregar os campos deste colaborador. Motivo: {profileState.message}
          </p>
        </div>
      </Panel>
    );
  }

  const { employee, fieldValues, fieldMap, cache } = profileState.data;
  const role = cache.rh_role as RhRole;
  const canManageFieldVisibility = Boolean(
    permissions.settings?.manageUsers === true || permissions.dp?.collaborators?.edit === true
  );
  const visibilityContext = {
    isOwner: firebaseUser?.uid === user.id || employee.auth_uid === firebaseUser?.uid || currentUser?.id === user.id,
    canViewConfidential: permissions.settings?.manageUsers === true,
    userId: currentUser?.id ?? firebaseUser?.uid ?? null,
    roleIds: currentUser?.jobRoleId ? [currentUser.jobRoleId] : [],
    functionIds: (currentUser?.jobFunctionIds ?? []).filter(Boolean),
  };

  async function updateFieldVisibility(key: string, entry: FieldMapEntry, visibility: FieldVisibility) {
    if (!firebaseUser || visibility === entry.visibility || visibilitySavingKey) return;
    setVisibilitySavingKey(key);
    setVisibilityMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const nextLgpd = defaultFieldLgpd(entry.section, visibility);
      const nextFields = {
        ...fieldMap.fields,
        [key]: {
          ...entry,
          visibility,
          lgpd: {
            ...nextLgpd,
            ...(entry.lgpd ?? {}),
            category: nextLgpd.category,
          },
        },
      };
      const response = await fetch("/api/rh/field-map", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          version: fieldMap.version ?? "coala-rh-v1.3",
          fields: nextFields,
          section_order: fieldMap.section_order ?? {},
          profile_blocks: fieldMap.profile_blocks ?? DEFAULT_PROFILE_BLOCKS,
          access_matrix: fieldMap.access_matrix,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao salvar a visibilidade do campo.");
      }
      setVisibilityMessage(`Visibilidade de "${fieldDisplayLabel(entry.label)}" atualizada para ${FIELD_VISIBILITY_LABELS[normalizeFieldVisibility(visibility)]}.`);
      setProfileReloadKey((value) => value + 1);
    } catch (error) {
      setVisibilityMessage(error instanceof Error ? error.message : "Falha ao salvar a visibilidade do campo.");
    } finally {
      setVisibilitySavingKey(null);
    }
  }

  async function updateSectionVisibility(section: string, items: Array<{ key: string; entry: FieldMapEntry }>, visibility: FieldVisibility) {
    if (!firebaseUser || visibilitySavingKey || items.length === 0) return;
    setVisibilitySavingKey(`section:${section}`);
    setVisibilityMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const nextFields = { ...fieldMap.fields };
      items.forEach(({ key, entry }) => {
        const nextLgpd = defaultFieldLgpd(entry.section, visibility);
        nextFields[key] = {
          ...entry,
          visibility,
          lgpd: {
            ...nextLgpd,
            ...(entry.lgpd ?? {}),
            category: nextLgpd.category,
          },
        };
      });
      const response = await fetch("/api/rh/field-map", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          version: fieldMap.version ?? "coala-rh-v1.3",
          fields: nextFields,
          section_order: fieldMap.section_order ?? {},
          profile_blocks: fieldMap.profile_blocks ?? DEFAULT_PROFILE_BLOCKS,
          access_matrix: fieldMap.access_matrix,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao salvar a visibilidade do card.");
      }
      setVisibilityMessage(`Visibilidade de "${sectionDisplayLabel(section)}" atualizada para ${FIELD_VISIBILITY_LABELS[normalizeFieldVisibility(visibility)]}.`);
      setProfileReloadKey((value) => value + 1);
    } catch (error) {
      setVisibilityMessage(error instanceof Error ? error.message : "Falha ao salvar a visibilidade do card.");
    } finally {
      setVisibilitySavingKey(null);
    }
  }

  const sections = Object.entries(fieldMap.fields).reduce<
    Record<string, EmployeeProfileFieldRow[]>
  >((acc, [key, entry]) => {
    if (isSystemStaticField(key)) return acc;
    if (isSystemPanelProfileField(key)) return acc;
    if (isLegacyUniformField(key, entry)) return acc;
    if (!canViewField(entry.visibility, role, visibilityContext, entry.access, fieldMap.access_matrix) || !conditionalMatches(entry, fieldValues)) return acc;
    const section = profileDisplaySection(entry.section);
    if (!acc[section]) acc[section] = [];
    acc[section].push({ key, entry, fv: fieldValues[key] });
    return acc;
  }, {});

  const systemEntry = (key: string) => {
    const fallback = SYSTEM_FIELD_DEFAULTS[key] ?? systemField(key, "Sistema", 999, "confidential");
    const systemsCardKeys = new Set<string>([
      SYSTEM_FIELD_KEYS.registrationBizneo,
      SYSTEM_FIELD_KEYS.registrationPdv,
      SYSTEM_FIELD_KEYS.loginBizneo,
      SYSTEM_FIELD_KEYS.loginPdv,
      SYSTEM_FIELD_KEYS.loginCoalaOne,
      SYSTEM_FIELD_KEYS.accessProfile,
      SYSTEM_FIELD_KEYS.operational,
      SYSTEM_FIELD_KEYS.goals,
      SYSTEM_FIELD_KEYS.functions,
    ]);
    return {
      ...fallback,
      ...(fieldMap.fields[key] ?? {}),
      section: fallback.section,
      order: fallback.order,
      ...(systemsCardKeys.has(key) ? { visibility: "restricted_partial" as const } : {}),
    } as FieldMapEntry;
  };
  const canShowSystemProfileField = (key: string) => {
    const entry = systemEntry(key);
    return canManageFieldVisibility || canViewField(entry.visibility, role, visibilityContext, entry.access, fieldMap.access_matrix);
  };
  const addContractRow = (row: EmployeeProfileFieldRow) => {
    const section = "Dados contratuais";
    if (!sections[section]) sections[section] = [];
    sections[section].push(row);
  };
  [
    {
      key: SYSTEM_FIELD_KEYS.loginBizneo,
      value: user.email || "-",
      hasValue: Boolean(user.email),
    },
    {
      key: SYSTEM_FIELD_KEYS.registrationBizneo,
      value: user.registrationIdBizneo ?? "-",
      hasValue: Boolean(user.registrationIdBizneo),
    },
    {
      key: SYSTEM_FIELD_KEYS.loginPdv,
      value: user.username || "-",
      hasValue: Boolean(user.username),
    },
    {
      key: SYSTEM_FIELD_KEYS.registrationPdv,
      value: pdvRegistrationLabel(user),
      hasValue: pdvRegistrationLabel(user) !== "-",
    },
    {
      key: SYSTEM_FIELD_KEYS.loginCoalaOne,
      value: user.email || "-",
      hasValue: Boolean(user.email),
    },
    {
      key: SYSTEM_FIELD_KEYS.operational,
      value: user.operacional ? "Sim" : "Não",
      hasValue: true,
    },
    {
      key: SYSTEM_FIELD_KEYS.goals,
      value: user.participatesInGoals ? "Participa" : "Não participa",
      hasValue: true,
    },
    {
      key: SYSTEM_FIELD_KEYS.functions,
      value: user.jobFunctionNames && user.jobFunctionNames.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {user.jobFunctionNames.map((name) => <Chip key={name} tone="good">{name}</Chip>)}
        </div>
      ) : "Nenhuma função vinculada.",
      hasValue: Boolean(user.jobFunctionNames?.length),
    },
    {
      key: SYSTEM_FIELD_KEYS.accessProfile,
      value: profileName ?? user.profileId ?? "-",
      hasValue: Boolean(profileName ?? user.profileId),
    },
  ].forEach((row) => {
    if (!canShowSystemProfileField(row.key)) return;
    addContractRow({
      key: row.key,
      entry: systemEntry(row.key),
      staticValue: row.value,
      staticHasValue: row.hasValue,
      readOnly: true,
    });
  });

  Object.values(sections).forEach((items) => {
    items.sort((left, right) => (left.entry.order ?? 0) - (right.entry.order ?? 0));
  });

  const fallbackSectionOrder = [
    MERGED_PERSONAL_DOCUMENTS_SECTION,
    ...Array.from(new Set(Object.values(RH_SECTION_LABELS).map(profileDisplaySection)))
      .filter((section) => section !== MERGED_PERSONAL_DOCUMENTS_SECTION),
  ];
  const fallbackSectionPosition = new Map(fallbackSectionOrder.map((section, index) => [section, (index + 1) * 10]));
  const sectionOrderConfig = fieldMap.section_order ?? {};
  const configuredSectionOrder = (section: string) => {
    const exact = sectionOrderConfig[section];
    if (Number.isFinite(exact)) return exact;
    const matchingOrders = Object.entries(sectionOrderConfig)
      .filter(([configuredSection]) => profileDisplaySection(configuredSection) === section)
      .map(([, order]) => order)
      .filter((order): order is number => Number.isFinite(order));
    return matchingOrders.length > 0 ? Math.min(...matchingOrders) : Number.MAX_SAFE_INTEGER;
  };
  const orderedSections = Object.keys(sections).sort((left, right) => {
    const leftConfigured = configuredSectionOrder(left);
    const rightConfigured = configuredSectionOrder(right);
    if (leftConfigured !== rightConfigured) return leftConfigured - rightConfigured;
    const leftFallback = fallbackSectionPosition.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightFallback = fallbackSectionPosition.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftFallback - rightFallback || left.localeCompare(right, "pt-BR");
  });
  const allFields = orderedSections
    .flatMap((section) => sections[section] ?? [])
    .filter((row) => row.staticValue === undefined);

  return (
    <div className="space-y-4">
      {visibilityMessage ? (
        <p className={`rounded-xl px-3 py-2 text-xs font-bold ${
          visibilityMessage.startsWith("Falha") || visibilityMessage.startsWith("Sem permissão")
            ? "bg-rose-50 text-rose-600"
            : "bg-emerald-50 text-emerald-700"
        }`}>
          {visibilityMessage}
        </p>
      ) : null}

      <div className="grid gap-2.5 lg:grid-cols-[160px_minmax(0,1fr)]">
        <aside className="space-y-1 lg:sticky lg:top-[236px] lg:self-start">
          {orderedSections.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => document.getElementById(profileSectionDomId(section))?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-black text-[#737381] transition hover:bg-white hover:text-[#bd185c]"
            >
              <span className="truncate">{sectionDisplayLabel(section)}</span>
            </button>
          ))}
          {SYSTEM_NAV_LINKS.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => document.getElementById(profileSectionDomId(link.id))?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-black text-[#737381] transition hover:bg-white hover:text-[#bd185c]"
            >
              <span className="truncate">{link.label}</span>
            </button>
          ))}
        </aside>

        <div className="space-y-4">
          {orderedSections.map((section) => {
            const sectionFields = sections[section] ?? [];
            const sectionVisibility = getVisibilitySummary(sectionFields.map(({ entry }) => entry));
            return (
              <section id={profileSectionDomId(section)} key={section} className="scroll-mt-[180px] rounded-xl border border-[#dedfe4] bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e8ec] px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#fff0f6] text-[#df2f78]">
                      <IdCard className="h-4 w-4" />
                    </span>
                    <h3 className="text-xs font-black text-[#1d1d26]">{sectionDisplayLabel(section)}</h3>
                  </div>
                  {canManageFieldVisibility ? (
                    <CardVisibilityButton
                      visibility={sectionVisibility.visibility}
                      mixed={sectionVisibility.mixed}
                      saving={visibilitySavingKey === `section:${section}`}
                      disabled={Boolean(visibilitySavingKey && visibilitySavingKey !== `section:${section}`)}
                      onChange={(visibility) => void updateSectionVisibility(section, sectionFields, visibility)}
                    />
                  ) : null}
                </div>
                <div className="grid gap-2 p-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {sectionFields.map(({ key, entry, fv, staticValue, staticHasValue, readOnly }) => {
                    const hasValue = staticValue !== undefined ? Boolean(staticHasValue) : fieldHasValue(fv);
                    const readOnlyFromOrgChart = readOnly || key === "employee.job_role_id";
                    return (
                      <div key={key} className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[10px] font-black text-[#9d9da9]">{fieldDisplayLabel(entry.label)}</p>
                            <div className="mt-1 text-xs font-black text-[#24242e]">
                              {staticValue !== undefined ? (
                                staticValue
                              ) : hasValue ? (
                                <FieldValue fv={fv} type={entry.type} role={role} fieldKey={key} />
                              ) : role !== "employee" ? (
                                <button type="button" onClick={() => setEditKey(key)} className="text-[#df2f78]">
                                  + Adicionar
                                </button>
                              ) : (
                                "-"
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            {canManageFieldVisibility ? (
                              <FieldVisibilityButton
                                entry={entry}
                                saving={visibilitySavingKey === key}
                                disabled={Boolean(visibilitySavingKey && visibilitySavingKey !== key)}
                                onChange={(visibility) => void updateFieldVisibility(key, entry, visibility)}
                              />
                            ) : null}
                            {role !== "employee" && hasValue && !readOnlyFromOrgChart ? (
                              <button
                                type="button"
                                onClick={() => setEditKey(key)}
                                className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-[#df2f78] shadow-sm ring-1 ring-[#f5d5e2] hover:bg-[#fff0f6]"
                              >
                                Editar
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {editKey && (
        <SectionEditModal
          employeeId={employee.bizneo_employee_id}
          editKey={editKey}
          fields={allFields}
          role={role}
          onClose={() => setEditKey(null)}
          onSaved={() => setEditKey(null)}
        />
      )}
    </div>
  );
}

function EmployeeProfileHeaderSummary({
  userId,
  bizneoEmployeeId,
  reloadKey = 0,
}: {
  userId: string;
  bizneoEmployeeId?: string | null;
  reloadKey?: number;
}) {
  const { firebaseUser, permissions, user: currentUser } = useAuth();
  const employeeId = bizneoEmployeeId || userId;
  const profileState = useEmployeeProfile(employeeId, reloadKey);

  if (profileState.status === "idle" || profileState.status === "loading") {
    return (
      <div className="min-w-[280px] rounded-2xl border border-[#ececf0] bg-[#fbfbfc] px-4 py-3">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-3 w-48 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  if (profileState.status === "error") {
    return (
      <div className="min-w-[280px] rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
        <p className="text-xs font-black text-amber-800">Cadastro local indisponível</p>
        <p className="mt-1 text-[11px] font-bold text-amber-700">
          Os campos complementares ainda não foram preparados para este colaborador.
        </p>
      </div>
    );
  }

  const { employee, fieldValues, fieldMap, cache } = profileState.data;
  const role = cache.rh_role as RhRole;
  const visibilityContext = {
    isOwner: firebaseUser?.uid === userId || employee.auth_uid === firebaseUser?.uid || currentUser?.id === userId,
    canViewConfidential: permissions.settings?.manageUsers === true,
    userId: currentUser?.id ?? firebaseUser?.uid ?? null,
    roleIds: currentUser?.jobRoleId ? [currentUser.jobRoleId] : [],
    functionIds: (currentUser?.jobFunctionIds ?? []).filter(Boolean),
  };
  const visibleFields = Object.entries(fieldMap.fields)
    .filter(([key, entry]) => {
      if (isSystemStaticField(key) || isSystemPanelProfileField(key) || isLegacyUniformField(key, entry)) return false;
      return canViewField(entry.visibility, role, visibilityContext, entry.access, fieldMap.access_matrix) && conditionalMatches(entry, fieldValues);
    });
  const filledFields = visibleFields.filter(([key]) => fieldHasValue(fieldValues[key])).length;
  const totalFields = visibleFields.length;
  const completionPct = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : employee.profile_completion;

  return (
    <div className="min-w-[320px] rounded-2xl border border-[#ececf0] bg-[#fbfbfc] px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(#df2f78 ${completionPct * 3.6}deg, #ececf0 0deg)` }}
          >
            <div className="grid h-8 w-8 place-items-center rounded-full bg-white text-xs font-black text-[#1d1d26]">
              {completionPct}%
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-black text-[#1d1d26]">Perfil completo</p>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${completionPct >= 80 ? "bg-[#eafaf2] text-[#008963]" : "bg-[#ffe9ef] text-[#d9275f]"}`}>
                {completionPct >= 80 ? "Completo" : "Incompleto"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] font-bold text-[#777784]">
              {filledFields}/{totalFields} campos preenchidos
            </p>
            <p className="mt-0.5 text-[11px] font-bold text-[#8f8f9b]">
              Cadastro local do Coala
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminationDialog({
  user,
  open,
  saving,
  onOpenChange,
  onConfirm,
}: {
  user: User;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: TerminationPayload) => Promise<void>;
}) {
  const [terminationDate, setTerminationDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [terminationReason, setTerminationReason] = useState<EmploymentTerminationReason | "">("");
  const [terminationCause, setTerminationCause] = useState("");
  const [terminationNotes, setTerminationNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const needsSubtype = requiresTerminationSubtype(terminationReason);
  const relationshipType = user.employmentRelationshipType;
  const availableReasons = terminationReasonsForRelationship(relationshipType);
  const copy = terminationCopyForRelationship(relationshipType);
  const terminationAvailable = relationshipType === "clt" || relationshipType === "pj";

  useEffect(() => {
    if (!open) return;
    setTerminationDate(format(new Date(), "yyyy-MM-dd"));
    setTerminationReason("");
    setTerminationCause("");
    setTerminationNotes("");
    setMessage(null);
  }, [open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!terminationDate) {
      setMessage(copy.missingDate);
      return;
    }
    if (!terminationAvailable) {
      setMessage(
        relationshipType === "internship"
          ? "O fluxo específico de desligamento de estágio será implementado posteriormente."
          : "Defina o tipo de vínculo antes de registrar o encerramento."
      );
      return;
    }
    if (!terminationReason) {
      setMessage(copy.missingReason);
      return;
    }
    if (!availableReasons.some((reason) => reason === terminationReason)) {
      setMessage("O motivo selecionado não pertence ao tipo de vínculo cadastrado.");
      return;
    }
    if (needsSubtype && !terminationCause) {
      setMessage("Selecione o subtipo da justa causa.");
      return;
    }

    setMessage(null);
    await onConfirm({
      terminationDate,
      terminationReason,
      terminationCause: needsSubtype ? terminationCause : undefined,
      terminationNotes: terminationNotes.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="rounded-xl p-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {copy.description} Colaborador: {displayName(user.username)}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="text-xs font-black uppercase tracking-wide text-[#777784]">
              {copy.dateLabel}
              <input
                type="date"
                value={terminationDate}
                onChange={(event) => setTerminationDate(event.target.value)}
                className="mt-1 h-8 w-full rounded-lg border border-[#dedfe4] bg-white px-2.5 text-xs font-bold text-[#1d1d26] outline-none focus:border-[#df2f78]"
              />
            </label>
            <label className="text-xs font-black uppercase tracking-wide text-[#777784]">
              {copy.reasonLabel}
              <select
                value={terminationReason}
                onChange={(event) => {
                  const nextReason = event.target.value as EmploymentTerminationReason | "";
                  setTerminationReason(nextReason);
                  if (!requiresTerminationSubtype(nextReason)) setTerminationCause("");
                }}
                className="mt-1 h-8 w-full rounded-lg border border-[#dedfe4] bg-white px-2.5 text-xs font-bold text-[#1d1d26] outline-none focus:border-[#df2f78]"
              >
                <option value="">Selecione</option>
                {availableReasons.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </label>
          </div>

          {needsSubtype ? (
            <label className="block text-xs font-black uppercase tracking-wide text-[#777784]">
              Subtipo da justa causa
              <select
                value={terminationCause}
                onChange={(event) => setTerminationCause(event.target.value)}
                className="mt-1 h-8 w-full rounded-lg border border-[#dedfe4] bg-white px-2.5 text-xs font-bold text-[#1d1d26] outline-none focus:border-[#df2f78]"
              >
                <option value="">Selecione</option>
                {JUST_CAUSE_TYPES.map((cause) => (
                  <option key={cause} value={cause}>{cause}</option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block text-xs font-black uppercase tracking-wide text-[#777784]">
            Observações
            <Textarea
              value={terminationNotes}
              onChange={(event) => setTerminationNotes(event.target.value)}
              placeholder="Opcional"
              className="mt-1 min-h-16 rounded-lg border-[#dedfe4] text-xs font-semibold"
            />
          </label>

          {message ? (
            <p className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{message}</p>
          ) : null}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="rounded-2xl border border-[#dedfe4] bg-white px-4 py-2.5 text-sm font-black text-[#4f4f5b] hover:bg-slate-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !terminationAvailable}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#df2f78] px-4 py-2.5 text-sm font-black text-white hover:bg-[#c92768] disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
              {saving ? copy.saving : copy.submit}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CollaboratorProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { activeUsers, terminatedUsers, permissions, firebaseUser, user: currentUser, updateUser, terminateUser } = useAuth();
  const { toast } = useToast();
  const { profiles } = useProfiles();
  const { shiftDefinitions, units, vacations, vacationsLoading } = useDPBootstrap();
  const [fieldMapReloadKey, setFieldMapReloadKey] = useState(0);
  const [systemVisibilitySavingKey, setSystemVisibilitySavingKey] = useState<string | null>(null);
  const [systemVisibilityMessage, setSystemVisibilityMessage] = useState<string | null>(null);
  const [transportVoucherEditorOpen, setTransportVoucherEditorOpen] = useState(false);
  const [transportVoucherHistoryOpen, setTransportVoucherHistoryOpen] = useState(false);
  const [transportVoucherStatusDraft, setTransportVoucherStatusDraft] = useState<"active" | "suspended">("suspended");
  const [transportVoucherValueDraft, setTransportVoucherValueDraft] = useState<number | "">("");
  const [transportVoucherEffectiveDate, setTransportVoucherEffectiveDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [transportVoucherReason, setTransportVoucherReason] = useState("");
  const [transportVoucherSaving, setTransportVoucherSaving] = useState(false);
  const [transportVoucherMessage, setTransportVoucherMessage] = useState<string | null>(null);
  const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
  const [terminationSaving, setTerminationSaving] = useState(false);
  const { fieldMap: profileLayout } = useFieldMap(fieldMapReloadKey);

  const allUsers: User[] = [...activeUsers, ...terminatedUsers];
  const user = allUsers.find((entry) => entry.id === userId);
  useEffect(() => {
    if (!firebaseUser || !user) return;
    void createAuditLog(firebaseUser, {
      module: "dp.collaborators",
      action: "collaborator_profile_viewed",
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      metadata: {
        email: user.email,
        profile_id: user.profileId,
        source: "collaborator_detail",
      },
    }).catch((error) => {
      console.warn("[CollaboratorProfilePage] Falha ao registrar auditoria.", error);
    });
  }, [firebaseUser, user]);

  if (!permissions.dp?.collaborators?.view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar este perfil.</p>;
  }

  if (!user) {
    return (
      <div className="p-6 text-center">
        <UserX className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Colaborador não encontrado.</p>
      </div>
    );
  }

  const ownProfileOnly = permissions.dp?.collaborators?.ownProfileOnly === true;
  if (ownProfileOnly && currentUser?.id !== user.id) {
    return <p className="p-6 text-sm text-muted-foreground">Este perfil permite visualizar apenas os próprios dados da Gestão do colaborador.</p>;
  }

  const collaborator = user;
  const isTerminated = collaborator.isActive === false;
  const profile = profiles.find((entry) => entry.id === collaborator.profileId);
  const shiftDef = shiftDefinitions.find((entry) => entry.id === collaborator.shiftDefinitionId);
  const userUnits = units.filter((unit) => collaborator.unitIds?.includes(unit.id));
  const userVacations = vacations
    .filter((vacation) => vacation.userId === collaborator.id)
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  const admissionDate = toDate(collaborator.admissionDate);
  const vacationRecordsForBalance = userVacations.filter((vacation) => vacation.status !== "REJECTED");
  const vacationCycles = admissionDate ? getVacationCycleHistory(admissionDate, vacationRecordsForBalance) : [];
  const currentAcquisitionCycle = vacationCycles.find((item) => isDateInVacationAcquisitiveCycle(new Date(), item))
    ?? vacationCycles.find((item) => item.status === "AQUISITIVO")
    ?? null;
  const openConcessiveCycle = vacationCycles.find(isOpenVacationConcessiveCycle) ?? null;
  const currentVacationCycle = openConcessiveCycle
    ?? currentAcquisitionCycle
    ?? null;
  const currentCycleVacations = currentVacationCycle
    ? userVacations.filter((vacation) => vacation.cycleId === currentVacationCycle.id && vacation.status !== "REJECTED")
    : [];
  const overdueVacationCycles = vacationCycles.filter((item) => item.status === "VENCIDO" && item.balance > 0);
  const vacationTakenDays = currentCycleVacations
    .filter((vacation) => vacation.recordType === "gozo")
    .reduce((total, vacation) => total + vacation.days, 0);
  const vacationBalanceDays = currentVacationCycle ? Math.max(0, currentVacationCycle.balance) : 0;
  const functionLabel = (collaborator.jobFunctionNames ?? []).filter(Boolean).join(", ");
  const roleFunctionLabel = [collaborator.jobRoleName, functionLabel].filter(Boolean).join(" | ") || (isTerminated ? "Desligado" : "Sem cargo");
  const userInitials = initials(collaborator.username);
  const profileBlocks = { ...DEFAULT_PROFILE_BLOCKS, ...(profileLayout?.profile_blocks ?? {}) };
  const blockOrder = (id: keyof typeof DEFAULT_PROFILE_BLOCKS) => profileBlocks[id]?.order ?? DEFAULT_PROFILE_BLOCKS[id].order;
  const canManageSystemFieldVisibility = Boolean(
    permissions.settings?.manageUsers === true || permissions.dp?.collaborators?.edit === true
  );
  const systemViewerRole: RhRole = permissions.settings?.manageUsers === true
    ? "admin"
    : permissions.dp?.collaborators?.view === true
      ? "manager"
      : "employee";
  const systemVisibilityContext = {
    isOwner: firebaseUser?.uid === collaborator.id || currentUser?.id === collaborator.id,
    canViewConfidential: permissions.settings?.manageUsers === true,
    userId: currentUser?.id ?? firebaseUser?.uid ?? null,
    roleIds: currentUser?.jobRoleId ? [currentUser.jobRoleId] : [],
    functionIds: (currentUser?.jobFunctionIds ?? []).filter(Boolean),
  };

  function systemFieldEntry(key: string) {
    const configured = profileLayout?.fields?.[key];
    const fallback = SYSTEM_FIELD_DEFAULTS[key] ?? configured ?? systemField(key, "Sistema", 999, "confidential");
    return {
      ...fallback,
      ...(configured ?? {}),
      section: fallback.section,
      order: fallback.order,
    } as FieldMapEntry;
  }

  function canShowSystemField(key: string) {
    const entry = systemFieldEntry(key);
    return canManageSystemFieldVisibility || canViewField(entry.visibility, systemViewerRole, systemVisibilityContext, entry.access, profileLayout?.access_matrix);
  }

  async function updateSystemFieldVisibility(key: string, entry: FieldMapEntry, visibility: FieldVisibility) {
    if (!firebaseUser || !profileLayout || visibility === entry.visibility || systemVisibilitySavingKey) return;
    setSystemVisibilitySavingKey(key);
    setSystemVisibilityMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const nextLgpd = defaultFieldLgpd(entry.section, visibility);
      const nextFields = {
        ...SYSTEM_FIELD_DEFAULTS,
        ...(profileLayout.fields ?? {}),
        [key]: {
          ...entry,
          visibility,
          lgpd: {
            ...nextLgpd,
            ...(entry.lgpd ?? {}),
            category: nextLgpd.category,
          },
        },
      };
      const response = await fetch("/api/rh/field-map", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          version: profileLayout.version ?? "coala-rh-v1.3",
          fields: nextFields,
          section_order: profileLayout.section_order ?? {},
          profile_blocks: profileLayout.profile_blocks ?? DEFAULT_PROFILE_BLOCKS,
          access_matrix: profileLayout.access_matrix,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao salvar a visibilidade do campo.");
      }
      setSystemVisibilityMessage(`Visibilidade de "${fieldDisplayLabel(entry.label)}" atualizada para ${FIELD_VISIBILITY_LABELS[normalizeFieldVisibility(visibility)]}.`);
      setFieldMapReloadKey((value) => value + 1);
    } catch (error) {
      setSystemVisibilityMessage(error instanceof Error ? error.message : "Falha ao salvar a visibilidade do campo.");
    } finally {
      setSystemVisibilitySavingKey(null);
    }
  }

  function visibilityControl(key: string) {
    const entry = systemFieldEntry(key);
    if (!canManageSystemFieldVisibility) return null;
    return (
      <FieldVisibilityButton
        entry={entry}
        saving={systemVisibilitySavingKey === key}
        disabled={!profileLayout || Boolean(systemVisibilitySavingKey && systemVisibilitySavingKey !== key)}
        onChange={(visibility) => void updateSystemFieldVisibility(key, entry, visibility)}
      />
    );
  }

  async function updateSystemBlockVisibility(keys: readonly string[], visibility: FieldVisibility) {
    if (!firebaseUser || !profileLayout || systemVisibilitySavingKey || keys.length === 0) return;
    const savingKey = `block:${keys.join("|")}`;
    setSystemVisibilitySavingKey(savingKey);
    setSystemVisibilityMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const nextFields = {
        ...SYSTEM_FIELD_DEFAULTS,
        ...(profileLayout.fields ?? {}),
      };
      keys.forEach((key) => {
        const entry = systemFieldEntry(key);
        const nextLgpd = defaultFieldLgpd(entry.section, visibility);
        nextFields[key] = {
          ...entry,
          visibility,
          lgpd: {
            ...nextLgpd,
            ...(entry.lgpd ?? {}),
            category: nextLgpd.category,
          },
        };
      });
      const response = await fetch("/api/rh/field-map", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          version: profileLayout.version ?? "coala-rh-v1.3",
          fields: nextFields,
          section_order: profileLayout.section_order ?? {},
          profile_blocks: profileLayout.profile_blocks ?? DEFAULT_PROFILE_BLOCKS,
          access_matrix: profileLayout.access_matrix,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao salvar a visibilidade do card.");
      }
      setSystemVisibilityMessage(`Visibilidade do card atualizada para ${FIELD_VISIBILITY_LABELS[normalizeFieldVisibility(visibility)]}.`);
      setFieldMapReloadKey((value) => value + 1);
    } catch (error) {
      setSystemVisibilityMessage(error instanceof Error ? error.message : "Falha ao salvar a visibilidade do card.");
    } finally {
      setSystemVisibilitySavingKey(null);
    }
  }

  function systemBlockVisibilityControl(keys: readonly string[]) {
    if (!canManageSystemFieldVisibility) return null;
    const entries = keys.map((key) => systemFieldEntry(key));
    const summary = getVisibilitySummary(entries);
    const savingKey = `block:${keys.join("|")}`;
    return (
      <CardVisibilityButton
        visibility={summary.visibility}
        mixed={summary.mixed}
        saving={systemVisibilitySavingKey === savingKey}
        disabled={!profileLayout || Boolean(systemVisibilitySavingKey && systemVisibilitySavingKey !== savingKey)}
        onChange={(visibility) => void updateSystemBlockVisibility(keys, visibility)}
      />
    );
  }

  function canShowSystemBlock(keys: readonly string[]) {
    return keys.some((key) => canShowSystemField(key));
  }

  const systemBlockKeys = SYSTEM_BLOCK_KEYS;
  const transportVoucherHistory = collaborator.transportVoucherHistory ?? [];
  const transportVoucherStatus = getTransportVoucherStatus(collaborator.needsTransportVoucher, transportVoucherHistory);
  const canManageTransportVoucher = Boolean(
    permissions.settings?.manageUsers === true || permissions.dp?.collaborators?.edit === true
  );
  const canTerminateCollaborator = Boolean(
    !isTerminated && (permissions.settings?.manageUsers === true || permissions.dp?.collaborators?.terminate === true)
  );

  async function confirmTermination(payload: TerminationPayload) {
    if (!canTerminateCollaborator || terminationSaving) return;
    setTerminationSaving(true);
    try {
      await terminateUser({
        uid: collaborator.id,
        inactivationType: "contract_termination",
        terminationDate: payload.terminationDate,
        terminationReason: payload.terminationReason,
        terminationCause: payload.terminationCause,
        terminationNotes: payload.terminationNotes,
      });
      if (firebaseUser) {
        await createAuditLog(firebaseUser, {
          module: "dp.collaborators",
          action: "collaborator_contract_termination_registered",
          targetType: "user",
          targetId: collaborator.id,
          targetName: collaborator.username,
          metadata: {
            termination_date: payload.terminationDate,
            employment_relationship_type: collaborator.employmentRelationshipType ?? null,
            termination_reason: payload.terminationReason,
            termination_cause: payload.terminationCause ?? null,
          },
        }).catch(() => undefined);
      }
      setTerminationDialogOpen(false);
      toast({
        title: terminationCopyForRelationship(collaborator.employmentRelationshipType).success,
        description: `${displayName(collaborator.username)} foi inativado(a).`,
      });
    } catch (error) {
      toast({
        title: "Erro ao registrar rescisão.",
        description: error instanceof Error ? error.message : "Não foi possível inativar o colaborador.",
        variant: "destructive",
      });
    } finally {
      setTerminationSaving(false);
    }
  }

  function openTransportVoucherEditor() {
    const nextStatus = transportVoucherStatus === "none" ? "active" : transportVoucherStatus;
    setTransportVoucherStatusDraft(nextStatus);
    setTransportVoucherValueDraft(collaborator.transportVoucherValue ?? "");
    setTransportVoucherEffectiveDate(format(new Date(), "yyyy-MM-dd"));
    setTransportVoucherReason(defaultTransportVoucherReason(transportVoucherStatus, nextStatus));
    setTransportVoucherMessage(null);
    setTransportVoucherEditorOpen(true);
  }

  async function saveTransportVoucher() {
    if (!canManageTransportVoucher || transportVoucherSaving) return;
    const fromStatus = transportVoucherStatus;
    const toStatus = transportVoucherStatusDraft;
    let change: ReturnType<typeof resolveTransportVoucherChange>;
    try {
      change = resolveTransportVoucherChange({
        fromStatus,
        toStatus,
        currentValue: collaborator.transportVoucherValue,
        draftValue: transportVoucherValueDraft,
        effectiveDate: transportVoucherEffectiveDate || format(new Date(), "yyyy-MM-dd"),
        reason: transportVoucherReason,
        changedBy: currentUser ? { userId: currentUser.id, username: currentUser.username } : undefined,
      });
    } catch (error) {
      setTransportVoucherMessage(error instanceof Error ? error.message : "Informe um valor de vale-transporte válido.");
      return;
    }

    setTransportVoucherSaving(true);
    setTransportVoucherMessage(null);
    try {
      const nextUser: User = {
        ...collaborator,
        needsTransportVoucher: change.nextNeedsTransportVoucher,
        transportVoucherValue: change.nextTransportVoucherValue,
        transportVoucherHistory: change.historyEntry ? [...transportVoucherHistory, change.historyEntry] : transportVoucherHistory,
      };
      await updateUser(nextUser);
      if (firebaseUser) {
        await createAuditLog(firebaseUser, {
          module: "dp.collaborators",
          action: "transport_voucher_updated",
          targetType: "user",
          targetId: collaborator.id,
          targetName: collaborator.username,
          metadata: {
            from_status: fromStatus,
            to_status: toStatus,
            value: nextUser.transportVoucherValue ?? null,
          },
        }).catch(() => undefined);
      }
      setTransportVoucherEditorOpen(false);
      setTransportVoucherMessage("Vale-transporte atualizado.");
    } catch (error) {
      setTransportVoucherMessage(error instanceof Error ? error.message : "Falha ao atualizar o vale-transporte.");
    } finally {
      setTransportVoucherSaving(false);
    }
  }

  const systemBlocks = [
    {
      id: "system.schedule_units" as const,
      className: "",
      visible: canShowSystemBlock(systemBlockKeys.schedule),
      content: (
        <Panel title="Escala e unidades" icon={Clock} className="h-full" action={systemBlockVisibilityControl(systemBlockKeys.schedule)}>
          <div className="grid gap-3">
            {canShowSystemField(SYSTEM_FIELD_KEYS.shift) ? (
            <div className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
              {shiftDef ? (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-[#1d1d26]">{shiftDef.name}</p>
                    <p className="mt-1 text-xs font-semibold text-[#817762]">
                      {shiftDef.startTime} - {shiftDef.endTime}
                      {shiftDef.breakStart && shiftDef.breakEnd ? ` | intervalo ${shiftDef.breakStart} - ${shiftDef.breakEnd}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {visibilityControl(SYSTEM_FIELD_KEYS.shift)}
                    <MonthSchedulePopover shiftDef={shiftDef} />
                    <Chip tone="good">Ativa</Chip>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#777784]">Sem turno atribuído.</p>
                  {visibilityControl(SYSTEM_FIELD_KEYS.shift)}
                </div>
              )}
            </div>
            ) : null}
            {canShowSystemField(SYSTEM_FIELD_KEYS.units) ? (
            <div className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase text-[#9d9da9]">Unidades</p>
                {visibilityControl(SYSTEM_FIELD_KEYS.units)}
              </div>
              {userUnits.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {userUnits.map((unit) => (
                    <span key={unit.id} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-[#4f4f5b] ring-1 ring-[#ececf0]">
                      <MapPin className="h-3.5 w-3.5" />
                      {unit.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-[#777784]">Nenhuma unidade vinculada.</p>
              )}
            </div>
            ) : null}
          </div>
        </Panel>
      ),
    },
    {
      id: "system.uniforms" as const,
      className: "",
      visible: canShowSystemBlock(systemBlockKeys.uniforms),
      content: (
        <Panel title="Uniformes" icon={Shirt} action={systemBlockVisibilityControl(systemBlockKeys.uniforms)}>
          <CollaboratorUniforms collaborator={user} />
        </Panel>
      ),
    },
    {
      id: "system.vacations" as const,
      className: "",
      visible: canShowSystemBlock(systemBlockKeys.vacations),
      content: (
        <Panel title="Férias" icon={Umbrella} className="h-full" action={systemBlockVisibilityControl(systemBlockKeys.vacations)}>
          {vacationsLoading ? (
            <div className="space-y-4">
              <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
              <div className="grid grid-cols-3 gap-2">
                <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
              </div>
            </div>
          ) : (
            <>
              <VacationCycleOverview
                admissionDate={admissionDate}
                cycle={currentVacationCycle}
                acquisitionCycle={currentAcquisitionCycle}
                overdueCycles={overdueVacationCycles}
              />
              <div className="mb-4 grid grid-cols-3 gap-2">
                <MiniStat label="Gozados" value={`${vacationTakenDays}d`} />
                <MiniStat label="A gozar" value={`${vacationBalanceDays}d`} />
                <MiniStat label="Registros" value={String(currentCycleVacations.length)} />
              </div>
              <VacationRows vacations={currentCycleVacations} />
            </>
          )}
        </Panel>
      ),
    },
    {
      id: "system.aso_control" as const,
      className: "",
      visible: canShowSystemBlock(systemBlockKeys.asoControl),
      content: (
        <EmployeeAsoControlPanel
          employeeId={collaborator.registrationIdBizneo || collaborator.id}
          reloadKey={fieldMapReloadKey}
          action={systemBlockVisibilityControl(systemBlockKeys.asoControl)}
        />
      ),
    },
    {
      id: "system.family_salary" as const,
      className: "",
      visible: canShowSystemBlock(systemBlockKeys.familySalary),
      content: (
        <EmployeeFamilySalaryPanel
          employeeId={collaborator.registrationIdBizneo || collaborator.id}
          reloadKey={fieldMapReloadKey}
          action={systemBlockVisibilityControl(systemBlockKeys.familySalary)}
          canEdit={canManageSystemFieldVisibility}
        />
      ),
    },
    {
      id: "system.transport_voucher" as const,
      className: "",
      visible: canShowSystemBlock(systemBlockKeys.transportVoucher),
      content: (
        <Panel title="Vale-transporte" icon={MapPin} action={systemBlockVisibilityControl(systemBlockKeys.transportVoucher)}>
          {canShowSystemField(SYSTEM_FIELD_KEYS.transportVoucher) ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-[#1d1d26]">Direito ao vale-transporte</p>
                    <p className="mt-1 text-xs font-medium text-[#777784]">
                      Controle local do benefício por dia trabalhado.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {visibilityControl(SYSTEM_FIELD_KEYS.transportVoucher)}
                    <Chip tone={transportVoucherStatus === "active" ? "good" : transportVoucherStatus === "suspended" ? "warn" : "default"}>
                      {transportVoucherStatusLabel(transportVoucherStatus)}
                    </Chip>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#9d9da9]">Situação atual</p>
                    {transportVoucherStatus === "active" ? (
                      <p className="mt-1 text-lg font-black text-[#1d1d26]">
                        Ativo
                        {collaborator.transportVoucherValue != null ? (
                          <span className="ml-2 text-sm font-bold text-[#777784]">
                            R$ {collaborator.transportVoucherValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/dia
                          </span>
                        ) : (
                          <span className="ml-2 text-sm font-bold text-amber-600">sem valor diário informado</span>
                        )}
                      </p>
                    ) : transportVoucherStatus === "suspended" ? (
                      <p className="mt-1 text-lg font-black text-amber-700">Suspenso</p>
                    ) : (
                      <p className="mt-1 text-lg font-black text-[#777784]">Ainda não configurado</p>
                    )}
                  </div>
                  {canManageTransportVoucher ? (
                    <button
                      type="button"
                      onClick={openTransportVoucherEditor}
                      className="inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground shadow-sm hover:bg-primary/90"
                    >
                      {transportVoucherStatus === "none" ? "Configurar vale-transporte" : "Editar vale-transporte"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#9d9da9]">Histórico</p>
                  <p className="mt-1 text-xs font-medium text-[#777784]">
                    {transportVoucherHistory.length > 0
                      ? `Última alteração: ${formatVacationDate(transportVoucherHistory[transportVoucherHistory.length - 1]?.effectiveDate)}`
                      : "Nenhuma alteração registrada."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {transportVoucherHistory.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setTransportVoucherHistoryOpen(true)}
                      className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                    >
                      Ver histórico
                    </button>
                  ) : null}
                </div>
              </div>
              {transportVoucherMessage ? (
                <p className={`rounded-xl px-3 py-2 text-xs font-bold ${transportVoucherMessage.startsWith("Falha") || transportVoucherMessage.includes("válido") ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}>
                  {transportVoucherMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ),
    },
    {
      id: "system.behavior" as const,
      className: "",
      visible: canShowSystemBlock(systemBlockKeys.behavior),
      content: (
        <Panel title="Comportamento no sistema" icon={TrendingUp} className="h-full" action={systemBlockVisibilityControl(systemBlockKeys.behavior)}>
          <div className="space-y-3">
            {[
              { key: SYSTEM_FIELD_KEYS.behaviorOperational, title: "Usuário operacional", desc: "Aparece nas escalas de trabalho e relatórios operacionais.", active: user.operacional },
              { key: SYSTEM_FIELD_KEYS.behaviorGoals, title: "Participa de metas", desc: "Incluído no acompanhamento de metas do quiosque.", active: user.participatesInGoals },
            ].filter((item) => canShowSystemField(item.key)).map(({ title, desc, active }) => (
              <div key={String(title)} className="flex items-center justify-between gap-4 rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
                <div>
                  <p className="text-sm font-black text-[#1d1d26]">{String(title)}</p>
                  <p className="mt-1 text-xs font-medium text-[#777784]">{String(desc)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {String(title) === "Participa de metas" ? <GoalsSummaryPopover participates={Boolean(active)} /> : null}
                  <span className={`h-6 w-11 rounded-full p-1 ${active ? "bg-pink-500" : "bg-slate-300"}`}>
                    <span className={`block h-4 w-4 rounded-full bg-white transition ${active ? "translate-x-5" : ""}`} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ),
    },
  ].sort((left, right) => blockOrder(left.id) - blockOrder(right.id));

  function renderSystemBlock(id: (typeof systemBlocks)[number]["id"], className = "") {
    const block = systemBlocks.find((item) => item.id === id && item.visible);
    if (!block) return null;
    return (
      <div id={profileSectionDomId(block.id)} key={block.id} className={`scroll-mt-[236px] ${className || block.className}`}>
        {block.content}
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] bg-[var(--bg)] p-2 text-[#1d1d26] md:p-3">
      <div className="mx-auto w-full max-w-[1600px] space-y-2.5">
        <TerminationDialog
          user={collaborator}
          open={terminationDialogOpen}
          saving={terminationSaving}
          onOpenChange={setTerminationDialogOpen}
          onConfirm={confirmTermination}
        />

        <div className="flex items-center gap-2">
          <BackButton
            fallbackHref="/dashboard/dp/collaborators"
            ariaLabel="Voltar à página anterior"
            iconOnly
            variant="ghost"
            className="h-8 w-8 rounded-lg bg-white p-0 text-[#777784] shadow-sm ring-1 ring-[#dedfe4] hover:bg-white hover:text-[#df2f78]"
            iconClassName="h-5 w-5"
          />
          <span className="text-xs font-black text-[#8f8f9b]">Departamento pessoal</span>
          <ChevronRight className="h-4 w-4 text-[#b5b5bf]" />
          <h1 className="min-w-0 truncate text-lg font-black leading-tight text-[#181820]">
            Painel de {displayName(user.username)}
          </h1>
        </div>

        <section className="sticky top-[72px] z-10 rounded-xl border border-[#dedfe4] bg-white/95 p-3 shadow-md backdrop-blur lg:top-[76px]">
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(0,1fr)_320px_40px] md:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative shrink-0">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.username} className="h-11 w-11 rounded-lg object-cover ring-2 ring-white" />
              ) : (
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-lg text-sm font-black text-white ring-2 ring-white ${avatarColor(user.username)}`}
                  style={user.color ? { backgroundColor: user.color } : undefined}
                >
                  {userInitials}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words text-base font-black leading-tight text-[#181820]">{user.username}</h2>
                <span
                  className="inline-flex max-w-full items-center rounded-full bg-[#eafaf2] px-2 py-0.5 text-[10px] font-black text-[#008963] sm:max-w-[220px]"
                  title={roleFunctionLabel}
                >
                  <span className="truncate">{roleFunctionLabel}</span>
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black ${
                    collaborator.employmentRelationshipType
                      ? "bg-sky-50 text-sky-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {employmentRelationshipLabel(collaborator.employmentRelationshipType)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f3f3f5] px-2 py-0.5 text-[10px] font-black text-[#6f6f7c]">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: user.color || "#e92828" }} />
                  Cor na escala
                </span>
              </div>
              <div className="mt-2 grid gap-x-5 gap-y-1.5 text-[10px] font-black text-[#24242e] md:grid-cols-4">
                <span>
                  <span className="block text-xs uppercase text-[#9d9da9]">E-mail</span>
                  <span className="mt-1 block max-w-[180px] truncate">{user.email}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-[#9d9da9]">Telefone</span>
                  <span className="mt-1 block">{(user as any).phone || "-"}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-[#9d9da9]">Último acesso</span>
                  <span className="mt-1 block">{fmtDate((user as any).lastLoginAt)}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-[#9d9da9]">Tempo de casa</span>
                  <span className="mt-1 block">{tenure(user.admissionDate)}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="min-w-0 md:w-[320px]">
            <EmployeeProfileHeaderSummary
              userId={user.id}
              bizneoEmployeeId={user.registrationIdBizneo}
              reloadKey={fieldMapReloadKey}
            />
          </div>
          <div className="flex shrink-0 items-center md:justify-end">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[#dedfe4] bg-white text-[#777784] shadow-sm hover:text-[#df2f78]"
                    title="Ações do colaborador"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 rounded-lg p-1.5">
                  <div className="space-y-1">
                    <Link
                      href={`/dashboard/dp/collaborators/${user.id}/edit`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil className="h-4 w-4 text-[#df2f78]" />
                      Editar dados
                    </Link>
                    {canManageSystemFieldVisibility ? (
                      <Link
                        href="/dashboard/settings?department=pessoal&tab=profile-fields"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
                      >
                        <Settings className="h-4 w-4 text-[#df2f78]" />
                        Editar campos
                      </Link>
                    ) : null}
                    <Link
                      href={`/dashboard/dp/collaborators/${user.id}/documents`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      <FileText className="h-4 w-4 text-[#df2f78]" />
                      Documentos do colaborador
                    </Link>
                    {canTerminateCollaborator ? (
                      <button
                        type="button"
                        onClick={() => setTerminationDialogOpen(true)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-black text-rose-700 hover:bg-rose-50"
                      >
                        <UserX className="h-4 w-4 text-rose-600" />
                      {terminationCopyForRelationship(collaborator.employmentRelationshipType).action}
                      </button>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
          </div>
        </div>
      </section>

        <EmployeeProfileFields user={user} profileName={profile?.name} reloadKey={fieldMapReloadKey} />

        <div className="space-y-2.5">
          {systemVisibilityMessage ? (
            <p className={`rounded-xl px-3 py-2 text-xs font-bold ${
              systemVisibilityMessage.startsWith("Falha")
                ? "bg-rose-50 text-rose-600"
                : "bg-emerald-50 text-emerald-700"
            }`}>
              {systemVisibilityMessage}
            </p>
          ) : null}
          <div className="grid gap-2.5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.35fr)]">
            <div className="space-y-2.5">
              {renderSystemBlock("system.schedule_units")}
              {renderSystemBlock("system.behavior")}
            </div>
            {renderSystemBlock("system.vacations")}
          </div>
          <div className="grid gap-2.5 xl:grid-cols-2">
            {renderSystemBlock("system.aso_control")}
            {renderSystemBlock("system.family_salary")}
          </div>
          <div className="grid gap-2.5 xl:grid-cols-2">
            {renderSystemBlock("system.uniforms")}
            {renderSystemBlock("system.transport_voucher")}
          </div>
        </div>
        {transportVoucherEditorOpen ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3">
            <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-black text-[#1d1d26]">Editar vale-transporte</p>
                  <p className="mt-0.5 text-xs font-semibold text-[#777784]">{user.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTransportVoucherEditorOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                >
                  ×
                </button>
              </div>

              <div className="mt-3 grid gap-2.5">
                <label className="grid gap-1 text-xs font-black text-[#1d1d26]">
                  Situação
                  <select
                    value={transportVoucherStatusDraft}
                    onChange={(event) => setTransportVoucherStatusDraft(event.target.value as "active" | "suspended")}
                    className="h-8 rounded-lg border border-[#dedfe4] bg-white px-2.5 text-xs font-bold outline-none focus:border-[#ec2f78]"
                  >
                    <option value="active">Ativo</option>
                    <option value="suspended">Suspenso</option>
                  </select>
                </label>

                {transportVoucherStatusDraft === "active" ? (
                  <label className="grid gap-1 text-xs font-black text-[#1d1d26]">
                    Valor por dia
                    <CurrencyInput
                      value={transportVoucherValueDraft}
                      onChange={setTransportVoucherValueDraft}
                      className="h-8 rounded-lg border-[#dedfe4] bg-white pl-8 text-xs font-bold outline-none focus:border-[#ec2f78] focus-visible:ring-0 focus-visible:ring-offset-0"
                      placeholder="0,00"
                    />
                  </label>
                ) : null}

                <label className="grid gap-1 text-xs font-black text-[#1d1d26]">
                  Data da alteração
                  <input
                    type="date"
                    value={transportVoucherEffectiveDate}
                    onChange={(event) => setTransportVoucherEffectiveDate(event.target.value)}
                    className="h-8 rounded-lg border border-[#dedfe4] bg-white px-2.5 text-xs font-bold outline-none focus:border-[#ec2f78]"
                  />
                </label>

                <label className="grid gap-1 text-xs font-black text-[#1d1d26]">
                  Motivo
                  <textarea
                    value={transportVoucherReason}
                    onChange={(event) => setTransportVoucherReason(event.target.value)}
                    className="min-h-16 rounded-lg border border-[#dedfe4] bg-white px-2.5 py-2 text-xs font-semibold outline-none focus:border-[#ec2f78]"
                    placeholder="Descreva o motivo da alteração."
                  />
                </label>
              </div>

              {transportVoucherMessage ? (
                <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{transportVoucherMessage}</p>
              ) : null}

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTransportVoucherEditorOpen(false)}
                  className="h-8 rounded-lg border border-[#dedfe4] bg-white px-3 text-xs font-black text-[#4f4f5b] hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={transportVoucherSaving}
                  onClick={() => void saveTransportVoucher()}
                  className="h-8 rounded-lg bg-[#ec2f78] px-3 text-xs font-black text-white shadow-sm hover:bg-[#d92b6e] disabled:opacity-60"
                >
                  {transportVoucherSaving ? "Salvando..." : "Salvar alteração"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {transportVoucherHistoryOpen ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3">
            <div className="w-full max-w-xl rounded-xl bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-black text-[#1d1d26]">Histórico do vale-transporte</p>
                  <p className="mt-0.5 text-xs font-semibold text-[#777784]">{user.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTransportVoucherHistoryOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                >
                  ×
                </button>
              </div>

              <div className="mt-3 max-h-[55vh] space-y-2 overflow-auto pr-1">
                {transportVoucherHistory.length > 0 ? [...transportVoucherHistory].reverse().map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-[#ececf0] bg-[#fbfbfc] p-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-[#1d1d26]">{formatTransportVoucherAction(entry)}</p>
                        <p className="mt-1 text-xs font-semibold text-[#777784]">
                          Vigência: {formatVacationDate(entry.effectiveDate)}
                          {entry.value != null ? ` · R$ ${entry.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/dia` : ""}
                        </p>
                      </div>
                      <Chip tone={entry.toStatus === "active" ? "good" : "warn"}>{transportVoucherStatusLabel(entry.toStatus)}</Chip>
                    </div>
                    <p className="mt-3 rounded-xl bg-white p-3 text-xs font-semibold text-[#4f4f5b]">{entry.reason}</p>
                    {entry.changedBy ? (
                      <p className="mt-2 text-[11px] font-semibold text-[#9d9da9]">
                        Alterado por {entry.changedBy.username} em {fmtDate(entry.changedAt, "dd/MM/yyyy HH:mm")}
                      </p>
                    ) : null}
                  </div>
                )) : (
                  <p className="rounded-2xl bg-[#f4f4f6] p-4 text-sm font-semibold text-[#777784]">Nenhuma alteração registrada.</p>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setTransportVoucherHistoryOpen(false)}
                  className="rounded-2xl bg-[#1d1d26] px-5 py-3 text-sm font-black text-white"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#f7f7f9] p-3 text-center">
      <p className="text-base font-black text-[#1d1d26]">{value}</p>
      <p className="text-[10px] font-bold text-[#777784]">{label}</p>
    </div>
  );
}
