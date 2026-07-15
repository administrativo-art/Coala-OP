"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock3, FolderOpen, Search, ShieldCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import type { User } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPersonName } from "@/lib/person-name";

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
    <Avatar className="h-12 w-12 shrink-0 rounded-2xl">
      <AvatarImage src={user.avatarUrl || undefined} alt={displayName} className="rounded-2xl object-cover" />
      <AvatarFallback
        className="rounded-2xl bg-pink-100 text-sm font-black text-pink-700"
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black ${toneClass}`}>
      <Icon className="h-3.5 w-3.5" />
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
    <div className={`rounded-3xl border p-4 shadow-sm ${toneClass.shell}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[.1em] text-slate-500">{label}</p>
          <p className={`mt-2 text-3xl font-black leading-none ${toneClass.value}`}>{value}</p>
          <p className="mt-2 text-xs font-semibold leading-snug text-slate-500">{description}</p>
        </div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${toneClass.icon}`}>
          <Icon className="h-5 w-5" />
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
  const pendingReview = summary.pending + summary.received;
  const displayName = formatPersonName(user.username) || user.username;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-3xl border border-[#dedfe4] bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#df2f78]/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#df2f78]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#ececf0] bg-[#fbfbfc] p-4">
        <div className="flex min-w-0 items-start gap-3">
          <AvatarMark user={user} />
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-[#1d1d26]">{displayName}</p>
            <p className="mt-0.5 truncate text-xs font-bold text-[#777784]">{user.jobRoleName || "Sem cargo"}</p>
            <p className="mt-0.5 truncate text-xs font-medium text-[#8f8f9b]">
              {unitNames.length ? unitNames.join(", ") : "Sem unidade"}
            </p>
          </div>
        </div>
        <Badge variant={isActive ? "default" : "secondary"} className={isActive ? "bg-emerald-600 text-white hover:bg-emerald-600" : ""}>
          {isActive ? "Ativo" : "Inativo"}
        </Badge>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <SummaryPill
            icon={pendingReview > 0 ? AlertTriangle : Clock3}
            label="em análise"
            value={pendingReview}
            tone={pendingReview > 0 ? "amber" : "slate"}
          />
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

  const ownProfileOnly = permissions.dp?.collaborators?.ownProfileOnly === true;
  const canView = Boolean(permissions.settings?.manageUsers || (permissions.dp?.collaborators?.view && !ownProfileOnly));
  const showStorageNotice = process.env.NODE_ENV !== "production";
  const allUsers = useMemo(() => [...activeUsers, ...terminatedUsers], [activeUsers, terminatedUsers]);
  const unitNameById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);

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
      pending: values.reduce((sum, summary) => sum + summary.pending + summary.received, 0),
      validated: values.reduce((sum, summary) => sum + summary.validated, 0),
      alerts: values.reduce((sum, summary) => sum + summary.rejected + summary.expired, 0),
    };
  }, [summaries]);

  if (!canView) {
    if (ownProfileOnly) {
      return <p className="p-6 text-sm text-muted-foreground">Abrindo seus documentos da Gestão do colaborador...</p>;
    }
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar documentos de colaboradores.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#df2f78]">Departamento pessoal</p>
          <h1 className="text-2xl font-black tracking-tight text-[#1d1d26]">Documentos dos colaboradores</h1>
          <p className="text-sm font-medium text-[#777784]">
            Acesse as pastas individuais e acompanhe pendências, validações e vencimentos.
          </p>
        </div>
        {showStorageNotice ? (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            <ShieldCheck className="mr-2 inline h-4 w-4" />
            Documentos privados. O acesso abre por link temporário e autorizado.
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <OverviewMetric
          label="Em análise"
          description="Recebidos ou pendentes de validação."
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

      <div className="space-y-3 rounded-3xl border border-[#dedfe4] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9d9da9]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, cargo ou matrícula..."
              className="h-11 rounded-2xl pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={statusFilter === "active" ? "default" : "outline"} className="rounded-full" onClick={() => setStatusFilter("active")}>Ativos {activeUsers.length}</Button>
            <Button size="sm" variant={statusFilter === "inactive" ? "default" : "outline"} className="rounded-full" onClick={() => setStatusFilter("inactive")}>Inativos {terminatedUsers.length}</Button>
            <Button size="sm" variant={statusFilter === "all" ? "default" : "outline"} className="rounded-full" onClick={() => setStatusFilter("all")}>Todos {allUsers.length}</Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[...Array(6)].map((_, index) => <Skeleton key={index} className="h-72 rounded-3xl" />)}
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dedfe4] bg-white p-12 text-center text-sm font-bold text-[#777784]">
          <FolderOpen className="mx-auto mb-3 h-8 w-8" />
          Nenhum colaborador encontrado para os filtros atuais.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
    </div>
  );
}
