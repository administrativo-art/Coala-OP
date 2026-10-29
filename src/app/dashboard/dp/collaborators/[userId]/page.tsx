"use client";

import React, { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format, differenceInDays, differenceInMonths, differenceInYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  FilePenLine,
  FileText,
  Globe2,
  IdCard,
  Image as ImageIcon,
  Loader2,
  Lock,
  MapPin,
  Menu,
  Pencil,
  Shirt,
  TimerReset,
  Umbrella,
  UserX,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { BackButton } from "@/components/navigation/back-button";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { createAuditLog } from "@/features/audit/client";
import type { DPUnit, DPVacationRecord, User, UserPdvAccess } from "@/types";
import { getHrEmployeeId } from "@/lib/hr/person-link";
import { CollaboratorUniforms } from "@/components/collaborator-uniforms";
import {
  useEmployeeProfile,
  type EmployeeProfileState,
} from "@/features/rh/hooks/useEmployeeProfile";
import { SectionEditModal } from "@/features/rh/components/SectionEditModal";
import type { EmployeeFieldValue, FieldMapEntry, FieldVisibility, NormalizedFieldVisibility, RhRole } from "@/types/rh";
import { canViewField, normalizeFieldVisibility } from "@/types/rh";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CYCLE_STATUS_CONFIG, getVacationCycleHistory, type VacationCycle } from "@/lib/utils/vacation-logic";
import { FieldValue } from "@/features/rh/components/FieldValue";
import { formatFieldValue } from "@/features/rh/lib/field-format";
import {
  HIDDEN_PROFILE_FIELD_KEYS,
  buildProfileDisplayItems,
  groupProfileSection,
  type CompositeFieldDef,
  type ProfileDisplayItem,
} from "@/features/rh/lib/profile-field-layout";
import { callOnFieldUpdate } from "@/features/rh/lib/rh-client";
import { DEFAULT_PROFILE_BLOCKS } from "@/features/rh/lib/default-field-map";
import {
  SYSTEM_BLOCK_KEYS,
  SYSTEM_BLOCK_FIELD_KEYS_BY_ID,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { SidePanel } from "@/components/patterns/side-panel";
import { UserManagement } from "@/components/user-management";
import { JUST_CAUSE_TYPES, requiresTerminationSubtype } from "@/lib/hr/termination-options";
import {
  employmentRelationshipLabel,
  isEmploymentRelationshipEligibleForAbsence,
  resolveEmploymentRelationshipType,
  terminationCopyForRelationship,
  terminationReasonsForRelationship,
  type EmploymentTerminationReason,
} from "@/lib/hr/employment-relationship";
import { createManagedTerminationProcess } from "@/features/hr/termination/client";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { Button } from "@/components/ui/button";
import { ContractChanges } from "@/components/dp/contract-changes";
import { contractProbationDates } from "@/components/dp/contract-probation-dates";

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
  public: "border-ds-ok-bg bg-ds-ok-bg text-ds-ok",
  restricted_partial: "border-ds-info-bg bg-ds-info-bg text-ds-info",
  restricted_total: "border-ds-warn-bg bg-ds-warn-bg text-ds-warn",
  confidential: "border-ds-danger-bg bg-ds-danger-bg text-ds-danger",
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
  PENDING: { label: "Pendente", className: "bg-ds-warn-bg text-ds-warn" },
  APPROVED: { label: "Aprovado", className: "bg-ds-ok-bg text-ds-ok" },
  REJECTED: { label: "Rejeitado", className: "bg-ds-danger-bg text-ds-danger" },
  PLANNED: { label: "Planejado", className: "bg-ds-info-bg text-ds-info" },
};

type TerminationPayload = {
  employerUnitId: string;
  terminationReason: EmploymentTerminationReason;
  terminationCause?: string;
  terminationNotes?: string;
  terminationInternalReason?: string;
  terminationDate: string;
  communicationConfirmed?: boolean;
  communicationAt?: string;
  communicationLocation?: string;
  communicationParticipants?: string[];
  noticeType?: "worked" | "indemnified";
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
    .replace(/\bcep\b/gi, "CEP")
    .replace(/\bpcd\b/gi, "PCD");
}

function profileDisplaySection(section: string) {
  const label = sectionDisplayLabel(section);
  if (label === "Dados pessoais" || label === "Documentos" || label === "Dados pessoais e documentos") {
    return MERGED_PERSONAL_DOCUMENTS_SECTION;
  }
  return label;
}

const PROFILE_NAVIGATION_GROUP_ORDER = [
  "Cadastro",
  "Financeiro e benefícios",
  "Operação e acessos",
  "Saúde e jornada",
] as const;

type ProfileNavigationGroup = (typeof PROFILE_NAVIGATION_GROUP_ORDER)[number];

function profileNavigationGroup(label: string): ProfileNavigationGroup {
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

  if (/beneficio|banc|pix|salario-familia|vale-transporte/.test(normalized)) {
    return "Financeiro e benefícios";
  }
  if (/sistema|escala|unidade|uniforme/.test(normalized)) {
    return "Operação e acessos";
  }
  if (/saude|aso|ferias|jornada/.test(normalized)) {
    return "Saúde e jornada";
  }
  return "Cadastro";
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
    <section className={`rounded-xl border border-ds-border bg-white shadow-xs ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-divider px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ds-accent-soft text-ds-accent-ink">
            <Icon className="h-5 w-5" />
          </span>
          <h2 className="min-w-0 text-sm font-black leading-tight text-ds-ink">{title}</h2>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const tones = {
    default: "bg-ds-neutral-bg text-ds-ink-muted",
    good: "bg-ds-ok-bg text-ds-ok",
    warn: "bg-ds-warn-bg text-ds-warn",
    bad: "bg-ds-danger-bg text-ds-danger",
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
        <div className="mb-2 flex items-start gap-2 rounded-md bg-ds-muted p-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-ds-ink-muted ring-1 ring-ds-border">
            <Eye className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-black text-ds-ink">Visibilidade do campo</p>
            <p className="mt-0.5 text-[10px] font-semibold leading-4 text-ds-ink-muted">
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
                    : "border-ds-divider bg-white text-ds-ink-2 hover:bg-ds-muted"
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
    ? "border-ds-border bg-ds-muted text-ds-ink-2"
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
        <div className="mb-2 flex items-start gap-2 rounded-md bg-ds-muted p-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-ds-ink-muted ring-1 ring-ds-border">
            <Eye className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-black text-ds-ink">Visibilidade do card</p>
            <p className="mt-0.5 text-[10px] font-semibold leading-4 text-ds-ink-muted">
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
                    : "border-ds-divider bg-white text-ds-ink-2 hover:bg-ds-muted"
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
    return <p className="rounded-2xl bg-ds-muted p-4 text-sm font-semibold text-ds-ink-muted">Nenhum registro neste ciclo.</p>;
  }

  return (
    <div className="space-y-2">
      {vacations.slice(0, 5).map((vacation) => {
        const status = VACATION_STATUS[vacation.status] ?? { label: vacation.status, className: "bg-ds-neutral-bg text-ds-ink-2" };
        return (
          <div key={vacation.id} className="rounded-2xl border border-ds-divider bg-ds-input p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black text-ds-ink">
                  {vacation.recordType === "gozo" ? "Gozo" : "Venda"} - {vacation.days} dia{vacation.days === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-ds-alert-ink">
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
      <div className="mb-4 rounded-2xl bg-ds-muted p-4 text-sm font-semibold text-ds-ink-muted">
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
      <div className="rounded-2xl border border-ds-divider bg-ds-muted p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-ds-ink-faint">{periodLabel}</p>
            <p className="mt-1 text-sm font-black text-ds-ink">
              {format(periodStart, "dd/MM/yyyy", { locale: ptBR })} - {format(periodEnd, "dd/MM/yyyy", { locale: ptBR })}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-black ${status.bg} ${status.text}`}>
            {status.label}
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-ds-divider">
          <div className="h-full rounded-full bg-ds-accent" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 grid gap-2 text-xs font-semibold text-ds-ink-muted sm:grid-cols-3">
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
        <div className="rounded-2xl border border-ds-divider bg-white p-3 text-xs font-semibold text-ds-ink-muted">
          <span className="font-black uppercase text-ds-ink-faint">Aquisição atual: </span>
          {format(acquisitionCycle.acquisitivePeriod.start, "dd/MM/yyyy", { locale: ptBR })} - {format(acquisitionCycle.acquisitivePeriod.end, "dd/MM/yyyy", { locale: ptBR })}
        </div>
      ) : null}
      {overdueCycles.length > 0 ? (
        <div className="rounded-2xl border border-ds-danger-bg bg-ds-danger-bg p-4 text-sm">
          <p className="font-black text-ds-danger">
            {overdueCycles.length === 1 ? "Há 1 ciclo vencido" : `Há ${overdueCycles.length} ciclos vencidos`}
          </p>
          <p className="mt-1 text-xs font-semibold text-ds-danger">
            Existe saldo de férias que já deveria ter sido gozado.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {overdueCycles.slice(0, 2).map((item) => (
              <div key={item.id} className="rounded-xl bg-white/75 p-3 text-xs font-bold text-ds-danger">
                <p>
                  Ciclo {format(item.acquisitivePeriod.start, "dd/MM/yyyy", { locale: ptBR })} - {format(item.acquisitivePeriod.end, "dd/MM/yyyy", { locale: ptBR })}
                </p>
                <p className="mt-1 text-ds-danger">Saldo vencido: {item.balance}d</p>
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
  if (status === "Enviada") return "bg-ds-ok-bg text-ds-ok";
  if (status === "Pendente") return "bg-ds-warn-bg text-ds-warn";
  return "bg-white text-ds-ink-muted ring-1 ring-ds-border";
}

function EmployeeAsoControlPanel({
  profileState,
  action,
}: {
  profileState: EmployeeProfileState;
  action?: React.ReactNode;
}) {
  if (profileState.status === "idle" || profileState.status === "loading") {
    return (
      <Panel title="Controle de ASOs" icon={FileText} action={action}>
        <div className="h-36 animate-pulse rounded-2xl bg-ds-neutral-bg" />
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
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-ds-divider bg-ds-input p-4">
          <div>
            <p className="text-sm font-black text-ds-ink">Prazos ocupacionais</p>
            <p className="mt-1 text-xs font-semibold text-ds-ink-muted">Periodicidade padrão: 24 meses, contado do último ASO válido.</p>
          </div>
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStat label="Último ASO válido" value={formatIsoDate(summary?.lastValidExamDate)} />
          <MiniStat label="Próximo periódico" value={formatIsoDate(summary?.nextPeriodicDue)} />
          <MiniStat label="Prazo" value={dateDistanceLabel(summary?.nextPeriodicDue) || "-"} />
        </div>

        {!summary || summary.admissionMissing ? (
          <p className="rounded-2xl border border-ds-danger-bg bg-ds-danger-bg p-3 text-xs font-bold text-ds-danger">
            Colaborador sem ASO admissional registrado. Ao arquivar o ASO admissional, a Mel usará a data real do exame para iniciar a previsão do periódico.
          </p>
        ) : null}

        {records.length > 0 ? (
          <div className="space-y-2">
            {records.map((record, index) => (
              <div key={`${record.type}-${record.examDate}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-ds-divider bg-white p-3">
                <div>
                  <p className="text-sm font-black text-ds-ink">{asoTypeLabel(record.type)}</p>
                  <p className="mt-0.5 text-xs font-semibold text-ds-ink-muted">{formatIsoDate(record.examDate)}</p>
                  {record.source === "legacy_field" ? (
                    <p className="mt-1 text-[11px] font-bold text-ds-warn">Campo antigo/manual: confirme pelo ASO anexado.</p>
                  ) : null}
                </div>
                {record.fitnessStatus ? <Chip tone="default">{record.fitnessStatus}</Chip> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-ds-muted p-4 text-sm font-semibold text-ds-ink-muted">Nenhum ASO arquivado pela Mel ainda.</p>
        )}
      </div>
    </Panel>
  );
}

function EmployeeFamilySalaryPanel({
  employeeId,
  profileState,
  onProfileChanged,
  action,
  canEdit,
}: {
  employeeId: string;
  profileState: EmployeeProfileState;
  onProfileChanged: () => void;
  action?: React.ReactNode;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<ChildDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (profileState.status === "idle" || profileState.status === "loading") {
    return (
      <Panel title="Salário-família" icon={IdCard} action={action}>
        <div className="h-36 animate-pulse rounded-2xl bg-ds-neutral-bg" />
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
      onProfileChanged();
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
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-ds-divider bg-ds-input p-4">
          <div>
            <p className="text-sm font-black text-ds-ink">Controle por filho</p>
            <p className="mt-1 text-xs font-semibold text-ds-ink-muted">Cota 2026: R$ {quota.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por filho elegível.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Chip tone={statusTone}>{statusLabel}</Chip>
            {canEdit && !editing ? (
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-black text-ds-accent-ink shadow-xs ring-1 ring-ds-accent-soft hover:bg-ds-accent-soft"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar filhos
              </button>
            ) : null}
          </div>
        </div>

        <p className="rounded-2xl border border-ds-warn-bg bg-ds-warn-bg p-3 text-xs font-bold text-ds-warn">
          Atenção: em 2026, o benefício depende de remuneração mensal até R$ {limit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, considerada como salário de contribuição total antes dos descontos.
        </p>

        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStat label="Elegíveis" value={String(summary?.eligibleDependentsCount ?? 0)} />
          <MiniStat label="Pendentes" value={String(summary?.pendingDependentsCount ?? 0)} />
          <MiniStat label="Filhos < 14" value={editing ? String(childCount) : (childrenUnder14 ?? String(childCount))} />
        </div>

        {editing ? (
          <div className="space-y-3 rounded-2xl border border-ds-divider bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
              <div>
                <label className="text-xs font-black text-ds-ink-muted">Quantidade de filhos</label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={drafts.length}
                  onChange={(event) => updateChildCount(Number(event.target.value))}
                  className="mt-1 h-11 w-full rounded-xl border border-ds-border bg-ds-input px-3 text-sm font-black text-ds-ink outline-hidden focus:border-ds-accent-ink focus:ring-2 focus:ring-ds-accent-soft"
                />
              </div>
              <p className="text-xs font-semibold text-ds-ink-muted">
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
                    <div key={draft.key} className="rounded-2xl border border-ds-divider bg-ds-input p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-ds-ink">Filho {index + 1}</p>
                        <Chip tone={age != null && age >= 14 ? "default" : required.length > 0 ? "warn" : "default"}>
                          {age == null ? "Nascimento pendente" : age >= 14 ? "Fora da idade" : `${age} ano${age === 1 ? "" : "s"}`}
                        </Chip>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-black text-ds-ink-muted">
                          Nome
                          <input
                            value={draft.name}
                            onChange={(event) => updateDraft(index, { name: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-ds-border bg-white px-3 text-sm font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink focus:ring-2 focus:ring-ds-accent-soft"
                          />
                        </label>
                        <label className="text-xs font-black text-ds-ink-muted">
                          Data de nascimento
                          <input
                            type="date"
                            value={draft.birthDate}
                            onChange={(event) => updateDraft(index, { birthDate: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-ds-border bg-white px-3 text-sm font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink focus:ring-2 focus:ring-ds-accent-soft"
                          />
                        </label>
                        <label className="text-xs font-black text-ds-ink-muted">
                          CPF
                          <input
                            value={draft.cpf}
                            onChange={(event) => updateDraft(index, { cpf: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-ds-border bg-white px-3 text-sm font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink focus:ring-2 focus:ring-ds-accent-soft"
                          />
                        </label>
                        <label className="text-xs font-black text-ds-ink-muted">
                          RG
                          <input
                            value={draft.rg}
                            onChange={(event) => updateDraft(index, { rg: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-ds-border bg-white px-3 text-sm font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink focus:ring-2 focus:ring-ds-accent-soft"
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entitlementEndsAt ? <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-ds-ink-muted ring-1 ring-ds-border">Até {formatIsoDate(entitlementEndsAt)}</span> : null}
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
              <p className="rounded-2xl bg-ds-muted p-4 text-sm font-semibold text-ds-ink-muted">Sem filhos cadastrados.</p>
            )}

            {message ? (
              <p className={`rounded-xl px-3 py-2 text-xs font-bold ${message.startsWith("Falha") ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-ok-bg text-ds-ok"}`}>
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
                className="rounded-xl border border-ds-border bg-white px-4 py-2 text-sm font-black text-ds-ink-2 hover:bg-ds-muted disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveChildren()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-accent px-4 py-2 text-sm font-black text-white hover:bg-ds-accent-hover disabled:opacity-60"
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
                <div key={dependent.key ?? `${dependent.name}-${index}`} className="rounded-xl border border-ds-divider bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-ds-ink">{dependent.name ?? "Filho sem nome"}</p>
                      <p className="mt-0.5 text-xs font-semibold text-ds-ink-muted">
                        {dependent.birthDate ? `${formatIsoDate(dependent.birthDate)} · ${age ?? "-"} ano${age === 1 ? "" : "s"}` : "Nascimento pendente"}
                      </p>
                      {dependent.entitlementEndsAt ? (
                        <p className="mt-0.5 text-[11px] font-bold text-ds-ink-muted">Conta para salário-família até {formatIsoDate(dependent.entitlementEndsAt)}</p>
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
          <p className="rounded-2xl bg-ds-muted p-4 text-sm font-semibold text-ds-ink-muted">Nenhum filho cadastrado para salário-família ainda.</p>
        )}

        {!editing && message ? (
          <p className={`rounded-xl px-3 py-2 text-xs font-bold ${message.startsWith("Falha") ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-ok-bg text-ds-ok"}`}>
            {message}
          </p>
        ) : null}
      </div>
    </Panel>
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
          className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-ds-ink-2 shadow-xs ring-1 ring-ds-border hover:bg-ds-muted"
        >
          12 meses
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] rounded-lg p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-ds-ink">Resumo de metas</p>
            <p className="mt-0.5 text-xs font-semibold text-ds-ink-muted">Últimos 12 meses</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-black ${participates ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-neutral-bg text-ds-ink-muted"}`}>
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
              <span className="font-black capitalize text-ds-ink-muted">{month}</span>
              <div className="h-1.5 rounded-full bg-ds-neutral-bg" />
              <span className="text-right font-black text-ds-ink-faint">-</span>
            </div>
          ))}
        </div>

        <p className="mt-2 rounded-md bg-ds-muted p-2 text-[10px] font-semibold leading-4 text-ds-ink-muted">
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
  /** Valor vindo do cadastro do sistema; a visibilidade não é configurável na ficha. */
  fixedVisibility?: boolean;
};

const EMPLOYMENT_RELATIONSHIP_FIELD_KEY = "system.employment.relationship";

/**
 * Lift da ficha no hover, como a linha das listas (`LiftRow`, escala de tabela). Vai no menor
 * bloco de leitura: no subgrupo quando a seção tem subgrupos; no card da seção quando não tem.
 */
const PROFILE_LIFT_CLASS = [
  "relative transition-[transform,box-shadow,border-color] duration-180 ease-ds-lift",
  "hover:z-3 hover:-translate-y-[3px] hover:scale-[1.006] hover:border-transparent hover:shadow-ds-lift",
  "motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100",
].join(" ");

const PROFILE_SUBGROUP_CLASS = `rounded-xl border border-ds-divider bg-ds-surface p-2.5 ${PROFILE_LIFT_CLASS}`;

function EmployeeProfileFields({
  user,
  units,
  onUpdateUser,
  profileState,
  onProfileChanged,
  onFieldMapChanged,
  onEditContract,
  children,
}: {
  user: User;
  units: DPUnit[];
  onUpdateUser: (user: User) => Promise<void>;
  profileState: EmployeeProfileState;
  onProfileChanged: () => void;
  onFieldMapChanged: () => void;
  onEditContract?: () => void;
  children?: React.ReactNode;
}) {
  const { firebaseUser, permissions, user: currentUser } = useAuth();
  const employeeId = getHrEmployeeId(user) ?? user.id;
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editComposite, setEditComposite] = useState<CompositeFieldDef | null>(null);
  const [visibilitySavingKey, setVisibilitySavingKey] = useState<string | null>(null);
  const [visibilityMessage, setVisibilityMessage] = useState<string | null>(null);
  const [systemActionSaving, setSystemActionSaving] = useState<string | null>(null);
  const [systemActionMessage, setSystemActionMessage] = useState<string | null>(null);
  const [pdvAccessOverride, setPdvAccessOverride] = useState<UserPdvAccess[] | null>(null);
  const [pdvEditorAccessId, setPdvEditorAccessId] = useState<string | null>(null);
  const [pdvUnitId, setPdvUnitId] = useState("");
  const [pdvProfileId, setPdvProfileId] = useState("");
  const [pdvProfiles, setPdvProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [pdvCatalogLoading, setPdvCatalogLoading] = useState(false);
  const [activeNavigationId, setActiveNavigationId] = useState<string | null>(null);

  useEffect(() => {
    if (profileState.status !== "ok") return;

    let observer: IntersectionObserver | null = null;
    const frame = window.requestAnimationFrame(() => {
      const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-profile-navigation-section]"));
      if (targets.length === 0) return;

      observer = new IntersectionObserver((entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visibleEntry?.target.id) setActiveNavigationId(visibleEntry.target.id);
      }, {
        rootMargin: "-180px 0px -58% 0px",
        threshold: [0, 0.1, 0.35],
      });
      targets.forEach((target) => observer?.observe(target));
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [profileState.status]);

  if (profileState.status === "idle" || profileState.status === "loading") {
    return (
      <div className="grid gap-2.5 lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="hidden rounded-xl border border-ds-border bg-white p-3 shadow-xs lg:block">
          <div className="mb-3 h-3 w-24 animate-pulse rounded bg-ds-neutral-bg" />
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="mb-2 h-9 animate-pulse rounded-lg bg-ds-neutral-bg" />
          ))}
        </aside>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, sectionIndex) => (
            <section key={sectionIndex} className="overflow-hidden rounded-xl border border-ds-border bg-white shadow-xs">
              <div className="flex items-center gap-3 border-b border-ds-divider px-3 py-2">
                <div className="h-6 w-6 animate-pulse rounded-md bg-ds-accent-soft" />
                <div className="h-3 w-32 animate-pulse rounded bg-ds-neutral-bg" />
              </div>
              <div className="grid gap-2 p-2.5 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((__, fieldIndex) => (
                  <div key={fieldIndex} className="h-16 animate-pulse rounded-xl bg-ds-neutral-bg" />
                ))}
              </div>
            </section>
          ))}
          {children}
        </div>
      </div>
    );
  }

  if (profileState.status === "error") {
    return (
      <div className="space-y-4">
        <Panel title="Perfil do colaborador" icon={IdCard}>
          <div className="rounded-2xl bg-ds-alert-bg p-4">
            <p className="text-sm font-black text-ds-ink">Campos do perfil indisponíveis</p>
            <p className="mt-1 text-xs font-semibold text-ds-alert-ink">
              Não foi possível carregar os campos deste colaborador. Motivo: {profileState.message}
            </p>
          </div>
        </Panel>
        {children}
      </div>
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
  const legacyPdvFilialId = user.pdvAccessFilialId?.trim() ?? "";
  const legacyPdvUnit = legacyPdvFilialId
    ? units.find((unit) => unit.pdvFilialId === legacyPdvFilialId)
    : user.unitIds?.length === 1
      ? units.find((unit) => unit.id === user.unitIds?.[0])
      : undefined;
  const legacyPdvAccess: UserPdvAccess[] = user.registrationIdPdv
    ? [{
        externalUserId: user.registrationIdPdv,
        filialId: legacyPdvFilialId,
        filialName: user.pdvAccessFilialName ?? null,
        profileId: user.pdvAccessProfileId ?? "",
        profileName: user.pdvAccessProfileName ?? null,
        unitId: legacyPdvUnit?.id ?? null,
        unitName: legacyPdvUnit?.name ?? null,
        status: "active",
      }]
    : [];
  const pdvAccesses = (pdvAccessOverride ?? (user.pdvAccesses?.length ? user.pdvAccesses : legacyPdvAccess))
    .filter((access) => access.status === "active");
  const pdvUnits = units.filter((unit) => !unit.isArchived && Boolean(unit.pdvFilialId));

  async function openPdvEditor(access: UserPdvAccess) {
    if (!firebaseUser || !canManageFieldVisibility) return;
    setPdvEditorAccessId(access.externalUserId);
    setPdvUnitId(access.unitId ?? pdvUnits.find((unit) => unit.pdvFilialId === access.filialId)?.id ?? "");
    setPdvProfileId(access.profileId);
    setPdvCatalogLoading(true);
    setSystemActionMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/hr/integrations/pdvlegal/catalog", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao carregar perfis do PDV.");
      setPdvProfiles(Array.isArray(payload.profiles) ? payload.profiles : []);
    } catch (error) {
      setSystemActionMessage(error instanceof Error ? error.message : "Falha ao carregar o catálogo do PDV.");
    } finally {
      setPdvCatalogLoading(false);
    }
  }

  async function savePdvAccess() {
    if (!firebaseUser || !pdvEditorAccessId || !pdvUnitId || !pdvProfileId || systemActionSaving) return;
    const unit = pdvUnits.find((item) => item.id === pdvUnitId);
    if (!unit?.pdvFilialId) {
      setSystemActionMessage("A unidade escolhida não possui filial do PDV vinculada.");
      return;
    }
    setSystemActionSaving(`pdv:${pdvEditorAccessId}`);
    setSystemActionMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/hr/collaborators/${encodeURIComponent(user.id)}/pdv-access`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          accessId: pdvEditorAccessId,
          unitId: unit.id,
          filialId: unit.pdvFilialId,
          profileId: pdvProfileId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao atualizar o acesso.");
      setPdvAccessOverride(Array.isArray(payload.accesses) ? payload.accesses : []);
      setPdvEditorAccessId(null);
      setSystemActionMessage("Unidade e perfil atualizados no PDV Legal.");
    } catch (error) {
      setSystemActionMessage(error instanceof Error ? error.message : "Falha ao atualizar o acesso.");
    } finally {
      setSystemActionSaving(null);
    }
  }

  async function removePdvAccess(access: UserPdvAccess) {
    if (!firebaseUser || !canManageFieldVisibility || systemActionSaving) return;
    if (!window.confirm(`Remover o acesso ${access.externalUserId} do PDV Legal${access.unitName ? ` na unidade ${access.unitName}` : ""}? Os outros acessos não serão afetados.`)) return;
    setSystemActionSaving(`pdv:${access.externalUserId}`);
    setSystemActionMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/hr/collaborators/${encodeURIComponent(user.id)}/pdv-access?accessId=${encodeURIComponent(access.externalUserId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao remover o acesso.");
      setPdvAccessOverride(Array.isArray(payload.accesses) ? payload.accesses : []);
      setSystemActionMessage("Acesso removido do PDV Legal. Os demais cadastros foram preservados.");
    } catch (error) {
      setSystemActionMessage(error instanceof Error ? error.message : "Falha ao remover o acesso.");
    } finally {
      setSystemActionSaving(null);
    }
  }

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
            category: entry.lgpd?.category ?? nextLgpd.category,
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
      onFieldMapChanged();
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
            category: entry.lgpd?.category ?? nextLgpd.category,
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
      onFieldMapChanged();
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
    if (HIDDEN_PROFILE_FIELD_KEYS.has(key)) return acc;
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
  const addSystemsRow = (row: EmployeeProfileFieldRow) => {
    const section = "Sistemas";
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
      value: pdvAccesses.map((access) => access.externalUserId).join(", ") || pdvRegistrationLabel(user),
      hasValue: pdvAccesses.length > 0 || pdvRegistrationLabel(user) !== "-",
    },
    {
      key: SYSTEM_FIELD_KEYS.loginCoalaOne,
      value: user.email || "-",
      hasValue: Boolean(user.email),
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
      value: Array.from(new Set(pdvAccesses.map((access) => access.profileName).filter(Boolean))).join(", ") || user.pdvAccessProfileName || "-",
      hasValue: pdvAccesses.some((access) => Boolean(access.profileName)) || Boolean(user.pdvAccessProfileName),
    },
  ].forEach((row) => {
    if (!canShowSystemProfileField(row.key)) return;
    addSystemsRow({
      key: row.key,
      entry: systemEntry(row.key),
      staticValue: row.value,
      staticHasValue: row.hasValue,
      readOnly: true,
    });
  });

  const contractSection = profileDisplaySection("Dados contratuais");
  sections[contractSection] = (sections[contractSection] ?? []).map((row) => ({ ...row, readOnly: true }));
  const addContractRow = (key: string, label: string, order: number, value: React.ReactNode, hasValue: boolean, inheritKey?: string) => {
    const fallback = fieldMap.fields[inheritKey ?? key] ?? systemField(label, contractSection, order, "restricted_partial");
    const entry = { ...fallback, label, section: contractSection, order };
    if (!canManageFieldVisibility && !canViewField(entry.visibility, role, visibilityContext, entry.access, fieldMap.access_matrix)) return;
    sections[contractSection] = (sections[contractSection] ?? []).filter((row) => row.key !== key);
    sections[contractSection].push({ key, entry, staticValue: hasValue ? value : "Não informado", staticHasValue: hasValue, readOnly: true });
  };
  const relationshipType = resolveEmploymentRelationshipType(user.employmentRelationshipType, user.personRecordType);
  addContractRow(EMPLOYMENT_RELATIONSHIP_FIELD_KEY, "Tipo de vínculo", 5, employmentRelationshipLabel(relationshipType), Boolean(relationshipType));
  const employer = units.find((unit) => unit.id === user.employerUnitId);
  addContractRow("employee.employer_cnpj", "CNPJ do empregador", 10, user.employerCnpj || employer?.cnpj || "", Boolean(user.employerCnpj || employer?.cnpj));
  addContractRow("system.contract.employer_unit", "Unidade empregadora", 15, user.employerUnitName || employer?.name || "", Boolean(user.employerUnitId));
  addContractRow("system.contract.admission", "Data de admissão", 25, fmtDate(user.admissionDate), Boolean(user.admissionDate));
  addContractRow("employee.job_role_id", "Cargo", 30, user.jobRoleName || user.jobRoleId || "", Boolean(user.jobRoleId));
  addContractRow("system.contract.functions", "Função", 35, user.jobFunctionNames?.join(", ") || user.jobFunctionIds?.join(", ") || "", Boolean(user.jobFunctionIds?.length), SYSTEM_FIELD_KEYS.functions);
  const probationDates = contractProbationDates(profileState.data.periodo_experiencia);
  addContractRow("system.contract.probation_start", "Início da experiência", 38, formatIsoDate(probationDates.start), Boolean(probationDates.start), "employee.probation_eval_1");
  const firstExperienceEnd = probationDates.firstEnd ?? fieldDateIso(fieldValues["employee.probation_eval_1"]);
  const secondExperienceEnd = probationDates.finalEnd ?? fieldDateIso(fieldValues["employee.probation_eval_2"]);
  addContractRow("employee.probation_eval_1", "Fim do 1º período de experiência", 40, formatIsoDate(firstExperienceEnd), Boolean(firstExperienceEnd));
  addContractRow("employee.probation_eval_2", "Fim do 2º período de experiência", 50, formatIsoDate(secondExperienceEnd), Boolean(secondExperienceEnd));
  addContractRow("system.contract.indefinite_start", probationDates.indefiniteLabel, 55, formatIsoDate(probationDates.indefiniteStart), Boolean(probationDates.indefiniteStart), "employee.probation_eval_2");
  const financial = units.find((unit) => unit.id === user.unitId);
  addContractRow("system.contract.financial_unit", "Unidade financeira", 60, financial?.name || user.unitId || "", Boolean(user.unitId));

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
  const systemGroups = [
    {
      id: "bizneo",
      title: "Bizneo",
      description: "Cadastro de RH, dados cadastrais e ponto.",
      keys: [SYSTEM_FIELD_KEYS.loginBizneo, SYSTEM_FIELD_KEYS.registrationBizneo],
    },
    {
      id: "pdv",
      title: "PDV Legal",
      description: "Acesso operacional ao caixa e às unidades vinculadas.",
      keys: [
        SYSTEM_FIELD_KEYS.loginPdv,
        SYSTEM_FIELD_KEYS.registrationPdv,
        SYSTEM_FIELD_KEYS.accessProfile,
      ],
    },
    {
      id: "coala",
      title: "Coala One",
      description: "Conta interna e funções no sistema.",
      keys: [
        SYSTEM_FIELD_KEYS.loginCoalaOne,
        SYSTEM_FIELD_KEYS.functions,
      ],
    },
  ];
  const profileNavigationItems = orderedSections.map((section) => {
    const sectionFields = sections[section] ?? [];
    const filledFields = sectionFields.filter(({ fv, staticValue, staticHasValue }) => (
      staticValue !== undefined ? Boolean(staticHasValue) : fieldHasValue(fv)
    )).length;
    const totalFields = sectionFields.length;
    return {
      id: profileSectionDomId(section),
      label: sectionDisplayLabel(section),
      group: profileNavigationGroup(sectionDisplayLabel(section)),
      statusLabel: `${filledFields}/${totalFields}`,
      statusTitle: `${filledFields} de ${totalFields} campos preenchidos`,
      statusTone: totalFields > 0 && filledFields === totalFields
        ? "complete"
        : filledFields > 0
          ? "partial"
          : "empty",
    } as const;
  });
  const systemNavigationItems = SYSTEM_NAV_LINKS
    .filter((link) => link.id !== "system.behavior")
    .filter((link) => (SYSTEM_BLOCK_FIELD_KEYS_BY_ID[link.id] ?? []).some((key) => {
      const entry = systemEntry(key);
      return canManageFieldVisibility
        || canViewField(entry.visibility, role, visibilityContext, entry.access, fieldMap.access_matrix);
    }))
    .map((link) => {
      const entries = (SYSTEM_BLOCK_FIELD_KEYS_BY_ID[link.id] ?? []).map(systemEntry);
      const visibility = getVisibilitySummary(entries);
      const statusLabel = visibility.mixed
        ? "Mista"
        : visibility.visibility === "public"
          ? "Visível"
          : visibility.visibility === "confidential"
            ? "Confidencial"
            : "Restrita";
      return {
        id: profileSectionDomId(link.id),
        label: link.label,
        group: profileNavigationGroup(link.label),
        statusLabel,
        statusTitle: visibility.mixed
          ? "Esta seção reúne campos com níveis de acesso diferentes"
          : FIELD_VISIBILITY_HELP[visibility.visibility],
        statusTone: visibility.visibility === "public"
          ? "complete"
          : visibility.visibility === "confidential"
            ? "confidential"
            : "restricted",
      } as const;
    });
  const profileNavigationItemsByGroup = PROFILE_NAVIGATION_GROUP_ORDER
    .map((group) => ({
      group,
      items: [...profileNavigationItems, ...systemNavigationItems].filter((item) => item.group === group),
    }))
    .filter(({ items }) => items.length > 0);
  const selectedNavigationId = activeNavigationId ?? profileNavigationItemsByGroup[0]?.items[0]?.id ?? null;

  const navigationStatusTone = {
    complete: "bg-ds-ok-bg text-ds-ok ring-ds-ok-bg",
    partial: "bg-ds-warn-bg text-ds-warn ring-ds-warn-bg",
    empty: "bg-ds-neutral-bg text-ds-ink-muted ring-ds-border",
    restricted: "bg-ds-info-bg text-ds-info ring-ds-info-bg",
    confidential: "bg-ds-danger-bg text-ds-danger ring-ds-danger-bg",
  } as const;

  function renderProfileFieldCard({ key, entry, fv, staticValue, staticHasValue, readOnly, fixedVisibility }: EmployeeProfileFieldRow) {
    const hasValue = staticValue !== undefined ? Boolean(staticHasValue) : fieldHasValue(fv);
    const readOnlyFromOrgChart = readOnly || key === "employee.job_role_id";
    return (
      <div key={key} className="rounded-xl border border-ds-divider bg-ds-input p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-black text-ds-ink-faint">{fieldDisplayLabel(entry.label)}</p>
            <div className="mt-1 text-xs font-black text-ds-ink">
              {staticValue !== undefined ? (
                staticValue
              ) : hasValue ? (
                <FieldValue fv={fv} type={entry.type} role={role} fieldKey={key} />
              ) : role !== "employee" && !readOnlyFromOrgChart ? (
                <button type="button" onClick={() => setEditKey(key)} className="text-ds-accent-ink">
                  + Adicionar
                </button>
              ) : (
                "-"
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {canManageFieldVisibility && !fixedVisibility ? (
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
                className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-ds-accent-ink shadow-xs ring-1 ring-ds-accent-soft hover:bg-ds-accent-soft"
              >
                Editar
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderCompositeCard(def: CompositeFieldDef, rows: EmployeeProfileFieldRow[]) {
    const rowsByKey = new Map(rows.map((row) => [row.key, row]));
    const value = def.format((fieldKey) => {
      const row = rowsByKey.get(fieldKey);
      if (!row) return null;
      const text = formatFieldValue(row.fv, row.entry.type, role, fieldKey);
      return text === "—" ? null : text;
    });
    const editable = role !== "employee" && rows.some((row) => !row.readOnly) && def.editKeys.some((fieldKey) => rowsByKey.has(fieldKey));
    const visibilityKey = `section:${def.label}`;
    return (
      <div key={def.id} className="rounded-xl border border-ds-divider bg-ds-input p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-black text-ds-ink-faint">{def.label}</p>
            <div className="mt-1 text-xs font-black text-ds-ink">
              {value ?? (editable ? (
                <button type="button" onClick={() => setEditComposite(def)} className="text-ds-accent-ink">
                  + Adicionar
                </button>
              ) : "-")}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {canManageFieldVisibility && rows[0] ? (
              <FieldVisibilityButton
                entry={rows[0].entry}
                saving={visibilitySavingKey === visibilityKey}
                disabled={Boolean(visibilitySavingKey && visibilitySavingKey !== visibilityKey)}
                onChange={(visibility) => void updateSectionVisibility(def.label, rows, visibility)}
              />
            ) : null}
            {editable && value ? (
              <button
                type="button"
                onClick={() => setEditComposite(def)}
                className="rounded-full bg-ds-surface px-2.5 py-1 text-xs font-black text-ds-accent-ink shadow-xs ring-1 ring-ds-accent-soft hover:bg-ds-accent-soft"
              >
                Editar
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderDisplayItem(item: ProfileDisplayItem<EmployeeProfileFieldRow>) {
    return item.kind === "field" ? renderProfileFieldCard(item.row) : renderCompositeCard(item.def, item.rows);
  }

  function renderSectionBody(section: string, sectionFields: EmployeeProfileFieldRow[]) {
    const items = buildProfileDisplayItems(sectionFields);
    const groups = groupProfileSection(section, items);
    if (!groups) {
      return (
        <div className="grid gap-2 p-2.5 md:grid-cols-2 xl:grid-cols-3">
          {items.map(renderDisplayItem)}
        </div>
      );
    }
    return (
      <div className="space-y-2.5 p-2.5">
        {groups.map((group) => (
          <div key={group.id} className={PROFILE_SUBGROUP_CLASS}>
            <div className="mb-2.5 px-0.5">
              <p className="text-xs font-black text-ds-ink">{group.title}</p>
              <p className="mt-0.5 text-[10px] font-semibold text-ds-ink-muted">{group.description}</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {group.items.map(renderDisplayItem)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibilityMessage ? (
        <p className={`rounded-xl px-3 py-2 text-xs font-bold ${
          visibilityMessage.startsWith("Falha") || visibilityMessage.startsWith("Sem permissão")
            ? "bg-ds-danger-bg text-ds-danger"
            : "bg-ds-ok-bg text-ds-ok"
        }`}>
          {visibilityMessage}
        </p>
      ) : null}
      {systemActionMessage ? (
        <p className={`rounded-xl px-3 py-2 text-xs font-bold ${
          systemActionMessage.startsWith("Falha") || systemActionMessage.includes("não ")
            ? "bg-ds-danger-bg text-ds-danger"
            : "bg-ds-ok-bg text-ds-ok"
        }`}>
          {systemActionMessage}
        </p>
      ) : null}

      <div className="grid gap-2.5 lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-[236px] lg:self-start">
          <nav aria-label="Seções do perfil" className="rounded-xl border border-ds-border bg-white p-2 shadow-xs">
            <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-3 lg:overflow-visible lg:pb-0">
              {profileNavigationItemsByGroup.map(({ group, items }) => (
                <div key={group} className="contents lg:block">
                  <p className="hidden px-2 text-[10px] font-black uppercase tracking-[0.12em] text-ds-ink-faint lg:block">
                    {group}
                  </p>
                  <div className="contents lg:mt-1 lg:block lg:space-y-1">
                    {items.map((item) => {
                      const active = item.id === selectedNavigationId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-current={active ? "location" : undefined}
                          onClick={() => {
                            setActiveNavigationId(item.id);
                            document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          className={`flex min-w-max items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-black transition lg:min-w-0 lg:w-full ${
                            active
                              ? "border-ds-accent-soft bg-ds-accent-soft text-ds-accent-ink-hover shadow-xs"
                              : "border-transparent text-ds-ink-muted hover:border-ds-divider hover:bg-ds-input hover:text-ds-accent-ink-hover"
                          }`}
                        >
                          <span className="max-w-[170px] whitespace-normal break-words leading-4 lg:max-w-[128px]">{item.label}</span>
                          <span
                            title={item.statusTitle}
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ring-1 ${navigationStatusTone[item.statusTone]}`}
                          >
                            {item.statusLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </aside>

        <div className="space-y-4">
          {orderedSections.map((section) => {
            const sectionFields = sections[section] ?? [];
            const sectionVisibility = getVisibilitySummary(sectionFields.map(({ entry }) => entry));
            const hasSubgroups = section === "Sistemas"
              || groupProfileSection(section, buildProfileDisplayItems(sectionFields)) !== null;
            return (
              <section data-profile-navigation-section id={profileSectionDomId(section)} key={section} className={`scroll-mt-[180px] rounded-xl border border-ds-border bg-white shadow-xs ${hasSubgroups ? "" : PROFILE_LIFT_CLASS}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-divider px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ds-accent-soft text-ds-accent-ink">
                      <IdCard className="h-4 w-4" />
                    </span>
                    <h3 className="text-xs font-black text-ds-ink">{sectionDisplayLabel(section)}</h3>
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
                {section === "Sistemas" ? (
                  <div className="space-y-2.5 p-2.5">
                    {systemGroups.map((group) => {
                      const groupFields = group.keys
                        .map((key) => sectionFields.find((field) => field.key === key))
                        .filter((field): field is EmployeeProfileFieldRow => Boolean(field));
                      if (groupFields.length === 0) return null;
                      return (
                        <div key={group.id} className={PROFILE_SUBGROUP_CLASS}>
                          <div className="mb-2.5 px-0.5">
                            <p className="text-xs font-black text-ds-ink">{group.title}</p>
                            <p className="mt-0.5 text-[10px] font-semibold text-ds-ink-muted">{group.description}</p>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {groupFields.map(renderProfileFieldCard)}
                          </div>
                          {group.id === "pdv" ? (
                            <div className="mt-2.5 space-y-2 border-t border-ds-divider pt-2.5">
                              <div className="flex items-center justify-between gap-3 px-0.5">
                                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-ds-ink-faint">Acessos por unidade</p>
                                <span className="text-[10px] font-black text-ds-ink-muted">{pdvAccesses.length} ativo{pdvAccesses.length === 1 ? "" : "s"}</span>
                              </div>
                              {pdvAccesses.length > 0 ? pdvAccesses.map((access) => (
                                <div key={access.externalUserId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ds-input p-3 ring-1 ring-ds-border">
                                  <div className="min-w-0">
                                    <p className="text-xs font-black text-ds-ink">
                                      {access.unitName ?? access.filialName ?? `Filial ${access.filialId || "não identificada"}`}
                                    </p>
                                    <p className="mt-1 text-[10px] font-bold text-ds-ink-muted">
                                      Usuário {access.externalUserId} · {access.profileName ?? "Perfil do PDV ainda não sincronizado"}
                                    </p>
                                  </div>
                                  {canManageFieldVisibility ? (
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                      <button
                                        type="button"
                                        disabled={Boolean(systemActionSaving)}
                                        onClick={() => void openPdvEditor(access)}
                                        className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black text-ds-info shadow-xs ring-1 ring-ds-info-bg hover:bg-ds-info-bg disabled:opacity-50"
                                      >
                                        Alterar unidade/perfil
                                      </button>
                                      <button
                                        type="button"
                                        disabled={Boolean(systemActionSaving)}
                                        onClick={() => void removePdvAccess(access)}
                                        className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black text-ds-danger shadow-xs ring-1 ring-ds-danger-bg hover:bg-ds-danger-bg disabled:opacity-50"
                                      >
                                        Remover acesso
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              )) : (
                                <p className="rounded-xl bg-ds-muted p-3 text-xs font-semibold text-ds-ink-muted">Nenhum acesso ativo vinculado.</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  renderSectionBody(section, sectionFields)
                )}
                {section === contractSection ? <><div className="px-3 pb-2">{canManageFieldVisibility && onEditContract ? <Button type="button" variant="ds-secondary" size="sm" onClick={onEditContract}>Editar dados contratuais</Button> : null}</div><ContractChanges userId={user.id} units={units} /></> : null}
              </section>
            );
          })}
          {children}
        </div>
      </div>

      {editKey && (
        <SectionEditModal
          employeeId={employee.bizneo_employee_id}
          editKey={editKey}
          fields={allFields}
          role={role}
          onClose={() => setEditKey(null)}
          onSaved={() => {
            setEditKey(null);
            onProfileChanged();
          }}
        />
      )}
      {editComposite && (
        <SectionEditModal
          employeeId={employee.bizneo_employee_id}
          editKey={editComposite.editKeys[0]}
          editKeys={editComposite.editKeys}
          groupLabel={editComposite.label.charAt(0).toLocaleLowerCase("pt-BR") + editComposite.label.slice(1)}
          deriveOnSave={editComposite.deriveOnSave}
          fields={allFields}
          role={role}
          onClose={() => setEditComposite(null)}
          onSaved={() => {
            setEditComposite(null);
            onProfileChanged();
          }}
        />
      )}
      {pdvEditorAccessId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-black text-ds-ink">Alterar acesso do PDV Legal</p>
                <p className="mt-0.5 text-xs font-semibold text-ds-ink-muted">Usuário PDV {pdvEditorAccessId}</p>
              </div>
              <button
                type="button"
                onClick={() => setPdvEditorAccessId(null)}
                className="grid h-9 w-9 place-items-center rounded-full bg-ds-neutral-bg text-ds-ink-muted hover:bg-ds-divider"
              >
                ×
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-xs font-black text-ds-ink">
                Unidade do Coala One
                <select
                  value={pdvUnitId}
                  onChange={(event) => setPdvUnitId(event.target.value)}
                  className="h-10 rounded-lg border border-ds-border bg-white px-3 text-xs font-bold outline-hidden focus:border-ds-accent-ink"
                >
                  <option value="">Selecione a unidade</option>
                  {pdvUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} · filial PDV {unit.pdvFilialId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-black text-ds-ink">
                Perfil de acesso do PDV
                <select
                  value={pdvProfileId}
                  disabled={pdvCatalogLoading}
                  onChange={(event) => setPdvProfileId(event.target.value)}
                  className="h-10 rounded-lg border border-ds-border bg-white px-3 text-xs font-bold outline-hidden focus:border-ds-accent-ink disabled:opacity-60"
                >
                  <option value="">{pdvCatalogLoading ? "Carregando perfis..." : "Selecione o perfil"}</option>
                  {pdvProfileId && !pdvProfiles.some((profile) => profile.id === pdvProfileId) ? (
                    <option value={pdvProfileId}>Perfil atual · ID {pdvProfileId}</option>
                  ) : null}
                  {pdvProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPdvEditorAccessId(null)}
                className="h-10 rounded-lg border border-ds-border px-4 text-xs font-black text-ds-ink-2 hover:bg-ds-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!pdvUnitId || !pdvProfileId || pdvCatalogLoading || Boolean(systemActionSaving)}
                onClick={() => void savePdvAccess()}
                className="h-10 rounded-lg bg-ds-accent px-4 text-xs font-black text-white hover:bg-ds-accent-hover disabled:opacity-50"
              >
                {systemActionSaving ? "Salvando..." : "Salvar no PDV"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Atalho só com ícone na barra do perfil: o nome aparece ao passar o mouse ou focar, e leitores de tela leem o rótulo. */
function HeaderIconLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            aria-label={label}
            className="grid h-9 w-9 place-items-center rounded-ds-btn border border-white/15 bg-white/[0.07] text-ds-accent shadow-xs hover:border-ds-accent hover:bg-white/[0.12] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-kicker"
          >
            {icon}
          </Link>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function TerminationDialog({
  user,
  units,
  open,
  saving,
  onOpenChange,
  onConfirm,
}: {
  user: User;
  units: DPUnit[];
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: TerminationPayload) => Promise<void>;
}) {
  const [terminationDate, setTerminationDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [employerUnitId, setEmployerUnitId] = useState("");
  const [terminationReason, setTerminationReason] = useState<EmploymentTerminationReason | "">("");
  const [terminationCause, setTerminationCause] = useState("");
  const [terminationNotes, setTerminationNotes] = useState("");
  const [terminationInternalReason, setTerminationInternalReason] = useState("");
  const [communicationAt, setCommunicationAt] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [communicationLocation, setCommunicationLocation] = useState("");
  const [communicationParticipants, setCommunicationParticipants] = useState("");
  const [communicationConfirmed, setCommunicationConfirmed] = useState(false);
  const [noticeType, setNoticeType] = useState<"worked" | "indemnified">("indemnified");
  const [message, setMessage] = useState<string | null>(null);
  const needsSubtype = requiresTerminationSubtype(terminationReason);
  const relationshipType = user.employmentRelationshipType;
  const availableReasons = terminationReasonsForRelationship(relationshipType)
    .filter((reason) => relationshipType !== "pj" || reason === "Encerramento por acordo entre as partes");
  const copy = terminationCopyForRelationship(relationshipType);
  const terminationAvailable = relationshipType === "clt" || relationshipType === "pj";
  const isWithoutCause = terminationReason === "Dispensa sem justa causa";
  const employerUnits = units.filter((unit) => CnpjValidator.validate(unit.cnpj ?? "").valid);

  useEffect(() => {
    if (!open) return;
    setTerminationDate(format(new Date(), "yyyy-MM-dd"));
    setEmployerUnitId(
      employerUnits.some((unit) => unit.id === user.employerUnitId)
        ? user.employerUnitId ?? ""
        : employerUnits.find((unit) => CnpjValidator.clean(unit.cnpj ?? "") === CnpjValidator.clean(user.employerCnpj ?? ""))?.id ?? "",
    );
    setTerminationReason("");
    setTerminationCause("");
    setTerminationNotes("");
    setTerminationInternalReason("");
    setCommunicationAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setCommunicationLocation("");
    setCommunicationParticipants("");
    setCommunicationConfirmed(false);
    setNoticeType("indemnified");
    setMessage(null);
  }, [open, user.employerCnpj, user.employerUnitId, units]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!terminationDate) {
      setMessage(copy.missingDate);
      return;
    }
    if (!employerUnitId) {
      setMessage("Selecione o CNPJ empregador responsável pelo vínculo.");
      return;
    }
    if (!terminationAvailable) {
      setMessage(
        relationshipType === "internship"
          ? "O fluxo específico de desligamento de estágio será implementado posteriormente."
          : relationshipType === "apprenticeship"
            ? "O fluxo específico de desligamento de aprendiz será implementado posteriormente."
            : relationshipType === "partner"
              ? "O fluxo específico de encerramento societário será implementado posteriormente."
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
    if (isWithoutCause && (!communicationAt || !communicationLocation.trim() || !communicationConfirmed || terminationInternalReason.trim().length < 3)) {
      setMessage("Preencha a comunicação presencial, o motivo interno e confirme que a colaboradora já foi comunicada.");
      return;
    }

    setMessage(null);
    await onConfirm({
      employerUnitId,
      terminationDate,
      terminationReason,
      terminationCause: needsSubtype ? terminationCause : undefined,
      terminationNotes: terminationNotes.trim() || undefined,
      terminationInternalReason: isWithoutCause ? terminationInternalReason.trim() : undefined,
      communicationConfirmed: isWithoutCause ? communicationConfirmed : undefined,
      communicationAt: isWithoutCause ? new Date(communicationAt).toISOString() : undefined,
      communicationLocation: isWithoutCause ? communicationLocation.trim() : undefined,
      communicationParticipants: isWithoutCause
        ? communicationParticipants.split(/[,\n]/).map((value) => value.trim()).filter(Boolean)
        : undefined,
      noticeType: isWithoutCause ? noticeType : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-xl p-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {copy.description} Colaborador: {displayName(user.username)}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <label className="block text-xs font-black uppercase tracking-wide text-ds-ink-muted">
            {relationshipType === "pj" ? "CNPJ da contratante" : "CNPJ empregador"}
            <select
              value={employerUnitId}
              onChange={(event) => setEmployerUnitId(event.target.value)}
              required
              className="mt-1 h-9 w-full rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink"
            >
              <option value="">Selecione a empresa responsável pelo vínculo</option>
              {employerUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>{unit.name} · {CnpjValidator.format(unit.cnpj ?? "")}</option>
              ))}
            </select>
            <span className="mt-1 block normal-case tracking-normal text-[11px] font-semibold text-ds-ink-muted">{relationshipType === "pj" ? "O sistema confirmará este CNPJ contra o contrato PJ assinado e congelará as duas partes no distrato." : "Este CNPJ será congelado no processo e usado no ASO, documentos, contabilidade e assinatura."}</span>
          </label>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="text-xs font-black uppercase tracking-wide text-ds-ink-muted">
              {isWithoutCause ? "Último dia de trabalho" : copy.dateLabel}
              <input
                type="date"
                value={terminationDate}
                onChange={(event) => setTerminationDate(event.target.value)}
                className="mt-1 h-8 w-full rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink"
              />
            </label>
            <label className="text-xs font-black uppercase tracking-wide text-ds-ink-muted">
              {copy.reasonLabel}
              <select
                value={terminationReason}
                onChange={(event) => {
                  const nextReason = event.target.value as EmploymentTerminationReason | "";
                  setTerminationReason(nextReason);
                  if (!requiresTerminationSubtype(nextReason)) setTerminationCause("");
                }}
                className="mt-1 h-8 w-full rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink"
              >
                <option value="">Selecione</option>
                {availableReasons.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </label>
          </div>

          {needsSubtype ? (
            <label className="block text-xs font-black uppercase tracking-wide text-ds-ink-muted">
              Subtipo da justa causa
              <select
                value={terminationCause}
                onChange={(event) => setTerminationCause(event.target.value)}
                className="mt-1 h-8 w-full rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink"
              >
                <option value="">Selecione</option>
                {JUST_CAUSE_TYPES.map((cause) => (
                  <option key={cause} value={cause}>{cause}</option>
                ))}
              </select>
            </label>
          ) : null}

          {isWithoutCause ? (
            <div className="space-y-4 rounded-xl border border-ds-accent-soft bg-ds-accent-soft/40 p-4">
              <div>
                <p className="text-sm font-black text-ds-ink">Comunicação presencial</p>
                <p className="mt-1 text-xs font-semibold text-ds-ink-muted">Registre a conversa que já aconteceu. A comunicação oficial será gerada para assinatura após a abertura.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-black uppercase tracking-wide text-ds-ink-muted">
                  Data e hora da comunicação
                  <input type="datetime-local" value={communicationAt} onChange={(event) => setCommunicationAt(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink" />
                </label>
                <label className="text-xs font-black uppercase tracking-wide text-ds-ink-muted">
                  Local
                  <input value={communicationLocation} onChange={(event) => setCommunicationLocation(event.target.value)} placeholder="Ex.: sala administrativa" className="mt-1 h-9 w-full rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink" />
                </label>
                <label className="text-xs font-black uppercase tracking-wide text-ds-ink-muted">
                  Aviso-prévio
                  <select value={noticeType} onChange={(event) => setNoticeType(event.target.value as "worked" | "indemnified")} className="mt-1 h-9 w-full rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink">
                    <option value="indemnified">Indenizado</option>
                    <option value="worked">Trabalhado</option>
                  </select>
                </label>
                <label className="text-xs font-black uppercase tracking-wide text-ds-ink-muted">
                  Outros participantes
                  <input value={communicationParticipants} onChange={(event) => setCommunicationParticipants(event.target.value)} placeholder="Separe os nomes por vírgula" className="mt-1 h-9 w-full rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold text-ds-ink outline-hidden focus:border-ds-accent-ink" />
                </label>
              </div>
              <label className="flex items-start gap-3 rounded-xl border border-ds-accent-soft bg-white p-3 text-sm font-bold text-ds-ink">
                <input type="checkbox" checked={communicationConfirmed} onChange={(event) => setCommunicationConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-ds-accent" />
                <span>Confirmo que a colaboradora já foi comunicada presencialmente sobre seu desligamento.</span>
              </label>
            </div>
          ) : null}

          {isWithoutCause ? (
            <label className="block text-xs font-black uppercase tracking-wide text-ds-ink-muted">
              Motivo interno e confidencial
              <Textarea value={terminationInternalReason} onChange={(event) => setTerminationInternalReason(event.target.value)} placeholder="Obrigatório. Esta informação não será exibida no comunicado da colaboradora." className="mt-1 min-h-16 rounded-lg border-ds-border text-xs font-semibold" />
            </label>
          ) : null}

          <label className="block text-xs font-black uppercase tracking-wide text-ds-ink-muted">
            {isWithoutCause ? "Observações internas" : "Observações"}
            <Textarea
              value={terminationNotes}
              onChange={(event) => setTerminationNotes(event.target.value)}
              placeholder="Opcional"
              className="mt-1 min-h-16 rounded-lg border-ds-border text-xs font-semibold"
            />
          </label>

          {message ? (
            <p className="rounded-2xl border border-ds-warn-bg bg-ds-warn-bg px-3 py-2 text-xs font-bold text-ds-warn">{message}</p>
          ) : null}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="rounded-2xl border border-ds-border bg-white px-4 py-2.5 text-sm font-black text-ds-ink-2 hover:bg-ds-muted disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !terminationAvailable}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-ds-accent px-4 py-2.5 text-sm font-black text-white hover:bg-ds-accent-hover disabled:opacity-60"
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeUsers, terminatedUsers, permissions, firebaseUser, user: currentUser, updateUser, isDefaultAdmin } = useAuth();
  const { toast } = useToast();
  const { shiftDefinitions, units, vacations, vacationsLoading } = useDPBootstrap();
  const [fieldMapReloadKey, setFieldMapReloadKey] = useState(0);
  const [employeeProfileReloadKey, setEmployeeProfileReloadKey] = useState(0);
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editDrawerDirty, setEditDrawerDirty] = useState(false);
  const [discardEditOpen, setDiscardEditOpen] = useState(false);
  const editDrawerOpen = searchParams.get("panel") === "edit-data";
  const allUsers: User[] = [...activeUsers, ...terminatedUsers];
  const user = allUsers.find((entry) => entry.id === userId);
  const employeeId = user ? getHrEmployeeId(user) ?? user.id : "";
  const employeeProfileState = useEmployeeProfile(
    employeeId,
    fieldMapReloadKey + employeeProfileReloadKey,
  );
  const profileLayout = employeeProfileState.status === "ok"
    ? employeeProfileState.data.fieldMap
    : null;

  function reloadEmployeeProfile() {
    setEmployeeProfileReloadKey((value) => value + 1);
  }

  function reloadEmployeeFieldMap() {
    setFieldMapReloadKey((value) => value + 1);
  }

  const setEditDrawerInUrl = useCallback((open: boolean) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (open) nextParams.set("panel", "edit-data");
    else nextParams.delete("panel");
    const query = nextParams.toString();
    const href = `/dashboard/dp/collaborators/${encodeURIComponent(userId)}${query ? `?${query}` : ""}`;
    if (open) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }, [router, searchParams, userId]);

  const requestEditDrawerClose = useCallback((reason: 'cancel' | 'saved' = 'cancel') => {
    if (reason !== 'saved' && editDrawerDirty) {
      setDiscardEditOpen(true);
      return;
    }
    setDiscardEditOpen(false);
    setEditDrawerDirty(false);
    if (reason === 'saved') setEmployeeProfileReloadKey((value) => value + 1);
    setEditDrawerInUrl(false);
  }, [editDrawerDirty, setEditDrawerInUrl]);

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
  const viewingOwnProfile = firebaseUser?.uid === collaborator.id || currentUser?.id === collaborator.id;
  const canReadTimeRecording = Boolean(
    viewingOwnProfile || isDefaultAdmin || permissions.dp?.timeRecording?.view === true
      || permissions.dp?.timeClosure?.close === true || permissions.dp?.timeClosure?.reopen === true
  );
  const timeRecordingHref = viewingOwnProfile
    ? "/dashboard/collaborator/time-recording"
    : `/dashboard/dp/collaborators/${encodeURIComponent(collaborator.id)}/time-recording`;
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
            category: entry.lgpd?.category ?? nextLgpd.category,
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
            category: entry.lgpd?.category ?? nextLgpd.category,
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
  const isOwnProfile = Boolean(
    currentUser?.id === collaborator.id || firebaseUser?.uid === collaborator.id
  );
  const canRequestOwnResignation = Boolean(
    isOwnProfile && !isTerminated && isEmploymentRelationshipEligibleForAbsence(collaborator.employmentRelationshipType)
  );

  async function confirmTermination(payload: TerminationPayload) {
    if (!canTerminateCollaborator || terminationSaving || !firebaseUser) return;
    setTerminationSaving(true);
    try {
      const result = await createManagedTerminationProcess(firebaseUser, {
        employeeId: collaborator.id,
        employerUnitId: payload.employerUnitId,
        terminationDate: payload.terminationDate,
        terminationReason: payload.terminationReason,
        terminationCause: payload.terminationCause,
        terminationNotes: payload.terminationNotes,
        terminationInternalReason: payload.terminationInternalReason,
        communicationConfirmed: payload.communicationConfirmed,
        communicationAt: payload.communicationAt,
        communicationLocation: payload.communicationLocation,
        communicationParticipants: payload.communicationParticipants,
        noticeType: payload.noticeType,
      });
      setTerminationDialogOpen(false);
      toast({
        title: result.reused ? "Processo de desligamento já existente." : "Processo de desligamento iniciado.",
        description: `${displayName(collaborator.username)} permanecerá com acesso até a conclusão formal do processo.`,
      });
      router.push(`/dashboard/dp/terminations/${result.process.id}`);
    } catch (error) {
      toast({
        title: "Erro ao iniciar desligamento.",
        description: error instanceof Error ? error.message : "Não foi possível criar o processo formal.",
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
            <div className="rounded-xl border border-ds-divider bg-ds-input p-3">
              {shiftDef ? (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-ds-ink">{shiftDef.name}</p>
                    <p className="mt-1 text-xs font-semibold text-ds-alert-ink">
                      {shiftDef.startTime} - {shiftDef.endTime}
                      {shiftDef.breakStart && shiftDef.breakEnd ? ` | intervalo ${shiftDef.breakStart} - ${shiftDef.breakEnd}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {visibilityControl(SYSTEM_FIELD_KEYS.shift)}
                    <Chip tone="good">Ativa</Chip>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ds-ink-muted">Sem turno atribuído.</p>
                  {visibilityControl(SYSTEM_FIELD_KEYS.shift)}
                </div>
              )}
            </div>
            ) : null}
            {canShowSystemField(SYSTEM_FIELD_KEYS.units) ? (
            <div className="rounded-xl border border-ds-divider bg-ds-input p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase text-ds-ink-faint">Unidades</p>
                {visibilityControl(SYSTEM_FIELD_KEYS.units)}
              </div>
              {userUnits.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {userUnits.map((unit) => (
                    <span key={unit.id} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-ds-ink-2 ring-1 ring-ds-border">
                      <MapPin className="h-3.5 w-3.5" />
                      {unit.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-ds-ink-muted">Nenhuma unidade vinculada.</p>
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
              <div className="h-28 animate-pulse rounded-2xl bg-ds-neutral-bg" />
              <div className="grid grid-cols-3 gap-2">
                <div className="h-16 animate-pulse rounded-2xl bg-ds-neutral-bg" />
                <div className="h-16 animate-pulse rounded-2xl bg-ds-neutral-bg" />
                <div className="h-16 animate-pulse rounded-2xl bg-ds-neutral-bg" />
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
          profileState={employeeProfileState}
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
          employeeId={employeeId}
          profileState={employeeProfileState}
          onProfileChanged={reloadEmployeeProfile}
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
              <div className="rounded-xl border border-ds-divider bg-ds-input p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-ds-ink">Direito ao vale-transporte</p>
                    <p className="mt-1 text-xs font-medium text-ds-ink-muted">
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
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-ds-ink-faint">Situação atual</p>
                    {transportVoucherStatus === "active" ? (
                      <p className="mt-1 text-lg font-black text-ds-ink">
                        Ativo
                        {collaborator.transportVoucherValue != null ? (
                          <span className="ml-2 text-sm font-bold text-ds-ink-muted">
                            R$ {collaborator.transportVoucherValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/dia
                          </span>
                        ) : (
                          <span className="ml-2 text-sm font-bold text-ds-warn">sem valor diário informado</span>
                        )}
                      </p>
                    ) : transportVoucherStatus === "suspended" ? (
                      <p className="mt-1 text-lg font-black text-ds-warn">Suspenso</p>
                    ) : (
                      <p className="mt-1 text-lg font-black text-ds-ink-muted">Ainda não configurado</p>
                    )}
                  </div>
                  {canManageTransportVoucher ? (
                    <button
                      type="button"
                      onClick={openTransportVoucherEditor}
                      className="inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground shadow-xs hover:bg-primary/90"
                    >
                      {transportVoucherStatus === "none" ? "Configurar vale-transporte" : "Editar vale-transporte"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ds-muted p-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-ds-ink-faint">Histórico</p>
                  <p className="mt-1 text-xs font-medium text-ds-ink-muted">
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
                      className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-ds-ink-2 shadow-xs ring-1 ring-ds-border hover:bg-ds-muted"
                    >
                      Ver histórico
                    </button>
                  ) : null}
                </div>
              </div>
              {transportVoucherMessage ? (
                <p className={`rounded-xl px-3 py-2 text-xs font-bold ${transportVoucherMessage.startsWith("Falha") || transportVoucherMessage.includes("válido") ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-ok-bg text-ds-ok"}`}>
                  {transportVoucherMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ),
    },
  ].sort((left, right) => blockOrder(left.id) - blockOrder(right.id));

  function renderSystemBlock(id: (typeof systemBlocks)[number]["id"], className = "") {
    const block = systemBlocks.find((item) => item.id === id && item.visible);
    if (!block) return null;
    return (
      <div data-profile-navigation-section id={profileSectionDomId(block.id)} key={block.id} className={`scroll-mt-[236px] rounded-xl ${PROFILE_LIFT_CLASS} ${className || block.className}`}>
        {block.content}
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] bg-(--bg) p-2 text-ds-ink md:p-3">
      <div className="w-full space-y-2.5">
        <TerminationDialog
          user={collaborator}
          units={units}
          open={terminationDialogOpen}
          saving={terminationSaving}
          onOpenChange={setTerminationDialogOpen}
          onConfirm={confirmTermination}
        />

        {canManageSystemFieldVisibility ? (
          <SidePanel
            open={editDrawerOpen}
            onOpenChange={(open) => {
              if (open) setEditDrawerInUrl(true);
              else requestEditDrawerClose('cancel');
            }}
            kicker="Editar colaborador"
            title={displayName(collaborator.username)}
            subtitle="Identificação, atuação, jornada e comportamento no sistema."
            className="w-[min(920px,100vw)]"
          >
            <UserManagement
              editUserId={collaborator.id}
              presentation="drawer"
              contextLabel="Gestão do colaborador › Editar dados"
              onDirtyChange={setEditDrawerDirty}
              onClose={requestEditDrawerClose}
            />
          </SidePanel>
        ) : null}

        <AlertDialog open={discardEditOpen} onOpenChange={setDiscardEditOpen}>
          <AlertDialogContent className="rounded-ds-card border-ds-border bg-ds-surface font-ds">
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
              <AlertDialogDescription>
                As alterações feitas nos dados do colaborador ainda não foram salvas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuar editando</AlertDialogCancel>
              <AlertDialogAction
                className="bg-ds-danger text-white hover:bg-ds-danger"
                onClick={() => {
                  setEditDrawerDirty(false);
                  setDiscardEditOpen(false);
                  setEditDrawerInUrl(false);
                }}
              >
                Descartar alterações
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex items-center gap-2">
          <BackButton
            fallbackHref="/dashboard/dp/collaborators"
            ariaLabel="Voltar à página anterior"
            iconOnly
            variant="ghost"
            className="h-8 w-8 rounded-lg bg-white p-0 text-ds-ink-muted shadow-xs ring-1 ring-ds-border hover:bg-white hover:text-ds-accent-ink"
            iconClassName="h-5 w-5"
          />
          <span className="text-xs font-black text-ds-ink-muted">Departamento pessoal</span>
          <ChevronRight className="h-4 w-4 text-ds-ink-faint" />
          <h1 className="min-w-0 truncate text-lg font-black leading-tight text-ds-ink">
            Painel de {displayName(user.username)}
          </h1>
        </div>

        <section className="sticky top-[72px] z-10 rounded-xl border border-white/10 bg-ds-ink/95 p-3 shadow-md backdrop-blur-sm lg:top-[76px]">
        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_320px_auto] xl:items-center">
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
                <h2 className="min-w-0 wrap-break-word text-base font-black leading-tight text-white">{user.username}</h2>
                <span
                  className="inline-flex max-w-full items-center rounded-full bg-ds-ok-bg px-2 py-0.5 text-[10px] font-black text-ds-ok sm:max-w-[220px]"
                  title={roleFunctionLabel}
                >
                  <span className="truncate">{roleFunctionLabel}</span>
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black ${
                    collaborator.employmentRelationshipType
                      ? "bg-ds-info-bg text-ds-info"
                      : "bg-ds-warn-bg text-ds-warn"
                  }`}
                >
                  {employmentRelationshipLabel(collaborator.employmentRelationshipType)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ds-neutral-bg px-2 py-0.5 text-[10px] font-black text-ds-ink-muted">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: user.color || "#e92828" }} />
                  Cor na escala
                </span>
              </div>
              <div className="mt-2 grid gap-x-5 gap-y-1.5 text-[10px] font-black text-white md:grid-cols-4">
                <span>
                  <span className="block text-xs uppercase text-ds-on-dark-muted">E-mail</span>
                  <span className="mt-1 block max-w-[180px] truncate">{user.email}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-ds-on-dark-muted">Telefone</span>
                  <span className="mt-1 block">{(user as any).phone || "-"}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-ds-on-dark-muted">Último acesso</span>
                  <span className="mt-1 block">{fmtDate((user as any).lastLoginAt)}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-ds-on-dark-muted">Tempo de casa</span>
                  <span className="mt-1 block">{tenure(user.admissionDate)}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="shrink-0">
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {canManageSystemFieldVisibility ? (
                <button
                  type="button"
                  onClick={() => setEditDrawerInUrl(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-ds-btn border border-ds-accent bg-ds-accent px-3 text-xs font-extrabold text-white shadow-xs hover:border-ds-accent-hover hover:bg-ds-accent-hover"
                >
                  <Pencil className="h-4 w-4" />
                  Editar dados
                </button>
              ) : null}
              <HeaderIconLink href={`/dashboard/dp/collaborators/${user.id}/documents`} label="Documentos" icon={<FileText className="h-[18px] w-[18px]" />} />
              {canReadTimeRecording ? (
                <>
                  <HeaderIconLink href={timeRecordingHref} label="Registro de ponto" icon={<Clock className="h-[18px] w-[18px]" />} />
                  <HeaderIconLink href={`${timeRecordingHref}?view=time-bank`} label="Banco de horas" icon={<TimerReset className="h-[18px] w-[18px]" />} />
                </>
              ) : null}
              <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/[0.07] text-ds-on-dark-2 shadow-xs hover:border-ds-accent hover:text-white"
                    title="Ações do colaborador"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 rounded-lg p-1.5">
                  <div className="space-y-1">
                    <Link
                      href={`/dashboard/documents/consents/${encodeURIComponent(getHrEmployeeId(collaborator) ?? collaborator.id)}`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-black text-ds-ink-2 hover:bg-ds-muted"
                    >
                      <ImageIcon className="h-4 w-4 text-ds-accent-ink" />
                      Consentimento de imagem e voz
                    </Link>
                    {canRequestOwnResignation ? (
                      <Link
                        href="/dashboard/resignation"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-black text-ds-danger hover:bg-ds-danger-bg"
                      >
                        <FilePenLine className="h-4 w-4 text-ds-danger" />
                        Pedir demissão
                      </Link>
                    ) : null}
                    {canTerminateCollaborator ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActionsOpen(false);
                          setTerminationDialogOpen(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-black text-ds-danger hover:bg-ds-danger-bg"
                      >
                        <UserX className="h-4 w-4 text-ds-danger" />
                      {terminationCopyForRelationship(collaborator.employmentRelationshipType).action}
                      </button>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </section>

        <EmployeeProfileFields
          user={user}
          units={units}
          onUpdateUser={updateUser}
          profileState={employeeProfileState}
          onProfileChanged={reloadEmployeeProfile}
          onFieldMapChanged={reloadEmployeeFieldMap}
          onEditContract={() => setEditDrawerInUrl(true)}
        >
          <div className="space-y-2.5">
            {systemVisibilityMessage ? (
              <p className={`rounded-xl px-3 py-2 text-xs font-bold ${
                systemVisibilityMessage.startsWith("Falha")
                  ? "bg-ds-danger-bg text-ds-danger"
                  : "bg-ds-ok-bg text-ds-ok"
              }`}>
                {systemVisibilityMessage}
              </p>
            ) : null}
            <div className="grid gap-2.5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.35fr)]">
              <div className="space-y-2.5">
                {renderSystemBlock("system.schedule_units")}

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
        </EmployeeProfileFields>
        {transportVoucherEditorOpen ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3">
            <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-black text-ds-ink">Editar vale-transporte</p>
                  <p className="mt-0.5 text-xs font-semibold text-ds-ink-muted">{user.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTransportVoucherEditorOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-full bg-ds-neutral-bg text-ds-ink-muted hover:bg-ds-divider"
                >
                  ×
                </button>
              </div>

              <div className="mt-3 grid gap-2.5">
                <label className="grid gap-1 text-xs font-black text-ds-ink">
                  Situação
                  <select
                    value={transportVoucherStatusDraft}
                    onChange={(event) => setTransportVoucherStatusDraft(event.target.value as "active" | "suspended")}
                    className="h-8 rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold outline-hidden focus:border-ds-accent-ink"
                  >
                    <option value="active">Ativo</option>
                    <option value="suspended">Suspenso</option>
                  </select>
                </label>

                {transportVoucherStatusDraft === "active" ? (
                  <label className="grid gap-1 text-xs font-black text-ds-ink">
                    Valor por dia
                    <CurrencyInput
                      value={transportVoucherValueDraft}
                      onChange={setTransportVoucherValueDraft}
                      className="h-8 rounded-lg border-ds-border bg-white pl-8 text-xs font-bold outline-hidden focus:border-ds-accent-ink focus-visible:ring-0 focus-visible:ring-offset-0"
                      placeholder="0,00"
                    />
                  </label>
                ) : null}

                <label className="grid gap-1 text-xs font-black text-ds-ink">
                  Data da alteração
                  <input
                    type="date"
                    value={transportVoucherEffectiveDate}
                    onChange={(event) => setTransportVoucherEffectiveDate(event.target.value)}
                    className="h-8 rounded-lg border border-ds-border bg-white px-2.5 text-xs font-bold outline-hidden focus:border-ds-accent-ink"
                  />
                </label>

                <label className="grid gap-1 text-xs font-black text-ds-ink">
                  Motivo
                  <textarea
                    value={transportVoucherReason}
                    onChange={(event) => setTransportVoucherReason(event.target.value)}
                    className="min-h-16 rounded-lg border border-ds-border bg-white px-2.5 py-2 text-xs font-semibold outline-hidden focus:border-ds-accent-ink"
                    placeholder="Descreva o motivo da alteração."
                  />
                </label>
              </div>

              {transportVoucherMessage ? (
                <p className="mt-4 rounded-xl bg-ds-danger-bg px-3 py-2 text-xs font-bold text-ds-danger">{transportVoucherMessage}</p>
              ) : null}

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTransportVoucherEditorOpen(false)}
                  className="h-8 rounded-lg border border-ds-border bg-white px-3 text-xs font-black text-ds-ink-2 hover:bg-ds-muted"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={transportVoucherSaving}
                  onClick={() => void saveTransportVoucher()}
                  className="h-8 rounded-lg bg-ds-accent px-3 text-xs font-black text-white shadow-xs hover:bg-ds-accent-hover disabled:opacity-60"
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
                  <p className="text-base font-black text-ds-ink">Histórico do vale-transporte</p>
                  <p className="mt-0.5 text-xs font-semibold text-ds-ink-muted">{user.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTransportVoucherHistoryOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-full bg-ds-neutral-bg text-ds-ink-muted hover:bg-ds-divider"
                >
                  ×
                </button>
              </div>

              <div className="mt-3 max-h-[55vh] space-y-2 overflow-auto pr-1">
                {transportVoucherHistory.length > 0 ? [...transportVoucherHistory].reverse().map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-ds-divider bg-ds-input p-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-ds-ink">{formatTransportVoucherAction(entry)}</p>
                        <p className="mt-1 text-xs font-semibold text-ds-ink-muted">
                          Vigência: {formatVacationDate(entry.effectiveDate)}
                          {entry.value != null ? ` · R$ ${entry.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/dia` : ""}
                        </p>
                      </div>
                      <Chip tone={entry.toStatus === "active" ? "good" : "warn"}>{transportVoucherStatusLabel(entry.toStatus)}</Chip>
                    </div>
                    <p className="mt-3 rounded-xl bg-white p-3 text-xs font-semibold text-ds-ink-2">{entry.reason}</p>
                    {entry.changedBy ? (
                      <p className="mt-2 text-[11px] font-semibold text-ds-ink-faint">
                        Alterado por {entry.changedBy.username} em {fmtDate(entry.changedAt, "dd/MM/yyyy HH:mm")}
                      </p>
                    ) : null}
                  </div>
                )) : (
                  <p className="rounded-2xl bg-ds-muted p-4 text-sm font-semibold text-ds-ink-muted">Nenhuma alteração registrada.</p>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setTransportVoucherHistoryOpen(false)}
                  className="rounded-2xl bg-ds-ink px-5 py-3 text-sm font-black text-white"
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
    <div className="rounded-2xl bg-ds-muted p-3 text-center">
      <p className="text-base font-black text-ds-ink">{value}</p>
      <p className="text-[10px] font-bold text-ds-ink-muted">{label}</p>
    </div>
  );
}
