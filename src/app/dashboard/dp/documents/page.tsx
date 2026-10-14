"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, FolderOpen, Loader2, Search, Settings2, ShieldCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import type { User } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HeroChip } from "@/components/patterns/hero-chip";
import { PageHero } from "@/components/patterns/page-hero";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPersonName } from "@/lib/person-name";
import { canAccessUserByUnit } from "@/lib/unit-access";
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
        <button type="button" className="inline-flex h-9 min-w-[168px] items-center justify-between gap-2 rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 text-xs font-black text-ds-ink-2 hover:bg-slate-50">
          <span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${current.color}`} />{inherited ? `Herdado: ${current.label}` : current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-ds-ink-faint" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5 shadow-xl">
        {inherited !== undefined ? (
          <DropdownMenuItem onSelect={() => onChange("inherit")} className="cursor-pointer rounded-lg px-3 py-2.5">
            <span className="min-w-0 flex-1"><span className="block text-sm font-black">Herdar da pasta</span><span className="block text-[11px] font-semibold text-slate-500">Acompanha alterações do padrão</span></span>
            {inherited ? <Check className="h-4 w-4 text-ds-ok" /> : null}
          </DropdownMenuItem>
        ) : null}
        {VISIBILITY_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onChange(option.id)} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${option.color}`} />
            <span className="min-w-0 flex-1"><span className="block text-sm font-black">{option.label}</span><span className="block text-[11px] font-semibold text-slate-500">{option.description}</span></span>
            {!inherited && value === option.id ? <Check className="h-4 w-4 text-ds-ok" /> : null}
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
    slate: "bg-ds-neutral-bg text-ds-neutral",
    green: "bg-ds-ok-bg text-ds-ok",
    amber: "bg-ds-warn-bg text-ds-warn",
    red: "bg-ds-danger-bg text-ds-danger",
    blue: "bg-ds-info-bg text-ds-info",
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${toneClass}`}>
      <Icon className="h-3 w-3" />
      {value} {label}
    </span>
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
      className="group overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface text-left transition duration-[180ms] ease-ds-lift hover:-translate-y-[3px] hover:shadow-ds-lift motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent"
    >
      <div className="flex min-h-[58px] items-center justify-between gap-2 bg-ds-muted px-2.5 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <AvatarMark user={user} />
          <div className="min-w-0">
            <p className="truncate text-xs font-black text-ds-ink">{displayName}</p>
            <p className="truncate text-[11px] font-bold text-ds-ink-muted">{user.jobRoleName || "Sem cargo"}</p>
            <p className="truncate text-[10px] font-medium text-ds-ink-faint">
              {unitNames.length ? unitNames.join(", ") : "Sem unidade"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={isActive ? "default" : "secondary"} className={`h-5 px-2 text-[10px] ${isActive ? "bg-ds-ok text-white hover:bg-ds-ok" : ""}`}>
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
  const { permissions, activeUsers, terminatedUsers, firebaseUser, user: currentUser, isDefaultAdmin } = useAuth();
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
  const allUsers = useMemo(() => {
    if (!currentUser) return [];
    return [...activeUsers, ...terminatedUsers].filter((candidate) =>
      candidate.id === currentUser.id || canAccessUserByUnit(currentUser, candidate, { isDefaultAdmin })
    );
  }, [activeUsers, currentUser, isDefaultAdmin, terminatedUsers]);
  const visibleActiveCount = useMemo(
    () => allUsers.filter((candidate) => candidate.isActive !== false).length,
    [allUsers],
  );
  const visibleInactiveCount = allUsers.length - visibleActiveCount;
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
        user.hrEmployeeId,
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
    <div className="min-w-0 space-y-3">
      <PageHero
        kicker="Departamento pessoal"
        title="Documentos dos colaboradores"
        subtitle="Acesse as pastas individuais e acompanhe pendências, validações e vencimentos."
        actions={<>
          {showStorageNotice ? (
            <span className="inline-flex items-center rounded-ds-btn bg-ds-ok-bg px-2.5 py-1.5 text-[11px] font-bold text-ds-ok">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Acesso autenticado no backend
            </span>
          ) : null}
          {canManage ? (
            <Button type="button" variant="ds-secondary" size="md" onClick={() => void openVisibilitySettings()}>
              <Settings2 className="mr-2 h-4 w-4" />
              Configurar visibilidade
            </Button>
          ) : null}
        </>}
        chips={<>
          <HeroChip value={totals.pending} label="em análise" tone="warning" />
          <HeroChip value={totals.validated} label="validados" tone="info" />
          <HeroChip value={totals.alerts} label="alertas" tone="danger" />
        </>}
      />

      <div className="rounded-ds-btn border border-ds-border bg-ds-surface p-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, cargo ou matrícula..."
              className="h-8 rounded-md pl-8 text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={statusFilter === "active" ? "default" : "outline"} className="h-7 rounded-full px-2.5 text-[11px]" onClick={() => setStatusFilter("active")}>Ativos {visibleActiveCount}</Button>
            <Button size="sm" variant={statusFilter === "inactive" ? "default" : "outline"} className="h-7 rounded-full px-2.5 text-[11px]" onClick={() => setStatusFilter("inactive")}>Inativos {visibleInactiveCount}</Button>
            <Button size="sm" variant={statusFilter === "all" ? "default" : "outline"} className="h-7 rounded-full px-2.5 text-[11px]" onClick={() => setStatusFilter("all")}>Todos {allUsers.length}</Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-ds-card bg-ds-danger-bg p-4 text-sm font-bold text-ds-danger" role="alert">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, index) => <Skeleton key={index} className="h-[58px] rounded-xl" />)}
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ds-border bg-white p-12 text-center text-sm font-bold text-ds-ink-muted">
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

      <Dialog open={visibilityOpen} onOpenChange={(open) => { if (!open) closeVisibilitySettings(); }}>
        <DialogContent className="flex max-h-[84vh] max-w-4xl flex-col gap-0 overflow-hidden rounded-ds-modal bg-ds-input p-0">
          <DialogHeader className="border-b border-ds-border px-6 py-4 text-left">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">Documentos do colaborador</p>
            <DialogTitle className="text-[21px] font-extrabold text-ds-ink">Visibilidade por pasta e documento</DialogTitle>
            <DialogDescription className="max-w-2xl text-[13px] text-ds-ink-muted">Cada pasta define o padrão. Um tipo pode herdar esse padrão ou usar outro nível da matriz de acesso.</DialogDescription>
          </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {visibilityLoading ? (
                <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-ds-accent-ink" /></div>
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
                            <FolderOpen className="h-4 w-4 shrink-0 text-ds-ink-faint" />
                            <span className="min-w-0"><span className="block truncate text-sm font-black text-ds-ink">{category.label}</span><span className="block text-xs font-semibold text-ds-ink-faint">{types.length} tipos de documento</span></span>
                            <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-ds-ink-faint transition-transform sm:ml-2 ${expanded ? "rotate-180" : ""}`} />
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
                          <div className="border-t bg-ds-muted px-4 py-2 sm:pl-11">
                            {types.map((type) => {
                              const override = documentVisibility.document_types?.[type.code];
                              return (
                                <div key={type.code} className="flex flex-col gap-2 border-b border-ds-divider py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0"><p className="text-sm font-bold text-ds-ink-2">{type.label}</p><p className="font-mono text-[10px] text-ds-ink-faint">{type.code}</p></div>
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

          <DialogFooter className="flex flex-col gap-3 border-t border-ds-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
            <p role="status" className={`text-xs font-bold ${visibilityMessage === "Visibilidade salva." ? "text-ds-ok" : "text-ds-danger"}`}>{visibilityMessage}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ds-ghost" onClick={closeVisibilitySettings}>Cancelar</Button>
              <Button type="button" variant="primary-modal" onClick={() => void saveVisibilitySettings()} disabled={visibilitySaving || visibilityLoading || !documentVisibility}>
                {visibilitySaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Salvar visibilidade
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
