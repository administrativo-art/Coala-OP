"use client";

import { useEffect, useMemo, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { cn } from "@/lib/utils";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { useDP } from "@/components/dp-context";

import type { ClosurePerson } from "./closure-core";

export const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const NO_ORGANIZATION = "Sem unidade financeira";

export const competenceLabel = (competence: string) => `${MONTH_NAMES[Number(competence.slice(5, 7)) - 1]} de ${competence.slice(0, 4)}`;

/** Pedidos sem decisão de uma pessoa (mesma regra que bloqueia o fechamento). */
export function pendingOfPerson(person: ClosurePerson) {
  return person.adjustments.filter((item) => item.status === "in_review").length
    + person.absences.filter((item) => ["submitted", "in_review", "adjustments_requested"].includes(item.status)).length
    + person.shiftSwaps.filter((item) => item.status === "pending").length;
}

type PersonRef = { id: string; unitId?: string | null; employerUnitId?: string | null };

/**
 * Agrupamento do fechamento: unidade financeira da pessoa (cadastro "Principal financeira", `unitId`) → organização da
 * unidade (direta ou pelo grupo). Unidade sem organização agrupa pelo próprio nome; sem unidade financeira, cai na
 * empregadora; sem nenhuma, "Sem unidade financeira".
 */
export function useOrganizationOf(people: PersonRef[]) {
  const { units, unitGroups, unitOrganizations } = useDP();
  return useMemo(() => {
    const organizationName = new Map(unitOrganizations.map((organization) => [organization.id, organization.name]));
    const groupOrganization = new Map(unitGroups.map((group) => [group.id, group.organizationId]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const personById = new Map(people.map((person) => [person.id, person]));
    return (uid: string) => {
      const person = personById.get(uid);
      const unit = unitById.get(person?.unitId || person?.employerUnitId || "");
      if (!unit) return NO_ORGANIZATION;
      const organizationId = unit.organizationId || (unit.groupId ? groupOrganization.get(unit.groupId) : undefined);
      return (organizationId && organizationName.get(organizationId)) || unit.name;
    };
  }, [people, units, unitGroups, unitOrganizations]);
}

type MonthPayload = { closure: { status: "open" | "closed"; version: number } | null; people: ClosurePerson[]; pending: { adjustments: number; absences: number; shiftSwaps: number } };
type MonthState = { status: "loading" } | { status: "error" } | { status: "ready"; data: MonthPayload };

const TONES = {
  closed: { card: "border-ds-border bg-ds-surface", bar: "bg-ds-ok", text: "text-ds-ok" },
  pending: { card: "border-ds-border bg-ds-surface", bar: "bg-ds-warn", text: "text-ds-warn" },
  open: { card: "border-ds-accent-ink/30 bg-ds-surface", bar: "bg-ds-accent-ink", text: "text-ds-accent-ink" },
  future: { card: "border-dashed border-ds-border bg-ds-surface/50", bar: "bg-ds-divider", text: "text-ds-ink-faint" },
} as const;

/** Um card por mês do ano, com a situação do fechamento por organização. */
export function ClosureYearOverview({ firebaseUser, people, organization, onOpen }: {
  firebaseUser: FirebaseUser | null;
  people: PersonRef[];
  organization: string | null;
  onOpen: (competence: string) => void;
}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentCompetence = now.toISOString().slice(0, 7);
  const [year, setYear] = useState(currentYear);
  const [months, setMonths] = useState<Record<string, MonthState>>({});
  const organizationOf = useOrganizationOf(people);
  const years = [currentYear - 1, currentYear];

  useEffect(() => {
    let cancelled = false;
    const competences = MONTH_NAMES.map((_, index) => `${year}-${String(index + 1).padStart(2, "0")}`).filter((value) => value <= currentCompetence);
    setMonths(Object.fromEntries(competences.map((value) => [value, { status: "loading" } as MonthState])));
    for (const competence of competences) {
      authenticatedApiRequest<MonthPayload>(`/api/dp/time-recording/closures?competence=${competence}`, {
        getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null), fallbackError: "Não foi possível carregar o mês.",
      }).then((data) => { if (!cancelled) setMonths((current) => ({ ...current, [competence]: { status: "ready", data } })); })
        .catch(() => { if (!cancelled) setMonths((current) => ({ ...current, [competence]: { status: "error" } })); });
    }
    return () => { cancelled = true; };
  }, [year, currentCompetence, firebaseUser]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {years.map((value) => (
          <button key={value} type="button" onClick={() => setYear(value)}
            className={cn("flex h-[34px] items-center gap-2 rounded-[11px] border px-[15px] text-[13.5px] font-extrabold transition-colors",
              value === year ? "border-ds-ink bg-ds-ink text-white" : "border-ds-border bg-ds-surface text-ds-ink-2 hover:bg-ds-neutral-bg")}>
            {value}<span className="text-[11px] font-extrabold opacity-60">· {value === currentYear ? "atual" : "encerrado"}</span>
          </button>
        ))}
        <div className="ml-auto hidden flex-wrap items-center gap-[14px] md:flex">
          {([["Aberta", "bg-ds-accent-ink"], ["Com pendência", "bg-ds-warn"], ["Fechada", "bg-ds-ok"], ["Futuro", "bg-ds-divider"]] as const).map(([label, dot]) => (
            <span key={label} className="flex items-center gap-1.5 text-[11.5px] font-bold text-ds-ink-muted"><span className={cn("h-2 w-2 rounded-[3px]", dot)} />{label}</span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MONTH_NAMES.map((name, index) => {
          const competence = `${year}-${String(index + 1).padStart(2, "0")}`;
          const state = months[competence];
          const future = competence > currentCompetence;
          const data = state?.status === "ready" ? state.data : null;
          const closed = data?.closure?.status === "closed";
          const members = (data?.people ?? []).filter((person) => organizationOf(person.uid) === organization);
          const pendingPeople = members.filter((person) => pendingOfPerson(person)).length;
          const pendingTotal = members.reduce((sum, person) => sum + pendingOfPerson(person), 0);
          const tone = future ? "future" : closed ? "closed" : pendingTotal ? "pending" : "open";
          const statusLabel = future ? "Futuro" : !state || state.status === "loading" ? "Carregando…" : state.status === "error" ? "Indisponível"
            : closed ? `Fechada · v${data!.closure!.version}` : pendingTotal ? "Com pendência" : competence === currentCompetence ? "Em andamento" : "Aberta";
          const pct = closed ? 100 : members.length ? Math.round(((members.length - pendingPeople) / members.length) * 100) : 0;
          const style = TONES[tone];
          return (
            <button key={competence} type="button" disabled={future} onClick={() => onOpen(competence)}
              className={cn("flex flex-col rounded-[16px] border px-4 pb-[14px] pt-[15px] text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink", style.card)}>
              <span className="flex w-full items-center gap-2">
                <span className={cn("text-[15.5px] font-black tracking-[-0.01em]", future ? "text-ds-ink-faint" : "text-ds-ink")}>{name}</span>
                <span className={cn("ml-auto text-[10.5px] font-extrabold", style.text)}>{statusLabel}</span>
              </span>
              <span className="mt-[13px] block h-[5px] w-full overflow-hidden rounded-[3px] bg-ds-divider"><span className={cn("block h-full rounded-full", style.bar)} style={{ width: `${pct}%` }} /></span>
              {data ? <span className="mt-[9px] flex w-full items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-[12.5px] font-extrabold tabular-nums text-ds-ink-2">{members.length}</span>
                <span className="text-[11.5px] font-bold text-ds-ink-faint">{members.length === 1 ? "pessoa" : "pessoas"}</span>
                {pendingTotal ? <span className="ml-auto rounded-md bg-ds-caution-bg px-[7px] py-0.5 text-[10.5px] font-black text-ds-caution">{pendingTotal} pendente{pendingTotal > 1 ? "s" : ""}</span> : null}
              </span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
