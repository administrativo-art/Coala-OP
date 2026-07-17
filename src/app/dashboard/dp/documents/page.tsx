"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, FolderOpen, Loader2, Search, Settings2, ShieldCheck, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import type { User } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPersonName } from "@/lib/person-name";
import {
  EMPLOYEE_DOCUMENT_CATEGORIES,
  EMPLOYEE_DOCUMENT_TYPE_CATALOG,
} from "@/lib/hr/employee-document-options";
import type { DocumentVisibilityConfig, NormalizedFieldVisibility } from "@/types/rh";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const VISIBILITY_OPTIONS: Array<{ id: NormalizedFieldVisibility; label: string; description: string; color: string }> = [
  { id: "public", label: "Sem restrição", description: "Segue o acesso base ao módulo", color: "bg-emerald-500" },
  { id: "restricted_partial", label: "Restrito parcial", description: "Titular e perfis autorizados", color: "bg-sky-500" },
  { id: "restricted_total", label: "Restrito total", description: "RH elevado e vínculos explícitos", color: "bg-amber-500" },
  { id: "confidential", label: "Confidencial", description: "Administração e exceções explícitas", color: "bg-rose-500" },
];

function VisibilityMenu({ value, inherited, onChange }: {
  value: NormalizedFieldVisibility;
  inherited?: boolean;
  onChange: (value: NormalizedFieldVisibility | "inherit") => void;
}) {
  const current = VISIBILITY_OPTIONS.find((option) => option.id === value) ?? VISIBILITY_OPTIONS[3];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-9 min-w-[168px] items-center justify-between gap-2 rounded-lg border bg-white px-3 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50">
          <span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${current.color}`} />{inherited ? `Herdado: ${current.label}` : current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5 shadow-xl">
        {inherited !== undefined ? (
          <DropdownMenuItem onSelect={() => onChange("inherit")} className="cursor-pointer rounded-lg px-3 py-2.5">
            <span className="min-w-0 flex-1"><span className="block text-sm font-black">Herdar da pasta</span><span className="block text-[11px] font-semibold text-slate-500">Acompanha alterações do padrão</span></span>
            {inherited ? <Check className="h-4 w-4 text-emerald-600" /> : null}
          </DropdownMenuItem>
        ) : null}
        {VISIBILITY_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onChange(option.id)} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${option.color}`} />
            <span className="min-w-0 flex-1"><span className="block text-sm font-black">{option.label}</span><span className="block text-[11px] font-semibold text-slate-500">{option.description}</span></span>
            {!inherited && value === option.id ? <Check className="h-4 w-4 text-emerald-600" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type EmployeeDocumentSummary = {
  employeeId: string;
  total: number;
  pending: number;
  received: number;
  validated: number;
  rejected: number;
  expired: number;
  confidential: number;
  candidateLinked: number;
  pendingReviewBatches: number;
  pendingReviewFiles: number;
  lastUploadedAt: string | null;
  categories: Record<string, number>;
};

const EMPTY_SUMMARY: EmployeeDocumentSummary = {
  employeeId: "",
  total: 0,
  pending: 0,
  received: 0,
  validated: 0,
  rejected: 0,
  expired: 0,
  confidential: 0,
  candidateLinked: 0,
  pendingReviewBatches: 0,
  pendingReviewFiles: 0,
  lastUploadedAt: null,
  categories: {},
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function AvatarMark({ user }: { user: User }) {
  const displayName = formatPersonName(user.username) || user.username;
  return (
    <Avatar className="h-8 w-8 shrink-0 rounded-md">
      <AvatarImage src={user.avatarUrl || undefined} alt={displayName} className="rounded-md object-cover" />
      <AvatarFallback
        className="rounded-md bg-pink-100 text-xs font-black text-pink-700"
        style={user.color ? { backgroundColor: user.color, color: "#fff" } : undefined}
      >
        {initials(displayName || "?")}
      </AvatarFallback>
    </Avatar>
  );
}

function SummaryPill({
  icon: Icon,
  label,
  value,
  tone = "slate",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "slate" | "green" | "amber" | "red" | "blue";
}) {
  const toneClass = {
    slate: "bg-slate-50 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    blue: "bg-sky-50 text-sky-700",
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${toneClass}`}>
      <Icon className="h-3 w-3" />
      {value} {label}
    </span>
  );
}

function OverviewMetric({
  label,
  description,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  description: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: "amber" | "emerald" | "rose";
}) {
  const toneClass = {
    amber: {
      shell: "border-amber-100 bg-amber-50/60",
      icon: "bg-amber-100 text-amber-700",
      value: "text-amber-700",
    },
    emerald: {
      shell: "border-emerald-100 bg-emerald-50/60",
      icon: "bg-emerald-100 text-emerald-700",
      value: "text-emerald-700",
    },
    rose: {
      shell: "border-rose-100 bg-rose-50/60",
      icon: "bg-rose-100 text-rose-700",
      value: "text-rose-700",
    },
  }[tone];

  return (
    <div className={`rounded-lg border px-2.5 py-2 shadow-sm ${toneClass.shell}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[.1em] text-slate-500">{label}</p>
          <p className={`mt-0.5 text-lg font-black leading-none ${toneClass.value}`}>{value}</p>
          <p className="mt-1 text-[11px] font-semibold leading-snug text-slate-500">{description}</p>
        </div>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${toneClass.icon}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}

function DocumentCollaboratorCard({
  user,
  summary,
  unitNames,
  onOpen,
}: {
  user: User;
  summary: EmployeeDocumentSummary;
  unitNames: string[];
  onOpen: () => void;
}) {
  const isActive = user.isActive !== false;
  const pendingReview = summary.pendingReviewFiles;
  const displayName = formatPersonName(user.username) || user.username;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-xl border border-[#dedfe4] bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#df2f78]/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#df2f78]"
    >
      <div className="flex min-h-[58px] items-center justify-between gap-2 bg-[#fbfbfc] px-2.5 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <AvatarMark user={user} />
          <div className="min-w-0">
            <p className="truncate text-xs font-black text-[#1d1d26]">{displayName}</p>
            <p className="truncate text-[11px] font-bold text-[#777784]">{user.jobRoleName || "Sem cargo"}</p>
            <p className="truncate text-[10px] font-medium text-[#8f8f9b]">
              {unitNames.length ? unitNames.join(", ") : "Sem unidade"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={isActive ? "default" : "secondary"} className={`h-5 px-2 text-[10px] ${isActive ? "bg-emerald-600 text-white hover:bg-emerald-600" : ""}`}>
            {isActive ? "Ativo" : "Inativo"}
          </Badge>
          {pendingReview > 0 ? (
            <SummaryPill
              icon={AlertTriangle}
              label="para revisar"
              value={pendingReview}
              tone="amber"
            />
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function DPDocumentsPage() {
  const router = useRouter();
  const { permissions, activeUsers, terminatedUsers, firebaseUser, user: currentUser } = useAuth();
  const { units } = useDPBootstrap();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "inactive">("active");
  const [summaries, setSummaries] = useState<Record<string, EmployeeDocumentSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityMessage, setVisibilityMessage] = useState("");
  const [documentVisibility, setDocumentVisibility] = useState<DocumentVisibilityConfig | null>(null);
  const [expandedVisibilityCategory, setExpandedVisibilityCategory] = useState<string | null>(null);
  const visibilityAutoOpened = useRef(false);

  const ownProfileOnly = permissions.dp?.collaborators?.ownProfileOnly === true;
  const canView = Boolean(permissions.settings?.manageUsers || (permissions.dp?.collaborators?.view && !ownProfileOnly));
  const canManage = permissions.settings?.manageUsers === true || permissions.dp?.collaborators?.edit === true;
  const showStorageNotice = process.env.NODE_ENV !== "production";
  const allUsers = useMemo(() => [...activeUsers, ...terminatedUsers], [activeUsers, terminatedUsers]);
  const unitNameById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);

  useEffect(() => {
    if (!firebaseUser || !canManage || visibilityAutoOpened.current) return;
    if (new URLSearchParams(window.location.search).get("configureVisibility") !== "1") return;
    visibilityAutoOpened.current = true;
    void openVisibilitySettings();
  }, [firebaseUser, canManage]);

  useEffect(() => {
    if (!firebaseUser || !canView) return;
    const currentFirebaseUser = firebaseUser;

    let cancelled = false;
    async function loadSummaries() {
      setLoading(true);
      setError(null);
      try {
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/hr/employee-documents/summary", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Falha ao carregar documentos.");
        }
        if (cancelled) return;
        const nextSummaries = Object.fromEntries(
          (payload.summaries ?? []).map((summary: EmployeeDocumentSummary) => [summary.employeeId, summary])
        );
        setSummaries(nextSummaries);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Falha ao carregar documentos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSummaries();

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, canView]);

  useEffect(() => {
    if (!ownProfileOnly || !currentUser?.id) return;
    router.replace(`/dashboard/dp/collaborators/${currentUser.id}/documents`);
  }, [currentUser?.id, ownProfileOnly, router]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allUsers.filter((user) => {
      const isActive = user.isActive !== false;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && isActive) ||
        (statusFilter === "inactive" && !isActive);
      const matchesSearch = !query || [
        user.username,
        user.email,
        user.jobRoleName,
        user.registrationIdBizneo,
        user.registrationIdPdv,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    }).sort((left, right) => left.username.localeCompare(right.username, "pt-BR"));
  }, [allUsers, search, statusFilter]);

  const totals = useMemo(() => {
    const values = Object.values(summaries);
    return {
      pending: values.reduce((sum, summary) => sum + summary.pendingReviewFiles, 0),
      validated: values.reduce((sum, summary) => sum + summary.validated, 0),
      alerts: values.reduce((sum, summary) => sum + summary.rejected + summary.expired, 0),
    };
  }, [summaries]);

  async function openVisibilitySettings() {
    if (!firebaseUser) return;
    setVisibilityOpen(true);
    setVisibilityLoading(true);
    setVisibilityMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/hr/employee-documents/visibility", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar visibilidade.");
      setDocumentVisibility(payload.documentVisibility as DocumentVisibilityConfig);
    } catch (cause) {
      setVisibilityMessage(cause instanceof Error ? cause.message : "Falha ao carregar visibilidade.");
    } finally {
      setVisibilityLoading(false);
    }
  }

  async function saveVisibilitySettings() {
    if (!firebaseUser || !documentVisibility) return;
    setVisibilitySaving(true);
    setVisibilityMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/hr/employee-documents/visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(documentVisibility),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao salvar visibilidade.");
      setDocumentVisibility(payload.documentVisibility as DocumentVisibilityConfig);
      setVisibilityMessage("Visibilidade salva.");
    } catch (cause) {
      setVisibilityMessage(cause instanceof Error ? cause.message : "Falha ao salvar visibilidade.");
    } finally {
      setVisibilitySaving(false);
    }
  }

  function closeVisibilitySettings() {
    setVisibilityOpen(false);
    if (new URLSearchParams(window.location.search).get("configureVisibility") === "1") router.back();
  }

  if (!canView) {
    if (ownProfileOnly) {
      return <p className="p-6 text-sm text-muted-foreground">Abrindo seus documentos da Gestão do colaborador...</p>;
    }
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar documentos de colaboradores.</p>;
  }

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#df2f78]">Departamento pessoal</p>
          <h1 className="text-xl font-black tracking-tight text-[#1d1d26]">Documentos dos colaboradores</h1>
          <p className="text-xs font-medium text-[#777784]">
            Acesse as pastas individuais e acompanhe pendências, validações e vencimentos.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showStorageNotice ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800">
              <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5" />
              Acesso autenticado no backend
            </div>
          ) : null}
          {canManage ? (
            <Button size="sm" variant="outline" className="h-9 gap-2 rounded-lg text-xs" onClick={() => void openVisibilitySettings()}>
              <Settings2 className="h-4 w-4" />
              Configurar visibilidade
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <OverviewMetric
          label="Em análise"
          description="Arquivos em lotes aguardando revisão."
          value={totals.pending}
          icon={Clock3}
          tone="amber"
        />
        <OverviewMetric
          label="Validados"
          description="Documentos conferidos e liberados."
          value={totals.validated}
          icon={CheckCircle2}
          tone="emerald"
        />
        <OverviewMetric
          label="Alertas"
          description="Rejeitados, vencidos ou exigindo ação."
          value={totals.alerts}
          icon={AlertTriangle}
          tone="rose"
        />
      </div>

      <div className="rounded-lg border border-[#dedfe4] bg-white p-2 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9d9da9]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, cargo ou matrícula..."
              className="h-8 rounded-md pl-8 text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={statusFilter === "active" ? "default" : "outline"} className="h-7 rounded-full px-2.5 text-[11px]" onClick={() => setStatusFilter("active")}>Ativos {activeUsers.length}</Button>
            <Button size="sm" variant={statusFilter === "inactive" ? "default" : "outline"} className="h-7 rounded-full px-2.5 text-[11px]" onClick={() => setStatusFilter("inactive")}>Inativos {terminatedUsers.length}</Button>
            <Button size="sm" variant={statusFilter === "all" ? "default" : "outline"} className="h-7 rounded-full px-2.5 text-[11px]" onClick={() => setStatusFilter("all")}>Todos {allUsers.length}</Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, index) => <Skeleton key={index} className="h-[58px] rounded-xl" />)}
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dedfe4] bg-white p-12 text-center text-sm font-bold text-[#777784]">
          <FolderOpen className="mx-auto mb-3 h-8 w-8" />
          Nenhum colaborador encontrado para os filtros atuais.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {filteredUsers.map((user) => {
            const summary = summaries[user.id] ? { ...summaries[user.id], employeeId: user.id } : { ...EMPTY_SUMMARY, employeeId: user.id };
            const unitNames = (user.unitIds ?? []).map((id) => unitNameById.get(id) ?? id);
            return (
              <DocumentCollaboratorCard
                key={user.id}
                user={user}
                summary={summary}
                unitNames={unitNames}
                onOpen={() => router.push(`/dashboard/dp/collaborators/${user.id}/documents`)}
              />
            );
          })}
        </div>
      )}

      {visibilityOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
          <section className="flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase text-[#df2f78]">Documentos do colaborador</p>
                <h2 className="mt-0.5 text-base font-black text-slate-900">Visibilidade por pasta e documento</h2>
                <p className="mt-0.5 max-w-2xl text-xs font-semibold text-slate-500">Cada pasta define o padrão. Um tipo pode herdar esse padrão ou usar outro nível da matriz de acesso.</p>
              </div>
              <button type="button" onClick={closeVisibilitySettings} className="grid h-9 w-9 place-items-center rounded-lg border text-slate-500 hover:bg-slate-50" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {visibilityLoading ? (
                <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#df2f78]" /></div>
              ) : documentVisibility ? (
                <div className="divide-y rounded-xl border">
                  {EMPLOYEE_DOCUMENT_CATEGORIES.map((category) => {
                    const categoryVisibility = documentVisibility.categories?.[category.id] ?? "restricted_total";
                    const expanded = expandedVisibilityCategory === category.id;
                    const types = EMPLOYEE_DOCUMENT_TYPE_CATALOG.filter((type) => type.category === category.id);
                    return (
                      <div key={category.id}>
                        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <button type="button" onClick={() => setExpandedVisibilityCategory(expanded ? null : category.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="min-w-0"><span className="block truncate text-sm font-black text-slate-800">{category.label}</span><span className="block text-xs font-semibold text-slate-400">{types.length} tipos de documento</span></span>
                            <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform sm:ml-2 ${expanded ? "rotate-180" : ""}`} />
                          </button>
                          <VisibilityMenu
                            value={categoryVisibility}
                            onChange={(value) => {
                              if (value === "inherit") return;
                              setDocumentVisibility((current) => current ? { ...current, categories: { ...current.categories, [category.id]: value } } : current);
                            }}
                          />
                        </div>
                        {expanded ? (
                          <div className="border-t bg-slate-50/70 px-4 py-2 sm:pl-11">
                            {types.map((type) => {
                              const override = documentVisibility.document_types?.[type.code];
                              return (
                                <div key={type.code} className="flex flex-col gap-2 border-b border-slate-200/70 py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0"><p className="text-sm font-bold text-slate-700">{type.label}</p><p className="font-mono text-[10px] text-slate-400">{type.code}</p></div>
                                  <VisibilityMenu
                                    value={override ?? categoryVisibility}
                                    inherited={!override}
                                    onChange={(value) => setDocumentVisibility((current) => {
                                      if (!current) return current;
                                      const documentTypes = { ...current.document_types };
                                      if (value === "inherit") delete documentTypes[type.code];
                                      else documentTypes[type.code] = value;
                                      return { ...current, document_types: documentTypes };
                                    })}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <footer className="flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className={`text-xs font-bold ${visibilityMessage === "Visibilidade salva." ? "text-emerald-700" : "text-rose-600"}`}>{visibilityMessage}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeVisibilitySettings}>Cancelar</Button>
                <Button onClick={() => void saveVisibilitySettings()} disabled={visibilitySaving || visibilityLoading || !documentVisibility} className="gap-2 bg-[#df2f78] hover:bg-[#c81f69]">
                  {visibilitySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar visibilidade
                </Button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
