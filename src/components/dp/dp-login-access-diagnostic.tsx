"use client";

import React from "react";

import { Field, fieldInputClass } from "@/components/patterns/field";
import { PanelField, PanelSection } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { fetchHrLoginAccess, type HrLoginAccessPayload } from "@/features/hr/lib/client";
import { useAuth } from "@/hooks/use-auth";

type Evaluation = HrLoginAccessPayload["evaluation"];

function toDateTimeLocalValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function byUserName(left: { username: string }, right: { username: string }) {
  return left.username.localeCompare(right.username, "pt-BR");
}

const STATUS_META: Record<Evaluation["status"], { label: string; variant: StatusPillVariant }> = {
  blocked: { label: "Bloqueado", variant: "danger" },
  allowed: { label: "Liberado", variant: "ok" },
  unrestricted: { label: "Não se aplica", variant: "neutral" },
};

function reasonLabel(reason: Evaluation["reason"]) {
  switch (reason) {
    case "disabled":
      return "Limitador desligado para o colaborador.";
    case "within_shift":
      return "Existe turno vigente neste horário.";
    case "pre_shift_tolerance":
      return "O colaborador está dentro da tolerância de 15 minutos antes do início do turno.";
    case "before_shift_too_early":
      return "Há um próximo turno, mas ainda não chegou a janela permitida de entrada.";
    case "after_shift_requires_justification":
      return "O turno terminou e o sistema exige justificativa para liberar mais 15 minutos.";
    case "after_shift_extension_active":
      return "Existe uma extensão ativa por justificativa após o término do turno.";
    case "after_shift_extension_limit_reached":
      return "O turno já consumiu as 2 extensões automáticas permitidas.";
    case "day_off":
      return "O dia atual está marcado como folga na escala.";
    case "no_schedule_assigned":
      return "Não há escala atribuída para este colaborador neste recorte.";
    default:
      return reason;
  }
}

function shiftTypeLabel(type: "work" | "day_off") {
  return type === "day_off" ? "Folga" : "Trabalho";
}

function shiftWindowLabel(shift: NonNullable<Evaluation["activeShift"]>) {
  if (shift.spansMidnight) return `${shift.date} ${shift.startTime} → ${shift.endDate} ${shift.endTime}`;
  return `${shift.date} ${shift.startTime} – ${shift.endTime}`;
}

const POLICY = [
  "O limitador só entra em vigor quando o usuário estiver marcado com a opção ativa.",
  "A entrada abre 15 minutos antes do início do turno.",
  "Após o fim do turno, cada justificativa libera mais 15 minutos.",
  "O sistema aceita no máximo 2 extensões automáticas por turno.",
  "Se não houver escala atribuída, o sistema libera o acesso para não travar a operação por falta de cadastro.",
];

export function DPLoginAccessDiagnostic() {
  const { activeUsers, firebaseUser, user } = useAuth();
  const [selectedUserId, setSelectedUserId] = React.useState("");
  const [evaluatedAt, setEvaluatedAt] = React.useState(toDateTimeLocalValue());
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<HrLoginAccessPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const users = React.useMemo(() => [...activeUsers].sort(byUserName), [activeUsers]);

  React.useEffect(() => {
    if (selectedUserId) return;
    const preferredUser =
      users.find((item) => item.id === user?.id) ?? users.find((item) => item.loginRestrictionEnabled) ?? users[0];
    if (preferredUser) setSelectedUserId(preferredUser.id);
  }, [selectedUserId, user?.id, users]);

  async function handleEvaluate() {
    if (!firebaseUser || !selectedUserId) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchHrLoginAccess(firebaseUser, {
        userId: selectedUserId,
        at: new Date(evaluatedAt).toISOString(),
      });
      setResult(payload);
    } catch (requestError) {
      setResult(null);
      setError(requestError instanceof Error ? requestError.message : "Falha ao avaliar acesso por escala.");
    } finally {
      setLoading(false);
    }
  }

  const evaluation = result?.evaluation;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
      <section className="space-y-5 rounded-ds-card-lg border border-ds-border bg-ds-warm p-6">
        <header>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">Diagnóstico do limitador</p>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em]">Simular um acesso</h2>
          <p className="mt-1 text-[13px] text-ds-ink-muted">
            Simula o efeito do login por escala sem bloquear a usabilidade atual. Nesta primeira versão, colaborador com limitador
            ligado e sem escala atribuída continua liberado.
          </p>
        </header>
        <Field label="Colaborador" htmlFor="diag-user">
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger id="diag-user" className={fieldInputClass}>
              <SelectValue placeholder="Selecione um colaborador" />
            </SelectTrigger>
            <SelectContent>
              {users.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.username}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Data e hora" htmlFor="diag-at">
          <Input id="diag-at" type="datetime-local" value={evaluatedAt} onChange={(event) => setEvaluatedAt(event.target.value)} className={fieldInputClass} />
        </Field>
        <Button type="button" variant="primary-page" size="xl" className="w-full" loading={loading} loadingLabel="Verificando…" disabled={!selectedUserId} onClick={() => void handleEvaluate()}>
          Verificar agora
        </Button>
      </section>

      <div className="space-y-4">
        {loading && !result ? (
          <div className="space-y-3" role="status" aria-label="Verificando acesso">
            <Skeleton className="h-40 w-full rounded-ds-card" />
            <Skeleton className="h-56 w-full rounded-ds-card" />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[13px] font-semibold text-ds-confirm-ink">{error}</p>
        ) : null}

        {!result && !loading && !error ? (
          <div className="rounded-ds-card-lg border border-dashed border-ds-border-input px-5 py-16 text-center">
            <p className="text-sm font-bold">Nenhuma verificação feita ainda.</p>
            <p className="mt-1 text-xs text-ds-ink-muted">Escolha um colaborador e um horário e use “Verificar agora”.</p>
          </div>
        ) : null}

        {result && evaluation ? (
          <>
            <PanelSection title="Resultado" aside={`${evaluation.localDate} ${evaluation.localTime} · ${evaluation.timeZone}`}>
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill variant={STATUS_META[evaluation.status].variant}>{STATUS_META[evaluation.status].label}</StatusPill>
                <p className="min-w-0 flex-1 text-[13px] font-semibold">{reasonLabel(evaluation.reason)}</p>
              </div>
              <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-3">
                <PanelField label="Limitador do usuário">{result.user.loginRestrictionEnabled ? "Ligado" : "Desligado"}</PanelField>
                <PanelField label="Cargo">{result.user.jobRoleName ?? "Sem cargo"}</PanelField>
                <PanelField label="Cargo elegível">
                  {result.role?.loginRestricted ? "Sim" : "Não"}
                  <span className="mt-0.5 block text-xs font-medium text-ds-ink-muted">Campo do cargo é informativo; a trava efetiva está no usuário.</span>
                </PanelField>
              </div>
            </PanelSection>

            <div className="grid gap-4 md:grid-cols-2">
              <PanelSection title="Turno vigente">
                {evaluation.activeShift ? (
                  <PanelField label={shiftTypeLabel(evaluation.activeShift.type)}>{shiftWindowLabel(evaluation.activeShift)}</PanelField>
                ) : (
                  <p className="text-[13px] text-ds-ink-muted">Nenhum turno vigente no horário avaliado.</p>
                )}
              </PanelSection>
              <PanelSection title="Próximo turno">
                {evaluation.nextShift ? (
                  <PanelField label={shiftTypeLabel(evaluation.nextShift.type)}>{shiftWindowLabel(evaluation.nextShift)}</PanelField>
                ) : (
                  <p className="text-[13px] text-ds-ink-muted">Nenhum turno futuro identificado neste recorte.</p>
                )}
              </PanelSection>
            </div>

            <PanelSection title="Extensões">
              <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-3">
                <PanelField label="Usadas">{evaluation.extensionUsage.used} de {evaluation.extensionUsage.max}</PanelField>
                <PanelField label="Restantes">{evaluation.extensionUsage.remaining}</PanelField>
                <PanelField label="Duração de cada uma">{evaluation.extensionUsage.minutesPerExtension} minutos</PanelField>
              </div>
              {evaluation.activeExtension ? (
                <p className="text-[13px] font-semibold">Extensão ativa até {evaluation.activeExtension.grantedUntilLocal}.</p>
              ) : null}
            </PanelSection>

            <PanelSection title="Turnos considerados" aside="hoje e ontem, para cobrir a virada de meia-noite">
              {evaluation.shiftsConsidered.length === 0 ? (
                <p className="text-[13px] text-ds-ink-muted">
                  Nenhum turno encontrado para o recorte. Pela política atual, isso libera o login e sinaliza ausência de escala.
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col rounded-ds-btn border border-ds-divider p-0">
                  {evaluation.shiftsConsidered.map((shift, index) => (
                    <li key={shift.id} className={index > 0 ? "space-y-0.5 border-t border-ds-divider px-3.5 py-3" : "space-y-0.5 px-3.5 py-3"}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-[13px] font-bold">
                          {shiftTypeLabel(shift.type)}
                          {shift.matchesNow ? <StatusPill variant="info">Vigente agora</StatusPill> : null}
                        </span>
                        <span className="text-xs text-ds-ink-muted">Unidade: {shift.unitId || "não informada"}</span>
                      </div>
                      <p className="font-ds-mono text-xs text-ds-ink-2">{shiftWindowLabel(shift)}</p>
                      <p className="text-xs text-ds-ink-muted">Escala: {shift.scheduleId || "não informada"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </PanelSection>

            <PanelSection title="Política atual">
              <ol className="m-0 list-decimal space-y-1.5 pl-5 text-[13px] leading-5 text-ds-ink-2">
                {POLICY.map((item) => <li key={item}>{item}</li>)}
              </ol>
            </PanelSection>
          </>
        ) : null}
      </div>
    </div>
  );
}
