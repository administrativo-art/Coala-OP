"use client";

import * as React from "react";
import { Clock3, LockKeyhole, LogOut, ShieldAlert } from "lucide-react";

import type { HrLoginAccessPayload } from "@/features/hr/lib/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type LoginAccessGateOverlayProps = {
  payload: HrLoginAccessPayload;
  submitting: boolean;
  onSubmitJustification: (text: string) => Promise<void>;
  onLogout: () => void;
};

function shiftWindowLabel(
  shift: NonNullable<HrLoginAccessPayload["evaluation"]["referenceShift"]>
) {
  if (shift.spansMidnight) {
    return `${shift.date} ${shift.startTime} -> ${shift.endDate} ${shift.endTime}`;
  }

  return `${shift.date} ${shift.startTime} - ${shift.endTime}`;
}

function buildOverlayCopy(payload: HrLoginAccessPayload) {
  const { evaluation } = payload;

  switch (evaluation.reason) {
    case "before_shift_too_early":
      return {
        title: "Acesso fora do horário de entrada",
        description:
          evaluation.nextAllowedAtLocal
            ? `O acesso para este turno será liberado a partir de ${evaluation.nextAllowedAtLocal}.`
            : "O acesso ainda não está liberado para este turno.",
        acceptsJustification: false,
      };
    case "after_shift_requires_justification":
      return {
        title: "Turno encerrado",
        description:
          "Para continuar usando o sistema após o fim do turno, envie uma justificativa. Cada envio libera mais 15 minutos.",
        acceptsJustification: true,
      };
    case "after_shift_extension_limit_reached":
      return {
        title: "Limite de extensões atingido",
        description:
          "Este turno já utilizou as 2 extensões automáticas disponíveis. O acesso permanece bloqueado até a próxima janela permitida.",
        acceptsJustification: false,
      };
    case "day_off":
      return {
        title: "Acesso indisponível em dia de folga",
        description:
          "O colaborador está marcado com folga no recorte avaliado. O sistema permanece bloqueado neste período.",
        acceptsJustification: false,
      };
    default:
      return {
        title: "Acesso temporariamente bloqueado",
        description:
          "O sistema identificou uma restrição de acesso por escala para este colaborador.",
        acceptsJustification: false,
      };
  }
}

export function LoginAccessGateOverlay({
  payload,
  submitting,
  onSubmitJustification,
  onLogout,
}: LoginAccessGateOverlayProps) {
  const [justificationText, setJustificationText] = React.useState("");

  React.useEffect(() => {
    setJustificationText("");
  }, [
    payload.evaluation.reason,
    payload.evaluation.referenceShift?.id,
    payload.evaluation.activeExtension?.sequence,
  ]);

  const copy = buildOverlayCopy(payload);
  const referenceShift = payload.evaluation.referenceShift;
  const canSubmit =
    copy.acceptsJustification &&
    justificationText.trim().length >= 5 &&
    !submitting;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 px-4 py-8 backdrop-blur-sm">
      <Card className="w-full max-w-2xl border-slate-200 shadow-2xl">
        <CardHeader className="space-y-4 border-b bg-slate-50/70">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-100 p-3 text-amber-700">
              {payload.evaluation.reason === "after_shift_requires_justification" ? (
                <LockKeyhole className="h-5 w-5" />
              ) : (
                <ShieldAlert className="h-5 w-5" />
              )}
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xl">{copy.title}</CardTitle>
              <CardDescription className="text-sm text-slate-600">
                {copy.description}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Colaborador
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {payload.user.username}
              </p>
              <p className="text-xs text-slate-500">
                Cargo: {payload.user.jobRoleName ?? "Sem cargo"}
              </p>
            </div>

            <div className="rounded-lg border bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Avaliação
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {payload.evaluation.localDate} {payload.evaluation.localTime}
              </p>
              <p className="text-xs text-slate-500">{payload.evaluation.timeZone}</p>
            </div>
          </div>

          {referenceShift && (
            <div className="rounded-lg border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Turno de referência
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {shiftWindowLabel(referenceShift)}
              </p>
              <p className="text-xs text-slate-500">
                Escala: {referenceShift.scheduleId || "não informada"} • Unidade:{" "}
                {referenceShift.unitId || "não informada"}
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Extensões deste turno
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {payload.evaluation.extensionUsage.used} de{" "}
                {payload.evaluation.extensionUsage.max} usadas
              </p>
              <p className="text-xs text-slate-500">
                Restam {payload.evaluation.extensionUsage.remaining}. Cada uma libera{" "}
                {payload.evaluation.extensionUsage.minutesPerExtension} minutos.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Próxima liberação
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {payload.evaluation.nextAllowedAtLocal ?? "Sem nova janela imediata"}
              </p>
              <p className="text-xs text-slate-500">
                {payload.evaluation.allowedUntilLocal
                  ? `Liberação atual válida até ${payload.evaluation.allowedUntilLocal}.`
                  : "Sem extensão ativa neste momento."}
              </p>
            </div>
          </div>

          {payload.evaluation.activeExtension && (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <Clock3 className="mt-0.5 h-4 w-4" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">Extensão ativa</p>
                <p>
                  Justificativa #{payload.evaluation.activeExtension.sequence} válida até{" "}
                  {payload.evaluation.activeExtension.grantedUntilLocal}.
                </p>
              </div>
            </div>
          )}

          {copy.acceptsJustification && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">
                Justificativa
              </label>
              <Textarea
                rows={5}
                value={justificationText}
                onChange={(event) => setJustificationText(event.target.value)}
                placeholder="Descreva por que precisa continuar utilizando o sistema fora do horário do turno."
              />
              <p className="text-xs text-slate-500">
                O sistema aceita no máximo 2 extensões de 15 minutos por turno.
              </p>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onLogout} disabled={submitting}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
            {copy.acceptsJustification && (
              <Button
                type="button"
                onClick={() => void onSubmitJustification(justificationText.trim())}
                disabled={!canSubmit}
              >
                {submitting ? "Enviando..." : "Enviar justificativa"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
