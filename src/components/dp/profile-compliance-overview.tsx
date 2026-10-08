"use client";

import { useEffect, useMemo, useState } from "react";

import { Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { ControlIndicator, ControlPanel, ControlSearch } from "@/components/patterns/control-panel";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { useAuth } from "@/hooks/use-auth";

type RowStatus = "pending" | "complete" | "overdue" | "unlinked";

type Row = {
  userId: string;
  employeeId: string | null;
  name: string;
  email: string;
  status: RowStatus;
  missingFields: string[];
  invalidFields: string[];
  lastConfirmedAt: string | null;
  nextReviewAt: string | null;
};

type Payload = {
  counts: { total: number; complete: number; pending: number; overdue: number; unlinked: number };
  fieldCounts: Record<string, number>;
  rows: Row[];
};

const FIELD_LABELS: Record<string, string> = {
  birth_date: "Data de nascimento",
  access_email: "E-mail de acesso",
  mobile_phone: "Celular",
  pix_key_type: "Tipo de PIX",
  pix_key: "Chave PIX",
  address_zipcode: "CEP",
  address_street: "Logradouro",
  address_number: "Número",
  address_neighborhood: "Bairro",
  address_city: "Cidade",
  address_state: "UF",
  emergency_name: "Contato de emergência",
  emergency_relation: "Vínculo do contato",
  emergency_phone: "Telefone de emergência",
  person_link: "Vínculo com o RH",
};

const STATUS_META: Record<RowStatus, { label: string; variant: StatusPillVariant }> = {
  complete: { label: "Em dia", variant: "ok" },
  pending: { label: "Cadastro pendente", variant: "info" },
  overdue: { label: "Revisão vencida", variant: "warn" },
  unlinked: { label: "Sem vínculo", variant: "danger" },
};

const ROW_TEMPLATE = "minmax(220px,1.4fr) 170px minmax(240px,1.6fr) 150px 16px";

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function issuesOf(row: Row) {
  return [...new Set([...row.missingFields, ...row.invalidFields])].map((field) => FIELD_LABELS[field] ?? field);
}

export function ProfileComplianceOverview() {
  const { firebaseUser } = useAuth();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [status, setStatus] = useState<"all" | RowStatus>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const load = async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/profile-compliance/overview", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Falha ao carregar o acompanhamento.");
      setPayload(next as Payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao carregar o acompanhamento.");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [firebaseUser]);

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (payload?.rows ?? []).filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      return !term || `${row.name} ${row.email}`.toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [payload?.rows, search, status]);

  const missingRanking = useMemo(
    () => Object.entries(payload?.fieldCounts ?? {}).sort((left, right) => right[1] - left[1]),
    [payload?.fieldCounts]
  );
  const openRow = openUserId ? payload?.rows.find((row) => row.userId === openUserId) ?? null : null;
  const counts = payload?.counts;

  const indicators: Array<{ id: RowStatus; label: string; tone: "info" | "warning" | "danger" | "neutral"; value: number }> = [
    { id: "complete", label: "Em dia", tone: "info", value: counts?.complete ?? 0 },
    { id: "pending", label: "Cadastro pendente", tone: "warning", value: counts?.pending ?? 0 },
    { id: "overdue", label: "Revisão vencida", tone: "danger", value: counts?.overdue ?? 0 },
    { id: "unlinked", label: "Sem vínculo com o RH", tone: "neutral", value: counts?.unlinked ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <ControlPanel className="flex flex-col gap-5 px-[26px] pb-5 pt-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Atualização cadastral obrigatória</p>
            <p className="mt-1.5 text-[13.5px] text-ds-on-dark-2">
              Todos os usuários ativos confirmam os dados no login e novamente a cada trimestre.
            </p>
          </div>
          <Button type="button" variant="on-dark-secondary" size="md" loading={loading} loadingLabel="Atualizando…" onClick={() => void load()}>
            Atualizar
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1 border-b border-white/10 lg:grid-cols-4">
          {indicators.map((item) => (
            <ControlIndicator
              key={item.id}
              value={item.value}
              label={item.label}
              tone={item.tone}
              active={status === item.id}
              onClick={() => setStatus((current) => (current === item.id ? "all" : item.id))}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar por nome ou e-mail" />
        </div>
      </ControlPanel>

      {error ? (
        <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[13px] font-semibold text-ds-confirm-ink">{error}</p>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[28px] font-extrabold tracking-[-0.03em]">{rows.length}</span>
            <span className="text-[13px] text-ds-ink-faint">de {counts?.total ?? 0} usuários ativos</span>
          </div>
          <ListShell minWidth={820}>
            <ListHead template={ROW_TEMPLATE}>
              <span>Usuário</span>
              <span>Estado</span>
              <span>Pendências</span>
              <span>Última confirmação</span>
              <span />
            </ListHead>
            {loading && !payload ? <ListSkeleton rows={6} /> : null}
            {rows.map((row) => {
              const issues = issuesOf(row);
              return (
                <ListRow
                  key={row.userId}
                  template={ROW_TEMPLATE}
                  isOpen={openUserId === row.userId}
                  isSelected={false}
                  isMuted={false}
                  onOpen={() => setOpenUserId(row.userId)}
                  label={`Abrir ${row.name}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-bold">{row.name}</p>
                    <p className="truncate text-xs text-ds-ink-muted">{row.email}</p>
                  </div>
                  <div><StatusPill variant={STATUS_META[row.status].variant}>{STATUS_META[row.status].label}</StatusPill></div>
                  <p className="min-w-0 text-xs leading-4 text-ds-ink-muted">{issues.length ? issues.join(" · ") : "Nenhuma"}</p>
                  <span className="whitespace-nowrap text-xs text-ds-ink-muted">{dateLabel(row.lastConfirmedAt)}</span>
                  <Chevron />
                </ListRow>
              );
            })}
            {!loading && payload && rows.length === 0 ? (
              <EmptyResults title="Nenhum usuário encontrado com esses filtros." onClear={() => { setSearch(""); setStatus("all"); }} />
            ) : null}
          </ListShell>
        </div>

        <PanelSection title="Pendências por campo" aside={missingRanking.length ? `${missingRanking.length} campos` : undefined}>
          <p className="text-xs text-ds-ink-muted">A listagem não expõe o conteúdo do PIX nem outros valores pessoais.</p>
          {missingRanking.length ? (
            <ul className="m-0 list-none space-y-2.5 p-0">
              {missingRanking.map(([field, count]) => (
                <li key={field} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-semibold">{FIELD_LABELS[field] ?? field}</span>
                  <StatusPill variant="neutral">{count}</StatusPill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ds-ink-muted">Nenhuma pendência.</p>
          )}
        </PanelSection>
      </div>

      <SidePanel
        open={!!openRow}
        onOpenChange={(open) => { if (!open) setOpenUserId(null); }}
        kicker="Atualização cadastral"
        title={openRow?.name ?? ""}
        subtitle={openRow?.email}
      >
        {openRow ? (
          <>
            <PanelSection title="Situação">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <PanelField label="Estado">
                  <StatusPill variant={STATUS_META[openRow.status].variant}>{STATUS_META[openRow.status].label}</StatusPill>
                </PanelField>
                <PanelField label="Vínculo com o RH">{openRow.employeeId ? "Vinculado" : "Sem vínculo"}</PanelField>
                <PanelField label="Última confirmação">{dateLabel(openRow.lastConfirmedAt)}</PanelField>
                <PanelField label="Próxima revisão">{dateLabel(openRow.nextReviewAt)}</PanelField>
              </div>
            </PanelSection>
            <PanelSection title="Pendências" aside={issuesOf(openRow).length ? `${issuesOf(openRow).length} campo(s)` : undefined}>
              {issuesOf(openRow).length ? (
                <ul className="m-0 list-none space-y-2 p-0">
                  {issuesOf(openRow).map((label) => (
                    <li key={label} className="flex items-center gap-2 text-[13px] font-semibold text-ds-warn">
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ds-warn" />
                      {label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ds-ink-muted">Nenhuma pendência.</p>
              )}
            </PanelSection>
          </>
        ) : null}
      </SidePanel>
    </div>
  );
}
