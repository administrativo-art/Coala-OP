"use client";

import React from "react";
import { Clock3, LockKeyhole, ShieldCheck, ShieldX, UserRound } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import {
  fetchHrLoginAccess,
  type HrLoginAccessPayload,
} from "@/features/hr/lib/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

function toDateTimeLocalValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function byUserName(
  left: { username: string },
  right: { username: string }
) {
  return left.username.localeCompare(right.username, "pt-BR");
}

function statusBadge(payload: HrLoginAccessPayload["evaluation"]["status"]) {
  if (payload === "blocked") {
    return (
      <Badge className="border-red-200 bg-red-50 text-red-700 hover:bg-red-50" variant="outline">
        Bloqueado
      </Badge>
    );
  }

  if (payload === "allowed") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" variant="outline">
        Liberado
      </Badge>
    );
  }

  return <Badge variant="secondary">Nao se aplica</Badge>;
}

function reasonLabel(reason: HrLoginAccessPayload["evaluation"]["reason"]) {
  switch (reason) {
    case "disabled":
      return "Limitador desligado para o colaborador.";
    case "within_shift":
      return "Existe turno vigente neste horario.";
    case "pre_shift_tolerance":
      return "O colaborador esta dentro da tolerancia de 15 minutos antes do inicio do turno.";
    case "before_shift_too_early":
      return "Ha um proximo turno, mas ainda nao chegou a janela permitida de entrada.";
    case "after_shift_requires_justification":
      return "O turno terminou e o sistema exige justificativa para liberar mais 15 minutos.";
    case "after_shift_extension_active":
      return "Existe uma extensao ativa por justificativa apos o termino do turno.";
    case "after_shift_extension_limit_reached":
      return "O turno ja consumiu as 2 extensoes automaticas permitidas.";
    case "day_off":
      return "O dia atual esta marcado como folga na escala.";
    case "no_schedule_assigned":
      return "Nao ha escala atribuida para este colaborador neste recorte.";
    default:
      return reason;
  }
}

function shiftTypeLabel(type: "work" | "day_off") {
  return type === "day_off" ? "Folga" : "Trabalho";
}

function shiftWindowLabel(shift: NonNullable<HrLoginAccessPayload["evaluation"]["activeShift"]>) {
  if (shift.spansMidnight) {
    return `${shift.date} ${shift.startTime} -> ${shift.endDate} ${shift.endTime}`;
  }

  return `${shift.date} ${shift.startTime} - ${shift.endTime}`;
}

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
      users.find((item) => item.id === user?.id) ??
      users.find((item) => item.loginRestrictionEnabled) ??
      users[0];

    if (preferredUser) {
      setSelectedUserId(preferredUser.id);
    }
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
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao avaliar acesso por escala."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <LockKeyhole className="h-5 w-5" />
            Diagnostico do limitador
          </CardTitle>
          <CardDescription>
            Simula o efeito do login por escala sem bloquear a usabilidade atual. Nesta primeira versao, colaborador com limitador ligado e sem escala atribuida continua liberado.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="space-y-2">
            <label className="text-sm font-medium">Colaborador</label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um colaborador" />
              </SelectTrigger>
              <SelectContent>
                {users.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data e hora</label>
            <Input
              type="datetime-local"
              value={evaluatedAt}
              onChange={(event) => setEvaluatedAt(event.target.value)}
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={() => void handleEvaluate()}
              disabled={!selectedUserId || loading}
              className="w-full lg:w-auto"
            >
              {loading ? "Verificando..." : "Verificar agora"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading && !result && (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {result && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Resultado</p>
                  <div>{statusBadge(result.evaluation.status)}</div>
                  <p className="text-xs text-muted-foreground">{reasonLabel(result.evaluation.reason)}</p>
                </div>
                {result.evaluation.status === "blocked" ? (
                  <ShieldX className="h-5 w-5 text-red-500" />
                ) : (
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Limitador do usuario</p>
                  <p className="text-lg font-semibold">
                    {result.user.loginRestrictionEnabled ? "Ligado" : "Desligado"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cargo: {result.user.jobRoleName ?? "Sem cargo"}
                  </p>
                </div>
                <UserRound className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3 p-5">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Horario avaliado</p>
                  <p className="text-lg font-semibold">
                    {result.evaluation.localDate} {result.evaluation.localTime}
                  </p>
                  <p className="text-xs text-muted-foreground">{result.evaluation.timeZone}</p>
                </div>
                <Clock3 className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Cargo elegivel</p>
                <p className="mt-1 text-lg font-semibold">
                  {result.role?.loginRestricted ? "Sim" : "Nao"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Campo do cargo continua informativo; a trava efetiva esta no usuario.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Turnos considerados</CardTitle>
                <CardDescription>
                  Consulta feita em hoje e ontem para cobrir virada de meia-noite.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.evaluation.shiftsConsidered.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum turno encontrado para o recorte. Pela politica atual, isso libera o login e sinaliza ausencia de escala.
                  </p>
                ) : (
                  result.evaluation.shiftsConsidered.map((shift) => (
                    <div key={shift.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{shiftTypeLabel(shift.type)}</span>
                          {shift.matchesNow && (
                            <Badge variant="secondary">Vigente agora</Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Unidade: {shift.unitId || "nao informada"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {shiftWindowLabel(shift)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Escala: {shift.scheduleId || "nao informada"}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Turno vigente</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.evaluation.activeShift ? (
                    <div className="space-y-2 text-sm">
                      <p className="font-medium">
                        {shiftTypeLabel(result.evaluation.activeShift.type)}
                      </p>
                      <p className="text-muted-foreground">
                        {shiftWindowLabel(result.evaluation.activeShift)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhum turno vigente no horario avaliado.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Proximo turno</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.evaluation.nextShift ? (
                    <div className="space-y-2 text-sm">
                      <p className="font-medium">
                        {shiftTypeLabel(result.evaluation.nextShift.type)}
                      </p>
                      <p className="text-muted-foreground">
                        {shiftWindowLabel(result.evaluation.nextShift)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhum turno futuro identificado neste recorte.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Politica atual</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>1. O limitador so entra em vigor quando o usuario estiver marcado com a opcao ativa.</p>
                  <p>2. A entrada abre 15 minutos antes do inicio do turno.</p>
                  <p>3. Apos o fim do turno, cada justificativa libera mais 15 minutos.</p>
                  <p>4. O sistema aceita no maximo 2 extensoes automaticas por turno.</p>
                  <p>5. Se nao houver escala atribuida, o sistema libera o acesso para nao travar a operacao por falta de cadastro.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Extensoes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    Usadas: {result.evaluation.extensionUsage.used} de{" "}
                    {result.evaluation.extensionUsage.max}
                  </p>
                  <p>
                    Restantes: {result.evaluation.extensionUsage.remaining}
                  </p>
                  <p>
                    Cada extensao libera {result.evaluation.extensionUsage.minutesPerExtension} minutos.
                  </p>
                  {result.evaluation.activeExtension && (
                    <p>
                      Extensao ativa ate {result.evaluation.activeExtension.grantedUntilLocal}.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
